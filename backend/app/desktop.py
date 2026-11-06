"""Desktop entry point: one loopback process and one SQLite file, with no online services.

Electron starts this module, passes a per-launch token and sends that token with
every request, so other programs and web pages on the computer cannot use the API.
"""

import argparse
import mimetypes
import os
import shutil
import socket
import sqlite3
import sys
import threading
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path
from secrets import compare_digest
from uuid import uuid4

from alembic.script import ScriptDirectory
from alembic.util.exc import CommandError
from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy.engine import URL
from starlette.responses import JSONResponse

DATABASE_NAME = "templates.sqlite"
PENDING_RESTORE_NAME = "restore-pending.sqlite"
SAFETY_FOLDER = "safety-copies"
SAFETY_COPIES_KEPT = 3
REQUIRED_TABLES = {"alembic_version", "templates", "template_revisions"}


def script_directory():
    # Avoid importing the database module before main() has chosen the database.
    from .migrations import configuration

    return ScriptDirectory.from_config(configuration())


def copy_database(source: Path, destination: Path):
    """Write a verified, self-contained copy; a failure never leaves a partial file."""
    temporary = destination.with_name(f"{destination.name}.{uuid4().hex}.tmp")
    try:
        with closing(sqlite3.connect(source)) as origin, closing(sqlite3.connect(temporary)) as copy:
            # SQLite's online backup includes committed WAL data and tolerates active readers.
            origin.backup(copy)
            # The copied header keeps WAL mode; a single file must not need sidecars.
            copy.execute("PRAGMA journal_mode=DELETE").fetchone()
        with temporary.open("rb+") as stream:
            # USB drives can be unplugged as soon as the button reports success.
            os.fsync(stream.fileno())
        verify_database(temporary)
        os.replace(temporary, destination)
    finally:
        temporary.unlink(missing_ok=True)


def verify_database(path: Path):
    """Reject damaged files, other SQLite files and backups from newer app versions."""
    try:
        with closing(sqlite3.connect(f"{path.resolve().as_uri()}?mode=ro", uri=True)) as database:
            if database.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                raise ValueError("This backup is damaged and cannot be used.")
            tables = {row[0] for row in database.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
            if not REQUIRED_TABLES <= tables:
                raise ValueError("This file is not a Report Formatter backup.")
            versions = [row[0] for row in database.execute("SELECT version_num FROM alembic_version")]
    except sqlite3.DatabaseError as error:
        raise ValueError("This file is not a Report Formatter backup.") from error
    try:
        scripts = script_directory()
        if not versions or any(scripts.get_revision(version) is None for version in versions):
            raise ValueError("This file is not a Report Formatter backup.")
    except CommandError as error:
        raise ValueError("This backup was made by a newer version of Report Formatter. Update the app first.") from error


def safety_copy(data_dir: Path, database: Path, reason: str):
    """Keep the replaced data recoverable, without letting copies fill the disk."""
    folder = data_dir / SAFETY_FOLDER
    folder.mkdir(exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S-%f")
    copy_database(database, folder / f"{stamp}-{reason}.sqlite")
    for old in sorted(folder.glob("*.sqlite"), reverse=True)[SAFETY_COPIES_KEPT:]:
        old.unlink()


def prepare_database(data_dir: Path, seed: Path | None) -> Path:
    """Apply a staged restore or install bundled templates. Never overwrite existing data otherwise."""
    data_dir.mkdir(parents=True, exist_ok=True)
    database = data_dir / DATABASE_NAME
    pending = data_dir / PENDING_RESTORE_NAME
    if pending.exists():
        verify_database(pending)
        if database.exists():
            safety_copy(data_dir, database, "before-restore")
            with closing(sqlite3.connect(database)) as current:
                # Clear the WAL first: replaying it over the restored file would corrupt it.
                current.execute("PRAGMA journal_mode=DELETE").fetchone()
        os.replace(pending, database)
    elif not database.exists() and seed is not None and seed.exists():
        temporary = database.with_name(f"{DATABASE_NAME}.{uuid4().hex}.tmp")
        shutil.copyfile(seed, temporary)
        os.replace(temporary, database)
    if database.exists() and not schema_is_current(database):
        safety_copy(data_dir, database, "before-upgrade")
    return database


def schema_is_current(database: Path) -> bool:
    with closing(sqlite3.connect(database)) as connection:
        tables = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
        if "alembic_version" not in tables:
            return False
        current = {row[0] for row in connection.execute("SELECT version_num FROM alembic_version")}
    return current == set(script_directory().get_heads())


class BackupPath(BaseModel):
    path: str


def desktop_router(data_dir: Path) -> APIRouter:
    router = APIRouter(prefix="/api/desktop")

    @router.post("/backup")
    def backup(request: BackupPath):
        try:
            copy_database(data_dir / DATABASE_NAME, Path(request.path))
        except (OSError, sqlite3.Error) as error:
            raise HTTPException(422, "The backup could not be saved. Check the drive is connected and has free space, then try again.") from error
        except ValueError as error:
            raise HTTPException(422, str(error)) from error
        return {"status": "saved"}

    @router.post("/restore")
    def restore(request: BackupPath):
        """Stage a checked backup; Electron restarts the backend, which then applies it."""
        source = Path(request.path)
        temporary = data_dir / f"{PENDING_RESTORE_NAME}.{uuid4().hex}.tmp"
        try:
            shutil.copyfile(source, temporary)
            verify_database(temporary)
            os.replace(temporary, data_dir / PENDING_RESTORE_NAME)
        except OSError as error:
            raise HTTPException(422, "The backup could not be read. Check the drive is connected, then try again.") from error
        except ValueError as error:
            raise HTTPException(422, str(error)) from error
        finally:
            temporary.unlink(missing_ok=True)
        return {"status": "staged"}

    return router


def register_web_types():
    # The Windows registry can map .js to text/plain, which stops module scripts loading.
    mimetypes.init()
    for media_type, extension in (
        ("text/javascript", ".js"), ("text/javascript", ".mjs"), ("text/css", ".css"),
        ("application/wasm", ".wasm"), ("image/svg+xml", ".svg"), ("application/json", ".json"),
        ("text/html", ".html"),
    ):
        mimetypes.add_type(media_type, extension)


def install_web_app(app, web_dir: Path):
    """Serve built files, and the single-page shell for client routes such as /templates/new."""
    register_web_types()
    root = web_dir.resolve()

    @app.get("/{path:path}", include_in_schema=False)
    def web(path: str):
        if path == "api" or path.startswith("api/"):
            raise HTTPException(404, "Not found")
        candidate = (root / path).resolve()
        target = candidate if candidate.is_relative_to(root) and candidate.is_file() else root / "index.html"
        return FileResponse(target, headers={"Cache-Control": "no-cache"})


class RequireLaunchToken:
    """Outermost check, so no route is reachable without this launch's secret."""

    def __init__(self, app, token: str):
        self.app = app
        self.token = token.encode()

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http":
            supplied = dict(scope["headers"]).get(b"x-desktop-token", b"")
            if not compare_digest(supplied, self.token):
                await JSONResponse({"detail": "Open this application from its desktop icon."}, status_code=403)(scope, receive, send)
                return
        await self.app(scope, receive, send)


def exit_with_parent():
    """Electron holds our stdin open; EOF means it has gone, even after a crash."""
    sys.stdin.buffer.read()
    os._exit(0)


def main():
    parser = argparse.ArgumentParser(description="Run the Report Formatter desktop backend")
    parser.add_argument("--data-dir", required=True, type=Path)
    parser.add_argument("--web-dir", required=True, type=Path)
    parser.add_argument("--seed", type=Path)
    arguments = parser.parse_args()
    # An environment variable, as command lines are visible to other local programs.
    token = os.environ.get("TEMPLATE_DESKTOP_TOKEN", "")
    if len(token) < 32:
        raise SystemExit("TEMPLATE_DESKTOP_TOKEN must contain at least 32 characters")

    database = prepare_database(arguments.data_dir, arguments.seed)
    # template_main reads these while importing, so they must be set first.
    os.environ.update(
        TEMPLATE_DATABASE_URL=URL.create("sqlite+pysqlite", database=str(database)).render_as_string(),
        TEMPLATE_ENVIRONMENT="local",
        TEMPLATE_ACCESS_MODE="local",
        TEMPLATE_MIGRATE_ON_START="true",
        WORD_CONVERSION_ENGINE="libreoffice",
    )
    os.environ.setdefault("WORD_CONVERSION_TIMEOUT_SECONDS", "180")

    import uvicorn

    from .template_main import app

    app.include_router(desktop_router(arguments.data_dir))
    install_web_app(app, arguments.web_dir)
    app.add_middleware(RequireLaunchToken, token=token)

    listener = socket.socket()
    listener.bind(("127.0.0.1", 0))
    # Electron reads this line to learn the address, then waits for /api/health.
    print(f"REPORT_FORMATTER_PORT={listener.getsockname()[1]}", flush=True)
    threading.Thread(target=exit_with_parent, daemon=True).start()
    uvicorn.Server(uvicorn.Config(app, log_level="warning")).run(sockets=[listener])


if __name__ == "__main__":
    main()

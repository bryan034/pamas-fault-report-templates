"""Desktop data safety: seeding, backup, restore and the launch-token gate."""

import sqlite3
from contextlib import closing
from datetime import datetime, timezone

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event, select
from sqlalchemy.engine import URL
from sqlalchemy.orm import Session

from app import desktop, desktop_seed, migrations, template_database
from app.template_database import (
    Draft,
    Template,
    TemplateArchive,
    TemplateRevision,
    TemplateSource,
)

TOKEN = "t" * 40


def sqlite_url(path):
    return URL.create("sqlite+pysqlite", database=str(path)).render_as_string()


def migrated_database(monkeypatch, path, title="Template"):
    """A real migrated file containing one template, in WAL mode like the app uses."""
    engine = create_engine(sqlite_url(path))
    event.listen(engine, "connect", template_database.configure_sqlite)
    monkeypatch.setattr(template_database, "_engine", engine)
    migrations.upgrade_database()
    with Session(engine) as db:
        db.add(template_record("template-1", title))
        db.commit()
    return engine


def template_record(identifier, title):
    return Template(id=identifier, title=title, definition={"pages": [], "fields": []},
                    source_pdf=b"%PDF-source", blank_pdf=b"%PDF-blank", thumbnail=b"png",
                    created_at=datetime(2026, 1, 2, tzinfo=timezone.utc))


def titles(path):
    with closing(sqlite3.connect(path)) as connection:
        return [row[0] for row in connection.execute("SELECT title FROM templates ORDER BY title")]


def test_backup_is_a_verified_single_file_with_uncheckpointed_changes(monkeypatch, tmp_path):
    engine = migrated_database(monkeypatch, tmp_path / desktop.DATABASE_NAME)
    with engine.connect() as held_open:  # Keep the WAL populated while copying.
        held_open.exec_driver_sql("SELECT 1")
        target = tmp_path / "usb" / "backup.rfbackup"
        target.parent.mkdir()
        desktop.copy_database(tmp_path / desktop.DATABASE_NAME, target)
    engine.dispose()
    assert titles(target) == ["Template"]
    assert [path.name for path in target.parent.iterdir()] == ["backup.rfbackup"]
    with closing(sqlite3.connect(target)) as connection:
        assert connection.execute("PRAGMA journal_mode").fetchone()[0] == "delete"


def test_failed_backup_leaves_no_file_and_keeps_previous_backup(monkeypatch, tmp_path):
    engine = migrated_database(monkeypatch, tmp_path / desktop.DATABASE_NAME)
    engine.dispose()
    target = tmp_path / "backup.rfbackup"
    target.write_bytes(b"previous")
    monkeypatch.setattr(desktop, "verify_database", lambda _path: (_ for _ in ()).throw(ValueError("bad")))
    with pytest.raises(ValueError):
        desktop.copy_database(tmp_path / desktop.DATABASE_NAME, target)
    assert target.read_bytes() == b"previous"
    assert [path.name for path in tmp_path.iterdir() if path.suffix == ".tmp"] == []


@pytest.mark.parametrize("contents", [b"not a database", b""])
def test_verify_rejects_files_that_are_not_backups(monkeypatch, tmp_path, contents):
    path = tmp_path / "other.rfbackup"
    path.write_bytes(contents)
    with pytest.raises(ValueError, match="not a Report Formatter backup"):
        desktop.verify_database(path)


def test_verify_rejects_a_backup_from_a_newer_version(monkeypatch, tmp_path):
    engine = migrated_database(monkeypatch, tmp_path / "database.sqlite")
    engine.dispose()
    with closing(sqlite3.connect(tmp_path / "database.sqlite")) as connection:
        connection.execute("UPDATE alembic_version SET version_num = '9999_future'")
        connection.commit()
    with pytest.raises(ValueError, match="newer version"):
        desktop.verify_database(tmp_path / "database.sqlite")


def test_seed_is_installed_once_and_never_overwrites_data(monkeypatch, tmp_path):
    seed = tmp_path / "seed.sqlite"
    migrated_database(monkeypatch, seed, "Seed template").dispose()
    data = tmp_path / "data"
    database = desktop.prepare_database(data, seed)
    assert titles(database) == ["Seed template"]
    with closing(sqlite3.connect(database)) as connection:
        connection.execute("UPDATE templates SET title = 'Edited by user'")
        connection.commit()
    assert titles(desktop.prepare_database(data, seed)) == ["Edited by user"]


def test_restore_replaces_data_and_keeps_a_safety_copy(monkeypatch, tmp_path):
    data = tmp_path / "data"
    data.mkdir()
    engine = migrated_database(monkeypatch, data / desktop.DATABASE_NAME, "Current")
    backup = tmp_path / "backup.rfbackup"
    other = migrated_database(monkeypatch, tmp_path / "other.sqlite", "From backup")
    other.dispose()
    desktop.copy_database(tmp_path / "other.sqlite", backup)
    engine.dispose()
    client = TestClient(app_with_router(data))
    assert client.post("/api/desktop/restore", json={"path": str(backup)}).json() == {"status": "staged"}
    assert titles(data / desktop.DATABASE_NAME) == ["Current"]  # Unchanged until restart.
    database = desktop.prepare_database(data, None)
    assert titles(database) == ["From backup"]
    assert not (data / desktop.PENDING_RESTORE_NAME).exists()
    assert not (data / f"{desktop.DATABASE_NAME}-wal").exists()
    safety, = (data / desktop.SAFETY_FOLDER).glob("*-before-restore.sqlite")
    assert titles(safety) == ["Current"]


def test_restore_rejects_invalid_file_without_changing_anything(monkeypatch, tmp_path):
    data = tmp_path / "data"
    data.mkdir()
    migrated_database(monkeypatch, data / desktop.DATABASE_NAME, "Current").dispose()
    bad = tmp_path / "bad.rfbackup"
    bad.write_bytes(b"not a database")
    response = TestClient(app_with_router(data)).post("/api/desktop/restore", json={"path": str(bad)})
    assert response.status_code == 422
    assert "not a Report Formatter backup" in response.json()["detail"]
    assert [path.name for path in data.iterdir() if path.name.startswith("restore")] == []
    assert titles(data / desktop.DATABASE_NAME) == ["Current"]


def test_upgrade_takes_a_safety_copy_and_old_copies_are_pruned(monkeypatch, tmp_path):
    data = tmp_path / "data"
    data.mkdir()
    migrated_database(monkeypatch, data / desktop.DATABASE_NAME).dispose()
    desktop.prepare_database(data, None)
    assert not (data / desktop.SAFETY_FOLDER).exists()  # Current schema: nothing to protect against.
    monkeypatch.setattr(desktop, "schema_is_current", lambda _path: False)
    for _ in range(desktop.SAFETY_COPIES_KEPT + 2):
        desktop.prepare_database(data, None)
    assert len(list((data / desktop.SAFETY_FOLDER).glob("*.sqlite"))) == desktop.SAFETY_COPIES_KEPT


def test_backup_reports_a_missing_drive_clearly(monkeypatch, tmp_path):
    data = tmp_path / "data"
    data.mkdir()
    migrated_database(monkeypatch, data / desktop.DATABASE_NAME).dispose()
    target = tmp_path / "removed-usb" / "backup.rfbackup"
    response = TestClient(app_with_router(data)).post("/api/desktop/backup", json={"path": str(target)})
    assert response.status_code == 422
    assert "drive" in response.json()["detail"]


def app_with_router(data):
    application = FastAPI()
    application.include_router(desktop.desktop_router(data))
    return application


def test_requests_without_the_launch_token_are_refused(tmp_path):
    (tmp_path / "index.html").write_text("<title>shell</title>")
    application = FastAPI()
    desktop.install_web_app(application, tmp_path)
    application.add_middleware(desktop.RequireLaunchToken, token=TOKEN)
    client = TestClient(application)
    assert client.get("/").status_code == 403
    assert client.get("/", headers={"X-Desktop-Token": "wrong"}).status_code == 403
    assert client.get("/", headers={"X-Desktop-Token": TOKEN}).status_code == 200


def test_web_routes_serve_the_shell_and_cannot_leave_the_web_folder(tmp_path):
    web = tmp_path / "web"
    web.mkdir()
    (web / "index.html").write_text("<title>shell</title>")
    (web / "app.js").write_text("export {};")
    (tmp_path / "secret.txt").write_text("secret")
    application = FastAPI()
    desktop.install_web_app(application, web)
    client = TestClient(application)
    assert "shell" in client.get("/templates/custom/abc/edit").text
    assert client.get("/app.js").headers["content-type"].startswith("text/javascript")
    assert "secret" not in client.get("/..%2fsecret.txt").text
    assert client.get("/api/unknown").status_code == 404


def test_seed_copies_active_templates_only(monkeypatch, tmp_path):
    source_path = tmp_path / "source.sqlite"
    source = migrated_database(monkeypatch, source_path, "Active")
    with Session(source) as db:
        db.add(TemplateRevision(id="revision-1", template_id="template-1", number=1, definition={"pages": [], "fields": []},
                                source_pdf=b"%PDF", blank_pdf=b"%PDF", thumbnail=b"png"))
        db.flush()
        db.add(TemplateSource(revision_id="revision-1", filename="a.docx", format="docx", payload=b"docx"))
        db.add(template_record("template-2", "Archived"))
        db.flush()
        db.add(TemplateArchive(template_id="template-2"))
        db.add(TemplateRevision(id="revision-2", template_id="template-2", number=1, definition={"pages": [], "fields": []},
                                source_pdf=b"%PDF", blank_pdf=b"%PDF", thumbnail=b"png"))
        db.add(Draft(id="draft-1", template_id="template-1", title="Private report", form={}))
        db.commit()
    source.dispose()

    target = migrated_database(monkeypatch, tmp_path / "seed.sqlite")
    with Session(target) as db:
        db.delete(db.get(Template, "template-1"))
        db.commit()
    assert desktop_seed.copy_templates(sqlite_url(source_path), target) == ["Active"]
    with Session(target) as db:
        assert db.scalars(select(Template.id)).all() == ["template-1"]
        assert db.scalars(select(TemplateRevision.id)).all() == ["revision-1"]
        assert db.scalars(select(TemplateSource.revision_id)).all() == ["revision-1"]
        assert db.scalars(select(Draft.id)).all() == []
    target.dispose()

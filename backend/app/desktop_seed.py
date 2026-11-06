"""Build the SQLite file of starter templates that the desktop installer ships.

Run on the build computer only. Copies active templates and their revisions from
TEMPLATE_SEED_SOURCE_URL, read-only; saved reports, photos, archived templates and
sign-in records are left out. Point it at a disposable copy of the database, never
at the live one (see docs/windows-desktop.md).
"""

import argparse
import os
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import create_engine, insert, select, text
from sqlalchemy.engine import URL
from sqlalchemy.orm import Session

from .template_database import Template, TemplateArchive, TemplateRevision, TemplateSource


def as_utc(value):
    # SQLite stores the wall clock without an offset; the app reads those values as UTC.
    return value.astimezone(timezone.utc) if isinstance(value, datetime) else value


def rows(connection, statement):
    return [{key: as_utc(value) for key, value in row._mapping.items()} for row in connection.execute(statement)]


def copy_templates(source_url: str, target_engine) -> list[str]:
    """Copy into an already migrated database and return the copied titles."""
    source = create_engine(source_url)
    try:
        with source.connect() as reader, Session(target_engine) as writer:
            if reader.dialect.name == "postgresql":
                reader.execute(text("SET TRANSACTION READ ONLY"))
            active = select(Template.id).where(Template.id.not_in(select(TemplateArchive.template_id)))
            revisions = select(TemplateRevision.id).where(TemplateRevision.template_id.in_(active))
            titles = []
            for model, statement in (
                (Template, select(Template.__table__).where(Template.id.in_(active))),
                (TemplateRevision, select(TemplateRevision.__table__).where(TemplateRevision.template_id.in_(active))),
                (TemplateSource, select(TemplateSource.__table__).where(TemplateSource.revision_id.in_(revisions))),
            ):
                found = rows(reader, statement)
                if found:
                    writer.execute(insert(model), found)
                if model is Template:
                    titles = [row["title"] for row in found]
            writer.commit()
            return titles
    finally:
        source.dispose()


def main():
    parser = argparse.ArgumentParser(description="Create the desktop starter-template database")
    parser.add_argument("target", type=Path)
    target = parser.parse_args().target
    source_url = os.environ.get("TEMPLATE_SEED_SOURCE_URL", "")
    if not source_url:
        raise SystemExit("Set TEMPLATE_SEED_SOURCE_URL to a disposable copy of the database")
    if target.exists():
        raise SystemExit(f"{target} already exists; choose a new file")
    target.parent.mkdir(parents=True, exist_ok=True)
    os.environ["TEMPLATE_DATABASE_URL"] = URL.create("sqlite+pysqlite", database=str(target)).render_as_string()

    from .desktop import verify_database
    from .migrations import upgrade_database
    from .template_database import engine

    upgrade_database()
    titles = copy_templates(source_url, engine())
    with engine().connect().execution_options(isolation_level="AUTOCOMMIT") as connection:
        connection.execute(text("VACUUM"))
        connection.execute(text("PRAGMA journal_mode=DELETE"))
    engine().dispose()
    verify_database(target)
    print(f"Copied {len(titles)} active templates to {target}: {', '.join(titles)}")


if __name__ == "__main__":
    main()

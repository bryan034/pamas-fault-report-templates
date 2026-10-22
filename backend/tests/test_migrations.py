"""Migrate disposable databases and verify existing records survive adoption."""
import importlib.util
from pathlib import Path

import pytest
from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.pool import StaticPool

from app import migrations, template_database


def database(monkeypatch):
    engine = create_engine("sqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
    monkeypatch.setattr(template_database, "_engine", engine)
    return engine


def test_empty_database_upgrades_and_repeated_upgrade_is_noop(monkeypatch):
    engine = database(monkeypatch)
    try:
        with pytest.raises(RuntimeError, match="migrations are required"):
            migrations.check_database()
        migrations.upgrade_database()
        migrations.check_database()
        migrations.upgrade_database()
        with engine.connect() as connection:
            assert compare_metadata(MigrationContext.configure(connection), template_database.Base.metadata) == []
    finally:
        engine.dispose()


def test_existing_schema_is_adopted_without_overwriting_records(monkeypatch):
    engine = database(monkeypatch)
    # Model the unversioned installation using the frozen baseline, not current models.
    path = Path(__file__).parents[1] / "migrations/versions/0001_template_schema.py"
    spec = importlib.util.spec_from_file_location("baseline", path)
    baseline = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(baseline)
    try:
        with engine.begin() as connection:
            for table in baseline.schema_snapshot().sorted_tables:
                table.create(connection)
            connection.execute(text("INSERT INTO templates (id,title,definition,source_pdf,blank_pdf,thumbnail,created_at) VALUES ('kept','Keep this','{}',X'25504446',X'25504446',X'01','2026-10-22')"))
            connection.execute(text("INSERT INTO template_drafts (id,template_id,title,form,created_at,updated_at) VALUES ('draft','kept','Saved draft','{}','2026-10-22','2026-10-22')"))
            connection.execute(text("INSERT INTO template_draft_images (draft_id,field_id,payload,filename,media_type) VALUES ('draft','photo',X'010203','photo.png','image/png')"))
        migrations.upgrade_database()
        migrations.check_database()
        with engine.connect() as connection:
            assert connection.execute(text("SELECT title,source_pdf FROM templates")).one() == ("Keep this", b"%PDF")
            assert connection.execute(text("SELECT payload FROM template_draft_images")).scalar_one() == b"\x01\x02\x03"
    finally:
        engine.dispose()


def test_incompatible_schema_is_not_silently_stamped(monkeypatch):
    engine = database(monkeypatch)
    try:
        with engine.begin() as connection:
            connection.execute(text("CREATE TABLE templates (id VARCHAR(36) PRIMARY KEY, title VARCHAR(100))"))
            connection.execute(text("INSERT INTO templates VALUES ('keep','Do not delete')"))
        with pytest.raises(RuntimeError, match="Schema mismatch"):
            migrations.upgrade_database()
        with engine.connect() as connection:
            assert connection.execute(text("SELECT title FROM templates")).scalar_one() == "Do not delete"
        with pytest.raises(RuntimeError, match="migrations are required"):
            migrations.check_database()
    finally:
        engine.dispose()


def test_initial_downgrade_refuses_to_delete_document_data(monkeypatch):
    engine = database(monkeypatch)
    try:
        migrations.upgrade_database()
        config = migrations.configuration()
        with engine.begin() as connection:
            config.attributes["connection"] = connection
            with pytest.raises(RuntimeError, match="cannot be dropped"):
                command.downgrade(config, "base")
        assert "templates" in inspect(engine).get_table_names()
        migrations.check_database()
    finally:
        engine.dispose()


def test_postgres_private_schema_adoption_and_concurrent_upgrades(api):
    """Exercise actual PostgreSQL reflection, private version table and startup lock."""
    engine = template_database.engine()
    if engine.dialect.name != "postgresql":
        pytest.skip("Set QA_POSTGRES_URL to a disposable PostgreSQL database")
    from concurrent.futures import ThreadPoolExecutor
    schema = engine.get_execution_options()["schema_translate_map"][None]
    with engine.begin() as connection:
        connection.execute(text(f'DROP TABLE "{schema}".alembic_version'))
        connection.execute(template_database.ApplicationUser.__table__.insert().values(
            email="keep@example.com", role="viewer", updated_by="owner@example.com"))
    with ThreadPoolExecutor(max_workers=2) as executor:
        list(executor.map(lambda _: migrations.upgrade_database(), range(2)))
    migrations.check_database()
    config = migrations.configuration()
    with engine.begin() as connection:
        config.attributes["connection"] = connection
        command.check(config)
    with engine.connect() as connection:
        assert connection.execute(text(f'SELECT version_num FROM "{schema}".alembic_version')).scalars().all() == ["0001_template_schema"]
        assert connection.execute(template_database.ApplicationUser.__table__.select()).one().email == "keep@example.com"

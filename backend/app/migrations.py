"""Versioned schema upgrades, serialized across PostgreSQL application starts."""
from pathlib import Path
from alembic import command
from alembic.config import Config
from alembic.runtime.migration import MigrationContext
from alembic.script import ScriptDirectory
from sqlalchemy import text
from .template_database import engine


def configuration():
    return Config(str(Path(__file__).resolve().parents[1] / "alembic.ini"))


def upgrade_database():
    config = configuration()
    with engine().begin() as connection:
        if connection.dialect.name == "postgresql":
            # Transaction-scoped lock protects simultaneous cold starts/migration jobs.
            connection.execute(text("SELECT pg_advisory_xact_lock(723408126409)"))
        config.attributes["connection"] = connection
        command.upgrade(config, "head")


def check_database():
    config = configuration()
    with engine().connect() as connection:
        schema = connection.get_execution_options().get("schema_translate_map", {}).get(None)
        current = MigrationContext.configure(connection, opts={"version_table_schema": schema}).get_current_heads()
    if set(current) != set(ScriptDirectory.from_config(config).get_heads()):
        raise RuntimeError("Database migrations are required. Run: python -m app.migrations upgrade")


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Manage the template database schema")
    parser.add_argument("action", choices=["upgrade", "check"])
    args = parser.parse_args()
    (upgrade_database if args.action == "upgrade" else check_database)()

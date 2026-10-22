"""Use the application's connection, including its private PostgreSQL schema."""
from alembic import context
from sqlalchemy import text
from app.template_database import Base, engine


def run(connection):
    if connection.dialect.name == "postgresql":
        connection.execute(text("SELECT pg_advisory_xact_lock(723408126409)"))
    schema = connection.get_execution_options().get("schema_translate_map", {}).get(None)
    if schema and connection.dialect.name == "postgresql":
        connection.execute(text('SET LOCAL search_path TO "' + schema + '"'))
    context.configure(connection=connection, target_metadata=Base.metadata,
                      version_table_schema=schema, compare_type=True,
                      include_object=lambda obj, name, kind, reflected, compare_to:
                          not (kind == "table" and reflected and compare_to is None))
    with context.begin_transaction():
        context.run_migrations()

provided = context.config.attributes.get("connection")
if provided is not None:
    run(provided)
else:
    with engine().begin() as connection:
        run(connection)

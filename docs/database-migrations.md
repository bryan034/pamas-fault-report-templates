# Database migrations

Python/SQLAlchemy owns the application database. Alembic records its schema
revision in `alembic_version` alongside the application tables. Startup no longer
calls `create_all`. PostgreSQL migrations are serialized with a transaction-level
advisory lock; a failure aborts startup instead of serving an incompatible schema.

## Upgrade

Back up the database first and test restoration separately. For a local stack:

```sh
docker compose build template-service
docker compose run --rm template-service /service/.venv/bin/python -m app.migrations upgrade
docker compose up -d template-service web
```

Standalone, from `backend/` with the intended `TEMPLATE_DATABASE_URL` configured:

```sh
uv run python -m app.migrations upgrade
uv run python -m app.migrations check
```

The first migration contains a frozen schema snapshot. It creates an empty
database or checks existing table columns/types/nullability, primary keys,
foreign keys and uniqueness before adopting an existing installation. Missing
application tables/indexes are added. Existing document bytes, images, auth rows
and revision bindings are retained. A mismatch fails with an actionable error;
never stamp an incompatible database or delete a volume to bypass it.

Startup defaults to upgrading for local and initial cloud installs. For a
controlled production release, execute the upgrade as an administrative job
before rolling out application replicas and set `TEMPLATE_MIGRATE_ON_START=false`.
Then startup only checks the revision and refuses stale schemas. The cloud Worker
forwards this setting from its environment (default `true`).

## Add a change

From `backend/`, configure an isolated development database at the current head:

```sh
uv run alembic revision --autogenerate -m "describe the schema change"
uv run alembic upgrade head
uv run alembic check
```

Review generated operations, test both fresh installation and upgrade of a copy
of existing records, then commit the migration with the model change. Never edit
a migration already deployed. Unknown database tables are excluded from automatic
DROP suggestions. The application schema must be configured explicitly in cloud
mode; the Alembic version table lives in that same private schema.

Prefer additive migrations compatible with the previous application release.
Rollback means redeploying the previous compatible application image/Worker, not
keeping another container running. The initial baseline deliberately refuses a
destructive downgrade. Restoring a backup belongs in a separate database first;
do not automatically downgrade documents on an application rollback.

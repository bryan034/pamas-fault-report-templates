"""One shared-service API and isolated database per test; never use saved drafts."""

import os
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.pool import StaticPool
from sqlalchemy.schema import CreateSchema, DropSchema

from app import template_database, template_main


@pytest.fixture
def api(monkeypatch):
    """Use SQLite by default, or a unique schema in a disposable QA PostgreSQL DB."""
    url = os.environ.get("QA_POSTGRES_URL")
    schema = None
    if url:
        connection = create_engine(url)
        schema = "qa_templates_" + uuid4().hex
        with connection.begin() as db:
            db.execute(CreateSchema(schema))
        engine = connection.execution_options(schema_translate_map={None: schema})
    else:
        connection = engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
    monkeypatch.setattr(template_database, "_engine", engine)
    try:
        with TestClient(template_main.app, raise_server_exceptions=False) as client:
            yield client
    finally:
        if schema:
            with connection.begin() as db:
                db.execute(DropSchema(schema, cascade=True))
        connection.dispose()

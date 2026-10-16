"""Cloud settings/security checks use isolated fixtures; never a cloud database."""

import pytest
from app import deployment, template_database


def cloud(monkeypatch):
    monkeypatch.setenv("TEMPLATE_ENVIRONMENT", "production")
    monkeypatch.setenv("TEMPLATE_DATABASE_URL", "postgresql+psycopg://user:password@example.test/postgres?sslmode=require")
    monkeypatch.setenv("TEMPLATE_DATABASE_SCHEMA", "report_formatter")
    monkeypatch.setenv("TEMPLATE_SERVICE_TOKEN", "s" * 40)


def test_local_needs_no_cloud_settings(monkeypatch):
    monkeypatch.delenv("TEMPLATE_ENVIRONMENT", raising=False)
    deployment.validate_environment()
    assert not deployment.is_cloud()


@pytest.mark.parametrize("variable,value", [
    ("TEMPLATE_DATABASE_URL", ""),
    ("TEMPLATE_DATABASE_URL", "sqlite://"),
    ("TEMPLATE_DATABASE_URL", "postgresql+psycopg://user@host/postgres"),
    ("TEMPLATE_SERVICE_TOKEN", "short"),
    ("TEMPLATE_DATABASE_SCHEMA", "public"),
    ("TEMPLATE_DATABASE_SCHEMA", "report_formatter; DROP SCHEMA public"),
    ("TEMPLATE_DATABASE_SCHEMA", ""),
])
def test_cloud_rejects_unsafe_settings(monkeypatch, variable, value):
    cloud(monkeypatch)
    monkeypatch.setenv(variable, value)
    with pytest.raises((RuntimeError, ValueError)):
        deployment.validate_environment()


def test_cloud_engine_uses_bounded_pool_and_explicit_schema(monkeypatch):
    cloud(monkeypatch)
    monkeypatch.setattr(template_database, "_engine", None)
    captured = {}
    sentinel = object()

    def fake_engine(url, **kwargs):
        captured.update(kwargs)
        return sentinel

    monkeypatch.setattr(template_database, "create_engine", fake_engine)
    assert template_database.engine() is sentinel
    assert template_database.engine() is sentinel
    assert captured["pool_pre_ping"] is True
    assert captured["pool_size"] == 3
    assert captured["max_overflow"] == 2
    assert captured["execution_options"]["schema_translate_map"] == {None: "report_formatter"}


def test_cloud_api_requires_service_token_even_for_health(api, monkeypatch):
    cloud(monkeypatch)
    for path in ["/api/health", "/api/templates", "/api/templates/nonexistent/thumbnail"]:
        assert api.get(path).status_code == 401
        assert api.get(path, headers={"X-Template-Service-Token": "wrong"}).status_code == 401
    allowed = api.get("/api/health", headers={"X-Template-Service-Token": "s" * 40})
    assert allowed.status_code == 200
    assert allowed.headers["cache-control"] == "private, no-store"
    monkeypatch.delenv("TEMPLATE_SERVICE_TOKEN")
    assert api.get("/api/health").status_code == 401


def test_local_api_remains_accessible(api):
    assert api.get("/api/health").status_code == 200

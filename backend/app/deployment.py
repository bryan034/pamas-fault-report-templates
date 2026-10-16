"""Fail-closed settings for cloud deployments; local Compose remains unchanged."""

import os
import re

from sqlalchemy.engine import make_url


def is_cloud():
    return os.environ.get("TEMPLATE_ENVIRONMENT", "local") in {"staging", "production"}


def validate_environment():
    if not is_cloud():
        return
    raw = os.environ.get("TEMPLATE_DATABASE_URL", "")
    if not raw:
        raise RuntimeError("TEMPLATE_DATABASE_URL is required in cloud deployments")
    url = make_url(raw)
    if url.drivername != "postgresql+psycopg" or url.query.get("sslmode") not in {
        "require", "verify-ca", "verify-full"
    }:
        raise RuntimeError("Cloud deployments require PostgreSQL with TLS")
    if len(os.environ.get("TEMPLATE_SERVICE_TOKEN", "")) < 32:
        raise RuntimeError("Set a TEMPLATE_SERVICE_TOKEN of at least 32 characters")
    schema = os.environ.get("TEMPLATE_DATABASE_SCHEMA", "")
    if not re.fullmatch(r"[a-z_][a-z0-9_]{0,62}", schema) or schema in {"public", "auth", "storage", "pg_catalog", "information_schema"}:
        raise RuntimeError("Set a dedicated private TEMPLATE_DATABASE_SCHEMA")

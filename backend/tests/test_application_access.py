"""Application session and authorization tests; no real credentials or saved data."""

import json
from datetime import timedelta
import pytest
from sqlalchemy.orm import Session

from app import application_access as access
from app.google_auth import digest
from app.template_database import LoginSession, engine, now
from test_templates import sample_pdf, definition


@pytest.fixture
def secured(api, monkeypatch):
    monkeypatch.setenv("TEMPLATE_ACCESS_MODE", "google")
    monkeypatch.setenv("TEMPLATE_OWNER_EMAIL", "owner@example.com")
    monkeypatch.setenv("GOOGLE_CLIENT_ID", "test.apps.googleusercontent.com")
    monkeypatch.setenv("GOOGLE_CLIENT_SECRET", "unit-test-secret")
    monkeypatch.setenv("TEMPLATE_PUBLIC_ORIGIN", "https://reports.example.com")
    def headers(address="owner@example.com", **overrides):
        token = "unit-test-session-" + address
        with Session(engine()) as db:
            db.merge(LoginSession(token_hash=digest(token), subject="subject-" + address,
                                  email=address, expires_at=now() + timedelta(hours=1)))
            db.commit()
        return {"Cookie": "report_session=" + token, "Origin": "https://reports.example.com"}

    return api, headers


def test_local_development_cannot_manage_access(api):
    assert api.get("/api/access/me").json() == {
        "mode": "local",
        "email": None,
        "role": "editor",
    }
    assert (
        api.get(
            "/api/access/users", headers={"X-Template-User-Email": "owner@example.com"}
        ).status_code
        == 403
    )
    assert (
        api.put(
            "/api/access/users", json={"email": "a@example.com", "role": "editor"}
        ).status_code
        == 403
    )


def test_missing_or_forged_identity_is_rejected(secured):
    api, headers = secured
    assert api.get("/api/health").status_code == 200
    for supplied in [
        {},
        {"Cf-Access-Authenticated-User-Email": "owner@example.com"},
        {"X-Template-User-Email": "owner@example.com"},
        {"Cf-Access-Jwt-Assertion": "forged"},
    ]:
        assert api.get("/api/templates", headers=supplied).status_code == 401
    assert api.get("/api/access/me", headers=headers()).json()["role"] == "owner"
    assert (
        api.get("/api/templates", headers=headers("unassigned@example.com")).status_code
        == 403
    )


def test_expired_session(secured):
    api, headers = secured
    supplied = headers()
    with Session(engine()) as db:
        row = db.get(LoginSession, digest("unit-test-session-owner@example.com"))
        row.expires_at = now() - timedelta(seconds=1)
        db.commit()
    assert api.get("/api/templates", headers=supplied).status_code == 401


def test_random_cookie_cannot_impersonate_owner(secured):
    api, headers = secured
    headers()
    assert api.get("/api/templates", headers={"Cookie": "report_session=owner@example.com"}).status_code == 401


def test_owner_grants_updates_and_revokes(secured):
    api, headers = secured

    def grant(role):
        return api.put(
            "/api/access/users",
            headers=headers(),
            json={"email": " Member@Example.com ", "role": role},
        )

    assert grant("viewer").status_code == 200
    assert (
        api.get("/api/access/me", headers=headers("member@example.com")).json()["role"]
        == "viewer"
    )
    assert grant("editor").status_code == 200
    assert (
        api.get("/api/access/me", headers=headers("member@example.com")).json()["role"]
        == "editor"
    )
    users = api.get("/api/access/users", headers=headers()).json()
    assert users["owner"] == "owner@example.com"
    assert users["users"][0]["email"] == "member@example.com"
    assert (
        api.get("/api/access/users", headers=headers("member@example.com")).status_code
        == 403
    )
    assert (
        api.put(
            "/api/access/users",
            headers=headers("member@example.com"),
            json={"email": "other@example.com", "role": "viewer"},
        ).status_code
        == 403
    )
    assert (
        api.delete(
            "/api/access/users/member@example.com", headers=headers()
        ).status_code
        == 204
    )
    assert (
        api.get("/api/access/me", headers=headers("member@example.com")).status_code
        == 403
    )


@pytest.mark.parametrize(
    "payload",
    [
        {"email": "owner@example.com", "role": "viewer"},
        {"email": "bad-email", "role": "viewer"},
        {"email": "a@example.com", "role": "owner"},
    ],
)
def test_invalid_grants(secured, payload):
    api, headers = secured
    assert (
        api.put("/api/access/users", headers=headers(), json=payload).status_code == 422
    )
    assert (
        api.delete("/api/access/users/owner@example.com", headers=headers()).status_code
        == 422
    )


@pytest.mark.parametrize(
    "method,path",
    [
        ("post", "/api/templates/analyze"),
        ("put", "/api/templates/missing"),
        ("patch", "/api/templates/missing/drafts/missing"),
        ("delete", "/api/templates/missing"),
        ("post", "/api/templates/missing/generate"),
        ("post", "/api/templates/missing/restore"),
        ("post", "/api/templates/missing/drafts/missing/restore"),
    ],
)
def test_viewer_cannot_mutate_any_route(secured, method, path):
    api, headers = secured
    assert (
        api.put(
            "/api/access/users",
            headers=headers(),
            json={"email": "viewer@example.com", "role": "viewer"},
        ).status_code
        == 200
    )
    assert (
        getattr(api, method)(path, headers=headers("viewer@example.com")).status_code
        == 403
    )
    assert (
        api.get("/api/templates", headers=headers("viewer@example.com")).status_code
        == 200
    )


def test_cross_site_write_rejected(secured):
    api, headers = secured
    for extra in [{"Origin": "https://evil.test"}, {"Sec-Fetch-Site": "cross-site"}]:
        assert (
            api.put(
                "/api/access/users",
                headers={**headers(), **extra},
                json={"email": "new@example.com", "role": "editor"},
            ).status_code
            == 403
        )


def test_viewer_cannot_read_recently_deleted(secured):
    api, headers = secured
    api.put("/api/access/users", headers=headers(),
            json={"email": "viewer@example.com", "role": "viewer"})
    assert api.get("/api/templates/missing/deleted-drafts", headers=headers("viewer@example.com")).status_code == 403


@pytest.mark.parametrize(
    "variable,value",
    [
        ("TEMPLATE_OWNER_EMAIL", ""),
        ("GOOGLE_CLIENT_ID", ""),
        ("GOOGLE_CLIENT_SECRET", ""),
        ("TEMPLATE_PUBLIC_ORIGIN", "http://reports.example.com"),
        ("TEMPLATE_PUBLIC_ORIGIN", "https://reports.example.com/path"),
        ("TEMPLATE_ACCESS_MODE", "typo"),
    ],
)
def test_settings_fail_closed(secured, monkeypatch, variable, value):
    monkeypatch.setenv(variable, value)
    with pytest.raises(ValueError):
        access.validate_settings()


def test_cloud_identity_requires_private_gateway_and_session(secured, monkeypatch):
    api, headers = secured
    monkeypatch.setenv("TEMPLATE_ENVIRONMENT", "production")
    monkeypatch.setenv("TEMPLATE_OWNER_EMAIL", "owner@example.com")
    monkeypatch.setenv("TEMPLATE_SERVICE_TOKEN", "s" * 40)
    forged = {"X-Template-User-Email": "owner@example.com"}
    assert api.get("/api/access/me", headers=forged).status_code == 401
    assert (
        api.get(
            "/api/access/me", headers={"X-Template-Service-Token": "s" * 40}
        ).status_code
        == 401
    )
    response = api.get(
        "/api/access/me", headers={**forged, "X-Template-Service-Token": "s" * 40}
    )
    assert response.status_code == 401
    response = api.get("/api/access/me", headers={**headers(), "X-Template-Service-Token": "s" * 40})
    assert response.json()["role"] == "owner"
    assert response.headers["cache-control"] == "private, no-store"


def test_viewer_reads_saved_content_and_downloads_but_cannot_change_it(secured):
    api, headers = secured
    response = api.post(
        "/api/templates",
        headers=headers(),
        data={
            "title": "Access test",
            "reviewed": "true",
            "definition_json": definition().model_dump_json(),
        },
        files={"pdf": ("form.pdf", sample_pdf(), "application/pdf")},
    )
    assert response.status_code == 200
    base = f"/api/templates/{response.json()['id']}"
    draft = api.post(
        base + "/drafts",
        headers=headers(),
        data={
            "report_json": json.dumps(
                {"title": "Saved draft", "values": {"company": "Test company"}}
            )
        },
    )
    assert draft.status_code == 200
    path = base + "/drafts/" + draft.json()["id"]
    api.put(
        "/api/access/users",
        headers=headers(),
        json={"email": "viewer@example.com", "role": "viewer"},
    )
    viewer = headers("viewer@example.com")
    for route in [base, base + "/drafts", path, base + "/thumbnail"]:
        assert api.get(route, headers=viewer).status_code == 200
    for route in [
        path + "/pdf",
        path + "/download?format=pdf",
        path + "/download?format=docx",
        path + "/download?format=original",
    ]:
        response = api.get(route, headers=viewer)
        assert response.status_code == 200
        assert response.content.startswith((b"%PDF-", b"PK"))
    for method in ["put", "patch", "delete"]:
        assert getattr(api, method)(path, headers=viewer).status_code == 403
    assert api.get(path, headers=headers()).json()["title"] == "Saved draft"

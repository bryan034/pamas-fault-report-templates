"""Real authorization URLs and signed ID tokens; offline provider exchange only."""

from datetime import timedelta
from types import SimpleNamespace
import logging
from urllib.parse import parse_qs, urlsplit

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from sqlalchemy import select, func
from sqlalchemy.orm import Session

from app import google_auth as auth
from app.template_database import LoginAttempt, LoginSession, engine, now
from test_application_access import secured  # noqa: F401


@pytest.fixture
def google(secured, monkeypatch):
    api, headers = secured
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    monkeypatch.setattr(auth, "google_keys", lambda: SimpleNamespace(
        get_signing_key_from_jwt=lambda token: SimpleNamespace(key=key.public_key())))
    return api, headers, key


def signed(key, nonce_value, **overrides):
    claims = {"iss": "https://accounts.google.com", "aud": "test.apps.googleusercontent.com",
              "sub": "google-subject", "email": "owner@example.com", "hd": "example.com",
              "email_verified": True, "iat": int(now().timestamp()),
              "exp": int((now() + timedelta(minutes=5)).timestamp()), "nonce": nonce_value,
              **overrides}
    return jwt.encode(claims, key, algorithm="RS256")


def start(api):
    response = api.get("/api/auth/google", follow_redirects=False)
    assert response.status_code == 302
    url = urlsplit(response.headers["location"])
    assert url.netloc == "accounts.google.com"
    query = parse_qs(url.query)
    assert query["scope"] == ["openid email"]
    assert query["code_challenge_method"] == ["S256"]
    assert query["redirect_uri"] == ["https://reports.example.com/api/auth/google/callback"]
    assert "client_secret" not in query
    cookie = response.headers["set-cookie"]
    assert "HttpOnly" in cookie and "Secure" in cookie and "SameSite=lax" in cookie
    # TestClient's testserver is HTTP; manually bind the HTTPS cookie for callbacks.
    browser = response.cookies.get(auth.STATE_COOKIE)
    return query, {"Cookie": f"{auth.STATE_COOKIE}={browser}"}


def exchange(monkeypatch, token, expected_verifier):
    class Client:
        def __enter__(self): return self
        def __exit__(self, *args): pass
        def fetch_token(self, url, **kwargs):
            assert url == "https://oauth2.googleapis.com/token"
            assert kwargs == {"code": "provider-code", "code_verifier": expected_verifier}
            return {"id_token": token, "access_token": "MUST_NOT_BE_STORED"}
    monkeypatch.setattr(auth, "oauth_client", Client)


def callback(api, query, headers, **changes):
    return api.get(auth.CALLBACK, params={"state": query["state"][0], "code": "provider-code", **changes},
                   headers=headers, follow_redirects=False)


def test_authorization_login_session_logout_and_replay(google, monkeypatch):
    api, _, key = google
    query, headers = start(api)
    with Session(engine()) as db:
        attempt = db.get(LoginAttempt, auth.digest(query["state"][0]))
        assert attempt.browser_hash != headers["Cookie"].split("=", 1)[1]
        verifier = attempt.verifier
    exchange(monkeypatch, signed(key, query["nonce"][0]), verifier)
    response = callback(api, query, headers)
    assert response.headers["location"] == "https://reports.example.com/"
    token = response.cookies.get(auth.SESSION_COOKIE)
    assert token and "HttpOnly" in response.headers.get_list("set-cookie")[0]
    with Session(engine()) as db:
        row = db.get(LoginSession, auth.digest(token))
        assert row.email == "owner@example.com" and row.subject == "google-subject"
        assert db.scalar(select(func.count()).select_from(LoginAttempt)) == 0
        assert row.token_hash != token
    session = {"Cookie": f"{auth.SESSION_COOKIE}={token}"}
    assert api.get("/api/access/me", headers=session).json()["role"] == "owner"
    # Sessions live in DB, not a process-local cache.
    assert api.get("/api/templates", headers=session).status_code == 200
    assert "login_failed" in callback(api, query, headers).headers["location"]
    assert api.get("/api/auth/logout", headers=session).status_code == 405
    assert api.post("/api/auth/logout", headers=session).status_code == 403
    assert api.post("/api/auth/logout", headers={**session, "Origin": "https://evil.test"}).status_code == 403
    logged_out = api.post("/api/auth/logout", headers={**session, "Origin": "https://reports.example.com"})
    assert logged_out.status_code == 200 and "Max-Age=0" in logged_out.headers["set-cookie"]
    assert api.get("/api/access/me", headers=session).status_code == 401


@pytest.mark.parametrize("variant", ["state", "browser", "expired", "cancelled", "no_code"])
def test_invalid_callback_never_exchanges_code(google, monkeypatch, variant):
    api, _, _ = google
    query, headers = start(api)
    if variant == "state": query["state"] = ["forged"]
    if variant == "browser": headers = {"Cookie": f"{auth.STATE_COOKIE}=forged"}
    if variant == "expired":
        with Session(engine()) as db:
            row = db.get(LoginAttempt, auth.digest(query["state"][0]))
            row.expires_at = now() - timedelta(seconds=1)
            db.commit()
    monkeypatch.setattr(auth, "oauth_client", lambda: pytest.fail("Invalid callback must not contact Google"))
    changes = {"error": "access_denied"} if variant == "cancelled" else {"code": ""} if variant == "no_code" else {}
    response = callback(api, query, headers, **changes)
    assert "login_failed" in response.headers["location"]
    assert auth.SESSION_COOKIE not in response.cookies


@pytest.mark.parametrize("overrides", [
    {"iss": "https://evil.test"}, {"aud": "wrong"}, {"exp": 1}, {"nonce": "wrong"},
    {"email_verified": False}, {"email_verified": "true"}, {"sub": ""},
    {"azp": "other-client"}, {"nonce": None}, {"email": ""},
    {"email": "recycled@third-party.example", "hd": None},
])
def test_bad_google_identity_is_rejected(google, overrides):
    _, _, key = google
    with pytest.raises((ValueError, jwt.PyJWTError)):
        auth.verify_id_token(signed(key, "nonce", **overrides), "nonce")


def test_wrong_signature_and_missing_claims(google):
    _, _, key = google
    other = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    with pytest.raises(jwt.PyJWTError): auth.verify_id_token(signed(other, "nonce"), "nonce")
    claims = jwt.decode(signed(key, "nonce"), options={"verify_signature": False})
    for name in ["exp", "iat", "sub", "email", "nonce", "email_verified", "iss", "aud"]:
        reduced = {k: v for k, v in claims.items() if k != name}
        with pytest.raises(jwt.PyJWTError):
            auth.verify_id_token(jwt.encode(reduced, key, algorithm="RS256"), "nonce")


def test_unapproved_google_account_gets_no_session(google, monkeypatch):
    api, _, key = google
    query, headers = start(api)
    with Session(engine()) as db:
        verifier = db.get(LoginAttempt, auth.digest(query["state"][0])).verifier
    exchange(monkeypatch, signed(key, query["nonce"][0], email="unapproved@gmail.com", hd=None), verifier)
    response = callback(api, query, headers)
    assert "not_approved" in response.headers["location"]
    assert auth.SESSION_COOKIE not in response.cookies
    with Session(engine()) as db:
        assert db.scalar(select(func.count()).select_from(LoginSession)) == 0


def test_provider_failure_never_leaks_secrets(google, monkeypatch):
    api, _, _ = google
    query, headers = start(api)
    def failed(): raise RuntimeError("provider-code client-secret db-password")
    monkeypatch.setattr(auth, "oauth_client", failed)
    response = callback(api, query, headers)
    assert response.status_code == 303
    assert "client-secret" not in str(response.headers) + response.text


def test_revoking_member_destroys_all_their_sessions(google):
    api, headers, _ = google
    owner = headers()
    api.put("/api/access/users", headers=owner, json={"email": "member@gmail.com", "role": "viewer"})
    member = headers("member@gmail.com")
    assert api.get("/api/access/me", headers=member).status_code == 200
    api.delete("/api/access/users/member@gmail.com", headers=owner)
    api.put("/api/access/users", headers=owner, json={"email": "member@gmail.com", "role": "editor"})
    assert api.get("/api/access/me", headers=member).status_code == 401


def test_local_login_is_explicitly_disabled(api):
    assert api.get("/api/auth/config").json() == {"enabled": False}
    assert api.get("/api/auth/google").status_code == 404


def test_localhost_http_and_production_https_settings(google, monkeypatch):
    monkeypatch.setenv("TEMPLATE_PUBLIC_ORIGIN", "http://localhost:5173")
    monkeypatch.setenv("TEMPLATE_AUTH_ORIGIN", "http://localhost:8001")
    auth.validate_settings()
    assert not auth.secure_cookie()
    assert auth.callback_url() == "http://localhost:8001/api/auth/google/callback"
    monkeypatch.setenv("TEMPLATE_AUTH_ORIGIN", "http://127.0.0.1:8001")
    with pytest.raises(ValueError): auth.validate_settings()
    monkeypatch.setenv("TEMPLATE_AUTH_ORIGIN", "http://localhost:8001")
    monkeypatch.setenv("TEMPLATE_ENVIRONMENT", "production")
    with pytest.raises(ValueError): auth.validate_settings()


def test_auth_access_logs_redact_codes_and_state():
    record = logging.LogRecord("uvicorn.access", logging.INFO, "", 0, "%s %s %s %s %s",
                               ("127.0.0.1", "GET", auth.CALLBACK + "?code=secret&state=secret", "1.1", 303), None)
    assert auth.AuthAccessLogFilter().filter(record)
    assert record.args[2] == auth.CALLBACK
    assert "secret" not in record.getMessage()


def test_real_startup_google_mode_cors_on_auth_errors(tmp_path):
    """Import with real Google-mode startup config, not a post-start monkeypatch."""
    import os
    import subprocess
    import sys
    from pathlib import Path

    script = """
from app.template_main import app
from fastapi.testclient import TestClient
with TestClient(app) as client:
    response = client.get('/api/access/me', headers={'Origin':'http://localhost:5173'})
    assert response.status_code == 401
    assert response.headers['access-control-allow-origin'] == 'http://localhost:5173'
    assert response.headers['access-control-allow-credentials'] == 'true'
    denied = client.get('/api/access/me', headers={'Origin':'http://evil.example'})
    assert 'access-control-allow-origin' not in denied.headers
    assert client.get('/api/auth/config').json() == {'enabled':True}
    login = client.get('/api/auth/google', follow_redirects=False)
    assert login.status_code == 302
    assert 'HttpOnly' in login.headers['set-cookie'] and 'Secure' not in login.headers['set-cookie']
    assert 'localhost%3A8001' in login.headers['location']
    assert client.get('/docs').status_code == 401
"""
    result = subprocess.run([sys.executable, "-c", script],
        cwd=Path(__file__).resolve().parents[1], capture_output=True, text=True,
        env={**os.environ, "TEMPLATE_ENVIRONMENT": "local", "TEMPLATE_ACCESS_MODE": "google",
             "TEMPLATE_PUBLIC_ORIGIN": "http://localhost:5173", "TEMPLATE_AUTH_ORIGIN": "http://localhost:8001",
             "TEMPLATE_OWNER_EMAIL": "owner@gmail.com", "GOOGLE_CLIENT_ID": "test.apps.googleusercontent.com",
             "GOOGLE_CLIENT_SECRET": "test-only", "TEMPLATE_DATABASE_URL": "sqlite:///" + str(tmp_path / "auth.sqlite")})
    assert result.returncode == 0, result.stderr

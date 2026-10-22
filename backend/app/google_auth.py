"""Application-owned Google OIDC: PKCE, browser-bound state, durable sessions."""

import hashlib
import logging
import os
from datetime import timedelta
from functools import lru_cache
from secrets import compare_digest, token_urlsafe
from urllib.parse import urlsplit

import jwt
from authlib.integrations.httpx_client import OAuth2Client
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse, RedirectResponse
from sqlalchemy import delete
from sqlalchemy.orm import Session

from .deployment import is_cloud
from .template_database import LoginAttempt, LoginSession, engine, now

SESSION_COOKIE = "report_session"
STATE_COOKIE = "report_oauth_browser"
CALLBACK = "/api/auth/google/callback"
PUBLIC_PATHS = {"/api/auth/config", "/api/auth/google", CALLBACK, "/api/auth/logout"}
SESSION_AGE = 8 * 60 * 60
router = APIRouter(prefix="/api/auth")


class AuthAccessLogFilter(logging.Filter):
    def filter(self, record):
        # Authentication codes and signed conversion links must not enter access logs.
        if isinstance(record.args, tuple) and len(record.args) == 5:
            args = list(record.args)
            if isinstance(args[2], str) and args[2].split("?", 1)[0].startswith(("/api/auth/", "/api/word-conversion/")):
                args[2] = args[2].split("?", 1)[0]
                record.args = tuple(args)
        return True


logging.getLogger("uvicorn.access").addFilter(AuthAccessLogFilter())


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def origin(value):
    parsed = urlsplit(value)
    if (not parsed.hostname or parsed.username or parsed.password or parsed.path
            or parsed.query or parsed.fragment):
        raise ValueError("Configure an origin without a path or credentials")
    if parsed.scheme != "https" and not (
        not is_cloud() and parsed.scheme == "http" and parsed.hostname in {"localhost", "127.0.0.1"}
    ):
        raise ValueError("HTTPS required except for explicit localhost development")
    return value


def public_origin():
    return origin(os.environ.get("TEMPLATE_PUBLIC_ORIGIN", ""))


def callback_url():
    # May differ by port during localhost testing, never by host/site.
    target = origin(os.environ.get("TEMPLATE_AUTH_ORIGIN", public_origin()))
    if (urlsplit(target).hostname != urlsplit(public_origin()).hostname
            or urlsplit(target).scheme != urlsplit(public_origin()).scheme):
        raise ValueError("Frontend and authentication must use the same hostname")
    return target + CALLBACK


def secure_cookie():
    return public_origin().startswith("https:")


def validate_settings():
    public_origin()
    callback_url()
    if not os.environ.get("GOOGLE_CLIENT_ID", "").endswith(".apps.googleusercontent.com") or not os.environ.get("GOOGLE_CLIENT_SECRET"):
        raise ValueError("Configure GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET")


def oauth_client():
    return OAuth2Client(
        client_id=os.environ["GOOGLE_CLIENT_ID"],
        client_secret=os.environ["GOOGLE_CLIENT_SECRET"],
        redirect_uri=callback_url(), scope="openid email",
        code_challenge_method="S256", token_endpoint_auth_method="client_secret_post",
        timeout=10,
    )


@lru_cache(maxsize=1)
def google_keys():
    return jwt.PyJWKClient("https://www.googleapis.com/oauth2/v3/certs", lifespan=300, timeout=5)


def verify_id_token(token, nonce):
    if not isinstance(token, str) or len(token) > 16384:
        raise ValueError("Invalid identity token")
    key = google_keys().get_signing_key_from_jwt(token).key
    claims = jwt.decode(token, key, algorithms=["RS256"],
                        audience=os.environ["GOOGLE_CLIENT_ID"],
                        issuer=["https://accounts.google.com", "accounts.google.com"],
                        options={"require": ["exp", "iat", "iss", "aud", "sub", "email", "email_verified", "nonce"]})
    if (claims["email_verified"] is not True or not isinstance(claims["sub"], str)
            or not claims["sub"] or len(claims["sub"]) > 255
            or not isinstance(claims["nonce"], str) or not compare_digest(claims["nonce"], nonce)
            or (claims.get("azp") and claims["azp"] != os.environ["GOOGLE_CLIENT_ID"])):
        raise ValueError("Invalid verified Google identity")
    # Google is not authoritative for recycled third-party non-Workspace emails.
    address = claims["email"]
    if not isinstance(address, str) or not address or not (address.lower().endswith("@gmail.com") or isinstance(claims.get("hd"), str) and claims["hd"]):
        raise ValueError("Use Gmail or a verified Google Workspace account")
    return claims


def session_identity(request):
    token = request.cookies.get(SESSION_COOKIE, "")
    if not token or len(token) > 128:
        raise HTTPException(401, "Sign in with Google to continue")
    with Session(engine()) as db:
        row = db.get(LoginSession, digest(token))
        if row is None or row.expires_at.replace(tzinfo=now().tzinfo) <= now():
            raise HTTPException(401, "Sign in with Google to continue")
        return row.email


def cookie(response, name, value, age, path="/"):
    response.set_cookie(name, value, max_age=age, httponly=True,
                        secure=secure_cookie(), samesite="lax", path=path)


def clear_cookie(response, name, path="/"):
    response.delete_cookie(name, path=path, httponly=True,
                           secure=secure_cookie(), samesite="lax")


@router.get("/config")
def config():
    from .application_access import protected
    return {"enabled": protected()}


@router.get("/google")
def login(request: Request):
    from .application_access import protected
    if not protected():
        raise HTTPException(404, "Google login is not enabled")
    if request.headers.get("Sec-Fetch-Site") == "cross-site":
        raise HTTPException(403, "Start Google sign-in from this application")
    validate_settings()
    state, browser, nonce, verifier = (token_urlsafe(32) for _ in range(4))
    with Session(engine()) as db:
        db.execute(delete(LoginAttempt).where(LoginAttempt.expires_at <= now()))
        db.execute(delete(LoginSession).where(LoginSession.expires_at <= now()))
        previous = request.cookies.get(SESSION_COOKIE, "")
        if previous:
            db.execute(delete(LoginSession).where(LoginSession.token_hash == digest(previous)))
        db.add(LoginAttempt(state_hash=digest(state), browser_hash=digest(browser),
                            nonce=nonce, verifier=verifier, expires_at=now() + timedelta(minutes=10)))
        db.commit()
    with oauth_client() as client:
        url, _ = client.create_authorization_url("https://accounts.google.com/o/oauth2/v2/auth",
                state=state, nonce=nonce, code_verifier=verifier, prompt="select_account")
    response = RedirectResponse(url, status_code=302)
    cookie(response, STATE_COOKIE, browser, 600, "/api/auth")
    clear_cookie(response, SESSION_COOKIE)
    return response


@router.get("/google/callback")
def callback(request: Request):
    from .application_access import protected, role_for, email
    if not protected():
        raise HTTPException(404, "Google login is not enabled")
    validate_settings()
    response = RedirectResponse(public_origin() + "/?auth_error=login_failed", status_code=303)
    try:
        state = request.query_params.get("state", "")
        browser = request.cookies.get(STATE_COOKIE, "")
        code = request.query_params.get("code", "")
        if not state or len(state) > 128 or not browser or len(browser) > 128:
            raise ValueError("Missing login state")
        with Session(engine()) as db:
            attempt = db.get(LoginAttempt, digest(state))
            if attempt is None or not compare_digest(attempt.browser_hash, digest(browser)):
                raise ValueError("Login state does not match browser")
            nonce, verifier = attempt.nonce, attempt.verifier
            # Atomic consume prevents parallel callbacks and replay across processes.
            consumed = db.execute(delete(LoginAttempt).where(
                LoginAttempt.state_hash == digest(state), LoginAttempt.expires_at > now()
            ).returning(LoginAttempt.state_hash).execution_options(synchronize_session=False)).first()
            db.commit()
            if consumed is None or not code or len(code) > 4096 or request.query_params.get("error"):
                raise ValueError("Login expired or cancelled")
        with oauth_client() as client:
            tokens = client.fetch_token("https://oauth2.googleapis.com/token", code=code, code_verifier=verifier)
        claims = verify_id_token(tokens.get("id_token"), nonce)
        address = email(claims["email"])
        role_for(address)  # No registration or implicit grant from Google login.
        token = token_urlsafe(32)
        with Session(engine()) as db:
            previous = request.cookies.get(SESSION_COOKIE, "")
            if previous:
                db.execute(delete(LoginSession).where(LoginSession.token_hash == digest(previous)))
            db.add(LoginSession(token_hash=digest(token), subject=claims["sub"], email=address,
                                expires_at=now() + timedelta(seconds=SESSION_AGE)))
            db.commit()
        response = RedirectResponse(public_origin() + "/", status_code=303)
        cookie(response, SESSION_COOKIE, token, SESSION_AGE)
    except HTTPException as error:
        if error.status_code == 403:
            response = RedirectResponse(public_origin() + "/?auth_error=not_approved", status_code=303)
    except Exception as error:
        # Tokens, codes, provider errors and secrets must never be returned/logged.
        logging.getLogger(__name__).warning("Google sign-in failed (%s)", type(error).__name__)
    clear_cookie(response, STATE_COOKIE, "/api/auth")
    return response


@router.post("/logout")
def logout(request: Request):
    from .application_access import protected
    if not protected():
        return JSONResponse({"ok": True})
    if request.headers.get("Origin") != public_origin() or request.headers.get("Sec-Fetch-Site") == "cross-site":
        raise HTTPException(403, "Cross-site writes are not allowed")
    with Session(engine()) as db:
        db.execute(delete(LoginSession).where(LoginSession.token_hash == digest(request.cookies.get(SESSION_COOKIE, ""))))
        db.commit()
    response = JSONResponse({"ok": True})
    clear_cookie(response, SESSION_COOKIE)
    clear_cookie(response, STATE_COOKIE, "/api/auth")
    return response

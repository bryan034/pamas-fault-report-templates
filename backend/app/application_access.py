"""Verified identity and application-wide authorization; never trust browser roles."""

import os
import re
from functools import lru_cache
from secrets import compare_digest
from typing import Literal
from urllib.parse import urlsplit

import jwt
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, field_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from .deployment import is_cloud
from .template_database import ApplicationUser, engine, get_db


def email(value: str) -> str:
    value = value.strip().lower()
    if len(value) > 254 or not re.fullmatch(
        r"[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}",
        value,
    ):
        raise ValueError("Enter a valid email address")
    return value


def protected() -> bool:
    mode = os.environ.get("TEMPLATE_ACCESS_MODE", "local")
    if mode not in {"local", "cloudflare"}:
        raise ValueError("TEMPLATE_ACCESS_MODE must be local or cloudflare")
    return is_cloud() or mode == "cloudflare"


def issuer() -> str:
    domain = os.environ.get("ACCESS_TEAM_DOMAIN", "")
    if not re.fullmatch(
        r"[a-z0-9][a-z0-9-]*\.cloudflareaccess\.com", domain
    ) or not re.fullmatch(r"[a-f0-9]{64}", os.environ.get("ACCESS_AUD", "")):
        raise ValueError("Configure the Access team domain and application AUD")
    return f"https://{domain}"


def validate_settings():
    if not protected():
        return
    email(os.environ.get("TEMPLATE_OWNER_EMAIL", ""))
    if not is_cloud():
        issuer()
        origin = urlsplit(os.environ.get("TEMPLATE_PUBLIC_ORIGIN", ""))
        if (
            origin.scheme != "https"
            or not origin.hostname
            or origin.username
            or origin.password
            or origin.path
            or origin.query
            or origin.fragment
        ):
            raise ValueError(
                "Configure TEMPLATE_PUBLIC_ORIGIN as an HTTPS origin without a path"
            )


@lru_cache(maxsize=4)
def keys(url):
    # The URL comes exclusively from validated configuration, never a JWT header.
    return jwt.PyJWKClient(f"{url}/cdn-cgi/access/certs", lifespan=300, timeout=5)


def identity(request: Request) -> dict:
    if not protected():
        return {"mode": "local", "email": None, "role": "editor"}
    validate_settings()
    if is_cloud():
        # Only the private Worker gateway may assert an identity in cloud mode.
        expected = os.environ.get("TEMPLATE_SERVICE_TOKEN", "")
        supplied = request.headers.get("X-Template-Service-Token", "")
        if len(expected) < 32 or not compare_digest(
            expected.encode(), supplied.encode()
        ):
            raise HTTPException(401, "Service authentication required")
        asserted = request.headers.get("X-Template-User-Email", "")
    else:
        token = request.headers.get("Cf-Access-Jwt-Assertion", "")
        if not token or len(token) > 16384:
            raise HTTPException(401, "Cloudflare sign-in required")
        try:
            url = issuer()
            key = keys(url).get_signing_key_from_jwt(token).key
            claims = jwt.decode(
                token,
                key,
                algorithms=["RS256"],
                issuer=url,
                audience=os.environ["ACCESS_AUD"],
                options={"require": ["exp", "iat", "sub", "email", "iss", "aud"]},
            )
            asserted = claims["email"]
        except jwt.PyJWKClientConnectionError as error:
            raise HTTPException(
                503, "Identity verification is temporarily unavailable"
            ) from error
        except (jwt.PyJWTError, ValueError, TypeError) as error:
            raise HTTPException(401, "Cloudflare sign-in required") from error
    try:
        address = email(asserted)
    except (ValueError, TypeError, AttributeError) as error:
        raise HTTPException(401, "A verified user email is required") from error
    if address == email(os.environ["TEMPLATE_OWNER_EMAIL"]):
        role = "owner"
    else:
        # Read on every request: revocation does not wait for JWT expiry.
        with Session(engine()) as db:
            grant = db.get(ApplicationUser, address)
            role = grant.role if grant else None
        if role not in {"editor", "viewer"}:
            raise HTTPException(403, "Ask the application owner to grant access")
    return {"mode": "cloudflare", "email": address, "role": role}


def owner(request: Request):
    user = request.state.application_user
    if user["role"] != "owner":
        raise HTTPException(403, "Only the configured owner can manage access")
    return user


class Grant(BaseModel):
    email: str
    role: Literal["editor", "viewer"]

    @field_validator("email")
    @classmethod
    def valid_email(cls, value):
        return email(value)


router = APIRouter(prefix="/api/access")


@router.get("/me")
def me(request: Request):
    return request.state.application_user


@router.get("/users")
def users(user=Depends(owner), db: Session = Depends(get_db)):
    return {
        "owner": user["email"],
        "users": [
            {
                "email": row.email,
                "role": row.role,
                "updated_at": row.updated_at.isoformat(),
            }
            for row in db.scalars(
                select(ApplicationUser).order_by(ApplicationUser.email)
            )
            if row.email != user["email"]
        ],
    }


@router.put("/users")
def grant(payload: Grant, user=Depends(owner), db: Session = Depends(get_db)):
    if payload.email == user["email"]:
        raise HTTPException(
            422, "The owner is configured by environment, not by a grant"
        )
    row = db.get(ApplicationUser, payload.email)
    if row is None:
        row = ApplicationUser(email=payload.email)
        db.add(row)
    row.role, row.updated_by = payload.role, user["email"]
    db.commit()
    return {"email": row.email, "role": row.role}


@router.delete("/users/{address:path}", status_code=204)
def revoke(address: str, user=Depends(owner), db: Session = Depends(get_db)):
    if address.lower() == user["email"]:
        raise HTTPException(422, "The configured owner cannot be removed")
    row = db.get(ApplicationUser, address.lower())
    if row:
        db.delete(row)
        db.commit()

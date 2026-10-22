"""Verified identity and application-wide authorization; never trust browser roles."""

import os
import re
from typing import Literal
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, field_validator
from sqlalchemy import select, delete
from sqlalchemy.orm import Session

from .deployment import is_cloud
from .template_database import ApplicationUser, LoginSession, engine, get_db
from . import google_auth


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
    if mode not in {"local", "google"}:
        raise ValueError("TEMPLATE_ACCESS_MODE must be local or google")
    if is_cloud() and mode != "google":
        raise ValueError("Cloud deployments require TEMPLATE_ACCESS_MODE=google")
    return mode == "google"


def validate_settings():
    if not protected():
        return
    email(os.environ.get("TEMPLATE_OWNER_EMAIL", ""))
    google_auth.validate_settings()


def identity(request: Request) -> dict:
    if not protected():
        return {"mode": "local", "email": None, "role": "editor"}
    validate_settings()
    address = google_auth.session_identity(request)
    return {"mode": "google", "email": address, "role": role_for(address)}


def role_for(address: str) -> str:
    if address == email(os.environ["TEMPLATE_OWNER_EMAIL"]):
        role = "owner"
    else:
        # Read on every request: revocation does not wait for JWT expiry.
        with Session(engine()) as db:
            grant = db.get(ApplicationUser, address)
            role = grant.role if grant else None
        if role not in {"editor", "viewer"}:
            raise HTTPException(403, "Ask the application owner to grant access")
    return role


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
    db.execute(delete(LoginSession).where(LoginSession.email == address.lower()))
    db.commit()

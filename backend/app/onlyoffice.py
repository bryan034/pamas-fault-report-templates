"""Headless DOCX-to-PDF conversion only; no browser Word editor or save callbacks.

Sources live briefly in PostgreSQL so a different backend instance can serve them.
Only one expiring, signed GET route bypasses normal browser authentication.
"""
import os
import re
import threading
import time
from datetime import timedelta
from urllib.parse import urlencode, urlsplit
from uuid import uuid4

import httpx
import jwt
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response
from sqlalchemy import delete
from sqlalchemy.orm import Session

from .template_database import WordConversionSource, engine, get_db, now
from .word_conversion import DOCX_MIME, MAX_UPLOAD, ConverterUnavailable, validate_docx

router = APIRouter(prefix="/api/word-conversion")
SOURCE_PATH = re.compile(r"^/api/word-conversion/[a-f0-9-]{36}/source$")
_slots = threading.BoundedSemaphore(2)


def bridge_request(request: Request):
    return request.method == "GET" and SOURCE_PATH.fullmatch(request.url.path) is not None


def native(template):
    """Identify stored Word documents that need field-box conversion."""
    return template.definition.get("editor_kind") == "native-docx"


def settings():
    secret = os.environ.get("ONLYOFFICE_JWT_SECRET", "")
    if len(secret) < 32:
        raise ConverterUnavailable("Word conversion requires ONLYOFFICE_JWT_SECRET (at least 32 characters). Recreate the services with docker compose up -d.")
    urls = {}
    for name in ("ONLYOFFICE_INTERNAL_URL", "ONLYOFFICE_CALLBACK_BASE"):
        value = os.environ.get(name, "").rstrip("/")
        parsed = urlsplit(value)
        if (parsed.scheme not in {"http", "https"} or not parsed.netloc
                or parsed.username or parsed.password or parsed.path or parsed.query or parsed.fragment):
            raise ConverterUnavailable(f"Set {name} to the trusted service origin without a path")
        urls[name] = value
    return secret, urls


def purge_expired(db):
    db.execute(delete(WordConversionSource).where(WordConversionSource.expires_at <= now()))


@router.get("/{source_id}/source")
def source(source_id: str, token: str, db: Session = Depends(get_db)):
    try:
        secret, _ = settings()
        claims = jwt.decode(token, secret, algorithms=["HS256"], audience="word-conversion",
                            options={"require": ["exp", "sub", "purpose"]})
    except (jwt.InvalidTokenError, ConverterUnavailable) as error:
        raise HTTPException(401, "Invalid or expired conversion link") from error
    if claims["sub"] != source_id or claims["purpose"] != "source":
        raise HTTPException(403, "This link does not authorize this source")
    row = db.get(WordConversionSource, source_id)
    if row is None:
        raise HTTPException(404, "Conversion source expired or finished")
    expiry = row.expires_at
    if expiry.tzinfo is None:
        from datetime import timezone
        expiry = expiry.replace(tzinfo=timezone.utc)
    if expiry <= now():
        raise HTTPException(404, "Conversion source expired or finished")
    return Response(row.payload, media_type=DOCX_MIME, headers={"Cache-Control": "no-store"})


def output_url(value, origin):
    if not isinstance(value, str):
        raise ValueError("Word converter did not return a PDF download URL")
    parsed = urlsplit(value)
    if (f"{parsed.scheme}://{parsed.netloc}" != origin or parsed.username or parsed.password
            or parsed.fragment or not parsed.path.startswith("/cache/files/")
            or ".." in parsed.path or "%" in parsed.path):
        raise ValueError("Unexpected Word conversion download URL")
    return value


def request_pdf(payload):
    """Use the renderer that preserves the supplied two-page sample's pagination."""
    validate_docx(payload)
    secret, urls = settings()
    if not _slots.acquire(timeout=15):
        raise ConverterUnavailable("Word converter is busy; try again shortly")
    identifier = str(uuid4())
    try:
        with Session(engine()) as db:
            purge_expired(db)
            db.add(WordConversionSource(id=identifier, payload=payload, expires_at=now() + timedelta(minutes=15)))
            db.commit()
        cap = jwt.encode({"aud": "word-conversion", "sub": identifier, "purpose": "source",
                          "exp": int(time.time()) + 900}, secret, algorithm="HS256")
        url = urls["ONLYOFFICE_CALLBACK_BASE"] + f"/api/word-conversion/{identifier}/source?" + urlencode({"token": cap})
        job = {"async": False, "filetype": "docx", "outputtype": "pdf", "key": identifier,
               "title": "template.docx", "url": url}
        signed = jwt.encode(job, secret, algorithm="HS256")
        try:
            with httpx.Client(timeout=httpx.Timeout(330, connect=10), follow_redirects=False, trust_env=False) as client:
                result = client.post(urls["ONLYOFFICE_INTERNAL_URL"] + "/converter",
                                     json={**job, "token": signed})
                result.raise_for_status()
                result = result.json()
                if not isinstance(result, dict) or not result.get("endConvert") or not result.get("fileUrl"):
                    raise ConverterUnavailable("Word conversion failed. Check the document-server health and retry.")
                data = bytearray()
                with client.stream("GET", output_url(result["fileUrl"], urls["ONLYOFFICE_INTERNAL_URL"])) as response:
                    response.raise_for_status()
                    for chunk in response.iter_bytes(chunk_size=64 * 1024):
                        data.extend(chunk)
                        if len(data) > MAX_UPLOAD:
                            raise ValueError("Converted PDF exceeds the 20 MB limit")
        except (httpx.HTTPError, httpx.InvalidURL) as error:
            raise ConverterUnavailable("The Word converter is unavailable. Wait for ONLYOFFICE to become healthy and retry.") from error
        pdf = bytes(data)
        if not pdf.startswith(b"%PDF-"):
            raise ValueError("Word converter did not produce a valid PDF")
        from .template_pdf import inspect_pdf
        inspect_pdf(pdf)
        return pdf
    finally:
        try:
            with Session(engine()) as db:
                db.execute(delete(WordConversionSource).where(WordConversionSource.id == identifier))
                db.commit()
        finally:
            _slots.release()

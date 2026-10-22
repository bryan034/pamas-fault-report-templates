"""Headless Word conversion, field-box workflow and trial-template recovery."""
import time
from datetime import timedelta
from urllib.parse import urlsplit

import httpx
import jwt
import pytest
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import onlyoffice, template_main, template_versions as versions
from app.template_database import Template, TemplateSource, WordDocument, WordConversionSource, engine, now
from app.word_conversion import docx_to_pdf, DOCX_MIME, ConverterUnavailable
from test_word_templates import sample_word
from test_templates import sample_pdf, definition

SECRET = "conversion-test-secret-not-for-real-deployment"
ORIGINAL = sample_word()
PDF = sample_pdf()
HTTP_CLIENT = httpx.Client


@pytest.fixture
def converter(api, monkeypatch):
    monkeypatch.setenv("WORD_CONVERSION_ENGINE", "onlyoffice")
    monkeypatch.setenv("ONLYOFFICE_JWT_SECRET", SECRET)
    monkeypatch.setenv("ONLYOFFICE_INTERNAL_URL", "http://onlyoffice")
    monkeypatch.setenv("ONLYOFFICE_CALLBACK_BASE", "http://template-service:8000")
    observed = []
    def handle(request):
        if request.method == "POST":
            import json
            body = json.loads(request.content)
            signed = jwt.decode(body["token"], SECRET, algorithms=["HS256"])
            assert signed["filetype"] == "docx" and signed["outputtype"] == "pdf"
            source = urlsplit(signed["url"])
            response = api.get(source.path + "?" + source.query)
            assert response.status_code == 200, response.text
            observed.append(response.content)
            return httpx.Response(200, json={"endConvert": True, "fileUrl": "http://onlyoffice/cache/files/test/output.pdf"})
        return httpx.Response(200, content=PDF)
    monkeypatch.setattr(onlyoffice.httpx, "Client", lambda **kwargs: HTTP_CLIENT(transport=httpx.MockTransport(handle), **kwargs))
    return api, observed


def test_conversion_uses_signed_source_and_removes_temporary_bytes(converter):
    api, observed = converter
    assert docx_to_pdf(ORIGINAL) == PDF
    assert observed == [ORIGINAL]
    with Session(engine()) as db:
        assert list(db.scalars(select(WordConversionSource))) == []


def test_word_upload_returns_overlay_definition_not_native_editor(converter):
    api, _ = converter
    files = {"pdf": ("template.docx", ORIGINAL, DOCX_MIME)}
    analysis = api.post("/api/templates/analyze", files=files)
    assert analysis.status_code == 200, analysis.text
    assert len(analysis.json()["definition"]["pages"]) == 2
    assert analysis.json()["render_pdf"]
    saved = api.post("/api/templates", files=files, data={"title": "Overlay Word", "definition_json": definition().model_dump_json()})
    assert saved.status_code == 200, saved.text
    template = saved.json()
    assert template["editor_kind"] == "pdf" and template["source_format"] == "docx"
    assert api.get(f'/api/templates/{template["id"]}/original').content == ORIGINAL
    for path in ["/api/word/templates", "/api/word/documents/anything/config"]:
        assert api.get(path).status_code == 404


def test_converter_failure_never_falls_back_to_libreoffice(converter, monkeypatch):
    api, _ = converter
    def broken(**kwargs): raise httpx.ConnectError("offline")
    monkeypatch.setattr(onlyoffice.httpx, "Client", broken)
    with pytest.raises(ConverterUnavailable, match="unavailable"):
        docx_to_pdf(ORIGINAL)
    with Session(engine()) as db:
        assert list(db.scalars(select(WordConversionSource))) == []


@pytest.mark.parametrize("url", ["http://169.254.169.254/cache/files/x", "http://onlyoffice.evil/cache/files/x", "http://onlyoffice/admin", "http://onlyoffice/cache/files/%2e%2e/x", "http://onlyoffice/cache/files/../x", None])
def test_conversion_download_rejects_untrusted_urls(url):
    with pytest.raises(ValueError): onlyoffice.output_url(url, "http://onlyoffice")


def test_source_links_are_document_specific_and_expire(converter):
    api, _ = converter
    identifier = "12345678-1234-1234-1234-123456789012"
    with Session(engine()) as db:
        db.add(WordConversionSource(id=identifier, payload=ORIGINAL, expires_at=now() + timedelta(minutes=1)))
        db.commit()
    def token(**changes):
        return jwt.encode({"aud": "word-conversion", "sub": identifier, "purpose": "source", "exp": int(time.time()) + 60, **changes}, SECRET, algorithm="HS256")
    path = f"/api/word-conversion/{identifier}/source"
    assert api.get(path, params={"token": token()}).content == ORIGINAL
    assert api.get(path, params={"token": "forged"}).status_code == 401
    assert api.get(path, params={"token": token(exp=int(time.time())-1)}).status_code == 401
    assert api.get(path, params={"token": token(sub="another-document")}).status_code == 403
    assert api.get(path, params={"token": token(purpose="callback")}).status_code == 403
    with Session(engine()) as db:
        db.get(WordConversionSource, identifier).expires_at = now() - timedelta(seconds=1)
        db.commit()
    assert api.get(path, params={"token": token()}).status_code == 404


def test_only_signed_source_get_bypasses_cloud_transport_check(converter, monkeypatch):
    api, _ = converter
    monkeypatch.setattr(template_main, "is_cloud", lambda: True)
    monkeypatch.setenv("TEMPLATE_SERVICE_TOKEN", "transport-secret-that-is-at-least-32-characters")
    assert api.get("/api/word-conversion/12345678-1234-1234-1234-123456789012/source?token=bad").status_code == 401
    assert api.post("/api/word-conversion/12345678-1234-1234-1234-123456789012/source").status_code == 401
    assert api.get("/api/templates").status_code == 401


def test_recover_native_trial_template_without_overwriting_original(converter):
    api, _ = converter
    with Session(engine()) as db:
        template = Template(id="trial", title="Keep my title", definition={**definition().model_dump(mode="json"), "editor_kind": "native-docx"}, source_pdf=b"", blank_pdf=b"", thumbnail=b"")
        db.add(template); db.flush()
        old = versions.snapshot(db, template, 1)
        old_id = old.id
        db.add(TemplateSource(revision_id=old.id, filename="original.docx", format="docx", payload=ORIGINAL))
        db.add(WordDocument(id="trial", template_id="trial", payload=ORIGINAL))
        db.commit()
    result = api.post("/api/templates/trial/restore-overlay")
    assert result.status_code == 200, result.text
    assert result.json()["title"] == "Keep my title"
    assert result.json()["editor_kind"] == "pdf" and result.json()["page_count"] == 2
    with Session(engine()) as db:
        assert db.get(TemplateSource, old_id).payload == ORIGINAL
        assert db.get(WordDocument, "trial").payload == ORIGINAL
    assert api.get("/api/templates/trial/original").content == ORIGINAL
    assert api.get("/api/templates/trial/background").content.startswith(b"%PDF-")
    assert api.post("/api/templates/trial/restore-overlay").json()["revision_id"] == result.json()["revision_id"]


@pytest.mark.parametrize("paint", ["P1", ("P1",), (1.0, "SpotColor"), ()])
def test_word_pattern_colours_do_not_break_overlay_detection(paint):
    from types import SimpleNamespace
    from app.template_pdf import _needs_cover
    page = SimpleNamespace(images=[], rects=[{"x0": 0, "top": 0, "x1": 100, "bottom": 100, "fill": True, "non_stroking_color": paint}])
    assert _needs_cover(page, (10, 10, 90, 90)) is False


def test_signed_conversion_query_is_redacted_from_access_logs():
    import logging
    from app.google_auth import AuthAccessLogFilter
    record = logging.LogRecord("uvicorn.access", logging.INFO, "", 0, "%s %s %s %s %s",
                               ("127.0.0.1", "GET", "/api/word-conversion/id/source?token=private", "1.1", 200), None)
    AuthAccessLogFilter().filter(record)
    assert record.args[2] == "/api/word-conversion/id/source"
    assert "private" not in record.getMessage()

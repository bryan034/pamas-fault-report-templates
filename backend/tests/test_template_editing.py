"""Regression checks for immutable revisions, archives, page shapes and crop rules."""

import json
from io import BytesIO
from uuid import uuid4

import pypdfium2 as pdfium
import pytest
from pydantic import ValidationError
from pypdf import PdfReader

from test_audit import create_shared, image_bytes
from test_templates import definition, sample_pdf
from app import (
    template_database,
    template_versions,
    preview_assets,
)
from app.template_models import TemplateDefinition, TemplateReport
from app.template_pdf import clean_pdf, generate_pdf
from sqlalchemy.orm import Session


def test_startup_backfill_preserves_legacy_reports_and_is_idempotent(api):
    template_id, draft_id = str(uuid4()), str(uuid4())
    schema = definition()
    source = sample_pdf()
    blank, thumbnail = clean_pdf(source, schema)
    with Session(template_database.engine()) as db:
        db.add(
            template_database.Template(
                id=template_id,
                title="Legacy",
                definition=schema.model_dump(mode="json"),
                source_pdf=source,
                blank_pdf=blank,
                thumbnail=thumbnail,
            )
        )
        db.flush()
        db.add(
            template_database.Draft(
                id=draft_id,
                template_id=template_id,
                title="Legacy report",
                form={"title": "Legacy report", "values": {"company": "Acme"}},
            )
        )
        db.flush()
        db.add(
            template_database.DraftImage(
                draft_id=draft_id,
                field_id="photo",
                payload=image_bytes(),
                filename="legacy.png",
                media_type="image/png",
            )
        )
        db.commit()
    with Session(template_database.engine()) as db:
        template_versions.bootstrap(db)
    base = "/api/templates/" + template_id
    first = api.get(base).json()
    assert first["revision_number"] == 1
    assert (
        api.get(base + "/drafts/" + draft_id).json()["revision_id"]
        == first["revision_id"]
    )
    assert (
        api.get(base + "/drafts/" + draft_id + "/images/photo").content == image_bytes()
    )
    with Session(template_database.engine()) as db:
        template_versions.bootstrap(db)
    assert api.get(base).json()["revision_id"] == first["revision_id"]
    assert (
        api.get(base + "/drafts/" + draft_id).json()["form"]["values"]["company"]
        == "Acme"
    )
    assert api.get(base + "/source").content == source


def test_revisions_pin_legacy_and_new_drafts_without_losing_images(api):
    base = create_shared(api)
    original = api.get(base).json()
    report = {"title": "Original", "values": {"company": "Acme"}}
    draft = api.post(
        base + "/drafts",
        data={"report_json": json.dumps(report)},
        files={"images": ("photo.png", image_bytes(), "image/png")},
        params={},
    )
    # Uploads always need an explicit image-field association.
    assert draft.status_code == 422
    draft = api.post(
        base + "/drafts",
        data={"report_json": json.dumps(report), "image_fields": '["photo"]'},
        files={"images": ("photo.png", image_bytes(), "image/png")},
    ).json()
    # Simulate a pre-upgrade draft lacking a binding. The edit must pin it first.
    with Session(template_database.engine()) as db:
        db.delete(db.get(template_database.DraftRevision, draft["id"]))
        db.commit()
    changed = definition().model_dump()
    changed["fields"][0].update(
        id="new_company", label="Changed company", font="Helvetica", color="#006600"
    )
    result = api.put(
        base,
        data={
            "title": "Revised",
            "definition_json": json.dumps(changed),
            "reviewed": "true",
            "expected_revision_id": original["revision_id"],
        },
    )
    assert result.status_code == 200, result.text
    latest = result.json()
    assert (
        latest["revision_number"] == 2
        and latest["revision_id"] != original["revision_id"]
    )
    assert (
        api.get(base + "?draft_id=" + draft["id"]).json()["definition"]["fields"][0][
            "id"
        ]
        == "company"
    )
    assert api.get(base).json()["definition"]["fields"][0]["id"] == "new_company"
    assert api.get(base + "/drafts").json()["drafts"][0]["company"] == "Acme"
    assert (
        api.get(base + "/drafts/" + draft["id"] + "/images/photo").content
        == image_bytes()
    )
    assert (
        api.put(
            base + "/drafts/" + draft["id"], data={"report_json": json.dumps(report)}
        ).status_code
        == 200
    )
    assert (
        api.post(base + "/drafts", data={"report_json": json.dumps(report)}).status_code
        == 422
    )
    new = api.post(
        base + "/drafts",
        data={
            "report_json": json.dumps(
                {"title": "New", "values": {"new_company": "Beta"}}
            )
        },
    ).json()
    assert new["revision_id"] == latest["revision_id"]
    old_pdf = api.post(
        base + "/generate",
        data={
            "report_json": json.dumps(report),
            "revision_id": original["revision_id"],
        },
    )
    assert (
        old_pdf.status_code == 200
        and "Acme" in PdfReader(BytesIO(old_pdf.content)).pages[0].extract_text()
    )
    assert (
        api.put(
            base,
            data={
                "title": "Stale",
                "definition_json": json.dumps(changed),
                "reviewed": "true",
                "expected_revision_id": original["revision_id"],
            },
        ).status_code
        == 409
    )
    assert api.get(base + "/definition").status_code == 404


def test_archive_restore_retains_reports_and_blocks_new_work(api):
    base = create_shared(api)
    draft = api.post(
        base + "/drafts", data={"report_json": '{"title":"Retained"}'}
    ).json()
    assert api.delete(base).status_code == 204
    assert api.delete(base).status_code == 204
    assert api.get("/api/templates").json()["templates"] == []
    assert (
        api.get("/api/templates?archived=true").json()["templates"][0]["id"]
        == base.split("/")[-1]
    )
    assert api.get(base + "/drafts/" + draft["id"]).status_code == 200
    assert (
        api.put(
            base + "/drafts/" + draft["id"],
            data={"report_json": '{"title":"Still editable"}'},
        ).status_code
        == 200
    )
    assert (
        api.post(
            base + "/drafts", data={"report_json": '{"title":"Blocked"}'}
        ).status_code
        == 409
    )
    assert api.post(base + "/restore").status_code == 200
    assert api.get("/api/templates").json()["templates"]


def test_shapes_render_on_empty_page_without_any_photo():
    template = definition()
    blank, _ = clean_pdf(sample_pdf(), template)
    form = TemplateReport(
        rectangles=[
            {
                "id": "box",
                "page": 1,
                "x": 0.5,
                "y": 0.5,
                "width": 0.2,
                "height": 0.2,
                "color": "#ff0000",
                "stroke_width": 4,
            },
            {
                "id": "tick",
                "page": 1,
                "kind": "tick",
                "x": 0.2,
                "y": 0.5,
                "width": 0.1,
                "height": 0.1,
                "color": "#00aa00",
                "stroke_width": 3,
            },
        ]
    )
    payload = generate_pdf(blank, template, form, {})
    document = pdfium.PdfDocument(payload)
    image = document[1].render(scale=1).to_pil().convert("RGB")
    reds = sum(1 for r, g, b in image.getdata() if r > 150 and g < 100 and b < 100)
    greens = sum(1 for r, g, b in image.getdata() if g > 80 and r < 100 and b < 100)
    assert reds > 300 and greens > 50
    document.close()
    with pytest.raises(ValueError):
        TemplateReport(
            rectangles=[
                {"id": "x", "page": 99, "x": 0, "y": 0, "width": 0.1, "height": 0.1}
            ]
        ).validate_for(template)


def test_crop_rules_validation_confirmation_and_persistence(api):
    data = definition().model_dump()
    data["ocr_mappings"] = []
    data["extractions"] = [
        {
            "id": "temperature",
            "name": "Fault temperature",
            "image_field": "photo",
            "target_field": "temp",
            "region": {"x": 0.1, "y": 0.1, "width": 0.3, "height": 0.1},
        }
    ]
    model = TemplateDefinition.model_validate(data)
    base = create_shared(api, model)
    report = {
        "title": "Crop report",
        "values": {"temp": "43.7"},
        "extraction_values": {"temperature": "43.7"},
    }
    multipart = {"report_json": json.dumps(report), "image_fields": '["photo"]'}
    files = {"images": ("x.png", image_bytes(), "image/png")}
    assert api.post(base + "/generate", data=multipart, files=files).status_code == 200
    report["readings_confirmed"] = {"photo": True}
    multipart["report_json"] = json.dumps(report)
    draft = api.post(base + "/drafts", data=multipart, files=files).json()
    assert (
        api.get(base + "/drafts/" + draft["id"]).json()["form"]["extraction_values"][
            "temperature"
        ]
        == "43.7"
    )
    assert api.post(base + "/generate", data=multipart, files=files).status_code == 200
    data["extractions"][0]["image_field"] = "company"
    with pytest.raises(ValidationError):
        TemplateDefinition.model_validate(data)


def test_preview_asset_tokens_are_scoped_expire_and_use_no_repeat_uploads(
    api, monkeypatch
):
    base = create_shared(api)
    revision = api.get(base).json()["revision_id"]
    token = api.post(
        base + "/preview-assets",
        data={"revision_id": revision, "image_fields": '["photo"]'},
        files={"images": ("x.png", image_bytes(), "image/png")},
    ).json()["token"]
    cached = api.post(
        base + "/preview",
        data={"report_json": "{}", "revision_id": revision, "asset_token": token},
    )
    assert cached.status_code == 200 and list(
        PdfReader(BytesIO(cached.content)).pages[0].images
    )
    other = create_shared(api)
    assert (
        api.post(
            other + "/preview", data={"report_json": "{}", "asset_token": token}
        ).status_code
        == 409
    )
    monkeypatch.setattr(preview_assets, "monotonic", lambda: 10**12)
    assert (
        api.post(
            base + "/preview",
            data={"report_json": "{}", "revision_id": revision, "asset_token": token},
        ).status_code
        == 409
    )

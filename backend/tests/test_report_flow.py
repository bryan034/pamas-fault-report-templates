"""Stateless trials, transparent layers, report styles and value-free defaults."""

import base64
import json
from io import BytesIO
from pypdf import PdfReader
import pypdfium2 as pdfium
from sqlalchemy import select, func
from sqlalchemy.orm import Session
from test_audit import create_shared, image_bytes
from test_templates import definition, sample_pdf
from app import template_database as tables
from app.template_pdf import clean_pdf


def test_trial_without_database_writes(api):
    schema = definition()
    blank, _ = clean_pdf(sample_pdf(), schema)
    models = [tables.Template, tables.Draft, tables.DraftImage, tables.TemplateRevision]
    with Session(tables.engine()) as db:
        before = [
            db.scalar(select(func.count()).select_from(model)) for model in models
        ]
    report = {
        "title": "Trial",
        "values": {"company": "Never saved"},
        "styles": {
            "company": {"font": "Helvetica-Bold", "font_size": 12, "color": "#00aa00"}
        },
    }
    response = api.post(
        "/api/template-try-report",
        data={
            "definition_json": schema.model_dump_json(),
            "report_json": json.dumps(report),
        },
        files={"pdf": ("blank.pdf", blank, "application/pdf")},
    )
    assert response.status_code == 200, response.text
    result = response.json()
    assert result["fields"] == ["company"]
    pdf = PdfReader(BytesIO(base64.b64decode(result["pdf"])))
    assert len(pdf.pages) == 1 and "Never saved" in pdf.pages[0].extract_text()
    assert "OLD SAMPLE" not in pdf.pages[0].extract_text()
    with Session(tables.engine()) as db:
        assert before == [
            db.scalar(select(func.count()).select_from(model)) for model in models
        ]


def test_transparent_layers_saved_styles_and_photo_download(api):
    base = create_shared(api)
    report = {
        "title": "Styled draft",
        "values": {"company": "Styled Company", "temp": "43"},
        "styles": {
            "company": {"font": "Helvetica-Bold", "font_size": 12, "color": "#00aa00"}
        },
    }
    data = {
        "report_json": json.dumps(report),
        "image_fields": '["photo"]',
        "layered": "true",
    }
    files = {"images": ("photo.png", image_bytes(), "image/png")}
    response = api.post(base + "/preview", data=data, files=files)
    assert response.status_code == 200, response.text
    result = response.json()
    assert result["fields"] == ["company", "photo", "temp"]
    layer = pdfium.PdfDocument(base64.b64decode(result["pdf"]))
    image = layer[0].render(scale=2, fill_color=(0, 0, 0, 0)).to_pil().convert("RGBA")
    pixels = list(image.getdata())
    assert any(alpha == 0 for _, _, _, alpha in pixels)
    assert any(
        g > 100 and r < 70 and b < 70 and alpha > 200 for r, g, b, alpha in pixels
    )
    layer.close()
    draft = api.post(base + "/drafts", data=data, files=files).json()
    assert (
        api.get(base + "/drafts/" + draft["id"]).json()["form"]["styles"]["company"][
            "font"
        ]
        == "Helvetica-Bold"
    )
    exported = api.get(base + "/drafts/" + draft["id"] + "/pdf")
    assert exported.status_code == 200, exported.text
    pdf = PdfReader(BytesIO(exported.content))
    assert "Styled Company" in pdf.pages[0].extract_text()
    assert pdf.metadata.title == "Styled draft" and len(pdf.pages[0].images) > 0
    assert "Styled draft.pdf" in exported.headers["content-disposition"]
    report["styles"]["company"]["font_size"] = 100
    assert (
        api.post(
            base + "/preview", data={"report_json": json.dumps(report)}
        ).status_code
        == 422
    )


def test_future_configuration_contains_no_values_and_preserves_old_drafts(api):
    base = create_shared(api)
    original = api.get(base).json()
    draft = api.post(
        base + "/drafts",
        data={
            "report_json": '{"title":"Old job", "values":{"company":"PRIVATE VALUE"}}'
        },
    ).json()
    payload = {
        "expected_revision_id": original["revision_id"],
        "layout": {
            "company": {"page": 0, "x": 0.2, "y": 0.2, "width": 0.4, "height": 0.1}
        },
        "font_sizes": {"company": 22},
    }
    assert (
        api.post(
            base + "/report-defaults",
            json={**payload, "values": {"company": "PRIVATE VALUE"}},
        ).status_code
        == 422
    )
    result = api.post(base + "/report-defaults", json=payload)
    assert result.status_code == 200, result.text
    current = result.json()
    field = current["definition"]["fields"][0]
    assert field["x"] == 0.2 and field["font_size"] == 22
    assert field["font"] == original["definition"]["fields"][0]["font"]
    assert all(
        item["suggested_value"] == "" for item in current["definition"]["fields"]
    )
    old = api.get(base + "?draft_id=" + draft["id"]).json()
    assert (
        old["revision_id"] == original["revision_id"]
        and old["definition"]["fields"][0]["font_size"] == 16
    )
    new = api.post(base + "/drafts", data={"report_json": '{"title":"New job"}'}).json()
    assert new["revision_id"] == current["revision_id"] and new["form"]["values"] == {}
    assert api.post(base + "/report-defaults", json=payload).status_code == 409
    assert (
        "PRIVATE VALUE"
        in PdfReader(BytesIO(api.get(base + "/drafts/" + draft["id"] + "/pdf").content))
        .pages[0]
        .extract_text()
    )



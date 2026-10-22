"""Expanded checker coverage. Known defects are explicit strict expected failures."""

import asyncio
import json
import os
from copy import deepcopy
from io import BytesIO

import pytest
from fastapi import HTTPException, UploadFile
from PIL import Image
from pydantic import ValidationError
from pypdf import PdfReader, PdfWriter
from reportlab.pdfgen import canvas

import test_templates as samples
from app import template_database, template_main, template_pdf
from app.template_models import TemplateDefinition, TemplateReport, resolved_values
from sqlalchemy.orm import Session


def image_bytes(format="PNG"):
    output = BytesIO()
    Image.new("RGB", (100, 100), "white").save(output, format)
    return output.getvalue()


def create_shared(client, definition=None):
    result = client.post(
        "/api/templates",
        data={
            "title": "Audit",
            "reviewed": "true",
            "definition_json": (definition or samples.definition()).model_dump_json(),
        },
        files={"pdf": ("form.pdf", samples.sample_pdf(), "application/pdf")},
    )
    assert result.status_code == 200, result.text
    return "/api/templates/" + result.json()["id"]


def test_engine_cache_and_fallback_urls(monkeypatch):
    monkeypatch.setattr(template_database, "_engine", None)
    monkeypatch.delenv("TEMPLATE_DATABASE_URL", raising=False)
    first = template_database.engine()
    assert template_database.engine() is first
    assert first.pool._pre_ping is True
    first.dispose()


def test_health_template_and_catalog_routes(api):
    shared = api
    assert shared.get("/api/health").json() == {"status": "ok"}
    assert shared.get("/api/templates").json() == {"templates": []}
    base = create_shared(shared)
    assert shared.get(base).json()["field_count"] == 4
    assert shared.patch(base, json={"title": "Renamed"}).json()["title"] == "Renamed"
    assert shared.patch(base, json={"title": " "}).status_code == 422
    assert shared.get(base + "/thumbnail").content.startswith(b"\x89PNG")
    assert shared.get(base + "/background").content.startswith(b"%PDF-")
    assert shared.get(base + "/definition").status_code == 404
    assert shared.get("/api/templates/missing").status_code == 404
    assert shared.get(base + "/drafts/missing/images/photo").status_code == 404


@pytest.mark.parametrize("path", ["preview", "generate"])
@pytest.mark.parametrize("payload", ["{", "[]", '{"wrong":true}'])
def test_report_json_validation(api, path, payload):
    base = create_shared(api)
    result = api.post(base + "/" + path, data={"report_json": payload})
    # Empty reports intentionally accept ignored unknown keys.
    expected = 422 if payload in ["{", "[]"] else 200
    assert result.status_code == expected


@pytest.mark.parametrize(
    "format,status", [("GIF", 415), ("JPEG", 200), ("PNG", 200), ("WEBP", 200)]
)
def test_image_formats(api, format, status):
    shared = api
    image = image_bytes(format)
    base = create_shared(shared)
    assert (
        shared.post(
            base + "/preview",
            data={"report_json": "{}", "image_fields": '["photo"]'},
            files={"images": ("image", image, "image/png")},
        ).status_code
        == status
    )


@pytest.mark.parametrize(
    "keys,images,status",
    [
        ("{", [], 422),
        ("null", [], 422),
        ("[1]", [], 422),
        ('["photo","photo"]', [], 422),
        ('["photo"]', [], 422),
        ('["other"]', [b"x"], 422),
        ('["photo"]', [b"bad"], 415),
        ('["photo"]', [b"x" * (12 * 1024 * 1024 + 1)], 413),
    ],
)
def test_shared_image_mapping_errors(keys, images, status):
    uploads = [UploadFile(BytesIO(data), filename="x.jpg") for data in images]
    with pytest.raises(HTTPException) as raised:
        asyncio.run(template_main.image_uploads(samples.definition(), uploads, keys))
    assert raised.value.status_code == status


def test_shared_total_upload_limit_and_missing_filename():
    definition = samples.definition().model_dump()
    for index in range(6):
        definition["fields"].append({**definition["fields"][2], "id": f"p{index}"})
    model = TemplateDefinition.model_validate(definition)
    large = image_bytes() + b"\0" * (11 * 1024 * 1024)
    uploads = [UploadFile(BytesIO(large), filename="x.png") for _ in range(6)]
    with pytest.raises(HTTPException) as error:
        asyncio.run(
            template_main.image_uploads(
                model, uploads, json.dumps([f"p{i}" for i in range(6)])
            )
        )
    assert error.value.status_code == 413
    result = asyncio.run(
        template_main.image_uploads(
            model, [UploadFile(BytesIO(image_bytes()))], '["photo"]'
        )
    )
    assert result["photo"][1] == "image"


def test_shared_pdf_validation_review_and_missing_images(api):
    shared = api
    definition = samples.definition()
    data = {"definition_json": definition.model_dump_json()}
    assert (
        shared.post(
            "/api/templates/review",
            data=data,
            files={"pdf": ("file.pdf", samples.sample_pdf(), "application/pdf")},
        ).status_code
        == 200
    )
    invalid = definition.model_dump()
    invalid["pages"][0]["width"] = 500
    bad = {"definition_json": json.dumps(invalid)}
    for endpoint in ["/api/templates/review", "/api/templates"]:
        result = shared.post(
            endpoint,
            data={**bad, "title": "Audit", "reviewed": "true"},
            files={"pdf": ("file.pdf", samples.sample_pdf(), "application/pdf")},
        )
        assert result.status_code == 422
    for title in [" ", "x" * 101]:
        with pytest.raises(HTTPException):
            template_main.title_required(title)
    assert (
        shared.post(
            "/api/templates/analyze",
            files={
                "pdf": (
                    "file.pdf",
                    b"%PDF-" + b"x" * (20 * 1024 * 1024),
                    "application/pdf",
                )
            },
        ).status_code
        == 413
    )
    base = create_shared(shared)
    draft = shared.post(
        base + "/drafts", data={"report_json": '{"title":"Audit"}'}
    ).json()
    assert shared.get(base + f"/drafts/{draft['id']}/images/photo").status_code == 404
    assert (
        shared.patch(base + f"/drafts/{draft['id']}", json={"title": " "}).status_code
        == 422
    )
    assert (
        shared.post(
            base + "/drafts",
            data={"report_json": '{"title":"Audit","values":{"temp":"nan"}}'},
        ).status_code
        == 422
    )
    assert (
        shared.post(
            base + "/preview", data={"report_json": '{"values":{"temp":"nan"}}'}
        ).status_code
        == 422
    )


@pytest.mark.parametrize(
    "mutate",
    [
        lambda d: d["fields"].append(deepcopy(d["fields"][0])),
        lambda d: d["clear_areas"].append(deepcopy(d["clear_areas"][0])),
        lambda d: d["fields"][0].update(page=2),
        lambda d: d["fields"][3].update(role="company", kind="text"),
        lambda d: d["fields"][0].update(kind="number"),
        lambda d: d["fields"][1].update(kind="text"),
        lambda d: d["fields"][3].update(kind="select", options=[]),
        lambda d: d["fields"][3].update(kind="select", options=[" "]),
        lambda d: d["fields"][3].update(kind="select", options=["x" * 161]),
        lambda d: d["fields"][3].update(kind="calculated", calculation=None),
        lambda d: d["fields"][3].update(
            kind="calculated", calculation={"operation": "sum", "fields": ["missing"]}
        ),
        lambda d: d["fields"][3].update(
            kind="calculated", calculation={"operation": "sum", "fields": ["company"]}
        ),
        lambda d: d["fields"][3].update(
            kind="calculated",
            calculation={"operation": "difference", "fields": ["temp"]},
        ),
        lambda d: d["ocr_mappings"][0].update(image_field="company"),
        lambda d: d["ocr_mappings"][0].update(target_field="missing"),
        lambda d: d["ocr_mappings"][0].update(target_field="date"),
        lambda d: d["ocr_mappings"][0].update(photo_label=" "),
        lambda d: d["ocr_mappings"].append(deepcopy(d["ocr_mappings"][0])),
    ],
)
def test_template_reference_validation(mutate):
    data = samples.definition().model_dump()
    mutate(data)
    with pytest.raises(ValidationError):
        TemplateDefinition.model_validate(data)


@pytest.mark.parametrize(
    "form",
    [
        {"values": {"missing": "x"}},
        {
            "layout": {
                "missing": {"page": 0, "x": 0, "y": 0, "width": 0.1, "height": 0.1}
            }
        },
        {"readings_confirmed": {"company": True}},
        {"values": {"company": True}},
        {"values": {"company": "x" * 20001}},
        {"values": {"temp": "not number"}},
        {"values": {"date": "2026-99-99"}},
        {"layout": {"temp": {"page": 9, "x": 0, "y": 0, "width": 0.1, "height": 0.1}}},
        {
            "rectangles": [
                {
                    "id": "r",
                    "image_field": "company",
                    "x": 0,
                    "y": 0,
                    "width": 0.1,
                    "height": 0.1,
                }
            ]
        },
    ],
)
def test_dynamic_report_validation(form):
    with pytest.raises(ValueError):
        TemplateReport.model_validate(form).validate_for(samples.definition())


def test_checkbox_time_select_validation_and_calculation_operations():
    data = samples.definition().model_dump()
    data["ocr_mappings"] = []
    for id, kind, options in [
        ("check", "checkbox", []),
        ("time", "time", []),
        ("choice", "select", ["A", "B"]),
        ("num", "number", []),
    ]:
        data["fields"].append(
            {
                "id": id,
                "label": id,
                "kind": kind,
                "options": options,
                "page": 0,
                "x": 0.1,
                "y": 0.1,
                "width": 0.1,
                "height": 0.1,
            }
        )
    model = TemplateDefinition.model_validate(data)
    TemplateReport(
        values={"check": False, "time": "12:00", "choice": "A"}
    ).validate_for(model)
    for values in [{"check": "yes"}, {"time": "25:00"}, {"choice": "C"}]:
        with pytest.raises(ValueError):
            TemplateReport(values=values).validate_for(model)
    for operation, expected in [
        ("sum", "90"),
        ("difference", "-30"),
        ("percentage", "50%"),
    ]:
        calculated = deepcopy(data)
        calculated["fields"].append(
            {
                "id": "result",
                "label": "Result",
                "kind": "calculated",
                "calculation": {"operation": operation, "fields": ["temp", "num"]},
                "page": 0,
                "x": 0.1,
                "y": 0.1,
                "width": 0.1,
                "height": 0.1,
            }
        )
        definition = TemplateDefinition.model_validate(calculated)
        assert (
            resolved_values(
                definition, TemplateReport(values={"temp": "30", "num": "60"})
            )["result"]
            == expected
        )
        assert (
            resolved_values(definition, TemplateReport(values={"num": "60"}))["result"]
            == ""
        )


def test_pdf_page_validation_and_render_variants():
    writer = PdfWriter()
    writer.add_blank_page(width=100, height=100)
    writer.encrypt("password")
    buffer = BytesIO()
    writer.write(buffer)
    with pytest.raises(ValueError):
        template_pdf.inspect_pdf(buffer.getvalue())
    writer = PdfWriter()
    for _ in range(21):
        writer.add_blank_page(width=100, height=100)
    buffer = BytesIO()
    writer.write(buffer)
    with pytest.raises(ValueError):
        template_pdf.inspect_pdf(buffer.getvalue())
    data = samples.definition().model_dump()
    data["ocr_mappings"] = []
    data["fields"][0].update(alignment="center", width=0.1, height=0.15)
    data["fields"][2].update(image_fit="cover")
    data["fields"][3].update(alignment="right")
    data["fields"].append(
        {
            "id": "check",
            "label": "Check",
            "kind": "checkbox",
            "page": 1,
            "x": 0.4,
            "y": 0.2,
            "width": 0.1,
            "height": 0.1,
        }
    )
    model = TemplateDefinition.model_validate(data)
    background, _ = template_pdf.clean_pdf(samples.sample_pdf(), model)
    form = TemplateReport(
        values={"company": "a long word " + ("x" * 100), "check": True, "temp": "40"},
        rectangles=[
            {
                "id": "r",
                "image_field": "photo",
                "x": 0.1,
                "y": 0.1,
                "width": 0.3,
                "height": 0.3,
            }
        ],
    )
    result = template_pdf.generate_pdf(
        background, model, form, {"photo": image_bytes()}
    )
    assert len(PdfReader(BytesIO(result)).pages) == 2
    template_pdf._wrap("x" * 100, "Helvetica", 12, 10)


def test_rendering_error_responses_and_calculation_arity(api, monkeypatch):
    shared = api
    base = create_shared(shared)

    def failing_renderer(*args, **kwargs):
        raise ValueError("Cannot render this PDF")

    monkeypatch.setattr(template_main, "generate_pdf", failing_renderer)
    assert shared.post(base + "/preview", data={"report_json": "{}"}).status_code == 422
    data = samples.definition().model_dump()
    data["ocr_mappings"] = []
    data["fields"].append(
        {
            "id": "bad_calc",
            "label": "Bad calculation",
            "kind": "calculated",
            "calculation": {"operation": "difference", "fields": ["temp"]},
            "page": 1,
            "x": 0.4,
            "y": 0.4,
            "width": 0.1,
            "height": 0.1,
        }
    )
    with pytest.raises(ValidationError, match="require two"):
        TemplateDefinition.model_validate(data)


@pytest.mark.parametrize("rotation", [0, 90, 180, 270])
def test_analysis_fillable_widgets_rotations_and_duplicate_roles(rotation):
    from pypdf.generic import (
        ArrayObject,
        DictionaryObject,
        FloatObject,
        NameObject,
        TextStringObject,
    )

    stream = BytesIO()
    pdf = canvas.Canvas(stream, pagesize=(600, 800))
    pdf.acroForm.textfield(
        name="Company",
        value="Acme",
        x=20,
        y=700,
        width=150,
        height=25,
        forceBorder=True,
    )
    pdf.acroForm.textfield(
        name="company name", value="Acme", x=20, y=650, width=150, height=25
    )
    pdf.acroForm.textfield(
        name="Date", value="2026-10-14", x=20, y=600, width=150, height=25
    )
    pdf.acroForm.checkbox(name="Check", x=20, y=550, size=20)
    pdf.acroForm.choice(
        name="Choice",
        options=[("A", "a"), ("B", "b")],
        value="a",
        x=20,
        y=500,
        width=150,
        height=25,
    )
    pdf.acroForm.radio(name="Group", value="A", selected=True, x=250, y=500)
    pdf.acroForm.radio(name="Group", value="B", selected=False, x=280, y=500)
    pdf.linkURL("https://example.com", (200, 100, 300, 130))
    pdf.showPage()
    pdf.save()
    writer = PdfWriter(clone_from=BytesIO(stream.getvalue()))
    page = writer.pages[0]
    page["/Annots"].append(
        writer._add_object(
            DictionaryObject(
                {
                    NameObject("/Subtype"): NameObject("/Widget"),
                    NameObject("/FT"): NameObject("/Tx"),
                    NameObject("/Rect"): ArrayObject(
                        [FloatObject(0), FloatObject(0), FloatObject(1), FloatObject(1)]
                    ),
                }
            )
        )
    )
    page["/Annots"].append(
        writer._add_object(
            DictionaryObject(
                {
                    NameObject("/Subtype"): NameObject("/Widget"),
                    NameObject("/FT"): NameObject("/Ch"),
                    NameObject("/T"): TextStringObject("No options"),
                    NameObject("/Rect"): ArrayObject(
                        [
                            FloatObject(300),
                            FloatObject(300),
                            FloatObject(450),
                            FloatObject(330),
                        ]
                    ),
                }
            )
        )
    )
    page.rotate(rotation)
    out = BytesIO()
    writer.write(out)
    result = template_pdf.analyze_pdf(out.getvalue())["definition"]
    assert sum(field["role"] == "company" for field in result["fields"]) == 1
    assert any(field["kind"] == "date" for field in result["fields"])
    assert any(field["kind"] == "select" for field in result["fields"])
    assert any(field["kind"] == "checkbox" for field in result["fields"])
    assert all(0 <= field["x"] <= 1 for field in result["fields"])


def test_analysis_grid_fonts_empty_boxes_images_and_off_page_shapes():
    from reportlab.lib.utils import ImageReader

    stream = BytesIO()
    pdf = canvas.Canvas(stream, pagesize=(600, 800))
    pdf.rect(0, 0, 599, 799)
    pdf.rect(3, 3, 5, 5)
    for row, (label, font) in enumerate(
        [
            ("Company", "Helvetica-Bold"),
            ("Company", "Times-Bold"),
            ("Date", "Courier"),
            ("Remarks", "Courier-Bold"),
        ]
    ):
        top = 760 - row * 100
        pdf.rect(20, top - 80, 180, 80)
        pdf.setFont("Helvetica", 8)
        pdf.drawString(25, top - 12, label)
        pdf.setFont(font, 12)
        pdf.drawString(25, top - 42, "2026-10-14" if label == "Date" else "Sample text")
    pdf.rect(250, 680, 150, 90)
    pdf.rect(260, 690, 130, 70)  # Inner boundary preferred.
    pdf.rect(430, 700, 20, 20)  # Checkbox.
    pdf.rect(250, 480, 150, 150)
    pdf.drawImage(
        ImageReader(Image.new("RGB", (100, 100), "red")),
        252,
        482,
        width=146,
        height=146,
    )
    pdf.rect(1000, 1000, 100, 100)
    pdf.showPage()
    pdf.save()
    fields = template_pdf.analyze_pdf(stream.getvalue())["definition"]["fields"]
    assert any(field["font"] == "Helvetica-Bold" for field in fields)
    assert any(field["font"] == "Times-Bold" for field in fields)
    assert any(field["font"] == "Courier" for field in fields)
    assert any(field["kind"] == "image" for field in fields)
    assert any(field["kind"] == "checkbox" for field in fields)
    assert len([field for field in fields if field["role"] == "company"]) == 1


def test_analysis_field_limit_is_enforced_without_overflow():
    stream = BytesIO()
    pdf = canvas.Canvas(stream, pagesize=(1000, 1000))
    for index in range(300):
        pdf.acroForm.textfield(
            name=f"f{index}",
            x=10 + index % 15 * 60,
            y=10 + index // 15 * 35,
            width=50,
            height=25,
        )
    pdf.rect(920, 900, 50, 50)
    pdf.showPage()
    pdf.save()
    assert (
        len(template_pdf.analyze_pdf(stream.getvalue())["definition"]["fields"]) == 300
    )


@pytest.mark.xfail(
    strict=True,
    reason="QA-001: JPEG verify accepts a truncated stream, then rendering returns HTTP 500",
)
def test_truncated_jpeg_is_rejected_without_server_crash(api):
    image = image_bytes("JPEG")[:-40]
    result = api.post(
        create_shared(api) + "/preview",
        data={"report_json": "{}", "image_fields": '["photo"]'},
        files={"images": ("bad.jpg", image, "image/jpeg")},
    )
    assert result.status_code == 415


def test_all_entered_custom_text_fits_or_is_rejected():
    definition = samples.definition().model_dump()
    definition["fields"][0].update(
        width=0.06, height=0.01, role=None, kind="textarea", font="Helvetica"
    )
    model = TemplateDefinition.model_validate(definition)
    text = "Important content " * 50
    blank, _ = template_pdf.clean_pdf(samples.sample_pdf(), model)
    # A small input box grows to preserve the template font size and all text.
    payload = template_pdf.generate_pdf(
        blank, model, TemplateReport(values={"company": text}), {}
    )
    printed = PdfReader(BytesIO(payload)).pages[0].extract_text()
    assert " ".join(printed.split()) == " ".join(text.split())
    # Content exceeding the entire page still fails instead of shrinking/clipping.
    with pytest.raises(ValueError, match="does not fit"):
        template_pdf.generate_pdf(
            blank, model, TemplateReport(values={"company": text * 10}), {}
        )


def test_overflow_calculation_is_not_printed():
    data = samples.definition().model_dump()
    data["fields"].append(
        {
            "id": "sum",
            "label": "Sum",
            "kind": "calculated",
            "calculation": {"operation": "sum", "fields": ["temp", "temp"]},
            "page": 1,
            "x": 0.4,
            "y": 0.4,
            "width": 0.1,
            "height": 0.1,
        }
    )
    model = TemplateDefinition.model_validate(data)
    with pytest.raises(ValueError, match="Sum: calculation overflow; check Temperature"):
        resolved_values(model, TemplateReport(values={"temp": "1e308"}))


@pytest.mark.skipif(
    not os.environ.get("QA_POSTGRES_URL"),
    reason="Requires an isolated disposable PostgreSQL database",
)
def test_postgresql_jsonb_images_survive_engine_reconnection(api):
    base = create_shared(api)
    saved = api.post(
        base + "/drafts",
        data={
            "report_json": '{"title":"PG audit","values":{"company":"Acme","temp":"42"}}',
            "image_fields": '["photo"]',
        },
        files={"images": ("photo.png", image_bytes(), "image/png")},
    )
    assert saved.status_code == 200, saved.text
    draft_id = saved.json()["id"]
    engine = template_database.engine()
    assert template_database.Draft.__table__.c.form.type.compile(dialect=engine.dialect) == "JSONB"
    engine.dispose()
    with Session(engine) as db:
        assert db.get(template_database.Draft, draft_id).form["values"]["temp"] == "42"
        assert db.get(template_database.DraftImage, (draft_id, "photo")).payload == image_bytes()
    assert api.get(base + "/drafts/" + draft_id).json()["form"]["values"]["company"] == "Acme"


def test_camera_sized_photo_previews_saves_and_downloads(api):
    source = BytesIO()
    Image.new("RGB", (5152, 3864), "gray").save(source, "JPEG")
    image = source.getvalue()
    base = create_shared(api)
    data = {"report_json": '{"title":"Camera photo"}', "image_fields": '["photo"]'}
    files = {"images": ("camera.jpg", image, "image/jpeg")}
    preview = api.post(base + "/preview", data=data, files=files)
    assert preview.status_code == 200, preview.text
    assert len(PdfReader(BytesIO(preview.content)).pages[0].images) > 0
    draft = api.post(base + "/drafts", data=data, files=files).json()
    draft_url = base + "/drafts/" + draft["id"]
    assert api.get(draft_url + "/images/photo").content == image
    exported = api.get(draft_url + "/pdf")
    assert exported.status_code == 200
    assert len(PdfReader(BytesIO(exported.content)).pages) == 2


def test_browser_preflight_and_download_filename_headers(api):
    origin = "http://localhost:5173"
    for method in ("PUT", "PATCH", "DELETE"):
        response = api.options(
            "/api/templates/example",
            headers={"Origin": origin, "Access-Control-Request-Method": method},
        )
        assert response.status_code == 200
        assert response.headers["access-control-allow-origin"] == origin
    response = api.post(
        create_shared(api) + "/generate",
        headers={"Origin": origin},
        data={"report_json": '{"title":"Header check"}'},
    )
    assert response.status_code == 200
    assert "content-disposition" in response.headers["access-control-expose-headers"].lower()


def test_pdf_grouping_preserves_field_order_and_page_overrides(monkeypatch):
    definition = samples.definition()
    definition.fields.append(definition.fields[0].model_copy(update={
        "id": "last", "label": "Last", "role": None, "page": 1,
    }))
    report = TemplateReport.model_validate({
        "values": {"company": "Moved", "temp": "42", "last": "Final"},
        "layout": {"company": {"page": 1, "x": 0.1, "y": 0.2, "width": 0.5, "height": 0.1}},
    })
    blank, _ = template_pdf.clean_pdf(samples.sample_pdf(), definition)
    seen = []
    original = template_pdf._paint_field

    def capture(pdf, field, box, *args):
        seen.append((field.id, box.page))
        return original(pdf, field, box, *args)

    monkeypatch.setattr(template_pdf, "_paint_field", capture)
    result = template_pdf.generate_pdf(blank, definition, report, {})
    assert seen == [("photo", 0), ("company", 1), ("date", 1), ("temp", 1), ("last", 1)]
    pages = PdfReader(BytesIO(result)).pages
    assert "Moved" not in pages[0].extract_text()
    assert "Moved" in pages[1].extract_text() and "Final" in pages[1].extract_text()

import json
from io import BytesIO

import pypdfium2 as pdfium
import pytest
from PIL import Image
from pydantic import ValidationError
from pypdf import PdfReader
from reportlab.pdfgen import canvas

from app.template_models import TemplateDefinition, TemplateReport, resolved_values
from app.template_pdf import analyze_pdf, clean_pdf, generate_pdf


def sample_pdf():
    output = BytesIO()
    pdf = canvas.Canvas(output, pagesize=(400, 500))
    pdf.setStrokeColorRGB(0, 0, 0.5)
    pdf.rect(20, 390, 180, 65)
    pdf.setFont("Helvetica", 8)
    pdf.drawString(25, 443, "Company")
    pdf.setFont("Helvetica", 16)
    pdf.drawString(25, 412, "OLD SAMPLE")
    pdf.rect(220, 250, 150, 150)
    pdf.setFont("Helvetica", 8)
    pdf.drawString(225, 387, "Photograph")
    pdf.showPage()
    pdf.setPageSize((600, 400))
    pdf.drawString(20, 370, "Second page")
    pdf.save()
    return output.getvalue()


def definition():
    return TemplateDefinition.model_validate(
        {
            "pages": [{"width": 400, "height": 500}, {"width": 600, "height": 400}],
            "fields": [
                {
                    "id": "company",
                    "label": "Company",
                    "kind": "text",
                    "role": "company",
                    "page": 0,
                    "x": 0.06,
                    "y": 0.13,
                    "width": 0.42,
                    "height": 0.07,
                },
                {
                    "id": "date",
                    "label": "Date",
                    "kind": "date",
                    "role": "report_date",
                    "page": 1,
                    "x": 0.05,
                    "y": 0.15,
                    "width": 0.3,
                    "height": 0.07,
                },
                {
                    "id": "photo",
                    "label": "Photo",
                    "kind": "image",
                    "page": 0,
                    "x": 0.56,
                    "y": 0.25,
                    "width": 0.36,
                    "height": 0.24,
                },
                {
                    "id": "temp",
                    "label": "Temperature",
                    "kind": "number",
                    "page": 1,
                    "x": 0.05,
                    "y": 0.3,
                    "width": 0.3,
                    "height": 0.07,
                },
            ],
            "clear_areas": [
                {
                    "id": "old",
                    "page": 0,
                    "x": 0.06,
                    "y": 0.14,
                    "width": 0.43,
                    "height": 0.07,
                }
            ],
            "ocr_mappings": [
                {
                    "image_field": "photo",
                    "photo_label": "Sp3",
                    "qualifier": "Max",
                    "target_field": "temp",
                }
            ],
        }
    )


def create(api, title="Inspection"):
    return api.post(
        "/api/templates",
        data={
            "title": title,
            "reviewed": "true",
            "definition_json": definition().model_dump_json(),
        },
        files={"pdf": ("form.pdf", sample_pdf(), "application/pdf")},
    )


def test_analysis_identifies_boundaries_and_preserves_caption():
    result = analyze_pdf(sample_pdf())
    company = next(
        field for field in result["definition"]["fields"] if field["label"] == "Company"
    )
    assert company["role"] == "company"
    assert company["y"] > 0.11  # Caption is above the editable area.
    assert "OLD SAMPLE" in company["suggested_value"]
    assert len(result["definition"]["pages"]) == 2


@pytest.mark.parametrize("background", ["white", "image", "blank"])
def test_detected_fields_have_attached_covers_for_white_or_image_backgrounds(background):
    from reportlab.lib.utils import ImageReader

    output = BytesIO()
    pdf = canvas.Canvas(output, pagesize=(400, 500))
    if background == "image":
        pdf.drawImage(ImageReader(Image.new("RGB", (180, 60), "navy")), 20, 350, 180, 60)
    pdf.rect(20, 350, 180, 60)
    if background == "white":
        pdf.setFont("Helvetica", 12)
        pdf.drawString(30, 375, "Existing reading")
    pdf.showPage()
    pdf.save()
    raw = output.getvalue()
    detected = TemplateDefinition.model_validate(analyze_pdf(raw)["definition"])
    assert detected.fields
    covers = {area.id: area for area in detected.clear_areas}
    for field in detected.fields:
        assert field.id in covers
        cover = covers[field.id]
        assert cover.color == "#ffffff"
        for key in ("page", "x", "y", "width", "height"):
            assert getattr(cover, key) == getattr(field, key)
    blank, _ = clean_pdf(raw, detected)
    with pdfium.PdfDocument(blank) as doc:
        image = doc[0].render(scale=1).to_pil().convert("RGB")
        assert image.getpixel((80, 120)) == (255, 255, 255)
        # Original outer border is outside the inset cover.
        assert max(image.getpixel((20, 120))) < 200


def test_cover_background_check_preserves_coloured_fills():
    from types import SimpleNamespace
    from app.template_pdf import _needs_cover

    rect = dict(x0=0, top=0, x1=100, bottom=100, fill=True)
    for colour, expected in [((1,1,1), True), ((1,.6,0), False), ((0,0,0,0), True), (0.4, False), (None, False)]:
        page = SimpleNamespace(images=[], rects=[{**rect, "non_stroking_color": colour}])
        assert _needs_cover(page, (10,10,90,90)) is expected


def test_interactive_fields_and_rounded_outlines_are_detected():
    buffer = BytesIO()
    pdf = canvas.Canvas(buffer, pagesize=(400, 500))
    pdf.acroForm.textfield(
        name="Company", value="Old Co", x=25, y=400, width=150, height=25
    )
    pdf.roundRect(20, 300, 180, 60, 5)
    pdf.setFont("Helvetica", 8)
    pdf.drawString(25, 348, "Description")
    pdf.showPage()
    pdf.save()
    detected = analyze_pdf(buffer.getvalue())["definition"]
    company = next(field for field in detected["fields"] if field["label"] == "Company")
    assert company["role"] == "company"
    assert company["suggested_value"] == "Old Co"
    assert any(field["label"] == "Description" for field in detected["fields"])


def test_double_borders_and_table_detection_do_not_stack_fields():
    buffer = BytesIO()
    pdf = canvas.Canvas(buffer, pagesize=(400, 500))
    # Coordinates deliberately straddle the old two-point rounding buckets.
    for x, y, width, height in [(21, 360, 180, 40), (21.25, 360.25, 179.5, 39.5),
                                  (201, 360, 170, 40), (21, 310, 350, 50)]:
        pdf.rect(x, y, width, height)
    pdf.setFont("Helvetica", 12)
    pdf.drawString(210, 375, "REPAIR AS SOON AS POSSIBLE")
    pdf.showPage()
    pdf.save()
    result = analyze_pdf(buffer.getvalue())["definition"]
    fields = result["fields"]
    assert len(fields) == 3
    for i, a in enumerate(fields):
        for b in fields[i + 1:]:
            assert not (min(a["x"] + a["width"], b["x"] + b["width"]) > max(a["x"], b["x"])
                        and min(a["y"] + a["height"], b["y"] + b["height"]) > max(a["y"], b["y"]))


def test_scanned_pages_are_flagged_and_label_only_table_cells_are_preserved():
    from reportlab.lib.utils import ImageReader

    buffer = BytesIO()
    pdf = canvas.Canvas(buffer, pagesize=(400, 500))
    pdf.rect(20, 400, 100, 30)
    pdf.rect(120, 400, 100, 30)
    pdf.setFont("Helvetica", 12)
    pdf.drawString(24, 410, "Temperature")
    pdf.drawString(124, 410, "43.7")
    pdf.showPage()
    pdf.drawImage(
        ImageReader(Image.new("RGB", (100, 100), "white")), 0, 0, width=400, height=500
    )
    pdf.showPage()
    pdf.save()
    detected = analyze_pdf(buffer.getvalue())
    assert detected["scanned_pages"] == [1]
    assert not any(
        field["x"] < 0.3
        for field in detected["definition"]["fields"]
        if field["page"] == 0
    )
    assert any(field["kind"] == "number" for field in detected["definition"]["fields"])


def test_blank_background_removes_sample_content_but_preserves_borders():
    source = sample_pdf()
    blank, thumbnail = clean_pdf(source, definition())
    assert "OLD SAMPLE" not in " ".join(
        p.extract_text() for p in PdfReader(BytesIO(blank)).pages
    )
    assert thumbnail.startswith(b"\x89PNG")
    with pdfium.PdfDocument(blank) as document:
        bitmap = document[0].render(scale=1)
        image = bitmap.to_pil().convert("RGB")
        assert image.getpixel((40, 85)) == (255, 255, 255)  # Former sample-value area.
        assert min(image.getpixel((20, 80))) < 180  # Original outline is intact.
        bitmap.close()


def test_generation_uses_page_sizes_dates_images_and_annotations():
    blank, _ = clean_pdf(sample_pdf(), definition())
    image = BytesIO()
    Image.new("RGB", (5152, 3864), (100, 110, 120)).save(image, "JPEG")
    report = TemplateReport(
        title="Inspection A",
        values={"company": "New Company", "date": "2026-10-14", "temp": "53.2"},
        rectangles=[
            {
                "id": "r1",
                "image_field": "photo",
                "x": 0.1,
                "y": 0.2,
                "width": 0.5,
                "height": 0.5,
                "color": "#ff0000",
                "stroke_width": 4,
            }
        ],
    )
    output = generate_pdf(blank, definition(), report, {"photo": image.getvalue()})
    reader = PdfReader(BytesIO(output))
    assert len(reader.pages) == 2
    assert float(reader.pages[1].mediabox.width) == 600
    assert "New Company" in reader.pages[0].extract_text()
    assert "14 Oct 2026" in reader.pages[1].extract_text()
    assert b"4 w" in reader.pages[0].get_contents().get_data()
    assert reader.metadata.title == "Inspection A"
    assert any(
        # The photo is cropped to its 144 x 120 point box, not letterboxed.
        abs(item.image.width / item.image.height - 144 / 120) < 0.01
        for item in reader.pages[0].images
    )


def test_draft_lifecycle_is_scoped_and_images_and_layout_survive(api):
    response = create(api)
    assert response.status_code == 200, response.text
    template_id = response.json()["id"]
    other_id = create(api, "Other").json()["id"]
    base = f"/api/templates/{template_id}"
    image = BytesIO()
    Image.new("RGB", (20, 20), "red").save(image, "PNG")
    form = {
        "title": "Panel A",
        "values": {"company": "Acme", "date": "2026-10-14", "temp": "43"},
        "layout": {
            "temp": {"page": 1, "x": 0.2, "y": 0.2, "width": 0.3, "height": 0.1}
        },
        "rectangles": [
            {
                "id": "r",
                "image_field": "photo",
                "x": 0.1,
                "y": 0.1,
                "width": 0.3,
                "height": 0.2,
            }
        ],
    }
    assert (
        api.post(
            base + "/drafts", data={"report_json": json.dumps({**form, "title": " "})}
        ).status_code
        == 422
    )
    draft = api.post(
        base + "/drafts",
        data={"report_json": json.dumps(form), "image_fields": '["photo"]'},
        files={"images": ("camera.png", image.getvalue(), "image/png")},
    )
    assert draft.status_code == 200, draft.text
    draft_id = draft.json()["id"]
    assert draft.json()["company"] == "Acme"
    assert draft.json()["report_date"] == "2026-10-14"
    assert draft.json()["form"]["rectangles"][0]["id"] == "r"
    assert (
        api.get(base + f"/drafts/{draft_id}/images/photo").content
        == image.getvalue()
    )
    assert api.get(f"/api/templates/{other_id}/drafts/{draft_id}").status_code == 404
    assert (
        api.delete(f"/api/templates/{other_id}/drafts/{draft_id}").status_code == 404
    )
    updated = api.put(
        base + f"/drafts/{draft_id}",
        data={"report_json": json.dumps({**form, "title": "Updated"})},
    )
    assert (
        updated.json()["images"] == []
    )  # Explicit replacement removes a removed photo.
    assert len(api.get(base + "/drafts").json()["drafts"]) == 1
    assert (
        api.patch(base + f"/drafts/{draft_id}", json={"title": "Renamed"}).json()[
            "title"
        ]
        == "Renamed"
    )
    assert api.delete(base + f"/drafts/{draft_id}").status_code == 204
    assert api.get(base + "/drafts").json()["drafts"] == []


def test_ocr_without_confirmation_and_preview_use_same_rendering(api):
    template_id = create(api).json()["id"]
    base = f"/api/templates/{template_id}"
    image = BytesIO()
    Image.new("RGB", (20, 20), "white").save(image, "PNG")
    form = {"title": "Panel A", "values": {"temp": "42"}}
    files = {"images": ("photo.png", image.getvalue(), "image/png")}
    data = {"report_json": json.dumps(form), "image_fields": '["photo"]'}
    assert api.post(base + "/preview", data=data, files=files).status_code == 200
    assert api.post(base + "/generate", data=data, files=files).status_code == 200
    form["readings_confirmed"] = {"photo": True}
    data["report_json"] = json.dumps(form)
    response = api.post(base + "/generate", data=data, files=files)
    assert response.status_code == 200
    assert 'filename="Panel A.pdf"' in response.headers["content-disposition"]
    assert (
        api.options(
            base + "/drafts",
            headers={
                "Origin": "http://192.168.1.3:5173",
                "Access-Control-Request-Method": "PUT",
            },
        ).status_code
        == 200
    )


def test_upload_review_and_invalid_configuration_validation(api):
    assert (
        api.post(
            "/api/templates/analyze",
            files={"pdf": ("x.pdf", b"not pdf", "application/pdf")},
        ).status_code
        == 415
    )
    assert (
        api.post(
            "/api/templates/analyze",
            files={"pdf": ("x.pdf", b"%PDF-corrupt", "application/pdf")},
        ).status_code
        == 422
    )
    response = api.post(
        "/api/templates",
        data={"title": "Test", "definition_json": definition().model_dump_json()},
        files={"pdf": ("x.pdf", sample_pdf(), "application/pdf")},
    )
    assert response.status_code == 200
    invalid = definition().model_dump()
    invalid["fields"][0]["x"] = 0.99
    with pytest.raises(ValidationError):
        TemplateDefinition.model_validate(invalid)
    invalid = definition().model_dump()
    invalid["ocr_mappings"][0]["image_field"] = "company"
    with pytest.raises(ValidationError):
        TemplateDefinition.model_validate(invalid)
    bad = TemplateReport(values={"temp": "nan"})
    with pytest.raises(ValueError):
        bad.validate_for(definition())


def test_calculations_are_explicit_and_cannot_be_overridden():
    data = definition().model_dump()
    data["fields"].extend(
        [
            {
                "id": "rated",
                "label": "Rated",
                "kind": "number",
                "page": 1,
                "x": 0.4,
                "y": 0.2,
                "width": 0.2,
                "height": 0.1,
            },
            {
                "id": "load",
                "label": "Load",
                "kind": "calculated",
                "calculation": {"operation": "percentage", "fields": ["temp", "rated"]},
                "page": 1,
                "x": 0.4,
                "y": 0.4,
                "width": 0.2,
                "height": 0.1,
            },
        ]
    )
    template = TemplateDefinition.model_validate(data)
    assert (
        resolved_values(
            template,
            TemplateReport(values={"temp": "30", "rated": "60", "load": "999"}),
        )["load"]
        == "50%"
    )
    with pytest.raises(ValueError, match="Load: Rated .* cannot be zero"):
        resolved_values(template, TemplateReport(values={"temp": "30", "rated": "0"}))

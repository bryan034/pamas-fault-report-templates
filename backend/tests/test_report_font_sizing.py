"""Report text shrinks to fit fixed boxes in preview, PDF and Word."""
import base64
from io import BytesIO
from zipfile import ZipFile

import pdfplumber
import pytest
from reportlab.pdfgen import canvas

from app.template_models import TemplateDefinition, TemplateReport
from app.template_pdf import generate_pdf, generate_field_layers
from app.template_word import generate_docx


def fixture(size=48, value="BX1 42.6"):
    definition = TemplateDefinition.model_validate({"pages": [{"width":400,"height":500}],
      "fields":[{"id":"temperature","label":"BX1 temperature","kind":"text","page":0,
                 "x":.97,"y":.98,"width":.02,"height":.01}],
      "clear_areas":[],"ocr_mappings":[],"extractions":[]})
    report = TemplateReport.model_validate({"title":"Font check","values":{"temperature":value},
                                           "styles":{"temperature":{"font_size":size}}})
    output=BytesIO()
    pdf=canvas.Canvas(output,pagesize=(400,500));pdf.showPage();pdf.save()
    return definition,report,output.getvalue()


def test_text_shrinks_inside_fixed_box_in_preview_pdf_and_word():
    definition, report, blank = fixture()
    field = definition.fields[0]
    field.x, field.y, field.width, field.height = .1, .1, .25, .04
    layers = generate_field_layers(definition, report, {})
    assert layers["layout"]["temperature"] == {key: getattr(field, key) for key in ("page", "x", "y", "width", "height")}
    sizes = []
    for payload in [base64.b64decode(layers["pdf"]), generate_pdf(blank, definition, report, {})]:
        with pdfplumber.open(BytesIO(payload)) as document:
            assert document.pages[0].extract_text() == "BX1 42.6"
            chars = document.pages[0].chars
            sizes.append(chars[0]["size"])
            assert 0 < chars[0]["size"] < 48
    assert sizes[0] == pytest.approx(sizes[1])
    with ZipFile(BytesIO(generate_docx(blank, definition, report, {}))) as archive:
        xml = archive.read("word/document.xml").decode()
        assert f'w:val="{round(sizes[0]*2)}"' in xml and "BX1 42.6" in xml
    assert report.styles["temperature"].font_size == 48


def test_shorter_text_recovers_selected_size_without_changing_geometry():
    definition, report, blank = fixture(12, "A")
    field = definition.fields[0]
    field.x, field.y, field.width, field.height = .1, .1, .5, .2
    with pdfplumber.open(BytesIO(generate_pdf(blank, definition, report, {}))) as pdf:
        assert all(abs(char["size"]-12)<.01 for char in pdf.pages[0].chars)


def test_long_text_and_unbroken_tokens_fit_without_growing_box():
    from app.template_pdf import fit_report_text
    from reportlab.pdfbase import pdfmetrics
    for value in ["Many words " * 100, "X" * 1000, "First\nSecond"]:
        size, lines = fit_report_text(value, "Times-Roman", 72, 100, 20)
        assert 0 < size < 72
        assert len(lines) * size * 1.15 <= 18.00001
        assert all(pdfmetrics.stringWidth(line, "Times-Roman", size) <= 98.00001 for line in lines)


def test_empty_field_keeps_geometry():
    definition, report, _ = fixture(48, "")
    layers = generate_field_layers(definition, report, {})
    assert layers["pdf"] is None
    assert layers["layout"]["temperature"]["height"] == .01


@pytest.mark.parametrize("styles", [{}, {"temperature": {"color": "#ff0000"}}])
def test_inherited_font_also_shrinks_without_modifying_template(styles):
    definition, report, blank = fixture(32)
    report = TemplateReport.model_validate({**report.model_dump(), "styles": styles})
    with pdfplumber.open(BytesIO(generate_pdf(blank, definition, report, {}))) as pdf:
        assert 0 < pdf.pages[0].chars[0]["size"] < definition.fields[0].font_size


def test_multiline_text_starts_at_top_independent_of_field_height():
    definition, report, blank = fixture(16, "First\nSecond")
    field = definition.fields[0]
    field.x, field.y, field.width = .1, .1, .5
    for height in [.2, .6]:
        field.height = height
        with pdfplumber.open(BytesIO(generate_pdf(blank, definition, report, {}))) as pdf:
            chars = pdf.pages[0].chars
            assert chars[0]["matrix"][5] == pytest.approx(500 - 50 - 1 - 16)
            second = next(char for char in chars if char["text"] == "S")
            assert chars[0]["matrix"][5] - second["matrix"][5] == pytest.approx(16 * 1.15)


def test_calculations_accept_numeric_text_sources_with_named_invalid_value_errors():
    from app.template_models import resolved_values
    definition, report, _ = fixture()
    source = definition.fields[0].model_dump()
    other = {**source, "id": "other", "label": "Other", "kind": "textarea"}
    total = {**source, "id": "total", "label": "Total", "kind": "calculated",
             "calculation": {"operation": "difference", "fields": [source["id"], "other"]}}
    definition = TemplateDefinition.model_validate({**definition.model_dump(), "fields": [source, other, total]})
    report.values = {"temperature": "42.5", "other": " 20 "}
    assert resolved_values(definition, report)["total"] == "22.5"
    report.values["other"] = "not a number"
    with pytest.raises(ValueError, match="Total: source values must be finite numbers"):
        resolved_values(definition, report)


def test_long_text_shrinks_on_one_line_and_explicit_breaks_are_preserved():
    from app.template_pdf import fit_report_text
    text = "A long report reading with several words"
    size, lines = fit_report_text(text, "Times-Roman", 16, 100, 100)
    assert lines == [text]
    assert 0 < size < 16
    assert fit_report_text("First\nSecond", "Times-Roman", 16, 200, 100) == (16, ["First", "Second"])
    assert fit_report_text("A", "Times-Roman", 16, 200, 100)[0] == 16
    assert fit_report_text("A", "Times-Roman", 16, 5, 5)[0] < 16


def test_number_dash_is_saved_and_exported_without_becoming_zero():
    from app.template_models import resolved_values
    definition, report, blank = fixture(16, "-")
    field = definition.fields[0]
    field.kind = "number"
    field.x, field.y, field.width, field.height = .1, .1, .5, .2
    report.validate_for(definition)
    assert resolved_values(definition, report)[field.id] == "-"
    with pdfplumber.open(BytesIO(generate_pdf(blank, definition, report, {}))) as pdf:
        assert pdf.pages[0].extract_text() == "-"
    with ZipFile(BytesIO(generate_docx(blank, definition, report, {}))) as archive:
        assert ">-</w:t>" in archive.read("word/document.xml").decode()
    definition = TemplateDefinition.model_validate({**definition.model_dump(), "fields": [
        field.model_dump(), {**field.model_dump(), "id": "total", "kind": "calculated",
        "calculation": {"operation": "sum", "fields": [field.id]}}]})
    assert resolved_values(definition, report)["total"] == ""
    report.values[field.id] = "-12.5"
    report.validate_for(definition)
    assert resolved_values(definition, report)["total"] == "-12.5"
    report.values[field.id] = "invalid"
    with pytest.raises(ValueError):
        report.validate_for(definition)

"""Selected report point sizes survive preview, PDF and Word without box-driven shrink."""
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


def test_selected_size_grows_box_within_page_and_matches_pdf_and_word():
    definition, report, blank = fixture()
    layers=generate_field_layers(definition,report,{})
    box=layers["layout"]["temperature"]
    assert box["width"] > .02 and box["height"] > .01
    assert box["x"]+box["width"] <= 1.000001 and box["y"]+box["height"] <= 1.000001
    for pdf in [base64.b64decode(layers["pdf"]), generate_pdf(blank,definition,report,{})]:
        with pdfplumber.open(BytesIO(pdf)) as document:
            assert document.pages[0].extract_text() == "BX1 42.6"
            assert all(abs(char["size"]-48)<.01 for char in document.pages[0].chars)
    with ZipFile(BytesIO(generate_docx(blank,definition,report,{}))) as archive:
        xml=archive.read("word/document.xml").decode()
        assert 'w:val="96"' in xml and "BX1 42.6" in xml


def test_smaller_selected_font_is_used_even_after_box_was_enlarged():
    definition,report,_=fixture()
    grown=generate_field_layers(definition,report,{})["layout"]
    report=TemplateReport.model_validate({**report.model_dump(),"layout":grown,
                                         "styles":{"temperature":{"font_size":12}}})
    layers=generate_field_layers(definition,report,{})
    with pdfplumber.open(BytesIO(base64.b64decode(layers["pdf"]))) as pdf:
        assert all(abs(char["size"]-12)<.01 for char in pdf.pages[0].chars)


def test_impossible_page_fit_is_an_error_instead_of_shrinking_or_clipping():
    definition,report,blank=fixture(72,"Many words "*100)
    for generate in [lambda: generate_field_layers(definition,report,{}),
                     lambda: generate_pdf(blank,definition,report,{}),
                     lambda: generate_docx(blank,definition,report,{})]:
        with pytest.raises(ValueError,match="does not fit on this page at 72 pt"):
            generate()


def test_empty_field_grows_for_selected_size_before_values_are_entered():
    definition,report,_=fixture(48,"")
    layers=generate_field_layers(definition,report,{})
    assert layers["pdf"] is None
    assert layers["layout"]["temperature"]["height"] > .01


@pytest.mark.parametrize("styles", [{}, {"temperature": {"color": "#ff0000"}}])
def test_inherited_template_font_grows_box_without_report_size_override(styles):
    definition, report, blank = fixture(32)
    definition.fields[0].font_size = 32
    report = TemplateReport.model_validate({**report.model_dump(), "styles": styles})
    layers = generate_field_layers(definition, report, {})
    assert layers["layout"]["temperature"]["height"] > .01
    assert layers["layout"]["temperature"]["width"] > .02
    for payload in [base64.b64decode(layers["pdf"]), generate_pdf(blank, definition, report, {})]:
        with pdfplumber.open(BytesIO(payload)) as document:
            assert document.pages[0].extract_text() == "BX1 42.6"
            assert all(abs(char["size"] - 32) < .01 for char in document.pages[0].chars)
    with ZipFile(BytesIO(generate_docx(blank, definition, report, {}))) as archive:
        assert 'w:val="64"' in archive.read("word/document.xml").decode()


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

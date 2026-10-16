import base64
import json
from io import BytesIO

import pdfplumber
import pytest
from pydantic import ValidationError
from pypdf import PdfReader

from app.template_models import TemplateDefinition, TemplateReport, resolved_values
from app.template_pdf import clean_pdf, generate_pdf, generate_field_layers
from test_templates import definition, sample_pdf
from test_audit import create_shared


def with_defaults():
    schema = definition().model_dump()
    schema["fields"][0]["default_value"] = "Default Company"
    schema["fields"][0]["suggested_value"] = "Detected sample is not a default"
    schema["fields"][1]["default_value"] = "2026-10-16"
    schema["fields"][3]["default_value"] = "40"
    return TemplateDefinition.model_validate(schema)


def test_default_values_are_used_but_explicit_blanks_and_edits_win():
    schema = with_defaults()
    assert resolved_values(schema, TemplateReport())["company"] == "Default Company"
    assert resolved_values(schema, TemplateReport(values={"company": ""}))["company"] == ""
    assert resolved_values(schema, TemplateReport(values={"temp": "12"}))["temp"] == "12"


@pytest.mark.parametrize("index,value", [(0, True), (0, "x" * 20001), (1, "not-a-date"), (2, "image-default"), (3, "NaN"), (3, "not-a-number")])
def test_invalid_defaults_are_rejected(index, value):
    schema = definition().model_dump()
    schema["fields"][index]["default_value"] = value
    with pytest.raises((ValidationError, ValueError)):
        TemplateDefinition.model_validate(schema)


def test_defaults_survive_template_and_draft_save_without_promoting_sample_values(api):
    base = create_shared(api, with_defaults())
    template = api.get(base).json()
    company = template["definition"]["fields"][0]
    assert company["default_value"] == "Default Company"
    assert company["suggested_value"] == ""
    response = api.post(base + "/drafts", data={"report_json": '{"title":"Default job"}'})
    assert response.status_code == 200, response.text
    saved = response.json()
    assert saved["form"]["values"]["company"] == "Default Company"
    edited = {**saved["form"], "values": {**saved["form"]["values"], "company": ""}}
    assert api.put(base + "/drafts/" + saved["id"], data={"report_json": json.dumps(edited)}).status_code == 200
    assert api.get(base + "/drafts/" + saved["id"]).json()["form"]["values"]["company"] == ""
    result = api.post(base + "/generate", data={"report_json": '{"title":"Default PDF"}'})
    assert "Default Company" in PdfReader(BytesIO(result.content)).pages[0].extract_text()


def test_existing_draft_keeps_original_defaults_after_template_revision(api):
    base = create_shared(api, with_defaults())
    previous = api.get(base).json()
    draft = api.post(base + "/drafts", data={"report_json": '{"title":"Old revision"}'}).json()
    schema = previous["definition"]
    schema["fields"][0]["default_value"] = "New default"
    changed = api.put(base, data={"title": "New template", "expected_revision_id": previous["revision_id"], "definition_json": json.dumps(schema)})
    assert changed.status_code == 200, changed.text
    assert api.get(base + "/drafts/" + draft["id"]).json()["form"]["values"]["company"] == "Default Company"
    fresh = api.post(base + "/drafts", data={"report_json": '{"title":"New revision"}'}).json()
    assert fresh["form"]["values"]["company"] == "New default"


def test_alignment_and_newlines_match_download_and_transparent_layers():
    schema = definition()
    blank, _ = clean_pdf(sample_pdf(), schema)
    positions = []
    for alignment in ["left", "center", "right"]:
        report = TemplateReport(values={"company": "First\nSecond"}, styles={"company": {"alignment": alignment}})
        pdf = generate_pdf(blank, schema, report, {})
        with pdfplumber.open(BytesIO(pdf)) as document:
            words = [word for word in document.pages[0].extract_words() if word["text"] in {"First", "Second"}]
            assert len(words) == 2
            assert words[0]["top"] < words[1]["top"]
            assert all(24 <= word["x0"] < word["x1"] <= 192 for word in words)
            positions.append(words[0]["x0"])
        layers = generate_field_layers(schema, report, {})
        assert layers["fields"] == ["company"]
        with pdfplumber.open(BytesIO(base64.b64decode(layers["pdf"]))) as document:
            first = next(word for word in document.pages[0].extract_words() if word["text"] == "First")
            assert abs(first["x0"] + 24 - positions[-1]) < 0.1
    assert positions[0] < positions[1] < positions[2]


def test_alignment_is_saved_and_invalid_alignment_is_rejected(api):
    base = create_shared(api)
    form = {"title": "Aligned", "styles": {"company": {"alignment": "right"}}}
    response = api.post(base + "/drafts", data={"report_json": json.dumps(form)})
    assert response.status_code == 200
    assert response.json()["form"]["styles"]["company"]["alignment"] == "right"
    form["styles"]["company"]["alignment"] = "outside"
    assert api.post(base + "/drafts", data={"report_json": json.dumps(form)}).status_code == 422

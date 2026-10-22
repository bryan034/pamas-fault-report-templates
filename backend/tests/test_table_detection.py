from io import BytesIO

import pdfplumber
import pytest
from reportlab.pdfgen import canvas

from app.table_detection import refine_table_layout
from app.template_models import PageSize, TemplateDefinition, TemplateReport, resolved_values
from app.template_pdf import analyze_pdf


def load_table(blank=False, ruled=False, extra_box=False):
    out = BytesIO()
    pdf = canvas.Canvas(out, pagesize=(400, 500))
    pdf.setFillColorRGB(1, .6, 0)
    pdf.rect(20, 270, 80, 160, fill=1)
    pdf.rect(20, 430, 350, 20, fill=1)
    pdf.setFillColorRGB(1, 1, 1)
    pdf.setFont("Helvetica-Bold", 10)
    pdf.drawString(25, 437, "LOADS CURRENT (AMPERE)")
    for x, label in [(25, "PHASE"), (105, "RATED"), (185, "MEASURED"), (285, "%")]:
        pdf.setFillColorRGB(*((1, 1, 1) if x == 25 else (0, 0, 0)))
        pdf.drawString(x, 415, label)
    pdf.drawString(285, 404, "LOAD")
    for x in [20, 100, 180, 280, 370]:
        pdf.line(x, 270, x, 430)
    for y in [270, 400, 430]:
        pdf.line(20, y, 370, y)
    for i, (phase, rated, measured) in enumerate([("L1", "1000", "178"), ("L2", "1000", "180"), ("L3", "1000", "200"), ("N", "-", "-")]):
        y = 380-i*30
        pdf.setFont("Helvetica-Bold", 10)
        pdf.setFillColorRGB(1, 1, 1)
        pdf.drawString(25, y, phase)
        pdf.setFont("Helvetica", 10)
        pdf.setFillColorRGB(0, 0, 0)
        if not blank:
            pdf.drawString(105, y, rated)
            pdf.drawString(185, y, measured)
            pdf.drawString(285, y, "18%" if i < 3 else "-")
        if ruled and i < 3:
            pdf.line(20, y-10, 370, y-10)
    if extra_box:
        pdf.rect(20, 90, 150, 50)
    pdf.showPage()
    pdf.save()
    return out.getvalue()


@pytest.mark.parametrize("blank", [False, True])
@pytest.mark.parametrize("ruled", [False, True])
def test_load_rows_headers_labels_and_percentage(blank, ruled):
    result = analyze_pdf(load_table(blank, ruled))["definition"]
    definition = TemplateDefinition.model_validate(result)
    fields = {f.label: f for f in definition.fields}
    assert set(fields) == {f"{phase} {column}" for phase in ["L1", "L2", "L3", "N"]
                           for column in ["Rated", "Measured", "% Load"]}
    assert all(f.x >= 100/400 for f in fields.values())
    assert all(f.y > 100/500 for f in fields.values())
    values = {}
    for phase, measured in [("L1", "178"), ("L2", "180"), ("L3", "200")]:
        rated, measure, load = [fields[f"{phase} {c}"] for c in ["Rated", "Measured", "% Load"]]
        assert load.kind == "calculated"
        assert load.calculation.fields == [measure.id, rated.id]
        values.update({rated.id: "1000", measure.id: measured})
    resolved = resolved_values(definition, TemplateReport(values=values))
    assert resolved[fields["L1 % Load"].id] == "17.8%"
    assert resolved[fields["L2 % Load"].id] == "18%"
    assert resolved[fields["L3 % Load"].id] == "20%"
    assert resolved[fields["N % Load"].id] == ""
    values[fields["L1 Rated"].id] = "0"
    with pytest.raises(ValueError, match="cannot be zero"):
        resolved_values(definition, TemplateReport(values=values))
    assert all(f.default_value == "" for f in fields.values())
    assert {f.id for f in fields.values()} <= {c.id for c in definition.clear_areas}


def test_ocr_layout_uses_same_row_and_formula_inference(api):
    with pdfplumber.open(BytesIO(load_table())) as doc:
        page = doc.pages[0]
        words = page.extract_words()
        cells = [c for table in page.find_tables() for c in table.cells]
    response = api.post("/api/templates/analyze-scanned-layout", json={
        "page": 0, "size": {"width": 400, "height": 500}, "words": words, "cells": cells,
    })
    assert response.status_code == 200, response.text
    assert len(response.json()["fields"]) == 12
    assert all(f["kind"] == "calculated" for f in response.json()["fields"] if "% Load" in f["label"])
    invalid = api.post("/api/templates/analyze-scanned-layout", json={
        "page": 0, "size": {"width": 400, "height": 500}, "words": [], "cells": [[-1, 0, 20, 20]],
    })
    assert invalid.status_code == 422


def test_white_bold_headers_and_first_column_labels_are_preserved():
    words = [dict(text=text, x0=x, top=y, x1=x+35, bottom=y+10, fontname=font, size=10)
             for text, x, y, font in [("PARAMETER", 22, 22, "Helvetica-Bold"), ("VALUE", 122, 22, "Helvetica-Bold"),
                                      ("Ambient", 22, 52, "Helvetica"), ("29", 122, 52, "Helvetica")]]
    cells = [(20, 20, 120, 40), (120, 20, 220, 40), (20, 40, 120, 70), (120, 40, 220, 70)]
    remaining, fields = refine_table_layout(cells, words, 0, PageSize(width=400, height=500))
    assert remaining == [(120, 40, 220, 70)]
    assert not fields

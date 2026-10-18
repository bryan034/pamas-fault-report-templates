"""Image boxes always crop to fill in previews and exports, even legacy templates."""

import base64
from io import BytesIO

import pypdfium2 as pdfium
import pytest
from PIL import Image
from reportlab.pdfgen import canvas

from app.template_models import TemplateDefinition, TemplateReport
from app.template_pdf import generate_field_layers, generate_pdf


@pytest.mark.parametrize("portrait", [False, True])
@pytest.mark.parametrize("fit", [None, "contain", "cover"])
@pytest.mark.parametrize("resized", [False, True])
def test_image_fills_box_in_preview_and_pdf(portrait, fit, resized):
    field = dict(id="photo", label="Photo", kind="image", page=0,
                 x=.25, y=.25, width=.5, height=.5)
    if fit is not None:
        field["image_fit"] = fit
    definition = TemplateDefinition.model_validate({
        "pages": [{"width": 200, "height": 200}], "fields": [field],
    })
    if fit is None:
        assert definition.fields[0].image_fit == "cover"
    # The green centre fills the target; red/blue ends must be cropped away.
    image = Image.new("RGB", (100, 600) if portrait else (600, 100), "green")
    image.paste("red", (0, 0, 100, 100))
    image.paste("blue", (0, 500, 100, 600) if portrait else (500, 0, 600, 100))
    upload = BytesIO()
    image.save(upload, format="PNG")
    original = upload.getvalue()
    images = {"photo": original}
    layout = {"photo": dict(page=0, x=.25, y=.25, width=.6, height=.3)} if resized else {}
    report = TemplateReport(title="Cropped", layout=layout)
    background = BytesIO()
    pdf = canvas.Canvas(background, pagesize=(200, 200))
    pdf.showPage()
    pdf.save()
    exported = generate_pdf(background.getvalue(), definition, report, images)
    layers = generate_field_layers(definition, report, images)
    assert layers["fields"] == ["photo"]
    box = report.layout.get("photo", definition.fields[0])
    with pdfium.PdfDocument(exported) as document:
        page = document[0].render(scale=2).to_pil().convert("RGB")
        assert page.getpixel((5, 5)) == (255, 255, 255)
        cropped = page.crop((round(box.x * 400), round(box.y * 400),
                             round((box.x + box.width) * 400), round((box.y + box.height) * 400)))
        assert_green_edges(cropped)
    with pdfium.PdfDocument(base64.b64decode(layers["pdf"])) as document:
        assert_green_edges(document[0].render(scale=2).to_pil().convert("RGB"))
    assert images["photo"] == original


def assert_green_edges(image):
    for x in (2, image.width // 2, image.width - 3):
        for y in (2, image.height // 2, image.height - 3):
            red, green, blue = image.getpixel((x, y))
            assert green > 100 and red < 20 and blue < 20

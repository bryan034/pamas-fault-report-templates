"""Fixed-layout DOCX export with native editable report text over page artwork.

A PDF's original paragraphs/tables cannot reliably be reconstructed. Render
artwork/photos/annotations as page backgrounds and keep entered values as
positioned Word text boxes. Reuse the PDF renderer for fit and coordinates.
"""

from io import BytesIO

from docx import Document
from docx.enum.section import WD_SECTION_START
from docx.oxml import OxmlElement, parse_xml
from docx.oxml.ns import nsdecls, qn
from docx.shared import Pt
from lxml import etree
import pdfplumber
import pypdfium2 as pdfium

from .template_pdf import generate_pdf, generate_field_layers
from .template_models import PageBox

V = "urn:schemas-microsoft-com:vml"
O = "urn:schemas-microsoft-com:office:office"
WORD_FONTS = {
    "Times-Roman": "Times New Roman",
    "Times-Bold": "Times New Roman",
    "Helvetica": "Arial",
    "Helvetica-Bold": "Arial",
    "Courier": "Courier New",
}


def _page_picture(paragraph, payload, width, height, identity):
    inline = (
        paragraph.add_run()
        .add_picture(BytesIO(payload), width=Pt(width), height=Pt(height))
        ._inline
    )
    # Turn an inline picture into an absolute, behind-text page anchor.
    anchor = OxmlElement("wp:anchor")
    for key, value in {
        "distT": "0",
        "distB": "0",
        "distL": "0",
        "distR": "0",
        "simplePos": "0",
        "relativeHeight": "0",
        "behindDoc": "1",
        "locked": "1",
        "layoutInCell": "1",
        "allowOverlap": "1",
    }.items():
        anchor.set(key, value)
    simple = OxmlElement("wp:simplePos")
    simple.set("x", "0")
    simple.set("y", "0")
    anchor.append(simple)
    for axis in ("H", "V"):
        position = OxmlElement("wp:position" + axis)
        position.set("relativeFrom", "page")
        offset = OxmlElement("wp:posOffset")
        offset.text = "0"
        position.append(offset)
        anchor.append(position)
    anchor.append(inline.find(qn("wp:extent")))
    anchor.append(OxmlElement("wp:wrapNone"))
    properties = inline.find(qn("wp:docPr"))
    properties.set("id", str(identity))
    properties.set("name", f"Page {identity} background")
    properties.set(
        "descr", "Fixed template artwork, photographs and report annotations"
    )
    anchor.append(properties)
    anchor.append(inline.find(qn("wp:cNvGraphicFramePr")))
    anchor.append(inline.find(qn("a:graphic")))
    inline.getparent().replace(inline, anchor)


def _run_properties(field, size):
    formatting = OxmlElement("w:rPr")
    fonts = OxmlElement("w:rFonts")
    for key in ("ascii", "hAnsi", "eastAsia", "cs"):
        fonts.set(qn("w:" + key), WORD_FONTS[field.font])
    formatting.append(fonts)
    if "Bold" in field.font:
        formatting.append(OxmlElement("w:b"))
    color = OxmlElement("w:color")
    color.set(qn("w:val"), field.color.lstrip("#"))
    formatting.append(color)
    for tag in ("sz", "szCs"):
        element = OxmlElement("w:" + tag)
        element.set(qn("w:val"), str(round(size * 2)))
        formatting.append(element)
    return formatting


def _paragraph_properties(size, alignment):
    return parse_xml(
        f'<w:pPr {nsdecls("w")}><w:spacing w:before="0" w:after="0" w:line="{round(size * 20 * 1.15)}" w:lineRule="exact"/><w:jc w:val="{alignment}"/></w:pPr>'
    )


def _add_shape(paragraph, identity, x, y, width, height, content, extra_style=""):
    pict = OxmlElement("w:pict")
    shape = etree.SubElement(pict, f"{{{V}}}rect", nsmap={"v": V, "o": O})
    shape.set("id", identity)
    shape.set("filled", "f")
    shape.set("stroked", "f")
    shape.set(
        "style",
        f"position:absolute;margin-left:{x:.3f}pt;margin-top:{y:.3f}pt;width:{width:.3f}pt;height:{height:.3f}pt;z-index:1;mso-position-horizontal-relative:page;mso-position-vertical-relative:page{extra_style}",
    )
    textbox = etree.SubElement(shape, f"{{{V}}}textbox")
    textbox.set("inset", "0,0,0,0")
    box_content = OxmlElement("w:txbxContent")
    box_content.append(content)
    textbox.append(box_content)
    paragraph.add_run()._r.append(pict)
    return shape


def _text_box(paragraph, line, x, y, width, identity, field):
    size = line["chars"][0]["size"]
    p = OxmlElement("w:p")
    p.append(_paragraph_properties(size, "left"))
    run = OxmlElement("w:r")
    run.append(_run_properties(field, size))
    text = OxmlElement("w:t")
    text.set(qn("xml:space"), "preserve")
    text.text = line["text"]
    run.append(text)
    p.append(run)
    _add_shape(paragraph, f"ReportValue_{identity}", x, y, width, size * 1.6, p)


def _empty_field_box(paragraph, field, page, identity):
    """An invisible box to type in. Without the paragraph-mark formatting, typed text
    would use the document's 1pt Normal style."""
    width, height = field.width * page.width, field.height * page.height
    size = max(4, min(field.font_size, height / 1.2))
    p = OxmlElement("w:p")
    properties = _paragraph_properties(size, field.alignment)
    properties.append(_run_properties(field, size))
    p.append(properties)
    shape = _add_shape(
        paragraph, f"EmptyField_{identity}", field.x * page.width, field.y * page.height,
        width, height, p,
        "" if field.kind == "textarea" else ";v-text-anchor:middle",
    )
    shape.set("alt", field.label)


def generate_docx(blank_pdf, definition, report, images, empty_fields=False):
    """With empty_fields, also add a box to type in for every field except photos and ticks."""
    # This also applies the same validation/auto-fit rules as PDF downloads.
    layers = generate_field_layers(definition, report, images)
    report = report.model_copy(update={"layout": {
        **report.layout,
        **{key: PageBox.model_validate(box) for key, box in layers["layout"].items()},
    }})
    artwork_definition = definition.model_copy(deep=True)
    artwork_report = report.model_copy(deep=True)
    for field in artwork_definition.fields:
        if field.kind not in {"image", "checkbox"}:
            field.default_value = ""
            if field.kind == "calculated":
                field.kind, field.calculation = "text", None
            artwork_report.values[field.id] = ""
        elif field.kind == "checkbox":
            artwork_report.values[field.id] = (
                report.values.get(field.id, field.default_value) is True
            )
    artwork = generate_pdf(blank_pdf, artwork_definition, artwork_report, images)
    document = Document()
    document.core_properties.title = report.title
    document.core_properties.author = ""
    document.core_properties.comments = "Fixed-layout export. Report values are editable Word text boxes; template artwork is not reconstructed as native Word tables."
    normal = document.styles["Normal"]
    normal.paragraph_format.space_before = Pt(0)
    normal.paragraph_format.space_after = Pt(0)
    normal.paragraph_format.line_spacing = Pt(1)
    normal.font.size = Pt(1)
    page_paragraphs = []
    with pdfium.PdfDocument(artwork) as rendered:
        for index, page in enumerate(definition.pages):
            section = (
                document.sections[0]
                if index == 0
                else document.add_section(WD_SECTION_START.NEW_PAGE)
            )
            section.page_width, section.page_height = Pt(page.width), Pt(page.height)
            section.left_margin = section.right_margin = section.top_margin = (
                section.bottom_margin
            ) = Pt(0)
            section.header_distance = section.footer_distance = Pt(0)
            paragraph = document.add_paragraph()
            page_paragraphs.append(paragraph)
            picture = BytesIO()
            rendered[index].render(
                scale=min(2, 2400 / max(page.width, page.height))
            ).to_pil().save(picture, format="PNG")
            _page_picture(
                paragraph, picture.getvalue(), page.width, page.height, index + 1
            )
    if layers["pdf"]:
        import base64

        fields = {field.id: field for field in definition.fields}
        with pdfplumber.open(BytesIO(base64.b64decode(layers["pdf"]))) as values_pdf:
            identity = 0
            for layer_page, field_id in zip(values_pdf.pages, layers["fields"]):
                field = fields[field_id]
                style = report.styles.get(field_id)
                styled = (
                    field.model_copy(update=style.model_dump(exclude_none=True))
                    if style
                    else field
                )
                box = report.layout.get(field_id, field)
                page = definition.pages[box.page]
                for line in layer_page.extract_text_lines(return_chars=True):
                    identity += 1
                    size = line["chars"][0]["size"]
                    x = box.x * page.width + line["x0"]
                    y = box.y * page.height + line["top"] - size * 0.12
                    _text_box(
                        page_paragraphs[box.page],
                        line,
                        x,
                        y,
                        max(1, page.width - x),
                        identity,
                        styled,
                    )
    if empty_fields:
        typed = [field for field in definition.fields if field.kind not in {"image", "checkbox"}]
        for identity, field in enumerate(typed, start=1):
            _empty_field_box(page_paragraphs[field.page], field, definition.pages[field.page], identity)
    output = BytesIO()
    document.save(output)
    return output.getvalue()

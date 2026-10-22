"""Discover candidate fields, clear reviewed regions, and render generic reports."""

from io import BytesIO
from math import sqrt
import re
from uuid import uuid4

import pdfplumber
import pypdfium2 as pdfium
from PIL import Image, ImageColor, ImageDraw, ImageOps
from pypdf import PdfReader, PdfWriter
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfgen import canvas

from .template_models import (
    ClearArea,
    PageBox,
    PageSize,
    TemplateDefinition,
    TemplateField,
    TemplateReport,
    resolved_values,
)
from .table_detection import refine_table_layout


def inspect_pdf(payload: bytes) -> list[PageSize]:
    try:
        reader = PdfReader(BytesIO(payload))
        if reader.is_encrypted:
            raise ValueError("Upload an unencrypted PDF")
        if not 1 <= len(reader.pages) <= 20:
            raise ValueError("Templates must contain between 1 and 20 pages")
        with pdfium.PdfDocument(payload) as document:
            pages = [
                PageSize(width=page.get_width(), height=page.get_height())
                for page in document
            ]
        return pages
    except ValueError:
        raise
    except Exception as error:
        raise ValueError("The uploaded file could not be read as a PDF") from error


def _box(page, x0, top, x1, bottom, size):
    x0, top = max(0, x0), max(0, top)
    x1, bottom = min(size.width, x1), min(size.height, bottom)
    return dict(
        page=page,
        x=x0 / size.width,
        y=top / size.height,
        width=(x1 - x0) / size.width,
        height=(bottom - top) / size.height,
    )


def _intersects(a, b):
    """Positive-area intersection; touching neighbouring cells are distinct."""
    return min(a[2], b[2]) > max(a[0], b[0]) and min(a[3], b[3]) > max(a[1], b[1])


def _needs_cover(page, bounds):
    """White paper/white-filled fields and image overlays need attached covers."""
    l, t, r, b = bounds
    if any(_intersects(bounds, (i["x0"], i["top"], i["x1"], i["bottom"])) for i in page.images):
        return True
    background = 1.0  # Unpainted PDF paper is white.
    for rect in page.rects:
        if not rect.get("fill"):
            continue
        overlap = max(0, min(r, rect["x1"]) - max(l, rect["x0"])) * max(0, min(b, rect["bottom"]) - max(t, rect["top"]))
        if overlap > (r-l)*(b-t)*0.5:
            colour = rect.get("non_stroking_color")
            background = colour if colour is not None else 0.0  # PDF's default fill is black.
    if isinstance(background, (int, float)):
        return background >= .95
    # Word renderers can emit named PDF pattern/spot colours, not RGB numbers.
    # Unknown paint must not be assumed white or compared numerically.
    if not isinstance(background, (tuple, list)) or not background or not all(
        isinstance(value, (int, float)) for value in background
    ):
        return False
    if len(background) == 4:  # CMYK white has no ink.
        return all(value <= .05 for value in background)
    return all(value >= .95 for value in background)


def analyze_pdf(payload: bytes) -> dict:
    sizes = inspect_pdf(payload)
    fields, clear_areas, scanned_pages = [], [], []
    reader = PdfReader(BytesIO(payload))
    with pdfplumber.open(BytesIO(payload)) as document:
        for page_number, (page, size) in enumerate(zip(document.pages, sizes)):
            words = page.extract_words(extra_attrs=["size", "fontname"])
            if not words:
                scanned_pages.append(page_number)
            # Interactive widgets are authoritative; their coordinates are in PDF space.
            widgets = []
            for reference in reader.pages[page_number].get("/Annots", []):
                widget = reference.get_object()
                if widget.get("/Subtype") != "/Widget" or not widget.get("/Rect"):
                    continue
                parent = widget.get("/Parent")
                attrs = parent.get_object() if parent else widget
                x0, y0, x1, y1 = map(float, widget["/Rect"])
                # Rotate coordinates to match the rendered page.
                media = reader.pages[page_number].mediabox
                mw, mh = float(media.width), float(media.height)
                points = [
                    (x0 - float(media.left), y0 - float(media.bottom)),
                    (x1 - float(media.left), y1 - float(media.bottom)),
                ]
                rotation = int(reader.pages[page_number].get("/Rotate", 0)) % 360

                def rotate(x, y):
                    if rotation == 90:
                        return y, x
                    if rotation == 180:
                        return mw - x, y
                    if rotation == 270:
                        return mh - y, mw - x
                    return x, mh - y

                points = [rotate(*point) for point in points]
                left, top = min(p[0] for p in points), min(p[1] for p in points)
                right, bottom = max(p[0] for p in points), max(p[1] for p in points)
                kind = (
                    "checkbox"
                    if attrs.get("/FT") == "/Btn"
                    else "select"
                    if attrs.get("/FT") == "/Ch"
                    else "text"
                )
                options = [
                    str(item[-1] if isinstance(item, list) else item)
                    for item in attrs.get("/Opt", [])
                ]
                if kind == "select" and not options:
                    kind = "text"
                box = _box(page_number, left + 1, top + 1, right - 1, bottom - 1, size)
                if box["width"] <= 0 or box["height"] <= 0:
                    continue
                label = str(
                    attrs.get("/TU") or attrs.get("/T") or f"Field {len(fields) + 1}"
                )[:160]
                role = (
                    "company"
                    if label.lower() in {"company", "company name"} and kind == "text"
                    else "report_date"
                    if label.lower() in {"date", "report date", "job date"}
                    and kind == "text"
                    else None
                )
                if role == "report_date":
                    kind = "date"
                if role and any(f.role == role for f in fields):
                    role = None
                field = TemplateField(
                    id=str(uuid4()),
                    label=label,
                    kind=kind,
                    role=role,
                    options=options,
                    suggested_value=str(attrs.get("/V", ""))[:2000],
                    **box,
                )
                fields.append(field)
                clear_areas.append(ClearArea(id=field.id, **box))
                widgets.append((left, top, right, bottom))
            candidates = [(r["x0"], r["top"], r["x1"], r["bottom"]) for r in page.rects]
            candidates.extend(
                (curve["x0"], curve["top"], curve["x1"], curve["bottom"])
                for curve in page.curves
                if any(command[0] == "h" for command in curve.get("path", []))
            )
            for table in page.find_tables():
                candidates.extend(table.cells)
            unique = {}
            for cell in candidates:
                if cell is None:
                    continue
                left, top, right, bottom = cell
                width, height = right - left, bottom - top
                if (
                    width < 12
                    or height < 12
                    or (width > size.width * 0.9 and height > size.height * 0.9)
                ):
                    continue
                unique[tuple(round(n / 2) * 2 for n in cell)] = cell
            # Rounded coordinate buckets alone miss double borders when one edge
            # falls on either side of a bucket. Prefer the smaller cell and reject
            # substantially identical outlines using their actual geometry.
            cells = []
            for cell in sorted(unique.values(), key=lambda c: (c[2] - c[0]) * (c[3] - c[1])):
                if not any(all(abs(a - b) <= 2 for a, b in zip(cell, kept)) for kept in cells):
                    cells.append(cell)
            occupied = list(widgets)
            shaded = [(r["x0"], r["top"], r["x1"], r["bottom"]) for r in page.rects
                      if r.get("fill") and isinstance(r.get("non_stroking_color"), (tuple, list))
                      and len(r["non_stroking_color"]) == 3
                      and max(r["non_stroking_color"]) - min(r["non_stroking_color"]) > 0.15]
            original_cells = cells
            cells, table_fields = refine_table_layout(cells, words, page_number, size, shaded)
            widget_conflict = any(_intersects(
                (f.x * size.width, f.y * size.height, (f.x + f.width) * size.width, (f.y + f.height) * size.height), w
            ) for f in table_fields for w in widgets)
            if table_fields and (len(fields) + len(table_fields) > 300 or widget_conflict):
                cells, table_fields = original_cells, []
            if table_fields:
                fields.extend(table_fields)
                clear_areas.extend(ClearArea(**f.model_dump(include={"id", "page", "x", "y", "width", "height"})) for f in table_fields)
            for left, top, right, bottom in cells:
                if len(fields) >= 300:
                    break
                if any(
                    left <= w[0] + 2
                    and top <= w[1] + 2
                    and right >= w[2] - 2
                    and bottom >= w[3] - 2
                    for w in widgets
                ):
                    continue
                # Prefer the smallest table cells, not an enclosing decorative frame.
                if any(
                    l >= left - 1
                    and t >= top - 1
                    and r <= right + 1
                    and b <= bottom + 1
                    and (r - l) * (b - t) < (right - left) * (bottom - top) * 0.8
                    for l, t, r, b in cells
                ):
                    continue
                inside = [
                    w
                    for w in words
                    if left - 1 <= w["x0"]
                    and w["x1"] <= right + 1
                    and top - 1 <= w["top"]
                    and w["bottom"] <= bottom + 1
                ]
                inside.sort(key=lambda w: (round(w["top"] / 4), w["x0"]))
                caption = []
                if inside:
                    first_top = inside[0]["top"]
                    first_line = [w for w in inside if abs(w["top"] - first_top) < 4]
                    if (
                        first_top - top < 12
                        and (
                            max(w["size"] for w in first_line) <= 10
                            or " ".join(w["text"] for w in first_line).endswith(":")
                        )
                        and bottom - max(w["bottom"] for w in first_line) >= 13
                    ):
                        caption = first_line
                label = " ".join(w["text"] for w in caption).rstrip(":")
                if not label:
                    nearby = [
                        w
                        for w in words
                        if (abs(w["top"] - top) < 10 and 0 <= left - w["x1"] < 160)
                        or (left <= w["x0"] < right and 0 <= top - w["bottom"] < 22)
                    ]
                    label = (
                        " ".join(w["text"] for w in nearby)[:160]
                        or f"Field {len(fields) + 1}"
                    )
                value_words = [w for w in inside if w not in caption]
                # In a label/value row, preserve the text-only cell on the left.
                if (
                    inside
                    and not caption
                    and not any(re.search(r"\d", w["text"]) for w in inside)
                    and any(
                        abs(l - right) < 4 and abs(t - top) < 3 and abs(b - bottom) < 3
                        for l, t, r, b in cells
                    )
                ):
                    continue
                field_top = (
                    max(w["bottom"] for w in caption) + 3 if caption else top + 3
                )
                if bottom - field_top < 5:
                    continue
                role = (
                    "company"
                    if label.lower() in {"company", "company name"}
                    else "report_date"
                    if label.lower() in {"date", "report date", "job date"}
                    else None
                )
                kind = (
                    "date"
                    if role == "report_date"
                    else "text"
                    if role == "company"
                    else "image"
                    if any(s in label.lower() for s in ("photo", "image", "picture"))
                    else "textarea"
                    if bottom - field_top > 45
                    else "text"
                )
                image_inside = any(
                    max(0, min(right, image["x1"]) - max(left, image["x0"]))
                    * max(0, min(bottom, image["bottom"]) - max(top, image["top"]))
                    > (right - left) * (bottom - top) * 0.5
                    for image in page.images
                )
                if image_inside and not role:
                    kind = "image"
                if (
                    kind == "text"
                    and not role
                    and re.fullmatch(
                        r"\s*-?\d+(?:[.,]\d+)?(?:\s*[%°CF]+)?\s*",
                        " ".join(w["text"] for w in value_words),
                    )
                ):
                    kind = "number"
                if right - left < 28 and bottom - top < 28:
                    kind, role = "checkbox", None
                box = _box(
                    page_number, left + 3, field_top, right - 3, bottom - 3, size
                )
                if box["width"] <= 0 or box["height"] <= 0:
                    continue
                editable = (left + 3, field_top, right - 3, bottom - 3)
                if any(_intersects(editable, existing) for existing in occupied):
                    continue
                source_font = (
                    str(value_words[0].get("fontname", "")) if value_words else ""
                )
                font = (
                    "Courier"
                    if "courier" in source_font.lower()
                    else "Helvetica"
                    if any(
                        name in source_font.lower()
                        for name in ("arial", "helvetica", "sans")
                    )
                    else "Times-Roman"
                )
                if "bold" in source_font.lower() and font != "Courier":
                    font = "Helvetica-Bold" if font == "Helvetica" else "Times-Bold"
                font_size = min(
                    72,
                    max(4, max((w.get("size", 16) for w in value_words), default=16)),
                )
                field = TemplateField(
                    id=str(uuid4()),
                    label=label[:160],
                    kind=kind,
                    role=role,
                    required=kind not in {"image", "checkbox"},
                    font=font,
                    font_size=font_size,
                    suggested_value=" ".join(w["text"] for w in value_words)[:2000],
                    **box,
                )
                # Repeated header labels are only suggestions; only one gets a filter role.
                if role and any(f.role == role for f in fields):
                    field.role = None
                fields.append(field)
                occupied.append(editable)
                if _needs_cover(page, editable) or (value_words and (caption or kind == "number")) or image_inside:
                    clear_areas.append(ClearArea(id=field.id, **box))
    definition = TemplateDefinition(pages=sizes, fields=fields, clear_areas=clear_areas)
    return {
        "definition": definition.model_dump(mode="json"),
        "scanned_pages": scanned_pages,
        "warnings": [
            "Field detection is a suggestion. Review labels, boundaries, and areas to clear before saving."
        ],
    }


def clean_pdf(payload: bytes, definition: TemplateDefinition) -> tuple[bytes, bytes]:
    sizes = inspect_pdf(payload)
    if len(sizes) != len(definition.pages) or any(
        abs(a.width - b.width) > 0.5 or abs(a.height - b.height) > 0.5
        for a, b in zip(sizes, definition.pages)
    ):
        raise ValueError("Template page sizes must match the uploaded PDF")
    # Rasterize before clearing: old sample values must not survive beneath a white overlay.
    output = BytesIO()
    pdf = canvas.Canvas(output)
    thumbnail = b""
    with pdfium.PdfDocument(payload) as document:
        for number, size in enumerate(sizes):
            page = document[number]
            scale = min(3, sqrt(16_000_000 / (size.width * size.height)))
            bitmap = page.render(scale=scale, draw_annots=True)
            image = bitmap.to_pil().convert("RGB")
            draw = ImageDraw.Draw(image)
            for area in definition.clear_areas:
                if area.page != number:
                    continue
                # Half-open pixel bounds avoid painting over a border at the far edge.
                draw.rectangle(
                    (
                        round(area.x * image.width),
                        round(area.y * image.height),
                        round((area.x + area.width) * image.width) - 1,
                        round((area.y + area.height) * image.height) - 1,
                    ),
                    fill=area.color,
                )
            pdf.setPageSize((size.width, size.height))
            pdf.drawImage(
                ImageReader(image), 0, 0, width=size.width, height=size.height
            )
            pdf.showPage()
            if number == 0:
                image.thumbnail((360, 480))
                thumb = BytesIO()
                image.save(thumb, "PNG")
                thumbnail = thumb.getvalue()
            bitmap.close()
            page.close()
    pdf.save()
    return output.getvalue(), thumbnail


def _wrap(text, font, size, width):
    lines = []
    for paragraph in text.split("\n"):
        line = ""
        for word in paragraph.split():
            candidate = f"{line}{word}".strip()
            if line and pdfmetrics.stringWidth(candidate, font, size) > width:
                lines.append(line)
                line = ""
            # Split a single long token so it cannot bleed beyond its field.
            for char in word:
                if pdfmetrics.stringWidth(line + char, font, size) > width and line:
                    lines.append(line)
                    line = ""
                line += char
            line += " "
        lines.append(line.rstrip())
    return lines



def _display_value(field, values):
    value = str(values.get(field.id, ""))
    if field.kind == "date" and value:
        from datetime import date
        return date.fromisoformat(value).strftime("%d %b %Y")
    return value


def report_field_box(field, box, page, report, values):
    """Honor the effective font size, inherited or overridden, by growing boxes."""
    style = report.styles.get(field.id)
    if field.kind in {"image", "checkbox"}:
        return box
    font = (style.font if style else None) or field.font
    size = style.font_size if style and style.font_size is not None else field.font_size
    value = _display_value(field, values)
    desired_width = max((pdfmetrics.stringWidth(line, font, size) + 2
                         for line in value.split("\n")), default=2)
    width = min(page.width, max(box.width * page.width, desired_width))
    lines = _wrap(value, font, size, max(1, width - 2))
    height = max(box.height * page.height, len(lines) * size * 1.15 + 2)
    if height > page.height or any(pdfmetrics.stringWidth(line, font, size) > width - 2 + .001 for line in lines):
        raise ValueError(f"{field.label} does not fit on this page at {size:g} pt. Shorten the text or select a smaller font.")
    width, height = width / page.width, height / page.height
    return PageBox(page=box.page, x=max(0, min(box.x, 1-width)),
                   y=max(0, min(box.y, 1-height)), width=width, height=height)


def _paint_field(pdf, field, box, page, report, values, images):
    x, y = box.x * page.width, (1 - box.y - box.height) * page.height
    width, height = box.width * page.width, box.height * page.height
    pdf.saveState()
    clip = pdf.beginPath()
    clip.rect(x, y, width, height)
    pdf.clipPath(clip, fill=0, stroke=0)
    pdf.setFillColorRGB(*(n / 255 for n in ImageColor.getrgb(field.color)))
    if field.kind == "image" and field.id in images:
        with Image.open(BytesIO(images[field.id])) as source:
            image = ImageOps.exif_transpose(source).convert("RGB")
            target = (max(1, round(width * 3)), max(1, round(height * 3)))
            # Always fill the box, including legacy templates saved as "contain".
            # Crop only this rendered copy; keep the original upload for OCR.
            image = ImageOps.fit(image, target, centering=(0.5, 0.5))
            pdf.drawImage(ImageReader(image), x, y, width=width, height=height)
        for rect in report.rectangles:
            if rect.image_field != field.id:
                continue
            pdf.setStrokeColorRGB(
                *(n / 255 for n in ImageColor.getrgb(rect.color))
            )
            pdf.setLineWidth(rect.stroke_width)
            # Inset by half the stroke so it stays within its image box.
            inset = rect.stroke_width / 2
            rw, rh = rect.width * width, rect.height * height
            pdf.rect(
                x + rect.x * width + inset,
                y + (1 - rect.y - rect.height) * height + inset,
                max(0, rw - 2 * inset),
                max(0, rh - 2 * inset),
                fill=0,
            )
    elif field.kind == "checkbox" and values.get(field.id) is True:
        pad = min(width, height) * 0.2
        pdf.setStrokeColorRGB(
            *(n / 255 for n in ImageColor.getrgb(field.color))
        )
        pdf.setLineWidth(min(2, width * 0.08))
        path = pdf.beginPath()
        path.moveTo(x + pad, y + height * 0.5)
        path.lineTo(x + width * 0.43, y + pad)
        path.lineTo(x + width - pad, y + height - pad)
        pdf.drawPath(path)
    elif field.kind not in {"image", "checkbox"}:
        value = _display_value(field, values)
        if not value:
            pdf.restoreState()
            return
        size = field.font_size
        lines = _wrap(value, field.font, size, max(1, width - 2))
        if len(lines) * size * 1.15 > height or any(
            pdfmetrics.stringWidth(line, field.font, size) > max(0, width - 2)
            for line in lines
        ):
            raise ValueError(
                f"{field.label} text does not fit. Enlarge this field or shorten the text."
            )
        pdf.setFont(field.font, size)
        baseline = y + height - 1 - size
        for line in lines:
            if field.alignment == "center":
                pdf.drawCentredString(x + width / 2, baseline, line)
            elif field.alignment == "right":
                pdf.drawRightString(x + width - 1, baseline, line)
            else:
                pdf.drawString(x + 1, baseline, line)
            baseline -= size * 1.15
    pdf.restoreState()


def generate_pdf(
    blank_pdf: bytes,
    definition: TemplateDefinition,
    report: TemplateReport,
    images: dict[str, bytes],
) -> bytes:
    report.validate_for(definition)
    values = resolved_values(definition, report)
    overlay_buffer = BytesIO()
    pdf = canvas.Canvas(overlay_buffer)
    # Preserve definition order within each page without rescanning every field per page.
    fields_by_page = [[] for _ in definition.pages]
    for field in definition.fields:
        box = report.layout.get(field.id, field)
        box = report_field_box(field, box, definition.pages[box.page], report, values)
        fields_by_page[box.page].append((field, box))
    shapes_by_page = [[] for _ in definition.pages]
    for shape in report.rectangles:
        if shape.page is not None:
            shapes_by_page[shape.page].append(shape)
    for number, page in enumerate(definition.pages):
        pdf.setPageSize((page.width, page.height))
        for field, box in fields_by_page[number]:
            style = report.styles.get(field.id)
            styled = field.model_copy(update=style.model_dump(exclude_none=True)) if style else field
            _paint_field(pdf, styled, box, page, report, values, images)
        # New annotations use page coordinates; legacy photo rectangles above remain valid.
        for shape in shapes_by_page[number]:
            x, y = shape.x * page.width, (1 - shape.y - shape.height) * page.height
            width, height = shape.width * page.width, shape.height * page.height
            pdf.saveState()
            pdf.setStrokeColorRGB(*(n / 255 for n in ImageColor.getrgb(shape.color)))
            line_width = min(shape.stroke_width, width / 3, height / 3)
            pdf.setLineWidth(line_width)
            inset = line_width / 2
            if shape.kind == "tick":
                from .pdf_shapes import draw_tick
                draw_tick(pdf, x, y, width, height, shape.color)
            else:
                pdf.rect(
                    x + inset,
                    y + inset,
                    max(0, width - line_width),
                    max(0, height - line_width),
                    fill=0,
                )
            pdf.restoreState()
        pdf.showPage()
    pdf.save()
    overlay_buffer.seek(0)
    overlay = PdfReader(overlay_buffer)
    writer = PdfWriter(clone_from=BytesIO(blank_pdf))
    for index, page in enumerate(writer.pages):
        page.merge_page(overlay.pages[index])
    writer.add_metadata({"/Title": report.title})
    result = BytesIO()
    writer.write(result)
    return result.getvalue()


def generate_field_layers(definition, report, images):
    """Small transparent PDF pages for each populated field, with no template pixels."""
    import base64
    from .template_models import PageBox, PageSize
    report.validate_for(definition)
    values = resolved_values(definition, report)
    buffer = BytesIO()
    pdf = canvas.Canvas(buffer)
    ids = []
    layout = {}
    no_shapes = report.model_copy(update={"rectangles": []})
    for field in definition.fields:
        box = report.layout.get(field.id, field)
        page = definition.pages[box.page]
        box = report_field_box(field, box, page, report, values)
        style = report.styles.get(field.id)
        if field.kind not in {"image", "checkbox"}:
            layout[field.id] = box.model_dump(mode="json")
        if not (field.id in images if field.kind == "image" else values.get(field.id)):
            continue
        size = PageSize(width=box.width*page.width, height=box.height*page.height)
        pdf.setPageSize((size.width, size.height))
        style = report.styles.get(field.id)
        styled = field.model_copy(update=style.model_dump(exclude_none=True)) if style else field
        _paint_field(pdf, styled, PageBox(page=0,x=0,y=0,width=1,height=1), size, no_shapes, values, images)
        pdf.showPage()
        ids.append(field.id)
    pdf.save()
    return {"pdf": base64.b64encode(buffer.getvalue()).decode() if ids else None, "fields": ids, "layout": layout}

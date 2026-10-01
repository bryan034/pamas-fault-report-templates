from __future__ import annotations

from dataclasses import dataclass, replace # dataclass helps define FieldBox below, replace will later make modified copy of FieldBox
from io import BytesIO # provides file-like obj held in memory (build pdf without saving it to disk -- for preview)
from pathlib import Path

from PIL import Image, ImageOps # Pillow's image opens and processes uploaded pics, ImageOps provides image transformations
# Pillow (PIL (Python Imaging Library) was original library, now discontinued and forked to become Pillow) 
# package used for image resizing, format conversions, basic image processing, drawing/ annotation/ working with bytes
from pypdf import PdfReader, PdfWriter
from reportlab.lib.pagesizes import letter #provides letter dimensions
from reportlab.lib.utils import ImageReader #adapts image so it can drawn onto a pdf canvas
from reportlab.pdfbase import pdfmetrics #measures text and manages registered fonts
from reportlab.pdfbase.ttfonts import TTFont #lets reportlab use a TrueType .ttf font file
from reportlab.pdfgen import canvas #reportlab drawing surface for text, images, 

from .models import ImageRectangle, RepairPriority, ReportData


ROOT = Path(__file__).resolve().parents[1]
SOURCE_TEMPLATE_PATH = ROOT / "assets" / "fault_report_template.pdf"
TEMPLATE_PATH = ROOT / "assets" / "fault_report_blank_template.pdf"
PAGE_WIDTH, PAGE_HEIGHT = letter
FONT = "Times-Roman"
TITLE_FONT = "TemplateTimesNewRomanBold"
FULL_TITLE_FONT_PATHS = (
    Path("/System/Library/Fonts/Supplemental/Times New Roman Bold.ttf"),
    Path("/Library/Fonts/Times New Roman Bold.ttf"),
    Path("/usr/share/fonts/truetype/msttcorefonts/Times_New_Roman_Bold.ttf"),
    Path("/usr/share/fonts/truetype/liberation2/LiberationSerif-Bold.ttf"),
)
TEMPLATE_BLUE = (0, 0, 130 / 255)


def _register_title_font() -> str:
    # The font embedded in the sample PDF contains only the glyphs it used;
    # notably it has no zero. Use the complete face when it is installed.
    if TITLE_FONT in pdfmetrics.getRegisteredFontNames():
        return TITLE_FONT
    for path in FULL_TITLE_FONT_PATHS:
        if path.exists():
            pdfmetrics.registerFont(TTFont(TITLE_FONT, str(path)))
            return TITLE_FONT
    return "Times-Bold"


@dataclass(frozen=True) # creates initialiser so code can write FieldBox(90,557,...)
# frozen=True prevents modifying exisiting box 
# later code can use replace() to create a changed copy
class FieldBox:
    x: float
    y: float
    width: float
    height: float
    maximum: float
    minimum: float = 6
    alignment: str = "center"
    size_group: str | None = None #optionally connects fields to a font size setting (like temperatures)
    font: str = FONT


# Runtime content is drawn without a background so master form lines stay visible. 
FIELDS = {
    "report_number": FieldBox(284, 729, 32, 26, 24, 8, size_group="report_number", font=TITLE_FONT),
    "company": FieldBox(90, 667, 154, 24, 18, 6, size_group="company"),
    "division": FieldBox(90, 617, 150, 26, 18, 6, size_group="division"),
    "report_date": FieldBox(113, 571, 125, 21, 18, 6, size_group="date"),
    "report_time": FieldBox(129, 526, 72, 23, 18, 6, size_group="time"),
    "period": FieldBox(203, 526, 44, 23, 18, 6, size_group="time"),
    "emissivity": FieldBox(470, 573, 44, 19, 18, 6, size_group="emissivity"),
    "bx1": FieldBox(190, 489, 44, 18, 14, 6, size_group="temperatures"),
    "bx2": FieldBox(190, 469, 44, 18, 14, 6, size_group="temperatures"),
    "delta_t": FieldBox(190, 449, 44, 18, 14, 6, size_group="temperatures"),
    "ambient_temp": FieldBox(190, 429, 44, 18, 14, 6, size_group="temperatures"),
    "phase": FieldBox(90, 385, 140, 28, 18, 6, size_group="phase"),
    "rated_current": FieldBox(151, 263, 36, 75, 14, 6, size_group="currents"),
    "l1_current": FieldBox(190, 322, 44, 20, 14, 6, size_group="currents"),
    "l2_current": FieldBox(190, 300, 44, 20, 14, 6, size_group="currents"),
    "l3_current": FieldBox(190, 280, 44, 20, 14, 6, size_group="currents"),
    "neutral_current": FieldBox(190, 260, 44, 20, 14, 6, size_group="currents"),
    "l1_load": FieldBox(244, 322, 42, 20, 14, 6, size_group="currents"),
    "l2_load": FieldBox(244, 300, 42, 20, 14, 6, size_group="currents"),
    "l3_load": FieldBox(244, 280, 42, 20, 14, 6, size_group="currents"),
    "neutral_load": FieldBox(244, 260, 42, 20, 14, 6, size_group="currents"),
}

IMAGE_FRAMES = {
    # Inset from the printed outlines so uploaded images cannot cover the borders.
    "equipment": (304.5, 373.5, 238.0, 178.0),
    "infrared": (304.5, 196.3, 238.0, 168.0),
}

CLEAN_IMAGE_FRAMES = {
    # Erase through the inner edge of the source photo. The original outline
    # remains untouched at the top, left, and right.
    "equipment": (302.5, 372.0, 243.0, 182.6),
    "infrared": (303.0, 194.8, 241.0, 171.0),
}

# Used once to clean the supplied example. Never painted into report overlays.
MASKS = [ #(x,y,width,height)
    (284, 729, 32, 26), (90, 667, 154, 24), (120, 617, 120, 26),
    (113, 571, 125, 21), (129, 526, 70, 20), (205, 526, 38, 20),
    (485.5, 635.5, 33, 20),
    (407, 621, 75, 9),
    (474, 573, 38, 19), (194, 492, 29, 13), (194, 472, 29, 14),
    (194, 452, 29, 14), (194, 432, 29, 14), (116, 390, 58, 21),
    (153, 287, 31, 29), (196, 325, 33, 12), (196, 303, 33, 12),
    (196, 283, 33, 12), (196, 263, 33, 12), (250, 325, 32, 12),
    (250, 303, 32, 12), (250, 283, 32, 12), (250, 263, 32, 12),
    (90, 201, 168, 33), (92, 113, 448, 52), (87, 39, 454, 43),
]

PRIORITY_CELLS = {
    RepairPriority.IMMEDIATE: (483.5, 680.0, 520.0, 704.0),
    RepairPriority.SOON: (483.5, 657.0, 520.0, 680.0),
    RepairPriority.SHUTDOWN: (483.5, 634.0, 520.0, 657.0),
    RepairPriority.MONITOR: (483.5, 610.0, 520.0, 634.0),
}


def build_blank_template(output_path: Path = TEMPLATE_PATH) -> Path:
    """Remove sample content once while preserving the original form geometry."""
    if not SOURCE_TEMPLATE_PATH.exists():
        raise FileNotFoundError(f"Missing source template: {SOURCE_TEMPLATE_PATH}")
    overlay_buffer = BytesIO() #create in-memory byte buffer for temp PDF overlay
    overlay = canvas.Canvas(overlay_buffer, pagesize=letter) #create Letter-sized ReportLab canvas that writes into that buffer
    overlay.setFillColorRGB(1, 1, 1) #doesnt fill whole overlay white. sets drawing color to white
    for rectangle in [*MASKS, *CLEAN_IMAGE_FRAMES.values()]: # * unpacks iterable from each collection into 1 list
        overlay.rect(*rectangle, fill=1, stroke=0) #unpack rectangle (x,y,width, height). stroke = 0 avoids drawing border. fills them to white
    overlay.setFillColorRGB(*TEMPLATE_BLUE) 
    overlay.setFont("Times-Roman", 10.6997 * 0.75)
    overlay.drawString(547.039978 * 0.75, 792 - 223.039993 * 0.75, "No repair required,")
    overlay.save() 
    overlay_buffer.seek(0) #move buffer read pos back to beginning 
    source = PdfReader(str(SOURCE_TEMPLATE_PATH))
    blanking = PdfReader(overlay_buffer)
    writer = PdfWriter()
    writer.clone_document_from_reader(source)
    writer.pages[0].merge_page(blanking.pages[0]) # places overlay ontop of its first page (source)
    output_path.parent.mkdir(parents=True, exist_ok=True) # ensures directory where file shd live exists 
    # parents = True creates any missing parent directories along the path 
    # exist_ok = True prevents python from throwing FileExistsError if directory alredy exists
    with output_path.open("wb") as destination: #wb stands for write binary mode *(bytes)
        writer.write(destination)
    return output_path


def _requested_size(report: ReportData, field: FieldBox) -> float:
    requested = getattr(report.font_sizes, field.size_group or "", None) #finds optional font-size in report.font_sizes using field.size_group
    return min(field.maximum, requested) if requested is not None else field.maximum


def _offset(report: ReportData, key: str) -> tuple[float, float]:
    value = report.layout_offsets.get(key)
    return (0, 0) if value is None else (value.x, value.y)


def _font_height(size: float, font: str = FONT) -> float:
    """calculates total visual height (in pts) of a text font at a given size using ReportLab's pdfmetrics module"""
    return pdfmetrics.getAscent(font, size) - pdfmetrics.getDescent(font, size) 
    # getAscent returns distance from baseline up to top of highest chr (typically +ve)
    # Descent distance from baseline down to lowest part of letter (typically -ve)


def _fit_single_line(value: str, field: FieldBox, maximum: float) -> float:
    available_width = max(1, field.width - 4)
    available_height = max(1, field.height - 3)
    size = maximum
    while size >= field.minimum:
        if pdfmetrics.stringWidth(value, field.font, size) <= available_width and _font_height(size, field.font) <= available_height: 
            # if width and height of str within avail dimensions, size is acceptable
            return size
        size = round(size - 0.25, 2) 
    if value and pdfmetrics.stringWidth(value, field.font, field.minimum) > available_width: 
        # if text still too wide at minimum width, raise error
        raise ValueError(f'"{value}" does not fit its PDF field at the minimum font size')
    return field.minimum


def _draw_field(pdf: canvas.Canvas, value: str, field: FieldBox, maximum: float, dx: float = 0, dy: float = 0) -> None:
    size = _fit_single_line(value, field, maximum)
    ascent = pdfmetrics.getAscent(field.font, size)
    descent = pdfmetrics.getDescent(field.font, size)
    baseline = field.y + (field.height - (ascent - descent)) / 2 - descent
    pdf.saveState()
    clip = pdf.beginPath()
    clip.rect(field.x + 1, field.y + 1, field.width - 2, field.height - 2)
    pdf.clipPath(clip, fill=0, stroke=0)
    pdf.setFillColorRGB(*(TEMPLATE_BLUE if field.font in (TITLE_FONT, "Times-Bold") else (0, 0, 0)))
    pdf.setFont(field.font, size)
    if field.alignment == "left":
        pdf.drawString(field.x + 2 + dx, baseline - dy, value)
    else:
        pdf.drawCentredString(field.x + field.width / 2 + dx, baseline - dy, value)
    pdf.restoreState()


def _wrap_measured(text: str, size: float, width: float) -> list[str]:
    lines: list[str] = []
    for paragraph in text.split("\n"):
        if not paragraph:
            lines.append("")
            continue
        current = ""
        for word in paragraph.split():
            candidate = f"{current} {word}".strip()
            if pdfmetrics.stringWidth(candidate, FONT, size) <= width:
                current = candidate
                continue
            if current:
                lines.append(current)
                current = ""
            for character in word:
                candidate = current + character
                if current and pdfmetrics.stringWidth(candidate, FONT, size) > width:
                    lines.append(current)
                    current = character
                else:
                    current = candidate
        lines.append(current)
    return lines or [""]


def _fit_multiline(text: str, width: float, height: float, maximum: float, minimum: float) -> tuple[float, float, list[str]]:
    size = maximum
    while size >= minimum:
        leading = size * 1.16
        lines = _wrap_measured(text, size, width - 6)
        if len(lines) * leading <= height - 4:
            return size, leading, lines
        size = round(size - 0.25, 2)
    raise ValueError("Text does not fit in the report template at the minimum font size")


def _draw_multiline(pdf: canvas.Canvas, text: str, field: FieldBox, maximum: float, dx: float = 0, dy: float = 0) -> None:
    size, leading, lines = _fit_multiline(text, field.width, field.height, maximum, field.minimum)
    content_height = len(lines) * leading
    top = field.y + (field.height + content_height) / 2 - size
    pdf.saveState()
    clip = pdf.beginPath()
    clip.rect(field.x + 1, field.y + 1, field.width - 2, field.height - 2)
    pdf.clipPath(clip, fill=0, stroke=0)
    pdf.setFillColorRGB(0, 0, 0)
    pdf.setFont(FONT, size)
    for index, line in enumerate(lines):
        pdf.drawString(field.x + 3 + dx, top - index * leading - dy, line)
    pdf.restoreState()


def _priority_tick_points(priority: RepairPriority, dx: float = 0, dy: float = 0) -> tuple[tuple[float, float], ...]:
    left, bottom, right, top = PRIORITY_CELLS[priority]
    width, height = right - left, top - bottom
    return (
        (left + width * 0.24 + dx, bottom + height * 0.52 - dy),
        (left + width * 0.42 + dx, bottom + height * 0.28 - dy),
        (left + width * 0.76 + dx, bottom + height * 0.72 - dy),
    )


def _draw_priority_tick(pdf: canvas.Canvas, priority: RepairPriority, dx: float = 0, dy: float = 0) -> None:
    first, middle, last = _priority_tick_points(priority, dx, dy)
    path = pdf.beginPath()
    path.moveTo(*first)
    path.lineTo(*middle)
    path.lineTo(*last)
    pdf.saveState()
    left, bottom, right, top = PRIORITY_CELLS[priority]
    clip = pdf.beginPath()
    clip.rect(left + 1, bottom + 1, right - left - 2, top - bottom - 2)
    pdf.clipPath(clip, fill=0, stroke=0)
    pdf.setStrokeColorRGB(1, 0, 0)
    pdf.setLineWidth(1.8)
    pdf.setLineCap(1)
    pdf.setLineJoin(1)
    pdf.drawPath(path, fill=0, stroke=1)
    pdf.restoreState()


def _fit_image(image_bytes: bytes, width: float, height: float) -> ImageReader:
    with Image.open(BytesIO(image_bytes)) as source:
        # JPEG decoders can subsample before loading a large camera original.
        source.draft("RGB", (round(width * 4), round(height * 4)))
        image = ImageOps.exif_transpose(source).convert("RGB")
        target = (max(1, round(width * 4)), max(1, round(height * 4)))
        fitted = ImageOps.fit(image, target, method=Image.Resampling.LANCZOS)
        buffer = BytesIO()
        fitted.save(buffer, format="JPEG", quality=94, optimize=True)
        buffer.seek(0)
        return ImageReader(buffer)


def _draw_image_rectangle(pdf: canvas.Canvas, report: ReportData, rectangle: ImageRectangle) -> None:
    x, y, width, height = IMAGE_FRAMES[rectangle.image]
    dx, dy = _offset(report, f"{rectangle.image}_image")
    color = rectangle.color.lstrip("#")
    pdf.saveState()
    clip = pdf.beginPath()
    clip.rect(x, y, width, height)
    pdf.clipPath(clip, fill=0, stroke=0)
    pdf.setStrokeColorRGB(*(int(color[index:index + 2], 16) / 255 for index in (0, 2, 4)))
    pdf.setLineWidth(rectangle.stroke_width)
    pdf.rect(
        x + dx + rectangle.x * width,
        y - dy + (1 - rectangle.y - rectangle.height) * height,
        rectangle.width * width,
        rectangle.height * height,
        fill=0,
        stroke=1,
    )
    pdf.restoreState()


def _format_temperature(value: float | None) -> str:
    return "" if value is None else str(round(value))


def _format_date(value: str) -> str:
    if not value:
        return ""
    try:
        year, month, day = value.split("-")
        month_name = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")[int(month) - 1]
        return f"{int(day):02d} {month_name} {year}"
    except (ValueError, IndexError):
        return value


def _load_percentage(current: str, rated: str) -> str:
    try:
        measured_value = float(current)
        rated_value = float(rated)
    except (TypeError, ValueError):
        return ""
    if rated_value <= 0:
        return ""
    return f"{round(measured_value / rated_value * 100)}%"


def generate_report_pdf(report: ReportData, equipment_image: bytes | None = None, infrared_image: bytes | None = None) -> bytes:
    title_font = _register_title_font()
    if not TEMPLATE_PATH.exists():
        raise FileNotFoundError(f"Missing blank template: {TEMPLATE_PATH}. Run scripts/build_blank_template.py")
    overlay_buffer = BytesIO()
    overlay = canvas.Canvas(overlay_buffer, pagesize=letter)
    values = report.model_dump()
    values.update(
        bx1=_format_temperature(report.bx1), bx2=_format_temperature(report.bx2),
        delta_t=_format_temperature(report.delta_t), ambient_temp=_format_temperature(report.ambient_temp),
        emissivity="" if report.emissivity is None else f"{report.emissivity:.2f}",
        report_date=_format_date(report.report_date),
        l1_load=_load_percentage(report.l1_current, report.rated_current),
        l2_load=_load_percentage(report.l2_current, report.rated_current),
        l3_load=_load_percentage(report.l3_current, report.rated_current),
        neutral_load=_load_percentage(report.neutral_current, report.rated_current),
    )
    for key, field in FIELDS.items():
        dx, dy = _offset(report, key)
        resolved_field = replace(field, font=title_font) if key == "report_number" else field
        _draw_field(overlay, str(values.get(key, "")), resolved_field, _requested_size(report, resolved_field), dx, dy)
    if report.repair_priority is not None:
        _draw_priority_tick(overlay, report.repair_priority, *_offset(report, "priority_tick"))
    location = report.location_line_1
    location_field = FieldBox(90, 195, 168, 42, 14, 6, "left", "location")
    description_field = FieldBox(92, 111, 448, 54, 14, 6, "left", "description")
    action_field = FieldBox(87, 36, 454, 42, 12, 6, "left", "corrective_action")
    _draw_multiline(overlay, location, location_field, _requested_size(report, location_field), *_offset(report, "location"))
    _draw_multiline(overlay, report.description, description_field, _requested_size(report, description_field), *_offset(report, "description"))
    _draw_multiline(overlay, report.corrective_action, action_field, _requested_size(report, action_field), *_offset(report, "corrective_action"))
    for image_bytes, frame_name in ((equipment_image, "equipment"), (infrared_image, "infrared")):
        if image_bytes:
            x, y, width, height = IMAGE_FRAMES[frame_name]
            dx, dy = _offset(report, f"{frame_name}_image")
            overlay.saveState()
            clip = overlay.beginPath()
            clip.rect(x, y, width, height)
            overlay.clipPath(clip, fill=0, stroke=0)
            overlay.drawImage(_fit_image(image_bytes, width, height), x + dx, y - dy, width=width, height=height, mask="auto")
            overlay.restoreState()
    for rectangle in report.image_rectangles:
        _draw_image_rectangle(overlay, report, rectangle)
    overlay.save()
    overlay_buffer.seek(0)
    template_reader = PdfReader(str(TEMPLATE_PATH))
    overlay_reader = PdfReader(overlay_buffer)
    writer = PdfWriter()
    writer.clone_document_from_reader(template_reader)
    writer.pages[0].merge_page(overlay_reader.pages[0])
    if report.report_title:
        writer.add_metadata({"/Title": report.report_title})
    output = BytesIO()
    writer.write(output)
    return output.getvalue()

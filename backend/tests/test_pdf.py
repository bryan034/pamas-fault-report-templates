from io import BytesIO
from pathlib import Path
from uuid import uuid4

from PIL import Image
from pypdf import PdfReader

from app.models import FontSizes, ImageRectangle, LayoutOffset, RepairPriority, ReportData
from app.pdf_service import PRIORITY_CELLS, _format_date, _load_percentage, _offset, _priority_tick_points, generate_report_pdf


def test_generated_report_is_one_letter_page() -> None:
    payload = generate_report_pdf(ReportData())
    reader = PdfReader(BytesIO(payload))
    assert len(reader.pages) == 1
    page = reader.pages[0]
    assert float(page.mediabox.width) == 612
    assert float(page.mediabox.height) == 792


def test_generated_report_accepts_both_images() -> None:
    fixtures = Path(__file__).parent / "fixtures"
    payload = generate_report_pdf(
        ReportData(),
        (fixtures / "sample_equipment.png").read_bytes(),
        (fixtures / "sample_ir.png").read_bytes(),
    )
    reader = PdfReader(BytesIO(payload))
    assert len(reader.pages) == 1
    assert len(payload) > 100_000


def test_camera_sized_equipment_photo_renders_without_breaking_preview_pdf() -> None:
    # The reported equipment photo was 5152×3864; the export must embed only
    # the much smaller version actually needed by the printed image frame.
    image = Image.new("RGB", (5152, 3864), (110, 115, 120))
    source = BytesIO()
    image.save(source, format="JPEG", quality=92)
    payload = generate_report_pdf(ReportData(), equipment_image=source.getvalue())
    page = PdfReader(BytesIO(payload)).pages[0]
    assert len(payload) - len(generate_report_pdf(ReportData())) < 500_000
    images = list(page.images)
    assert images
    assert any(item.image.width == 952 and item.image.height == 712 for item in images)


def test_image_rectangle_is_saved_in_pdf_overlay() -> None:
    rectangle = ImageRectangle(id=uuid4(), image="equipment", x=0.2, y=0.3,
                               width=0.4, height=0.2, color="#ef2323", stroke_width=3)
    payload = generate_report_pdf(ReportData(image_rectangles=[rectangle]))
    page = PdfReader(BytesIO(payload)).pages[0]
    content = page.get_contents().get_data()
    assert b"3 w" in content
    assert b"0.937255 0.137255 0.137255 RG" in content


def test_long_text_autofits_with_manual_size_ceiling() -> None:
    payload = generate_report_pdf(
        ReportData(
            company="Long Facilities Engineering Company Name",
            location_line_1="Level 5 rooftop distribution area",
            font_sizes=FontSizes(company=24, location=18, description=16),
        )
    )
    assert len(PdfReader(BytesIO(payload)).pages) == 1


def test_priority_ticks_remain_inside_their_cells() -> None:
    for priority in RepairPriority:
        left, bottom, right, top = PRIORITY_CELLS[priority]
        for x, y in _priority_tick_points(priority):
            assert left < x < right
            assert bottom < y < top


def test_date_and_load_values_are_derived() -> None:
    assert _format_date("2026-09-28") == "28 Sep 2026"
    assert _load_percentage("51", "100") == "51%"
    assert _load_percentage("51", "") == ""


def test_layout_offset_uses_frontend_directions() -> None:
    report = ReportData(layout_offsets={"company": LayoutOffset(x=8, y=4)})
    assert _offset(report, "company") == (8, 4)

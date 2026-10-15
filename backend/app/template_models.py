"""Portable, reviewed template definitions; coordinates use the page's top-left."""

from __future__ import annotations

from datetime import date, time
from typing import Literal

from pydantic import BaseModel, Field, model_validator
from .report_styles import FieldStyle


class Region(BaseModel):
    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)
    width: float = Field(gt=0, le=1)
    height: float = Field(gt=0, le=1)

    @model_validator(mode="after")
    def contained(self):
        if self.x + self.width > 1.000001 or self.y + self.height > 1.000001:
            raise ValueError("A box must stay inside its page or image")
        return self


class PageBox(Region):
    page: int = Field(ge=0)


class PageSize(BaseModel):
    width: float = Field(gt=0, le=14400)
    height: float = Field(gt=0, le=14400)


class Calculation(BaseModel):
    operation: Literal["sum", "difference", "percentage"]
    fields: list[str] = Field(min_length=1, max_length=20)


class TemplateField(PageBox):
    id: str = Field(pattern=r"^[A-Za-z0-9_-]{1,80}$")
    label: str = Field(min_length=1, max_length=160)
    kind: Literal[
        "text",
        "textarea",
        "number",
        "date",
        "time",
        "checkbox",
        "select",
        "image",
        "calculated",
    ] = "text"
    role: Literal["company", "report_date"] | None = None
    required: bool = True
    font: Literal[
        "Times-Roman", "Helvetica", "Courier", "Times-Bold", "Helvetica-Bold"
    ] = "Times-Roman"
    font_size: float = Field(default=16, ge=4, le=72)
    color: str = Field(default="#000000", pattern=r"^#[0-9A-Fa-f]{6}$")
    alignment: Literal["left", "center", "right"] = "center"
    options: list[str] = Field(default_factory=list, max_length=100)
    image_fit: Literal["contain", "cover"] = "contain"
    calculation: Calculation | None = None
    suggested_value: str = Field(default="", max_length=2000)


class ClearArea(PageBox):
    id: str = Field(pattern=r"^[A-Za-z0-9_-]{1,80}$")
    color: str = Field(default="#ffffff", pattern=r"^#[0-9A-Fa-f]{6}$")


class OcrMapping(BaseModel):
    image_field: str
    photo_label: str = Field(min_length=1, max_length=80)
    qualifier: str = Field(default="", max_length=80)
    target_field: str
    region: Region = Field(default_factory=lambda: Region(x=0, y=0, width=1, height=1))


class Extraction(BaseModel):
    id: str = Field(pattern=r"^[A-Za-z0-9_-]{1,80}$")
    image_field: str
    name: str = Field(min_length=1, max_length=80)
    region: Region
    target_field: str | None = None


def validate_extractions(extractions, fields):
    if len({item.id for item in extractions}) != len(extractions):
        raise ValueError("Extraction IDs must be unique")
    targets = set()
    for item in extractions:
        if not item.name.strip():
            raise ValueError("Name the extracted area")
        if item.image_field not in fields or fields[item.image_field].kind != "image":
            raise ValueError("Extraction must reference an image box")
        if item.target_field:
            if item.target_field not in fields or fields[item.target_field].kind in {
                "image",
                "calculated",
            }:
                raise ValueError("Drop extracted data into an editable value field")
            if item.target_field in targets:
                raise ValueError("Each field may receive only one extracted item")
            targets.add(item.target_field)


class TemplateDefinition(BaseModel):
    version: Literal[1] = 1
    pages: list[PageSize] = Field(min_length=1, max_length=20)
    fields: list[TemplateField] = Field(default_factory=list, max_length=300)
    clear_areas: list[ClearArea] = Field(default_factory=list, max_length=400)
    ocr_mappings: list[OcrMapping] = Field(default_factory=list, max_length=100)
    extractions: list[Extraction] = Field(default_factory=list, max_length=100)

    @model_validator(mode="after")
    def references(self):
        fields = {field.id: field for field in self.fields}
        if len(fields) != len(self.fields):
            raise ValueError("Field IDs must be unique")
        if len({area.id for area in self.clear_areas}) != len(self.clear_areas):
            raise ValueError("Clear-area IDs must be unique")
        for box in [*self.fields, *self.clear_areas]:
            if box.page >= len(self.pages):
                raise ValueError("A field or clear area references a missing page")
        for role in ("company", "report_date"):
            if sum(field.role == role for field in self.fields) > 1:
                raise ValueError(f"Only one field may have the {role} role")
        for field in self.fields:
            if field.role == "company" and field.kind != "text":
                raise ValueError("The company role needs a text field")
            if field.role == "report_date" and field.kind != "date":
                raise ValueError("The report-date role needs a date field")
            if field.kind == "select" and (
                not field.options
                or any(
                    not option.strip() or len(option) > 160 for option in field.options
                )
            ):
                raise ValueError(
                    "Dropdown fields need non-empty options of at most 160 characters"
                )
            if field.kind == "calculated":
                calc = field.calculation
                if not calc or any(
                    ref not in fields or fields[ref].kind != "number"
                    for ref in calc.fields
                ):
                    raise ValueError(
                        f"{field.label}: calculations must reference existing number fields; check {', '.join(calc.fields) if calc else 'both source fields'}"
                    )
                if calc.operation != "sum" and len(calc.fields) != 2:
                    raise ValueError(
                        f"{field.label}: difference and percentage require two source number fields"
                    )
        targets = set()
        validate_extractions(self.extractions, fields)
        for mapping in self.ocr_mappings:
            if (
                mapping.image_field not in fields
                or fields[mapping.image_field].kind != "image"
            ):
                raise ValueError("OCR must reference an image box")
            if mapping.target_field not in fields or fields[
                mapping.target_field
            ].kind not in {"number", "text"}:
                raise ValueError("OCR destinations must be number or text fields")
            if not mapping.photo_label.strip() or mapping.target_field in targets:
                raise ValueError(
                    "OCR labels cannot be blank and each destination needs a single mapping"
                )
            targets.add(mapping.target_field)
        return self


class Rectangle(Region):
    id: str = Field(pattern=r"^[A-Za-z0-9_-]{1,80}$")
    # Legacy image-relative rectangles remain supported. New shapes use page coordinates.
    image_field: str | None = None
    page: int | None = Field(default=None, ge=0)
    kind: Literal["rectangle", "tick"] = "rectangle"
    color: str = Field(default="#ef2323", pattern=r"^#[0-9A-Fa-f]{6}$")
    stroke_width: float = Field(default=3, ge=0.5, le=12)


class TemplateReport(BaseModel):
    title: str = Field(default="", max_length=100)
    values: dict[str, str | bool] = Field(default_factory=dict, max_length=300)
    layout: dict[str, PageBox] = Field(default_factory=dict, max_length=300)
    styles: dict[str, FieldStyle] = Field(default_factory=dict, max_length=300)
    rectangles: list[Rectangle] = Field(default_factory=list, max_length=100)
    readings_confirmed: dict[str, bool] = Field(default_factory=dict, max_length=300)
    extractions: list[Extraction] = Field(default_factory=list, max_length=100)
    extraction_values: dict[str, str] = Field(default_factory=dict, max_length=100)

    def validate_for(self, definition: TemplateDefinition) -> None:
        import math

        fields = {field.id: field for field in definition.fields}
        validate_extractions(self.extractions, fields)
        extraction_ids = {
            item.id for item in [*definition.extractions, *self.extractions]
        }
        if set(self.extraction_values) - extraction_ids or any(
            len(value) > 20000 for value in self.extraction_values.values()
        ):
            raise ValueError("Invalid extracted-item values")
        if set(self.values) - fields.keys() or set(self.layout) - fields.keys() or set(self.styles) - fields.keys():
            raise ValueError("Report contains fields from another template")
        if any(
            key not in fields or fields[key].kind != "image"
            for key in self.readings_confirmed
        ):
            raise ValueError("Review confirmation must reference an image field")
        for key, value in self.values.items():
            field = fields[key]
            if field.kind == "checkbox":
                if not isinstance(value, bool):
                    raise ValueError(f"{field.label} must be a checkbox value")
                continue
            if not isinstance(value, str) or len(value) > 20000:
                raise ValueError(
                    f"{field.label} must be text of at most 20000 characters"
                )
            if value and field.kind == "number" and not math.isfinite(float(value)):
                raise ValueError(f"{field.label} must be a finite number")
            if value and field.kind == "date":
                date.fromisoformat(value)
            if value and field.kind == "time":
                time.fromisoformat(value)
            if value and field.kind == "select" and value not in field.options:
                raise ValueError(f"Choose a listed option for {field.label}")
        for box in self.layout.values():
            if box.page >= len(definition.pages):
                raise ValueError("Layout references a missing page")
        for rectangle in self.rectangles:
            if rectangle.page is not None:
                if (
                    rectangle.page >= len(definition.pages)
                    or rectangle.image_field is not None
                ):
                    raise ValueError("Shape must belong to a valid page only")
            elif (
                rectangle.image_field not in fields
                or fields[rectangle.image_field].kind != "image"
            ):
                raise ValueError("Rectangle must belong to an image box")


def resolved_values(
    definition: TemplateDefinition, report: TemplateReport
) -> dict[str, str | bool]:
    values = dict(report.values)
    for field in definition.fields:
        if field.kind != "calculated" or not field.calculation:
            continue
        calc = field.calculation
        inputs = [values.get(key, "") for key in calc.fields]
        if any(value == "" for value in inputs):
            values[field.id] = ""
            continue
        numbers = [float(value) for value in inputs]
        if calc.operation == "sum":
            result = sum(numbers)
        elif calc.operation == "difference":
            result = numbers[0] - numbers[1]
        elif numbers[1] == 0:
            denominator = next(item.label for item in definition.fields if item.id == calc.fields[1])
            raise ValueError(f"{field.label}: {denominator} (denominator) cannot be zero")
        else:
            result = numbers[0] / numbers[1] * 100
        import math
        if not math.isfinite(result):
            labels = [item.label for item in definition.fields if item.id in calc.fields]
            raise ValueError(f"{field.label}: calculation overflow; check {', '.join(labels)}")
        values[field.id] = f"{result:.2f}".rstrip("0").rstrip(".") + (
            "%" if calc.operation == "percentage" else ""
        )
    return values

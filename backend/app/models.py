from __future__ import annotations

from enum import StrEnum
from typing import Literal # lets a type hint specify exact allowed values rather than js general type
from uuid import UUID #python inbuild type for uniqye identifier


from pydantic import BaseModel, Field, computed_field, field_validator


class RepairPriority(StrEnum):
    IMMEDIATE = "immediate"
    SOON = "soon"
    SHUTDOWN = "shutdown"
    MONITOR = "monitor"


class FontSizes(BaseModel):
    report_number: float | None = Field(default=None, ge=6, le=30)
    # ge >=, le <=. default=None makes it optional field
    company: float | None = Field(default=None, ge=6, le=30)
    division: float | None = Field(default=None, ge=6, le=30)
    date: float | None = Field(default=None, ge=6, le=30)
    time: float | None = Field(default=None, ge=6, le=30)
    emissivity: float | None = Field(default=None, ge=6, le=30)
    temperatures: float | None = Field(default=None, ge=6, le=30)
    phase: float | None = Field(default=None, ge=6, le=30)
    currents: float | None = Field(default=None, ge=6, le=30)
    location: float | None = Field(default=None, ge=6, le=30)
    description: float | None = Field(default=None, ge=6, le=30)
    corrective_action: float | None = Field(default=None, ge=6, le=30)


class LayoutOffset(BaseModel):
    # Frontend coordinates: positive x moves right and positive y moves down.
    x: float = Field(default=0, ge=-144, le=144)
    y: float = Field(default=0, ge=-144, le=144)


class ImageRectangle(BaseModel):
    id: UUID
    image: Literal["equipment", "infrared"]
    # Fractions of the image frame, measured from its top-left corner.
    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)
    width: float = Field(gt=0, le=1)
    height: float = Field(gt=0, le=1)
    color: str = Field(pattern=r"^#[0-9A-Fa-f]{6}$")
    # color is a required string whose format is:
    #  ^ — start of the string
    # # — a literal hash sign
    # [0-9A-Fa-f] — one hexadecimal character
    # {6} — exactly six of those characters
    # $ — end of the string
    stroke_width: float = Field(ge=0.5, le=12)

    @property
    def stays_in_frame(self) -> bool:
        return self.x + self.width <= 1.000001 and self.y + self.height <= 1.000001


class ReportData(BaseModel):
    report_title: str = Field(default="", max_length=100)
    report_number: str = Field(default="", max_length=8)
    company: str = Field(default="", max_length=42)
    division: str = Field(default="", max_length=32)
    report_date: str = Field(default="", max_length=24)
    report_time: str = Field(default="", max_length=8)
    period: str = Field(default="", max_length=5)
    repair_priority: RepairPriority | None = None
    emissivity: float | None = Field(default=None, ge=0, le=1)
    bx1: float | None = Field(default=None, ge=-100, le=1000)
    bx2: float | None = Field(default=None, ge=-100, le=1000)
    ambient_temp: float | None = Field(default=None, ge=-100, le=200)
    phase: str = Field(default="", max_length=8)
    rated_current: str = Field(default="", max_length=12)
    l1_current: str = Field(default="", max_length=12)
    l2_current: str = Field(default="", max_length=12)
    l3_current: str = Field(default="", max_length=12)
    neutral_current: str = Field(default="", max_length=12)
    l1_load: str = Field(default="", max_length=12)
    l2_load: str = Field(default="", max_length=12)
    l3_load: str = Field(default="", max_length=12)
    neutral_load: str = Field(default="", max_length=12)
    location_line_1: str = Field(default="", max_length=64)
    description: str = Field(default="", max_length=520)
    corrective_action: str = Field(default="", max_length=900)
    font_sizes: FontSizes = Field(default_factory=FontSizes)
    # if no font_sizes, pydantic auto calls FontSizes() to build new FontSizes obj
    layout_offsets: dict[str, LayoutOffset] = Field(default_factory=dict)
    image_rectangles: list[ImageRectangle] = Field(default_factory=list, max_length=100)
    # default = {}, dict[str, LayoutOFfset] means field must be dict where keys are strings and value is custom Pydantic model called LayoutOffset
    readings_confirmed: bool = False

    @field_validator("image_rectangles")
    @classmethod
    def rectangles_stay_in_frames(cls, value: list[ImageRectangle]) -> list[ImageRectangle]:
        if any(not rectangle.stays_in_frame for rectangle in value):
            raise ValueError("Rectangle must stay within its image frame")
        return value

    @field_validator("report_number")
    @classmethod
    def pad_single_digit_report_number(cls, value: str) -> str:
        return f"0{value}" if len(value) == 1 and value.isdecimal() else value

    @field_validator("repair_priority", mode="before")
    @classmethod
    def blank_priority_is_unselected(cls, value: object) -> object:
        return None if value == "" else value

    @field_validator("period")
    @classmethod
    def validate_period(cls, value: str) -> str:
        if value not in {"", "A.M.", "P.M."}:
            raise ValueError("period must be blank, A.M., or P.M.")
        return value

    @computed_field
    @property
    def delta_t(self) -> float | None:
        if self.bx1 is None or self.bx2 is None:
            return None
        return round(self.bx1 - self.bx2, 1)


class HealthResponse(BaseModel):
    status: str = "ok"

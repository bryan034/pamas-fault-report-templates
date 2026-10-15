"""Per-report appearance overrides and value-free future-report configuration."""

from typing import Literal
from pydantic import BaseModel, ConfigDict, Field


class FieldStyle(BaseModel):
    model_config = ConfigDict(extra="forbid")
    font: (
        Literal["Times-Roman", "Times-Bold", "Helvetica", "Helvetica-Bold", "Courier"]
        | None
    ) = None
    font_size: float | None = Field(default=None, ge=4, le=72)
    color: str | None = Field(default=None, pattern=r"^#[0-9A-Fa-f]{6}$")

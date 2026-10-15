from typing import Annotated
from pydantic import BaseModel, ConfigDict, Field
from .template_models import PageBox


class FutureConfiguration(BaseModel):
    """Only geometry and font sizes: report values/photos/styles are forbidden."""

    model_config = ConfigDict(extra="forbid")
    expected_revision_id: str = Field(default="", max_length=36)
    layout: dict[str, PageBox] = Field(default_factory=dict, max_length=300)
    font_sizes: dict[str, Annotated[float, Field(ge=4, le=72)]] = Field(
        default_factory=dict, max_length=300
    )

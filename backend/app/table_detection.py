"""Conservative table semantics shared by PDF text and browser OCR layouts."""

import re
from uuid import uuid4

from pydantic import BaseModel, Field

from .template_models import Calculation, PageSize, TemplateField


class LayoutWord(BaseModel):
    text: str = Field(max_length=2000)
    x0: float = Field(ge=0, le=14400)
    top: float = Field(ge=0, le=14400)
    x1: float = Field(ge=0, le=14400)
    bottom: float = Field(ge=0, le=14400)
    fontname: str = Field(default="", max_length=200)
    size: float = Field(default=10, ge=0, le=1000)


class ScannedLayout(BaseModel):
    page: int = Field(ge=0, lt=20)
    size: PageSize
    words: list[LayoutWord] = Field(max_length=10000)
    cells: list[tuple[float, float, float, float]] = Field(max_length=1500)
    shaded: list[tuple[float, float, float, float]] = Field(default_factory=list, max_length=1500)


def inside(words, cell):
    l, t, r, b = cell
    return [w for w in words if l - 1 <= w["x0"] and w["x1"] <= r + 1
            and t - 1 <= w["top"] and w["bottom"] <= b + 1]


def refine_table_layout(cells, words, page, size, shaded=()):
    """Keep labels immutable; split phase rows and link measured/rated loads.

    A recognised three-column load header plus at least two phase labels is
    required before inventing a formula. Colour alone never creates a formula.
    """
    generated, blocked = [], []
    for rated in [w for w in words if w["text"].upper() == "RATED"]:
        measured = next((w for w in words if w["text"].upper() == "MEASURED"
                         and w["x0"] > rated["x1"] and abs(w["top"] - rated["top"]) < 10), None)
        if not measured:
            continue
        load = next((w for w in words if w["text"].upper() == "LOAD"
                     and w["x0"] > measured["x1"] and abs(w["top"] - rated["top"]) < 16), None)
        if not load or not any(w["text"] == "%" and abs(w["x0"] - load["x0"]) < 20
                               and abs(w["top"] - load["top"]) < 18 for w in words):
            continue
        columns = []
        for header in (rated, measured, load):
            choices = [c for c in cells if c[0] <= header["x0"] + 1 and c[2] >= header["x1"] - 1
                       and c[1] <= header["top"] + 1 and c[3] >= header["bottom"] - 1]
            if not choices:
                break
            columns.append(min(choices, key=lambda c: (c[2]-c[0])*(c[3]-c[1])))
        if len(columns) != 3:
            continue
        # Horizontal rules may stop at the phase column. The phase labels provide
        # row anchors even when the value columns are single, tall cells.
        bottom = max(c[3] for c in cells if abs(c[0] - columns[0][0]) < 3
                     and c[1] >= columns[0][1] - 1)
        phases = sorted((w for w in words if re.fullmatch(r"L[123]|N", w["text"].upper())
                         and max(0, columns[0][0] - 120) <= w["x0"] < columns[0][0]
                         and w["top"] > max(rated["bottom"], measured["bottom"], load["bottom"]) - 1
                         and w["bottom"] <= bottom + 1), key=lambda w: w["top"])
        if len(phases) < 2 or len({w["text"].upper() for w in phases}) != len(phases):
            continue
        centers = [(w["top"] + w["bottom"]) / 2 for w in phases]
        pitch = min(b-a for a, b in zip(centers, centers[1:]))
        header_bottom = max(rated["bottom"], measured["bottom"], load["bottom"])
        table = (min(w["x0"] for w in phases) - 6, min(c[1] for c in columns), columns[-1][2], min(bottom, centers[-1] + pitch/2))
        blocked.append(table)
        for i, phase in enumerate(phases):
            top = max(header_bottom + 1, centers[0] - pitch/2) if i == 0 else (centers[i-1] + centers[i])/2
            end = min(bottom, centers[-1] + pitch/2) if i == len(phases)-1 else (centers[i] + centers[i+1])/2
            row = []
            for j, column in enumerate(columns):
                l, _, r, _ = column
                bounds = (l + 2, top + 1, r - 2, end - 1)
                if bounds[2] <= bounds[0] or bounds[3] <= bounds[1]:
                    continue
                readings = inside(words, (l, top, r, end))
                text = " ".join(w["text"] for w in readings)
                field = TemplateField(
                    id=str(uuid4()), label=f'{phase["text"].upper()} {("Rated", "Measured", "% Load")[j]}',
                    kind="number" if j < 2 else "calculated", page=page,
                    x=bounds[0]/size.width, y=bounds[1]/size.height,
                    width=(bounds[2]-bounds[0])/size.width, height=(bounds[3]-bounds[1])/size.height,
                    font="Helvetica", font_size=min(72, max(4, phase.get("size", 10))),
                    suggested_value=text if re.fullmatch(r"\d+(?:[.,]\d+)?%?", text) else "",
                    calculation=Calculation(operation="percentage", fields=[row[1].id, row[0].id]) if j == 2 and len(row) == 2 else None,
                )
                if j == 2 and len(row) != 2:
                    break
                row.append(field)
            if len(row) == 3:
                generated.extend(row)

    def intersects(a, b):
        return min(a[2], b[2]) > max(a[0], b[0]) and min(a[3], b[3]) > max(a[1], b[1])

    remaining = []
    for cell in cells:
        contents = inside(words, cell)
        if any(intersects(cell, area) for area in blocked):
            continue
        # In label/value rows, only the value area to the right is editable.
        right_neighbour = any(abs(other[0] - cell[2]) < 4 and abs(other[1] - cell[1]) < 3
                              and abs(other[3] - cell[3]) < 3 for other in cells)
        left_neighbour = any(abs(other[2] - cell[0]) < 4 and abs(other[1] - cell[1]) < 3
                             and abs(other[3] - cell[3]) < 3 for other in cells)
        label_text = contents and not all(re.fullmatch(r"[-–—\d.,%°˚CF]+", w["text"]) for w in contents)
        heading = " ".join(w["text"] for w in sorted(contents, key=lambda w: (round(w["top"]/4), w["x0"]))).upper()
        named_header = heading in {"VALUE", "PARAMETER", "OBJECT PARAMETER", "LABEL", "RATED", "MEASURED", "% LOAD", "PHASE", "DIFF TEMPERATURE"}
        header = (label_text and (named_header or all("bold" in w.get("fontname", "").lower() for w in contents))
                  and cell[3] - max(w["bottom"] for w in contents) < 14)
        coloured = contents and any(
            area[0] - 1 <= (w["x0"] + w["x1"])/2 <= area[2] + 1
            and area[1] - 1 <= (w["top"] + w["bottom"])/2 <= area[3] + 1
            for area in shaded for w in contents
        )
        if (right_neighbour and not left_neighbour and label_text) or header or coloured:
            continue
        remaining.append(cell)
    return remaining, generated

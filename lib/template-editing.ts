import type {
  Definition,
  PageBox,
  Region,
  TemplateField,
  ClearArea,
} from "./template-api";

export type CopiedBox = {
  kind: "field" | "cover";
  box: TemplateField | ClearArea;
  cover?: ClearArea;
};
export function duplicateBox(
  definition: Definition,
  copied: CopiedBox,
  id: string,
  offset = 0.015,
) {
  const shifted = {
    ...copied.box,
    id,
    x: Math.min(1 - copied.box.width, copied.box.x + offset),
    y: Math.min(1 - copied.box.height, copied.box.y + offset),
  };
  if (copied.kind === "cover")
    return {
      ...definition,
      clear_areas: [...definition.clear_areas, shifted as ClearArea],
    };
  return {
    ...definition,
    fields: [
      ...definition.fields,
      {
        ...shifted,
        label: `${(copied.box as TemplateField).label.slice(0, 155)} copy`,
        role: null,
      } as TemplateField,
    ],
    clear_areas: copied.cover
      ? [
          ...definition.clear_areas,
          { ...copied.cover, id, x: shifted.x, y: shifted.y },
        ]
      : definition.clear_areas,
  };
}

export function fieldsInPageOrder(
  fields: TemplateField[],
  layout: Record<string, PageBox>,
) {
  return fields
    .map((field, index) => ({ field, box: layout[field.id] || field, index }))
    .sort(
      (a, b) =>
        a.box.page - b.box.page ||
        Math.round(a.box.y * 10000) - Math.round(b.box.y * 10000) ||
        a.box.x - b.box.x ||
        a.index - b.index,
    )
    .map((item) => item.field);
}

export function firstEditableField(fields: TemplateField[]) {
  const ordered = fieldsInPageOrder(fields, {});
  return (
    ordered.find((field) => !["image", "calculated"].includes(field.kind)) ||
    ordered[0]
  );
}

// A curved, tapered vector checkmark, shared by both live editors and PDF renderers.
export const tickPath =
  "M .04 .48 C .11 .36 .18 .40 .24 .63 C .32 .44 .60 .10 .94 .02 C .69 .20 .45 .57 .28 .98 C .23 .99 .19 .96 .17 .89 C .14 .70 .10 .48 .04 .48 Z";

export type Edge = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
export const edges: Edge[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
const clamp = (n: number, min: number, max: number) =>
  Math.min(max, Math.max(min, n));
export function resizeBox(
  box: PageBox,
  edge: Edge,
  dx: number,
  dy: number,
): PageBox {
  let left = box.x,
    top = box.y,
    right = box.x + box.width,
    bottom = box.y + box.height;
  if (edge.includes("w")) left = clamp(left + dx, 0, right - 0.002);
  if (edge.includes("e")) right = clamp(right + dx, left + 0.002, 1);
  if (edge.includes("n")) top = clamp(top + dy, 0, bottom - 0.002);
  if (edge.includes("s")) bottom = clamp(bottom + dy, top + 0.002, 1);
  return {
    page: box.page,
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  };
}
export function handlePoint(box: Region, edge: Edge) {
  return {
    x:
      box.x +
      box.width * (edge.includes("w") ? 0 : edge.includes("e") ? 1 : 0.5),
    y:
      box.y +
      box.height * (edge.includes("n") ? 0 : edge.includes("s") ? 1 : 0.5),
  };
}
export function extractedValue(
  text: string,
  field: TemplateField,
): string | boolean | null {
  const value = text.trim();
  if (!value) return null;
  if (field.kind === "number") {
    const matches = value
      .replace(/[−–]/g, "-")
      .replace(/,/g, ".")
      .match(/-?\d+(?:\.\d+)?/g);
    return matches?.length === 1 && Number.isFinite(Number(matches[0]))
      ? matches[0]
      : null;
  }
  if (field.kind === "checkbox")
    return /^(yes|true|checked|✓|✔|1)$/i.test(value)
      ? true
      : /^(no|false|unchecked|0)$/i.test(value)
        ? false
        : null;
  if (field.kind === "select")
    return (
      field.options.find(
        (option) => option.toLowerCase() === value.toLowerCase(),
      ) ?? null
    );
  if (field.kind === "date")
    return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
  if (field.kind === "time")
    return /^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? value : null;
  return ["image", "calculated"].includes(field.kind) ? null : value;
}

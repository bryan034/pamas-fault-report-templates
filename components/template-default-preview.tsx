"use client";
import { useLayoutEffect, useRef } from "react";
import type { TemplateField } from "@/lib/template-api";

export function templateDefaultText(field: TemplateField): string {
  if (field.kind === "image" || field.kind === "calculated") return "";
  const value = field.default_value;
  if (value === undefined || value === "" || value === false) return "";
  if (field.kind === "checkbox") return value ? "✓" : "";
  if (field.kind === "date" && /^\d{4}-\d{2}-\d{2}$/.test(String(value))) {
    const date = new Date(`${value}T00:00:00Z`);
    if (!Number.isNaN(date.getTime())) {
      return `${String(date.getUTCDate()).padStart(2, "0")} ${date.toLocaleString("en-GB", { month: "short", timeZone: "UTC" })} ${date.getUTCFullYear()}`;
    }
  }
  return String(value);
}

/** Display explicit defaults without changing the blank PDF or saving samples. */
export default function TemplateDefaultPreview({
  field,
  page,
}: {
  field: TemplateField;
  page: { width: number; height: number };
}) {
  const target = useRef<SVGTextElement>(null);
  const value = templateDefaultText(field);
  const lines = value.split("\n");
  const width = field.width * page.width,
    height = field.height * page.height;
  const padding = Math.min(2, width * 0.04, height * 0.08);
  const anchor =
    field.alignment === "left"
      ? "start"
      : field.alignment === "right"
        ? "end"
        : "middle";
  const x =
    anchor === "start"
      ? padding
      : anchor === "end"
        ? width - padding
        : width / 2;
  useLayoutEffect(() => {
    const text = target.current;
    if (!text) return;
    let size = Math.min(
      field.font_size,
      (height - padding * 2) / (lines.length * 1.2),
    );
    text.setAttribute("font-size", String(size));
    const spans = [...text.querySelectorAll("tspan")];
    const longest = Math.max(
      0,
      ...spans.map((span) => span.getComputedTextLength()),
    );
    if (longest > width - padding * 2) size *= (width - padding * 2) / longest;
    size = Math.max(0.1, size);
    text.setAttribute("font-size", String(size));
    const firstBaseline = (height - lines.length * size * 1.2) / 2 + size;
    spans.forEach((span, index) =>
      span.setAttribute("y", String(firstBaseline + index * size * 1.2)),
    );
  }, [
    value,
    field.font,
    field.font_size,
    width,
    height,
    padding,
    lines.length,
  ]);
  if (!value) return null;
  return (
    <svg
      x={field.x}
      y={field.y}
      width={field.width}
      height={field.height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      overflow="hidden"
      pointerEvents="none"
      data-template-default={field.id}
      aria-label={`Default value for ${field.label}`}
    >
      <text
        ref={target}
        fill={field.color}
        textAnchor={anchor}
        fontFamily={
          field.font.startsWith("Times")
            ? "Times New Roman"
            : field.font.startsWith("Helvetica")
              ? "Arial"
              : "Courier New"
        }
        fontWeight={field.font.includes("Bold") ? "bold" : "normal"}
        fontSize={field.font_size}
      >
        {lines.map((line, index) => (
          <tspan key={index} x={x}>
            {line}
          </tspan>
        ))}
      </text>
    </svg>
  );
}

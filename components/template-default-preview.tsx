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
  showLabel = false,
}: {
  field: TemplateField;
  showLabel?: boolean;
  page: { width: number; height: number };
}) {
  const value = showLabel ? field.label : templateDefaultText(field);
  const lines = value.split("\n");
  const width = field.width * page.width,
    height = field.height * page.height;
  const text = useRef<SVGTextElement>(null);
  const image = field.kind === "image";
  const fontSize = image ? Math.min(field.font_size, height * .65) : field.font_size;
  useLayoutEffect(() => {
    const node = text.current;
    if (!node || !value) return;
    node.removeAttribute("transform");
    const bounds = node.getBBox();
    // Refit labels and defaults on every geometry change without growing the box.
    // Always measure at the configured size so enlarging the box restores text.
    const scale = Math.min(1, Math.max(.01, width - 2) / Math.max(.01, bounds.width), Math.max(.01, height - 2) / Math.max(.01, bounds.height));
    node.setAttribute("transform", `translate(${width / 2 - (bounds.x + bounds.width / 2) * scale} ${height / 2 - (bounds.y + bounds.height / 2) * scale}) scale(${scale})`);
  }, [value, width, height, fontSize, field.font]);
  if (!value) return null;
  return (
    <svg
      x={field.x}
      y={field.y}
      width={field.width}
      height={field.height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      overflow="visible"
      pointerEvents="none"
      data-template-default={showLabel ? undefined : field.id}
      data-template-label={showLabel ? field.id : undefined}
      aria-label={`${showLabel ? "Field label" : "Default value"} for ${field.label}`}
    >
      <text
        ref={text}
        fill={field.color}
        textAnchor="middle"
        fontFamily={
          field.font.startsWith("Times")
            ? "Times New Roman"
            : field.font.startsWith("Helvetica")
              ? "Arial"
              : "Courier New"
        }
        fontWeight={field.font.includes("Bold") ? "bold" : "normal"}
        fontSize={fontSize}
      >
        {lines.map((line, index) => (
          <tspan key={index} x={width / 2} y={fontSize + index * fontSize * 1.15}>
            {line}
          </tspan>
        ))}
      </text>
    </svg>
  );
}

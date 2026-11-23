"use client";
import { useLayoutEffect, useRef } from "react";
import { reportFontFamily } from "@/lib/report-text";

/** Fit sidebar entry to its visible width; line breaks remain explicit. */
export default function ReportTextInput({ label, value, multiline, font, fontSize, alignment, invalid, list, onChange }: {
  label: string; value: string; multiline: boolean; font: string; fontSize: number;
  alignment: "left" | "center" | "right"; invalid?: boolean; list?: string;
  onChange: (value: string) => void;
}) {
  const ref = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const fit = () => {
      const style = getComputedStyle(node);
      const width = node.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      const context = document.createElement("canvas").getContext("2d");
      if (!context || width <= 0) return;
      const maximum = fontSize * 96 / 72;
      context.font = `${font.includes("Bold") ? "bold " : ""}${maximum}px ${reportFontFamily[font] || reportFontFamily["Times-Roman"]}`;
      const measured = Math.max(...value.split("\n").map(line => context.measureText(line).width), 1);
      node.style.fontSize = `${maximum * Math.min(1, Math.max(1, width - 1) / measured)}px`;
      node.scrollLeft = 0;
      node.scrollTop = 0;
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(node);
    return () => observer.disconnect();
  }, [value, font, fontSize]);
  const common = {
    "aria-label": label, "aria-invalid": invalid, value, maxLength: 20000,
    className: "report-text-input",
    style: { textAlign: alignment, fontFamily: reportFontFamily[font], fontWeight: font.includes("Bold") ? 700 : 400 },
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange(event.target.value),
  };
  return multiline && value.includes("\n") ? (
    <textarea {...common} ref={node => { ref.current = node; }} rows={value.split("\n").length} wrap="off" />
  ) : (
    <input {...common} ref={node => { ref.current = node; }} type="text" list={list} />
  );
}

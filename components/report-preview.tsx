"use client";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent,
  type Dispatch,
  type SetStateAction,
} from "react";
import { RectangleHorizontal, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import TemplatePdfViewer from "@/components/template-pdf-viewer";
import type {
  Definition,
  TemplateField,
  TemplateReport,
  PageBox,
  Rectangle,
  FieldLayers,
} from "@/lib/template-api";
import {
  edges,
  handlePoint,
  resizeBox,
  tickPath,
  nextReportField,
  type Edge,
} from "@/lib/template-editing";
import { extractionMime } from "@/components/image-extraction";
import { fontSizes } from "@/lib/font-sizes";
import { createId } from "@/lib/create-id";

export const reportFonts = [
  ["Times-Roman", "Times New Roman"],
  ["Times-Bold", "Times New Roman Bold"],
  ["Helvetica", "Arial"],
  ["Helvetica-Bold", "Arial Bold"],
  ["Courier", "Courier New"],
];
export function reportConfiguration(report: TemplateReport) {
  return {
    layout: report.layout,
    font_sizes: Object.fromEntries(
      Object.entries(report.styles || {})
        .filter(([, style]) => typeof style.font_size === "number")
        .map(([id, style]) => [id, style.font_size]),
    ),
  };
}
type Texture = { id: string; canvas: HTMLCanvasElement };
function ValueCanvas({ texture, label }: { texture: Texture; label: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    const target = ref.current;
    if (!target) return;
    target.width = texture.canvas.width;
    target.height = texture.canvas.height;
    target.getContext("2d")?.drawImage(texture.canvas, 0, 0);
  }, [texture]);
  return <canvas ref={ref} aria-label={`Rendered value: ${label}`} />;
}
type Gesture = {
  kind: "field" | "shape" | "draw";
  id: string;
  start: { x: number; y: number };
  box: PageBox;
  edge?: Edge;
  shape?: Rectangle;
  moved?: boolean;
};
const clamp = (n: number, min: number, max: number) =>
  Math.max(min, Math.min(max, n));
const defaultTickSize = { width: 0.035, height: 0.025 };

export default function ReportPreview({
  definition,
  report,
  onChange,
  background,
  layers,
  busy,
  error,
  onDragState,
  onImage,
  onExtraction,
  onValue,
  activeField,
  onActiveField,
}: {
  definition: Definition;
  report: TemplateReport;
  onChange: Dispatch<SetStateAction<TemplateReport>>;
  background: Uint8Array | string | null;
  layers: FieldLayers | null;
  busy?: boolean;
  error?: string;
  onDragState?: (dragging: boolean) => void;
  onImage?: (id: string, file: File) => void;
  onExtraction?: (id: string, field: TemplateField) => void;
  onValue?: (field: TemplateField, value: string | boolean) => void;
  activeField?: string | null;
  onActiveField?: (id: string | null) => void;
}) {
  const [textures, setTextures] = useState<Texture[]>([]),
    [rendering, setRendering] = useState(false),
    [renderError, setRenderError] = useState("");
  const [mode, setMode] = useState<"normal" | "rectangle" | "tick">("normal"),
    [selected, setSelected] = useState<string | null>(null),
    [hovered, setHovered] = useState<string | null>(null),
    [localField, setLocalField] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [color, setColor] = useState("#ef2323"),
    [stroke, setStroke] = useState(3);
  const gesture = useRef<Gesture | null>(null);
  const tools = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const panel = tools.current?.closest<HTMLElement>(".report-shell");
    const header = panel?.querySelector<HTMLElement>(":scope > .topbar");
    if (!header || !panel) return;
    const update = () =>
      panel.style.setProperty(
        "--report-header-height",
        `${header.getBoundingClientRect().height}px`,
      );
    update();
    const observer = new ResizeObserver(update);
    observer.observe(header);
    return () => {
      observer.disconnect();
      panel.style.removeProperty("--report-header-height");
    };
  }, []);
  const fieldId = activeField === undefined ? localField : activeField;
  const activate = (id: string | null) => {
    setLocalField(id);
    onActiveField?.(id);
  };
  const clearSelection = () => {
    setSelected(null);
    setHovered(null);
    setEditing(null);
    activate(null);
    setMode("normal");
  };
  useEffect(() => {
    const outside = (event: globalThis.PointerEvent) => {
      if (gesture.current) return;
      const target = event.target as Element;
      if (target.closest("[data-sidebar-field]")) {
        setSelected(null);
        setHovered(null);
        setEditing(null);
        setMode("normal");
        return;
      }
      if (
        target.closest(
          "[data-field-id],[data-shape-id],[data-inline-editor],[data-report-history],.report-preview-tools",
        )
      )
        return;
      clearSelection();
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  });
  const field = definition.fields.find((item) => item.id === fieldId);
  const override = field ? report.styles[field.id] : undefined;
  // Saved optional overrides contain nulls; those inherit the template settings.
  const style = field
    ? {
        ...field,
        font: override?.font ?? field.font,
        font_size: override?.font_size ?? field.font_size,
        color: override?.color ?? field.color,
        alignment: override?.alignment ?? field.alignment,
      }
    : null;
  const boxFor = (item: TemplateField): PageBox =>
    report.layout[item.id] || item;
  const shapeBox = (shape: Rectangle): PageBox | null => {
    if (shape.page !== null && shape.page !== undefined)
      return {
        page: shape.page,
        x: shape.x,
        y: shape.y,
        width: shape.width,
        height: shape.height,
      };
    const source = definition.fields.find(
      (item) => item.id === shape.image_field,
    );
    if (!source) return null;
    const box = boxFor(source);
    return {
      page: box.page,
      x: box.x + shape.x * box.width,
      y: box.y + shape.y * box.height,
      width: shape.width * box.width,
      height: shape.height * box.height,
    };
  };
  useEffect(() => {
    if (!layers) return;
    let cancelled = false;
    let task: { destroy: () => Promise<void> } | undefined;
    const renders: { cancel: () => void }[] = [];
    void (async () => {
      setRendering(true);
      setRenderError("");
      try {
        if (!layers.pdf) {
          if (!cancelled) setTextures([]);
          return;
        }
        const { getDocument, GlobalWorkerOptions } = await import("pdfjs-dist");
        GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
        const bytes = Uint8Array.from(atob(layers.pdf), (c) => c.charCodeAt(0));
        const loading = getDocument({ data: bytes });
        task = loading;
        const pdf = await loading.promise;
        if (pdf.numPages !== layers.fields.length)
          throw new Error("Field preview pages do not match");
        const next: Texture[] = [];
        for (let i = 0; i < pdf.numPages; i++) {
          if (cancelled) return;
          const page = await pdf.getPage(i + 1);
          const size = page.getViewport({ scale: 1 });
          const scale = Math.min(3, 2048 / Math.max(size.width, size.height));
          const viewport = page.getViewport({ scale });
          const canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.ceil(viewport.width));
          canvas.height = Math.max(1, Math.ceil(viewport.height));
          const context = canvas.getContext("2d");
          if (!context) throw new Error("Canvas unavailable");
          const render = page.render({
            canvas,
            canvasContext: context,
            viewport,
            background: "rgba(0,0,0,0)",
          });
          renders.push(render);
          await render.promise;
          next.push({ id: layers.fields[i], canvas });
        }
        if (!cancelled) setTextures(next);
      } catch (cause) {
        if (!cancelled)
          setRenderError(
            cause instanceof Error
              ? cause.message
              : "Could not render report fields",
          );
      } finally {
        if (!cancelled) setRendering(false);
        void task?.destroy().catch(() => undefined);
      }
    })();
    return () => {
      cancelled = true;
      renders.forEach((render) => render.cancel());
      void task?.destroy().catch(() => undefined);
    };
  }, [layers]);
  const removeShape = (id: string) => {
    onChange((current) => ({
      ...current,
      rectangles: current.rectangles.filter((item) => item.id !== id),
    }));
    setSelected(null);
    setHovered(null);
  };
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (
        (event.target as HTMLElement)?.closest(
          "input,textarea,select,[contenteditable=true]",
        )
      )
        return;
      if (
        ["Delete", "Backspace"].includes(event.key) &&
        (hovered || selected)
      ) {
        event.preventDefault();
        removeShape((hovered || selected)!);
      }
      if (event.key === "Escape") {
        clearSelection();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });
  const point = (event: PointerEvent<SVGElement>) => {
    const svg = event.currentTarget.closest("svg")!;
    const rect = svg.getBoundingClientRect();
    return {
      svg,
      x: clamp((event.clientX - rect.left) / rect.width, 0, 1),
      y: clamp((event.clientY - rect.top) / rect.height, 0, 1),
    };
  };
  const beginField = (
    event: PointerEvent<SVGElement>,
    item: TemplateField,
    edge?: Edge,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const p = point(event);
    p.svg.setPointerCapture(event.pointerId);
    setSelected(null);
    activate(item.id);
    gesture.current = {
      kind: "field",
      id: item.id,
      start: p,
      box: boxFor(item),
      edge,
    };
    onDragState?.(true);
  };
  const beginShape = (
    event: PointerEvent<SVGElement>,
    page: number,
    shape?: Rectangle,
    edge?: Edge,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const p = point(event);
    setEditing(null);
    activate(null);
    if (shape) {
      const box = shapeBox(shape);
      if (!box) return;
      p.svg.setPointerCapture(event.pointerId);
      setSelected(shape.id);
      setColor(shape.color);
      setStroke(shape.stroke_width);
      gesture.current = {
        kind: "shape",
        id: shape.id,
        start: p,
        box,
        edge,
        shape,
      };
    } else {
      if (report.rectangles.length >= 100) return;
      const next: Rectangle = {
        id: createId(),
        page,
        kind: mode === "tick" ? "tick" : "rectangle",
        x: Math.min(p.x, mode === "tick" ? 1 - defaultTickSize.width : 0.96),
        y: Math.min(p.y, mode === "tick" ? 1 - defaultTickSize.height : 0.97),
        width: mode === "tick" ? defaultTickSize.width : 0.002,
        height: mode === "tick" ? defaultTickSize.height : 0.002,
        color,
        stroke_width: stroke,
      };
      if (next.kind !== "tick") onDragState?.(true);
      onChange((current) => ({
        ...current,
        rectangles: [...current.rectangles, next],
      }));
      setSelected(next.id);
      if (next.kind === "tick") {
        // A tick is a one-click stamp, not a drag-sized rectangle. Even tiny
        // pointer movement during a click must not overwrite its default size.
        gesture.current = null;
        setMode("normal");
        return;
      }
      p.svg.setPointerCapture(event.pointerId);
      gesture.current = {
        kind: "draw",
        id: next.id,
        start: p,
        box: {
          page,
          x: next.x,
          y: next.y,
          width: next.width,
          height: next.height,
        },
        shape: next,
      };
    }
    onDragState?.(true);
  };
  const move = (event: PointerEvent<SVGSVGElement>) => {
    const current = gesture.current;
    if (!current) return;
    const p = point(event),
      dx = p.x - current.start.x,
      dy = p.y - current.start.y;
    if (current.kind === "field" && !current.edge && !current.moved) {
      const bounds = p.svg.getBoundingClientRect();
      if (Math.hypot(dx * bounds.width, dy * bounds.height) < 4) return;
    }
    current.moved = true;
    if (current.kind === "field") setEditing(null);
    const next =
      current.kind === "draw"
        ? {
            page: current.box.page,
            x: Math.min(current.start.x, p.x, 0.998),
            y: Math.min(current.start.y, p.y, 0.998),
            width: Math.max(0.002, Math.abs(dx)),
            height: Math.max(0.002, Math.abs(dy)),
          }
        : current.edge
          ? resizeBox(current.box, current.edge, dx, dy)
          : {
              ...current.box,
              x: clamp(current.box.x + dx, 0, 1 - current.box.width),
              y: clamp(current.box.y + dy, 0, 1 - current.box.height),
            };
    onChange((value) =>
      current.kind === "field"
        ? { ...value, layout: { ...value.layout, [current.id]: next } }
        : {
            ...value,
            rectangles: value.rectangles.map((item) =>
              item.id === current.id
                ? { ...item, ...next, image_field: null }
                : item,
            ),
          },
    );
  };
  const finish = () => {
    const current = gesture.current;
    if (current?.kind === "draw") setMode("normal");
    if (current?.kind === "field" && !current.edge && !current.moved) {
      const item = definition.fields.find((field) => field.id === current.id);
      if (item && !["image", "calculated"].includes(item.kind) && onValue)
        setEditing(item.id);
    }
    gesture.current = null;
    onDragState?.(false);
  };
  const updateStyle = (updates: TemplateReport["styles"][string]) => {
    if (!field) return;
    onChange((current) => ({
      ...current,
      styles: {
        ...current.styles,
        [field.id]: { ...current.styles[field.id], ...updates },
      },
    }));
  };
  const shapeUpdate = (updates: Partial<Rectangle>) => {
    if (selected)
      onChange((current) => ({
        ...current,
        rectangles: current.rectangles.map((item) =>
          item.id === selected ? { ...item, ...updates } : item,
        ),
      }));
  };
  return (
    <div className="report-preview-editor">
      <div className="report-preview-tools" ref={tools}>
          <div className="report-shape-toolbar">
            <Button
              size="sm"
              variant={mode === "rectangle" ? "default" : "outline"}
              onClick={() => {
                setEditing(null);
                activate(null);
                setSelected(null);
                setMode(mode === "rectangle" ? "normal" : "rectangle");
              }}
            >
              <RectangleHorizontal size={14} />
              {mode === "rectangle" ? "Finish drawing" : "Draw rectangle"}
            </Button>
            <Button
              size="sm"
              variant={mode === "tick" ? "default" : "outline"}
              onClick={() => {
                setEditing(null);
                activate(null);
                setSelected(null);
                setMode(mode === "tick" ? "normal" : "tick");
              }}
            >
              <Check size={14} />
              {mode === "tick" ? "Cancel tick" : "Insert tick"}
            </Button>
          </div>
        <div
          className="report-font-toolbar"
          role="toolbar"
          aria-label="Report field formatting"
        >
          <label>
            Font{" "}
            <select
              aria-label="Report font"
              value={style?.font || "Times-Roman"}
              disabled={!field || field.kind === "image"}
              onChange={(event) => updateStyle({ font: event.target.value })}
            >
              {reportFonts.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Size{" "}
            <select
              aria-label="Report font size"
              disabled={!field || field.kind === "image"}
              value={style?.font_size || 16}
              onChange={(event) => updateStyle({ font_size: Number(event.target.value) })}
            >
              {style && !fontSizes.includes(style.font_size) && (
                <option value={style.font_size} disabled>{style.font_size}</option>
              )}
              {fontSizes.map(size => <option key={size} value={size}>{size}</option>)}
            </select>
          </label>
          <label>
            Alignment{" "}
            <select
              aria-label="Report text alignment"
              value={style?.alignment || "center"}
              disabled={!field || field.kind === "image"}
              onChange={(event) =>
                updateStyle({
                  alignment: event.target.value as "left" | "center" | "right",
                })
              }
            >
              <option value="left">Left</option>
              <option value="center">Center</option>
              <option value="right">Right</option>
            </select>
          </label>
          <label>
            Text{" "}
            <input
              aria-label="Report font color"
              type="color"
              value={style?.color || "#000000"}
              disabled={!field || field.kind === "image"}
              onChange={(event) => updateStyle({ color: event.target.value })}
            />
          </label>
          <label>
            Shape{" "}
            <input
              aria-label="Shape color"
              type="color"
              value={color}
              onChange={(event) => {
                setColor(event.target.value);
                shapeUpdate({ color: event.target.value });
              }}
            />
          </label>
          {(mode === "rectangle" ||
            report.rectangles.find((item) => item.id === selected)?.kind ===
              "rectangle") && (
            <label>
              Line width{" "}
              <input
                aria-label="Shape line width"
                type="range"
                min=".5"
                max="12"
                step=".5"
                value={stroke}
                onChange={(event) => {
                  setStroke(Number(event.target.value));
                  shapeUpdate({ stroke_width: Number(event.target.value) });
                }}
              />
            </label>
          )}
        </div>
      </div>
      {(error || renderError) && (
        <p className="catalog-error" role="alert">
          {error || renderError}
        </p>
      )}
      <div
        className="interactive-report-preview"
        aria-busy={!!busy || rendering}
      >
        <TemplatePdfViewer
          source={background}
          overlay={(page, size) => (
            <>
              <div className="report-value-layer">
                {textures.map((texture) => {
                  const item = definition.fields.find(
                    (field) => field.id === texture.id,
                  );
                  if (!item) return null;
                  const box = boxFor(item);
                  if (box.page !== page) return null;
                  return (
                    <div
                      className="report-value"
                      data-live-field={item.id}
                      key={item.id}
                      style={{
                        visibility: editing === item.id ? "hidden" : undefined,
                        left: box.x * 100 + "%",
                        top: box.y * 100 + "%",
                        width: box.width * 100 + "%",
                        height: box.height * 100 + "%",
                      }}
                    >
                      <ValueCanvas texture={texture} label={item.label} />
                    </div>
                  );
                })}
              </div>
              <svg
                className={`report-control-layer${mode !== "normal" ? " drawing" : ""}`}
                viewBox="0 0 1 1"
                preserveAspectRatio="none"
                aria-label={`Report editing areas, page ${page + 1}`}
                onPointerDownCapture={(event) => {
                  // Stamp over existing input/shape hit targets too.
                  if (mode === "tick" && event.button === 0) beginShape(event, page);
                }}
                onPointerDown={(event) => {
                  if (mode === "rectangle" && event.button === 0)
                    beginShape(event, page);
                }}
                onPointerMove={move}
                onPointerUp={finish}
                onPointerCancel={finish}
              >
                {mode !== "normal" && (
                  <rect width="1" height="1" fill="transparent" />
                )}
                {definition.fields
                  .filter((item) => boxFor(item).page === page)
                  .map((item) => {
                    const box = boxFor(item),
                      active = fieldId === item.id;
                    return (
                      <g
                        key={item.id}
                        data-field-id={item.id}
                        data-kind={item.kind}
                        data-drop-field={item.id}
                        className={`report-field-area${active ? " selected" : ""}`}
                        style={{
                          pointerEvents: mode === "normal" ? "auto" : "none",
                        }}
                        onDragOver={(event) => {
                          event.preventDefault();
                          event.currentTarget.classList.add("drop-active");
                        }}
                        onDragLeave={(event) =>
                          event.currentTarget.classList.remove("drop-active")
                        }
                        onDrop={(event) => {
                          event.preventDefault();
                          event.currentTarget.classList.remove("drop-active");
                          const file = event.dataTransfer.files[0],
                            id = event.dataTransfer.getData(extractionMime);
                          if (file && item.kind === "image")
                            onImage?.(item.id, file);
                          else if (id) onExtraction?.(id, item);
                        }}
                      >
                        <rect
                          className="report-field-hit"
                          x={box.x}
                          y={box.y}
                          width={box.width}
                          height={box.height}
                          fill="transparent"
                          strokeWidth=".0015"
                          onPointerDown={(event) => beginField(event, item)}
                        />
                        {edges.map((edge) => {
                          const p = handlePoint(box, edge);
                          return (
                            <rect
                              key={edge}
                              className="report-resize-handle"
                              data-resize-edge={edge}
                              x={p.x - 0.004}
                              y={p.y - 0.004}
                              width=".008"
                              height=".008"
                              fill="white"
                              stroke="#263bb5"
                              strokeWidth=".0015"
                              style={{ cursor: `${edge}-resize` }}
                              onPointerDown={(event) =>
                                beginField(event, item, edge)
                              }
                            />
                          );
                        })}
                        {item.kind === "image" &&
                          !textures.some(
                            (texture) => texture.id === item.id,
                          ) && (
                            <text
                              x={box.x + box.width / 2}
                              y={box.y + box.height / 2}
                              textAnchor="middle"
                              fontSize=".012"
                              fill="#667085"
                              pointerEvents="none"
                            >
                              Drop image here
                            </text>
                          )}
                      </g>
                    );
                  })}
                {report.rectangles.map((shape) => {
                  const box = shapeBox(shape);
                  if (!box || box.page !== page) return null;
                  return (
                    <g
                      key={shape.id}
                      className={`report-shape-area${shape.id === selected ? " selected" : ""}`}
                      data-shape-id={shape.id}
                      onPointerEnter={() => setHovered(shape.id)}
                      onPointerLeave={() => setHovered(null)}
                      style={{
                        pointerEvents: mode === "normal" ? "auto" : "none",
                      }}
                    >
                      {shape.kind === "tick" ? (
                        <path
                          d={tickPath}
                          transform={`translate(${box.x} ${box.y}) scale(${box.width} ${box.height})`}
                          fill={shape.color}
                          pointerEvents="none"
                        />
                      ) : (
                        <rect
                          x={box.x}
                          y={box.y}
                          width={box.width}
                          height={box.height}
                          fill="none"
                          stroke={shape.color}
                          strokeWidth={shape.stroke_width / size.width}
                          pointerEvents="none"
                        />
                      )}
                      <rect
                        className="report-shape-hit"
                        x={box.x}
                        y={box.y}
                        width={box.width}
                        height={box.height}
                        fill="transparent"
                        strokeWidth=".001"
                        onPointerDown={(event) =>
                          beginShape(event, page, shape)
                        }
                      />
                      {edges.map((edge) => {
                        const p = handlePoint(box, edge);
                        return (
                          <rect
                            key={edge}
                            className="report-resize-handle"
                            data-resize-edge={edge}
                            x={p.x - 0.004}
                            y={p.y - 0.004}
                            width=".008"
                            height=".008"
                            fill="white"
                            stroke={shape.color}
                            strokeWidth=".0015"
                            onPointerDown={(event) =>
                              beginShape(event, page, shape, edge)
                            }
                          />
                        );
                      })}
                      <g
                        className="report-shape-delete"
                        role="button"
                        tabIndex={0}
                        aria-label={`Delete ${shape.kind || "rectangle"} ${shape.id}`}
                        transform={`translate(${Math.min(0.96, box.x + box.width - 0.02)} ${Math.max(0, box.y - 0.03)})`}
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={(event) => {
                          event.stopPropagation();
                          removeShape(shape.id);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            removeShape(shape.id);
                          }
                        }}
                      >
                        <title>Delete shape (Delete/Backspace)</title>
                        <rect
                          width=".03"
                          height=".025"
                          rx=".003"
                          fill="white"
                          stroke="#b42332"
                          strokeWidth=".001"
                        />
                        <path
                          d="M .008 .006 L .022 .019 M .022 .006 L .008 .019"
                          stroke="#b42332"
                          strokeWidth=".002"
                        />
                      </g>
                    </g>
                  );
                })}
              </svg>
              {definition.fields
                .filter(
                  (item) => item.id === editing && boxFor(item).page === page,
                )
                .map((item) => {
                  const box = boxFor(item),
                    override = report.styles[item.id];
                  const fonts: Record<string, string> = {
                    "Times-Roman": '"Times New Roman",serif',
                    "Times-Bold": '"Times New Roman",serif',
                    Helvetica: "Arial,sans-serif",
                    "Helvetica-Bold": "Arial,sans-serif",
                    Courier: '"Courier New",monospace',
                  };
                  const font = override?.font ?? item.font,
                    value = report.values[item.id] ?? item.default_value ?? "";
                  const common = {
                    autoFocus: true,
                    maxLength: 20000,
                    "aria-label": `Edit ${item.label} in preview`,
                    onBlur: () => setEditing(null),
                    onKeyDown: (
                      event: React.KeyboardEvent<
                        | HTMLTextAreaElement
                        | HTMLInputElement
                        | HTMLSelectElement
                      >,
                    ) => {
                      if (event.key === "Escape") {
                        event.preventDefault();
                        clearSelection();
                      } else if (
                        event.key === "Enter" &&
                        !event.shiftKey &&
                        !event.ctrlKey &&
                        !event.metaKey &&
                        !event.altKey &&
                        !event.nativeEvent.isComposing
                      ) {
                        event.preventDefault();
                        const next = nextReportField(
                          definition.fields,
                          report.layout,
                          item.id,
                        );
                        if (next) {
                          activate(next.id);
                          setEditing(next.id);
                        }
                      }
                    },
                    style: {
                      fontFamily: fonts[font] || fonts["Times-Roman"],
                      fontWeight: font.includes("Bold") ? 700 : 400,
                      fontSize: `${((override?.font_size ?? item.font_size) * 100) / size.width}cqw`,
                      color: override?.color ?? item.color,
                      textAlign: override?.alignment ?? item.alignment,
                    },
                  };
                  return (
                    <div
                      key={item.id}
                      className="report-inline-editor"
                      data-inline-editor={item.id}
                      style={{
                        left: `calc(${box.x * 100}% + ${100 / size.width}cqw)`,
                        top: `calc(${box.y * 100}% + ${100 / size.width}cqw)`,
                        width: `calc(${box.width * 100}% - ${200 / size.width}cqw)`,
                        height: `calc(${box.height * 100}% - ${200 / size.width}cqw)`,
                      }}
                    >
                      {item.kind === "checkbox" ? (
                        <input
                          {...common}
                          type="checkbox"
                          checked={value === true}
                          onChange={(event) =>
                            onValue?.(item, event.target.checked)
                          }
                        />
                      ) : item.kind === "select" ? (
                        <select
                          {...common}
                          value={String(value)}
                          onChange={(event) =>
                            onValue?.(item, event.target.value)
                          }
                        >
                          <option value="">Select…</option>
                          {item.options.map((option) => (
                            <option key={option}>{option}</option>
                          ))}
                        </select>
                      ) : item.kind === "text" || item.kind === "textarea" ? (
                        <textarea
                          {...common}
                          value={String(value)}
                          onChange={(event) =>
                            onValue?.(item, event.target.value)
                          }
                          spellCheck={false}
                        />
                      ) : (
                        <input
                          {...common}
                          type={
                            item.kind === "number"
                              ? "number"
                              : item.kind === "date"
                                ? "date"
                                : item.kind === "time"
                                  ? "time"
                                  : "text"
                          }
                          step={item.kind === "number" ? "any" : undefined}
                          value={String(value)}
                          onChange={(event) =>
                            onValue?.(item, event.target.value)
                          }
                        />
                      )}
                    </div>
                  );
                })}
            </>
          )}
        />
      </div>
    </div>
  );
}

"use client";

import { DragEvent, useEffect, useMemo, useRef, useState } from "react";
import { createWorker } from "tesseract.js";
import { ArrowLeft, CalendarDays, ChevronDown, Download, FileImage, Flame, LoaderCircle, Move, RectangleHorizontal, RotateCcw, Trash2, UploadCloud, X } from "lucide-react";

import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { apiBase, apiJson, DraftDetail, DraftSummary } from "@/lib/fault-report-api";

type Priority = "immediate" | "soon" | "shutdown" | "monitor";
type Offset = { x: number; y: number };
type ImageKind = "equipment" | "infrared";
type ImageRectangle = { id: string; image: ImageKind; x: number; y: number; width: number; height: number; color: string; stroke_width: number };
const imageFrames = {
  equipment: { x: 304.5, top: 240.5, width: 238, height: 178 },
  infrared: { x: 304.5, top: 427.7, width: 238, height: 168 },
} as const;
type LayoutKey = "equipment_image" | "infrared_image" | "report_number" | "company" | "division" |
  "report_date" | "report_time" | "period" | "emissivity" | "bx1" | "bx2" | "delta_t" |
  "ambient_temp" | "phase" | "rated_current" | "l1_current" | "l2_current" | "l3_current" |
  "neutral_current" | "l1_load" | "l2_load" | "l3_load" | "neutral_load" | "priority_tick" |
  "location" | "description" | "corrective_action";
type ReportForm = {
  report_title: string;
  report_number: string; company: string; division: string; report_date: string; report_time: string;
  period: "" | "A.M." | "P.M."; repair_priority: "" | Priority; emissivity: number | null; bx1: number | null;
  bx2: number | null; ambient_temp: number | null; phase: string; rated_current: string;
  l1_current: string; l2_current: string; l3_current: string; neutral_current: string;
  l1_load: string; l2_load: string; l3_load: string; neutral_load: string;
  location_line_1: string; description: string; corrective_action: string;
  layout_offsets: Partial<Record<LayoutKey, Offset>>;
  image_rectangles: ImageRectangle[];
  readings_confirmed: boolean;
};
const defaults: ReportForm = {
  report_title: "",
  report_number: "", company: "", division: "", report_date: "", report_time: "",
  period: "", repair_priority: "", emissivity: 0.85, bx1: null, bx2: null, ambient_temp: null,
  phase: "", rated_current: "", l1_current: "", l2_current: "", l3_current: "",
  neutral_current: "", l1_load: "", l2_load: "", l3_load: "", neutral_load: "",
  location_line_1: "", description: "", corrective_action: "",
  layout_offsets: {},
  image_rectangles: [],
  readings_confirmed: false,
};

const requiredFields: { key: keyof ReportForm; label: string }[] = [
  { key: "report_title", label: "Report title" }, { key: "report_number", label: "Report number" },
  { key: "company", label: "Company" }, { key: "division", label: "Division" },
  { key: "report_date", label: "Date" }, { key: "report_time", label: "Time" },
  { key: "period", label: "Period" }, { key: "repair_priority", label: "Repair priority" },
  { key: "emissivity", label: "Emissivity" }, { key: "ambient_temp", label: "Ambient temperature" },
  { key: "bx1", label: "Bx1 max temperature" }, { key: "bx2", label: "Bx2 reference temperature" },
  { key: "phase", label: "Phase" }, { key: "rated_current", label: "Rated current" },
  { key: "l1_current", label: "L1 current" }, { key: "l2_current", label: "L2 current" },
  { key: "l3_current", label: "L3 current" }, { key: "neutral_current", label: "Neutral current" },
  { key: "location_line_1", label: "Location" }, { key: "description", label: "Description" },
  { key: "corrective_action", label: "Corrective action and remarks" },
];
function isBlank(value: unknown): boolean { return value === null || value === undefined || (typeof value === "string" && !value.trim()); }
function missingFields(form: ReportForm): string[] {
  const missing = requiredFields.filter(({ key }) => isBlank(form[key])).map(({ label }) => label);
  if (form.bx1 !== null && form.bx2 !== null && !form.readings_confirmed) missing.push("Bx1/Bx2 review confirmation");
  return missing;
}

const priorities: { value: Priority; label: string }[] = [
  { value: "immediate", label: "Repair immediately" },
  { value: "soon", label: "Repair as soon as possible" },
  { value: "shutdown", label: "Repair at next shut-down" },
  { value: "monitor", label: "Continue monitoring" },
];
function numeric(value: string): number | null {
  if (value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
function rounded(value: number | null): string { return value === null ? "" : String(Math.round(value)); }
function currentPeriod(): ReportForm["period"] { return new Date().getHours() < 12 ? "A.M." : "P.M."; }
function formattedDate(value: string): string {
  if (!value) return "";
  const [year, month, day] = value.split("-");
  const monthName = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(month) - 1];
  return year && monthName && day ? `${day.padStart(2, "0")} ${monthName} ${year}` : value;
}
function formattedReportNumber(value: string): string { return /^\d$/.test(value) ? `0${value}` : value; }
function loadPercentage(current: string, rated: string): string {
  const measured = Number(current); const capacity = Number(rated);
  if (!current.trim() || !rated.trim() || !Number.isFinite(measured) || !Number.isFinite(capacity) || capacity <= 0) return "";
  return `${Math.round(measured / capacity * 100)}%`;
}
function extractReading(text: string, label: "Bx1" | "Bx2"): number | null {
  const normalized = text.replace(/[°º]/g, " ").replace(/,/g, ".");
  const labelPattern = label === "Bx1" ? "Bx[1Il]" : "Bx2"; // when looking for bx1, also accepts chr OCR might confuse with 1 like I or l
  const match = normalized.match(new RegExp(`${labelPattern}[^\\d-]{0,24}(-?\\d{1,3}(?:\\.\\d+)?)`, "i"));
  return match ? Number(match[1]) : null;
}
async function prepareEquipmentPhoto(file: File): Promise<File> {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, 2048 / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size <= 12 * 1024 * 1024) return file;
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Could not prepare the equipment photo");
    context.fillStyle = "white";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((result) => result ? resolve(result) : reject(new Error("Could not compress the equipment photo")), "image/jpeg", 0.88));
    if (blob.size > 12 * 1024 * 1024) throw new Error("The equipment photo is still too large after resizing");
    return new File([blob], `${file.name.replace(/\.[^.]+$/, "")}.jpg`, { type: "image/jpeg" });
  } finally { bitmap.close(); }
}
function Field({ label, empty = false, children }: { label: string; empty?: boolean; children: React.ReactNode }) {
  return <label className={`field-stack${empty ? " is-empty" : ""}`}><span>{label}</span>{children}</label>;
}

function UploadBox({ title, detail, file, preview, acceptFile, remove, busy = false, thermal = false }: {
  title: string; detail: string; file: File | null; preview: string | null; acceptFile: (file: File) => void;
  remove: () => void; busy?: boolean; thermal?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const handleFiles = (files: FileList | null) => { const next = files?.[0]; if (next) acceptFile(next); };
  return (
    <div className={`upload-box ${file ? "has-file" : ""}`} onDragOver={(event: DragEvent) => event.preventDefault()}
      onDrop={(event: DragEvent) => { event.preventDefault(); handleFiles(event.dataTransfer.files); }}>
      <input ref={inputRef} className="sr-only" type="file" accept="image/png,image/jpeg,image/webp"
        onChange={(event) => handleFiles(event.target.files)} />
      {preview ? <img src={preview} alt={`${title} preview`} /> : thermal ? <Flame aria-hidden="true" /> : <FileImage aria-hidden="true" />}
      <div className="upload-copy"><strong>{file?.name ?? title}</strong><span>{busy ? (thermal ? "Reading Bx values…" : "Preparing photo…") : detail}</span></div>
      {busy ? <LoaderCircle className="spin" aria-label="Reading image" /> : file ? (
        <Button type="button" size="icon" variant="ghost" onClick={remove} aria-label={`Remove ${title}`}><X /></Button>
      ) : <Button type="button" variant="outline" onClick={() => inputRef.current?.click()}><UploadCloud /> Choose image</Button>}
    </div>
  );
}

export default function FaultReportEditor({ draftId }: { draftId: string | null }) {
  const [form, setForm] = useState<ReportForm>(defaults);
  const [activeDraftId, setActiveDraftId] = useState<string | null>(draftId);
  const [draftLoading, setDraftLoading] = useState(Boolean(draftId));
  const [companies, setCompanies] = useState<string[]>([]);
  const [companyMenuOpen, setCompanyMenuOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [equipment, setEquipment] = useState<File | null>(null);
  const [infrared, setInfrared] = useState<File | null>(null);
  const [equipmentUrl, setEquipmentUrl] = useState<string | null>(null);
  const [infraredUrl, setInfraredUrl] = useState<string | null>(null);
  const [ocrText, setOcrText] = useState("");
  const [ocrConfidence, setOcrConfidence] = useState<number | null>(null);
  const [ocrBusy, setOcrBusy] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [downloadBusy, setDownloadBusy] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const [previewStatus, setPreviewStatus] = useState<"loading" | "ready" | "error">("loading");
  const [previewError, setPreviewError] = useState("");
  const [layoutMode, setLayoutMode] = useState(false);
  const [rectangleMode, setRectangleMode] = useState(false);
  const [rectangleColor, setRectangleColor] = useState("#ef2323");
  const [rectangleWidth, setRectangleWidth] = useState(3);
  const [selectedRectangleId, setSelectedRectangleId] = useState<string | null>(null);
  const [drawingRectangle, setDrawingRectangle] = useState<ImageRectangle | null>(null);
  const rectangleDragRef = useRef<{ image: ImageKind; startX: number; startY: number; id: string; action: "create" | "resize"; original?: ImageRectangle } | null>(null);
  const [paperScale, setPaperScale] = useState(1);
  const paperRef = useRef<HTMLDivElement>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const companyInputRef = useRef<HTMLInputElement>(null);
  const companyOptionRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const dragRef = useRef<{ key: LayoutKey; startX: number; startY: number; origin: Offset } | null>(null);
  const delta = useMemo(() => form.bx1 === null || form.bx2 === null ? null : Math.round((form.bx1 - form.bx2) * 10) / 10, [form.bx1, form.bx2]);
  const calculatedLoads = useMemo(() => ({
    l1_load: loadPercentage(form.l1_current, form.rated_current),
    l2_load: loadPercentage(form.l2_current, form.rated_current),
    l3_load: loadPercentage(form.l3_current, form.rated_current),
    neutral_load: loadPercentage(form.neutral_current, form.rated_current),
  }), [form.l1_current, form.l2_current, form.l3_current, form.neutral_current, form.rated_current]);
  const companyMatches = useMemo(() => companies.filter((name) => name.toLocaleLowerCase().startsWith(form.company.trim().toLocaleLowerCase())), [companies, form.company]);
  const missing = useMemo(() => missingFields(form), [form]);

  useEffect(() => {
    const flash = sessionStorage.getItem("fault-report-flash");
    if (!flash) return;
    sessionStorage.removeItem("fault-report-flash");
    const timer = window.setTimeout(() => setNotice(flash), 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (draftId) return;
    const timer = window.setTimeout(() => setForm((current) => current.period ? current : { ...current, period: currentPeriod() }), 0);
    return () => window.clearTimeout(timer);
  }, [draftId]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 3000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    let cancelled = false;
    void apiJson<{ drafts: DraftSummary[] }>("/api/drafts")
      .then((result) => {
        if (cancelled) return;
        const seen = new Set<string>();
        const names = result.drafts.map((draft) => draft.company.trim()).filter((name) => {
          const key = name.toLocaleLowerCase();
          if (!key || seen.has(key)) return false;
          seen.add(key); return true;
        });
        setCompanies(names.sort((a, b) => a.localeCompare(b)));
      })
      .catch(() => undefined);
    if (draftId) {
      void (async () => {
        try {
          const draft = await apiJson<DraftDetail>(`/api/drafts/${draftId}`);
          if (cancelled) return;
          setForm({ ...defaults, ...draft.form as Partial<ReportForm>, report_title: draft.title,
            repair_priority: (draft.form.repair_priority || "") as ReportForm["repair_priority"],
            layout_offsets: (draft.form.layout_offsets as ReportForm["layout_offsets"]) ?? {} });
          setActiveDraftId(draft.id);
          const loadImage = async (kind: "equipment" | "infrared", present: boolean, filename: string | null) => {
            if (!present) return;
            const response = await fetch(`${apiBase()}/api/drafts/${draftId}/images/${kind}`);
            if (!response.ok) throw new Error(`Could not load ${kind} image`);
            const blob = await response.blob();
            if (cancelled) return;
            const file = new File([blob], filename || `${kind}.png`, { type: blob.type });
            const url = URL.createObjectURL(file);
            if (kind === "equipment") { setEquipment(file); setEquipmentUrl(url); }
            else { setInfrared(file); setInfraredUrl(url); }
          };
          await Promise.all([loadImage("equipment", draft.has_equipment_image, draft.equipment_filename), loadImage("infrared", draft.has_infrared_image, draft.infrared_filename)]);
          if (!cancelled) setDraftLoading(false);
        } catch (cause) { if (!cancelled) { setDraftLoading(false); setNotice(cause instanceof Error ? cause.message : "Could not open draft"); } }
      })();
    }
    return () => { cancelled = true; };
  }, [draftId]);

  useEffect(() => {
    if (draftLoading) return;
    const controller = new AbortController();
    let cancelled = false;
    let renderTask: { cancel: () => void; promise: Promise<void> } | undefined;
    const timer = window.setTimeout(async () => {
      try {
        const canvas = previewCanvasRef.current;
        if (!canvas) return;
        setPreviewStatus("loading");
        setPreviewError("");
        const payload = new FormData();
        payload.append("report_json", JSON.stringify({ ...form, report_number: formattedReportNumber(form.report_number), ...calculatedLoads }));
        if (equipment) payload.append("equipment_image", equipment);
        if (infrared) payload.append("infrared_image", infrared);
        const response = await fetch(`${apiBase()}/api/reports/preview`, { method: "POST", body: payload, signal: controller.signal });
        if (!response.ok) {
          const problem = await response.json().catch(() => null) as { detail?: string } | null;
          throw new Error(typeof problem?.detail === "string" ? problem.detail : `Preview request failed (${response.status})`);
        }
        const { GlobalWorkerOptions, getDocument } = await import("pdfjs-dist");
        GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).pathname;
        const loadingTask = getDocument({ data: new Uint8Array(await response.arrayBuffer()) });
        const document = await loadingTask.promise;
        try {
          const page = await document.getPage(1);
          if (cancelled) return;
          const scale = Math.max(0.25, paperScale) * window.devicePixelRatio;
          const viewport = page.getViewport({ scale });
          canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
          const context = canvas.getContext("2d");
          if (!context) throw new Error("Canvas is unavailable");
          renderTask = page.render({ canvas, canvasContext: context, viewport });
          await renderTask.promise;
          if (!cancelled) setPreviewStatus("ready");
        } finally { await document.destroy(); }
      } catch (cause) {
        if (!cancelled) { setPreviewStatus("error"); setPreviewError(cause instanceof Error ? cause.message : "Preview unavailable"); }
      }
    }, 250);
    return () => { cancelled = true; window.clearTimeout(timer); controller.abort(); renderTask?.cancel(); };
  }, [form, calculatedLoads, equipment, infrared, paperScale, draftLoading]);

  useEffect(() => {
    const context = document.modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    const allowed = new Set(["report_number", "company", "division", "report_date", "report_time", "emissivity", "bx1", "bx2", "ambient_temp", "phase", "location_line_1", "description", "corrective_action"]);
    void Promise.resolve(context.registerTool({
      name: "stage_fault_report_fields",
      title: "Stage fault report fields",
      description: "Populate editable fault report fields in the visible form without downloading the PDF.",
      inputSchema: { type: "object", additionalProperties: true },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute(input) {
        if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Expected an object of report fields");
        const updates = Object.fromEntries(Object.entries(input).filter(([key]) => allowed.has(key))) as Partial<ReportForm>;
        if (Object.keys(updates).length === 0) throw new Error("No supported report fields were supplied");
        setForm((current) => ({ ...current, ...updates, readings_confirmed: updates.bx1 !== undefined || updates.bx2 !== undefined ? false : current.readings_confirmed }));
        setNotice("Report fields updated");
        return { updated: Object.keys(updates) };
      },
    }, { signal: lifecycle.signal })).catch(() => undefined);
    return () => lifecycle.abort();
  }, []);

  useEffect(() => () => { if (equipmentUrl) URL.revokeObjectURL(equipmentUrl); if (infraredUrl) URL.revokeObjectURL(infraredUrl); }, [equipmentUrl, infraredUrl]);
  useEffect(() => {
    const paper = paperRef.current;
    if (!paper) return;
    const update = () => setPaperScale(paper.getBoundingClientRect().width / 612);
    update();
    const observer = new ResizeObserver(update); observer.observe(paper);
    return () => observer.disconnect();
  }, []);
  const set = <K extends keyof ReportForm>(key: K, value: ReportForm[K]) => {
    setPreviewStatus("loading");
    setForm((current) => ({ ...current, [key]: value }));
  };
  const dragProps = (key: LayoutKey) => {
    const offset = form.layout_offsets[key] ?? { x: 0, y: 0 };
    return {
      style: { transform: `translate(${offset.x * paperScale}px, ${offset.y * paperScale}px)` } as React.CSSProperties,
      onPointerDown: (event: React.PointerEvent<HTMLElement>) => {
        if (!layoutMode) return;
        event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
        // This ref is accessed only when the pointer event fires, never during render.
        // eslint-disable-next-line react-hooks/refs
        dragRef.current = { key, startX: event.clientX, startY: event.clientY, origin: offset };
      },
      onPointerMove: (event: React.PointerEvent<HTMLElement>) => {
        const drag = dragRef.current;
        if (!layoutMode || !drag || drag.key !== key) return;
        const next = {
          x: Math.max(-144, Math.min(144, Math.round((drag.origin.x + (event.clientX - drag.startX) / paperScale) * 2) / 2)),
          y: Math.max(-144, Math.min(144, Math.round((drag.origin.y + (event.clientY - drag.startY) / paperScale) * 2) / 2)),
        };
        setPreviewStatus("loading");
        setForm((current) => ({ ...current, layout_offsets: { ...current.layout_offsets, [key]: next } }));
      },
      onPointerUp: (event: React.PointerEvent<HTMLElement>) => {
        if (dragRef.current?.key === key) { dragRef.current = null; event.currentTarget.releasePointerCapture(event.pointerId); }
      },
    };
  };
  const dragClass = (base: string) => `${base} layout-draggable${layoutMode ? " is-arranging" : ""}`;

  const imagePoint = (event: React.PointerEvent<SVGSVGElement>, image: ImageKind) => {
    const box = event.currentTarget.getBoundingClientRect();
    const frame = imageFrames[image];
    const offset = form.layout_offsets[`${image}_image`] ?? { x: 0, y: 0 };
    const pageX = (event.clientX - box.left) * 612 / box.width;
    const pageY = (event.clientY - box.top) * 792 / box.height;
    return {
      x: Math.max(0, Math.min(1, (pageX - frame.x - offset.x) / frame.width)),
      y: Math.max(0, Math.min(1, (pageY - frame.top - offset.y) / frame.height)),
      inside: pageX >= frame.x && pageX <= frame.x + frame.width && pageY >= frame.top && pageY <= frame.top + frame.height,
    };
  };
  const rectangleBox = (rectangle: ImageRectangle) => {
    const frame = imageFrames[rectangle.image];
    const offset = form.layout_offsets[`${rectangle.image}_image`] ?? { x: 0, y: 0 };
    return { x: frame.x + offset.x + rectangle.x * frame.width, y: frame.top + offset.y + rectangle.y * frame.height,
      width: rectangle.width * frame.width, height: rectangle.height * frame.height };
  };
  const startRectangle = (event: React.PointerEvent<SVGSVGElement>) => {
    if (!rectangleMode) return;
    if (form.image_rectangles.length >= 100) { setNotice("A report can contain at most 100 rectangles"); return; }
    const image = (Object.keys(imageFrames) as ImageKind[]).find((kind) =>
      (kind === "equipment" ? equipment : infrared) && imagePoint(event, kind).inside);
    if (!image) { setNotice("Add an image, then draw inside its frame"); return; }
    const point = imagePoint(event, image);
    const id = crypto.randomUUID();
    rectangleDragRef.current = { image, startX: point.x, startY: point.y, id, action: "create" };
    setSelectedRectangleId(id);
    setDrawingRectangle({ id, image, x: point.x, y: point.y, width: 0.001, height: 0.001, color: rectangleColor, stroke_width: rectangleWidth });
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const moveRectangle = (event: React.PointerEvent<SVGSVGElement>) => {
    const drag = rectangleDragRef.current;
    if (!drag) return;
    const point = imagePoint(event, drag.image);
    if (drag.action === "resize" && drag.original) {
      const next = { ...drag.original, width: Math.max(0.01, point.x - drag.original.x), height: Math.max(0.01, point.y - drag.original.y) };
      setDrawingRectangle(next);
    } else {
      setDrawingRectangle({ id: drag.id, image: drag.image, x: Math.min(drag.startX, point.x), y: Math.min(drag.startY, point.y),
        width: Math.max(0.001, Math.abs(point.x - drag.startX)), height: Math.max(0.001, Math.abs(point.y - drag.startY)),
        color: rectangleColor, stroke_width: rectangleWidth });
    }
  };
  const finishRectangle = (event: React.PointerEvent<SVGSVGElement>) => {
    const drag = rectangleDragRef.current;
    if (!drag) return;
    rectangleDragRef.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
    const point = imagePoint(event, drag.image);
    const finalRectangle = drag.action === "resize" && drag.original
      ? { ...drag.original, width: Math.max(0.01, point.x - drag.original.x), height: Math.max(0.01, point.y - drag.original.y) }
      : { id: drag.id, image: drag.image, x: Math.min(drag.startX, point.x), y: Math.min(drag.startY, point.y),
        width: Math.abs(point.x - drag.startX), height: Math.abs(point.y - drag.startY), color: rectangleColor, stroke_width: rectangleWidth };
    if (finalRectangle.width >= 0.01 && finalRectangle.height >= 0.01) {
      setForm((current) => ({ ...current, image_rectangles: drag.action === "resize"
        ? current.image_rectangles.map((item) => item.id === drag.id ? finalRectangle : item)
        : [...current.image_rectangles, finalRectangle] }));
    }
    setDrawingRectangle(null);
  };
  const changeSelectedRectangle = (changes: Partial<ImageRectangle>) => {
    setForm((current) => ({ ...current, image_rectangles: current.image_rectangles.map((item) => item.id === selectedRectangleId ? { ...item, ...changes } : item) }));
  };

  const setImage = async (kind: ImageKind, file: File) => {
    if (!file.type.match(/^image\/(png|jpeg|webp)$/)) { setNotice("Use a PNG, JPEG, or WebP image"); return; }
    if (kind === "equipment") {
      setPhotoBusy(true);
      try {
        const prepared = await prepareEquipmentPhoto(file);
        const url = URL.createObjectURL(prepared);
        if (equipmentUrl) URL.revokeObjectURL(equipmentUrl);
        setPreviewStatus("loading"); setEquipment(prepared); setEquipmentUrl(url);
        setNotice(prepared === file ? "Equipment photograph added" : "Equipment photograph resized and added");
      } catch (error) { setNotice(error instanceof Error ? error.message : "Could not read the equipment photo"); }
      finally { setPhotoBusy(false); }
    } else {
      if (file.size > 12 * 1024 * 1024) { setNotice("Infrared image must be smaller than 12 MB"); return; }
      const url = URL.createObjectURL(file);
      if (infraredUrl) URL.revokeObjectURL(infraredUrl);
      setPreviewStatus("loading"); setInfrared(file); setInfraredUrl(url); set("readings_confirmed", false); void runOcr(file);
    }
  };

  const runOcr = async (file = infrared) => {
    if (!file) return;
    setOcrBusy(true); //shows loading state 
    setNotice("Reading the infrared image");
    try {
      const bitmap = await createImageBitmap(file); // decodes image into sth browser can draw
      const cropWidth = Math.max(1, Math.floor(bitmap.width * 0.58));
      const cropHeight = Math.max(1, Math.floor(bitmap.height * 0.24)); //crops 58% width and 24% height from left and top respectively
      // ocr doesnt inspect full image
      const canvas = document.createElement("canvas");
      canvas.width = cropWidth * 3; canvas.height = cropHeight * 3; //makes canvas 3* crop width n height, enlarge small texts
      const context = canvas.getContext("2d", { willReadFrequently: true }); //willReadFrequently optimisation hint passed to browser that codes intent to frequently read back pixel data using getImageData() or similar
      // by default browser stores canvas rendering buffers on gpu for faster drawing, setting this attribute true encourage browser store canvas data in cpu to avoid expensive cpu-gpu memory sync bottlenecks
      // getContext("2d") creates and returns 2d rendering context obj. without, canvas is a empty html container w no ability to draw/ manipulate graphics

      if (!context) throw new Error("Canvas is unavailable");
      context.drawImage(bitmap, 0, 0, cropWidth, cropHeight, 0, 0, canvas.width, canvas.height); //draws cropped ir image onto canvas. first 4 coordinates source crop, last 4 where and how large to draw it
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height); //returns JS array, each pixel has rgb and alpha values
      for (let index = 0; index < pixels.data.length; index += 4) {
        const luminance = pixels.data[index] * .299 + pixels.data[index + 1] * .587 + pixels.data[index + 2] * .114; 
        const output = luminance > 155 ? 0 : 255; //converts image to bnw image using brightness as the deciding factor
        pixels.data[index] = output; pixels.data[index + 1] = output; pixels.data[index + 2] = output; //alpha left unchanged
      }
      context.putImageData(pixels, 0, 0); //writes changed pixels back into canvas
      bitmap.close();
      const worker = await createWorker("eng", 1, { langPath: "/" }); //creates Tesseract.js OCR worker: "eng" english, 1 selects its LSTM-only (long short-term memory) recognition mode (recognise full lines of text instead of indiv characters 1by1); langPath points to locally served english language file
      const result = await worker.recognize(canvas); 
      await worker.terminate(); //stops worker after recognition
      const text = result.data.text.trim();
      const bx1 = extractReading(text, "Bx1"); const bx2 = extractReading(text, "Bx2");
      setOcrText(text); setOcrConfidence(Math.round(result.data.confidence));
      // stores raw OCR test for review panel and displays Tesseract's rounded overall confidence score
      setPreviewStatus("loading");
      setForm((current) => ({ ...current, bx1: bx1 ?? current.bx1, bx2: bx2 ?? current.bx2, readings_confirmed: false })); 
      // puts extracted values into form, if not extracted, current bx1 values remain
      setNotice(bx1 === null || bx2 === null ? "One or more readings need manual review" : `Read Bx1 ${bx1.toFixed(1)} °C and Bx2 ${bx2.toFixed(1)} °C`);
    } catch { setNotice("Automatic reading failed. Enter Bx1 and Bx2 manually."); setOcrText(""); setOcrConfidence(null); }
    finally { setOcrBusy(false); }
  };

  const resetForm = () => {
    setForm({ ...defaults, period: currentPeriod() });
    setEquipment(null); setInfrared(null);
    setEquipmentUrl(null); setInfraredUrl(null);
    setOcrText(""); setOcrConfidence(null);
    setSelectedRectangleId(null); setDrawingRectangle(null);
    setCompanyMenuOpen(false);
    setResetOpen(false);
    setNotice("Fields and images cleared; saved draft unchanged until Save draft");
  };
  const saveDraft = async () => {
    if (!form.report_title.trim()) { setNotice("Enter a report title before saving"); return; }
    setSaveBusy(true); setNotice("Saving draft");
    try {
      const payload = new FormData();
      payload.append("report_json", JSON.stringify({ ...form, report_title: form.report_title.trim(), report_number: formattedReportNumber(form.report_number), ...calculatedLoads }));
      if (equipment) payload.append("equipment_image", equipment);
      if (infrared) payload.append("infrared_image", infrared);
      const update = Boolean(activeDraftId);
      const saved = await apiJson<DraftDetail>(update ? `/api/drafts/${activeDraftId}` : "/api/drafts", {
        method: update ? "PUT" : "POST", body: payload,
      });
      setActiveDraftId(saved.id);
      const message = missing.length ? `Saved ${saved.title}. Still blank: ${missing.join(", ")}.` : `Saved ${saved.title}. All fields are filled.`;
      setNotice(message);
      if (!update) {
        sessionStorage.setItem("fault-report-flash", message);
        window.location.assign(`/templates/fault-report/drafts/${saved.id}`);
      }
    } catch (cause) { setNotice(cause instanceof Error ? cause.message : "Could not save draft"); }
    finally { setSaveBusy(false); }
  };
  const downloadPdf = async () => {
    if (form.bx1 !== null && form.bx2 !== null && !form.readings_confirmed) { setNotice("Confirm the infrared readings before downloading"); return; }
    setDownloadBusy(true); setNotice("Preparing the finished PDF");
    try {
      const payload = new FormData(); payload.append("report_json", JSON.stringify({ ...form, report_number: formattedReportNumber(form.report_number), ...calculatedLoads }));
      if (equipment) payload.append("equipment_image", equipment); if (infrared) payload.append("infrared_image", infrared);
      const response = await fetch(`${apiBase()}/api/reports/generate`, { method: "POST", body: payload });
      if (!response.ok) { const error = await response.json().catch(() => null) as { detail?: string } | null; throw new Error(error?.detail ?? "The report could not be generated"); }
      const blob = await response.blob(); const disposition = response.headers.get("content-disposition") ?? "";
      const title = form.report_title.trim().replace(/[^A-Za-z0-9 ._-]+/g, "").trim() || "Fault Report";
      const filename = disposition.match(/filename="([^"]+)"/)?.[1] ?? `${title}.pdf`;
      const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = filename; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice("PDF downloaded");
    } catch (error) { setNotice(error instanceof Error ? error.message : "The report could not be generated"); }
    finally { setDownloadBusy(false); }
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <a href="/templates/fault-report" className="editor-back" aria-label="Back to fault report drafts"><ArrowLeft size={18} /></a>
        <div className="brand-mark" aria-hidden="true"><Flame /></div>
        <div><h1>{activeDraftId ? form.report_title || "Fault Report Editor" : "New Fault Report"}</h1><p>{activeDraftId ? "Editing saved draft" : "Unsaved report"} · Field entry and calibrated PDF output</p></div>
        <div className="topbar-actions"><Button variant="outline" onClick={() => setResetOpen(true)}><RotateCcw /> Reset</Button><Button onClick={() => void saveDraft()} disabled={saveBusy}>{saveBusy ? <LoaderCircle className="spin" /> : null}Save draft</Button><Button className={missing.length ? "download-incomplete" : ""} onClick={downloadPdf} disabled={downloadBusy} title={missing.length ? `${missing.length} fields still blank; a partial PDF can still be downloaded` : "Download completed PDF"}>{downloadBusy ? <LoaderCircle className="spin" /> : <Download />}Download PDF</Button></div>
      </header>
      <div className="workspace">
        <section className="editor-panel" aria-label="Fault report fields">
          <div className="section-heading"><div><span>01</span><h2>Report details</h2></div></div>
          <Field label="Report title (required to save)" empty={isBlank(form.report_title)}><Input value={form.report_title} maxLength={100} placeholder="e.g. Switchboard thermal fault" onChange={(e) => set("report_title", e.target.value)} /></Field>
          <div className="field-grid three">
            <Field label="Report number" empty={isBlank(form.report_number)}><Input value={form.report_number} onChange={(e) => set("report_number", e.target.value)} onBlur={(e) => set("report_number", formattedReportNumber(e.target.value))} /></Field>
            <div className={`field-stack${isBlank(form.company) ? " is-empty" : ""}`}>
              <label htmlFor="report-company">Company</label>
              <div className="company-combobox" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setCompanyMenuOpen(false); }}>
                <Input ref={companyInputRef} id="report-company" maxLength={42} autoComplete="off" role="combobox"
                  aria-autocomplete="list" aria-expanded={companyMenuOpen && companyMatches.length > 0} aria-controls="company-options"
                  value={form.company} onFocus={() => setCompanyMenuOpen(true)}
                  onChange={(event) => { set("company", event.target.value); setCompanyMenuOpen(true); }}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") setCompanyMenuOpen(false);
                    if (event.key === "ArrowDown" && companyMatches.length > 0) {
                      event.preventDefault(); setCompanyMenuOpen(true);
                      window.requestAnimationFrame(() => companyOptionRefs.current[0]?.focus());
                    }
                  }} />
                <button type="button" className="company-combobox-toggle" aria-label="Show saved companies"
                  aria-expanded={companyMenuOpen} onClick={() => setCompanyMenuOpen((open) => !open)}><ChevronDown size={16} /></button>
                {companyMenuOpen && companyMatches.length > 0 && <div id="company-options" className="company-options" role="listbox">
                  {companyMatches.map((name, index) => <button key={name} ref={(element) => { companyOptionRefs.current[index] = element; }}
                    type="button" role="option" aria-selected={form.company === name}
                    onClick={() => { set("company", name); companyInputRef.current?.focus(); setCompanyMenuOpen(false); }}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") { setCompanyMenuOpen(false); companyInputRef.current?.focus(); }
                      if (event.key === "ArrowDown") { event.preventDefault(); companyOptionRefs.current[(index + 1) % companyMatches.length]?.focus(); }
                      if (event.key === "ArrowUp") { event.preventDefault(); if (index === 0) companyInputRef.current?.focus(); else companyOptionRefs.current[index - 1]?.focus(); }
                    }}>{name}</button>)}
                </div>}
              </div>
            </div>
            <Field label="Division" empty={isBlank(form.division)}><Input value={form.division} onChange={(e) => set("division", e.target.value)} /></Field>
            <Field label="Date (dd mmm yyyy)" empty={isBlank(form.report_date)}><div className="date-input"><CalendarDays aria-hidden="true" /><Input type="date" value={form.report_date} onChange={(e) => set("report_date", e.target.value)} /><small>{formattedDate(form.report_date) || "dd mmm yyyy"}</small></div></Field>
            <Field label="Time" empty={isBlank(form.report_time)}><Input value={form.report_time} onChange={(e) => set("report_time", e.target.value)} /></Field>
            <Field label="Period" empty={isBlank(form.period)}><select value={form.period} onChange={(e) => set("period", e.target.value as "" | "A.M." | "P.M.")}><option value="">Select…</option><option>A.M.</option><option>P.M.</option></select></Field>
          </div>
          <div className="section-heading"><div><span>02</span><h2>Priority and readings</h2></div></div>
          <div className="priority-reading-grid">
            <RadioGroup value={form.repair_priority} onValueChange={(value) => set("repair_priority", value as Priority)} className={`priority-list${isBlank(form.repair_priority) ? " is-empty" : ""}`}>
              {priorities.map((priority) => <label key={priority.value} className="priority-option" onClick={() => set("repair_priority", priority.value)}><RadioGroupItem value={priority.value} /><span>{priority.label}</span></label>)}
            </RadioGroup>
            <div className="field-grid two compact">
              <Field label="Emissivity" empty={isBlank(form.emissivity)}><Input type="number" step="0.01" value={form.emissivity ?? ""} onChange={(e) => set("emissivity", numeric(e.target.value))} /></Field>
              <Field label="Ambient °C" empty={isBlank(form.ambient_temp)}><Input type="number" value={form.ambient_temp ?? ""} onChange={(e) => set("ambient_temp", numeric(e.target.value))} /></Field>
              <Field label="Bx1 max °C" empty={isBlank(form.bx1)}><Input type="number" step="0.1" value={form.bx1 ?? ""} onChange={(e) => { set("bx1", numeric(e.target.value)); set("readings_confirmed", false); }} /></Field>
              <Field label="Bx2 reference °C" empty={isBlank(form.bx2)}><Input type="number" step="0.1" value={form.bx2 ?? ""} onChange={(e) => { set("bx2", numeric(e.target.value)); set("readings_confirmed", false); }} /></Field>
              <Field label="ΔT °C"><Input value={delta ?? ""} readOnly /></Field>
            </div>
          </div>
          <div className="section-heading"><div><span>03</span><h2>Images</h2></div></div>
          <div className="upload-list">
            <UploadBox title="Equipment photograph" detail="Visual reference only — no data is read" file={equipment} preview={equipmentUrl} busy={photoBusy} acceptFile={(file) => { void setImage("equipment", file); }} remove={() => { setEquipment(null); setEquipmentUrl(null); setForm((current) => ({ ...current, image_rectangles: current.image_rectangles.filter((item) => item.image !== "equipment") })); }} />
            <UploadBox title="Infrared photograph" detail="Bx1 and Bx2 are read from this image only" file={infrared} preview={infraredUrl} thermal busy={ocrBusy} acceptFile={(file) => { void setImage("infrared", file); }} remove={() => { setInfrared(null); setInfraredUrl(null); setOcrText(""); setOcrConfidence(null); setForm((current) => ({ ...current, image_rectangles: current.image_rectangles.filter((item) => item.image !== "infrared") })); }} />
          </div>
          {(infrared || form.bx1 !== null || form.bx2 !== null) && <div className={`ocr-review${form.bx1 !== null && form.bx2 !== null && !form.readings_confirmed ? " is-empty" : ""}`}><div><strong>Infrared reading review</strong><span>{ocrConfidence === null ? "Manual entry" : `OCR confidence ${ocrConfidence}%`}</span></div><code>{ocrText || "No readable labels detected"}</code><Button type="button" variant="outline" onClick={() => void runOcr()} disabled={ocrBusy || !infrared}><RotateCcw /> Read again</Button><label className="confirm-row"><Checkbox checked={form.readings_confirmed} onCheckedChange={(checked) => set("readings_confirmed", checked === true)} />I have checked Bx1 and Bx2</label></div>}
          <div className="section-heading"><div><span>04</span><h2>Load current</h2></div></div>
          <Field label="Phase" empty={isBlank(form.phase)}><Input value={form.phase} onChange={(e) => set("phase", e.target.value)} /></Field>
          <Field label="Rated current (Amps)" empty={isBlank(form.rated_current)}><Input value={form.rated_current} onChange={(e) => set("rated_current", e.target.value)} /></Field>
          <div className="current-table"><span>Phase</span><span>Measured current (Amps)</span>{(["l1", "l2", "l3", "neutral"] as const).map((phase, index) => <div className="current-row" key={phase}><strong>{["L1", "L2", "L3", "N"][index]}</strong><Input className={isBlank(form[`${phase}_current`]) ? "empty-input" : ""} inputMode="decimal" value={form[`${phase}_current`]} onChange={(e) => set(`${phase}_current`, e.target.value)} /></div>)}</div>
          <div className="section-heading"><div><span>05</span><h2>Location and findings</h2></div></div>
          <Field label="Location" empty={isBlank(form.location_line_1)}><Input value={form.location_line_1} onChange={(e) => set("location_line_1", e.target.value)} /></Field>
          <Field label="Description" empty={isBlank(form.description)}><Textarea rows={4} value={form.description} onChange={(e) => set("description", e.target.value)} /></Field>
          <Field label="Recommended corrective action and remarks" empty={isBlank(form.corrective_action)}><Textarea rows={5} value={form.corrective_action} onChange={(e) => set("corrective_action", e.target.value)} /></Field>
        </section>
        <aside className="preview-panel" aria-label="Report preview">
          <div className="preview-toolbar"><div><strong>Live preview</strong><span>{layoutMode ? "Drag highlighted components; finish arranging to see the exact PDF" : rectangleMode ? "Drag inside either image to draw; click a rectangle to resize it" : previewStatus === "loading" ? "Updating the PDF preview…" : previewStatus === "error" ? `Preview unavailable: ${previewError}` : "Rendered from the current fields, using the same PDF as Download"}</span></div><div className="preview-actions"><Button type="button" size="sm" variant={layoutMode ? "default" : "outline"} onClick={() => { setRectangleMode(false); setLayoutMode((current) => !current); }}><Move />{layoutMode ? "Finish arranging" : "Arrange layout"}</Button>{layoutMode && <Button type="button" size="sm" variant="ghost" onClick={() => set("layout_offsets", {})}><RotateCcw />Reset positions</Button>}<Button type="button" size="sm" variant={rectangleMode ? "default" : "outline"} onClick={() => { setLayoutMode(false); setRectangleMode((current) => !current); }}><RectangleHorizontal />{rectangleMode ? "Finish drawing" : "Draw rectangle"}</Button><span className="page-badge">LETTER · 1 PAGE</span></div></div>
          {rectangleMode && <div className="rectangle-tools"><label>Colour <input type="color" value={rectangleColor} onChange={(event) => { setRectangleColor(event.target.value); changeSelectedRectangle({ color: event.target.value }); }} /></label><label>Line width <input type="range" min="1" max="12" step="0.5" value={rectangleWidth} onChange={(event) => { const value = Number(event.target.value); setRectangleWidth(value); changeSelectedRectangle({ stroke_width: value }); }} /><span>{rectangleWidth} pt</span></label><Button type="button" size="sm" variant="outline" disabled={!selectedRectangleId} onClick={() => { setForm((current) => ({ ...current, image_rectangles: current.image_rectangles.filter((item) => item.id !== selectedRectangleId) })); setSelectedRectangleId(null); }}><Trash2 /> Delete selected</Button></div>}
          <div className="paper-stage"><div className={`paper${layoutMode ? " arranging" : ""}`} ref={paperRef}>
            <img className="template-image" src="/template-preview.png?v=20260928-blue-frame" alt="Fault report template preview" />
            <canvas ref={previewCanvasRef} className={`exact-pdf-preview${previewStatus === "ready" ? " is-ready" : ""}`} aria-label="Exact generated PDF preview" />
            {rectangleMode && <svg className="rectangle-layer" viewBox="0 0 612 792" preserveAspectRatio="none" onPointerDown={startRectangle} onPointerMove={moveRectangle} onPointerUp={finishRectangle} onPointerCancel={() => { rectangleDragRef.current = null; setDrawingRectangle(null); }} aria-label="Draw rectangles over the uploaded images">
              <rect width="612" height="792" fill="transparent" />
              {[...form.image_rectangles, ...(drawingRectangle && !form.image_rectangles.some((item) => item.id === drawingRectangle.id) ? [drawingRectangle] : [])].map((rectangle) => {
                const box = rectangleBox(drawingRectangle?.id === rectangle.id ? drawingRectangle : rectangle);
                const selected = selectedRectangleId === rectangle.id;
                return <g key={rectangle.id}><rect x={box.x} y={box.y} width={box.width} height={box.height} fill="transparent" stroke={rectangle.color} strokeWidth={rectangle.stroke_width} onPointerDown={(event) => { event.stopPropagation(); setSelectedRectangleId(rectangle.id); setRectangleColor(rectangle.color); setRectangleWidth(rectangle.stroke_width); }} />{selected && <circle cx={box.x + box.width} cy={box.y + box.height} r="6" fill="#fff" stroke={rectangle.color} strokeWidth="2" onPointerDown={(event) => { event.stopPropagation(); const svg = event.currentTarget.ownerSVGElement; if (!svg) return; rectangleDragRef.current = { image: rectangle.image, startX: rectangle.x, startY: rectangle.y, id: rectangle.id, action: "resize", original: rectangle }; svg.setPointerCapture(event.pointerId); }} />}</g>;
              })}
            </svg>}
            {!layoutMode && previewStatus !== "ready" && <div className="preview-state" role="status">{previewStatus === "loading" ? <><LoaderCircle className="spin" /> {draftLoading ? "Loading saved draft…" : "Updating preview from current fields…"}</> : <>Preview unavailable. {previewError || "Check that the fault-report service is running."}</>}</div>}
            {equipmentUrl && <img {...dragProps("equipment_image")} draggable={false} className={dragClass("preview-equipment")} src={equipmentUrl} alt="Equipment" />}{infraredUrl && <img {...dragProps("infrared_image")} draggable={false} className={dragClass("preview-infrared")} src={infraredUrl} alt="Infrared" />}
            <span {...dragProps("report_number")} className={dragClass("pv pv-report")}>{formattedReportNumber(form.report_number)}</span><span {...dragProps("company")} className={dragClass("pv pv-company")}>{form.company}</span><span {...dragProps("division")} className={dragClass("pv pv-division")}>{form.division}</span><span {...dragProps("report_date")} className={dragClass("pv pv-date")}>{formattedDate(form.report_date)}</span><span {...dragProps("report_time")} className={dragClass("pv pv-time")}>{form.report_time}</span><span {...dragProps("period")} className={dragClass("pv pv-period")}>{form.period}</span><span {...dragProps("emissivity")} className={dragClass("pv pv-emissivity")}>{form.emissivity === null ? "" : form.emissivity.toFixed(2)}</span><span {...dragProps("bx1")} className={dragClass("pv pv-bx1")}>{rounded(form.bx1)}</span><span {...dragProps("bx2")} className={dragClass("pv pv-bx2")}>{rounded(form.bx2)}</span><span {...dragProps("delta_t")} className={dragClass("pv pv-delta")}>{rounded(delta)}</span><span {...dragProps("ambient_temp")} className={dragClass("pv pv-ambient")}>{rounded(form.ambient_temp)}</span><span {...dragProps("phase")} className={dragClass("pv pv-phase")}>{form.phase}</span><span {...dragProps("rated_current")} className={dragClass("pv pv-rated")}>{form.rated_current}</span>
            {(["l1", "l2", "l3", "neutral"] as const).map((phase, index) => <span key={`preview-${phase}`}><span {...dragProps(`${phase}_current`)} className={dragClass(`pv pv-current pv-row-${index + 1}`)}>{form[`${phase}_current`]}</span><span {...dragProps(`${phase}_load`)} className={dragClass(`pv pv-load pv-row-${index + 1}`)}>{calculatedLoads[`${phase}_load`]}</span></span>)}
            {form.repair_priority && <span {...dragProps("priority_tick")} className={dragClass(`priority-tick priority-${form.repair_priority}`)} aria-hidden="true" />}
            <div {...dragProps("location")} className={dragClass("pv pv-location")}>{form.location_line_1}</div><div {...dragProps("description")} className={dragClass("pv pv-description")}>{form.description}</div><div {...dragProps("corrective_action")} className={dragClass("pv pv-action")}>{form.corrective_action}</div>
          </div></div>
        </aside>
      </div>
      {notice && <div className="feedback-toast" role="status" aria-live="polite">{notice}</div>}
      <AlertDialog open={resetOpen} onOpenChange={setResetOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset this report?</AlertDialogTitle>
            <AlertDialogDescription>All current field entries and selected images will be cleared. This reset cannot be undone. Your saved draft will not change unless you save again.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button variant="destructive" onClick={resetForm}>Reset report</Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}

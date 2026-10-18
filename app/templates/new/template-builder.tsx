"use client";
// Full navigation avoids the Vinext Link runtime mismatch.
import { useEffect, useRef, useState, type PointerEvent } from "react";
import { ArrowLeft, ImagePlus, Plus, Redo2, Undo2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter } from "@/components/ui/alert-dialog";
import TemplatePdfViewer from "@/components/template-pdf-viewer";
import TemplateDefaultPreview, {
  templateDefaultText,
} from "@/components/template-default-preview";
import ImageExtraction, {
  ExtractionItems,
  extractionMime,
  SamplePhotoPicker,
} from "@/components/image-extraction";
import {
  type Definition,
  type PageBox,
  type TemplateDetail,
  type TemplateField,
  type FieldKind,
  type Region,
  type ClearArea,
  templateJson,
  templateRequest,
} from "@/lib/template-api";
import { detectScannedPage, pdfRegionImage } from "@/lib/template-image-ocr";
import { useEditHistory } from "@/lib/use-edit-history";
import {
  edges,
  handlePoint,
  resizeBox,
  duplicateBox,
  selectionBoxes,
  moveBoxes,
  firstEditableField,
  type CopiedBox,
  type Edge,
} from "@/lib/template-editing";
import TemplateEditor from "@/app/templates/custom/template-editor";
import { calculationProblems } from "@/lib/template-calculations";
import { createId } from "@/lib/create-id";

type Selection = { kind: "field" | "cover"; id: string };
type DocumentState = { title: string; definition: Definition };
type Gesture = {
  page: number;
  start: { x: number; y: number };
  selection: Selection;
  origin: PageBox;
  action: "draw" | "move" | Edge;
  recorded: boolean;
  group?: CopiedBox[];
};
const clamp = (n: number, min: number, max: number) =>
  Math.min(max, Math.max(min, n));
function openSavedTemplate(id: string) {
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- Full navigation avoids this project's Vinext Link runtime mismatch.
  window.location.assign(`/templates/custom/${id}`);
}
const kinds: FieldKind[] = ["text", "number", "date", "image", "calculated"];
const fonts = [
  ["Times-Roman", "Times New Roman"],
  ["Times-Bold", "Times New Roman Bold"],
  ["Helvetica", "Arial"],
  ["Helvetica-Bold", "Arial Bold"],
  ["Courier", "Courier New"],
];

export default function TemplateBuilder({
  templateId,
}: {
  templateId?: string;
}) {
  const history = useEditHistory<DocumentState | null>(null);
  const resetHistory = history.reset;
  const definition = history.value?.definition,
    title = history.value?.title || "";
  const [trial, setTrial] = useState<Uint8Array | null>(null);
  const [extractionImage, setExtractionImage] = useState("");
  const [boxDragging, setBoxDragging] = useState(false);
  const [pdfReference, setPdfReference] = useState<{
    source: Uint8Array;
    key: string;
    file?: File;
    error?: string;
  } | null>(null);
  const root = useRef<HTMLElement>(null);
  const pendingNavigation = useRef<string | null>(null);
  const [original, setOriginal] = useState<Uint8Array | null>(null),
    [cleaned, setCleaned] = useState<Uint8Array | null>(null);
  const [file, setFile] = useState<File | null>(null),
    [busy, setBusy] = useState(""),
    [error, setError] = useState("");
  const [selections, setSelections] = useState<Selection[]>([]);
  const selected = selections.at(-1) || null;
  const setSelected = (selection: Selection | null) => setSelections(selection ? [selection] : []);
  const [mode, setMode] = useState<"input" | "image" | "cover" | null>(null);
  const [coverOnly, setCoverOnly] = useState(false),
    [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState<TemplateDetail | null>(null),
    [revisionId, setRevisionId] = useState("");
  const [scanned, setScanned] = useState<number[]>([]),
    [sampleImages, setSampleImages] = useState<Record<string, File>>({});
  const [cropImage, setCropImage] = useState<{
      fieldId: string;
      file: File;
    } | null>(null),
    [sampleValues, setSampleValues] = useState<Record<string, string>>({});
  const [style, setStyle] = useState({
    font: "Times-Roman",
    font_size: 16,
    color: "#000000",
  });
  const [fontSizeDraft, setFontSizeDraft] = useState({
    key: "default:16",
    value: "16",
  });
  const labelInput = useRef<HTMLInputElement>(null);
  const nameNewField = useRef<string | null>(null);
  const drag = useRef<Gesture | null>(null),
    uploadInput = useRef<HTMLInputElement>(null),
    savedId = useRef<string | null>(null);
  const copied = useRef<CopiedBox[] | null>(null);
  const pasteCount = useRef(0);
  const issues = definition ? calculationProblems(definition) : [];
  const problemIds = new Set(issues.flatMap((issue) => issue.fieldIds));
  const selectedBox =
    selected && definition
      ? (selected.kind === "field"
          ? definition.fields
          : definition.clear_areas
        ).find((box) => box.id === selected.id)
      : undefined;
  const field =
    selected?.kind === "field"
      ? (selectedBox as TemplateField | undefined)
      : undefined;

  useEffect(() => {
    if (boxDragging || !nameNewField.current || field?.id !== nameNewField.current) return;
    labelInput.current?.focus();
    labelInput.current?.select();
    nameNewField.current = null;
  }, [boxDragging, field?.id]);

  useEffect(() => {
    if (!saved) return;
    const timer = window.setTimeout(() => {
      openSavedTemplate(saved.id);
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [saved]);

  const extractionField =
    definition?.fields.find(
      (item) =>
        item.id === (field?.kind === "image" ? field.id : extractionImage) &&
        item.kind === "image",
    ) || definition?.fields.find((item) => item.kind === "image");

  const referenceKey = extractionField
    ? [
        extractionField.id,
        extractionField.page,
        extractionField.x,
        extractionField.y,
        extractionField.width,
        extractionField.height,
      ].join(":")
    : "";
  const uploadedSample = extractionField
    ? sampleImages[extractionField.id]
    : undefined;
  const reference =
    pdfReference?.source === original && pdfReference?.key === referenceKey
      ? pdfReference
      : null;
  const referenceLoading =
    !!extractionField &&
    !!original &&
    !uploadedSample &&
    !reference &&
    !boxDragging;
  useEffect(() => {
    if (
      !original ||
      !extractionField ||
      uploadedSample ||
      boxDragging ||
      reference
    )
      return;
    let cancelled = false;
    const source = original,
      box = { ...extractionField };
    const timer = window.setTimeout(() => {
      void pdfRegionImage(source, box)
        .then((file) => {
          if (!cancelled) setPdfReference({ source, key: referenceKey, file });
        })
        .catch((cause) => {
          if (!cancelled)
            setPdfReference({
              source,
              key: referenceKey,
              error:
                cause instanceof Error
                  ? cause.message
                  : "Could not preview this PDF area",
            });
        });
    }, 100);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [original, referenceKey, uploadedSample, boxDragging]);

  const jumpToField = (id: string) => {
    const target = definition?.fields.find((field) => field.id === id);
    if (!target) return;
    pendingNavigation.current = id;
    setSelected({ kind: "field", id });
    setCoverOnly(false);
    setCleaned(null);
    setMode(null);
    if (target.kind === "image") setExtractionImage(id);
  };
  useEffect(() => {
    const id = pendingNavigation.current;
    if (!id || selected?.id !== id || coverOnly || cleaned) return;
    const frame = requestAnimationFrame(() => {
      const box = root.current?.querySelector<SVGElement>(
        `[data-box-kind="field"][data-box-id="${CSS.escape(id)}"]`,
      );
      const pane = root.current?.querySelector<HTMLElement>(
        ".template-preview-pane",
      );
      if (box && pane) {
        const rect = box.getBoundingClientRect(),
          bounds = pane.getBoundingClientRect();
        pane.scrollBy({
          top: rect.top - bounds.top - pane.clientHeight / 2 + rect.height / 2,
          behavior: "smooth",
        });
      }
      const settings = root.current?.querySelector<HTMLElement>(
        ".template-properties",
      );
      settings?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      settings
        ?.querySelector<HTMLInputElement>("input")
        ?.focus({ preventScroll: true });
      pendingNavigation.current = null;
    });
    return () => cancelAnimationFrame(frame);
  }, [selected, coverOnly, cleaned]);

  useEffect(() => {
    if (!templateId) return;
    let cancelled = false;
    void (async () => {
      setBusy("Opening template…");
      try {
        const [detail, source] = await Promise.all([
          templateJson<TemplateDetail>(`/api/templates/${templateId}`),
          templateRequest(`/api/templates/${templateId}/source`),
        ]);
        if (detail.archived)
          throw new Error("Restore this archived template before editing it.");
        const data = new Uint8Array(await source.arrayBuffer());
        if (cancelled) return;
        resetHistory({
          title: detail.title,
          definition: {
            ...detail.definition,
            fields: detail.definition.fields.map((item) => ({
              ...item,
              kind: kinds.includes(item.kind) ? item.kind : "text",
              alignment: "center",
            })),
            extractions: detail.definition.extractions || [],
          },
        });
        setOriginal(data);
        // Editing the canonical PDF must not replace the retained Word source.
        setFile(null);
        setRevisionId(detail.revision_id);
        const first = firstEditableField(detail.definition.fields);
        setSelected(first ? { kind: "field", id: first.id } : null);
      } catch (cause) {
        if (!cancelled)
          setError(
            cause instanceof Error ? cause.message : "Could not open template",
          );
      } finally {
        if (!cancelled) setBusy("");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [templateId, resetHistory]);
  useEffect(() => {
    const before = (event: BeforeUnloadEvent) => {
      if (dirty) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", before);
    return () => window.removeEventListener("beforeunload", before);
  }, [dirty]);
  const change = (update: (value: Definition) => Definition, record = true) => {
    history.set(
      (current) =>
        current
          ? { ...current, definition: update(current.definition) }
          : current,
      record,
    );
    setCleaned(null);
    setDirty(true);
    setSaved(null);
    setError("");
  };
  const updateField = (updates: Partial<TemplateField>) =>
    change((current) => ({
      ...current,
      fields: current.fields.map((item) =>
        item.id === field?.id ? { ...item, ...updates } : item,
      ),
    }));
  const changeType = (kind: FieldKind) => {
    if (!field) return;
    if (kind === "image") setExtractionImage(field.id);
    change((current) => ({
      ...current,
      fields: current.fields.map((item) =>
        item.id === field.id
          ? {
              ...item,
              kind,
              default_value: "",
              role: null,
              calculation: kind === "calculated" ? item.calculation : null,
            }
          : item,
      ),
      ocr_mappings: current.ocr_mappings.filter(
        (item) =>
          !(item.image_field === field.id && kind !== "image") &&
          !(
            item.target_field === field.id && !["text", "number"].includes(kind)
          ),
      ),
      extractions: current.extractions
        .filter((item) => !(item.image_field === field.id && kind !== "image"))
        .map((item) =>
          item.target_field === field.id &&
          ["image", "calculated"].includes(kind)
            ? { ...item, target_field: null }
            : item,
        ),
    }));
  };
  const updateBox = (
    selection: Selection,
    updates: Partial<PageBox>,
    record = true,
  ) =>
    change(
      (current) =>
        selection.kind === "field"
          ? {
              ...current,
              fields: current.fields.map((item) =>
                item.id === selection.id ? { ...item, ...updates } : item,
              ),
              clear_areas: current.clear_areas.map((item) =>
                item.id === selection.id ? { ...item, ...updates } : item,
              ),
            }
          : {
              ...current,
              clear_areas: current.clear_areas.map((item) =>
                item.id === selection.id ? { ...item, ...updates } : item,
              ),
            },
      record,
    );
  const remove = () => {
    if (!selected || busy) return;
    const fieldIds = new Set(selections.filter(item => item.kind === "field").map(item => item.id));
    const coverIds = new Set(selections.map(item => item.id));
    change((current) => ({
            ...current,
            fields: current.fields.filter((item) => !fieldIds.has(item.id)),
            clear_areas: current.clear_areas.filter((item) => !coverIds.has(item.id)),
            ocr_mappings: current.ocr_mappings.filter(
              (item) =>
                !fieldIds.has(item.image_field) &&
                !fieldIds.has(item.target_field),
            ),
            extractions: current.extractions
              .filter((item) => !fieldIds.has(item.image_field))
              .map((item) =>
                item.target_field && fieldIds.has(item.target_field)
                  ? { ...item, target_field: null }
                  : item,
              ),
          }),
    );
    setSelected(null);
  };
  const step = (forward = false) => {
    drag.current = null;
    setBoxDragging(false);
    if (forward) history.redo();
    else history.undo();
    setCleaned(null);
    setDirty(true);
    setSaved(null);
  };
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (busy || cropImage || !definition) return;
      const editing = (event.target as HTMLElement)?.closest(
        "input,textarea,select,[contenteditable=true]",
      );
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        if (!editing) {
          event.preventDefault();
          step(event.shiftKey);
        }
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") {
        if (!editing) {
          event.preventDefault();
          step(true);
        }
        return;
      }
      if (editing) return;
      if (
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === "c" &&
        selected &&
        selectedBox &&
        !window.getSelection()?.toString()
      ) {
        event.preventDefault();
        copied.current = structuredClone(selectionBoxes(definition, selections));
        pasteCount.current = 0;
        return;
      }
      if (
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === "v" &&
        copied.current
      ) {
        event.preventDefault();
        const snapshot = copied.current;
        if (
          definition.fields.length + snapshot.filter(item => item.kind === "field").length > 300 ||
          definition.clear_areas.length + snapshot.length > 400
        ) {
          setError("Template box limit reached.");
          return;
        }
        const next = snapshot.map(item => ({kind: item.kind, id: createId()}));
        pasteCount.current += 1;
        change((current) =>
          snapshot.reduce((value, item, index) =>
            duplicateBox(value, item, next[index].id, 0.015 * pasteCount.current), current),
        );
        setSelections(next);
        setMode(null);
        setCoverOnly(snapshot.every(item => item.kind === "cover"));
        return;
      }
      if (event.key === "Escape") {
        setMode(null);
        setSelected(null);
      }
      if (["Delete", "Backspace"].includes(event.key) && selected) {
        event.preventDefault();
        remove();
      }
      if (selected && selectedBox && event.key.startsWith("Arrow")) {
        event.preventDefault();
        const size = definition.pages[selectedBox.page],
          delta = event.shiftKey ? 10 : 1;
        const dx =
          (event.key === "ArrowLeft"
            ? -delta
            : event.key === "ArrowRight"
              ? delta
              : 0) / size.width;
        const dy =
          (event.key === "ArrowUp"
            ? -delta
            : event.key === "ArrowDown"
              ? delta
              : 0) / size.height;
        if (!event.altKey && selections.length > 1) {
          change(current => moveBoxes(current, selectionBoxes(current, selections), dx, dy));
        } else updateBox(
          selected,
          event.altKey
            ? resizeBox(selectedBox, "se", dx, dy)
            : {
                x: clamp(selectedBox.x + dx, 0, 1 - selectedBox.width),
                y: clamp(selectedBox.y + dy, 0, 1 - selectedBox.height),
              },
        );
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });
  const upload = async (next: File) => {
    if (!/\.(pdf|docx)$/i.test(next.name)) {
      setError(
        "Upload a PDF or Word .docx file. Save older .doc files as .docx first.",
      );
      return;
    }
    if (next.size > 20 * 1024 * 1024) {
      setError("Document exceeds the 20 MB limit.");
      return;
    }
    setBusy(
      /\.docx$/i.test(next.name)
        ? "Converting Word document and analyzing fields…"
        : "Analyzing PDF…",
    );
    setError("");
    try {
      const data = new FormData();
      data.append("pdf", next);
      const result = await templateJson<{
        definition: Definition;
        scanned_pages: number[];
        render_pdf?: string | null;
      }>("/api/templates/analyze", { method: "POST", body: data });
      history.reset({
        title: next.name.replace(/\.(pdf|docx)$/i, ""),
        definition: {
          ...result.definition,
          fields: result.definition.fields.map((item) => ({
            ...item,
            kind: kinds.includes(item.kind) ? item.kind : "text",
            alignment: "center",
          })),
          extractions: result.definition.extractions || [],
        },
      });
      setFile(next);
      setOriginal(
        result.render_pdf
          ? Uint8Array.from(atob(result.render_pdf), (char) =>
              char.charCodeAt(0),
            )
          : new Uint8Array(await next.arrayBuffer()),
      );
      setCleaned(null);
      const first = firstEditableField(result.definition.fields);
      setSelected(first ? { kind: "field", id: first.id } : null);
      setDirty(true);
      setScanned(result.scanned_pages);
      setSampleImages({});
      setSampleValues({});
      setRevisionId("");
      setSaved(null);
      savedId.current = null;
      copied.current = null;
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not analyze document",
      );
    } finally {
      setBusy("");
    }
  };
  const payload = (retainOriginal = false) => {
    const data = new FormData();
    if (retainOriginal) {
      if (file) data.append("pdf", file);
    } else if (original) {
      data.append(
        "pdf",
        new Blob([Uint8Array.from(original)], { type: "application/pdf" }),
        "review.pdf",
      );
    }
    data.append("definition_json", JSON.stringify(definition));
    return data;
  };
  const previewClean = async () => {
    if (issues.length) {
      setError(issues.map((issue) => issue.message).join(" "));
      return;
    }
    setBusy("Preparing template preview…");
    setError("");
    try {
      const response = await templateRequest("/api/templates/review", {
        method: "POST",
        body: payload(),
      });
      setCleaned(new Uint8Array(await response.arrayBuffer()));
      setMode(null);
      setSelected(null);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not prepare template",
      );
    } finally {
      setBusy("");
    }
  };
  const save = async () => {
    if (issues.length) {
      setError(issues.map((issue) => issue.message).join(" "));
      return;
    }
    if (!title.trim() || !definition?.fields.length) {
      setError("Enter a title and add an input or image field.");
      return;
    }
    setBusy("Saving template revision…");
    setError("");
    try {
      const data = payload(true);
      data.append("title", title.trim());
      data.append("reviewed", "true");
      if (revisionId) data.append("expected_revision_id", revisionId);
      const result = await templateJson<TemplateDetail>(
        revisionId
          ? `/api/templates/${templateId || savedId.current}`
          : "/api/templates",
        { method: revisionId ? "PUT" : "POST", body: data },
      );
      setRevisionId(result.revision_id);
      setSaved(result);
      setDirty(false);
      savedId.current = result.id;
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not save template",
      );
    } finally {
      setBusy("");
    }
  };
  const point = (event: PointerEvent<SVGElement>) => {
    const svg = event.currentTarget.closest("svg") as SVGSVGElement,
      bounds = svg.getBoundingClientRect();
    return {
      svg,
      x: clamp((event.clientX - bounds.left) / bounds.width, 0, 1),
      y: clamp((event.clientY - bounds.top) / bounds.height, 0, 1),
    };
  };
  const start = (
    event: PointerEvent<SVGElement>,
    page: number,
    selection?: Selection,
    edge?: Edge,
  ) => {
    if (busy || cleaned || !definition) return;
    event.stopPropagation();
    const p = point(event);
    p.svg.setPointerCapture(event.pointerId);
    if (selection && !mode) {
      const box = (
        selection.kind === "field" ? definition.fields : definition.clear_areas
      ).find((item) => item.id === selection.id);
      if (!box) return;
      const alreadySelected = selections.some(item => item.id === selection.id && item.kind === selection.kind);
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        setSelections(current => alreadySelected
          ? current.filter(item => item.id !== selection.id || item.kind !== selection.kind)
          : [...current, selection]);
        return;
      }
      const group = alreadySelected ? selections : [selection];
      setBoxDragging(true);
      setSelections([...group.filter(item => item.id !== selection.id || item.kind !== selection.kind), selection]);
      if (selection.kind === "field" && "kind" in box && box.kind === "image")
        setExtractionImage(box.id);
      drag.current = {
        page,
        start: p,
        selection,
        origin: box,
        action: edge || "move",
        recorded: false,
        group: selectionBoxes(definition, group),
      };
      return;
    }
    if (!mode) {
      setSelected(null);
      return;
    }
    if ((mode !== "cover" && definition.fields.length >= 300) ||
        definition.clear_areas.length >= 400) {
      setError("Template box limit reached.");
      return;
    }
    setBoxDragging(true);
    const id = createId(),
      box = {
        id,
        page,
        x: Math.min(0.998, p.x),
        y: Math.min(0.998, p.y),
        width: 0.002,
        height: 0.002,
      };
    const next: Selection = { kind: mode === "cover" ? "cover" : "field", id };
    if (mode === "image") setExtractionImage(id);
    change((current) =>
      mode === "cover"
        ? {
            ...current,
            clear_areas: [...current.clear_areas, { ...box, color: "#ffffff" }],
          }
        : {
            ...current,
            clear_areas: [...current.clear_areas, { ...box, color: "#ffffff" }],
            fields: [
              ...current.fields,
              {
                ...box,
                label: mode === "image" ? "Image" : "Input field",
                kind: mode === "image" ? "image" : "text",
                role: null,
                required: true,
                ...style,
                alignment: "center",
                options: [],
                calculation: null,
                image_fit: "contain",
                suggested_value: "",
              },
            ],
          },
    );
    setSelected(next);
    drag.current = {
      page,
      start: p,
      selection: next,
      origin: box,
      action: "draw",
      recorded: true,
    };
  };
  const move = (event: PointerEvent<SVGSVGElement>) => {
    const gesture = drag.current;
    if (!gesture) return;
    const p = point(event),
      box = gesture.origin;
    if (gesture.action === "move" && gesture.group && gesture.group.length > 1) {
      change(current => moveBoxes(current, gesture.group!, p.x - gesture.start.x, p.y - gesture.start.y), !gesture.recorded);
      gesture.recorded = true;
      return;
    }
    const updates =
      gesture.action === "draw"
        ? {
            x: Math.min(gesture.start.x, p.x, 0.998),
            y: Math.min(gesture.start.y, p.y, 0.998),
            width: Math.max(0.002, Math.abs(p.x - gesture.start.x)),
            height: Math.max(0.002, Math.abs(p.y - gesture.start.y)),
          }
        : gesture.action === "move"
          ? {
              x: clamp(box.x + p.x - gesture.start.x, 0, 1 - box.width),
              y: clamp(box.y + p.y - gesture.start.y, 0, 1 - box.height),
            }
          : resizeBox(
              box,
              gesture.action,
              p.x - gesture.start.x,
              p.y - gesture.start.y,
            );
    updateBox(gesture.selection, updates, !gesture.recorded);
    gesture.recorded = true;
  };
  const finish = () => {
    const gesture = drag.current;
    if (gesture?.action === "draw" && gesture.selection.kind === "field")
      nameNewField.current = gesture.selection.id;
    drag.current = null;
    setBoxDragging(false);
    setMode(null);
  };
  const bind = (id: string, target: string) => {
    const destination = definition?.fields.find((item) => item.id === target);
    if (!destination || ["image", "calculated"].includes(destination.kind)) {
      setError("Drop the item onto an editable value field.");
      return;
    }
    change((current) => ({
      ...current,
      ocr_mappings: current.ocr_mappings.filter(
        (item) => item.target_field !== target,
      ),
      extractions: current.extractions.map((item) =>
        item.id === id
          ? { ...item, target_field: target }
          : item.target_field === target
            ? { ...item, target_field: null }
            : item,
      ),
    }));
  };
  const extract = async () => {
    const field = extractionField;
    if (!field || !original) return;
    try {
      const sample =
        sampleImages[field.id] ||
        reference?.file ||
        (await pdfRegionImage(original, field));
      setCropImage({ fieldId: field.id, file: sample });
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Add a sample image first",
      );
    }
  };
  const scan = async (page: number) => {
    if (!original) return;
    setBusy("Detecting scanned page locally…");
    try {
      const fields = await detectScannedPage(original, page);
      change((current) => ({
        ...current,
        fields: [...current.fields, ...fields].slice(0, 300),
      }));
      setScanned((current) => current.filter((item) => item !== page));
      if (!fields.length)
        setError("No closed outlines found. Add fields manually.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not scan page");
    } finally {
      setBusy("");
    }
  };
  const previewFlow = async () => {
    if (!definition?.fields.length) {
      setError("Add at least one input or image field first.");
      return;
    }
    if (issues.length) {
      setError(issues.map((issue) => issue.message).join(" "));
      return;
    }
    setBusy("Preparing report creation preview…");
    setError("");
    try {
      const response = await templateRequest("/api/templates/review", {
        method: "POST",
        body: payload(),
      });
      setTrial(new Uint8Array(await response.arrayBuffer()));
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not preview report flow",
      );
    } finally {
      setBusy("");
    }
  };
  const effectiveStyle = field || style;
  const fontSizeKey = `${field?.id || "default"}:${effectiveStyle.font_size}`;
  const fontChange = (updates: Partial<typeof style>) => {
    if (field) updateField(updates);
    else setStyle((current) => ({ ...current, ...updates }));
  };

  const ribbon =
    definition && !saved ? (
      <div
        className="document-ribbon"
        role="toolbar"
        aria-label="Template editing tools"
      >
        <Button
          size="sm"
          variant={mode === "input" ? "default" : "outline"}
          onClick={() => {
            setMode("input");
            setCoverOnly(false);
            setCleaned(null);
          }}
        >
          <Plus size={14} /> Input field
        </Button>
        <Button
          size="sm"
          variant={mode === "image" ? "default" : "outline"}
          onClick={() => {
            setMode("image");
            setCoverOnly(false);
            setCleaned(null);
          }}
        >
          <ImagePlus size={14} /> Image box
        </Button>
        <Button
          size="sm"
          variant={mode === "cover" ? "default" : "outline"}
          onClick={() => {
            setMode("cover");
            setCleaned(null);
          }}
        >
          <Plus size={14} /> Cover box
        </Button>
        <label>
          Font{" "}
          <select
            aria-label="Font"
            value={effectiveStyle.font}
            disabled={selected?.kind === "cover" || field?.kind === "image"}
            onChange={(event) => fontChange({ font: event.target.value })}
          >
            {fonts.map(([value, label]) => (
              <option value={value} key={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Font size{" "}
          <Input
            aria-label="Font size"
            list="template-font-sizes"
            inputMode="decimal"
            value={
              fontSizeDraft.key === fontSizeKey
                ? fontSizeDraft.value
                : String(effectiveStyle.font_size)
            }
            disabled={selected?.kind === "cover" || field?.kind === "image"}
            onChange={(event) => {
              setFontSizeDraft({ key: fontSizeKey, value: event.target.value });
              const size = Number(event.target.value);
              if (size >= 4 && size <= 72) fontChange({ font_size: size });
            }}
            onBlur={() =>
              setFontSizeDraft({
                key: fontSizeKey,
                value: String(effectiveStyle.font_size),
              })
            }
          />
        </label>
        <datalist id="template-font-sizes">
          {[8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 36, 48, 72].map(
            (size) => (
              <option value={size} key={size} />
            ),
          )}
        </datalist>
        <label>
          Alignment{" "}
          <select
            aria-label="Selected field alignment"
            value={field?.alignment || "center"}
            disabled={!field || field.kind === "image"}
            onChange={(event) => updateField({
              alignment: event.target.value as TemplateField["alignment"],
            })}
          >
            <option value="left">Left</option>
            <option value="center">Centre</option>
            <option value="right">Right</option>
          </select>
        </label>
        <label className="font-color-control">
          <span>A</span>
          <input
            aria-label="Font color"
            type="color"
            value={effectiveStyle.color}
            disabled={selected?.kind === "cover" || field?.kind === "image"}
            onChange={(event) => fontChange({ color: event.target.value })}
          />
        </label>
        <Button
          size="icon"
          variant="ghost"
          aria-label="Undo"
          title="Undo (Ctrl/Cmd+Z)"
          disabled={!history.canUndo || !!busy}
          onClick={() => step()}
        >
          <Undo2 size={18} />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          aria-label="Redo"
          title="Redo (Ctrl/Cmd+Shift+Z)"
          disabled={!history.canRedo || !!busy}
          onClick={() => step(true)}
        >
          <Redo2 size={18} />
        </Button>
      </div>
    ) : null;

  if (trial && definition && !saved)
    return (
      <TemplateEditor
        templateId="unsaved-preview"
        draftId={null}
        sandbox={{
          template: {
            id: "unsaved-preview",
            title: title || "Unsaved template",
            definition,
            revision_id: "unsaved",
            revision_number: 0,
            created_at: "",
            field_count: definition.fields.length,
            page_count: definition.pages.length,
          },
          blank: trial,
          onContinue: () => setTrial(null),
          onSave: () => void save(),
          busy: !!busy,
          error,
        }}
      />
    );

  return (
    <main ref={root} className="catalog-shell template-builder-shell">
      <header className="catalog-header">
        <a
          className="back-link"
          href={templateId ? `/templates/custom/${templateId}` : "/"}
        >
          <ArrowLeft size={18} /> Template library
        </a>
        <div className="catalog-header-heading">
          <h1>
            {templateId || revisionId ? "Edit template" : "Create new template"}
          </h1>
          <p>
            Arrange fields, cover old content, and link extracted photo values.
          </p>
        </div>
        <Button
          disabled={!!busy || !definition || !!saved}
          onClick={() => void save()}
        >
          Save template
        </Button>
      </header>
      {saved ? (
        <section className="catalog-content">
          <p>Opening {saved.title}…</p>
        </section>
      ) : !definition ? (
        <section className="catalog-content">
          <div
            className="template-upload"
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              const next = event.dataTransfer.files[0];
              if (next) void upload(next);
            }}
          >
            <h2>Upload your report PDF or Word document</h2>
            <p>
              Choose a PDF or Word .docx file. Export Excel sheets as PDF. Text,
              outlined boxes, and scanned pages are supported.
            </p>
            <input
              ref={uploadInput}
              className="sr-only"
              type="file"
              tabIndex={-1}
              aria-label="Upload report PDF or Word document"
              accept="application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.pdf,.docx"
              onChange={(event) => {
                const next = event.target.files?.[0];
                if (next) void upload(next);
                event.target.value = "";
              }}
            />
            <Button
              onClick={() => uploadInput.current?.click()}
              disabled={!!busy}
            >
              Choose file
            </Button>
          </div>
        </section>
      ) : (
        <div className="template-workspace">
          <aside className="template-sidebar">
            <label className="field-stack">
              <span>Template name</span>
              <Input
                value={title}
                maxLength={100}
                onChange={(event) => {
                  history.set((current) =>
                    current
                      ? { ...current, title: event.target.value }
                      : current,
                  );
                  setDirty(true);
                  setSaved(null);
                }}
              />
            </label>
            <p className="template-help">
              Click a box to select it. Drag to move; drag an edge or corner to
              resize. Delete removes it. Arrow keys nudge; Alt+arrows resize.
            </p>
            <div className="sidebar-view-actions">
              <Button
                size="sm"
                variant={coverOnly ? "default" : "outline"}
                aria-pressed={coverOnly}
                onClick={() => {
                  setCoverOnly(!coverOnly);
                  setMode(null);
                  setSelected(null);
                }}
              >
                Only view cover boxes
              </Button>
              <Button
                size="sm"
                variant={cleaned ? "default" : "outline"}
                disabled={!!busy}
                onClick={() =>
                  cleaned ? setCleaned(null) : void previewClean()
                }
              >
                {cleaned ? "Continue editing template" : "View clean template"}
              </Button>
            </div>
            <Button
              className="preview-report-flow"
              variant="outline"
              disabled={!!busy}
              onClick={() => void previewFlow()}
            >
              Preview report creation flow
            </Button>
            {selectedBox && (
              <section className="template-properties">
                <div className="template-property-heading">
                  <h2>{field ? "Field settings" : "Cover box"}</h2>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label="Delete selected box"
                    onClick={remove}
                  >
                    <Trash2 size={16} />
                  </Button>
                </div>
                {field && (
                  <>
                    <label className="field-stack">
                      <span>Field label</span>
                      <Input
                        ref={labelInput}
                        value={field.label}
                        maxLength={160}
                        onChange={(event) =>
                          updateField({ label: event.target.value })
                        }
                        onKeyDown={(event) => {
                          if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                            event.preventDefault();
                            event.currentTarget.blur();
                          }
                        }}
                      />
                    </label>
                    <label className="field-stack">
                      <span>Field type</span>
                      <select
                        aria-label="Field type"
                        value={field.kind}
                        onChange={(event) =>
                          changeType(event.target.value as FieldKind)
                        }
                      >
                        {kinds.map((kind) => (
                          <option key={kind}>{kind}</option>
                        ))}
                      </select>
                    </label>
                    <label className="template-check">
                      <input
                        type="checkbox"
                        checked={field.required}
                        onChange={(event) =>
                          updateField({ required: event.target.checked })
                        }
                      />
                      Include in missing-field reminders
                    </label>
                    {field.kind !== "image" && (
                      <label className="field-stack">
                        <span>Text alignment</span>
                        <select
                          aria-label="Template text alignment"
                          value={field.alignment}
                          onChange={(event) => updateField({
                            alignment: event.target.value as TemplateField["alignment"],
                          })}
                        >
                          <option value="left">Left</option>
                          <option value="center">Centre</option>
                          <option value="right">Right</option>
                        </select>
                      </label>
                    )}
                    {!["image", "calculated"].includes(field.kind) && (
                      <label className="field-stack">
                        <span>Default value for new reports</span>
                        {field.kind === "text" || field.kind === "textarea" ? (
                          <textarea
                            rows={3}
                            maxLength={20000}
                            value={String(field.default_value ?? "")}
                            onChange={(event) =>
                              updateField({ default_value: event.target.value })
                            }
                          />
                        ) : (
                          <Input
                            type={
                              field.kind === "number"
                                ? "number"
                                : field.kind === "date"
                                  ? "date"
                                  : "text"
                            }
                            step={field.kind === "number" ? "any" : undefined}
                            value={String(field.default_value ?? "")}
                            onChange={(event) =>
                              updateField({ default_value: event.target.value })
                            }
                          />
                        )}
                        <small>
                          Used for new reports. Detected sample text is never
                          copied automatically.
                        </small>
                      </label>
                    )}
                    {field.kind === "select" && (
                      <label className="field-stack">
                        <span>Options, one per line</span>
                        <textarea
                          value={field.options.join("\n")}
                          onChange={(event) =>
                            updateField({
                              options: event.target.value.split("\n"),
                            })
                          }
                        />
                      </label>
                    )}
                    {field.kind === "image" ? (
                      <>
                        <label className="field-stack">
                          <span>Image fitting</span>
                          <select
                            value={field.image_fit || "contain"}
                            onChange={(event) =>
                              updateField({
                                image_fit: event.target.value as
                                  | "contain"
                                  | "cover",
                              })
                            }
                          >
                            <option value="contain">Fit entire image</option>
                            <option value="cover">Fill box</option>
                          </select>
                        </label>
                      </>
                    ) : (
                      <>
                        {field.kind !== "calculated" && (
                          <label className="field-stack">
                            <span>Extracted item</span>
                            <select
                              aria-label="Extracted item"
                              value={
                                definition.extractions.find(
                                  (item) => item.target_field === field.id,
                                )?.id || ""
                              }
                              onChange={(event) =>
                                event.target.value
                                  ? bind(event.target.value, field.id)
                                  : change((current) => ({
                                      ...current,
                                      extractions: current.extractions.map(
                                        (item) =>
                                          item.target_field === field.id
                                            ? { ...item, target_field: null }
                                            : item,
                                      ),
                                    }))
                              }
                            >
                              <option value="">None</option>
                              {definition.extractions.map((item) => (
                                <option key={item.id} value={item.id}>
                                  {item.name}
                                </option>
                              ))}
                            </select>
                          </label>
                        )}
                      </>
                    )}
                    {field.kind === "calculated" && (
                      <section
                        className={
                          problemIds.has(field.id)
                            ? "calculation-settings is-calculation-error"
                            : "calculation-settings"
                        }
                      >
                        <h3>Calculation</h3>
                        <div className="calculation-expression">
                          <label className="field-stack">
                            <span>
                              {field.calculation?.operation === "percentage"
                                ? "Numerator"
                                : "Number field 1"}
                            </span>
                            <select
                              aria-label="Number field 1"
                              value={field.calculation?.fields[0] || ""}
                              aria-invalid={problemIds.has(field.id)}
                              onChange={(event) =>
                                updateField({
                                  calculation: {
                                    operation:
                                      field.calculation?.operation || "sum",
                                    fields: [
                                      event.target.value,
                                      field.calculation?.fields[1] || "",
                                    ],
                                  },
                                })
                              }
                            >
                              <option value="">Choose number</option>
                              {definition.fields
                                .filter((item) => item.kind === "number")
                                .map((item) => (
                                  <option key={item.id} value={item.id}>
                                    {item.label}
                                  </option>
                                ))}
                            </select>
                          </label>
                          <label className="field-stack">
                            <span>Operator</span>
                            <select
                              aria-label="Calculation operator"
                              value={field.calculation?.operation || "sum"}
                              onChange={(event) =>
                                updateField({
                                  calculation: {
                                    operation: event.target.value as
                                      | "sum"
                                      | "difference"
                                      | "percentage",
                                    fields: (
                                      field.calculation?.fields || ["", ""]
                                    ).slice(0, 2),
                                  },
                                })
                              }
                            >
                              <option value="sum">+</option>
                              <option value="difference">−</option>
                              <option value="percentage">% (÷)</option>
                            </select>
                          </label>
                          <label className="field-stack">
                            <span>
                              {field.calculation?.operation === "percentage"
                                ? "Denominator"
                                : "Number field 2"}
                            </span>
                            <select
                              aria-label="Number field 2"
                              value={field.calculation?.fields[1] || ""}
                              aria-invalid={problemIds.has(field.id)}
                              onChange={(event) =>
                                updateField({
                                  calculation: {
                                    operation:
                                      field.calculation?.operation || "sum",
                                    fields: [
                                      field.calculation?.fields[0] || "",
                                      event.target.value,
                                    ],
                                  },
                                })
                              }
                            >
                              <option value="">Choose number</option>
                              {definition.fields
                                .filter((item) => item.kind === "number")
                                .map((item) => (
                                  <option key={item.id} value={item.id}>
                                    {item.label}
                                  </option>
                                ))}
                            </select>
                          </label>
                        </div>
                        {field.calculation?.operation === "percentage" && (
                          <p className="template-help">
                            Numerator / denominator, displayed as a percentage.
                          </p>
                        )}
                        {field.calculation?.fields &&
                          field.calculation.fields.length > 2 && (
                            <p className="template-help">
                              This older sum uses more than two fields. Changing
                              its operands uses the new two-field formula.
                            </p>
                          )}
                      </section>
                    )}
                    <label className="template-check">
                      <input
                        type="checkbox"
                        checked={definition.clear_areas.some(
                          (item) => item.id === field.id,
                        )}
                        onChange={(event) =>
                          change((current) => ({
                            ...current,
                            clear_areas: event.target.checked
                              ? [
                                  ...current.clear_areas,
                                  {
                                    id: field.id,
                                    page: field.page,
                                    x: field.x,
                                    y: field.y,
                                    width: field.width,
                                    height: field.height,
                                    color: "#ffffff",
                                  },
                                ]
                              : current.clear_areas.filter(
                                  (item) => item.id !== field.id,
                                ),
                          }))
                        }
                      />
                      Cover original content in this field
                    </label>
                  </>
                )}
                {!field && (
                  <label className="field-stack">
                    <span>Cover color</span>
                    <input
                      type="color"
                      value={(selectedBox as ClearArea).color}
                      onChange={(event) =>
                        change((current) => ({
                          ...current,
                          clear_areas: current.clear_areas.map((item) =>
                            item.id === selected?.id
                              ? { ...item, color: event.target.value }
                              : item,
                          ),
                        }))
                      }
                    />
                  </label>
                )}
              </section>
            )}

            {issues.length > 0 && (
              <div className="calculation-errors" role="alert">
                {issues.map((issue) => (
                  <div className="calculation-error-item" key={issue.message}>
                    <button
                      type="button"
                      className="calculation-error-link"
                      onClick={() => jumpToField(issue.fieldIds[0])}
                    >
                      {issue.message}
                    </button>
                    <div className="calculation-error-targets">
                      {issue.fieldIds.map((id) => {
                        const target = definition.fields.find(
                          (field) => field.id === id,
                        );
                        return target ? (
                          <button
                            type="button"
                            key={id}
                            onClick={() => jumpToField(id)}
                            aria-label={`Go to ${target.label}`}
                          >
                            {target.label}
                          </button>
                        ) : null;
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {extractionField && (
              <section
                className="template-extraction-panel"
                aria-label="Extract Data from Image"
              >
                <h2>Extract Data from Image</h2>
                {definition.fields.filter((item) => item.kind === "image")
                  .length > 1 && (
                  <label className="field-stack">
                    <span>Image box for extraction</span>
                    <select
                      aria-label="Image box for extraction"
                      value={extractionField.id}
                      onChange={(event) => {
                        setExtractionImage(event.target.value);
                        setSelected({ kind: "field", id: event.target.value });
                      }}
                    >
                      {definition.fields
                        .filter((item) => item.kind === "image")
                        .map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.label}
                          </option>
                        ))}
                    </select>
                  </label>
                )}
                <SamplePhotoPicker
                  file={sampleImages[extractionField.id]}
                  referenceFile={reference?.file}
                  onFile={(next) =>
                    setSampleImages((current) => ({
                      ...current,
                      [extractionField.id]: next,
                    }))
                  }
                />
                <Button
                  size="sm"
                  variant="outline"
                  disabled={boxDragging || referenceLoading}
                  onClick={() => void extract()}
                >
                  Extract data from image
                </Button>
                {referenceLoading && (
                  <p className="template-help" aria-live="polite">
                    Preparing image reference…
                  </p>
                )}
                {reference?.error && !uploadedSample && (
                  <p className="catalog-error">
                    {reference.error}. Choose a sample photo to continue.
                  </p>
                )}
                <p className="template-help">
                  Use your sample photo to crop areas for future extraction.
                  Sample readings are never defaults.
                </p>
                {definition.extractions.length > 0 && (
                  <p className="extraction-drag-instruction">
                    <em>
                      drag and drop the extracted fields below to a field area
                      you want to link it to.
                    </em>
                  </p>
                )}
                {definition.extractions.length > 0 && (
                  <section className="extracted-data-section">
                    <h2>Extracted Data from Image</h2>{" "}
                    <ExtractionItems
                      items={definition.extractions}
                      onNavigate={(item) =>
                        jumpToField(item.target_field || item.image_field)
                      }
                      values={sampleValues}
                      fields={definition.fields}
                      onRemove={(id) =>
                        change((current) => ({
                          ...current,
                          extractions: current.extractions.filter(
                            (item) => item.id !== id,
                          ),
                        }))
                      }
                    />
                  </section>
                )}
              </section>
            )}

            {scanned.map((page) => (
              <Button
                key={page}
                size="sm"
                variant="outline"
                disabled={!!busy}
                onClick={() => void scan(page)}
              >
                Detect scanned page {page + 1} with local OCR
              </Button>
            ))}
          </aside>
          <section className="template-preview-pane">
            {ribbon}
            <div className="template-preview-heading">
              <strong>
                {cleaned ? "Clean template preview" : "Template review"}
              </strong>
            </div>
            <TemplatePdfViewer
              source={cleaned || original}
              overlay={
                cleaned
                  ? (page) => (
                      <svg
                        className="template-default-layer"
                        viewBox="0 0 1 1"
                        preserveAspectRatio="none"
                        aria-label={`Template defaults, page ${page + 1}`}
                      >
                        {definition.fields
                          .filter((item) => item.page === page)
                          .map((item) => (
                            <TemplateDefaultPreview
                              key={item.id}
                              field={item}
                              page={definition.pages[page]}
                            />
                          ))}
                      </svg>
                    )
                  : (page) => (
                      <svg
                        className="template-box-layer"
                        viewBox="0 0 1 1"
                        preserveAspectRatio="none"
                        tabIndex={0}
                        onPointerDown={(event) => start(event, page)}
                        onPointerMove={move}
                        onPointerUp={finish}
                        onPointerCancel={finish}
                        onContextMenu={(event) => { if (event.ctrlKey) event.preventDefault(); }}
                        aria-label={`Template field review, page ${page + 1}`}
                      >
                        {[
                          ...definition.clear_areas
                            .filter((box) => box.page === page)
                            .map((box) => ({ box, kind: "cover" as const })),
                          ...(!coverOnly
                            ? definition.fields
                                .filter((box) => box.page === page)
                                .map((box) => ({ box, kind: "field" as const }))
                            : []),
                        ].map(({ box, kind }) => {
                          const active =
                              selections.some(item => item.id === box.id && item.kind === kind),
                            selection = { id: box.id, kind };
                          const boxField =
                            kind === "field" ? (box as TemplateField) : null;
                          return (
                            <g
                              key={`${kind}-${box.id}`}
                              data-box-id={box.id}
                              data-box-kind={kind}
                              data-selected={active || undefined}
                              onDragOver={(event) => {
                                if (kind === "field") event.preventDefault();
                              }}
                              onDrop={(event) => {
                                event.preventDefault();
                                const id =
                                  event.dataTransfer.getData(extractionMime);
                                if (id && kind === "field") bind(id, box.id);
                              }}
                            >
                              <rect
                                className={
                                  problemIds.has(box.id)
                                    ? "calculation-box-error"
                                    : undefined
                                }
                                x={box.x}
                                y={box.y}
                                width={box.width}
                                height={box.height}
                                fill={
                                  kind === "cover"
                                    ? (box as ClearArea).color
                                    : "rgba(34,74,190,.06)"
                                }
                                stroke={
                                  active
                                    ? "#df523d"
                                    : kind === "cover"
                                      ? "#9aa5b1"
                                      : "#263bb5"
                                }
                                strokeWidth=".0015"
                                style={{
                                  pointerEvents: mode ? "none" : "auto",
                                }}
                                onPointerDown={(event) =>
                                  start(event, page, selection)
                                }
                              />
                              {boxField && templateDefaultText(boxField) && (
                                <TemplateDefaultPreview
                                  field={boxField}
                                  page={definition.pages[page]}
                                />
                              )}
                              {boxField && !templateDefaultText(boxField) && (
                                <text
                                  x={box.x + (boxField.alignment === "left"
                                    ? Math.min(.01, box.width * .05)
                                    : boxField.alignment === "right"
                                      ? box.width - Math.min(.01, box.width * .05)
                                      : box.width / 2)}
                                  y={box.y + box.height / 2}
                                  textAnchor={boxField.alignment === "left" ? "start" : boxField.alignment === "right" ? "end" : "middle"}
                                  dominantBaseline="middle"
                                  fill={boxField.color}
                                  fontFamily={
                                    boxField.font.startsWith("Times")
                                      ? "Times New Roman"
                                      : boxField.font.startsWith("Helvetica")
                                        ? "Arial"
                                        : "Courier New"
                                  }
                                  fontSize={Math.min(
                                    box.height * 0.65,
                                    boxField.font_size /
                                      definition.pages[page].height,
                                  )}
                                  pointerEvents="none"
                                >
                                  {boxField.label}
                                </text>
                              )}
                              {active &&
                                !mode &&
                                edges.map((edge) => {
                                  const p = handlePoint(box, edge);
                                  return (
                                    <rect
                                      key={edge}
                                      data-resize-edge={edge}
                                      x={p.x - 0.004}
                                      y={p.y - 0.004}
                                      width=".008"
                                      height=".008"
                                      fill="white"
                                      stroke="#df523d"
                                      strokeWidth=".0015"
                                      style={{ cursor: `${edge}-resize` }}
                                      onPointerDown={(event) =>
                                        start(event, page, selection, edge)
                                      }
                                    />
                                  );
                                })}
                            </g>
                          );
                        })}
                      </svg>
                    )
              }
            />
          </section>
        </div>
      )}
      {busy && (
        <div className="feedback-toast" role="status">
          {busy}
        </div>
      )}
      <AlertDialog open={!!saved} onOpenChange={(open) => {
        if (!open && saved) openSavedTemplate(saved.id);
      }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Template saved successfully</AlertDialogTitle>
            <AlertDialogDescription>Opening your template. You can create new reports there.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button onClick={() => saved && openSavedTemplate(saved.id)}>Open template</Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {error && (
        <div className="feedback-toast" role="alert">
          {error}
        </div>
      )}
      {cropImage && (
        <ImageExtraction
          file={cropImage.file}
          onCancel={() => setCropImage(null)}
          onComplete={(name, region: Region, text) => {
            const id = createId();
            change((current) => ({
              ...current,
              extractions: [
                ...current.extractions,
                {
                  id,
                  name,
                  image_field: cropImage.fieldId,
                  region,
                  target_field: null,
                },
              ],
            }));
            setSampleValues((current) => ({
              ...current,
              [id]: text || "No text found — retake or adjust the crop",
            }));
            setCropImage(null);
          }}
        />
      )}
    </main>
  );
}

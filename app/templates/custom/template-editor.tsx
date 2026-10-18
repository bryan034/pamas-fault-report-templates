"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import {
  ArrowLeft,
  Download,
  LoaderCircle,
  RotateCcw,
  Trash2,
  UploadCloud,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import ResizableReportWorkspace, {
  revealSidebarField,
} from "@/components/resizable-report-workspace";
import ReportTitleRequired from "@/components/report-title-required";
import { Input } from "@/components/ui/input";
import ReportPreview, {
  reportConfiguration,
} from "@/components/report-preview";
import ImageExtraction, {
  ExtractionItems,
  extractionMime,
} from "@/components/image-extraction";
import {
  CustomDraftDetail,
  CustomDraftSummary,
  Extraction,
  TemplateDetail,
  TemplateField,
  TemplateReport,
  FieldLayers,
  calculateValues,
  downloadBlob,
  emptyReport,
  prepareImage,
  reportPayload,
  templateJson,
  templateApiBase,
  templateRequest,
} from "@/lib/template-api";
import { readPhotos } from "@/lib/template-image-ocr";
import { extractQuotedReading } from "@/lib/template-ocr";
import { extractedValue, fieldsInPageOrder, nextReportField } from "@/lib/template-editing";
import { calculationProblems } from "@/lib/template-calculations";
import { createId } from "@/lib/create-id";

export default function TemplateEditor({
  templateId,
  draftId,
  sandbox,
}: {
  templateId: string;
  draftId: string | null;
  sandbox?: {
    template: TemplateDetail;
    blank: Uint8Array;
    onContinue: () => void;
    onSave: () => void;
    busy: boolean;
    error: string;
  };
}) {
  const [template, setTemplate] = useState<TemplateDetail | null>(
      sandbox?.template || null,
    ),
    [report, setReport] = useState<TemplateReport>(() => emptyReport(sandbox?.template.definition));
  const [images, setImages] = useState<Record<string, File>>({}),
    [imageUrls, setImageUrls] = useState<Record<string, string>>({});
  const [companies, setCompanies] = useState<string[]>([]),
    [activeDraft, setActiveDraft] = useState(draftId);
  const [loading, setLoading] = useState(!sandbox),
    [loadError, setLoadError] = useState(""),
    [notice, setNotice] = useState("");
  const [preview, setPreview] = useState<FieldLayers | null>(null),
    [previewError, setPreviewError] = useState(""),
    [previewBusy, setPreviewBusy] = useState(false);
  const [saving, setSaving] = useState(false),
    [downloading, setDownloading] = useState(false),
    [imageBusy, setImageBusy] = useState("");
  const [resetOpen, setResetOpen] = useState(false);
  const [cropImage, setCropImage] = useState<{
    fieldId: string;
    file: File;
  } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [previewRetry, setPreviewRetry] = useState(0);
  const assets = useRef<{
    images: Record<string, File>;
    revision: string;
    pending: Promise<string>;
  } | null>(null);
  const [selectedField, setSelectedField] = useState<string | null>(null);
  const [ocrNotes, setOcrNotes] = useState<Record<string, string>>({});
  const imageVersions = useRef<Record<string, number>>({});
  const valueEdits = useRef<Record<string, number>>({});
  const [titleRequired, setTitleRequired] = useState(false);
  const titleInput = useRef<HTMLInputElement>(null);
  const workspace = useRef<HTMLDivElement>(null);
  const pendingTextSelection = useRef<{ id: string; position: number } | null>(null);
  useLayoutEffect(() => {
    const selection = pendingTextSelection.current;
    if (!selection) return;
    const textarea = workspace.current?.querySelector<HTMLTextAreaElement>(
      `[data-sidebar-field="${CSS.escape(selection.id)}"] textarea`,
    );
    if (!textarea) return;
    pendingTextSelection.current = null;
    textarea.focus({ preventScroll: true });
    textarea.setSelectionRange(selection.position, selection.position);
  }, [report.values]);
  const [configurationDialog, setConfigurationDialog] = useState(false);
  const configurationBaseline = useRef(
    JSON.stringify(reportConfiguration(emptyReport())),
  );
  const defaultsRevision = useRef("");
  const base = `/api/templates/${templateId}`;

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 3000);
    return () => window.clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    if (sandbox) return;
    let cancelled = false;
    void (async () => {
      try {
        const [t, drafts] = await Promise.all([
          templateJson<TemplateDetail>(
            draftId ? `${base}?draft_id=${draftId}` : base,
          ),
          templateJson<{ drafts: CustomDraftSummary[] }>(`${base}/drafts`),
        ]);
        if (cancelled) return;
        if (t.archived && !draftId)
          throw new Error(
            "This template is archived. Open an existing report or restore the template.",
          );
        setTemplate(t);
        defaultsRevision.current = t.revision_id;
        const names = new Map<string, string>();
        for (const draft of drafts.drafts)
          if (draft.company.trim())
            names.set(draft.company.toLowerCase(), draft.company);
        setCompanies([...names.values()].sort());
        if (draftId) {
          const draft = await templateJson<CustomDraftDetail>(
            `${base}/drafts/${draftId}`,
          );
          const files: Record<string, File> = {};
          await Promise.all(
            draft.images.map(async (image) => {
              const response = await templateRequest(
                `${base}/drafts/${draftId}/images/${image.field_id}`,
              );
              files[image.field_id] = new File(
                [await response.blob()],
                image.filename,
                { type: image.media_type },
              );
            }),
          );
          if (cancelled) return;
          setReport({ ...emptyReport(), ...draft.form });
          configurationBaseline.current = JSON.stringify(
            reportConfiguration({ ...emptyReport(), ...draft.form }),
          );
          setImages(files);
          setActiveDraft(draft.id);
        } else {
          setReport(emptyReport(t.definition));
        }
        if (!cancelled) setLoading(false);
      } catch (cause) {
        if (!cancelled) {
          setLoadError(
            cause instanceof Error ? cause.message : "Could not open report",
          );
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [base, draftId]);
  useEffect(() => {
    let cancelled = false;
    const urls = Object.fromEntries(
      Object.entries(images).map(([id, file]) => [
        id,
        URL.createObjectURL(file),
      ]),
    );
    queueMicrotask(() => {
      if (!cancelled) setImageUrls(urls);
    });
    return () => {
      cancelled = true;
      Object.values(urls).forEach((url) => URL.revokeObjectURL(url));
    };
  }, [images]);
  const previewKey = JSON.stringify({
    values: report.values,
    layout: report.layout,
    styles: report.styles,
    rectangles: [],
  });
  useEffect(() => {
    if (!template || loading) return;
    if (dragging) return;
    const controller = new AbortController();
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setPreviewBusy(true);
      setPreviewError("");
      try {
        let token = "";
        if (!sandbox && Object.keys(images).length) {
          if (
            !assets.current ||
            assets.current.images !== images ||
            assets.current.revision !== template.revision_id
          ) {
            const body = reportPayload(
              emptyReport(),
              images,
              template.revision_id,
            );
            assets.current = {
              images,
              revision: template.revision_id,
              pending: templateJson<{ token: string }>(
                `${base}/preview-assets`,
                { method: "POST", body },
              ).then((result) => result.token),
            };
          }
          try {
            token = await assets.current.pending;
          } catch (error) {
            assets.current = null;
            throw error;
          }
        }
        if (cancelled) return;
        const body = reportPayload(
          { ...emptyReport(), ...JSON.parse(previewKey) },
          sandbox ? images : {},
          sandbox ? undefined : template.revision_id,
        );
        if (token) body.append("asset_token", token);
        body.append("layered", "true");
        if (sandbox) {
          body.append("definition_json", JSON.stringify(template.definition));
          body.append(
            "pdf",
            new Blob([new Uint8Array(sandbox.blank).buffer], {
              type: "application/pdf",
            }),
            "preview.pdf",
          );
        }
        const response = await templateRequest(
          sandbox ? "/api/template-try-report" : `${base}/preview`,
          {
            method: "POST",
            body,
            signal: controller.signal,
          },
        );
        const data = (await response.json()) as FieldLayers;
        if (!cancelled) {
          setPreview(data);
          setPreviewBusy(false);
        }
      } catch (cause) {
        if (!cancelled) {
          if (
            cause instanceof Error &&
            cause.message.includes("Preview images expired")
          ) {
            assets.current = null;
            setPreviewRetry((value) => value + 1);
            return;
          }
          setPreviewError(
            cause instanceof Error ? cause.message : "Preview unavailable",
          );
          setPreviewBusy(false);
        }
      }
    }, 120);
    return () => {
      cancelled = true;
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [base, template, previewKey, images, loading, dragging, previewRetry]);

  const values = useMemo(
    () =>
      template
        ? calculateValues(template.definition, report.values)
        : report.values,
    [template, report.values],
  );
  const calcIssues = useMemo(
    () =>
      template ? calculationProblems(template.definition, values) : [],
    [template, values],
  );
  const calcProblemIds = new Set(calcIssues.flatMap((issue) => issue.fieldIds));
  const extractedItems = useMemo(
    () => [
      ...new Map(
        [
          ...(template?.definition.extractions || []),
          ...report.extractions,
        ].map((item) => [item.id, item]),
      ).values(),
    ],
    [template, report.extractions],
  );
  const missing = useMemo(() => {
    const result = report.title.trim() ? [] : ["Report title"];
    if (!template) return result;
    for (const field of template.definition.fields) {
      if (!field.required) continue;
      const value = values[field.id];
      if (
        field.kind === "image"
          ? !images[field.id]
          : field.kind === "checkbox"
            ? value !== true
            : value === undefined ||
              value === "" ||
              (typeof value === "string" && !value.trim())
      )
        result.push(field.label);
    }
    return result;
  }, [
    template,
    report.title,
    report.readings_confirmed,
    values,
    images,
    extractedItems,
  ]);
  const setValue = (field: TemplateField, value: string | boolean) => {
    valueEdits.current[field.id] = (valueEdits.current[field.id] || 0) + 1;
    setReport((current) => {
      const confirmed = { ...current.readings_confirmed };
      for (const mapping of template?.definition.ocr_mappings || [])
        if (mapping.target_field === field.id)
          confirmed[mapping.image_field] = false;
      for (const item of extractedItems)
        if (item.target_field === field.id) confirmed[item.image_field] = false;
      return {
        ...current,
        values: { ...current.values, [field.id]: value },
        readings_confirmed: confirmed,
      };
    });
  };
  const fieldKeyDown = (event: KeyboardEvent<HTMLElement>, id: string, field?: TemplateField) => {
    if (!template || event.key !== "Enter" || event.nativeEvent.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
    const control = event.target;
    if (!(control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement || control instanceof HTMLSelectElement)) return;
    if (event.shiftKey) {
      if (field && ["text", "textarea"].includes(field.kind) && control instanceof HTMLInputElement) {
        event.preventDefault();
        const start = control.selectionStart ?? control.value.length;
        const end = control.selectionEnd ?? start;
        const nextValue = control.value.slice(0, start) + "\n" + control.value.slice(end);
        // Restore the caret in the replacement textarea during this commit,
        // before the next keypress (an animation frame can race fast typing).
        pendingTextSelection.current = { id: field.id, position: start + 1 };
        setValue(field, nextValue);
      }
      return; // Textareas insert their own newline; date/number fields stay typed.
    }
    event.preventDefault();
    const next = nextReportField(template.definition.fields, report.layout, id);
    if (!next) return;
    setSelectedField(next.id);
    const container = workspace.current?.querySelector<HTMLElement>(`[data-sidebar-field="${CSS.escape(next.id)}"]`);
    container?.querySelector<HTMLElement>("input, textarea, select")?.focus({ preventScroll: true });
    revealSidebarField(workspace.current, next.id);
  };
  const runOcr = async (fieldId: string, file: File, version: number) => {
    const rules =
      template?.definition.ocr_mappings.filter(
        (rule) => rule.image_field === fieldId,
      ) || [];
    const items = extractedItems.filter((item) => item.image_field === fieldId);
    if (!rules.length && !items.length) return;
    const regions = [
      ...rules.map((rule) => rule.region),
      ...items.map((item) => item.region),
    ];
    const targetEdits = { ...valueEdits.current };
    const uniqueRegions = [
      ...new Map(
        regions.map((region) => [JSON.stringify(region), region]),
      ).values(),
    ];
    const uniqueResults = await readPhotos(file, uniqueRegions);
    const byRegion = new Map(
      uniqueRegions.map((region, index) => [
        JSON.stringify(region),
        uniqueResults[index],
      ]),
    );
    const results = regions.map(
      (region) => byRegion.get(JSON.stringify(region))!,
    );
    if (imageVersions.current[fieldId] !== version) return;
    const updates: Record<string, string | boolean> = {},
      raw: Record<string, string> = {},
      notes: string[] = [];
    rules.forEach((rule, index) => {
      const reading = extractQuotedReading(
        results[index].text,
        rule.photo_label,
        rule.qualifier,
      );
      updates[rule.target_field] = reading === null ? "" : String(reading);
      notes.push(
        rule.photo_label +
          ": " +
          (reading === null ? "not found — enter manually" : reading),
      );
    });
    items.forEach((item, index) => {
      const text = results[rules.length + index].text.trim();
      raw[item.id] = text;
      const target = template?.definition.fields.find(
        (field) => field.id === item.target_field,
      );
      if (target) updates[target.id] = extractedValue(text, target) ?? "";
      notes.push(
        item.name + ": " + (text || "not found — retake or enter manually"),
      );
    });
    setReport((current) => ({
      ...current,
      values: {
        ...current.values,
        ...Object.fromEntries(
          Object.entries(updates).filter(
            ([id]) => (valueEdits.current[id] || 0) === (targetEdits[id] || 0),
          ),
        ),
      },
      extraction_values: { ...current.extraction_values, ...raw },
      readings_confirmed: { ...current.readings_confirmed, [fieldId]: false },
    }));
    setOcrNotes((current) => ({ ...current, [fieldId]: notes.join("\n") }));
    setNotice("Image values extracted. Review and confirm before downloading.");
  };
  const dropExtraction = (id: string, field: TemplateField) => {
    const item = extractedItems.find((item) => item.id === id);
    if (!item) return;
    const value = extractedValue(report.extraction_values[id] || "", field);
    if (value === null) {
      setNotice(
        "The extracted text does not match this field type. Retake the crop or enter it manually.",
      );
      return;
    }
    valueEdits.current[field.id] = (valueEdits.current[field.id] || 0) + 1;
    const overrides = extractedItems
      .filter((other) => other.id !== id && other.target_field === field.id)
      .map((other) => ({ ...other, target_field: null }));
    setReport((current) => ({
      ...current,
      values: { ...current.values, [field.id]: value },
      extractions: [
        ...current.extractions.filter(
          (other) =>
            other.id !== id &&
            !overrides.some((override) => override.id === other.id),
        ),
        ...overrides,
        { ...item, target_field: field.id },
      ],
      readings_confirmed: {
        ...current.readings_confirmed,
        [item.image_field]: false,
      },
    }));
  };
  const attach = async (fieldId: string, file: File) => {
    if (imageBusy) return;
    const version = (imageVersions.current[fieldId] || 0) + 1;
    imageVersions.current[fieldId] = version;
    setImageBusy(fieldId);
    try {
      const prepared = await prepareImage(file);
      if (imageVersions.current[fieldId] !== version) return;
      setImages((current) => ({ ...current, [fieldId]: prepared }));
      setReport((current) => {
        const next = { ...current.values };
        for (const mapping of template?.definition.ocr_mappings || [])
          if (mapping.image_field === fieldId) next[mapping.target_field] = "";
        for (const item of extractedItems)
          if (item.image_field === fieldId && item.target_field)
            next[item.target_field] = "";
        return {
          ...current,
          values: next,
          rectangles: current.rectangles.filter(
            (rect) => rect.image_field !== fieldId,
          ),
          readings_confirmed: {
            ...current.readings_confirmed,
            [fieldId]: false,
          },
        };
      });
      await runOcr(fieldId, prepared, version);
    } catch (cause) {
      setNotice(
        cause instanceof Error ? cause.message : "Could not process image",
      );
    } finally {
      setImageBusy("");
    }
  };
  const removeImage = (fieldId: string) => {
    imageVersions.current[fieldId] = (imageVersions.current[fieldId] || 0) + 1;
    setImages((current) => {
      const next = { ...current };
      delete next[fieldId];
      return next;
    });
    setReport((current) => ({
      ...current,
      values: Object.fromEntries(
        Object.entries(current.values).map(([key, value]) => [
          key,
          extractedItems.some(
            (item) => item.image_field === fieldId && item.target_field === key,
          )
            ? ""
            : value,
        ]),
      ),
      extraction_values: Object.fromEntries(
        Object.entries(current.extraction_values).filter(
          ([key]) =>
            !extractedItems.some(
              (item) => item.id === key && item.image_field === fieldId,
            ),
        ),
      ),
      rectangles: current.rectangles.filter(
        (rect) => rect.image_field !== fieldId,
      ),
      readings_confirmed: { ...current.readings_confirmed, [fieldId]: false },
    }));
    setOcrNotes((current) => {
      const next = { ...current };
      delete next[fieldId];
      return next;
    });
  };
  const save = async (publishConfiguration = false) => {
    if (!report.title.trim()) {
      setNotice(
        `Enter a report title to save. Still blank: ${missing.join(", ")}`,
      );
      return;
    }
    setConfigurationDialog(false);
    setSaving(true);
    try {
      const draft = await templateJson<CustomDraftDetail>(
        activeDraft ? `${base}/drafts/${activeDraft}` : `${base}/drafts`,
        {
          method: activeDraft ? "PUT" : "POST",
          body: reportPayload(report, images, template?.revision_id),
        },
      );
      setActiveDraft(draft.id);
      if (!activeDraft)
        window.history.replaceState(
          null,
          "",
          `/templates/custom/${templateId}/drafts/${draft.id}`,
        );
      const company = template?.definition.fields.find(
        (field) => field.role === "company",
      );
      const name = company
        ? String(report.values[company.id] || "").trim()
        : "";
      if (name)
        setCompanies((current) =>
          current.some((item) => item.toLowerCase() === name.toLowerCase())
            ? current
            : [...current, name].sort(),
        );
      if (publishConfiguration) {
        try {
          const result = await templateJson<TemplateDetail>(
            base + "/report-defaults",
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                ...reportConfiguration(report),
                expected_revision_id:
                  defaultsRevision.current || template?.revision_id,
              }),
            },
          );
          defaultsRevision.current = result.revision_id;
        } catch (cause) {
          setNotice(
            "Draft saved, but future defaults were not updated: " +
              (cause instanceof Error ? cause.message : "Please try again."),
          );
          return;
        }
      }
      configurationBaseline.current = JSON.stringify(
        reportConfiguration(report),
      );
      setNotice(
        missing.length
          ? `Draft saved. Still blank: ${missing.join(", ")}`
          : "Draft saved. All required fields are filled.",
      );
    } catch (cause) {
      setNotice(
        cause instanceof Error ? cause.message : "Could not save draft",
      );
    } finally {
      setSaving(false);
    }
  };
  const download = async (format: "pdf" | "docx" | "original" = "pdf") => {
    setDownloading(true);
    try {
      const response = await templateRequest(`${base}/generate?format=${format}`, {
        method: "POST",
        body: reportPayload(report, images, template?.revision_id),
      });
      const filename =
        response.headers
          .get("Content-Disposition")
          ?.match(/filename="([^"]+)"/)?.[1] ||
        `${report.title.trim() || "Report"}.${format === "original" ? template?.source_format || "pdf" : format}`;
      downloadBlob(await response.blob(), filename);
    } catch (cause) {
      setNotice(
        cause instanceof Error ? cause.message : "Could not download report",
      );
    } finally {
      setDownloading(false);
    }
  };
  const reset = () => {
    for (const key of Object.keys(images))
      imageVersions.current[key] = (imageVersions.current[key] || 0) + 1;
    setReport(emptyReport(template?.definition));
    setImages({});
    setOcrNotes({});
    setResetOpen(false);
    setNotice(
      "Report fields reset. The saved draft is unchanged until you save.",
    );
  };

  if (loadError)
    return (
      <main className="catalog-shell">
        <section className="catalog-content">
          <a className="back-link" href={`/templates/custom/${templateId}`}>
            <ArrowLeft size={18} /> Draft library
          </a>
          <p className="catalog-error" role="alert">
            {loadError}
          </p>
        </section>
      </main>
    );
  if (loading || !template)
    return (
      <main className="catalog-shell">
        <section className="catalog-content">
          <p className="list-state">Opening report…</p>
        </section>
      </main>
    );

  return (
    <main className="app-shell report-shell">
      <header className="topbar">
        <a
          className="editor-back"
          href={
            sandbox ? "#continue-editing" : `/templates/custom/${templateId}`
          }
          onClick={
            sandbox
              ? (event) => {
                  event.preventDefault();
                  sandbox.onContinue();
                }
              : undefined
          }
          aria-label={
            sandbox ? "Continue editing template" : "Back to draft library"
          }
        >
          <ArrowLeft />
        </a>
        <div className="topbar-title">
          <h1>{template.title}</h1>
          <p>
            {sandbox
              ? "Unsaved report creation preview — test values are not saved"
              : activeDraft
                ? "Editing saved draft"
                : "New report"}
          </p>
        </div>
        <div className="topbar-actions">
          {sandbox ? (
            <>
              <Button variant="outline" onClick={sandbox.onContinue}>
                Continue editing
              </Button>
              <Button disabled={sandbox.busy} onClick={sandbox.onSave}>
                Save template
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="outline"
                onClick={() => setResetOpen(true)}
                disabled={Boolean(imageBusy)}
              >
                <RotateCcw size={16} /> Reset
              </Button>
              <Button
                variant={report.title.trim() ? "default" : "outline"}
                className={!report.title.trim() ? "save-title-missing" : ""}
                onClick={() => {
                  if (!report.title.trim()) {
                    setTitleRequired(true);
                    return;
                  }
                  if (
                    JSON.stringify(reportConfiguration(report)) !==
                    configurationBaseline.current
                  )
                    setConfigurationDialog(true);
                  else void save();
                }}
                disabled={saving || Boolean(imageBusy)}
              >
                {saving && <LoaderCircle className="spin" />}Save draft
              </Button>
              <Button
                className={missing.length ? "download-incomplete" : ""}
                onClick={() => void download()}
                disabled={downloading || Boolean(imageBusy)}
                title={
                  missing.length
                    ? `${missing.length} required fields or reviews outstanding; partial PDFs are allowed`
                    : "Download completed PDF"
                }
              >
                <Download size={16} /> Download PDF
              </Button>
              <Button
                variant="outline"
                className={missing.length ? "download-incomplete" : ""}
                onClick={() => void download("docx")}
                disabled={downloading || Boolean(imageBusy)}
                title="Fixed-layout Word export with editable report values"
              >
                <Download size={16} /> Download Word
              </Button>
            </>
          )}{" "}
        </div>
      </header>
      {sandbox?.error && (
        <p className="catalog-error" role="alert">
          {sandbox.error}
        </p>
      )}
      <ResizableReportWorkspace workspaceRef={workspace}>
        <aside className="template-sidebar">
          <label
            data-sidebar-field="report_title"
            onKeyDown={(event) => fieldKeyDown(event, "report_title")}
            className={`field-stack${!report.title.trim() ? " is-empty" : ""}`}
          >
            <span>Report title</span>
            <Input
              ref={titleInput}
              value={report.title}
              maxLength={100}
              placeholder="Required to save a draft"
              onChange={(event) =>
                setReport((current) => ({
                  ...current,
                  title: event.target.value,
                }))
              }
            />
          </label>
          {calcIssues.length > 0 && (
            <div className="calculation-errors" role="alert">
              {calcIssues.map((issue) => (
                <p key={issue.message}>{issue.message}</p>
              ))}
            </div>
          )}
          {fieldsInPageOrder(template.definition.fields, report.layout).filter((field) => field.kind !== "calculated").map(
            (field) => {
              const value = values[field.id] ?? "";
              const blank =
                field.kind === "image"
                  ? !images[field.id]
                  : field.kind === "checkbox"
                    ? value !== true
                    : value === "";
              if (field.kind === "image") {
                const mappings = template.definition.ocr_mappings.filter(
                  (rule) => rule.image_field === field.id,
                );
                const hasReadings =
                  mappings.length > 0 ||
                  extractedItems.some((item) => item.image_field === field.id);
                return (
                  <section
                    className="template-image-input"
                    key={field.id}
                    data-sidebar-field={field.id}
                    data-preview-active={
                      selectedField === field.id || undefined
                    }
                  >
                    <h2>{field.label}</h2>
                    <div
                      className={`template-image-drop${blank && field.required ? " is-empty" : ""}`}
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={(event) => {
                        event.preventDefault();
                        const file = event.dataTransfer.files[0];
                        if (file) void attach(field.id, file);
                      }}
                    >
                      {imageUrls[field.id] && (
                        <img
                          src={imageUrls[field.id]}
                          alt={`${field.label} upload`}
                        />
                      )}
                      <p>
                        {imageBusy === field.id
                          ? "Preparing image / reading labels…"
                          : hasReadings
                            ? "Reads your named image crops"
                            : "Visual reference only"}
                      </p>
                      <label className="template-file-label">
                        <UploadCloud size={16} />{" "}
                        {images[field.id]
                          ? "Replace image"
                          : "Choose or drop image"}
                        <input
                          type="file"
                          accept="image/png,image/jpeg,image/webp"
                          disabled={Boolean(imageBusy)}
                          onChange={(event) => {
                            const file = event.target.files?.[0];
                            if (file) void attach(field.id, file);
                            event.target.value = "";
                          }}
                        />
                      </label>
                      {images[field.id] && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => removeImage(field.id)}
                        >
                          <Trash2 size={14} /> Remove
                        </Button>
                      )}
                    </div>
                    {images[field.id] && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          setCropImage({
                            fieldId: field.id,
                            file: images[field.id],
                          })
                        }
                      >
                        Extract data from image
                      </Button>
                    )}
                    <ExtractionItems
                      items={extractedItems.filter(
                        (item) => item.image_field === field.id,
                      )}
                      values={report.extraction_values}
                      fields={template.definition.fields}
                      onAssign={(id, target) => {
                        const destination = template.definition.fields.find(
                          (item) => item.id === target,
                        );
                        if (destination) dropExtraction(id, destination);
                        else {
                          const item = extractedItems.find(
                            (item) => item.id === id,
                          );
                          if (item)
                            setReport((current) => ({
                              ...current,
                              extractions: [
                                ...current.extractions.filter(
                                  (other) => other.id !== id,
                                ),
                                { ...item, target_field: null },
                              ],
                            }));
                        }
                      }}
                    />
                    {hasReadings && images[field.id] && (
                      <div className="template-reading-review">
                        {ocrNotes[field.id] && <pre>{ocrNotes[field.id]}</pre>}
                        <p>
                          Review or correct the extracted values in the fields
                          below.
                        </p>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={Boolean(imageBusy)}
                          onClick={async () => {
                            const version =
                              (imageVersions.current[field.id] || 0) + 1;
                            imageVersions.current[field.id] = version;
                            setImageBusy(field.id);
                            try {
                              await runOcr(field.id, images[field.id], version);
                            } catch (cause) {
                              setNotice(
                                cause instanceof Error
                                  ? cause.message
                                  : "OCR failed",
                              );
                            } finally {
                              setImageBusy("");
                            }
                          }}
                        >
                          Read image again
                        </Button>
                      </div>
                    )}
                  </section>
                );
              }
              if (field.kind === "checkbox")
                return (
                  <label
                    key={field.id}
                    data-sidebar-field={field.id}
                    onKeyDown={(event) => fieldKeyDown(event, field.id, field)}
                    data-preview-active={
                      selectedField === field.id || undefined
                    }
                    className={`template-checkbox-field${blank && field.required ? " is-empty" : ""}`}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => {
                      event.preventDefault();
                      const id = event.dataTransfer.getData(extractionMime);
                      if (id) dropExtraction(id, field);
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={value === true}
                      onChange={(event) =>
                        setValue(field, event.target.checked)
                      }
                    />
                    <span>{field.label}</span>
                  </label>
                );
              return (
                <label
                  className={`field-stack${blank && field.required ? " is-empty" : ""}${calcProblemIds.has(field.id) ? " is-calculation-error" : ""}`}
                  onFocus={() => setSelectedField(field.id)}
                  key={field.id}
                  data-sidebar-field={field.id}
                  onKeyDown={(event) => fieldKeyDown(event, field.id, field)}
                  data-preview-active={selectedField === field.id || undefined}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => {
                    event.preventDefault();
                    const id = event.dataTransfer.getData(extractionMime);
                    if (id) dropExtraction(id, field);
                  }}
                >
                  <span>
                    {field.label}
                  </span>
                  {field.kind === "textarea" || (field.kind === "text" && String(value).includes("\n")) ? (
                    <textarea
                      aria-label={field.label}
                      rows={4}
                      maxLength={20000}
                      style={{ textAlign: report.styles[field.id]?.alignment ?? field.alignment }}
                      value={String(value)}
                      onChange={(event) => setValue(field, event.target.value)}
                    />
                  ) : field.kind === "select" ? (
                    <select
                      aria-label={field.label}
                      value={String(value)}
                      onChange={(event) => setValue(field, event.target.value)}
                    >
                      <option value="">Select…</option>
                      {field.options.map((option) => (
                        <option key={option}>{option}</option>
                      ))}
                    </select>
                  ) : (
                    <Input
                      aria-label={field.label}
                      style={{ textAlign: report.styles[field.id]?.alignment ?? field.alignment }}
                      aria-invalid={calcProblemIds.has(field.id)}
                      type={
                        field.kind === "number"
                          ? "number"
                          : field.kind === "date"
                            ? "date"
                            : field.kind === "time"
                              ? "time"
                              : "text"
                      }
                      step={field.kind === "number" ? "any" : undefined}
                      value={String(value)}
                      list={
                        field.role === "company"
                          ? `companies-${field.id}`
                          : undefined
                      }
                      onChange={(event) => setValue(field, event.target.value)}
                    />
                  )}
                  {field.role === "company" && (
                    <datalist id={`companies-${field.id}`}>
                      {companies
                        .filter((name) =>
                          name
                            .toLowerCase()
                            .startsWith(String(value).trim().toLowerCase()),
                        )
                        .map((name) => (
                          <option key={name} value={name} />
                        ))}
                    </datalist>
                  )}
                </label>
              );
            },
          )}
        </aside>
        <section className="template-preview-pane">
          <ReportPreview
            definition={template.definition}
            report={report}
            onChange={setReport}
            background={
              sandbox?.blank ||
              `${templateApiBase()}${base}/background?revision_id=${template.revision_id}`
            }
            layers={preview}
            busy={previewBusy}
            error={previewError}
            onDragState={setDragging}
            onImage={(id, file) => void attach(id, file)}
            onExtraction={dropExtraction}
            activeField={selectedField}
            onActiveField={(id) => {
              setSelectedField(id);
              revealSidebarField(workspace.current, id);
            }}
            onValue={setValue}
          />
        </section>
      </ResizableReportWorkspace>
      <ReportTitleRequired
        open={titleRequired}
        onOpenChange={setTitleRequired}
        onAddTitle={() => {
          titleInput.current?.scrollIntoView({ block: "nearest" });
          titleInput.current?.focus();
        }}
      />
      {notice && (
        <div className="feedback-toast" role="status" aria-live="polite">
          {notice}
        </div>
      )}
      <AlertDialog
        open={configurationDialog}
        onOpenChange={setConfigurationDialog}
      >
        <AlertDialogContent className="report-configuration-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>
              Use this configuration for future reports?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Save these font sizes and field positions/sizes as the defaults
              for all future reports using this template? Current report values,
              photos, shapes, font families and colours will NOT be used.
              Existing saved reports stay unchanged.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button
              variant="outline"
              disabled={saving}
              onClick={() => void save(false)}
            >
              Save draft only
            </Button>
            <Button disabled={saving} onClick={() => void save(true)}>
              Save draft and future configuration
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={resetOpen} onOpenChange={setResetOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset report?</AlertDialogTitle>
            <AlertDialogDescription>
              This clears the current fields, photos, annotations, and layout
              changes. This action cannot be undone. Your saved draft changes
              only when you save again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button onClick={reset}>Reset report</Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {cropImage && (
        <ImageExtraction
          file={cropImage.file}
          onCancel={() => setCropImage(null)}
          onComplete={(name, region, text) => {
            const item: Extraction = {
              id: createId(),
              image_field: cropImage.fieldId,
              name,
              region,
              target_field: null,
            };
            setReport((current) => ({
              ...current,
              extractions: [...current.extractions, item],
              extraction_values: {
                ...current.extraction_values,
                [item.id]: text,
              },
              readings_confirmed: {
                ...current.readings_confirmed,
                [cropImage.fieldId]: false,
              },
            }));
            setCropImage(null);
            setNotice(
              "Drag the extracted item onto a field to fill its value.",
            );
          }}
        />
      )}
    </main>
  );
}

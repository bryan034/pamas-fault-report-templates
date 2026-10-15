"use client";
import { useEffect, useRef, useState, type PointerEvent } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Extraction, Region, TemplateField } from "@/lib/template-api";
import { readPhoto } from "@/lib/template-image-ocr";

export const extractionMime = "application/x-report-extraction";
export function ExtractionItems({
  items,
  values = {},
  onRemove,
  fields,
  onAssign,
  onNavigate,
}: {
  items: Extraction[];
  values?: Record<string, string>;
  onRemove?: (id: string) => void;
  fields?: TemplateField[];
  onAssign?: (id: string, target: string) => void;
  onNavigate?: (item: Extraction) => void;
}) {
  return (
    <div className="extraction-items" aria-label="Extracted image items">
      {items.map((item) => (
        <div
          className={`extraction-chip${!item.target_field ? " is-unlinked" : ""}`}
          key={item.id}
          draggable
          onClick={(event) => {
            if (
              onNavigate &&
              !(event.target as Element).closest("button,select,input")
            )
              onNavigate(item);
          }}
          onDragStart={(event) => {
            event.dataTransfer.setData(extractionMime, item.id);
            event.dataTransfer.effectAllowed = "copy";
          }}
        >
          <strong>
            {onNavigate ? (
              <button
                type="button"
                className="extraction-item-navigation"
                onClick={() => onNavigate(item)}
                title="Show the linked field or source image box"
              >
                {item.name}
              </button>
            ) : (
              item.name
            )}
          </strong>
          <span>{values[item.id] || "Extracts from each uploaded photo"}</span>
          <small>
            {item.target_field
              ? `Linked to ${fields?.find((field) => field.id === item.target_field)?.label || item.target_field}`
              : "Drag onto a field, or use its Extracted item setting"}
          </small>
          {onAssign && (
            <select
              aria-label={`Fill field from ${item.name}`}
              value={item.target_field || ""}
              onChange={(event) => onAssign(item.id, event.target.value)}
            >
              <option value="">Choose destination field</option>
              {fields
                ?.filter(
                  (field) => !["image", "calculated"].includes(field.kind),
                )
                .map((field) => (
                  <option key={field.id} value={field.id}>
                    {field.label}
                  </option>
                ))}
            </select>
          )}
          {onRemove && (
            <Button
              size="icon"
              variant="ghost"
              aria-label={`Remove extracted item ${item.name}`}
              onClick={() => onRemove(item.id)}
            >
              <X size={14} />
            </Button>
          )}
        </div>
      ))}
    </div>
  );
}

export default function ImageExtraction({
  file,
  onCancel,
  onComplete,
}: {
  file: File;
  onCancel: () => void;
  onComplete: (name: string, region: Region, text: string) => void;
}) {
  const [url, setUrl] = useState("");
  const [region, setRegion] = useState<Region | null>(null),
    [name, setName] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const start = useRef<{ x: number; y: number } | null>(null),
    alive = useRef(true);
  const dialog = useRef<HTMLDivElement>(null);
  const cancel = useRef(onCancel);
  useEffect(() => {
    cancel.current = onCancel;
  }, [onCancel]);
  useEffect(() => {
    alive.current = true;
    let disposed = false;
    const objectUrl = URL.createObjectURL(file);
    queueMicrotask(() => {
      if (!disposed) setUrl(objectUrl);
    });
    const previousFocus = document.activeElement as HTMLElement | null;
    dialog.current?.focus();
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") cancel.current();
      if (event.key === "Tab" && dialog.current) {
        const controls = [
          ...dialog.current.querySelectorAll<HTMLElement>(
            "button:not(:disabled),input:not(:disabled),select:not(:disabled)",
          ),
        ];
        const first = controls[0],
          last = controls[controls.length - 1];
        if (!first) return;
        if (
          event.shiftKey &&
          (document.activeElement === first ||
            document.activeElement === dialog.current)
        ) {
          event.preventDefault();
          last.focus();
        } else if (
          !event.shiftKey &&
          (document.activeElement === last ||
            document.activeElement === dialog.current)
        ) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", key);
    return () => {
      alive.current = false;
      disposed = true;
      URL.revokeObjectURL(objectUrl);
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", key);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [file]);
  const point = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
    };
  };
  const read = async () => {
    if (!region || !name.trim()) {
      setError("Select an area and give it a name.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await readPhoto(file, region);
      if (alive.current) onComplete(name.trim(), region, result.text.trim());
    } catch (cause) {
      if (alive.current)
        setError(
          cause instanceof Error
            ? cause.message
            : "Could not extract this area",
        );
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  return (
    <div
      className="extraction-modal"
      ref={dialog}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label="Extract data from image"
    >
      <div className="extraction-modal-header">
        <div>
          <h2>Extract data from image</h2>
          <p>
            Drag over just the value you want to read. Press Escape to cancel.
          </p>
        </div>
        <Button
          className="extraction-visible-action"
          variant="outline"
          aria-label="Cancel extraction"
          onClick={onCancel}
        >
          <X />
        </Button>
      </div>
      <div
        className="extraction-image"
        onPointerDown={(event) => {
          if (busy || region) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          const begin = point(event);
          start.current = {
            x: Math.min(0.998, begin.x),
            y: Math.min(0.998, begin.y),
          };
        }}
        onPointerMove={(event) => {
          if (!start.current) return;
          const end = point(event),
            begin = start.current;
          setRegion({
            x: Math.min(begin.x, end.x),
            y: Math.min(begin.y, end.y),
            width: Math.max(0.002, Math.abs(end.x - begin.x)),
            height: Math.max(0.002, Math.abs(end.y - begin.y)),
          });
        }}
        onPointerUp={() => {
          start.current = null;
        }}
        onPointerCancel={() => {
          start.current = null;
          setRegion(null);
        }}
      >
        {url && (
          <img
            src={url}
            alt="Select the photo area to extract"
            draggable={false}
          />
        )}
        {region && (
          <div
            className="extraction-selection"
            style={{
              left: `${region.x * 100}%`,
              top: `${region.y * 100}%`,
              width: `${region.width * 100}%`,
              height: `${region.height * 100}%`,
            }}
          />
        )}
      </div>
      <div className="extraction-modal-footer">
        <label>
          Area name
          <Input
            aria-label="Area name"
            value={name}
            maxLength={80}
            placeholder="e.g. Fault temperature"
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <Button
          className="extraction-visible-action"
          variant="outline"
          disabled={busy}
          onClick={() => {
            setRegion(null);
            setError("");
          }}
        >
          Retake area
        </Button>
        <Button
          disabled={busy || !region || !name.trim()}
          onClick={() => void read()}
        >
          {busy ? "Reading locally…" : "Create extracted item"}
        </Button>
        {error && <p role="alert">{error}</p>}
      </div>
    </div>
  );
}

export function SamplePhotoPicker({
  file,
  referenceFile,
  onFile,
}: {
  file?: File;
  referenceFile?: File;
  onFile: (file: File) => void;
}) {
  const [url, setUrl] = useState("");
  const previewFile = file || referenceFile;
  useEffect(() => {
    if (!previewFile) {
      setUrl("");
      return;
    }
    const next = URL.createObjectURL(previewFile);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [previewFile]);
  return (
    <div className="sample-photo-picker">
      <label className="field-stack">
        <span>
          Sample photo for extraction (only use if want to extract values from
          an image)
        </span>
        <span className="sample-photo-choose">
          <input
            type="file"
            aria-label="Sample photo for extraction (only use if want to extract values from an image)"
            accept="image/png,image/jpeg,image/webp"
            onChange={(event) => {
              const next = event.target.files?.[0];
              if (next) onFile(next);
              event.target.value = "";
            }}
          />
          <span>{file ? file.name : "Choose image for value extraction"}</span>
        </span>
      </label>
      {url && (
        <img
          className="sample-photo-thumbnail"
          src={url}
          alt={
            file
              ? `Sample photo: ${file.name}`
              : "Reference image from original PDF"
          }
        />
      )}
      {!file && referenceFile && (
        <p className="template-help">
          Reference from this image box in the original PDF. Choose a photo
          above to replace it.
        </p>
      )}
    </div>
  );
}

export type Region = { x: number; y: number; width: number; height: number };
export type PageBox = Region & { page: number };
export type FieldKind =
  | "text"
  | "textarea"
  | "number"
  | "date"
  | "time"
  | "checkbox"
  | "select"
  | "image"
  | "calculated";
export type TemplateField = PageBox & {
  id: string;
  label: string;
  kind: FieldKind;
  role: "company" | "report_date" | null;
  required: boolean;
  font: string;
  font_size: number;
  color: string;
  alignment: "left" | "center" | "right";
  options: string[];
  image_fit?: "contain" | "cover";
  calculation: {
    operation: "sum" | "difference" | "percentage";
    fields: string[];
  } | null;
  suggested_value: string;
  default_value?: string | boolean;
};
export type ClearArea = PageBox & { id: string; color: string };
export type OcrMapping = {
  image_field: string;
  photo_label: string;
  qualifier: string;
  target_field: string;
  region: Region;
};
export type Extraction = {
  id: string;
  image_field: string;
  name: string;
  region: Region;
  target_field: string | null;
};
export type Definition = {
  version: 1;
  pages: { width: number; height: number }[];
  fields: TemplateField[];
  clear_areas: ClearArea[];
  ocr_mappings: OcrMapping[];
  extractions: Extraction[];
};
export type TemplateSummary = {
  id: string;
  title: string;
  page_count: number;
  field_count: number;
  created_at: string;
  archived?: boolean;
  source_format?: "pdf" | "docx";
  source_filename?: string;
};
export type TemplateDetail = TemplateSummary & {
  definition: Definition;
  revision_id: string;
  revision_number: number;
};
export type Rectangle = Region & {
  id: string;
  image_field?: string | null;
  page?: number | null;
  kind?: "rectangle" | "tick";
  color: string;
  stroke_width: number;
};
export type TemplateReport = {
  title: string;
  values: Record<string, string | boolean>;
  layout: Record<string, PageBox>;
  styles: Record<string, FieldStyle>;
  rectangles: Rectangle[];
  readings_confirmed: Record<string, boolean>;
  extractions: Extraction[];
  extraction_values: Record<string, string>;
};
export type FieldStyle = {
  font?: string | null;
  font_size?: number | null;
  color?: string | null;
  alignment?: "left" | "center" | "right" | null;
};
export type FieldLayers = {
  pdf: string | null;
  fields: string[];
  definition?: Definition;
};
export type CustomDraftSummary = {
  id: string;
  title: string;
  company: string;
  report_date: string;
  created_at: string;
  updated_at: string;
};
export type CustomDraftDetail = CustomDraftSummary & {
  revision_id: string;
  form: TemplateReport;
  images: { field_id: string; filename: string; media_type: string }[];
};
export function templateDefaults(definition?: Definition): TemplateReport["values"] {
  return Object.fromEntries((definition?.fields || [])
    .filter((field) => !["image", "calculated"].includes(field.kind) &&
      field.default_value !== undefined && field.default_value !== "")
    .map((field) => [field.id, field.default_value!]));
}

export const emptyReport = (definition?: Definition): TemplateReport => ({
  title: "",
  values: templateDefaults(definition),
  layout: {},
  styles: {},
  rectangles: [],
  readings_confirmed: {},
  extractions: [],
  extraction_values: {},
});

export function templateApiBase(): string {
  // An explicitly empty value selects same-origin /api routes on Cloudflare.
  const configured = process.env.NEXT_PUBLIC_TEMPLATE_API_BASE_URL;
  if (configured !== undefined) return configured.replace(/\/$/, "");
  // Local HTTPS gateway routes both UI and API through one trusted origin.
  if (window.location.protocol === "https:") return window.location.origin;
  return (
    `${window.location.protocol}//${window.location.hostname}:8001`
  );
}

export async function templateRequest(
  path: string,
  init?: RequestInit,
): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(`${templateApiBase()}${path}`, init);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError")
      throw error;
    throw new Error(
      "Cannot reach the template service. Check your connection and sign-in, then retry. For local development, check Docker Compose and port 8001.",
    );
  }
  if (!response.ok) {
    if (response.status === 401 || response.status === 403)
      throw new Error("Your session expired or access was denied. Reload the page to sign in again.");
    const problem = (await response.json().catch(() => null)) as {
      detail?: string | { msg: string }[];
    } | null;
    const detail = problem?.detail;
    throw new Error(
      typeof detail === "string"
        ? detail
        : Array.isArray(detail)
          ? detail.map((item: { msg: string }) => item.msg).join("; ")
          : `Request failed (${response.status})`,
    );
  }
  return response;
}

export async function templateJson<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const response = await templateRequest(path, init);
  return response.status === 204
    ? (undefined as T)
    : (response.json() as Promise<T>);
}

export function reportPayload(
  report: TemplateReport,
  images: Record<string, File>,
  revisionId?: string,
): FormData {
  const payload = new FormData();
  payload.append("report_json", JSON.stringify(report));
  if (revisionId) payload.append("revision_id", revisionId);
  payload.append("image_fields", JSON.stringify(Object.keys(images)));
  for (const file of Object.values(images)) payload.append("images", file);
  return payload;
}

export function calculateValues(
  definition: Definition,
  values: TemplateReport["values"],
): TemplateReport["values"] {
  values = { ...templateDefaults(definition), ...values };
  const result = { ...values };
  for (const field of definition.fields) {
    if (field.kind !== "calculated" || !field.calculation) continue;
    const { fields, operation } = field.calculation;
    const source = fields.map((id) => values[id]);
    if (
      source.some(
        (value) =>
          value === undefined ||
          value === "" ||
          !Number.isFinite(Number(value)),
      )
    ) {
      result[field.id] = "";
      continue;
    }
    const numbers = source.map(Number);
    const value =
      operation === "sum"
        ? numbers.reduce((a, b) => a + b, 0)
        : operation === "difference"
          ? numbers[0] - numbers[1]
          : numbers[1] === 0
            ? null
            : (numbers[0] / numbers[1]) * 100;
    result[field.id] =
      value === null || !Number.isFinite(value)
        ? ""
        : `${Number(value.toFixed(2))}${operation === "percentage" ? "%" : ""}`;
  }
  return result;
}

export async function prepareImage(file: File): Promise<File> {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, 2048 / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size <= 12 * 1024 * 1024) return file;
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Could not prepare image");
    context.fillStyle = "white";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (image) =>
          image ? resolve(image) : reject(new Error("Could not resize image")),
        "image/jpeg",
        0.9,
      ),
    );
    if (blob.size > 12 * 1024 * 1024)
      throw new Error("Image exceeds 12 MB after resizing");
    return new File([blob], `${file.name.replace(/\.[^.]+$/, "")}.jpg`, {
      type: "image/jpeg",
    });
  } finally {
    bitmap.close();
  }
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

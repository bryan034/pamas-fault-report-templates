export type DraftSummary = {
  id: string;
  title: string;
  company: string;
  report_date: string;
  created_at: string;
  updated_at: string;
  has_equipment_image: boolean;
  has_infrared_image: boolean;
};

export type DraftDetail = DraftSummary & {
  form: Record<string, unknown>;
  equipment_filename: string | null;
  infrared_filename: string | null;
};

export function apiBase(): string {
  if (process.env.NEXT_PUBLIC_API_BASE_URL) return process.env.NEXT_PUBLIC_API_BASE_URL;
  return `${window.location.protocol}//${window.location.hostname}:8000`;
}

export async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${apiBase()}${path}`, init);
  } catch {
    throw new Error(`Cannot connect to the fault-report service at ${apiBase()}. Check that Docker Compose is running and port 8000 is reachable.`);
  }
  if (!response.ok) {
    const error = await response.json().catch(() => null) as { detail?: string } | null;
    throw new Error(typeof error?.detail === "string" ? error.detail : `Request failed (${response.status})`);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export async function migrateBrowserDrafts(): Promise<void> {
  if (localStorage.getItem("fault-report-drafts-migrated") === "1") return;
  let old: unknown = [];
  try { old = JSON.parse(localStorage.getItem("fault-report-drafts") ?? "[]") as unknown; }
  catch { /* Leave an unreadable old store untouched. */ }
  const drafts = Array.isArray(old) ? old.filter((item) => item && typeof item === "object" && item.form && item.id && item.saved_at) : [];
  const single = localStorage.getItem("fault-report-draft");
  if (single) {
    try {
      const form = JSON.parse(single) as Record<string, unknown>;
      if (form && typeof form === "object") drafts.push({ id: crypto.randomUUID(), saved_at: new Date().toISOString(), form });
    } catch { /* Ignore unreadable legacy storage. */ }
  }
  if (drafts.length) {
    await apiJson("/api/drafts/import", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ drafts }),
    });
  }
  localStorage.setItem("fault-report-drafts-migrated", "1");
}

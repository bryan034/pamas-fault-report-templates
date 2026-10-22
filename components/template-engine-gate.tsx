"use client";
import { useEffect, useState, type ReactNode } from "react";
import { templateJson, type TemplateDetail } from "@/lib/template-api";
import { useApplicationAccess } from "@/components/application-access";

/** Open the field-box editor while preserving saved Word-template recovery. */
export default function TemplateEngineGate({ templateId, draftId, children }: {
  templateId: string; draftId?: string | null; editTemplate?: boolean; children: ReactNode;
}) {
  const [kind, setKind] = useState<string | null>(null), [error, setError] = useState("");
  const { canEdit } = useApplicationAccess();
  useEffect(() => {
    let cancelled = false;
    void templateJson<TemplateDetail>(`/api/templates/${templateId}${draftId ? `?draft_id=${draftId}` : ""}`)
      .then(async template => {
        if (template.editor_kind === "native-docx") {
          if (!canEdit) throw new Error("An editor must restore this Word template to the field-box workflow first.");
          await templateJson(`/api/templates/${templateId}/restore-overlay`, { method: "POST" });
        }
        if (!cancelled) setKind("pdf");
      })
      .catch(cause => { if (!cancelled) setError(cause instanceof Error ? cause.message : "Could not open template"); });
    return () => { cancelled = true; };
  }, [templateId, draftId, canEdit]);
  if (error) return <p role="alert" className="list-state">{error}</p>;
  if (!kind) return <p className="list-state">Opening document…</p>;
  return children;
}

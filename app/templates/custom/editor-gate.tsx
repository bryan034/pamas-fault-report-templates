"use client";
import dynamic from "next/dynamic";
import { useApplicationAccess } from "@/components/application-access";
import ReadOnlyReport from "./read-only-report";
import TemplateEngineGate from "@/components/template-engine-gate";
const Editor = dynamic(() => import("./template-editor"), {
  ssr: false,
  loading: () => <p className="list-state">Opening report editor…</p>,
});
export default function EditorGate({
  templateId,
  draftId,
}: {
  templateId: string;
  draftId: string | null;
}) {
  const access = useApplicationAccess();
  if (access.loading) return <p className="list-state">Checking access…</p>;
  if (access.user?.role === "viewer" && draftId)
    return <TemplateEngineGate templateId={templateId} draftId={draftId}><ReadOnlyReport templateId={templateId} draftId={draftId} /></TemplateEngineGate>;
  if (!access.canEdit)
    return access.user?.role === "viewer" && draftId ? (
      <ReadOnlyReport templateId={templateId} draftId={draftId} />
    ) : (
      <p role="alert" className="list-state">
        {access.error || "Editor access is required to create a report."}
      </p>
    );
  return <TemplateEngineGate templateId={templateId} draftId={draftId}><Editor templateId={templateId} draftId={draftId} /></TemplateEngineGate>;
}

"use client";
import dynamic from "next/dynamic";
import TemplateEngineGate from "@/components/template-engine-gate";
import { useApplicationAccess } from "@/components/application-access";
const Builder = dynamic(() => import("./template-builder"), {
  ssr: false,
  loading: () => <p className="list-state">Opening template builder…</p>,
});
export default function BuilderGate({ templateId }: { templateId?: string }) {
  const access = useApplicationAccess();
  if (access.loading) return <p className="list-state">Checking access…</p>;
  if (!access.canEdit)
    return (
      <p role="alert" className="list-state">
        {access.error || "Editor access is required to edit templates."}
      </p>
    );
  return templateId ? <TemplateEngineGate templateId={templateId} editTemplate><Builder templateId={templateId} /></TemplateEngineGate> : <Builder />;
}

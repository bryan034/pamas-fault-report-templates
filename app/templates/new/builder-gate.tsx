"use client";
import dynamic from "next/dynamic";
const Builder = dynamic(() => import("./template-builder"), {
  ssr: false,
  loading: () => <p className="list-state">Opening template builder…</p>,
});
export default function BuilderGate({ templateId }: { templateId: string }) {
  return <Builder templateId={templateId} />;
}

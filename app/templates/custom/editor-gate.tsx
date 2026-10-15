"use client";
import dynamic from "next/dynamic";
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
  return <Editor templateId={templateId} draftId={draftId} />;
}

import EditorGate from "../../../editor-gate";
export default async function DraftReport({
  params,
}: {
  params: Promise<{ id: string; draftId: string }>;
}) {
  const { id, draftId } = await params;
  return <EditorGate templateId={id} draftId={draftId} />;
}

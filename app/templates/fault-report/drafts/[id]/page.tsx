import EditorGate from "../../editor-gate";

export default async function DraftEditor({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <EditorGate draftId={id} />;
}

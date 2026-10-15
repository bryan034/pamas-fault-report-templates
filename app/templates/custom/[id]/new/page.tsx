import EditorGate from "../../editor-gate";
export default async function NewReport({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <EditorGate templateId={id} draftId={null} />;
}

import TemplateDraftLibrary from "../template-draft-library";
export default async function TemplatePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <TemplateDraftLibrary templateId={id} />;
}

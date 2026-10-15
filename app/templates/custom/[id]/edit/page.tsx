import BuilderGate from "../../../new/builder-gate";
export default async function EditTemplate({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <BuilderGate templateId={id} />;
}

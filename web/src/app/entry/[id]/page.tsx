import EntryView from "./EntryView";

export const dynamic = "force-dynamic";

export default async function EntryPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ t?: string }>;
}) {
  const { id } = await params;
  const { t } = await searchParams;
  const initialT = Number(t);
  return <EntryView id={id} initialT={Number.isFinite(initialT) ? initialT : 0} />;
}

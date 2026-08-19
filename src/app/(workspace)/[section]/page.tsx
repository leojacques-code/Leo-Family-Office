import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { isRoutedSection } from "@/lib/navigation";
import { getRepository } from "@/lib/data/repository";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function SectionPage({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  if (!isRoutedSection(section)) notFound();
  const repository = await getRepository();
  return <AppShell initialState={await repository.getDashboardState()} section={section} />;
}

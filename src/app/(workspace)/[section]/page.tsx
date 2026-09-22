import { getPersonalSetupRepository } from "@/lib/data/personal-setup-repository";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { isRoutedSection } from "@/lib/navigation";
import { getRepository } from "@/lib/data/repository";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function SectionPage({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  if (!isRoutedSection(section)) notFound();
  const [repository, personalSetup] = await Promise.all([
    getRepository(),
    getPersonalSetupRepository().then((repository) => repository.read()),
  ]);
  if (section === "debt") {
    return (
      <AppShell
        section={section}
        personalSetup={personalSetup}
        source={{ kind: "DEBT", model: await repository.getDebtReadModel() }}
      />
    );
  }
  return (
    <AppShell
      section={section}
      personalSetup={personalSetup}
      source={{ kind: "SECTION", state: await repository.getDashboardState() }}
    />
  );
}

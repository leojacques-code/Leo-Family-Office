import { operationalToday } from "@/lib/financial-date";
import { setupReturnTo } from "@/lib/personal-setup-navigation";
import { redirect } from "next/navigation";
import { getPersonalSetupRepository } from "@/lib/data/personal-setup-repository";
import { PersonalSetupForm } from "@/components/personal-setup-form";
export const dynamic = "force-dynamic";
export default async function SetupPage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string; next?: string }>;
}) {
  const initial = await (await getPersonalSetupRepository()).read();
  const query = await searchParams;
  const returnTo = setupReturnTo(query.next);
  if (
    initial.firstIntent !== null &&
    initial.residenceCountry !== null &&
    initial.contextDate !== null &&
    query.edit !== "1"
  )
    redirect(returnTo);
  return (
    <main className="personal-setup-page">
      <header>
        <span className="eyebrow">Mon espace</span>
        <h1>Commençons par vous.</h1>
        <p>Nommez votre espace, précisez votre contexte et choisissez votre première page.</p>
      </header>
      <PersonalSetupForm initial={initial} returnTo={returnTo} today={operationalToday()} />
    </main>
  );
}

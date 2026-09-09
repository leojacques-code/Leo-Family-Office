import { AppShell } from "@/components/app-shell";
import { DEFAULT_SECTION } from "@/lib/navigation";
import { getTodayReadModel } from "@/lib/data/read-models/today";

/**
 * Route racine : Aujourd'hui.
 *
 * Elle appelle `getTodayReadModel()` et NON `getRepository().getDashboardState()`. C'est le
 * §10.2 du plan de refonte, appliqué à la première page : « remplacer `getDashboardState()`
 * comme source de chaque page par des modèles de lecture ciblés ». La mesure technique du §13
 * en dépend — « chaque route ne charge que son modèle de lecture » — et elle n'était tenable
 * par aucune discipline tant que la route servait l'état entier.
 *
 * Les treize autres routes passent encore par `/[section]` et l'état global, jusqu'à leur
 * propre phase.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function TodayRoute() {
  return (
    <AppShell
      section={DEFAULT_SECTION}
      source={{ kind: "TODAY", model: await getTodayReadModel() }}
    />
  );
}

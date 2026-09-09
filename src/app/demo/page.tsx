import { DemoWorkspace } from "@/components/demo-workspace";
import { getDemoTodayReadModel } from "@/lib/data/read-models/today-demo";
import { operationalToday } from "@/lib/financial-date";

/**
 * Route de démonstration (§19.3 : « le login doit proposer un espace de démonstration en
 * lecture seule »).
 *
 * ELLE EST PUBLIQUE, ET C'EST DÉLIBÉRÉ. Le §19.3 la veut atteignable depuis l'écran de
 * connexion, donc sans session. C'est le seul élargissement de la surface publique de cette
 * phase, et il est défendable pour une raison structurelle plutôt que par une promesse : cette
 * route n'appelle QUE `getDemoTodayReadModel`, dont le module n'importe ni `getRepository`, ni
 * le client Supabase, ni la lecture d'état. Il n'existe aucun chemin depuis ici vers une
 * donnée réelle, et un test le vérifie sur les imports du module.
 *
 * LA DATE EST OPÉRATIONNELLE, pas figée : le constat 5.1 du plan est qu'« la date financière
 * est codée en dur », et une démonstration arrêtée à une date fixe rejouerait ce défaut — ses
 * échéances à trente jours seraient vides dès le mois suivant.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function DemoRoute() {
  return <DemoWorkspace model={getDemoTodayReadModel(operationalToday())} />;
}

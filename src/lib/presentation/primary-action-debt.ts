import { PAGE_REGISTRY } from "@/lib/presentation/registry/pages";

/**
 * Dette de zone A : les actions primaires déclarées que le produit ne sert pas encore.
 *
 * Le §17 place dans l'en-tête « une action primaire maximum », et treize manifestes sur
 * quatorze en portent le libellé depuis la phase 0. Toutes ne sont pas SERVIES : « Importer un
 * échéancier » n'a pas d'implémentation avant la phase 3, « Ajouter un document fiscal » avant
 * la phase 7. Rendre le bouton quand même produirait un contrôle inerte, qui se présente comme
 * un chemin praticable et n'en est pas un.
 *
 * Les remonter toutes exigerait de construire quatorze formulaires dans la PR du shell, ce que
 * le §11 refuse comme « grande PR de redesign transversal » et le §14 comme « refaire toutes
 * les pages dans une seule PR ». La dette est donc MESURÉE et PLAFONNÉE, comme le plancher
 * typographique des pages : c'est le même arbitrage, pour la même raison.
 *
 * CE FICHIER NE SAIT PAS QUELLES PAGES SERVENT LEUR ACTION. Il ne peut pas le savoir : le
 * branchement est un appel de hook dans un composant, et le lire depuis un module de données
 * demanderait d'analyser du TSX. La liste des pages servies est donc DÉCLARÉE ici, et le test
 * qui l'accompagne vérifie qu'elle correspond aux appels réellement présents dans les pages —
 * en LISANT les fichiers. Une page câblée sans être déclarée, ou déclarée sans être câblée,
 * fait échouer le gate.
 */

/**
 * Pages dont l'action primaire déclarée est réellement servie.
 *
 * Chacune ouvre le formulaire que la page possédait DÉJÀ : la phase 1 branche l'en-tête sur
 * l'existant, elle ne construit aucun formulaire. Une page n'entre ici que si son formulaire
 * répond à l'intention du libellé du manifeste — « Créer un objectif » sur un formulaire
 * d'objectif, et non « Ajouter un actif ou un passif » sur un formulaire qui n'ajoute qu'un
 * compte, ni « Importer un échéancier » sur un formulaire de saisie de dette.
 */
export const PAGES_SERVING_PRIMARY_ACTION: readonly string[] = [
  "debt",
  "goals",
  "scenarios",
  "business-equity",
  "cash-flow",
];

/**
 * Plafond de la dette : nombre de pages qui DÉCLARENT une action primaire sans la servir.
 *
 * Le test échoue DANS LES DEUX SENS. Une page qui déclare une action de plus sans la brancher
 * dépasse le plafond ; une page branchée demande d'abaisser la constante. Chaque phase de
 * domaine solde la sienne : phase 3 pour Dette, 4 pour Patrimoine, 5 pour Placements, 6 pour
 * Immobilier, 7 pour Carrière et Fiscalité, 9 pour Décisions, 10 pour Sources et Rapports.
 */
export const PRIMARY_ACTION_DEBT = 8;

export interface PrimaryActionFinding {
  readonly page: string;
  readonly label: string;
}

/** Pages qui déclarent une action primaire et ne la servent pas, dans l'ordre du registre. */
export function unservedPrimaryActions(
  served: readonly string[] = PAGES_SERVING_PRIMARY_ACTION,
): PrimaryActionFinding[] {
  const findings: PrimaryActionFinding[] = [];
  for (const [id, manifest] of Object.entries(PAGE_REGISTRY)) {
    if (!manifest.primaryAction) continue;
    if (served.includes(id)) continue;
    findings.push({ page: id, label: manifest.primaryAction });
  }
  return findings;
}

import type {
  PageManifest,
  PageSourceDeclaration,
  SourceEvidence,
} from "@/lib/presentation/registry/contracts";
import type { DashboardState } from "@/lib/types";

/**
 * Zone B, côté données : ce que la page DÉCLARE devient ce que le rail MONTRE.
 *
 * Le §17 du plan de refonte demande que chaque source du rail affiche son état et sa
 * fraîcheur. Or une page ne peut pas déclarer cet état : il dépend de ce que l'utilisateur a
 * réellement fourni. Le manifeste déclare donc la PERTINENCE d'une source (section 16 :
 * « aucune composition laissée à l'arbitrage de l'IA »), et ce module lit son état dans les
 * faits.
 *
 * SOURCE PERTINENTE ≠ SOURCE DÉTENUE. Écrire l'état dans le manifeste aurait affirmé qu'un
 * échéancier est fourni sans l'avoir vérifié : le rail aurait annoncé « À jour » sur une dette
 * saisie à la main, ou « À fournir » sur une comptabilité déjà importée.
 *
 * CE MODULE NE CALCULE AUCUNE FINANCE. Il ne lit que des PRÉSENCES et des DATES déjà portées
 * par les faits. Aucun montant n'y est additionné, converti ni comparé, et il ne consulte
 * aucun moteur.
 */

/** Ce que le rail sait rendre. Repris de `SourceStatus` du composant, sans le dupliquer. */
export type RailSourceStatus = "ACTIVE" | "ABSENTE";

export interface DerivedRailSource {
  readonly id: string;
  readonly category: PageSourceDeclaration["category"];
  readonly name: string;
  readonly status: RailSourceStatus;
  /** Date la plus récente portée par les faits de cette source. `null` si aucune. */
  readonly latestDate: string | null;
}

/**
 * `A_RENOUVELER` n'est JAMAIS émis par cette phase, et ce n'est pas un oubli.
 *
 * Décider qu'une source est « à actualiser » suppose un seuil de fraîcheur — trois mois pour
 * un relevé, deux ans pour une valorisation ? La section 16 interdit précisément à un agent de
 * décider « si une anomalie est assez importante pour alerter », et la section 40 range la
 * fraîcheur parmi les couches transversales dont les règles restent versionnées et sourcées.
 * Le plan ne donne aucun seuil : en inventer un ferait clignoter le rail sur une convention que
 * personne n'a écrite.
 *
 * La date est donc AFFICHÉE et l'utilisateur juge. Le jour où un seuil sera déclaré, il
 * viendra d'un registre daté, pas d'une constante posée ici.
 */
export const RENEWAL_THRESHOLD_IS_UNDECLARED = true;

/**
 * Lit une famille de faits comme une LISTE, quoi qu'elle contienne réellement.
 *
 * Le type de `DashboardState` déclare plusieurs de ces tableaux comme obligatoires, mais
 * l'état réellement construit ne les porte pas toujours : anciens fixtures, états partiels de
 * test, et demain une lecture ciblée qui ne chargerait qu'une partie du domaine. FAMILLE
 * ABSENTE ≠ FAMILLE VIDE du point de vue du type, mais les deux se rendent de la même façon
 * dans le rail : « À fournir ». Faire confiance au type ici casserait la page entière sur une
 * absence, là où la question posée — « cette source existe-t-elle ? » — a une réponse.
 */
function listOf<T>(value: readonly T[] | undefined | null): readonly T[] {
  return Array.isArray(value) ? value : [];
}

/** Retourne la plus récente de deux dates ISO, en tolérant les absences. */
function latest(a: string | null, b: string | null | undefined): string | null {
  if (!b) return a;
  if (!a) return b;
  return b > a ? b : a;
}

function maxDate(values: readonly (string | null | undefined)[]): string | null {
  let out: string | null = null;
  for (const value of values) out = latest(out, value);
  return out;
}

/**
 * Répond, pour une famille de faits, aux deux seules questions du rail : y en a-t-il, et de
 * quand date le plus récent ?
 *
 * Une famille absente de l'état rend `count: 0`, jamais une erreur : les champs optionnels de
 * `DashboardState` sont absents dans d'anciens fixtures, et un rail qui lèverait sur cette
 * absence casserait la page au lieu de dire « À fournir ».
 */
function readEvidence(
  evidence: SourceEvidence,
  state: DashboardState,
): { count: number; latestDate: string | null } {
  switch (evidence) {
    case "BANK_ACCOUNTS":
      return {
        count: listOf(state.accounts).length,
        latestDate: maxDate(listOf(state.accountBalanceHistory).map((o) => o.balanceDate)),
      };
    case "BANK_TRANSACTIONS":
      return {
        count: listOf(state.transactions).length,
        latestDate: maxDate(listOf(state.transactions).map((t) => t.date)),
      };
    case "LIABILITIES":
      return {
        count: listOf(state.liabilities).length,
        latestDate: maxDate(listOf(state.liabilities).map((l) => l.balanceDate)),
      };
    case "LIABILITY_PROVIDED_SCHEDULE": {
      // La dette porte son échéancier fourni : la source existe dès qu'UNE dette en a un.
      // Compter les dettes plutôt que les lignes dirait « À jour » pour un échéancier vide.
      const withSchedule = listOf(state.liabilities).filter((l) => l.providedSchedule.length > 0);
      return {
        count: withSchedule.length,
        latestDate: maxDate(
          withSchedule.flatMap((l) => l.providedSchedule.map((entry) => entry.dueDate)),
        ),
      };
    }
    case "POSITIONS":
      // Une position n'a pas de date propre : elle est datée par l'observation d'enveloppe,
      // qui appartient au domaine Placements. Aucune date n'est donc inventée ici.
      return { count: listOf(state.positions).length, latestDate: null };
    case "PORTFOLIO_EVENTS":
      return {
        count: listOf(state.portfolioEvents).length,
        latestDate: maxDate(listOf(state.portfolioEvents).map((e) => e.eventDate)),
      };
    case "REAL_ESTATE_ASSETS":
      return { count: listOf(state.realEstateAssets).length, latestDate: null };
    case "REAL_ESTATE_VALUATIONS":
      return {
        count: listOf(state.realEstateValuations).length,
        latestDate: maxDate(listOf(state.realEstateValuations).map((v) => v.valuedAt)),
      };
    case "REAL_ESTATE_OPERATING_TERMS":
      return {
        count: listOf(state.realEstateOperatingTerms).length,
        latestDate: maxDate(listOf(state.realEstateOperatingTerms).map((t) => t.effectiveFrom)),
      };
    case "BUSINESS_ENTITIES":
      return { count: listOf(state.businesses).length, latestDate: null };
    case "BUSINESS_FINANCIALS": {
      const financials = listOf(state.businessFinancials);
      return { count: financials.length, latestDate: maxDate(financials.map((f) => f.periodEnd)) };
    }
    case "CAREER_ROLES":
      return { count: listOf(state.careerRoles).length, latestDate: null };
    case "CAREER_COMPENSATION": {
      const terms = listOf(state.careerCompensationTerms);
      return { count: terms.length, latestDate: maxDate(terms.map((t) => t.effectiveFrom)) };
    }
    case "TAX_OBSERVATIONS": {
      const observations = listOf(state.taxObservations);
      return {
        count: observations.length,
        latestDate: maxDate(observations.map((o) => o.observedDate)),
      };
    }
    case "TAX_RULE_SETS":
      return { count: listOf(state.taxRuleSets).length, latestDate: null };
    case "DOCUMENTS":
      return {
        count: listOf(state.documents).length,
        latestDate: maxDate(listOf(state.documents).map((d) => d.uploadedAt)),
      };
    case "GOALS":
      return { count: listOf(state.goals).length, latestDate: null };
    case "SCENARIOS":
      return { count: listOf(state.scenarios).length, latestDate: null };
    case "DECISION_CASES":
      return { count: listOf(state.decisionCases).length, latestDate: null };
    case "RECURRING_RULES":
      return {
        count: listOf(state.recurringRules).length,
        latestDate: maxDate(listOf(state.recurringRules).map((r) => r.startDate)),
      };
    case "MONTHLY_CLOSES":
      return {
        count: listOf(state.monthlyCloses).length,
        latestDate: maxDate(listOf(state.monthlyCloses).map((c) => c.closeDate)),
      };
  }
}

/**
 * Les sources du rail d'une page, dans l'ordre du manifeste.
 *
 * Rend un tableau VIDE quand la page ne déclare pas la zone `SOURCE_RAIL`, même si des sources
 * traînaient dans son manifeste : une zone absente du manifeste est volontairement absente, et
 * le composant ne rend rien d'un rail vide — un rail affichant « aucune source » ferait
 * exactement la carte vide que le §6 de V10 refuse.
 */
export function railSourcesFor(
  manifest: PageManifest | null,
  state: DashboardState,
): DerivedRailSource[] {
  if (!manifest) return [];
  if (!manifest.zones.includes("SOURCE_RAIL")) return [];
  return listOf(manifest.sources).map((declaration) => {
    const { count, latestDate } = readEvidence(declaration.evidence, state);
    return {
      id: declaration.id,
      category: declaration.category,
      name: declaration.name,
      status: count > 0 ? "ACTIVE" : "ABSENTE",
      latestDate,
    };
  });
}

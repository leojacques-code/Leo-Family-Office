import { createGoalVersion } from "@/lib/engine/goal-engine";
import type { DomainDeclaration } from "@/lib/presentation/today/contracts";
import { buildTodayView } from "@/lib/presentation/today/view";
import type {
  DashboardState,
  ExpenseCategory,
  FinancialAccount,
  Liability,
  MonthlyClose,
  Provenance,
  Transaction,
} from "@/lib/types";
import { todayViewInputFrom } from "./today";

/**
 * Espace de démonstration d'Aujourd'hui (§19.3).
 *
 * PÉRIMÈTRE ARBITRÉ, ET IL EST PLUS ÉTROIT QUE LE §19.3. Le §19.3 demande une démonstration
 * couvrant banques, enveloppes, dette avec échéancier, deux biens, une société, carrière,
 * fiscalité, objectifs, scénarios, décisions et rapports. Dix domaines, dont huit appartiennent
 * aux phases 3 à 10 du §37 : leur fixture serait rendue par des pages encore pré-V10, c'est-à-
 * dire par la grammaire de cartes que la refonte supprime. Le propriétaire du produit a donc
 * arbitré une démonstration CADRÉE sur les surfaces de cette phase — cockpit, boîte de
 * réception, parcours d'installation — et l'écart au §19.3 est écrit dans le dossier de phase
 * plutôt que passé sous silence.
 *
 * AUCUNE LECTURE DU DÉPÔT N'EST POSSIBLE DEPUIS CE MODULE. Il n'importe ni `getRepository`, ni
 * le client Supabase, ni `today.ts`'s `getTodayReadModel` — seulement `todayViewInputFrom`, qui
 * est une fonction pure prenant un état en paramètre. C'est ce qui rend la route publique
 * défendable : la seule façon d'y servir une donnée réelle serait de lui en passer une, et
 * aucun chemin de ce fichier ne va la chercher.
 *
 * AUCUNE DONNÉE PERSONNELLE. Les montants sont ronds et arbitraires, les libellés génériques,
 * les identifiants des UUID de démonstration reconnaissables. Le §19.3 le pose comme exigence
 * — « aucune donnée personnelle réelle » — et un test le vérifie sur les chaînes rendues.
 *
 * LES DATES SONT RELATIVES, JAMAIS FIGÉES. Le constat 5.1 du plan est qu'« la date financière
 * est codée en dur » : une démonstration arrêtée au 8 septembre 2026 rejouerait ce défaut, et
 * ses « échéances à trente jours » seraient vides dès le mois suivant. Tout est donc décalé
 * depuis la date opérationnelle reçue en paramètre.
 */

const DEMO_PROVENANCE: Provenance = {
  kind: "ACTUAL",
  source: "Jeu de démonstration LFO",
  confidence: "HIGH",
};

/** Décale une date ISO d'un nombre de jours, sans dépendre du fuseau local. */
function shift(iso: string, days: number): string {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(Date.UTC(year!, month! - 1, day!) + days * 86_400_000).toISOString().slice(0, 10);
}

/** Premier jour du mois d'une date ISO. */
function monthStart(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}

/** Dernier jour du mois précédant celui d'une date ISO. */
function previousMonthEnd(iso: string): string {
  return shift(monthStart(iso), -1);
}

const CATEGORIES: readonly Omit<ExpenseCategory, "provenance">[] = [
  {
    id: "demo-cat-salaire",
    name: "Salaire",
    groupName: "Revenus",
    cashFlowKind: "INCOME",
    essentiality: "UNKNOWN",
    behavior: "FIXED",
    monthlyAmount: null,
    essential: false,
    archived: false,
  },
  {
    id: "demo-cat-loyer",
    name: "Loyer",
    groupName: "Logement",
    cashFlowKind: "EXPENSE",
    essentiality: "ESSENTIAL",
    behavior: "FIXED",
    monthlyAmount: 1_100,
    essential: true,
    archived: false,
  },
  {
    id: "demo-cat-courses",
    name: "Alimentation",
    groupName: "Vie courante",
    cashFlowKind: "EXPENSE",
    essentiality: "ESSENTIAL",
    behavior: "VARIABLE",
    monthlyAmount: 420,
    essential: true,
    archived: false,
  },
  {
    id: "demo-cat-loisirs",
    name: "Loisirs",
    groupName: "Vie courante",
    cashFlowKind: "EXPENSE",
    essentiality: "NON_ESSENTIAL",
    behavior: "DISCRETIONARY",
    monthlyAmount: 180,
    essential: false,
    archived: false,
  },
  {
    id: "demo-cat-credit",
    name: "Échéance de prêt",
    groupName: "Dette",
    cashFlowKind: "DEBT_SERVICE",
    essentiality: "ESSENTIAL",
    behavior: "FIXED",
    monthlyAmount: 296,
    essential: true,
    archived: false,
  },
];

function accounts(today: string): FinancialAccount[] {
  return [
    {
      id: "demo-acc-courant",
      institutionId: "demo-inst-banque",
      institution: "Banque de démonstration",
      name: "Compte courant",
      type: "BANK",
      currency: "EUR",
      balance: 4_820,
      balanceDate: today,
      liquidity: "IMMEDIATE",
      provenance: DEMO_PROVENANCE,
    },
    {
      id: "demo-acc-livret",
      institutionId: "demo-inst-banque",
      institution: "Banque de démonstration",
      name: "Livret",
      type: "SAVINGS",
      currency: "EUR",
      balance: 12_500,
      balanceDate: today,
      liquidity: "IMMEDIATE",
      provenance: DEMO_PROVENANCE,
    },
    {
      id: "demo-acc-pea",
      institutionId: "demo-inst-courtier",
      institution: "Courtier de démonstration",
      name: "PEA",
      type: "PEA",
      currency: "EUR",
      balance: 31_400,
      balanceDate: today,
      // Le cash d'une enveloppe n'est PAS du cash immédiat : c'est l'invariant
      // LIQUIDITÉ ≠ PATRIMOINE NET, et la démonstration le montre plutôt que de l'expliquer.
      liquidity: "LIQUID",
      provenance: DEMO_PROVENANCE,
    },
  ];
}

/**
 * Une dette avec son échéancier FOURNI, sur les douze prochains mois.
 *
 * L'échéancier fourni est ce qui alimente la ligne « Échéancier » du rail et les échéances à
 * trente jours. Sans lui, la source resterait « À fournir » et la démonstration ne montrerait
 * pas ce que le produit fait d'un contrat réel.
 */
function liabilities(today: string): Liability[] {
  const firstPayment = shift(monthStart(today), 4);
  return [
    {
      id: "demo-liab-conso",
      name: "Prêt personnel",
      lender: "Banque de démonstration",
      principal: 14_000,
      currentBalance: 9_260,
      currency: "EUR",
      balanceDate: today,
      annualRate: 0.031,
      monthlyPayment: 296,
      paymentCount: 60,
      firstPaymentDate: shift(firstPayment, -365 * 2),
      maturityDate: shift(firstPayment, 365 * 3),
      monthlyInsurance: 9,
      recurringFees: null,
      paymentIncludesInsurance: false,
      deferral: null,
      amortisationProfile: "AMORTIZING",
      balloonAmount: null,
      paymentFrequency: "MONTHLY",
      interestConvention: "PROPORTIONAL",
      rateType: "FIXED",
      rateSchedule: [],
      paymentSchedule: [],
      earlyRepayments: [],
      oneOffCharges: [],
      // L'échéancier FOURNI l'emporte sur un échéancier reconstruit pour l'affichage des
      // sorties contractuelles : c'est la règle du §8 de V9, et la démonstration s'y tient.
      // Les soldes s'enchaînent (`closingBalance` d'une ligne = `openingBalance` de la
      // suivante), sans quoi le moteur signalerait une divergence que rien ne justifierait.
      providedSchedule: Array.from({ length: 12 }, (_, index) => {
        const opening = 9_260 - index * 251;
        const principal = 251;
        return {
          paymentNumber: index + 1,
          dueDate: shift(firstPayment, index * 30),
          openingBalance: opening,
          interest: 45,
          principal,
          insurance: 9,
          fees: 0,
          closingBalance: opening - principal,
        };
      }),
      facilityId: null,
      provenance: DEMO_PROVENANCE,
    },
  ];
}

/**
 * Un mois d'opérations, dont UNE non classée.
 *
 * La non classée est délibérée : le §20 exige que le solde libre porte sa réserve quand des
 * flux échappent aux postes, et une démonstration où tout est propre ne montrerait jamais un
 * état PARTIEL. C'est aussi ce qui remplit la vue « À vérifier » de la boîte de réception.
 */
/**
 * Les opérations du mois en cours, TOUTES datées au plus tard à la date d'arrêté.
 *
 * Une opération bookée postérieure à l'arrêté n'existe pas : c'est un fait à venir, donc une
 * projection. La première version du jeu de démonstration les datait par décalage depuis le
 * début du mois sans borne, et trois opérations se retrouvaient dans le futur — la ligne
 * « Opérations » du rail annonçait alors une fraîcheur postérieure à aujourd'hui.
 */
function transactions(today: string): Transaction[] {
  const start = monthStart(today);
  const line = (
    id: string,
    dayOffset: number,
    label: string,
    categoryId: string,
    categoryName: string,
    amount: number,
  ): Transaction => ({
    id,
    accountId: "demo-acc-courant",
    accountName: "Compte courant",
    // La borne est la date d'arrêté : un décalage qui la dépasserait est ramené sur elle.
    date: (() => {
      const candidate = shift(start, dayOffset);
      return candidate > today ? today : candidate;
    })(),
    label,
    categoryId,
    categoryName,
    amount,
    currency: "EUR",
    kindOverride: null,
    transferGroupId: null,
    propertyId: null,
    notes: null,
    provenance: DEMO_PROVENANCE,
  });
  return [
    line("demo-tx-salaire", 1, "Virement de salaire", "demo-cat-salaire", "Salaire", 3_150),
    line("demo-tx-loyer", 2, "Loyer", "demo-cat-loyer", "Loyer", -1_100),
    line("demo-tx-courses-1", 4, "Supermarché", "demo-cat-courses", "Alimentation", -212),
    line("demo-tx-courses-2", 12, "Supermarché", "demo-cat-courses", "Alimentation", -196),
    line("demo-tx-loisirs", 9, "Cinéma", "demo-cat-loisirs", "Loisirs", -34),
    line("demo-tx-credit", 6, "Échéance de prêt", "demo-cat-credit", "Échéance de prêt", -305),
    // Sans catégorie : le Cash Flow Engine la compte comme non classée, et le solde libre
    // porte sa réserve. Une opération importée naît sans catégorie — c'est la règle de la
    // couche d'acquisition, et la démonstration la respecte.
    line("demo-tx-inconnue", 14, "Prélèvement à identifier", "", "", -128),
  ];
}

/**
 * Deux clôtures COMPARABLES, pour que l'évolution du §20 item 2 existe et porte ses causes.
 *
 * La composition est celle que `historical-closes.ts` sait nommer, et ses quatre champs sont
 * renseignés : `historicalBlockers` refuse toute comparaison dont la méthodologie, la devise ou
 * la complétude ne sont pas identiques et connues.
 */
function closes(today: string): MonthlyClose[] {
  const current = previousMonthEnd(today);
  const previous = previousMonthEnd(current);
  const close = (
    id: string,
    date: string,
    netWorth: number,
    composition: Record<string, number>,
  ): MonthlyClose => ({
    id,
    version: 1,
    reportingCurrency: "EUR",
    completenessStatus: "COMPLETE",
    composition: { ...composition, methodologyVersion: "CANONICAL_BALANCE_SHEET_V2" },
    closeDate: date,
    grossAssets: netWorth + 9_500,
    debt: 9_500,
    netWorth,
    forecastNetWorth: null,
    variance: null,
    createdAt: `${date}T12:00:00Z`,
  });
  return [
    close("demo-close-1", previous, 36_400, {
      immediate_cash: 15_900,
      market_invested_assets: 29_800,
      investment_envelope_cash: 200,
      illiquid_assets: 0,
    }),
    close("demo-close-2", current, 39_060, {
      immediate_cash: 17_320,
      market_invested_assets: 31_200,
      investment_envelope_cash: 200,
      illiquid_assets: 0,
    }),
  ];
}

/**
 * État de démonstration complet.
 *
 * `metrics` est un objet VIDE, et c'est volontaire : le modèle de lecture d'Aujourd'hui ne le
 * consulte pas — il prend ses agrégats du bilan canonique, comme le §10.3 le demande pour ne
 * créer aucun KPI depuis la seconde vérité de `deriveMetrics()`. Le remplir laisserait croire
 * que la page en dépend.
 */
export function buildDemoState(today: string): DashboardState {
  return {
    asOfDate: today,
    reportingCurrency: "EUR",
    ledgerCoverageStart: shift(today, -400),
    ledgerCoverageSource: "IMPORT",
    accounts: accounts(today),
    // L'historique de solde date la ligne « Banque » du rail. Sans lui, la source est active
    // mais sans date, et le §17 zone B demande « date de dernière mise à jour ».
    accountBalanceHistory: [
      {
        id: "demo-bal-courant",
        accountId: "demo-acc-courant",
        balance: 4_820,
        balanceDate: today,
        createdAt: `${today}T08:00:00Z`,
        provenance: DEMO_PROVENANCE,
      },
      {
        id: "demo-bal-livret",
        accountId: "demo-acc-livret",
        balance: 12_500,
        balanceDate: today,
        createdAt: `${today}T08:00:00Z`,
        provenance: DEMO_PROVENANCE,
      },
    ],
    positions: [],
    portfolioEvents: [],
    portfolioPolicies: [],
    realEstateAssets: [],
    realEstateValuations: [],
    realEstateCapitalEvents: [],
    realEstateOperatingTerms: [],
    realEstateFinancingLinks: [],
    liabilities: liabilities(today),
    incomes: [],
    expenseCategories: CATEGORIES.map((category) => ({
      ...category,
      provenance: DEMO_PROVENANCE,
    })),
    transactions: transactions(today),
    recurringRules: [],
    cashFlowCloses: [],
    scenarios: [],
    goals: [
      {
        id: "demo-goal-epargne",
        name: "Épargne de précaution",
        targetAmount: 20_000,
        targetDate: shift(today, 540),
        priority: 1,
        status: "ACTIVE",
        // La DÉFINITION V2 est indispensable, et son absence a été une découverte : un objectif
        // enregistré sans elle n'est pas évalué par le moteur, et la trajectoire du §20 item 4
        // restait non calculable dans une démonstration censée la montrer. Un objectif « legacy »
        // sans définition existe encore en base ; le moteur le laisse alors non évaluable plutôt
        // que d'en deviner la cible, ce qui est le bon comportement — mais une démonstration doit
        // montrer le cas qui fonctionne.
        definition: createGoalVersion({
          goalId: "demo-goal-epargne",
          name: "Épargne de précaution",
          priority: 1,
          constraintStrength: "SOFT",
          target: {
            metric: "IMMEDIATE_CASH",
            operator: "AT_LEAST",
            value: 20_000,
            currency: "EUR",
            entityId: null,
          },
          targetDate: shift(today, 540),
          createdAt: `${shift(today, -30)}T09:00:00Z`,
        }),
      },
    ],
    alerts: [],
    monthlyCloses: closes(today),
    documents: [],
    metrics: {} as DashboardState["metrics"],
    assumptions: [],
  };
}

/**
 * Déclarations de démonstration : les trois réponses du §18.1 sont représentées.
 *
 * `IMMOBILIER` est déclaré non concerné ALORS QUE le profil n'a pas de bien : c'est le cas
 * nominal, et l'étape « ajouter un bien, une société ou une dette » du parcours s'en trouve
 * partiellement close. `FISCALITE` reste « je ne sais pas encore », qui n'est ni une absence de
 * réponse ni un refus. `ENTREPRISE` n'est pas déclaré du tout : la question n'a pas été posée,
 * et le parcours la posera — ce qui montre les trois états côte à côte.
 */
export function demoDeclarations(today: string): DomainDeclaration[] {
  return [
    {
      domain: "BANQUE",
      applicability: "APPLICABLE",
      declaredOn: shift(today, -30),
      note: null,
    },
    {
      domain: "INVESTISSEMENT",
      applicability: "APPLICABLE",
      declaredOn: shift(today, -30),
      note: null,
    },
    // CONTRADICTION DÉLIBÉRÉE, et c'est le cas le plus instructif de la démonstration : le
    // profil a répondu « je n'ai pas de dette », et un prêt a ensuite été importé depuis la
    // banque. Le §16 interdit de trancher entre la déclaration et le fait, et le §19.3 demande
    // des « conflits expliqués » : la boîte de réception montre donc les deux, avec ce que
    // chaque issue changerait, sans rien supprimer d'office.
    {
      domain: "DETTE",
      applicability: "DECLARED_NONE",
      declaredOn: shift(today, -30),
      note: "Aucun crédit en cours à ma connaissance",
    },
    {
      domain: "IMMOBILIER",
      applicability: "DECLARED_NONE",
      declaredOn: shift(today, -30),
      note: "Locataire, pas de projet à court terme",
    },
    {
      domain: "CARRIERE",
      applicability: "APPLICABLE",
      declaredOn: shift(today, -30),
      note: null,
    },
    { domain: "FISCALITE", applicability: "UNDECIDED", declaredOn: shift(today, -20), note: null },
    {
      domain: "OBJECTIFS",
      applicability: "APPLICABLE",
      declaredOn: shift(today, -30),
      note: null,
    },
  ];
}

/**
 * Le modèle de lecture de la démonstration.
 *
 * `readOnlyDemo: true` traverse tout le modèle jusqu'à la surface : la page affiche son
 * bandeau, et le parcours d'installation cesse de proposer ses boutons de réponse. Une
 * démonstration qui offrirait des contrôles inertes serait pire qu'une démonstration sans
 * contrôles — le §11 de la phase 1 le dit d'un bouton sans action, « un contrôle qui ne fait
 * rien coûte plus qu'un contrôle absent ».
 */
export function getDemoTodayReadModel(today: string) {
  const state = buildDemoState(today);
  return buildTodayView(todayViewInputFrom(state, demoDeclarations(today), { readOnlyDemo: true }));
}

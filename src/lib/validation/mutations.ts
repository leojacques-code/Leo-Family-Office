import { z } from "zod";

import {
  BUSINESS_AMOUNT_SCOPES,
  BUSINESS_BRIDGE_ITEM_CATEGORIES,
  BUSINESS_BRIDGE_STATUSES,
  BUSINESS_CAPITAL_EVENT_TYPES,
  BUSINESS_CAPITAL_HISTORY_SOURCES,
  BUSINESS_DCF_TERMINAL_METHODS,
  BUSINESS_DISCOUNT_CONVENTIONS,
  BUSINESS_EBITDA_ADJUSTMENT_CATEGORIES,
  BUSINESS_METRIC_BASES,
  BUSINESS_PERIOD_KINDS,
  BUSINESS_TYPES,
  BUSINESS_VALUATION_METHODS,
  DERIVED_VALUATION_METHODS,
} from "@/lib/engine/business-equity";

import { AS_OF_DATE } from "@/lib/data/shared";
import { isScenarioVersionDefinition } from "@/lib/engine/scenario-engine";
import type { ScenarioVersionDefinition } from "@/lib/engine/scenario-contracts";
import { isGoalVersionDefinition } from "@/lib/engine/goal-engine";
import type { GoalVersionDefinition } from "@/lib/engine/goal-contracts";
import { isDecisionCaseVersion } from "@/lib/engine/decision-lab";
import type {
  DecisionCaseVersion,
  DecisionEvaluation,
  DecisionRun,
} from "@/lib/engine/decision-contracts";
import {
  LEDGER_COVERAGE_SOURCES,
  LOT_MATCHING_METHODS,
  PORTFOLIO_EVENT_TYPES,
  REAL_ESTATE_CAPITAL_EVENT_TYPES,
  REAL_ESTATE_USAGES,
  REAL_ESTATE_VALUATION_METHODS,
} from "@/lib/types";

const finite = z.number().finite();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
/**
 * `date` ne vérifie que la forme. Un 2026-02-31 la satisfait sans exister : la profondeur
 * d'historique est comparée à des bornes de mois, une date fantôme y produirait des
 * dénominateurs faux plutôt qu'une erreur visible.
 */
function isRealCalendarDate(value: string): boolean {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

const cashFlowKind = z.enum([
  "INCOME",
  "EXPENSE",
  "INTERNAL_TRANSFER",
  "INVESTMENT",
  "SAVING",
  "DEBT_SERVICE",
  "TAX",
  "REFUND",
  "OTHER_INFLOW",
  "OTHER_OUTFLOW",
  "UNCLASSIFIED",
]);
const essentiality = z.enum(["ESSENTIAL", "NON_ESSENTIAL", "UNKNOWN"]);
const expenseBehavior = z.enum(["FIXED", "VARIABLE", "DISCRETIONARY", "UNKNOWN"]);

const realDate = date.refine(isRealCalendarDate, "Date inexistante au calendrier");
const scenarioDefinitionSchema = z
  .custom<ScenarioVersionDefinition>(
    isScenarioVersionDefinition,
    "Définition Scenarios V2 invalide",
  )
  .superRefine((definition, context) => {
    if (!isRealCalendarDate(definition.asOfDate)) {
      context.addIssue({ code: "custom", message: "Date as-of invalide", path: ["asOfDate"] });
    }
    if (definition.horizonMonths < 1 || definition.horizonMonths > 960) {
      context.addIssue({
        code: "custom",
        message: "Horizon attendu entre 1 et 960 mois",
        path: ["horizonMonths"],
      });
    }
    const allocation = definition.capitalAllocation.investmentAllocationRate;
    if (!Number.isFinite(allocation) || allocation < 0 || allocation > 1) {
      context.addIssue({
        code: "custom",
        message: "Allocation attendue entre 0 et 1",
        path: ["capitalAllocation", "investmentAllocationRate"],
      });
    }
  });
const goalDefinitionSchema = z.custom<GoalVersionDefinition>(
  isGoalVersionDefinition,
  "Définition Goals V2 invalide",
);
const decisionCaseVersionSchema = z.custom<DecisionCaseVersion>(
  isDecisionCaseVersion,
  "Définition Decision Lab V2 invalide",
);
const decisionRunSchema = z.custom<DecisionRun>(
  (value) =>
    Boolean(
      value &&
      typeof value === "object" &&
      typeof (value as DecisionRun).id === "string" &&
      (value as DecisionRun).methodologyVersion === "DECISION_LAB_V2_SCENARIOS_GOALS_1" &&
      ["DETERMINISTIC", "MONTE_CARLO"].includes((value as DecisionRun).runMode),
    ),
  "Run Decision Lab V2 invalide",
);
const decisionEvaluationSchema = z.custom<DecisionEvaluation>(
  (value) =>
    Boolean(
      value &&
      typeof value === "object" &&
      ["READY", "PARTIAL", "NOT_COMPUTABLE"].includes((value as DecisionEvaluation).completeness) &&
      Array.isArray((value as DecisionEvaluation).options),
    ),
  "Résultat Decision Lab V2 invalide",
);
const nullableMoney = finite.nonnegative().nullable();
const datedTermKind = z.enum(["CONTRACTUAL", "ASSUMPTION"]);
const debtContractSchema = z
  .object({
    liabilityId: z.uuid().nullable(),
    name: z.string().trim().min(1).max(160),
    lender: z.string().trim().min(1).max(160),
    principal: finite.nonnegative(),
    initialBalance: nullableMoney,
    balanceDate: realDate.nullable(),
    annualRate: finite.min(0).max(10),
    paymentAmount: finite.nonnegative(),
    paymentCount: z.number().int().positive().max(1200),
    firstPaymentDate: realDate,
    maturityDate: realDate,
    amortisationProfile: z.enum(["AMORTIZING", "INTEREST_ONLY", "BULLET", "BALLOON"]),
    balloonAmount: nullableMoney,
    paymentFrequency: z.enum(["MONTHLY", "QUARTERLY", "SEMIANNUAL", "ANNUAL"]),
    interestConvention: z.enum(["PROPORTIONAL", "ACTUAL_365"]),
    rateType: z.enum(["FIXED", "VARIABLE"]),
    insuranceAmount: nullableMoney,
    recurringFees: nullableMoney,
    paymentIncludesInsurance: z.boolean().nullable(),
    deferral: z
      .object({
        kind: z.enum(["PRINCIPAL_ONLY", "TOTAL"]),
        months: z.number().int().positive().max(1200),
        interestTreatment: z.enum(["PAID", "CAPITALISED", "UNKNOWN"]),
      })
      .strict()
      .nullable(),
    facilityId: z.string().trim().min(1).max(120).nullable(),
    notes: z.string().trim().max(1000).nullable(),
    rateSchedule: z.array(
      z
        .object({ effectiveFrom: realDate, annualRate: finite.min(0).max(10), kind: datedTermKind })
        .strict(),
    ),
    paymentSchedule: z.array(
      z
        .object({ effectiveFrom: realDate, amount: finite.nonnegative(), kind: datedTermKind })
        .strict(),
    ),
    earlyRepayments: z.array(
      z
        .object({
          id: z.uuid(),
          date: realDate,
          amount: finite.positive(),
          penalty: nullableMoney,
          outcome: z.enum(["SHORTEN_TERM", "REDUCE_PAYMENT", "UNKNOWN"]),
        })
        .strict(),
    ),
    charges: z.array(
      z
        .object({
          id: z.uuid(),
          date: realDate,
          amount: finite.positive(),
          label: z.string().trim().min(1).max(160),
          financed: z.boolean(),
        })
        .strict(),
    ),
    providedSchedule: z.array(
      z
        .object({
          paymentNumber: z.number().int().positive(),
          dueDate: realDate,
          openingBalance: finite.nonnegative(),
          interest: finite.nonnegative(),
          principal: finite.nonnegative(),
          insurance: finite.nonnegative(),
          fees: finite.nonnegative(),
          closingBalance: finite.nonnegative(),
        })
        .strict(),
    ),
  })
  .strict()
  .superRefine((contract, context) => {
    if (
      contract.liabilityId === null &&
      (contract.initialBalance === null || contract.balanceDate === null)
    ) {
      context.addIssue({
        code: "custom",
        message: "L’encours initial et sa date sont requis à la création",
        path: ["initialBalance"],
      });
    }
    if (contract.amortisationProfile === "BALLOON" && contract.balloonAmount === null) {
      context.addIssue({
        code: "custom",
        message: "Le solde balloon est requis pour ce profil",
        path: ["balloonAmount"],
      });
    }
    if (contract.maturityDate < contract.firstPaymentDate) {
      context.addIssue({
        code: "custom",
        message: "La maturité doit être postérieure à la première échéance",
        path: ["maturityDate"],
      });
    }
  });

/**
 * Saisie d'un événement de ledger portefeuille.
 *
 * Aucun montant ne reçoit de valeur par défaut : `null` traverse la validation tel quel
 * et signifie « inconnu ». Les cohérences économiques (un achat sans titre, une cession
 * sans quantité) sont contrôlées ici ET par la base : ce sont des non-sens, pas des
 * approximations à corriger silencieusement.
 */
const portfolioEventSchema = z
  .object({
    accountId: z.uuid(),
    type: z.enum(PORTFOLIO_EVENT_TYPES),
    eventDate: realDate,
    settlementDate: realDate.nullable(),
    securityId: z.uuid().nullable(),
    security: z
      .object({
        name: z.string().trim().min(1).max(160),
        ticker: z.string().trim().min(1).max(24).nullable(),
        isin: z.string().trim().length(12).nullable(),
        currency: z.string().length(3).nullable(),
        assetClass: z.string().trim().min(1).max(80).nullable(),
      })
      .strict()
      .nullable(),
    quantity: finite.positive().nullable(),
    unitPrice: finite.nonnegative().nullable(),
    grossAmount: finite.nonnegative().nullable(),
    feeAmount: finite.nonnegative().nullable(),
    taxAmount: finite.nonnegative().nullable(),
    envelopeCashAmount: finite.nullable(),
    currency: z.string().length(3),
    counterpartyAccountId: z.uuid().nullable(),
    transactionId: z.uuid().nullable(),
    matchedAcquisitionEventId: z.uuid().nullable(),
    externalReference: z.string().trim().min(1).max(160).nullable(),
    notes: z.string().trim().max(1000).nullable(),
  })
  .strict()
  .superRefine((event, context) => {
    const instrumentBound = ["OPENING_POSITION", "BUY", "SELL"].includes(event.type);
    const cashOnly = ["OPENING_CASH", "CONTRIBUTION", "WITHDRAWAL"].includes(event.type);
    const hasInstrument = event.securityId !== null || event.security !== null;
    if (instrumentBound && !hasInstrument) {
      context.addIssue({
        code: "custom",
        message: "Cet événement porte sur un instrument : il doit en désigner un",
        path: ["security"],
      });
    }
    if (cashOnly && hasInstrument) {
      context.addIssue({
        code: "custom",
        message: "Un mouvement de cash d’enveloppe ne porte aucun instrument",
        path: ["security"],
      });
    }
    if (
      (instrumentBound || (hasInstrument && event.type.startsWith("TRANSFER"))) &&
      event.quantity === null
    ) {
      context.addIssue({
        code: "custom",
        message: "La quantité est obligatoire sur un mouvement d’instrument",
        path: ["quantity"],
      });
    }
    if (
      event.matchedAcquisitionEventId !== null &&
      !["SELL", "TRANSFER_OUT"].includes(event.type)
    ) {
      context.addIssue({
        code: "custom",
        message: "Un lot ne se désigne qu’à la cession",
        path: ["matchedAcquisitionEventId"],
      });
    }
    if (
      event.counterpartyAccountId !== null &&
      !["CONTRIBUTION", "WITHDRAWAL", "TRANSFER_IN", "TRANSFER_OUT"].includes(event.type)
    ) {
      context.addIssue({
        code: "custom",
        message: "Une contrepartie bancaire n’a de sens que sur un flux externe",
        path: ["counterpartyAccountId"],
      });
    }
    // Un arbitrage interne ne traverse aucun compte bancaire : le rattacher à une
    // transaction ferait compter le même euro deux fois dans le Cash Flow.
    if (
      event.transactionId !== null &&
      !["CONTRIBUTION", "WITHDRAWAL", "TRANSFER_IN", "TRANSFER_OUT"].includes(event.type)
    ) {
      context.addIssue({
        code: "custom",
        message: "Seul un flux externe à l’enveloppe se rattache à une transaction bancaire",
        path: ["transactionId"],
      });
    }
    if (event.settlementDate !== null && event.settlementDate < event.eventDate) {
      context.addIssue({
        code: "custom",
        message: "Le règlement ne peut pas précéder l’opération",
        path: ["settlementDate"],
      });
    }
  });

const portfolioPolicySchema = z
  .object({
    accountId: z.uuid(),
    lotMatchingMethod: z.enum(LOT_MATCHING_METHODS).nullable(),
    ledgerCoverageStart: realDate.nullable(),
    ledgerCoverageSource: z.enum(LEDGER_COVERAGE_SOURCES).nullable(),
    notes: z.string().trim().max(1000).nullable(),
  })
  .strict()
  .superRefine((policy, context) => {
    // Une profondeur sans origine n'est pas traçable ; une origine sans profondeur ne
    // déclare rien. Les deux vont ensemble ou aucune des deux n'existe.
    if ((policy.ledgerCoverageStart === null) !== (policy.ledgerCoverageSource === null)) {
      context.addIssue({
        code: "custom",
        message: "La profondeur d’historique et son origine se déclarent ensemble",
        path: ["ledgerCoverageSource"],
      });
    }
  });

/**
 * SCHÉMAS DU DOMAINE IMMOBILIER
 *
 * Règle unique : un `null` transmis est une VALEUR, il traverse la validation intact.
 * Refuser le `null` forcerait l'interface à envoyer zéro, et « je ne sais pas » deviendrait
 * « la charge est nulle » : le rendement net calculé ensuite serait faux et flatteur.
 */
const realEstateAssetSchema = z
  .object({
    propertyId: z.uuid().nullable(),
    name: z.string().trim().min(1).max(160),
    location: z.string().trim().max(240).nullable(),
    surfaceSqm: finite.positive().nullable(),
    usage: z.enum(REAL_ESTATE_USAGES).nullable(),
    // Une quote-part nulle n'existe pas : détenir 0 % d'un bien, c'est ne pas le détenir.
    ownershipShare: finite.gt(0).max(1).nullable(),
    // Tri-état : `null` traverse la validation intact. Le remplacer par `false` ferait
    // passer un crédit non encore saisi pour un achat comptant.
    isDebtFinanced: z.boolean().nullable(),
    acquisitionDate: realDate.nullable(),
    disposalDate: realDate.nullable(),
    notes: z.string().trim().max(1000).nullable(),
  })
  .strict()
  .superRefine((asset, context) => {
    if (
      asset.acquisitionDate !== null &&
      asset.disposalDate !== null &&
      asset.disposalDate < asset.acquisitionDate
    ) {
      context.addIssue({
        code: "custom",
        message: "La cession ne peut pas précéder l’acquisition",
        path: ["disposalDate"],
      });
    }
  });

const realEstateValuationSchema = z
  .object({
    propertyId: z.uuid(),
    valuedAt: realDate,
    // Valeur du bien ENTIER : la quote-part est appliquée par le moteur, pas par la saisie.
    value: finite.nonnegative(),
    currency: z.string().trim().length(3),
    method: z.enum(REAL_ESTATE_VALUATION_METHODS),
    notes: z.string().trim().max(1000).nullable(),
  })
  .strict();

const realEstateCapitalEventSchema = z
  .object({
    propertyId: z.uuid(),
    type: z.enum(REAL_ESTATE_CAPITAL_EVENT_TYPES),
    eventDate: realDate,
    // Toujours positif : la direction économique vient du type, jamais du signe.
    amount: finite.nonnegative(),
    currency: z.string().trim().length(3),
    label: z.string().trim().max(160).nullable(),
    transactionId: z.uuid().nullable(),
    notes: z.string().trim().max(1000).nullable(),
  })
  .strict();

const realEstateOperatingTermsSchema = z
  .object({
    propertyId: z.uuid(),
    effectiveFrom: realDate,
    currency: z.string().trim().length(3),
    annualGrossRent: nullableMoney,
    vacancyRate: finite.min(0).max(1).nullable(),
    annualOperatingCharges: nullableMoney,
    annualPropertyTax: nullableMoney,
    annualInsurance: nullableMoney,
    annualMaintenance: nullableMoney,
    annualManagementFees: nullableMoney,
    managementFeeRate: finite.min(0).max(1).nullable(),
    annualOtherCosts: nullableMoney,
    effectiveIncomeTaxRate: finite.min(0).max(1).nullable(),
    notes: z.string().trim().max(1000).nullable(),
  })
  .strict()
  .superRefine((terms, context) => {
    // Les deux formes de frais de gestion s'excluent : ensemble, elles compteraient deux
    // fois la même charge. La base le refuse aussi.
    if (terms.annualManagementFees !== null && terms.managementFeeRate !== null) {
      context.addIssue({
        code: "custom",
        message:
          "Frais de gestion déclarés deux fois : un montant OU une part du loyer, jamais les deux",
        path: ["managementFeeRate"],
      });
    }
  });

const realEstateFinancingLinkSchema = z
  .object({
    propertyId: z.uuid(),
    liabilityId: z.uuid(),
    // Une part nulle n'affecte rien : c'est l'absence de rattachement, pas un rattachement.
    allocationShare: finite.gt(0).max(1),
    notes: z.string().trim().max(1000).nullable(),
  })
  .strict();

/**
 * Business Equity V2.1 — un champ vide signifie INCONNU, jamais zéro.
 *
 * Deux règles de forme y sont vérifiées avant toute écriture, parce qu'elles portent des
 * invariants économiques et non des contraintes de saisie :
 *   — une base de valorisation DÉRIVÉE ne transporte jamais son résultat ;
 *   — une date de fait n'est jamais postérieure à la date d'arrêté du dossier. Un fait
 *     futur n'est pas un fait.
 */
const businessDate = realDate.refine(
  (value) => value <= AS_OF_DATE,
  `Date postérieure à l’arrêté du ${AS_OF_DATE} : un fait futur n’est pas un fait`,
);
const ownershipRate = finite.min(0).max(1);
const shareCount = finite.positive().nullable();

const businessSchema = z
  .object({
    businessId: z.uuid().nullable(),
    name: z.string().trim().min(1).max(160),
    legalForm: z.string().trim().max(80).nullable(),
    type: z.enum(BUSINESS_TYPES).nullable(),
    functionalCurrency: z.string().trim().length(3).nullable(),
    sector: z.string().trim().max(120).nullable(),
    country: z.string().trim().length(2).nullable(),
    foundedOn: businessDate.nullable(),
    capitalHistoryStart: businessDate.nullable(),
    capitalHistorySource: z.enum(BUSINESS_CAPITAL_HISTORY_SOURCES),
    notes: z.string().trim().max(1000).nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.capitalHistorySource === "DECLARED_COMPLETE" && value.capitalHistoryStart === null) {
      context.addIssue({
        code: "custom",
        message: "Un historique déclaré complet exige la date à partir de laquelle il l’est",
        path: ["capitalHistoryStart"],
      });
    }
  });

const businessOwnershipSchema = z
  .object({
    businessId: z.uuid(),
    effectiveDate: businessDate,
    legalRate: ownershipRate,
    economicRate: ownershipRate.nullable(),
    votingRate: ownershipRate.nullable(),
    fullyDilutedRate: ownershipRate.nullable(),
    sharesHeld: finite.nonnegative().nullable(),
    sharesOutstanding: shareCount,
    fullyDilutedShares: shareCount,
    shareClass: z.string().trim().max(80).nullable(),
    notes: z.string().trim().max(1000).nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.sharesHeld !== null &&
      value.sharesOutstanding !== null &&
      value.sharesHeld > value.sharesOutstanding
    ) {
      context.addIssue({
        code: "custom",
        message: "Les titres détenus ne peuvent pas dépasser les titres en circulation",
        path: ["sharesHeld"],
      });
    }
  });

const businessFinancialSchema = z
  .object({
    businessId: z.uuid(),
    periodEnd: businessDate,
    periodStart: businessDate.nullable(),
    periodKind: z.enum(BUSINESS_PERIOD_KINDS),
    periodLabel: z.string().trim().max(40).nullable(),
    currency: z.string().trim().length(3).nullable(),
    revenue: finite.nullable(),
    grossProfit: finite.nullable(),
    ebitda: finite.nullable(),
    ebit: finite.nullable(),
    netIncome: finite.nullable(),
    cash: finite.nonnegative().nullable(),
    grossDebt: finite.nonnegative().nullable(),
    workingCapital: finite.nullable(),
    capex: finite.nonnegative().nullable(),
    depreciationAmortisation: finite.nonnegative().nullable(),
    interestExpense: finite.nullable(),
    taxExpense: finite.nullable(),
    freeCashFlow: finite.nullable(),
    notes: z.string().trim().max(1000).nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.periodStart !== null && value.periodStart >= value.periodEnd) {
      context.addIssue({
        code: "custom",
        message: "Le début de période doit précéder sa clôture",
        path: ["periodStart"],
      });
    }
  });

const businessValuationSchema = z
  .object({
    businessId: z.uuid(),
    valuationDate: businessDate,
    currency: z.string().trim().length(3).nullable(),
    method: z.enum(BUSINESS_VALUATION_METHODS),
    enterpriseValue: finite.nullable(),
    equityValue: finite.nullable(),
    multiple: finite.positive().nullable(),
    multipleLow: finite.positive().nullable(),
    multipleHigh: finite.positive().nullable(),
    metricBasis: z.enum(BUSINESS_METRIC_BASES).nullable(),
    metricPeriodEnd: businessDate.nullable(),
    preMoneyEquityValue: finite.nonnegative().nullable(),
    primaryNewMoney: finite.nonnegative().nullable(),
    secondaryAmount: finite.nonnegative().nullable(),
    investorContribution: finite.nonnegative().nullable(),
    preferredRightsKnown: z.boolean().nullable(),
    bridgeStatus: z.enum(BUSINESS_BRIDGE_STATUSES),
    source: z.string().trim().max(200).nullable(),
    notes: z.string().trim().max(1000).nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    const derived = (DERIVED_VALUATION_METHODS as readonly string[]).includes(value.method);
    if (derived && (value.enterpriseValue !== null || value.equityValue !== null)) {
      context.addIssue({
        code: "custom",
        message:
          "Une méthode dérivée ne porte jamais son résultat : EV et Equity Value sont produites par le moteur",
        path: ["enterpriseValue"],
      });
    }
    if (!derived && value.enterpriseValue === null && value.equityValue === null) {
      context.addIssue({
        code: "custom",
        message: "Une valorisation observée exige une Enterprise Value ou une Equity Value",
        path: ["equityValue"],
      });
    }
    if (
      (value.method === "EBITDA_MULTIPLE" || value.method === "REVENUE_MULTIPLE") &&
      value.multiple === null
    ) {
      context.addIssue({
        code: "custom",
        message: "Un multiple central est requis pour cette méthode",
        path: ["multiple"],
      });
    }
    if (
      value.method === "FUNDING_ROUND" &&
      (value.preMoneyEquityValue === null || value.primaryNewMoney === null)
    ) {
      context.addIssue({
        code: "custom",
        message: "Un tour de table exige un pre-money et un montant d’argent frais primaire",
        path: ["preMoneyEquityValue"],
      });
    }
    if (
      value.multipleLow !== null &&
      value.multiple !== null &&
      value.multipleLow > value.multiple
    ) {
      context.addIssue({
        code: "custom",
        message: "Le multiple bas ne peut pas dépasser le multiple central",
        path: ["multipleLow"],
      });
    }
    if (
      value.multipleHigh !== null &&
      value.multiple !== null &&
      value.multipleHigh < value.multiple
    ) {
      context.addIssue({
        code: "custom",
        message: "Le multiple haut ne peut pas être inférieur au multiple central",
        path: ["multipleHigh"],
      });
    }
    if ((value.multipleLow !== null || value.multipleHigh !== null) && value.multiple === null) {
      context.addIssue({
        code: "custom",
        message: "Une fourchette de multiples suppose un multiple central",
        path: ["multiple"],
      });
    }
  });

const businessEbitdaAdjustmentSchema = z
  .object({
    businessId: z.uuid(),
    periodEnd: businessDate,
    category: z.enum(BUSINESS_EBITDA_ADJUSTMENT_CATEGORIES),
    label: z.string().trim().min(1).max(160),
    amount: finite,
    currency: z.string().trim().length(3),
    recurring: z.boolean(),
    source: z.string().trim().max(200).nullable(),
    notes: z.string().trim().max(1000).nullable(),
  })
  .strict();

const businessBridgeItemSchema = z
  .object({
    businessId: z.uuid(),
    effectiveDate: businessDate,
    category: z.enum(BUSINESS_BRIDGE_ITEM_CATEGORIES),
    label: z.string().trim().min(1).max(160),
    amount: finite,
    currency: z.string().trim().length(3),
    source: z.string().trim().max(200).nullable(),
    notes: z.string().trim().max(1000).nullable(),
  })
  .strict();

const businessDcfSchema = z
  .object({
    businessId: z.uuid(),
    valuationDate: businessDate,
    currency: z.string().trim().length(3),
    wacc: finite.gt(0).lt(1),
    taxRate: finite.min(0).lt(1),
    terminalMethod: z.enum(BUSINESS_DCF_TERMINAL_METHODS),
    terminalGrowth: finite.nullable(),
    terminalExitMultiple: finite.positive().nullable(),
    terminalExitMetric: z.enum(["EBITDA", "EBIT"]).nullable(),
    discountConvention: z.enum(BUSINESS_DISCOUNT_CONVENTIONS),
    periods: z
      .array(
        z
          .object({
            yearIndex: z.number().int().min(1).max(30),
            revenue: finite.nullable(),
            ebitda: finite.nullable(),
            ebit: finite.nullable(),
            depreciationAmortisation: finite.nonnegative().nullable(),
            capex: finite.nonnegative().nullable(),
            workingCapitalChange: finite.nullable(),
          })
          .strict(),
      )
      .min(1)
      .max(30),
    notes: z.string().trim().max(1000).nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.terminalMethod === "PERPETUAL_GROWTH") {
      if (value.terminalGrowth === null) {
        context.addIssue({
          code: "custom",
          message: "La croissance perpétuelle doit être déclarée",
          path: ["terminalGrowth"],
        });
      } else if (value.terminalGrowth >= value.wacc) {
        context.addIssue({
          code: "custom",
          message: "La croissance perpétuelle doit rester inférieure au WACC",
          path: ["terminalGrowth"],
        });
      }
    }
    if (
      value.terminalMethod === "EXIT_MULTIPLE" &&
      (value.terminalExitMultiple === null || value.terminalExitMetric === null)
    ) {
      context.addIssue({
        code: "custom",
        message: "Un multiple de sortie exige son agrégat de référence",
        path: ["terminalExitMultiple"],
      });
    }
    const years = value.periods.map((period) => period.yearIndex);
    if (new Set(years).size !== years.length) {
      context.addIssue({ code: "custom", message: "Années dupliquées", path: ["periods"] });
    }
  });

const businessCapitalEventSchema = z
  .object({
    businessId: z.uuid(),
    type: z.enum(BUSINESS_CAPITAL_EVENT_TYPES),
    eventDate: businessDate,
    amount: finite.nonnegative(),
    amountScope: z.enum(BUSINESS_AMOUNT_SCOPES),
    fees: finite.nonnegative().nullable(),
    currency: z.string().trim().length(3),
    ownershipDelta: finite.min(-1).max(1).nullable(),
    ownershipRateAfter: ownershipRate.nullable(),
    sharesDelta: finite.nullable(),
    pricePerShare: finite.positive().nullable(),
    label: z.string().trim().max(160).nullable(),
    transactionId: z.uuid().nullable(),
    notes: z.string().trim().max(1000).nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    const distribution = ["DIVIDEND", "DISTRIBUTION", "CAPITAL_RETURN"].includes(value.type);
    if (value.amountScope === "COMPANY_TOTAL" && !distribution) {
      context.addIssue({
        code: "custom",
        message: "Un montant au niveau société ne se conçoit que pour une distribution",
        path: ["amountScope"],
      });
    }
    const changesOwnership = ["ACQUISITION", "SALE", "BUYBACK"].includes(value.type);
    if (changesOwnership && value.ownershipRateAfter === null) {
      context.addIssue({
        code: "custom",
        message: "Cette opération exige la détention économique après opération",
        path: ["ownershipRateAfter"],
      });
    }
    if (changesOwnership && value.ownershipDelta === null) {
      context.addIssue({
        code: "custom",
        message: "La variation de détention doit être dérivée avant l’écriture atomique",
        path: ["ownershipDelta"],
      });
    }
    if (
      value.type === "ACQUISITION" &&
      value.ownershipDelta !== null &&
      value.ownershipDelta <= 0
    ) {
      context.addIssue({
        code: "custom",
        message: "Une acquisition doit augmenter la détention",
        path: ["ownershipDelta"],
      });
    }
    if (
      (value.type === "SALE" || value.type === "BUYBACK") &&
      value.ownershipDelta !== null &&
      value.ownershipDelta >= 0
    ) {
      context.addIssue({
        code: "custom",
        message: "Une cession ou un rachat doit réduire la détention",
        path: ["ownershipDelta"],
      });
    }
  });

const businessQuickStartSchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    legalForm: z.string().trim().max(80).nullable(),
    type: z.enum(BUSINESS_TYPES).nullable(),
    currency: z.string().trim().length(3),
    sector: z.string().trim().max(120).nullable(),
    country: z.string().trim().length(2).nullable(),
    periodEnd: businessDate,
    periodKind: z.enum(BUSINESS_PERIOD_KINDS),
    periodLabel: z.string().trim().max(40).nullable(),
    revenue: finite.nullable(),
    ebitda: finite.nullable(),
    cash: finite.nonnegative().nullable(),
    grossDebt: finite.nonnegative().nullable(),
    legalRate: finite.gt(0).max(1),
    economicRate: finite.gt(0).max(1),
    valuationDate: businessDate,
    method: z.enum(["EBITDA_MULTIPLE", "REVENUE_MULTIPLE"]),
    multiple: finite.positive(),
    multipleLow: finite.positive().nullable(),
    multipleHigh: finite.positive().nullable(),
    bridgeStatus: z.literal("DECLARED_NONE"),
    capitalHistoryStart: businessDate.nullable(),
    capitalHistorySource: z.enum(BUSINESS_CAPITAL_HISTORY_SOURCES),
    notes: z.string().trim().max(1000).nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    const metric = value.method === "REVENUE_MULTIPLE" ? value.revenue : value.ebitda;
    if (metric === null) {
      context.addIssue({
        code: "custom",
        message:
          value.method === "REVENUE_MULTIPLE"
            ? "Un multiple de chiffre d’affaires exige un chiffre d’affaires"
            : "Un multiple d’EBITDA exige un EBITDA",
        path: [value.method === "REVENUE_MULTIPLE" ? "revenue" : "ebitda"],
      });
    }
    if (value.cash === null) {
      context.addIssue({
        code: "custom",
        message: "Le Quick Start exige une trésorerie connue, y compris 0 explicite",
        path: ["cash"],
      });
    }
    if (value.grossDebt === null) {
      context.addIssue({
        code: "custom",
        message: "Le Quick Start exige une dette brute connue, y compris 0 explicite",
        path: ["grossDebt"],
      });
    }
    if (value.multipleLow !== null && value.multipleLow > value.multiple) {
      context.addIssue({
        code: "custom",
        message: "Multiple bas supérieur au central",
        path: ["multipleLow"],
      });
    }
    if (value.multipleHigh !== null && value.multipleHigh < value.multiple) {
      context.addIssue({
        code: "custom",
        message: "Multiple haut inférieur au central",
        path: ["multipleHigh"],
      });
    }
    if (value.capitalHistorySource === "DECLARED_COMPLETE" && value.capitalHistoryStart === null) {
      context.addIssue({
        code: "custom",
        message: "Un historique déclaré complet exige sa date de départ",
        path: ["capitalHistoryStart"],
      });
    }
  });

const businessHoldingSchema = z
  .object({
    parentBusinessId: z.uuid(),
    childBusinessId: z.uuid(),
    effectiveDate: businessDate,
    ownershipRate: finite.gt(0).max(1),
    notes: z.string().trim().max(1000).nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.parentBusinessId === value.childBusinessId) {
      context.addIssue({
        code: "custom",
        message: "Une société ne peut pas se détenir elle-même",
        path: ["childBusinessId"],
      });
    }
  });

const businessFundingRoundSchema = z
  .object({
    businessId: z.uuid(),
    roundDate: businessDate,
    currency: z.string().trim().length(3),
    preMoneyEquityValue: finite.positive(),
    primaryNewMoney: finite.nonnegative(),
    secondaryAmount: finite.nonnegative().nullable(),
    investorContribution: finite.nonnegative(),
    ownershipBefore: ownershipRate,
    preferredRightsKnown: z.boolean(),
    source: z.string().trim().max(200).nullable(),
    notes: z.string().trim().max(1000).nullable(),
  })
  .strict();

const careerDataKind = z.enum(["ACTUAL", "CONTRACTUAL", "USER_ASSUMPTION", "PROJECTED"]);
const confidence = z.enum(["LOW", "MEDIUM", "HIGH", "UNKNOWN"]);
const nullableCareerMoney = finite.nonnegative().nullable();
const careerCompensationSchema = z
  .object({
    baseSalary: nullableCareerMoney,
    frequency: z.enum(["MONTHLY", "ANNUAL", "DAILY", "HOURLY"]),
    guaranteedBonus: nullableCareerMoney,
    targetBonus: nullableCareerMoney,
    targetBonusRate: finite.min(0).max(10).nullable(),
    discretionaryBonus: nullableCareerMoney,
    commissions: nullableCareerMoney,
    profitSharing: nullableCareerMoney,
    participation: nullableCareerMoney,
    employerBenefits: nullableCareerMoney,
    allowances: nullableCareerMoney,
    otherTaxableCompensation: nullableCareerMoney,
    otherNonTaxableCompensation: nullableCareerMoney,
    workingTime: finite.positive().nullable(),
    effectiveFrom: realDate,
    effectiveTo: realDate.nullable(),
    dataKind: careerDataKind,
    confidence,
    source: z.string().trim().max(300).nullable(),
    notes: z.string().trim().max(2000).nullable(),
  })
  .strict()
  .refine((value) => value.effectiveTo === null || value.effectiveTo >= value.effectiveFrom, {
    message: "La fin des termes doit suivre leur date d’effet",
    path: ["effectiveTo"],
  });
const careerPackageSchema = z
  .object({
    roleId: z.uuid().nullable(),
    employer: z.string().trim().max(200).nullable(),
    jobTitle: z.string().trim().max(200).nullable(),
    employmentType: z.enum([
      "EMPLOYEE",
      "INTERN",
      "FREELANCE",
      "CONTRACTOR",
      "ENTREPRENEUR",
      "CORPORATE_OFFICER",
      "UNEMPLOYED",
      "OTHER",
    ]),
    industry: z.string().trim().max(160).nullable(),
    country: z.string().trim().length(2).nullable(),
    currency: z.string().trim().length(3),
    startDate: realDate,
    endDate: realDate.nullable(),
    status: z.enum(["ACTIVE", "ENDED", "FUTURE"]),
    dataKind: careerDataKind,
    confidence,
    source: z.string().trim().max(300).nullable(),
    notes: z.string().trim().max(2000).nullable(),
    compensation: careerCompensationSchema.nullable(),
  })
  .strict()
  .refine((value) => value.endDate === null || value.endDate >= value.startDate, {
    message: "La fin du rôle doit suivre son début",
    path: ["endDate"],
  });
const careerEventSchema = z
  .object({
    roleId: z.uuid().nullable(),
    type: z.enum([
      "JOB_START",
      "JOB_END",
      "PROMOTION",
      "SALARY_CHANGE",
      "BONUS_TARGET_CHANGE",
      "BONUS_EARNED",
      "BONUS_PAID",
      "COMMISSION",
      "UNEMPLOYMENT",
      "SABBATICAL",
      "FREELANCE_START",
      "FREELANCE_END",
      "EQUITY_GRANT",
      "EQUITY_VEST",
      "OTHER",
    ]),
    eventDate: realDate,
    amount: nullableCareerMoney,
    currency: z.string().trim().length(3).nullable(),
    variableState: z.enum(["TARGET", "CONTRACTUAL", "EARNED", "PAID", "PROJECTED"]).nullable(),
    paidDate: realDate.nullable(),
    label: z.string().trim().max(200).nullable(),
    dataKind: careerDataKind,
    confidence,
    source: z.string().trim().max(300).nullable(),
    notes: z.string().trim().max(2000).nullable(),
  })
  .strict()
  .refine((value) => value.variableState !== "PAID" || value.paidDate !== null, {
    message: "Un variable payé exige une date de paiement",
    path: ["paidDate"],
  });
const taxProfileSchema = z
  .object({
    id: z.uuid().nullable(),
    residencyCountry: z.string().trim().length(2),
    householdStatus: z.string().trim().min(1).max(120),
    jurisdiction: z.string().trim().max(120).nullable(),
    maritalStatus: z.string().trim().max(120).nullable(),
    dependants: z.number().int().nonnegative().nullable(),
    taxShares: finite.positive().nullable(),
    withholdingSettings: z.record(z.string(), z.unknown()),
    socialContributionRegime: z.string().trim().max(160).nullable(),
    professionalStatus: z.string().trim().max(160).nullable(),
    specialRegime: z.string().trim().max(160).nullable(),
    effectiveFrom: realDate,
    effectiveTo: realDate.nullable(),
    source: z.string().trim().max(300).nullable(),
    confidence,
    notes: z.string().trim().max(2000).nullable(),
  })
  .strict()
  .refine((value) => value.effectiveTo === null || value.effectiveTo >= value.effectiveFrom, {
    message: "La fin du profil doit suivre sa date d’effet",
    path: ["effectiveTo"],
  });
const taxRuleSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    taxType: z.enum([
      "PAYROLL_CONTRIBUTION",
      "TAXABLE_DEDUCTION",
      "INCOME_TAX_BRACKETS",
      "WITHHOLDING_RATE",
    ]),
    incomeCategory: z.enum(["EMPLOYMENT", "PROFESSIONAL", "OTHER"]),
    parameters: z.record(z.string(), z.unknown()),
    effectiveFrom: realDate,
    effectiveTo: realDate.nullable(),
    verifiedAt: realDate.nullable(),
    confidence,
    legalNote: z.string().trim().max(1000).nullable(),
    notes: z.string().trim().max(2000).nullable(),
  })
  .strict()
  .refine((value) => value.effectiveTo === null || value.effectiveTo >= value.effectiveFrom, {
    message: "La fin de la règle doit suivre sa date d’effet",
    path: ["effectiveTo"],
  });
const taxRuleSetSchema = z
  .object({
    id: z.uuid().nullable(),
    jurisdiction: z.string().trim().min(1).max(120),
    taxYear: z.number().int().min(2000).max(2200),
    name: z.string().trim().min(1).max(200),
    effectiveFrom: realDate,
    effectiveTo: realDate.nullable(),
    source: z.string().trim().min(1).max(500),
    sourceDate: realDate,
    confidence,
    status: z.enum(["DRAFT", "DECLARED", "VERIFIED", "STALE"]),
    legalReference: z.string().trim().max(1000).nullable(),
    notes: z.string().trim().max(2000).nullable(),
    rules: z.array(taxRuleSchema).max(100),
  })
  .strict()
  .refine((value) => value.effectiveTo === null || value.effectiveTo >= value.effectiveFrom, {
    message: "La fin du jeu doit suivre sa date d’effet",
    path: ["effectiveTo"],
  });
const taxObservationSchema = z
  .object({
    type: z.enum(["LIABILITY", "WITHHELD", "PAID", "REFUND", "BALANCE_DUE"]),
    observedDate: realDate,
    taxYear: z.number().int().min(2000).max(2200),
    amount: finite.nonnegative(),
    currency: z.string().trim().length(3),
    transactionId: z.uuid().nullable(),
    documentId: z.uuid().nullable(),
    confidence,
    source: z.string().trim().max(300).nullable(),
    notes: z.string().trim().max(2000).nullable(),
  })
  .strict();

export const mutationSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("save_career_package"), career: careerPackageSchema }).strict(),
  z.object({ action: z.literal("record_career_event"), event: careerEventSchema }).strict(),
  z.object({ action: z.literal("set_tax_profile"), profile: taxProfileSchema }).strict(),
  z.object({ action: z.literal("save_tax_rule_set"), ruleSet: taxRuleSetSchema }).strict(),
  z
    .object({ action: z.literal("record_tax_observation"), observation: taxObservationSchema })
    .strict(),
  z
    .object({
      action: z.literal("create_business_quick_start"),
      quickStart: businessQuickStartSchema,
    })
    .strict(),
  z.object({ action: z.literal("save_business"), business: businessSchema }).strict(),
  z.object({ action: z.literal("archive_business"), businessId: z.uuid() }).strict(),
  z
    .object({ action: z.literal("record_business_ownership"), ownership: businessOwnershipSchema })
    .strict(),
  z.object({ action: z.literal("delete_business_ownership"), ownershipId: z.uuid() }).strict(),
  z
    .object({
      action: z.literal("record_business_financials"),
      financials: businessFinancialSchema,
    })
    .strict(),
  z.object({ action: z.literal("delete_business_financials"), financialsId: z.uuid() }).strict(),
  z
    .object({ action: z.literal("record_business_valuation"), valuation: businessValuationSchema })
    .strict(),
  z.object({ action: z.literal("delete_business_valuation"), valuationId: z.uuid() }).strict(),
  z
    .object({
      action: z.literal("record_business_ebitda_adjustment"),
      adjustment: businessEbitdaAdjustmentSchema,
    })
    .strict(),
  z
    .object({ action: z.literal("delete_business_ebitda_adjustment"), adjustmentId: z.uuid() })
    .strict(),
  z
    .object({ action: z.literal("record_business_bridge_item"), item: businessBridgeItemSchema })
    .strict(),
  z.object({ action: z.literal("delete_business_bridge_item"), itemId: z.uuid() }).strict(),
  z.object({ action: z.literal("set_business_dcf"), dcf: businessDcfSchema }).strict(),
  z.object({ action: z.literal("delete_business_dcf"), dcfId: z.uuid() }).strict(),
  z
    .object({
      action: z.literal("record_business_capital_event"),
      event: businessCapitalEventSchema,
    })
    .strict(),
  z.object({ action: z.literal("delete_business_capital_event"), eventId: z.uuid() }).strict(),
  z.object({ action: z.literal("set_business_holding"), holding: businessHoldingSchema }).strict(),
  z.object({ action: z.literal("delete_business_holding"), holdingId: z.uuid() }).strict(),
  z
    .object({
      action: z.literal("apply_business_funding_round"),
      round: businessFundingRoundSchema,
    })
    .strict(),
  z.object({ action: z.literal("save_debt_contract"), contract: debtContractSchema }),
  z.object({
    action: z.literal("record_debt_balance"),
    liabilityId: z.uuid(),
    observedAt: realDate,
    balance: finite.nonnegative(),
    notes: z.string().trim().max(500).nullable(),
  }),
  z.object({ action: z.literal("archive_debt"), liabilityId: z.uuid() }),
  z.object({
    action: z.literal("update_account"),
    accountId: z.string().min(1),
    balance: finite,
    balanceDate: date,
  }),
  z.object({
    action: z.literal("add_account"),
    institution: z.string().min(1).max(120),
    name: z.string().min(1).max(120),
    accountType: z.enum(["BANK", "PEA", "CTO", "SAVINGS", "OTHER"]),
    balance: finite,
    currency: z.string().length(3),
  }),
  z.object({
    action: z.literal("add_transaction"),
    accountId: z.string().min(1),
    categoryId: z.string().min(1),
    date,
    label: z.string().min(1).max(180),
    amount: finite,
    updateBalance: z.boolean(),
  }),
  z.object({
    action: z.literal("update_expense"),
    categoryId: z.string().min(1),
    monthlyAmount: finite.nonnegative().nullable(),
  }),
  z.object({
    action: z.literal("update_scenario"),
    scenarioId: z.string().min(1),
    patch: z
      .object({
        annualReturn: finite.min(-0.99).max(1).optional(),
        annualVolatility: finite.min(0).max(2).optional(),
        annualInflation: finite.min(-0.1).max(1).optional(),
        monthlySavings: finite.min(-100000).max(100000).optional(),
        investmentAllocationRate: finite.min(0).max(1).optional(),
        salaryGrowth: finite.min(-0.5).max(1).optional(),
        stressProbability: finite.min(0).max(1).optional(),
        shockYear: z.number().int().min(1).max(80).nullable().optional(),
        shockMagnitude: finite.min(-0.99).max(5).nullable().optional(),
      })
      .strict(),
  }),
  z.object({ action: z.literal("duplicate_scenario"), scenarioId: z.string().min(1) }),
  z
    .object({
      action: z.literal("create_scenario_v2"),
      name: z.string().trim().min(1).max(160),
      description: z.string().trim().max(1000),
      color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
      definition: scenarioDefinitionSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("save_scenario_version_v2"),
      scenarioId: z.uuid(),
      expectedVersion: z.number().int().positive(),
      definition: scenarioDefinitionSchema,
    })
    .strict(),
  z.object({ action: z.literal("archive_scenario_v2"), scenarioId: z.uuid() }).strict(),
  z.object({ action: z.literal("create_monthly_close"), closeDate: date }),
  z.object({
    action: z.literal("add_goal"),
    name: z.string().min(1).max(160),
    targetAmount: finite.positive(),
    targetDate: date.nullable(),
  }),
  z.object({ action: z.literal("create_goal_v2"), definition: goalDefinitionSchema }).strict(),
  z
    .object({
      action: z.literal("save_goal_version_v2"),
      goalId: z.uuid(),
      expectedVersion: z.number().int().positive(),
      definition: goalDefinitionSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("set_goal_status_v2"),
      goalId: z.uuid(),
      expectedVersion: z.number().int().positive(),
      status: z.enum(["ACTIVE", "PAUSED", "ACHIEVED", "ARCHIVED"]),
    })
    .strict(),
  z
    .object({
      action: z.literal("create_decision_case_v2"),
      definition: decisionCaseVersionSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("save_decision_case_version_v2"),
      caseId: z.uuid(),
      expectedVersion: z.number().int().positive(),
      definition: decisionCaseVersionSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("save_decision_run_v2"),
      caseId: z.uuid(),
      caseVersion: z.number().int().positive(),
      run: decisionRunSchema,
      result: decisionEvaluationSchema,
    })
    .strict(),
  z.object({
    action: z.literal("update_category"),
    categoryId: z.string().min(1),
    patch: z
      .object({
        name: z.string().min(1).max(120).optional(),
        groupName: z.string().min(1).max(120).optional(),
        cashFlowKind: cashFlowKind.optional(),
        essentiality: essentiality.optional(),
        behavior: expenseBehavior.optional(),
        archived: z.boolean().optional(),
      })
      .strict(),
  }),
  z.object({
    action: z.literal("add_category"),
    name: z.string().min(1).max(120),
    groupName: z.string().min(1).max(120),
    cashFlowKind,
    essentiality,
    behavior: expenseBehavior,
  }),
  z.object({
    action: z.literal("classify_transaction"),
    transactionId: z.string().min(1),
    categoryId: z.string().min(1).optional(),
    kindOverride: cashFlowKind.nullable().optional(),
    transferGroupId: z.string().min(1).max(64).nullable().optional(),
    notes: z.string().max(500).nullable().optional(),
  }),
  z.object({
    action: z.literal("add_recurring_rule"),
    name: z.string().min(1).max(160),
    cashFlowKind,
    categoryId: z.string().min(1),
    accountId: z.string().min(1).nullable(),
    amount: finite.refine((value) => value !== 0, "Le montant ne peut pas être nul"),
    frequency: z.enum(["MONTHLY", "QUARTERLY", "ANNUAL"]),
    startDate: date,
    endDate: date.nullable(),
    dayOfMonth: z.number().int().min(1).max(31).nullable(),
  }),
  z.object({
    action: z.literal("update_recurring_rule"),
    ruleId: z.string().min(1),
    patch: z
      .object({
        amount: finite.optional(),
        active: z.boolean().optional(),
        endDate: date.nullable().optional(),
      })
      .strict(),
  }),
  z.object({ action: z.literal("delete_recurring_rule"), ruleId: z.string().min(1) }),
  z.object({ action: z.literal("record_portfolio_event"), event: portfolioEventSchema }),
  z.object({ action: z.literal("delete_portfolio_event"), eventId: z.uuid() }),
  z.object({ action: z.literal("set_portfolio_envelope_policy"), policy: portfolioPolicySchema }),
  z.object({
    action: z.literal("close_cash_flow_month"),
    month: z.string().regex(/^\d{4}-\d{2}$/, "Mois attendu au format AAAA-MM"),
  }),
  z.object({
    action: z.literal("set_ledger_coverage"),
    // `null` est une valeur légitime : elle remet la profondeur à « non déclarée ».
    // Une date postérieure à la date d'observation est refusée : on ne peut pas certifier
    // exhaustif un historique qui n'a pas encore eu lieu.
    startDate: date
      .refine(isRealCalendarDate, "Date inexistante au calendrier")
      .refine(
        (value) => value <= AS_OF_DATE,
        "La couverture ne peut pas être postérieure à la date d'observation",
      )
      .nullable(),
    source: z.enum(["MANUAL", "IMPORT", "API"]),
  }),
  // Les mutations immobilières sont STRICTES de bout en bout : un champ inattendu est
  // refusé plutôt que silencieusement écarté. C'est ce qui garantit qu'une attribution de
  // flux ne pourra jamais transporter un montant ou une catégorie.
  z.object({ action: z.literal("save_real_estate_asset"), asset: realEstateAssetSchema }).strict(),
  z.object({ action: z.literal("archive_real_estate_asset"), propertyId: z.uuid() }).strict(),
  z
    .object({
      action: z.literal("record_real_estate_valuation"),
      valuation: realEstateValuationSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("record_real_estate_capital_event"),
      event: realEstateCapitalEventSchema,
    })
    .strict(),
  z.object({ action: z.literal("delete_real_estate_capital_event"), eventId: z.uuid() }).strict(),
  z
    .object({
      action: z.literal("set_real_estate_operating_terms"),
      terms: realEstateOperatingTermsSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("set_real_estate_financing_link"),
      link: realEstateFinancingLinkSchema,
    })
    .strict(),
  z.object({ action: z.literal("delete_real_estate_financing_link"), linkId: z.uuid() }).strict(),
  z
    .object({
      action: z.literal("attribute_transaction_to_property"),
      transactionId: z.uuid(),
      // `null` détache le flux : c'est une valeur, jamais un oubli.
      propertyId: z.uuid().nullable(),
    })
    .strict(),
]);

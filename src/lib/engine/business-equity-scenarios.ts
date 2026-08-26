import {
  blocker,
  dedupeFlags,
  flag,
  known,
  multiply,
  positiveRatio,
  subtract,
  sumAll,
  unknown,
  type BusinessAmount,
  type BusinessFlag,
} from "@/lib/engine/business-equity-facts";
import { fundingRoundOutcome, type FundingRoundOutcome } from "@/lib/engine/business-ownership";

/**
 * SCÉNARIOS BUSINESS EQUITY
 *
 * Trois décisions réelles : GARDER, VENDRE, LEVER. Chacune produit des conséquences
 * économiques datées, et aucune ne postule un paramètre que l'utilisateur n'a pas donné.
 *
 * AUCUNE HYPOTHÈSE PAR DÉFAUT. Pas de croissance à 2 %, pas de frais de transaction à 3 %,
 * pas de taux d'actualisation implicite. Un paramètre non déclaré ne vaut pas zéro : il rend
 * la grandeur qui en dépend non calculable, et le dit.
 *
 * AUCUNE FISCALITÉ INVENTÉE. LFO ne porte aucune règle de plus-value de cession de titres.
 * Le produit net APRÈS impôt n'existe donc que si l'utilisateur a DÉCLARÉ un taux effectif,
 * et l'assiette à laquelle ce taux s'applique est nommée dans le résultat plutôt que laissée
 * implicite. Le jour où un Tax Engine saura la produire, ce chemin le consommera.
 */

/** Assiette conventionnelle à laquelle le taux DÉCLARÉ par l'utilisateur s'applique. */
export const BUSINESS_SALE_TAX_BASE_CONVENTION =
  "PRODUIT_NET_DE_FRAIS_MOINS_COUT_DE_REVIENT_LIBERE" as const;

const declared = (value: number | null, detail: string): BusinessAmount =>
  value === null ? unknown([blocker("SCENARIO_INPUT_MISSING", undefined, detail)]) : known(value);

// ─── HOLD ───────────────────────────────────────────────────────────────────────────────

export interface BusinessHoldScenarioInput {
  /** Equity value actuelle de la société entière, en devise de reporting. */
  currentEquityValue: BusinessAmount;
  economicRate: BusinessAmount;
  years: number | null;
  /** Croissance annuelle DÉCLARÉE de la valeur. `null` = non déclarée. */
  annualValueGrowth: number | null;
  /** Distribution personnelle annuelle DÉCLARÉE. `null` = non déclarée. */
  annualDistributionToOwner: number | null;
  /** Taux d'actualisation DÉCLARÉ, pour ramener le résultat à aujourd'hui. */
  discountRate: number | null;
}

export interface BusinessHoldScenarioResult {
  horizonYears: number | null;
  terminalEquityValue: BusinessAmount;
  terminalAttributableValue: BusinessAmount;
  cumulativeDistributions: BusinessAmount;
  /** Valeur terminale personnelle + distributions cumulées. */
  totalOwnerValue: BusinessAmount;
  presentValue: BusinessAmount;
  flags: BusinessFlag[];
}

/**
 * Conserver la participation.
 *
 * La valeur croît au taux DÉCLARÉ ; les distributions sont celles DÉCLARÉES, cumulées sans
 * réinvestissement — supposer un réinvestissement serait une seconde hypothèse non demandée.
 */
export function projectBusinessHold(input: BusinessHoldScenarioInput): BusinessHoldScenarioResult {
  const flags: BusinessFlag[] = [];
  const horizon = declared(input.years, "horizon de projection");
  const growth = declared(input.annualValueGrowth, "croissance annuelle de la valeur");
  const distribution = declared(
    input.annualDistributionToOwner,
    "distribution annuelle au détenteur",
  );
  const terminalEquityValue = multiply(
    input.currentEquityValue,
    growth.value === null || horizon.value === null
      ? sumAll([growth, horizon])
      : known((1 + growth.value) ** horizon.value),
  );
  const terminalAttributableValue = multiply(terminalEquityValue, input.economicRate);
  const cumulativeDistributions = multiply(distribution, horizon);
  const totalOwnerValue = sumAll([terminalAttributableValue, cumulativeDistributions]);
  const discount = declared(input.discountRate, "taux d'actualisation");
  return {
    horizonYears: input.years,
    terminalEquityValue,
    terminalAttributableValue,
    cumulativeDistributions,
    totalOwnerValue,
    presentValue: multiply(
      totalOwnerValue,
      discount.value === null || horizon.value === null
        ? sumAll([discount, horizon])
        : known(1 / (1 + discount.value) ** horizon.value),
    ),
    flags: dedupeFlags(flags),
  };
}

// ─── SALE ───────────────────────────────────────────────────────────────────────────────

export interface BusinessSaleScenarioInput {
  /**
   * Base de sortie. `EXIT_MULTIPLE` valorise la société à un multiple de sortie appliqué à
   * l'agrégat ajusté ; `EQUITY_VALUE` part d'une Equity Value de sortie directement connue.
   */
  exitBasis: "EXIT_MULTIPLE" | "EQUITY_VALUE";
  adjustedMetric: BusinessAmount | null;
  exitMultiple: number | null;
  exitEquityValue: BusinessAmount | null;
  /** Dette brute et trésorerie à la sortie : le pont EV → Equity reste obligatoire. */
  grossDebt: BusinessAmount;
  cash: BusinessAmount;
  otherBridgeItems: BusinessAmount;
  economicRate: BusinessAmount;
  /** Part de la détention cédée, dans ]0,1]. */
  saleFraction: number | null;
  /** Taux de frais de transaction DÉCLARÉ. `null` = non déclaré. */
  transactionFeeRate: number | null;
  /** Coût de revient personnel encore attaché à la participation. */
  remainingCostBasis: BusinessAmount;
  /** Taux d'imposition effectif DÉCLARÉ sur la plus-value. `null` = non déclaré. */
  effectiveTaxRate: number | null;
}

export interface BusinessSaleScenarioResult {
  exitEnterpriseValue: BusinessAmount;
  exitEquityValue: BusinessAmount;
  ownershipSold: BusinessAmount;
  grossProceeds: BusinessAmount;
  transactionFees: BusinessAmount;
  preTaxNetProceeds: BusinessAmount;
  releasedCostBasis: BusinessAmount;
  taxableGain: BusinessAmount;
  taxBaseConvention: typeof BUSINESS_SALE_TAX_BASE_CONVENTION;
  estimatedTax: BusinessAmount;
  afterTaxNetProceeds: BusinessAmount;
  /** Valeur personnelle encore détenue après la cession partielle. */
  retainedValue: BusinessAmount;
  flags: BusinessFlag[];
}

export function projectBusinessSale(input: BusinessSaleScenarioInput): BusinessSaleScenarioResult {
  const flags: BusinessFlag[] = [];
  const exitEnterpriseValue =
    input.exitBasis === "EXIT_MULTIPLE"
      ? multiply(
          input.adjustedMetric ?? unknown([blocker("VALUATION_METRIC_MISSING")]),
          declared(input.exitMultiple, "multiple de sortie"),
        )
      : unknown([blocker("VALUATION_BASIS_MISSING", undefined, "Enterprise Value de sortie")]);
  const exitEquityValue =
    input.exitBasis === "EXIT_MULTIPLE"
      ? sumAll([
          exitEnterpriseValue,
          {
            value: input.grossDebt.value === null ? null : -input.grossDebt.value,
            blockers: input.grossDebt.blockers,
            flags: input.grossDebt.flags,
          },
          input.cash,
          input.otherBridgeItems,
        ])
      : (input.exitEquityValue ??
        unknown([blocker("VALUATION_BASIS_MISSING", undefined, "Equity Value de sortie")]));

  const saleFraction = declared(input.saleFraction, "quote-part cédée");
  const ownershipSold = multiply(input.economicRate, saleFraction);
  const grossProceeds = multiply(exitEquityValue, ownershipSold);
  const feeRate = declared(input.transactionFeeRate, "taux de frais de transaction");
  const transactionFees = multiply(grossProceeds, feeRate);
  const preTaxNetProceeds = subtract(grossProceeds, transactionFees);
  const releasedCostBasis = multiply(input.remainingCostBasis, saleFraction);
  const taxableGain = subtract(preTaxNetProceeds, releasedCostBasis);

  if (input.effectiveTaxRate === null) flags.push(flag("TAX_RATE_NOT_DECLARED"));
  const estimatedTax =
    input.effectiveTaxRate === null
      ? unknown([blocker("TAX_RATE_NOT_DECLARED")], flags)
      : multiply(taxableGain, known(input.effectiveTaxRate));
  const afterTaxNetProceeds =
    input.effectiveTaxRate === null
      ? unknown([blocker("TAX_RATE_NOT_DECLARED")], flags)
      : subtract(preTaxNetProceeds, estimatedTax);

  return {
    exitEnterpriseValue,
    exitEquityValue,
    ownershipSold,
    grossProceeds,
    transactionFees,
    preTaxNetProceeds,
    releasedCostBasis,
    taxableGain,
    taxBaseConvention: BUSINESS_SALE_TAX_BASE_CONVENTION,
    estimatedTax,
    afterTaxNetProceeds,
    retainedValue: multiply(
      exitEquityValue,
      multiply(
        input.economicRate,
        saleFraction.value === null ? saleFraction : known(1 - saleFraction.value),
      ),
    ),
    flags: dedupeFlags(flags),
  };
}

// ─── RAISE ──────────────────────────────────────────────────────────────────────────────

export interface BusinessRaiseScenarioInput {
  preMoneyEquityValue: number;
  primaryNewMoney: number;
  secondaryAmount: number | null;
  ownershipBefore: number;
  investorContribution: number;
  preferredRightsKnown: boolean;
  /** Coût de revient personnel avant le tour, pour mesurer l'effet de la souscription. */
  costBasisBefore: BusinessAmount;
}

export interface BusinessRaiseScenarioResult extends FundingRoundOutcome {
  /** Coût de revient personnel après souscription. */
  costBasisAfter: BusinessAmount;
  /** Valeur personnelle rapportée au capital investi, au post-money. */
  impliedMoic: BusinessAmount;
}

export function projectBusinessRaise(
  input: BusinessRaiseScenarioInput,
): BusinessRaiseScenarioResult {
  const outcome = fundingRoundOutcome({
    preMoneyEquityValue: input.preMoneyEquityValue,
    primaryNewMoney: input.primaryNewMoney,
    secondaryAmount: input.secondaryAmount,
    ownershipBefore: input.ownershipBefore,
    investorContribution: input.investorContribution,
    preferredRightsKnown: input.preferredRightsKnown,
  });
  const costBasisAfter = sumAll([input.costBasisBefore, known(input.investorContribution)]);
  return {
    ...outcome,
    costBasisAfter,
    impliedMoic: positiveRatio(
      outcome.positionValueAfter,
      costBasisAfter,
      blocker("INVESTED_CAPITAL_NOT_POSITIVE"),
    ),
  };
}

export { multipleSensitivity, dcfSensitivity } from "@/lib/engine/business-valuation";
export type { SensitivityCell, SensitivityMatrix } from "@/lib/engine/business-valuation";

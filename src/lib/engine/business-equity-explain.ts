import type {
  BusinessAmountScope,
  BusinessBlocker,
  BusinessBlockerCode,
  BusinessBridgeItemCategory,
  BusinessCapitalEventType,
  BusinessCapitalHistorySource,
  BusinessEbitdaAdjustmentCategory,
  BusinessFlag,
  BusinessFlagCode,
  BusinessMetricBasis,
  BusinessPeriodKind,
  BusinessQuality,
  BusinessType,
  BusinessValuationMethod,
} from "@/lib/engine/business-equity-facts";
import type { BusinessBridgeStep } from "@/lib/engine/business-valuation";

/**
 * EXPLICABILITÉ — mise en français des motifs et des étapes.
 *
 * Un utilisateur ne doit JAMAIS lire `BUSINESS_VALUATION_MISSING:2d4c-…`. Il doit lire une
 * phrase qui nomme la société, ce qui manque, et à quelle date. Ce module est le seul
 * endroit du produit où un code technique devient une phrase, et il est pur : il se teste
 * comme le reste du moteur.
 *
 * La traduction ne raconte jamais autre chose que le code. Un motif adouci — « données en
 * cours de complétion » à la place de « aucune dette brute déclarée » — priverait
 * l'utilisateur de l'action exacte qui débloquerait le calcul.
 */

export interface ExplainContext {
  /** Résout un identifiant de société en NOM. L'identifiant n'est jamais affiché. */
  nameOf: (businessId: string) => string;
  asOfDate: string;
}

export function formatBusinessDate(iso: string): string {
  const parsed = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return iso;
  return new Intl.DateTimeFormat("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(parsed);
}

export const BUSINESS_TYPE_LABELS: Record<BusinessType, string> = {
  OPERATING: "Société opérationnelle",
  HOLDING: "Holding",
  STARTUP: "Startup",
  SPV: "Véhicule dédié",
  OTHER: "Autre",
};

export const BUSINESS_METHOD_LABELS: Record<BusinessValuationMethod, string> = {
  EBITDA_MULTIPLE: "Multiple d’EBITDA",
  REVENUE_MULTIPLE: "Multiple de chiffre d’affaires",
  DCF: "Flux de trésorerie actualisés",
  FUNDING_ROUND: "Tour de table",
  EXTERNAL_APPRAISAL: "Expertise externe",
  TRANSACTION: "Transaction réelle",
  USER_ESTIMATE: "Montant déclaré",
  LOOK_THROUGH: "Transparence des participations",
};

/** Ce que la méthode dit d'elle-même : dérivée par le moteur, observée, ou simplement saisie. */
export const BUSINESS_METHOD_NATURE: Record<BusinessValuationMethod, string> = {
  EBITDA_MULTIPLE:
    "Valeur dérivée par le moteur à partir de l’EBITDA ajusté et du multiple déclaré.",
  REVENUE_MULTIPLE:
    "Valeur dérivée par le moteur à partir du chiffre d’affaires et du multiple déclaré.",
  DCF: "Valeur dérivée par le moteur à partir des flux projetés et du WACC déclarés.",
  FUNDING_ROUND: "Valeur issue des termes du tour de table, sous réserve des droits préférentiels.",
  EXTERNAL_APPRAISAL:
    "Valeur observée hors du modèle : elle n’est pas dérivée, elle est constatée.",
  TRANSACTION: "Prix réellement traité. C’est le fait le plus fort dont dispose le moteur.",
  USER_ESTIMATE: "Montant saisi par vous. Ce n’est pas une valorisation dérivée d’une méthode.",
  LOOK_THROUGH: "Valeur dérivée des participations détenues et du bilan propre de la holding.",
};

export const BUSINESS_METRIC_BASIS_LABELS: Record<BusinessMetricBasis, string> = {
  EBITDA: "EBITDA",
  REVENUE: "Chiffre d’affaires",
  EBIT: "Résultat d’exploitation",
};

export const BUSINESS_PERIOD_KIND_LABELS: Record<BusinessPeriodKind, string> = {
  ANNUAL: "Exercice",
  LTM: "12 mois glissants",
  INTERIM: "Période intermédiaire",
};

export const BUSINESS_ADJUSTMENT_CATEGORY_LABELS: Record<BusinessEbitdaAdjustmentCategory, string> =
  {
    OWNER_COMPENSATION: "Rémunération du dirigeant normalisée",
    EXCEPTIONAL: "Élément exceptionnel",
    NON_RECURRING: "Charge ou produit non récurrent",
    PRO_FORMA: "Pro forma déclaré",
    OTHER: "Autre retraitement documenté",
  };

export const BUSINESS_BRIDGE_CATEGORY_LABELS: Record<BusinessBridgeItemCategory, string> = {
  MINORITY_INTERESTS: "Intérêts minoritaires",
  PENSION_PROVISION: "Engagements de retraite",
  EARN_OUT: "Complément de prix",
  SHAREHOLDER_LOAN: "Compte courant d’associé",
  SURPLUS_ASSET: "Actif hors exploitation",
  TRANSACTION_COST: "Frais de transaction",
  OTHER: "Autre élément déclaré",
};

export const BUSINESS_CAPITAL_EVENT_LABELS: Record<BusinessCapitalEventType, string> = {
  OPENING_COST_BASIS: "Coût de revient d’ouverture",
  ACQUISITION: "Acquisition de titres",
  CAPITAL_INJECTION: "Apport en capital",
  SALE: "Cession de titres",
  BUYBACK: "Rachat de titres par la société",
  DIVIDEND: "Dividende",
  DISTRIBUTION: "Distribution",
  CAPITAL_RETURN: "Remboursement de capital",
};

export const BUSINESS_AMOUNT_SCOPE_LABELS: Record<BusinessAmountScope, string> = {
  USER_CASH: "Cash réellement reçu ou versé par vous",
  COMPANY_TOTAL: "Montant total distribué par la société",
};

export const BUSINESS_COVERAGE_LABELS: Record<BusinessCapitalHistorySource, string> = {
  DECLARED_COMPLETE: "Historique déclaré complet",
  PARTIAL: "Historique déclaré partiel",
  UNKNOWN: "Couverture d’historique non déclarée",
};

/**
 * Étapes du pont. Le libellé décrit l'OPÉRATION, pas le champ : « × Multiple » se lit dans
 * une colonne de calcul, « valuation_multiple » ne se lit nulle part.
 */
const BRIDGE_STEP_LABELS: Record<string, string> = {
  METRIC_OBSERVED: "Agrégat observé",
  METRIC_ADJUSTMENT: "Ajustement",
  METRIC_ADJUSTED: "Agrégat ajusté",
  MULTIPLE: "Multiple appliqué",
  ENTERPRISE_VALUE: "Enterprise Value",
  ENTERPRISE_VALUE_OBSERVED: "Enterprise Value observée",
  EQUITY_VALUE: "Equity Value",
  EQUITY_VALUE_OBSERVED: "Equity Value observée",
  GROSS_DEBT: "Dette brute corporate",
  CASH: "Trésorerie",
  BRIDGE_ITEM: "Élément de bridge",
  ECONOMIC_OWNERSHIP: "Droits économiques",
  ATTRIBUTABLE_VALUE: "Valeur personnelle",
  PRE_MONEY: "Valorisation pre-money",
  PRIMARY_NEW_MONEY: "Argent frais primaire",
  POST_MONEY: "Valorisation post-money",
  DCF_EXPLICIT_PV: "Flux actualisés de l’horizon explicite",
  DCF_TERMINAL_PV: "Valeur terminale actualisée",
  LOOK_THROUGH_PARTICIPATION: "Participation détenue",
  LOOK_THROUGH_PARTICIPATIONS: "Total des participations",
};

export function describeBridgeStep(step: BusinessBridgeStep, context: ExplainContext): string {
  const [root, qualifier] = step.key.split(":");
  const base = BRIDGE_STEP_LABELS[root] ?? root;
  if (root === "METRIC_OBSERVED" && qualifier)
    return `${BUSINESS_METRIC_BASIS_LABELS[qualifier as BusinessMetricBasis] ?? base} observé`;
  if (root === "METRIC_ADJUSTED" && qualifier)
    return `${BUSINESS_METRIC_BASIS_LABELS[qualifier as BusinessMetricBasis] ?? base} ajusté`;
  if (root === "METRIC_ADJUSTMENT")
    return (
      step.label ??
      BUSINESS_ADJUSTMENT_CATEGORY_LABELS[qualifier as BusinessEbitdaAdjustmentCategory] ??
      base
    );
  if (root === "BRIDGE_ITEM")
    return (
      step.label ?? BUSINESS_BRIDGE_CATEGORY_LABELS[qualifier as BusinessBridgeItemCategory] ?? base
    );
  if (root === "LOOK_THROUGH_PARTICIPATION" && step.label) return context.nameOf(step.label);
  return base;
}

// ─── Motifs de non-calcul ───────────────────────────────────────────────────────────────

type BlockerPhrase = (item: BusinessBlocker, context: ExplainContext) => string;

const withDetail = (text: string, item: BusinessBlocker) =>
  item.detail ? `${text} (${item.detail})` : text;

const BLOCKER_PHRASES: Record<BusinessBlockerCode, BlockerPhrase> = {
  VALUATION_BASIS_MISSING: (item, context) =>
    withDetail(
      `aucune valorisation ni méthode de valorisation n’est disponible au ${formatBusinessDate(context.asOfDate)}`,
      item,
    ),
  VALUATION_METRIC_MISSING: (item) =>
    withDetail("l’agrégat financier retenu comme base du multiple n’est pas renseigné", item),
  VALUATION_METRIC_NOT_POSITIVE: (item) =>
    withDetail("l’agrégat retenu est nul ou négatif : un multiple ne s’y applique pas", item),
  VALUATION_MULTIPLE_MISSING: (item) => withDetail("aucun multiple n’a été déclaré", item),
  VALUATION_FINANCIAL_PERIOD_MISSING: (item) =>
    withDetail("aucune période financière n’a été saisie avant la date de valorisation", item),
  EV_TO_EQUITY_GROSS_DEBT_MISSING: (item) =>
    withDetail(
      "la dette brute de la société n’est pas déclarée : sans elle, l’Equity Value surévaluerait la participation du montant entier du passif",
      item,
    ),
  EV_TO_EQUITY_CASH_MISSING: (item) =>
    withDetail("la trésorerie de la société n’est pas déclarée", item),
  EQUITY_VALUE_NOT_COMPUTABLE: (item) =>
    withDetail("l’Equity Value ne peut pas être établie à partir des faits connus", item),
  OWNERSHIP_MISSING: (item) => withDetail("aucune détention n’est déclarée à cette date", item),
  ECONOMIC_OWNERSHIP_MISSING: (item) =>
    withDetail(
      "les droits économiques ne sont pas déclarés : la détention juridique ne suffit pas à attribuer une valeur",
      item,
    ),
  CURRENCY_MISSING: (item) => withDetail("la devise du montant n’est pas renseignée", item),
  FX_RATE_MISSING: (item) =>
    withDetail("aucun taux de change daté n’est disponible pour convertir ce montant", item),
  COST_BASIS_HISTORY_MISSING: (item) =>
    withDetail("aucun coût d’acquisition n’a été déclaré", item),
  DISTRIBUTION_HISTORY_MISSING: (item) =>
    withDetail(
      "aucune distribution n’a été déclarée, et l’historique n’est pas certifié complet",
      item,
    ),
  CAPITAL_HISTORY_NOT_DECLARED: (item) =>
    withDetail(
      "l’historique de capital n’est pas déclaré complet : un rendement calculé sur un historique partiel serait faux",
      item,
    ),
  OWNERSHIP_DELTA_MISSING: (item) =>
    withDetail("la quote-part cédée n’est pas renseignée sur cette opération", item),
  INVESTED_CAPITAL_NOT_POSITIVE: (item) =>
    withDetail("le capital investi est nul : aucun multiple de rendement ne s’y rapporte", item),
  HOLDING_CYCLE: (item) =>
    withDetail("les rattachements de holdings forment une boucle de détention", item),
  HOLDING_CHILD_NOT_COMPUTABLE: (item) =>
    withDetail("une filiale rattachée n’est pas dans le périmètre chargé", item),
  HOLDING_STANDALONE_BALANCE_MISSING: (item) =>
    withDetail("le bilan propre de la holding (trésorerie et dette) n’est pas déclaré", item),
  FUNDING_ROUND_TERMS_MISSING: (item) =>
    withDetail("les termes du tour de table sont incomplets", item),
  DCF_ASSUMPTIONS_MISSING: (item) =>
    withDetail("aucune hypothèse de DCF n’a été saisie pour cette société", item),
  DCF_PERIODS_MISSING: (item) => withDetail("le déroulé annuel projeté du DCF est vide", item),
  DCF_PERIOD_INPUTS_MISSING: (item) => withDetail("une année du DCF n’a pas tous ses termes", item),
  DCF_TERMINAL_INVALID: (item) =>
    withDetail(
      "la valeur terminale n’est pas définissable : la croissance perpétuelle doit rester inférieure au WACC",
      item,
    ),
  REVENUE_MISSING: (item) =>
    withDetail("le chiffre d’affaires de la période n’est pas renseigné", item),
  EBITDA_MISSING: (item) => withDetail("l’EBITDA de la période n’est pas renseigné", item),
  EBITDA_NOT_POSITIVE: (item) =>
    withDetail("l’EBITDA est nul ou négatif : le ratio qui en dépend n’existe pas", item),
  PRIOR_PERIOD_MISSING: (item) =>
    withDetail("aucune période antérieure comparable n’est disponible", item),
  PERIOD_KIND_NOT_COMPARABLE: (item) =>
    withDetail("les périodes comparées ne couvrent pas la même durée", item),
  XIRR_SIGNS_INVALID: (item) =>
    withDetail("les flux ne comportent pas au moins une sortie et une entrée", item),
  XIRR_NO_SOLUTION: (item) => withDetail("aucun taux de rendement ne résout ces flux", item),
  XIRR_MULTIPLE_SOLUTIONS: (item) =>
    withDetail("plusieurs taux de rendement résolvent ces flux : aucun n’est le bon", item),
  XIRR_INPUTS_INCOMPLETE: (item) =>
    withDetail("un flux ou la valeur finale manque pour calculer le rendement", item),
  SCENARIO_INPUT_MISSING: (item) =>
    withDetail("une hypothèse du scénario n’a pas été déclarée", item),
  TAX_RATE_NOT_DECLARED: (item) =>
    withDetail(
      "aucun taux d’imposition effectif n’a été déclaré, et LFO ne porte aucune règle de plus-value de cession",
      item,
    ),
};

/** Phrase complète, société nommée. Jamais un identifiant, jamais un code. */
export function describeBlocker(item: BusinessBlocker, context: ExplainContext): string {
  const phrase = BLOCKER_PHRASES[item.code]?.(item, context) ?? "une donnée nécessaire manque";
  return item.businessId ? `${context.nameOf(item.businessId)} : ${phrase}` : phrase;
}

const FLAG_PHRASES: Record<BusinessFlagCode, string> = {
  VALUATION_STALE:
    "La valorisation retenue a plus d’un an. Elle reste utilisée telle quelle : elle n’est ni indexée ni corrigée.",
  VALUATION_IS_USER_INPUT: "Ce montant est une saisie, pas une valorisation dérivée d’une méthode.",
  CONFLICTING_VALUATIONS:
    "Plusieurs valorisations portent la même date. La plus factuelle est retenue, l’écart reste affiché.",
  MULTIPLE_RANGE_DECLARED:
    "Une fourchette de multiples est déclarée. Seul le multiple central alimente le bilan.",
  EBITDA_ADJUSTED: "L’EBITDA retenu est ajusté de retraitements déclarés.",
  EBITDA_NEGATIVE:
    "L’EBITDA observé est négatif. Un multiple d’EBITDA n’y a pas de sens économique.",
  PRO_FORMA_ADJUSTMENT_INCLUDED:
    "Un ajustement pro forma est inclus : le résultat retenu n’est plus un résultat constaté.",
  LOOK_THROUGH_VALUATION:
    "Valeur dérivée par transparence des participations détenues et du bilan propre.",
  PREFERRED_RIGHTS_UNKNOWN:
    "Les droits préférentiels ne sont pas connus. Post-money × détention est une BORNE HAUTE de la valeur économique réelle, pas sa mesure.",
  FULLY_DILUTED_UNKNOWN: "La détention pleinement diluée n’est pas déclarée.",
  SHARE_COUNTS_INCONSISTENT:
    "Le nombre de titres et le taux déclaré ne concordent pas. Le taux dérivé des titres est retenu.",
  CAPITAL_HISTORY_PARTIAL:
    "L’historique de capital n’est pas déclaré complet. Les montants affichés sont des bornes basses.",
  DISTRIBUTION_DERIVED_PRO_RATA:
    "La part personnelle a été dérivée du montant social au prorata des droits économiques.",
  DIRECT_AND_INDIRECT_OWNERSHIP:
    "Cette société est détenue à la fois directement et au travers d’une holding.",
  LOOK_THROUGH_OWNERSHIP_EXCEEDS_ONE:
    "La détention économique effective dépasse 100 % : une même participation est comptée deux fois.",
  FX_STALE: "Le taux de change utilisé n’est plus celui du jour.",
  FX_PNL_NOT_ISOLATED: "L’effet de change n’est pas isolé de la performance économique.",
  PERIOD_KIND_MIXED:
    "L’historique mélange des natures de période. Seules celles de même nature sont comparées.",
  FREE_CASH_FLOW_DERIVED:
    "Le free cash flow est dérivé de l’exploitation, il n’a pas été déclaré tel quel.",
  TAX_RATE_NOT_DECLARED:
    "Aucun taux d’imposition n’est déclaré : les montants après impôt restent non calculables.",
  OWNERSHIP_FULLY_EXITED: "La participation est entièrement cédée : elle ne vaut plus rien.",
};

export function describeFlag(item: BusinessFlag, context: ExplainContext): string {
  const phrase = FLAG_PHRASES[item.code] ?? "";
  const suffix = item.detail ? ` (${item.detail})` : "";
  return item.businessId
    ? `${context.nameOf(item.businessId)} — ${phrase}${suffix}`
    : `${phrase}${suffix}`;
}

export type BusinessQualityLevel = "COMPLETE" | "PARTIAL" | "BLOCKED";

export interface BusinessQualitySummary {
  level: BusinessQualityLevel;
  headline: string;
  reasons: string[];
  reserves: string[];
}

/**
 * Résumé lisible d'une qualité de résultat.
 *
 * « Calculable » ne se dit que d'un résultat réellement calculé. Une valeur non calculable
 * ne peut pas être annoncée « calculable » sous prétexte qu'aucune société n'a été retenue
 * dans l'agrégat : c'est exactement l'erreur que la version précédente commettait.
 */
export function summariseQuality(
  quality: BusinessQuality,
  computed: boolean,
  context: ExplainContext,
): BusinessQualitySummary {
  const reasons = quality.blockers.map((item) => describeBlocker(item, context));
  const reserves = quality.flags.map((item) => describeFlag(item, context)).filter(Boolean);
  if (!computed) {
    return {
      level: "BLOCKED",
      headline: "Valeur non calculable",
      reasons,
      reserves,
    };
  }
  if (reasons.length > 0 || reserves.length > 0) {
    return {
      level: "PARTIAL",
      headline:
        reasons.length > 0 ? "Calculée, avec des points ouverts" : "Calculée, avec réserves",
      reasons,
      reserves,
    };
  }
  return { level: "COMPLETE", headline: "Calculée sans réserve", reasons: [], reserves: [] };
}

/**
 * Phrase d'échec complète, telle qu'elle doit apparaître à l'écran. C'est le remplacement
 * exact de l'ancien affichage brut d'un code suivi d'un UUID.
 */
export function explainNotComputable(
  blockers: BusinessBlocker[],
  context: ExplainContext,
  subject = "la valeur",
): string {
  if (blockers.length === 0) return `Impossible de calculer ${subject}.`;
  const phrases = [...new Set(blockers.map((item) => describeBlocker(item, context)))];
  return `Impossible de calculer ${subject} : ${phrases.join(" ; ")}.`;
}

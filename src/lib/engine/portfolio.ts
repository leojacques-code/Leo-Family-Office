import type { AggregateStatus, ReconciliationState } from "@/lib/engine/balance-sheet";
import { effectiveCashFlowKind, categoryIndex } from "@/lib/engine/cash-flow";
import type {
  ExpenseCategory,
  FinancialAccount,
  LotMatchingMethod,
  PortfolioEnvelopePolicy,
  PortfolioEvent,
  PortfolioEventType,
  PortfolioFlowDirection,
  Position,
  Transaction,
} from "@/lib/types";

/**
 * PORTFOLIO DATA FOUNDATION
 *
 * Ce moteur ne produit AUCUNE analytique de performance. Il répond à quatre questions de
 * fait, et refuse de répondre quand il ne sait pas :
 *
 *   1. comment la position s'est constituée (lots, coût de revient) ;
 *   2. quels événements l'ont affectée (le ledger) ;
 *   3. quel cash appartient à l'enveloppe ;
 *   4. ce qui est réellement connu, et ce qui ne l'est pas.
 *
 * Quatre règles le fondent.
 *
 * RÈGLE 1 — Le bilan reste la vérité des montants. Ce moteur ne produit aucune ligne de
 * bilan et n'entre dans aucun total patrimonial. Il lit `positions` et `accounts` pour
 * MESURER UN ÉCART, jamais pour recomposer une valeur. Le Canonical Balance Sheet est
 * strictement identique selon qu'un ledger existe ou non.
 *
 * RÈGLE 2 — Une observation n'est pas un historique. Une enveloppe sans couverture
 * déclarée garde son état observé intact et le ledger dit simplement qu'il ne l'explique
 * pas. Aucun achat n'est jamais reconstitué pour faire boucler une position.
 *
 * RÈGLE 3 — La convention d'appariement ne se devine pas. Sans convention déclarée, et
 * dès qu'il existe plus d'un lot ouvert, le coût de revient cédé est `NOT_COMPUTABLE`.
 * La quantité, elle, reste connue : elle ne dépend d'aucune convention.
 *
 * RÈGLE 4 — Le portefeuille ne crée pas de seconde vérité Cash Flow. Un virement
 * banque → PEA est un flux EXTERNE au portefeuille et une jambe déjà classée du ledger
 * bancaire ; le moteur pointe cette jambe et signale une classification incohérente, il
 * ne la corrige pas et n'en fabrique pas une autre.
 *
 * Aucune conversion de change n'est faite ici. Le FX Engine reste l'unique moteur de
 * change du produit, et convertir un flux historique à un taux qu'on n'a pas observé
 * inventerait une opération de change qui n'a peut-être jamais eu lieu : une enveloppe
 * dont le ledger mélange les devises est déclarée non réconciliable, pas convertie.
 */

/** Tolérance de réconciliation du ledger, en unités de la devise de l'enveloppe. */
export const PORTFOLIO_TOLERANCE = 0.01;
/** Tolérance de quantité : les fractions de parts se comptent au dix-millième. */
export const QUANTITY_TOLERANCE = 1e-6;

/**
 * Position d'un type d'événement vis-à-vis de la frontière de l'enveloppe. C'est une
 * propriété de la NATURE de l'événement, donc dérivée et jamais saisie : un utilisateur
 * ne peut pas décréter qu'un achat est un apport.
 */
export const PORTFOLIO_FLOW_DIRECTION: Record<PortfolioEventType, PortfolioFlowDirection> = {
  OPENING_POSITION: "OPENING",
  OPENING_CASH: "OPENING",
  CONTRIBUTION: "EXTERNAL_IN",
  TRANSFER_IN: "EXTERNAL_IN",
  WITHDRAWAL: "EXTERNAL_OUT",
  TRANSFER_OUT: "EXTERNAL_OUT",
  BUY: "INTERNAL",
  SELL: "INTERNAL",
  DIVIDEND: "INTERNAL",
  INTEREST: "INTERNAL",
  FEE: "INTERNAL",
  TAX: "INTERNAL",
};

const ACQUISITION_TYPES = new Set<PortfolioEventType>(["OPENING_POSITION", "BUY", "TRANSFER_IN"]);
const DISPOSAL_TYPES = new Set<PortfolioEventType>(["SELL", "TRANSFER_OUT"]);

/** Un événement porte-t-il une entrée d'instrument ? Un transfert de cash n'en est pas une. */
export function isAcquisition(event: PortfolioEvent): boolean {
  return ACQUISITION_TYPES.has(event.type) && event.securityId !== null;
}

export function isDisposal(event: PortfolioEvent): boolean {
  return DISPOSAL_TYPES.has(event.type) && event.securityId !== null;
}

/**
 * Lot d'acquisition ouvert. Son identité EST celle de l'événement d'acquisition : un lot
 * n'a pas d'existence propre, il est la trace d'un fait.
 */
export interface PortfolioLot {
  /** Identifiant de l'événement d'acquisition qui a ouvert le lot. */
  eventId: string;
  accountId: string;
  securityId: string;
  acquiredAt: string;
  currency: string;
  initialQuantity: number;
  openQuantity: number;
  /** Coût d'acquisition total du lot. `null` = non déterminable depuis les faits saisis. */
  totalCost: number | null;
  /** Coût unitaire dérivé. `null` quand le coût total ne l'est pas. */
  unitCost: number | null;
  /** Coût de revient du reliquat encore ouvert. */
  openCost: number | null;
  flags: string[];
}

export interface PortfolioLotMatch {
  lotEventId: string;
  quantity: number;
  cost: number | null;
}

export interface PortfolioDisposal {
  eventId: string;
  accountId: string;
  securityId: string;
  date: string;
  quantity: number;
  /** Produit net encaissé dans l'enveloppe. `null` = non déterminable. */
  netProceeds: number | null;
  /** Coût de revient apparié. `null` quand la convention ou un coût manque. */
  matchedCost: number | null;
  /** Produit net − coût apparié. `null` dès qu'un des deux manque. */
  realisedPnL: number | null;
  method: LotMatchingMethod | null;
  matches: PortfolioLotMatch[];
  flags: string[];
}

export interface PortfolioHolding {
  accountId: string;
  securityId: string;
  securityName: string;
  ticker: string | null;
  assetClass: string | null;
  currency: string | null;
  /** Quantité dérivée du ledger. `null` si un événement ne porte pas sa quantité. */
  ledgerQuantity: number | null;
  /** Quantité de l'état observé (`position_snapshots`). `null` si non renseignée. */
  observedQuantity: number | null;
  quantityGap: number | null;
  quantityState: ReconciliationState;
  /** Coût de revient du stock ouvert, dérivé du ledger. */
  ledgerCostBasis: number | null;
  costBasisStatus: AggregateStatus;
  /** Coût de revient tel qu'observé sur la position. Autre provenance, autre vérité. */
  observedCostBasis: number | null;
  costBasisGap: number | null;
  lots: PortfolioLot[];
  flags: string[];
}

/** État de la déclaration de profondeur d'historique d'une enveloppe. */
export type PortfolioCoverageStatus =
  /** Rien n'est déclaré : le ledger n'explique rien, l'observation reste seule. */
  | "UNDECLARED"
  /** Couverture déclarée et ancrages présents : le ledger est exploitable. */
  | "DECLARED"
  /** Couverture déclarée mais sans ancrage de cash : la série de cash ne démarre nulle part. */
  | "DECLARED_WITHOUT_CASH_ANCHOR"
  /** Des événements existent hors de la fenêtre déclarée exhaustive. */
  | "PARTIAL";

export interface PortfolioFlowTotals {
  /**
   * Argent NEUF entré dans l'enveloppe. Jamais un dividende, jamais une ouverture.
   * `null` dès qu'un apport est en nature : sa valeur n'est pas un mouvement de cash.
   */
  externalIn: number | null;
  externalOut: number | null;
  /** Dividendes et coupons encaissés dans l'enveloppe. Rendement, pas apport. */
  income: number | null;
  /** Frais supportés : composante des opérations plus événements de frais dédiés. */
  fees: number | null;
  taxes: number | null;
}

export interface PortfolioEnvelopeLedger {
  accountId: string;
  accountName: string;
  /** Devise comptable de l'enveloppe : seule devise où une réconciliation a un sens. */
  currency: string;
  policy: PortfolioEnvelopePolicy | null;
  lotMatchingMethod: LotMatchingMethod | null;
  coverageStart: string | null;
  coverageStatus: PortfolioCoverageStatus;
  eventCount: number;
  /** Descriptif seulement : trouver un événement ne prouve pas qu'il n'y en a pas avant. */
  firstEventDate: string | null;
  lastEventDate: string | null;
  /** Cash d'enveloppe dérivé du ledger, en devise de l'enveloppe. `null` = non dérivable. */
  ledgerCash: number | null;
  /** Cash d'enveloppe observé (positions `isCash`), même devise. */
  observedCash: number | null;
  cashGap: number | null;
  cashState: ReconciliationState;
  holdings: PortfolioHolding[];
  disposals: PortfolioDisposal[];
  /** Coût de revient total du stock ouvert. `null` dès qu'une ligne n'est pas calculable. */
  openCostBasis: number | null;
  costBasisStatus: AggregateStatus;
  /** PnL réalisé cumulé sur la fenêtre couverte. `null` dès qu'une cession n'est pas calculable. */
  realisedPnL: number | null;
  flows: PortfolioFlowTotals;
  flags: string[];
}

export interface PortfolioLedger {
  asOfDate: string;
  envelopes: PortfolioEnvelopeLedger[];
  /** Événements rattachés à un compte qui n'est pas une enveloppe connue. */
  orphanEventIds: string[];
  quality: { status: AggregateStatus; blockers: string[]; flags: string[] };
}

export interface BuildPortfolioLedgerInput {
  asOfDate: string;
  accounts: FinancialAccount[];
  positions: Position[];
  events: PortfolioEvent[];
  policies?: PortfolioEnvelopePolicy[];
  /** Ledger bancaire, lu en LECTURE SEULE pour contrôler la cohérence des flux externes. */
  transactions?: Transaction[];
  expenseCategories?: ExpenseCategory[];
}

/**
 * Prédicat d'enveloppe du ledger. Il reprend la définition du bilan (tout compte qui
 * n'est ni bancaire ni d'épargne) SANS sa condition de solde positif : une enveloppe
 * momentanément à découvert perd sa ligne d'actif au bilan, elle ne perd pas son
 * historique d'opérations.
 */
function isLedgerEnvelope(account: FinancialAccount): boolean {
  return account.type !== "BANK" && account.type !== "SAVINGS";
}

/** Ordre canonique du ledger : la date, puis l'ordre de saisie pour départager. */
function chronological(left: PortfolioEvent, right: PortfolioEvent): number {
  if (left.eventDate !== right.eventDate) return left.eventDate.localeCompare(right.eventDate);
  const leftOpening = PORTFOLIO_FLOW_DIRECTION[left.type] === "OPENING" ? 0 : 1;
  const rightOpening = PORTFOLIO_FLOW_DIRECTION[right.type] === "OPENING" ? 0 : 1;
  if (leftOpening !== rightOpening) return leftOpening - rightOpening;
  return left.id.localeCompare(right.id);
}

/**
 * Coût d'acquisition « tout compris » d'un événement.
 *
 * Le mouvement de cash observé prime : c'est ce qui est réellement sorti de l'enveloppe,
 * frais et taxes inclus. À défaut, la reconstitution brut + frais + taxes n'est retenue
 * que si les TROIS composantes sont connues. Des frais inconnus ne sont pas des frais
 * nuls : ils rendent le coût inconnu.
 */
function acquisitionCost(event: PortfolioEvent): { cost: number | null; flags: string[] } {
  const flags: string[] = [];
  const fromCash =
    event.envelopeCashAmount !== null && event.envelopeCashAmount < 0
      ? -event.envelopeCashAmount
      : null;
  const gross = event.grossAmount;
  const rebuilt =
    gross !== null && event.feeAmount !== null && event.taxAmount !== null
      ? gross + event.feeAmount + event.taxAmount
      : null;
  if (fromCash !== null && rebuilt !== null && Math.abs(fromCash - rebuilt) > PORTFOLIO_TOLERANCE) {
    flags.push(`ACQUISITION_CASH_MISMATCH:${event.id}`);
  }
  if (fromCash !== null) return { cost: fromCash, flags };
  if (rebuilt !== null) return { cost: rebuilt, flags };
  if (gross !== null && (event.feeAmount === null || event.taxAmount === null)) {
    flags.push(`ACQUISITION_FEES_UNKNOWN:${event.id}`);
  } else {
    flags.push(`ACQUISITION_COST_MISSING:${event.id}`);
  }
  return { cost: null, flags };
}

/**
 * Produit net d'une cession, selon la même hiérarchie de preuve que le coût d'acquisition.
 *
 * Un transfert sortant de titres n'a pas de produit : rien n'est vendu, rien n'est réalisé.
 * Ce n'est pas une donnée manquante, c'est une grandeur sans objet.
 */
function disposalProceeds(event: PortfolioEvent): { proceeds: number | null; flags: string[] } {
  const flags: string[] = [];
  if (event.type === "TRANSFER_OUT")
    return { proceeds: null, flags: [`TRANSFER_OUT_NO_PROCEEDS:${event.id}`] };
  const fromCash =
    event.envelopeCashAmount !== null && event.envelopeCashAmount > 0
      ? event.envelopeCashAmount
      : null;
  const rebuilt =
    event.grossAmount !== null && event.feeAmount !== null && event.taxAmount !== null
      ? event.grossAmount - event.feeAmount - event.taxAmount
      : null;
  if (fromCash !== null && rebuilt !== null && Math.abs(fromCash - rebuilt) > PORTFOLIO_TOLERANCE) {
    flags.push(`DISPOSAL_CASH_MISMATCH:${event.id}`);
  }
  if (fromCash !== null) return { proceeds: fromCash, flags };
  if (rebuilt !== null) return { proceeds: rebuilt, flags };
  flags.push(`DISPOSAL_PROCEEDS_MISSING:${event.id}`);
  return { proceeds: null, flags };
}

function makeLot(event: PortfolioEvent): PortfolioLot {
  const quantity = event.quantity ?? 0;
  const { cost, flags } = acquisitionCost(event);
  // Un transfert entrant de titres n'apporte aucun prix : son coût de revient est celui
  // du lot d'origine, que LFO ne connaît pas. Le déclarer nul serait une plus-value
  // fabriquée à la première vente.
  const transferFlags =
    event.type === "TRANSFER_IN" && cost === null ? [`TRANSFER_IN_COST_UNKNOWN:${event.id}`] : [];
  return {
    eventId: event.id,
    accountId: event.accountId,
    securityId: event.securityId as string,
    acquiredAt: event.eventDate,
    currency: event.currency,
    initialQuantity: quantity,
    openQuantity: quantity,
    totalCost: cost,
    unitCost: cost === null || quantity === 0 ? null : cost / quantity,
    openCost: cost,
    flags: [...flags, ...transferFlags],
  };
}

interface MatchOutcome {
  matches: PortfolioLotMatch[];
  cost: number | null;
  flags: string[];
}

/**
 * Consomme des lots pour une cession, selon la convention DÉCLARÉE.
 *
 * Sans convention déclarée, l'appariement n'est admis que s'il est mécaniquement
 * univoque : un seul lot ouvert. Dès qu'il y en a deux, le coût cédé dépend d'un choix
 * comptable que le moteur n'a pas à faire ; il rend `null` et le dit.
 *
 * La quantité, elle, est toujours retirée des lots : elle ne dépend d'aucune convention,
 * et laisser les lots inchangés ferait réapparaître à la vente suivante des titres déjà
 * cédés.
 */
function matchDisposal(
  lots: PortfolioLot[],
  event: PortfolioEvent,
  method: LotMatchingMethod | null,
): MatchOutcome {
  const flags: string[] = [];
  const requested = event.quantity ?? 0;
  const open = lots.filter((lot) => lot.openQuantity > QUANTITY_TOLERANCE);
  const available = open.reduce((sum, lot) => sum + lot.openQuantity, 0);
  if (requested - available > QUANTITY_TOLERANCE) {
    flags.push(`LEDGER_OVERSOLD:${event.securityId}`);
  }

  const effectiveMethod: LotMatchingMethod | null = method ?? (open.length <= 1 ? "FIFO" : null);
  if (method === null && open.length > 1) {
    flags.push(`LOT_MATCHING_UNDECLARED:${event.id}`);
  }

  if (effectiveMethod === "WEIGHTED_AVERAGE") {
    const knownCost = open.every((lot) => lot.openCost !== null);
    const totalCost = knownCost ? open.reduce((sum, lot) => sum + (lot.openCost ?? 0), 0) : null;
    const unit = totalCost === null || available === 0 ? null : totalCost / available;
    const matches: PortfolioLotMatch[] = [];
    let remaining = requested;
    for (const lot of open) {
      if (remaining <= QUANTITY_TOLERANCE) break;
      const taken = Math.min(lot.openQuantity, remaining);
      remaining -= taken;
      lot.openQuantity -= taken;
      lot.openCost = unit === null ? null : Math.max(0, (lot.openCost ?? 0) - unit * taken);
      matches.push({
        lotEventId: lot.eventId,
        quantity: taken,
        cost: unit === null ? null : unit * taken,
      });
    }
    const consumed = requested - remaining;
    // Un stock insuffisant rend le coût cédé inconnu, comme sur les autres conventions :
    // rendre le coût des seuls titres trouvés donnerait une plus-value trop belle.
    const oversold = remaining > QUANTITY_TOLERANCE;
    if (unit === null || oversold) flags.push(`COST_BASIS_UNKNOWN:${event.id}`);
    return { matches, cost: unit === null || oversold ? null : unit * consumed, flags };
  }

  let ordered: PortfolioLot[];
  if (effectiveMethod === "SPECIFIC_LOT") {
    const designated = event.matchedAcquisitionEventId;
    if (!designated) {
      flags.push(`SPECIFIC_LOT_REFERENCE_MISSING:${event.id}`);
      ordered = [...open];
    } else {
      const target = open.find((lot) => lot.eventId === designated);
      if (!target) {
        flags.push(`SPECIFIC_LOT_NOT_OPEN:${event.id}`);
        ordered = [...open];
      } else {
        ordered = [target, ...open.filter((lot) => lot.eventId !== designated)];
      }
    }
  } else if (effectiveMethod === "LIFO") {
    ordered = [...open].reverse();
  } else {
    ordered = [...open];
  }

  const matches: PortfolioLotMatch[] = [];
  let remaining = requested;
  let cost: number | null = 0;
  let costKnown = effectiveMethod !== null;
  for (const lot of ordered) {
    if (remaining <= QUANTITY_TOLERANCE) break;
    const taken = Math.min(lot.openQuantity, remaining);
    remaining -= taken;
    const unit = lot.unitCost;
    const share = unit === null ? null : unit * taken;
    if (share === null) costKnown = false;
    lot.openQuantity -= taken;
    lot.openCost = unit === null ? null : Math.max(0, (lot.openCost ?? 0) - unit * taken);
    matches.push({ lotEventId: lot.eventId, quantity: taken, cost: share });
    if (cost !== null && share !== null) cost += share;
  }
  if (remaining > QUANTITY_TOLERANCE) costKnown = false;
  if (!costKnown) {
    cost = null;
    flags.push(`COST_BASIS_UNKNOWN:${event.id}`);
  }
  return { matches, cost, flags };
}

/** Somme qui devient `null` dès qu'une composante est inconnue. Aucune somme partielle. */
function strictSum(values: Array<number | null>): number | null {
  let total = 0;
  for (const value of values) {
    if (value === null) return null;
    total += value;
  }
  return total;
}

function reconcileState(
  derived: number | null,
  observed: number | null,
  tolerance: number,
): { gap: number | null; state: ReconciliationState } {
  if (derived === null || observed === null) return { gap: null, state: "MISSING" };
  const gap = observed - derived;
  if (Math.abs(gap) <= tolerance) return { gap, state: "RECONCILED" };
  return { gap, state: gap > 0 ? "UNDER_EXPLAINED" : "OVER_EXPLAINED" };
}

/**
 * Contrôle de cohérence avec le ledger bancaire. Aucune écriture, aucune reclassification :
 * le moteur constate et signale.
 */
function crossCheckCashFlow(
  event: PortfolioEvent,
  transactions: Map<string, Transaction>,
  categories: Map<string, ExpenseCategory>,
): string[] {
  const direction = PORTFOLIO_FLOW_DIRECTION[event.type];
  const flags: string[] = [];
  if (direction === "INTERNAL" && event.transactionId !== null) {
    // Un arbitrage interne à l'enveloppe ne traverse aucun compte bancaire. Le rattacher
    // à une transaction ferait compter deux fois le même euro dans le Cash Flow.
    flags.push(`INTERNAL_EVENT_LINKED_TO_BANK:${event.id}`);
    return flags;
  }
  if (direction !== "EXTERNAL_IN" && direction !== "EXTERNAL_OUT") return flags;
  // Un transfert de TITRES ne traverse aucun compte bancaire : lui réclamer une jambe de
  // trésorerie serait exiger une écriture qui n'existe pas.
  if (event.securityId !== null) return flags;
  if (event.transactionId === null) {
    flags.push(`EXTERNAL_FLOW_UNLINKED:${event.id}`);
    return flags;
  }
  const transaction = transactions.get(event.transactionId);
  if (!transaction) {
    flags.push(`EXTERNAL_FLOW_TRANSACTION_MISSING:${event.id}`);
    return flags;
  }
  const kind = effectiveCashFlowKind(transaction, categories);
  // Un virement vers une enveloppe déplace un actif : ce n'est jamais une dépense
  // patrimoniale. Le portefeuille le signale, le Cash Flow reste seul à le corriger.
  if (kind === "EXPENSE") flags.push(`EXTERNAL_FLOW_CLASSIFIED_AS_EXPENSE:${event.id}`);
  const declared = event.envelopeCashAmount;
  if (declared !== null && transaction.currency === event.currency) {
    if (Math.abs(Math.abs(declared) - Math.abs(transaction.amount)) > PORTFOLIO_TOLERANCE) {
      flags.push(`EXTERNAL_FLOW_AMOUNT_MISMATCH:${event.id}`);
    }
  }
  return flags;
}

function buildEnvelope(
  account: FinancialAccount,
  events: PortfolioEvent[],
  positions: Position[],
  policy: PortfolioEnvelopePolicy | null,
  transactions: Map<string, Transaction>,
  categories: Map<string, ExpenseCategory>,
): PortfolioEnvelopeLedger {
  const flags: string[] = [];
  const ordered = [...events].sort(chronological);
  const method = policy?.lotMatchingMethod ?? null;
  const coverageStart = policy?.ledgerCoverageStart ?? null;

  const foreign = ordered.filter(
    (event) => event.currency.toUpperCase() !== account.currency.toUpperCase(),
  );
  if (foreign.length > 0) {
    // Additionner deux devises sans taux daté observé inventerait une opération de change.
    flags.push(`LEDGER_MULTI_CURRENCY:${account.id}`);
  }

  for (const event of ordered) {
    flags.push(...crossCheckCashFlow(event, transactions, categories));
  }

  // ------- Cash d'enveloppe -------
  const anchors = ordered.filter((event) => event.type === "OPENING_CASH");
  if (anchors.length > 1) flags.push(`MULTIPLE_CASH_ANCHORS:${account.id}`);
  const anchor = anchors[0] ?? null;
  const afterAnchor = ordered.filter(
    (event) => event.type !== "OPENING_CASH" && event.type !== "OPENING_POSITION",
  );
  const deltas = afterAnchor.map((event) => event.envelopeCashAmount);
  const anchorLevel = anchor?.envelopeCashAmount ?? null;
  const ledgerCash =
    anchor === null || foreign.length > 0 ? null : strictSum([anchorLevel, ...deltas]);
  if (anchor !== null && ledgerCash === null && foreign.length === 0) {
    flags.push(`LEDGER_CASH_INCOMPLETE:${account.id}`);
  }

  const cashPositions = positions.filter((position) => position.isCash);
  const foreignCash = cashPositions.filter(
    (position) => position.currency.toUpperCase() !== account.currency.toUpperCase(),
  );
  const observedCash =
    cashPositions.length === 0 || foreignCash.length > 0
      ? null
      : cashPositions.reduce((sum, position) => sum + position.value, 0);
  const cash = reconcileState(ledgerCash, observedCash, PORTFOLIO_TOLERANCE);

  // ------- Lots, quantités, cessions -------
  const lotsBySecurity = new Map<string, PortfolioLot[]>();
  const quantityBySecurity = new Map<string, number | null>();
  const disposals: PortfolioDisposal[] = [];
  const securityIds = new Set<string>();

  for (const event of ordered) {
    if (event.securityId === null) continue;
    securityIds.add(event.securityId);
    const lots = lotsBySecurity.get(event.securityId) ?? [];
    if (!lotsBySecurity.has(event.securityId)) lotsBySecurity.set(event.securityId, lots);
    const current = quantityBySecurity.get(event.securityId) ?? 0;

    if (isAcquisition(event)) {
      const lot = makeLot(event);
      lots.push(lot);
      flags.push(...lot.flags);
      quantityBySecurity.set(
        event.securityId,
        current === null || event.quantity === null ? null : current + event.quantity,
      );
      continue;
    }
    if (isDisposal(event)) {
      const outcome = matchDisposal(lots, event, method);
      const { proceeds, flags: proceedFlags } = disposalProceeds(event);
      const realised = proceeds === null || outcome.cost === null ? null : proceeds - outcome.cost;
      disposals.push({
        eventId: event.id,
        accountId: account.id,
        securityId: event.securityId,
        date: event.eventDate,
        quantity: event.quantity ?? 0,
        netProceeds: proceeds,
        matchedCost: outcome.cost,
        realisedPnL: realised,
        method,
        matches: outcome.matches,
        flags: [...outcome.flags, ...proceedFlags],
      });
      flags.push(...outcome.flags, ...proceedFlags);
      quantityBySecurity.set(
        event.securityId,
        current === null || event.quantity === null ? null : current - event.quantity,
      );
      continue;
    }
    // Dividende, coupon, frais ou taxe rattachés à un instrument : aucun effet sur la
    // quantité détenue. Un dividende n'est pas une part de plus.
    if (!quantityBySecurity.has(event.securityId)) quantityBySecurity.set(event.securityId, 0);
  }

  const holdings: PortfolioHolding[] = [...securityIds].map((securityId) => {
    const lots = lotsBySecurity.get(securityId) ?? [];
    const sample =
      ordered.find((event) => event.securityId === securityId && event.securityName !== null) ??
      ordered.find((event) => event.securityId === securityId) ??
      null;
    const ledgerQuantity = quantityBySecurity.get(securityId) ?? null;
    const openLots = lots.filter((lot) => lot.openQuantity > QUANTITY_TOLERANCE);
    const ledgerCostBasis = strictSum(openLots.map((lot) => lot.openCost));
    // Rapprochement par instrument, jamais par libellé quand l'identifiant est connu :
    // un renommage de titre ne doit pas casser une réconciliation.
    const matched = positions.filter((position) => {
      if (position.isCash) return false;
      if (position.securityId !== undefined) return position.securityId === securityId;
      return sample !== null && position.securityName === sample.securityName;
    });
    const observedQuantity =
      matched.length === 0
        ? null
        : matched.every((position) => position.quantity !== undefined)
          ? matched.reduce((sum, position) => sum + (position.quantity ?? 0), 0)
          : null;
    const observedCostBasis =
      matched.length === 0
        ? null
        : matched.every((position) => position.costBasis !== undefined)
          ? matched.reduce((sum, position) => sum + (position.costBasis ?? 0), 0)
          : null;
    const quantity = reconcileState(ledgerQuantity, observedQuantity, QUANTITY_TOLERANCE);
    const holdingFlags: string[] = [];
    if (ledgerQuantity !== null && ledgerQuantity < -QUANTITY_TOLERANCE) {
      holdingFlags.push(`LEDGER_NEGATIVE_QUANTITY:${securityId}`);
    }
    return {
      accountId: account.id,
      securityId,
      securityName: sample?.securityName ?? "",
      ticker: sample?.ticker ?? null,
      assetClass: sample?.assetClass ?? null,
      currency: sample?.currency ?? null,
      ledgerQuantity,
      observedQuantity,
      quantityGap: quantity.gap,
      quantityState: quantity.state,
      ledgerCostBasis,
      costBasisStatus: ledgerCostBasis === null ? "NOT_COMPUTABLE" : "COMPLETE",
      observedCostBasis,
      costBasisGap:
        ledgerCostBasis === null || observedCostBasis === null
          ? null
          : observedCostBasis - ledgerCostBasis,
      lots,
      flags: holdingFlags,
    };
  });

  flags.push(...holdings.flatMap((holding) => holding.flags));

  const openCostBasis =
    holdings.length === 0 ? null : strictSum(holdings.map((holding) => holding.ledgerCostBasis));
  const realisedPnL =
    disposals.length === 0 ? null : strictSum(disposals.map((item) => item.realisedPnL));

  /** Somme de mouvements de CASH. Aucun montant supposé : un effet inconnu annule le total. */
  const cashSumOf = (types: PortfolioEventType[]): number | null => {
    const selected = ordered.filter((event) => types.includes(event.type));
    if (selected.length === 0) return null;
    // Un transfert de titres apporte de la valeur sans mouvement de trésorerie : la
    // compter pour zéro sous-estimerait les apports, et PR D en tirerait une performance
    // flatteuse. Le total devient inconnu, et l'événement en nature est signalé.
    // Un dividende porte l'instrument qui l'a versé et reste un mouvement de cash : seuls
    // les TRANSFERTS d'instruments déplacent de la valeur sans trésorerie.
    const inKind = selected.filter(
      (event) =>
        event.securityId !== null &&
        (event.type === "TRANSFER_IN" || event.type === "TRANSFER_OUT"),
    );
    if (inKind.length > 0) {
      flags.push(...inKind.map((event) => `EXTERNAL_TRANSFER_IN_KIND:${event.id}`));
      return null;
    }
    return strictSum(
      selected.map((event) =>
        event.envelopeCashAmount === null ? null : Math.abs(event.envelopeCashAmount),
      ),
    );
  };

  /**
   * Frais et taxes réellement supportés : la composante incorporée aux opérations, plus
   * les événements dédiés. Un événement qui devrait porter la donnée sans la porter rend
   * le total inconnu ; un type qui n'en porte jamais n'y participe pas.
   */
  const chargeSumOf = (
    dedicated: PortfolioEventType,
    component: (event: PortfolioEvent) => number | null,
  ): number | null => {
    const bearing = ordered.filter(
      (event) =>
        event.type === dedicated ||
        (["BUY", "SELL", "TRANSFER_IN", "TRANSFER_OUT"] as PortfolioEventType[]).includes(
          event.type,
        ),
    );
    if (bearing.length === 0) return null;
    return strictSum(
      bearing.map((event) =>
        event.type === dedicated
          ? (event.grossAmount ??
            (event.envelopeCashAmount === null ? null : Math.abs(event.envelopeCashAmount)))
          : component(event),
      ),
    );
  };

  const coverageStatus: PortfolioCoverageStatus = (() => {
    if (coverageStart === null) return "UNDECLARED";
    const before = ordered.filter(
      (event) =>
        PORTFOLIO_FLOW_DIRECTION[event.type] !== "OPENING" && event.eventDate < coverageStart,
    );
    if (before.length > 0) return "PARTIAL";
    if (anchor === null) return "DECLARED_WITHOUT_CASH_ANCHOR";
    return "DECLARED";
  })();
  if (coverageStatus === "UNDECLARED" && ordered.length > 0) {
    flags.push(`LEDGER_COVERAGE_UNDECLARED:${account.id}`);
  }
  if (coverageStatus === "DECLARED_WITHOUT_CASH_ANCHOR") {
    flags.push(`LEDGER_CASH_ANCHOR_MISSING:${account.id}`);
  }
  if (coverageStatus === "PARTIAL") flags.push(`LEDGER_EVENTS_BEFORE_COVERAGE:${account.id}`);
  if (method === null && disposals.length > 0) {
    flags.push(`LOT_MATCHING_METHOD_UNDECLARED:${account.id}`);
  }

  return {
    accountId: account.id,
    accountName: account.name,
    currency: account.currency,
    policy,
    lotMatchingMethod: method,
    coverageStart,
    coverageStatus,
    eventCount: ordered.length,
    firstEventDate: ordered[0]?.eventDate ?? null,
    lastEventDate: ordered[ordered.length - 1]?.eventDate ?? null,
    ledgerCash,
    observedCash,
    cashGap: cash.gap,
    cashState: cash.state,
    holdings,
    disposals,
    openCostBasis,
    costBasisStatus: openCostBasis === null ? "NOT_COMPUTABLE" : "COMPLETE",
    realisedPnL,
    flows: {
      externalIn: cashSumOf(["CONTRIBUTION", "TRANSFER_IN"]),
      externalOut: cashSumOf(["WITHDRAWAL", "TRANSFER_OUT"]),
      income: cashSumOf(["DIVIDEND", "INTEREST"]),
      fees: chargeSumOf("FEE", (event) => event.feeAmount),
      taxes: chargeSumOf("TAX", (event) => event.taxAmount),
    },
    flags: [...new Set(flags)],
  };
}

/**
 * Construit la lecture dérivée du ledger portefeuille.
 *
 * Une enveloppe sans aucun événement figure quand même dans le résultat : c'est
 * précisément le cas où il faut dire « état observé conservé, historique inconnu »
 * plutôt que de ne rien dire.
 */
export function buildPortfolioLedger(input: BuildPortfolioLedgerInput): PortfolioLedger {
  const accounts = input.accounts.filter(isLedgerEnvelope);
  const accountIds = new Set(accounts.map((account) => account.id));
  const policies = new Map(
    (input.policies ?? []).map((policy) => [policy.accountId, policy] as const),
  );
  const transactions = new Map(
    (input.transactions ?? []).map((transaction) => [transaction.id, transaction] as const),
  );
  const categories = categoryIndex(input.expenseCategories ?? []);

  const envelopes = accounts.map((account) =>
    buildEnvelope(
      account,
      input.events.filter((event) => event.accountId === account.id),
      input.positions.filter((position) => position.accountId === account.id),
      policies.get(account.id) ?? null,
      transactions,
      categories,
    ),
  );

  const orphanEventIds = input.events
    .filter((event) => !accountIds.has(event.accountId))
    .map((event) => event.id);

  const flags = [
    ...new Set([
      ...envelopes.flatMap((envelope) => envelope.flags),
      ...orphanEventIds.map((id) => `PORTFOLIO_EVENT_ORPHAN:${id}`),
    ]),
  ];
  const withEvents = envelopes.filter((envelope) => envelope.eventCount > 0);
  const exploitable = withEvents.filter((envelope) => envelope.coverageStatus === "DECLARED");
  const status: AggregateStatus =
    withEvents.length === 0
      ? "NOT_COMPUTABLE"
      : exploitable.length === withEvents.length
        ? "COMPLETE"
        : exploitable.length === 0
          ? "NOT_COMPUTABLE"
          : "PARTIAL";
  const blockers = [
    ...new Set(
      withEvents
        .filter((envelope) => envelope.coverageStatus !== "DECLARED")
        .map((envelope) => `LEDGER_NOT_EXPLOITABLE:${envelope.accountId}`),
    ),
  ];
  return {
    asOfDate: input.asOfDate,
    envelopes,
    orphanEventIds,
    quality: { status, blockers, flags },
  };
}

/** Lecture d'une enveloppe, sans reconstruire le ledger. */
export function envelopeLedgerOf(
  ledger: PortfolioLedger | undefined,
  accountId: string,
): PortfolioEnvelopeLedger | null {
  return ledger?.envelopes.find((envelope) => envelope.accountId === accountId) ?? null;
}

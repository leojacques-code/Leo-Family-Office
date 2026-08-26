import type { CurrencyRate } from "@/lib/engine/fx";
import {
  BUSINESS_DISPOSAL_EVENT_TYPES,
  BUSINESS_INVESTING_EVENT_TYPES,
  BUSINESS_RETURNING_EVENT_TYPES,
  blocker,
  convertFact,
  dedupeFlags,
  flag,
  known,
  multiply,
  positiveRatio,
  subtract,
  sumAll,
  unknown,
  type BusinessAmount,
  type BusinessCapitalEvent,
  type BusinessEntity,
  type BusinessFlag,
} from "@/lib/engine/business-equity-facts";

/**
 * CAPITAL ET PERFORMANCE
 *
 * Sept grandeurs, sept définitions, jamais confondues :
 *   CAPITAL INVESTI    ce qui est sorti du patrimoine liquide vers la participation ;
 *   CASH RETOURNÉ      ce qui en est revenu, net des frais de transaction ;
 *   VALEUR RESTANTE    ce que la participation vaut encore aujourd'hui ;
 *   PnL RÉALISÉ        le gain effectivement encaissé sur les titres CÉDÉS ;
 *   PnL LATENT         le gain non encaissé sur les titres encore détenus ;
 *   GAIN ÉCONOMIQUE    valeur restante + cash retourné − capital investi ;
 *   MOIC / XIRR        deux mesures de rendement, l'une sans le temps, l'autre avec.
 *
 * UNE DISTRIBUTION NE RÉDUIT PAS LE COÛT DE REVIENT. Seule une cession libère du coût de
 * revient : un dividende est un retour, pas un remboursement de prix d'achat. Les netter
 * ferait apparaître un MOIC infini sur une participation qui a beaucoup distribué.
 *
 * L'ABSENCE D'HISTORIQUE N'EST PAS UN HISTORIQUE VIDE. Sans couverture DÉCLARÉE complète,
 * un MOIC, un XIRR ou une plus-value sont des chiffres faux et flatteurs. Ils restent donc
 * non calculables, et le capital investi déclaré est présenté pour ce qu'il est : une somme
 * de faits connus, c'est-à-dire une BORNE BASSE.
 */

export interface BusinessCapitalEventView {
  event: BusinessCapitalEvent;
  /** Cash personnel de l'événement, converti. Dérivé au prorata si le montant est social. */
  userCash: BusinessAmount;
  /** Montant distribué par la SOCIÉTÉ, quand c'est cette grandeur qui a été saisie. */
  companyAmount: BusinessAmount | null;
  fees: BusinessAmount;
  /** Vrai quand la part personnelle a été dérivée d'un montant social au prorata. */
  derivedProRata: boolean;
}

export interface BusinessCapitalCoverage {
  source: BusinessEntity["capitalHistorySource"];
  start: string | null;
  complete: boolean;
}

export interface BusinessCapitalView {
  events: BusinessCapitalEventView[];
  coverage: BusinessCapitalCoverage;
  /** Σ des sorties déclarées. Borne basse tant que la couverture n'est pas complète. */
  investedCapital: BusinessAmount;
  distributionsReceived: BusinessAmount;
  disposalProceeds: BusinessAmount;
  transactionFees: BusinessAmount;
  cashReturned: BusinessAmount;
  releasedCostBasis: BusinessAmount;
  remainingCostBasis: BusinessAmount;
  realisedPnL: BusinessAmount;
  unrealisedPnL: BusinessAmount;
  totalEconomicGain: BusinessAmount;
  moic: BusinessAmount;
  xirr: BusinessAmount;
  /**
   * Flux datés personnels, convertis, valeur terminale comprise. `null` dès qu'un terme
   * manque : un flux incomplet ne se consolide pas au niveau portefeuille.
   */
  flows: Array<{ date: string; amount: number }> | null;
  flags: BusinessFlag[];
}

export interface BuildCapitalViewInput {
  business: BusinessEntity;
  events: BusinessCapitalEvent[];
  asOfDate: string;
  reportingCurrency: string;
  currencyRates: CurrencyRate[];
  /** Droits économiques applicables à une date, pour dériver une part de distribution. */
  economicRateAt: (date: string) => number | null;
  /** Valeur personnelle restante à la date de lecture. Ferme le calcul de performance. */
  terminalValue: BusinessAmount;
}

// ─── XIRR ───────────────────────────────────────────────────────────────────────────────

function daysBetween(from: string, to: string): number {
  return (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
}

function xnpv(rate: number, flows: Array<{ date: string; amount: number }>): number {
  const start = flows[0].date;
  return flows.reduce(
    (sum, item) => sum + item.amount / (1 + rate) ** (daysBetween(start, item.date) / 365),
    0,
  );
}

/**
 * XIRR par balayage puis bissection.
 *
 * Le balayage compte les changements de signe de la VAN : plusieurs racines signifient que
 * le taux de rendement interne n'est pas défini de façon unique, et le moteur refuse alors
 * d'en désigner une arbitrairement. Aucune racine : pas de solution. Dans les deux cas, un
 * `null` motivé plutôt qu'un chiffre plausible.
 */
export function xirr(flows: Array<{ date: string; amount: number }>): BusinessAmount {
  if (flows.length < 2 || !flows.some((f) => f.amount < 0) || !flows.some((f) => f.amount > 0))
    return unknown([blocker("XIRR_SIGNS_INVALID")]);
  const sorted = [...flows].sort((left, right) => left.date.localeCompare(right.date));
  const brackets: Array<[number, number]> = [];
  let previousLog = -13.8;
  let previousValue = xnpv(Math.exp(previousLog) - 1, sorted);
  for (let index = 1; index <= 1600; index += 1) {
    const logRate = -13.8 + (23.8 * index) / 1600;
    const value = xnpv(Math.exp(logRate) - 1, sorted);
    if (
      Number.isFinite(value) &&
      Number.isFinite(previousValue) &&
      Math.sign(value) !== Math.sign(previousValue)
    ) {
      brackets.push([previousLog, logRate]);
    }
    previousLog = logRate;
    previousValue = value;
  }
  if (brackets.length === 0) return unknown([blocker("XIRR_NO_SOLUTION")]);
  if (brackets.length > 1) return unknown([blocker("XIRR_MULTIPLE_SOLUTIONS")]);
  let [low, high] = brackets[0];
  for (let index = 0; index < 200 && high - low > 1e-13; index += 1) {
    const middle = (low + high) / 2;
    if (
      Math.sign(xnpv(Math.exp(low) - 1, sorted)) === Math.sign(xnpv(Math.exp(middle) - 1, sorted))
    )
      low = middle;
    else high = middle;
  }
  const value = Math.exp((low + high) / 2) - 1;
  return Number.isFinite(value) ? known(value) : unknown([blocker("XIRR_NO_SOLUTION")]);
}

// ─── Vue capital ────────────────────────────────────────────────────────────────────────

export function buildBusinessCapitalView(input: BuildCapitalViewInput): BusinessCapitalView {
  const { business, asOfDate, reportingCurrency, currencyRates: rates } = input;
  const coverage: BusinessCapitalCoverage = {
    source: business.capitalHistorySource,
    start: business.capitalHistoryStart,
    complete: business.capitalHistorySource === "DECLARED_COMPLETE",
  };
  const notDeclared = blocker("CAPITAL_HISTORY_NOT_DECLARED", business.id);
  const partialFlags: BusinessFlag[] = coverage.complete
    ? []
    : [flag("CAPITAL_HISTORY_PARTIAL", business.id)];

  const ordered = input.events
    .filter((event) => event.businessId === business.id && event.eventDate <= asOfDate)
    .sort((left, right) => left.eventDate.localeCompare(right.eventDate));

  const views = ordered.map((event): BusinessCapitalEventView => {
    const gross = convertFact(
      event.amount,
      event.currency,
      event.eventDate,
      reportingCurrency,
      rates,
      blocker("CURRENCY_MISSING", business.id, event.label ?? event.type),
      business.id,
    ).amount;
    const fees = convertFact(
      event.fees ?? 0,
      event.currency,
      event.eventDate,
      reportingCurrency,
      rates,
      blocker("CURRENCY_MISSING", business.id, event.label ?? event.type),
      business.id,
    ).amount;
    if (event.amountScope === "USER_CASH") {
      return { event, userCash: gross, companyAmount: null, fees, derivedProRata: false };
    }
    // Montant SOCIAL : la part personnelle en est dérivée au prorata des droits économiques
    // à la date de l'événement. Sans droits connus à cette date, elle n'est pas dérivable.
    const rate = input.economicRateAt(event.eventDate);
    const userCash =
      rate === null
        ? unknown([blocker("ECONOMIC_OWNERSHIP_MISSING", business.id, event.eventDate)])
        : multiply(gross, known(rate));
    return {
      event,
      userCash: {
        ...userCash,
        flags: dedupeFlags([
          ...userCash.flags,
          flag("DISTRIBUTION_DERIVED_PRO_RATA", business.id, event.eventDate),
        ]),
      },
      companyAmount: gross,
      fees,
      derivedProRata: true,
    };
  });

  const byTypes = (types: readonly string[]) =>
    views.filter((view) => types.includes(view.event.type));

  const investedViews = byTypes(BUSINESS_INVESTING_EVENT_TYPES);
  const returningViews = byTypes(BUSINESS_RETURNING_EVENT_TYPES);
  const disposalViews = byTypes(BUSINESS_DISPOSAL_EVENT_TYPES);
  const distributionViews = returningViews.filter(
    (view) => !BUSINESS_DISPOSAL_EVENT_TYPES.includes(view.event.type),
  );

  const sumOrMissing = (items: BusinessAmount[], onEmpty: BusinessAmount): BusinessAmount =>
    items.length === 0 ? onEmpty : sumAll(items);

  // Aucun événement d'investissement ET couverture non déclarée : le coût de revient est
  // INCONNU, pas nul. Avec une couverture complète, l'absence est un zéro déclaré.
  const investedCapital = sumOrMissing(
    investedViews.map((view) => view.userCash),
    coverage.complete ? known(0) : unknown([blocker("COST_BASIS_HISTORY_MISSING", business.id)]),
  );
  const distributionsReceived = sumOrMissing(
    distributionViews.map((view) => view.userCash),
    coverage.complete ? known(0) : unknown([blocker("DISTRIBUTION_HISTORY_MISSING", business.id)]),
  );
  const disposalProceeds = sumOrMissing(
    disposalViews.map((view) => view.userCash),
    coverage.complete ? known(0) : unknown([blocker("DISTRIBUTION_HISTORY_MISSING", business.id)]),
  );
  const transactionFees = sumOrMissing(
    views.map((view) => view.fees),
    known(0),
  );
  const cashReturned = subtract(sumAll([distributionsReceived, disposalProceeds]), transactionFees);

  // Coût de revient libéré par les cessions, au COÛT MOYEN PONDÉRÉ. Sans quote-part cédée
  // déclarée, la fraction sortie est inconnue : la PnL réalisée ne se devine pas.
  let costBasisBlocked = investedCapital.value === null;
  let running: number | null = costBasisBlocked ? null : 0;
  const releasedParts: BusinessAmount[] = [];
  const realisedParts: BusinessAmount[] = [];

  for (const view of views) {
    if (BUSINESS_INVESTING_EVENT_TYPES.includes(view.event.type)) {
      if (running !== null && view.userCash.value !== null) running += view.userCash.value;
      else costBasisBlocked = true;
      continue;
    }
    if (!BUSINESS_DISPOSAL_EVENT_TYPES.includes(view.event.type)) continue;
    const delta = view.event.ownershipDelta;
    const after = view.event.ownershipRateAfter;
    const before = delta !== null && after !== null ? after - delta : null;
    const fraction =
      delta !== null && before !== null && before > 0
        ? Math.min(1, Math.abs(delta) / before)
        : delta !== null && after === 0
          ? 1
          : null;
    if (fraction === null || running === null) {
      releasedParts.push(
        unknown([blocker("OWNERSHIP_DELTA_MISSING", business.id, view.event.eventDate)]),
      );
      realisedParts.push(
        unknown([blocker("OWNERSHIP_DELTA_MISSING", business.id, view.event.eventDate)]),
      );
      costBasisBlocked = true;
      continue;
    }
    const released = running * fraction;
    running -= released;
    releasedParts.push(known(released));
    realisedParts.push(subtract(subtract(view.userCash, view.fees), known(released)));
  }

  const releasedCostBasis = disposalViews.length === 0 ? known(0) : sumAll(releasedParts);
  const remainingCostBasis =
    costBasisBlocked || running === null
      ? unknown([blocker("COST_BASIS_HISTORY_MISSING", business.id)])
      : known(running);
  const realisedPnL = disposalViews.length === 0 ? known(0) : sumAll(realisedParts);
  const unrealisedPnL = subtract(input.terminalValue, remainingCostBasis);

  // Toutes les mesures de PERFORMANCE exigent une couverture déclarée complète. Un
  // rendement calculé sur une fraction inconnue de l'historique n'est pas un rendement.
  const requireCoverage = (item: BusinessAmount): BusinessAmount =>
    coverage.complete
      ? item
      : unknown([...item.blockers, notDeclared], [...item.flags, ...partialFlags]);

  const totalEconomicGain = requireCoverage(
    subtract(sumAll([input.terminalValue, cashReturned]), investedCapital),
  );
  const moic = requireCoverage(
    positiveRatio(
      sumAll([input.terminalValue, cashReturned]),
      investedCapital,
      blocker("INVESTED_CAPITAL_NOT_POSITIVE", business.id),
    ),
  );

  const flows: Array<{ date: string; amount: number }> = [];
  let flowsBlocked = !coverage.complete;
  for (const view of views) {
    if (view.userCash.value === null) {
      flowsBlocked = true;
      continue;
    }
    const outflow = BUSINESS_INVESTING_EVENT_TYPES.includes(view.event.type);
    const feeValue = view.fees.value ?? 0;
    flows.push({
      date: view.event.eventDate,
      amount: outflow ? -(view.userCash.value + feeValue) : view.userCash.value - feeValue,
    });
  }
  if (input.terminalValue.value === null) flowsBlocked = true;
  else flows.push({ date: asOfDate, amount: input.terminalValue.value });

  const xirrResult = flowsBlocked
    ? unknown(
        coverage.complete ? [blocker("XIRR_INPUTS_INCOMPLETE", business.id)] : [notDeclared],
        partialFlags,
      )
    : xirr(flows);

  return {
    events: views,
    coverage,
    investedCapital: {
      ...investedCapital,
      flags: dedupeFlags([...investedCapital.flags, ...partialFlags]),
    },
    distributionsReceived,
    disposalProceeds,
    transactionFees,
    cashReturned: { ...cashReturned, flags: dedupeFlags([...cashReturned.flags, ...partialFlags]) },
    releasedCostBasis,
    remainingCostBasis,
    realisedPnL: requireCoverage(realisedPnL),
    unrealisedPnL: requireCoverage(unrealisedPnL),
    totalEconomicGain,
    moic,
    xirr: xirrResult,
    flows: flowsBlocked ? null : flows,
    flags: dedupeFlags(partialFlags),
  };
}

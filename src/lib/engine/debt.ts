import { MONTHS_PER_PERIOD } from "@/lib/types";
import type {
  DataKind,
  EarlyRepayment,
  InterestConvention,
  Liability,
  LoanCharge,
  LoanScheduleEntry,
  ProvidedScheduleEntry,
} from "@/lib/types";

/**
 * Moteur de dette. Une seule vérité pour Debt, Cash Flow, Monthly Model, Today et
 * Decision Lab.
 *
 * ── Trois représentations, jamais interchangeables ───────────────────────────────────
 *
 *   A. échéancier CONTRACTUEL — la vie théorique complète du prêt, dérivée du capital
 *      emprunté et datée depuis `firstPaymentDate`. Décrit ce que le contrat annonçait.
 *   B. échéancier FORWARD     — la projection à partir de l'encours réellement observé à
 *      la date d'analyse, sur les seules échéances restantes.
 *   C. échéancier FOURNI      — l'échéancier bancaire réel, quand il existe. Il prime sur
 *      A et sur B : c'est ce que la banque prélèvera, quelles que soient nos hypothèses.
 *
 * `currentBalance` intègre déjà les échéances passées. Réamortir cet encours depuis la
 * première échéance historique amortirait la dette deux fois : toute projection consomme
 * B (ou C), jamais A.
 *
 * ── Définition canonique du service de dette ─────────────────────────────────────────
 *
 *   totalCashOut = principal + interest + insurance + fees
 *   DebtService(période) = Σ totalCashOut des lignes exigibles dans la période
 *
 * Le remboursement de principal réduit la dette : c'est un transfert du passif vers le
 * net, jamais une charge économique. Seuls interest + insurance + fees appauvrissent, et
 * `economicCost` les expose séparément pour que le Monthly Model n'ait pas à les
 * recomposer.
 *
 *   ClosingDebt = OpeningDebt − PrincipalPaid
 *
 * ── Ce que le moteur refuse de faire ─────────────────────────────────────────────────
 *
 * Aucune borne de date littérale : avant la première échéance et après la dernière,
 * aucune ligne n'est exigible, donc le service de dette vaut zéro sans cas particulier.
 *
 * Là où le contrat ne dit rien (traitement des intérêts en différé total, convention
 * après remboursement anticipé, assurance incluse ou non dans la mensualité), le moteur
 * applique l'hypothèse la moins déformante, marque les lignes concernées en
 * MODEL_ASSUMPTION et lève un drapeau. Il ne choisit jamais en silence.
 */

const DAY = 86_400_000;
const CENT = 0.005;
const EUR = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" });
const DATE_FR = new Intl.DateTimeFormat("fr-FR", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});
function frDate(iso: string) {
  const parsed = parseIsoDate(iso);
  return parsed ? DATE_FR.format(parsed) : iso;
}

function parseIsoDate(iso: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  if (!match) return null;
  const [, year, month, day] = match;
  return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
}

function toIso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Ajout de mois calendaires avec repli sur le dernier jour du mois (31 janvier + 1 mois = 28 février). */
export function addMonths(iso: string, months: number): string {
  const base = parseIsoDate(iso);
  if (!base) return iso;
  const day = base.getUTCDate();
  const target = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + months, 1));
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return toIso(target);
}

/** Premier et dernier jour du mois civil contenant `iso`. */
export function monthBounds(iso: string): { start: string; end: string } {
  const base = parseIsoDate(iso) ?? new Date();
  const start = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), 1));
  const end = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0));
  return { start: toIso(start), end: toIso(end) };
}

export function daysBetween(fromIso: string, toIsoDate: string): number | null {
  const from = parseIsoDate(fromIso);
  const to = parseIsoDate(toIsoDate);
  if (!from || !to) return null;
  return Math.round((to.getTime() - from.getTime()) / DAY);
}

export type LoanFlagCode =
  | "RECONCILIATION_REQUIRED"
  | "MATURITY_MISMATCH"
  | "EARLY_PAYOFF"
  | "BALANCE_MISMATCH"
  | "PAYMENT_EXCEEDS_AMORTISATION"
  | "INSURANCE_TREATMENT_UNKNOWN"
  | "DEFERRAL_INTEREST_UNKNOWN"
  | "DEFERRAL_CONTRADICTORY"
  | "EARLY_REPAYMENT_CONVENTION_UNKNOWN"
  | "EARLY_REPAYMENT_PENALTY_UNKNOWN"
  | "NEGATIVE_AMORTISATION"
  | "PROVIDED_SCHEDULE_USED"
  | "VARIABLE_RATE_UNPROJECTABLE"
  | "RATE_ASSUMPTION_APPLIED"
  | "BALLOON_AMOUNT_MISSING";

export interface LoanScheduleFlag {
  code: LoanFlagCode;
  detail: string;
}

export interface LoanSchedule {
  liabilityId: string;
  entries: LoanScheduleEntry[];
  /**
   * ACTUAL quand l'échéancier vient de la banque, MODEL_ASSUMPTION dès qu'une convention
   * inconnue a dû être supposée, DERIVED sinon, MISSING quand rien n'est calculable.
   */
  kind: DataKind;
  firstDueDate: string | null;
  lastDueDate: string | null;
  totalInterest: number;
  totalCashOut: number;
  /**
   * Anomalies levées pendant la construction. Elles voyagent avec l'échéancier : un
   * drapeau produit au fond du calcul et perdu en chemin ne protège personne.
   */
  flags: LoanScheduleFlag[];
}

const EMPTY_SCHEDULE = (liabilityId: string, kind: DataKind = "DERIVED"): LoanSchedule => ({
  liabilityId,
  entries: [],
  kind,
  firstDueDate: null,
  lastDueDate: null,
  totalInterest: 0,
  totalCashOut: 0,
  flags: [],
});

function summarise(
  liabilityId: string,
  entries: LoanScheduleEntry[],
  kind: DataKind = "DERIVED",
  flags: LoanScheduleFlag[] = [],
): LoanSchedule {
  const sorted = [...entries].sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  return {
    liabilityId,
    entries: sorted,
    kind,
    firstDueDate: sorted[0]?.dueDate ?? null,
    lastDueDate: sorted.at(-1)?.dueDate ?? null,
    totalInterest: sorted.reduce((sum, entry) => sum + entry.interest, 0),
    totalCashOut: sorted.reduce((sum, entry) => sum + entry.totalCashOut, 0),
    flags,
  };
}

/**
 * Construit une ligne en garantissant les deux invariants par construction plutôt qu'en
 * les recalculant à chaque site d'appel, où une omission passerait inaperçue.
 *
 *   totalCashOut   = principal + interest + insurance + fees
 *   closingBalance = openingBalance − principal + capitalisedInterest + capitalisedCharges
 */
function entry(
  liability: Liability,
  fields: Omit<
    LoanScheduleEntry,
    "liabilityId" | "totalCashOut" | "capitalisedCharges" | "closingBalance"
  > & { capitalisedCharges?: number; closingBalance?: number },
): LoanScheduleEntry {
  const capitalisedCharges = fields.capitalisedCharges ?? 0;
  const closingBalance =
    fields.closingBalance ??
    Math.max(
      0,
      fields.openingBalance - fields.principal + fields.capitalisedInterest + capitalisedCharges,
    );
  return {
    ...fields,
    capitalisedCharges,
    closingBalance,
    liabilityId: liability.id,
    totalCashOut: fields.principal + fields.interest + fields.insurance + fields.fees,
  };
}

/**
 * Termes optionnels non déclarés. À utiliser pour construire un prêt dont on ne connaît
 * que le contrat de base : `null` et tableaux vides disent « non renseigné », jamais
 * « égal à zéro ». Les distinguer est ce qui permet au moteur de signaler une ambiguïté
 * au lieu de la trancher.
 */
export const UNDECLARED_LOAN_TERMS = {
  monthlyInsurance: null,
  recurringFees: null,
  paymentIncludesInsurance: null,
  deferral: null,
  // Valeurs qui reproduisent exactement le comportement historique du moteur : un prêt
  // amortissable mensuel à taux fixe proportionnel. Aucun contrat existant ne change.
  amortisationProfile: "AMORTIZING",
  balloonAmount: null,
  paymentFrequency: "MONTHLY",
  interestConvention: "PROPORTIONAL",
  rateType: "FIXED",
  rateSchedule: [],
  paymentSchedule: [],
  earlyRepayments: [],
  oneOffCharges: [],
  providedSchedule: [],
  facilityId: null,
} satisfies Pick<
  Liability,
  | "monthlyInsurance"
  | "recurringFees"
  | "paymentIncludesInsurance"
  | "deferral"
  | "amortisationProfile"
  | "balloonAmount"
  | "paymentFrequency"
  | "interestConvention"
  | "rateType"
  | "rateSchedule"
  | "paymentSchedule"
  | "earlyRepayments"
  | "oneOffCharges"
  | "providedSchedule"
  | "facilityId"
>;

// ─── Termes du contrat ────────────────────────────────────────────────────────────────

/** Nombre de mois entre deux échéances. Une dette n'est pas nécessairement mensuelle. */
export function monthsPerPeriod(liability: Liability): number {
  return MONTHS_PER_PERIOD[liability.paymentFrequency ?? "MONTHLY"];
}

/** Date d'exigibilité de la n-ième échéance contractuelle, toutes périodicités confondues. */
export function dueDateOf(liability: Liability, paymentNumber: number): string {
  return addMonths(liability.firstPaymentDate, (paymentNumber - 1) * monthsPerPeriod(liability));
}

/**
 * Taux annuel en vigueur à une date, selon les changements datés déclarés.
 *
 * Aucun effet rétroactif : une révision ne réécrit pas le passé, elle prend effet à sa
 * date. Le taux de la dette reste celui du départ tant qu'aucun changement n'a pris effet.
 */
export function annualRateAt(liability: Liability, date: string): number {
  const applicable = (liability.rateSchedule ?? [])
    .filter((change) => change.effectiveFrom <= date)
    .sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
  return applicable.at(-1)?.annualRate ?? liability.annualRate;
}

/**
 * Intérêt d'une période, selon la convention déclarée.
 *
 * PROPORTIONAL couvre les prêts amortissables français et reproduit le comportement
 * historique. ACTUAL_365 compte les jours réels, ce qui produit de vrais écarts sur des
 * périodes de longueur inégale.
 */
function periodInterest(
  balance: number,
  annualRate: number,
  convention: InterestConvention,
  months: number,
  periodStart: string,
  periodEnd: string,
): number {
  if (convention === "ACTUAL_365") {
    const days = daysBetween(periodStart, periodEnd) ?? months * 30;
    return (balance * annualRate * days) / 365;
  }
  return (balance * annualRate * months) / 12;
}

/** Assurance par échéance, 0 quand la donnée n'existe pas (l'absence n'est pas une valeur). */
function insurancePerPayment(liability: Liability): number {
  return liability.monthlyInsurance ?? 0;
}

function feesPerPayment(liability: Liability): number {
  return liability.recurringFees ?? 0;
}

/**
 * Mensualité totale prélevée, assurance et frais récurrents compris.
 *
 * Quand `paymentIncludesInsurance` vaut `true`, la mensualité déclarée les contient déjà :
 * y rajouter l'assurance la compterait deux fois.
 */
export function totalContractualPayment(liability: Liability): number {
  const amortising = amortisingPayment(liability);
  return amortising + insurancePerPayment(liability) + feesPerPayment(liability);
}

/**
 * Part de la mensualité qui sert réellement capital et intérêts.
 *
 * C'est le seul montant qui amortit. Une mensualité déclarée « assurance comprise » dont on
 * ne retrancherait pas l'assurance ferait croire que le prêt s'éteint plus vite qu'en
 * réalité, et sous-estimerait le coût total du crédit.
 *
 * Priorité : mensualité contractuelle déclarée, puis PMT théorique dérivée UNE FOIS du
 * contrat (capital emprunté, taux, nombre d'échéances) et jamais de l'encours observé. La
 * mensualité d'un prêt à taux fixe est un terme du contrat : elle ne dérive pas parce que
 * l'encours a bougé.
 */
export function amortisingPayment(liability: Liability, atDate?: string): number {
  const declared = declaredPaymentAt(liability, atDate);
  if (declared > 0) {
    // `null` = convention inconnue. On retient l'hypothèse la moins déformante : ne rien
    // retrancher, ce qui laisse l'amortissement identique à la donnée déclarée. Le drapeau
    // INSURANCE_TREATMENT_UNKNOWN rend l'ambiguïté visible plutôt que de la trancher.
    const deduction =
      liability.paymentIncludesInsurance === true ? insurancePerPayment(liability) : 0;
    return Math.max(0, declared - deduction);
  }
  return theoreticalPayment(liability);
}

/** Paiement contractuel en vigueur à une date, paliers datés compris. */
export function declaredPaymentAt(liability: Liability, atDate?: string): number {
  return steppedPaymentAt(liability, atDate) ?? liability.monthlyPayment;
}

/**
 * Palier daté en vigueur, ou `null` si aucun ne s'applique.
 *
 * Distinguer « aucun palier » de « palier égal au paiement de départ » est indispensable :
 * sans cela, un paiement recalculé en cours de route, après un remboursement anticipé en
 * réduction de mensualité, serait réécrasé à chaque échéance par la valeur du contrat.
 */
function steppedPaymentAt(liability: Liability, atDate?: string): number | null {
  if (!atDate) return null;
  const applicable = (liability.paymentSchedule ?? [])
    .filter((change) => change.effectiveFrom <= atDate)
    .sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
  return applicable.at(-1)?.amount ?? null;
}

/**
 * Conservé pour les appelants historiques : la part amortissante est ce que ce nom a
 * toujours désigné, avant que l'assurance ne soit modélisée.
 */
export const contractualPayment = amortisingPayment;

/**
 * PMT théorique dérivée du contrat, périodicité et profil compris.
 *
 * Un in fine ou un interest-only n'amortit rien : son paiement courant est l'intérêt de la
 * période. Un balloon amortit vers un solde résiduel cible, pas vers zéro.
 */
function theoreticalPayment(liability: Liability): number {
  const payments = Math.trunc(liability.paymentCount);
  if (payments <= 0 || liability.principal <= 0) return 0;
  const rate = periodicRate(liability, liability.annualRate);
  const profile = liability.amortisationProfile ?? "AMORTIZING";
  if (profile === "INTEREST_ONLY" || profile === "BULLET") return liability.principal * rate;
  const target = profile === "BALLOON" ? Math.max(0, liability.balloonAmount ?? 0) : 0;
  return pmtToTarget(liability.principal, rate, payments, target);
}

/** Taux d'une période, hors convention en jours réels qui dépend des dates. */
function periodicRate(liability: Liability, annualRate: number): number {
  return (annualRate * monthsPerPeriod(liability)) / 12;
}

/** Paiement amortissant `balance` vers `target` en `payments` échéances au taux `rate`. */
function pmtToTarget(balance: number, rate: number, payments: number, target = 0): number {
  if (payments <= 0) return 0;
  const amortised = balance - target;
  if (rate === 0) return Math.max(0, amortised / payments);
  const growth = Math.pow(1 + rate, payments);
  return (balance * rate * growth - target * rate) / (growth - 1);
}

function isUsable(liability: Liability): boolean {
  return (
    Math.trunc(liability.paymentCount) > 0 && parseIsoDate(liability.firstPaymentDate) !== null
  );
}

function hasProvidedSchedule(liability: Liability): boolean {
  return (liability.providedSchedule ?? []).length > 0;
}

/** Différé normalisé. Un différé déclaré sans durée exploitable n'en est pas un. */
function deferralOf(liability: Liability): {
  kind: "NONE" | "PRINCIPAL_ONLY" | "TOTAL";
  months: number;
} {
  const declared = liability.deferral;
  if (!declared || declared.kind === "NONE") return { kind: "NONE", months: 0 };
  const months = Math.max(0, Math.trunc(declared.months));
  if (months === 0) return { kind: "NONE", months: 0 };
  return { kind: declared.kind, months };
}

// ─── Cœur d'amortissement ─────────────────────────────────────────────────────────────

type LoanEvent =
  | { type: "EARLY_REPAYMENT"; date: string; repayment: EarlyRepayment }
  | { type: "CHARGE"; date: string; amount: number; label: string; financed: boolean };

interface AmortiseInput {
  liability: Liability;
  openingBalance: number;
  /** Numéro contractuel absolu de la première échéance produite. */
  firstPaymentNumber: number;
  /** Nombre d'échéances contractuelles restant à produire. */
  paymentsToProduce: number;
  /** Événements datés à appliquer. Vide pour l'échéancier purement contractuel. */
  events: LoanEvent[];
}

interface AmortiseResult {
  entries: LoanScheduleEntry[];
  flags: LoanScheduleFlag[];
  /** Vrai dès qu'une convention inconnue a dû être supposée. */
  assumed: boolean;
}

function pmt(liability: Liability, balance: number, annualRate: number, payments: number): number {
  if (payments <= 0 || balance <= 0) return 0;
  return pmtToTarget(balance, periodicRate(liability, annualRate), payments);
}

/**
 * Amortit `openingBalance` sur les échéances contractuelles restantes, en appliquant
 * différé, remboursements anticipés et frais ponctuels dans l'ordre chronologique.
 *
 * Chaque ligne respecte sans exception :
 *   totalCashOut  = principal + interest + insurance + fees
 *   closingBalance = openingBalance − principal + capitalisedInterest
 */
function amortise(input: AmortiseInput): AmortiseResult {
  const { liability, firstPaymentNumber, paymentsToProduce } = input;
  const flags: LoanScheduleFlag[] = [];
  const entries: LoanScheduleEntry[] = [];
  let assumed = false;
  if (paymentsToProduce <= 0) return { entries, flags, assumed };

  const months = monthsPerPeriod(liability);
  const convention = liability.interestConvention ?? "PROPORTIONAL";
  const profile = liability.amortisationProfile ?? "AMORTIZING";
  const insurance = insurancePerPayment(liability);
  const fees = feesPerPayment(liability);
  const deferral = deferralOf(liability);
  const declaredTreatment = liability.deferral?.interestTreatment ?? "UNKNOWN";

  // Un différé TOTAL dont les intérêts seraient « payés » n'est pas un différé total.
  let totalDeferralCapitalises = true;
  if (deferral.kind === "TOTAL") {
    if (declaredTreatment === "PAID") {
      flags.push({
        code: "DEFERRAL_CONTRADICTORY",
        detail:
          "Différé déclaré TOTAL avec intérêts payés : un différé total ne décaisse rien. Traité comme un différé de principal.",
      });
      totalDeferralCapitalises = false;
    } else if (declaredTreatment === "UNKNOWN") {
      flags.push({
        code: "DEFERRAL_INTEREST_UNKNOWN",
        detail:
          "Différé total sans convention d'intérêts déclarée. Intérêts supposés capitalisés, hypothèse la plus fréquente ; une remise d'intérêts donnerait un coût total différent.",
      });
      assumed = true;
    }
  }

  // Un taux révisable dont aucune révision future n'est déclarée : le taux du jour ne peut
  // pas être présenté comme le taux de toute la vie du prêt. Produire un échéancier reste
  // plus utile que ne rien produire, à condition qu'il s'annonce comme une hypothèse.
  if (liability.rateType === "VARIABLE") {
    const lastDeclared = (liability.rateSchedule ?? [])
      .filter((change) => change.kind === "CONTRACTUAL")
      .sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom))
      .at(-1);
    const horizon = dueDateOf(liability, Math.trunc(liability.paymentCount));
    if (!lastDeclared || lastDeclared.effectiveFrom < horizon) {
      flags.push({
        code: "VARIABLE_RATE_UNPROJECTABLE",
        detail: lastDeclared
          ? `Taux révisable : aucune révision déclarée au-delà du ${frDate(lastDeclared.effectiveFrom)}. Le dernier taux connu est prolongé par hypothèse jusqu'à ${frDate(horizon)}, ce n'est pas une clause du contrat.`
          : `Taux révisable sans aucune révision déclarée. Le taux actuel de ${(liability.annualRate * 100).toFixed(2)} % est prolongé par hypothèse jusqu'à ${frDate(horizon)} ; le contrat ne le garantit pas.`,
      });
      assumed = true;
    }
  }

  // Une révision déclarée comme hypothèse n'est pas une clause : la trajectoire en dépend.
  if ((liability.rateSchedule ?? []).some((change) => change.kind === "ASSUMPTION")) {
    flags.push({
      code: "RATE_ASSUMPTION_APPLIED",
      detail:
        "Au moins une révision de taux est une hypothèse déclarée, pas un terme du contrat. La trajectoire en dépend.",
    });
    assumed = true;
  }

  // Assurance déclarée sans sa convention : l'amortissement dépend d'une hypothèse, il
  // faut donc que l'échéancier le dise, pas seulement un drapeau de la timeline.
  if (
    liability.monthlyPayment > 0 &&
    insurance > 0 &&
    liability.paymentIncludesInsurance === null
  ) {
    flags.push({
      code: "INSURANCE_TREATMENT_UNKNOWN",
      detail: `Assurance de ${EUR.format(insurance)} par échéance déclarée sans préciser si la mensualité ${EUR.format(liability.monthlyPayment)} la contient. Supposée en sus : si elle était incluse, l'amortissement serait plus lent et le coût du crédit plus élevé.`,
    });
    assumed = true;
  }

  const events = [...input.events].sort((a, b) => a.date.localeCompare(b.date));
  let eventIndex = 0;
  let balance = input.openingBalance;
  let payment = amortisingPayment(liability);
  let negativeAmortisationFlagged = false;
  let lastNumber = firstPaymentNumber - 1;

  const applyEvent = (event: LoanEvent, paymentNumber: number) => {
    if (event.type === "CHARGE") {
      // Frais financé : aucun euro ne sort, l'encours augmente d'autant. Le porter en
      // `fees` le ferait sortir d'un compte qu'il n'a jamais quitté ; l'omettre ferait
      // disparaître une dette réellement contractée.
      entries.push(
        entry(liability, {
          paymentNumber,
          entryKind: "CHARGE",
          dueDate: event.date,
          openingBalance: balance,
          interest: 0,
          capitalisedInterest: 0,
          capitalisedCharges: event.financed ? event.amount : 0,
          principal: 0,
          insurance: 0,
          fees: event.financed ? 0 : event.amount,
          kind: "ACTUAL",
        }),
      );
      if (event.financed) balance += event.amount;
      return;
    }
    const repayment = event.repayment;
    const repaid = Math.min(balance, Math.max(0, repayment.amount));
    if (repayment.penalty === null) {
      // Une indemnité inconnue sous-estime le décaissement : la trajectoire entière devient
      // une hypothèse, pas seulement la ligne concernée.
      assumed = true;
      flags.push({
        code: "EARLY_REPAYMENT_PENALTY_UNKNOWN",
        detail: `Remboursement anticipé du ${frDate(event.date)} : indemnité inconnue, exclue du décaissement plutôt que supposée nulle.`,
      });
    }
    entries.push(
      entry(liability, {
        paymentNumber,
        entryKind: "EARLY_REPAYMENT",
        dueDate: event.date,
        openingBalance: balance,
        interest: 0,
        capitalisedInterest: 0,
        principal: repaid,
        insurance: 0,
        fees: repayment.penalty ?? 0,
        closingBalance: balance - repaid,
        kind: repayment.penalty === null ? "MODEL_ASSUMPTION" : "ACTUAL",
      }),
    );
    balance -= repaid;

    const remaining = firstPaymentNumber + paymentsToProduce - 1 - paymentNumber;
    if (repayment.outcome === "REDUCE_PAYMENT") {
      payment = pmt(liability, balance, annualRateAt(liability, event.date), remaining);
    } else if (repayment.outcome === "UNKNOWN") {
      // Garder la mensualité inchangée est l'hypothèse qui déforme le moins : la mensualité
      // est un terme du contrat, la durée est ce que le remboursement raccourcit.
      flags.push({
        code: "EARLY_REPAYMENT_CONVENTION_UNKNOWN",
        detail: `Remboursement anticipé du ${frDate(event.date)} : convention du prêteur inconnue. Mensualité maintenue et durée réduite par hypothèse ; une réduction de mensualité produirait un coût d'intérêt supérieur.`,
      });
      assumed = true;
    }
  };

  const lastPaymentNumber = firstPaymentNumber + paymentsToProduce - 1;
  const totalPayments = Math.trunc(liability.paymentCount);
  let previousDueDate = dueDateOf(liability, firstPaymentNumber - 1);

  for (let offset = 0; offset < paymentsToProduce; offset += 1) {
    const paymentNumber = firstPaymentNumber + offset;
    const dueDate = dueDateOf(liability, paymentNumber);
    lastNumber = paymentNumber;

    while (eventIndex < events.length && events[eventIndex].date < dueDate) {
      applyEvent(events[eventIndex], paymentNumber - 1);
      eventIndex += 1;
    }
    if (balance <= CENT) break;

    // Le taux en vigueur est celui de la date d'exigibilité : une révision ne réécrit
    // jamais les échéances déjà passées.
    const annualRate = annualRateAt(liability, dueDate);
    const accrued = periodInterest(
      balance,
      annualRate,
      convention,
      months,
      previousDueDate,
      dueDate,
    );
    // Un palier daté remplace le paiement à sa date d'effet, sans toucher au passé. En
    // l'absence de palier, le paiement courant est conservé : il a pu être recalculé.
    const stepped = steppedPaymentAt(liability, dueDate);
    if (stepped !== null) {
      const deduction =
        liability.paymentIncludesInsurance === true ? insurancePerPayment(liability) : 0;
      payment = Math.max(0, stepped - deduction);
    }

    const inDeferral = paymentNumber <= deferral.months;
    const isFinalPayment = paymentNumber >= Math.min(lastPaymentNumber, totalPayments);
    let interestPaid = 0;
    let capitalised = 0;
    let principal = 0;

    if (inDeferral && deferral.kind === "TOTAL" && totalDeferralCapitalises) {
      capitalised = accrued;
    } else if (inDeferral) {
      // Différé de principal : les intérêts, l'assurance et les frais restent dus.
      interestPaid = accrued;
    } else if (profile === "INTEREST_ONLY" || (profile === "BULLET" && !isFinalPayment)) {
      // Seuls les intérêts sont servis : l'encours ne bouge pas.
      interestPaid = accrued;
    } else if (profile === "BULLET" && isFinalPayment) {
      // In fine : tout le capital tombe à la dernière échéance.
      interestPaid = accrued;
      principal = balance;
    } else {
      interestPaid = Math.min(accrued, payment);
      capitalised = accrued - interestPaid;
      if (capitalised > CENT && !negativeAmortisationFlagged) {
        flags.push({
          code: "NEGATIVE_AMORTISATION",
          detail: `À la ${paymentNumber}e échéance, le paiement amortissant ${EUR.format(payment)} ne couvre pas l'intérêt ${EUR.format(accrued)} : l'encours augmente au lieu de diminuer.`,
        });
        negativeAmortisationFlagged = true;
      }
      principal = Math.min(balance, Math.max(0, payment - accrued));
      if (profile === "BALLOON" && isFinalPayment) {
        // Le solde résiduel est remboursé en une fois avec la dernière échéance.
        principal = balance;
      }
    }

    entries.push(
      entry(liability, {
        paymentNumber,
        entryKind: "PAYMENT",
        dueDate,
        openingBalance: balance,
        interest: interestPaid,
        capitalisedInterest: capitalised,
        principal,
        insurance,
        fees,
        kind: "DERIVED",
      }),
    );
    balance = Math.max(0, balance - principal + capitalised);
    previousDueDate = dueDate;

    while (eventIndex < events.length && events[eventIndex].date === dueDate) {
      applyEvent(events[eventIndex], paymentNumber);
      eventIndex += 1;
    }
  }

  while (eventIndex < events.length) {
    applyEvent(events[eventIndex], lastNumber);
    eventIndex += 1;
  }

  if (assumed) {
    for (const row of entries) if (row.kind === "DERIVED") row.kind = "MODEL_ASSUMPTION";
  }
  return { entries, flags, assumed };
}

/** Conversion d'un échéancier bancaire fourni en lignes canoniques. Aucun recalcul. */
function fromProvided(liability: Liability, rows: ProvidedScheduleEntry[]): LoanScheduleEntry[] {
  return rows
    .map((row) =>
      entry(liability, {
        paymentNumber: row.paymentNumber,
        entryKind: "PAYMENT",
        dueDate: row.dueDate,
        openingBalance: row.openingBalance,
        interest: row.interest,
        capitalisedInterest: 0,
        principal: row.principal,
        insurance: row.insurance,
        fees: row.fees,
        closingBalance: row.closingBalance,
        kind: "ACTUAL",
      }),
    )
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}

function chargeEvents(liability: Liability): LoanEvent[] {
  return (liability.oneOffCharges ?? []).map((charge: LoanCharge) => ({
    type: "CHARGE" as const,
    date: charge.date,
    amount: charge.amount,
    label: charge.label,
    financed: charge.financed === true,
  }));
}

function repaymentEvents(liability: Liability): LoanEvent[] {
  return (liability.earlyRepayments ?? []).map((repayment) => ({
    type: "EARLY_REPAYMENT" as const,
    date: repayment.date,
    repayment,
  }));
}

// ─── Les trois échéanciers ────────────────────────────────────────────────────────────

/**
 * A. Échéancier contractuel : la vie théorique complète du prêt, dérivée du capital
 * emprunté. Ne connaît ni remboursement anticipé ni frais ponctuel, qui sont des
 * événements et non des termes du contrat.
 *
 * C. Si un échéancier bancaire est fourni, il tient lieu de contrat et prime sans recalcul.
 */
export function buildContractualSchedule(liability: Liability): LoanSchedule {
  if (hasProvidedSchedule(liability)) {
    return summarise(liability.id, fromProvided(liability, liability.providedSchedule), "ACTUAL");
  }
  if (!isUsable(liability) || liability.principal <= 0) {
    return EMPTY_SCHEDULE(liability.id, "MISSING");
  }
  const result = amortise({
    liability,
    openingBalance: liability.principal,
    firstPaymentNumber: 1,
    paymentsToProduce: Math.trunc(liability.paymentCount),
    events: [],
  });
  return summarise(
    liability.id,
    result.entries,
    result.assumed ? "MODEL_ASSUMPTION" : "DERIVED",
    result.flags,
  );
}

/** Nombre d'échéances contractuelles dont la date d'exigibilité est passée à `asOfDate`. */
export function elapsedPaymentsAt(liability: Liability, asOfDate: string): number {
  if (hasProvidedSchedule(liability)) {
    return liability.providedSchedule.filter((row) => row.dueDate <= asOfDate).length;
  }
  if (!isUsable(liability)) return 0;
  const total = Math.trunc(liability.paymentCount);
  let elapsed = 0;
  for (let index = 1; index <= total; index += 1) {
    if (dueDateOf(liability, index) <= asOfDate) elapsed += 1;
    else break;
  }
  return elapsed;
}

/**
 * B. Échéancier forward : projection depuis l'encours réellement observé à `asOfDate`,
 * sur les seules échéances restantes. Les mensualités déjà passées ne sont jamais rejouées
 * contre cet encours.
 *
 * Les remboursements anticipés et frais ponctuels postérieurs à la date d'observation y
 * sont appliqués ; ceux qui la précèdent sont déjà incorporés dans l'encours observé et ne
 * doivent surtout pas l'être une seconde fois.
 *
 * C. Un échéancier bancaire fourni prime : ses lignes futures sont ce que la banque
 * prélèvera, quelle que soit la projection que nous aurions faite.
 */
export function buildForwardSchedule(liability: Liability, asOfDate: string): LoanSchedule {
  if (hasProvidedSchedule(liability)) {
    const future = fromProvided(liability, liability.providedSchedule).filter(
      (row) => row.dueDate > asOfDate,
    );
    const events = [...repaymentEvents(liability), ...chargeEvents(liability)]
      .filter((event) => event.date > asOfDate)
      .sort((a, b) => a.date.localeCompare(b.date));
    // Les événements ne réécrivent pas un échéancier bancaire : ils s'y ajoutent comme
    // lignes de trésorerie distinctes, l'échéancier restant la source de vérité.
    const extra = events.map((event) =>
      event.type === "CHARGE"
        ? entry(liability, {
            paymentNumber: 0,
            entryKind: "CHARGE",
            dueDate: event.date,
            openingBalance: 0,
            interest: 0,
            capitalisedInterest: 0,
            principal: 0,
            insurance: 0,
            fees: event.amount,
            closingBalance: 0,
            kind: "ACTUAL",
          })
        : entry(liability, {
            paymentNumber: 0,
            entryKind: "EARLY_REPAYMENT",
            dueDate: event.date,
            openingBalance: 0,
            interest: 0,
            capitalisedInterest: 0,
            principal: event.repayment.amount,
            insurance: 0,
            fees: event.repayment.penalty ?? 0,
            closingBalance: 0,
            kind: event.repayment.penalty === null ? "MODEL_ASSUMPTION" : "ACTUAL",
          }),
    );
    // Un échéancier bancaire reste ACTUAL, mais un événement dont la convention est
    // inconnue rend la trajectoire hypothétique : la marquer ACTUAL la ferait passer pour
    // certifiée par la banque.
    const assumedEvent = extra.some((row) => row.kind === "MODEL_ASSUMPTION");
    const unknownConvention = events.some(
      (event) => event.type === "EARLY_REPAYMENT" && event.repayment.outcome === "UNKNOWN",
    );
    const scheduleFlags: LoanScheduleFlag[] = unknownConvention
      ? [
          {
            code: "EARLY_REPAYMENT_CONVENTION_UNKNOWN",
            detail:
              "Remboursement anticipé de convention inconnue sur un prêt à échéancier bancaire : les prélèvements postérieurs ne sont plus ceux du document.",
          },
        ]
      : [];
    return summarise(
      liability.id,
      [...future, ...extra],
      assumedEvent || unknownConvention ? "MODEL_ASSUMPTION" : "ACTUAL",
      scheduleFlags,
    );
  }

  if (!isUsable(liability)) return EMPTY_SCHEDULE(liability.id, "MISSING");
  const elapsed = elapsedPaymentsAt(liability, asOfDate);
  const remaining = Math.trunc(liability.paymentCount) - elapsed;
  const events = [...repaymentEvents(liability), ...chargeEvents(liability)].filter(
    (event) => event.date > asOfDate,
  );
  if (liability.currentBalance <= 0) {
    // Dette éteinte : plus aucune échéance, mais un frais ponctuel futur reste exigible.
    const only = amortise({
      liability,
      openingBalance: 0,
      firstPaymentNumber: elapsed + 1,
      paymentsToProduce: Math.max(0, remaining),
      events,
    });
    return summarise(
      liability.id,
      only.entries,
      only.assumed ? "MODEL_ASSUMPTION" : "DERIVED",
      only.flags,
    );
  }
  if (remaining <= 0 && !events.length) return EMPTY_SCHEDULE(liability.id);
  const result = amortise({
    liability,
    openingBalance: liability.currentBalance,
    firstPaymentNumber: elapsed + 1,
    paymentsToProduce: Math.max(0, remaining),
    events,
  });
  return summarise(
    liability.id,
    result.entries,
    result.assumed ? "MODEL_ASSUMPTION" : "DERIVED",
    result.flags,
  );
}

// ─── Réconciliation d'encours et vue complète ─────────────────────────────────────────

/**
 * Trois encours qu'il ne faut jamais confondre.
 *
 * L'encours OBSERVÉ fait foi pour toute projection. Un écart avec l'encours contractuel
 * est une anomalie à exposer, jamais un motif de recalculer la donnée pour la faire
 * coller au modèle.
 */
export interface BalanceReconciliation {
  /** Ce que le contrat prévoyait après les échéances déjà exigibles. */
  contractual: number;
  /** Ce que la source déclare aujourd'hui. Fait foi. */
  observed: number;
  /** Écart observé − contractuel. Positif : la dette est plus lourde qu'annoncé. */
  difference: number;
  reconciled: boolean;
}

export interface LoanTimeline {
  liability: Liability;
  contractual: LoanSchedule;
  forward: LoanSchedule;
  elapsedPayments: number;
  remainingPayments: number;
  observedBalance: number;
  contractualBalanceAtAsOf: number;
  balance: BalanceReconciliation;
  /** (mensualité amortissante × nombre d'échéances) − capital emprunté. */
  contractualGap: number;
  /**
   * Montant par échéance qui expliquerait l'écart contractuel s'il correspondait à une
   * assurance ou à des frais non déclarés. Hypothèse de lecture, jamais une donnée.
   */
  impliedChargePerPayment: number | null;
  flags: LoanScheduleFlag[];
}

/** Encours projeté à une date future, depuis l'encours observé. */
export function projectedBalanceAt(
  liability: Liability,
  asOfDate: string,
  targetDate: string,
): number {
  if (targetDate <= asOfDate) return liability.currentBalance;
  const due = buildForwardSchedule(liability, asOfDate).entries.filter(
    (row) => row.dueDate <= targetDate,
  );
  if (!due.length) return liability.currentBalance;
  // L'encours observé ancre la projection ; l'échéancier n'en fournit que les variations.
  // Reprendre le `closingBalance` absolu d'un échéancier bancaire écraserait silencieusement
  // une observation plus récente, alors que c'est elle la vérité du bilan à `asOfDate`.
  const change = due.reduce((sum, row) => sum + row.principal - row.capitalisedInterest, 0);
  return Math.max(0, liability.currentBalance - change);
}

/**
 * Vue complète d'un prêt à une date d'observation : contrat, projection, écarts.
 * Les cash-outs passés proviennent du contrat, les futurs de l'encours observé, ce qui
 * rend le service de dette exact des deux côtés de la date zéro.
 */
export function buildLoanTimeline(liability: Liability, asOfDate: string): LoanTimeline {
  const flags: LoanScheduleFlag[] = [];
  if (parseIsoDate(liability.firstPaymentDate) === null && !hasProvidedSchedule(liability)) {
    flags.push({
      code: "RECONCILIATION_REQUIRED",
      detail:
        "Première échéance non datée : aucune échéance ne peut être positionnée dans le temps.",
    });
  }
  if (hasProvidedSchedule(liability)) {
    flags.push({
      code: "PROVIDED_SCHEDULE_USED",
      detail: `Échéancier bancaire de ${liability.providedSchedule.length} lignes utilisé tel quel. Aucune reconstruction théorique n'est appliquée.`,
    });
  }

  if (
    liability.amortisationProfile === "BALLOON" &&
    (liability.balloonAmount === null || liability.balloonAmount === undefined)
  ) {
    flags.push({
      code: "BALLOON_AMOUNT_MISSING",
      detail:
        "Profil balloon déclaré sans montant de solde final. Sans lui, le paiement courant est indéterminé : le prêt est traité comme amortissable jusqu'à extinction.",
    });
  }

  const contractual = buildContractualSchedule(liability);
  const forward = buildForwardSchedule(liability, asOfDate);
  flags.push(...contractual.flags, ...forward.flags);

  const elapsed = elapsedPaymentsAt(liability, asOfDate);
  const paymentRows = contractual.entries.filter((row) => row.entryKind === "PAYMENT");
  const remaining = hasProvidedSchedule(liability)
    ? Math.max(0, paymentRows.length - elapsed)
    : Math.max(0, Math.trunc(liability.paymentCount) - elapsed);
  const contractualBalanceAtAsOf =
    elapsed === 0
      ? (paymentRows[0]?.openingBalance ?? liability.principal)
      : (paymentRows.filter((row) => row.dueDate <= asOfDate).at(-1)?.closingBalance ?? 0);

  // L'écart « paiements × nombre − capital » ne veut rien dire hors d'un amortissable à
  // taux fixe : un in fine ne rembourse rien avant maturité, un balloon laisse un solde.
  const comparablePayments =
    !hasProvidedSchedule(liability) &&
    (liability.amortisationProfile ?? "AMORTIZING") === "AMORTIZING" &&
    (liability.rateSchedule ?? []).length === 0 &&
    (liability.paymentSchedule ?? []).length === 0;
  const declaredCount = hasProvidedSchedule(liability)
    ? paymentRows.length
    : Math.trunc(liability.paymentCount);
  if (comparablePayments && paymentRows.length && paymentRows.length < declaredCount) {
    flags.push({
      code: "EARLY_PAYOFF",
      detail: `Le capital est éteint à la ${paymentRows.length}e échéance alors que ${declaredCount} sont annoncées.`,
    });
  }
  if (
    contractual.lastDueDate &&
    liability.maturityDate &&
    contractual.lastDueDate !== liability.maturityDate
  ) {
    flags.push({
      code: "MATURITY_MISMATCH",
      detail: `Dernière échéance ${frDate(contractual.lastDueDate)}, maturité annoncée ${frDate(liability.maturityDate)}.`,
    });
  }

  const difference = liability.currentBalance - contractualBalanceAtAsOf;
  if (Math.abs(difference) > 0.01) {
    flags.push({
      code: "BALANCE_MISMATCH",
      detail: `Encours observé ${EUR.format(liability.currentBalance)} contre ${EUR.format(contractualBalanceAtAsOf)} attendus après ${elapsed} échéance${elapsed > 1 ? "s" : ""}. L'encours observé fait foi pour la projection.`,
    });
  }

  const forwardResidual =
    forward.entries.filter((row) => row.entryKind !== "CHARGE").at(-1)?.closingBalance ?? 0;
  if (forwardResidual > 0.01) {
    flags.push({
      code: "RECONCILIATION_REQUIRED",
      detail: `Les ${remaining} échéances restantes ne soldent pas l'encours observé : ${EUR.format(forwardResidual)} subsisteraient à la dernière échéance annoncée.`,
    });
  }

  const amortising = amortisingPayment(liability);
  const contractualGap = comparablePayments
    ? amortising * Math.trunc(liability.paymentCount) - liability.principal
    : 0;
  let impliedChargePerPayment: number | null = null;
  const theoretical = theoreticalPayment(liability);
  if (
    comparablePayments &&
    Math.trunc(liability.paymentCount) > 0 &&
    liability.monthlyPayment > 0 &&
    amortising - theoretical > 0.005
  ) {
    // Reconstruire par le bas plutôt que déclarer l'écart inexplicable : si la mensualité
    // déclarée dépasse la mensualité amortissante théorique, la différence a le profil
    // d'une assurance ou de frais non renseignés. C'est une piste, pas une donnée.
    impliedChargePerPayment = amortising - theoretical;
    flags.push({
      code: "PAYMENT_EXCEEDS_AMORTISATION",
      detail: `Mensualité déclarée ${EUR.format(liability.monthlyPayment)} contre ${EUR.format(theoretical)} nécessaires pour amortir ${EUR.format(liability.principal)} sur ${Math.trunc(liability.paymentCount)} échéances à ${(liability.annualRate * 100).toFixed(2)} %. Écart de ${EUR.format(impliedChargePerPayment)} par échéance, soit ${EUR.format(contractualGap)} au total : profil d'une assurance ou de frais non déclarés, à confirmer auprès du prêteur.`,
    });
  }

  const seen = new Set<string>();
  const merged = flags.filter((flag) => {
    const key = `${flag.code}|${flag.detail}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return {
    liability,
    contractual,
    forward,
    elapsedPayments: elapsed,
    remainingPayments: remaining,
    observedBalance: liability.currentBalance,
    contractualBalanceAtAsOf,
    balance: {
      contractual: contractualBalanceAtAsOf,
      observed: liability.currentBalance,
      difference,
      reconciled: Math.abs(difference) <= 0.01,
    },
    contractualGap,
    impliedChargePerPayment,
    flags: merged,
  };
}

// ─── Service de dette et interconnexions ──────────────────────────────────────────────

/**
 * Lignes exigibles sur l'axe du temps : le contrat pour le passé, la projection depuis
 * l'encours observé pour le futur. Les montants passés sont des faits, les futurs une
 * dérivation ; aucun capital n'est amorti deux fois.
 *
 * Les événements passés (remboursement anticipé déjà effectué, frais déjà prélevé) sont
 * de vraies sorties de trésorerie : ils rejoignent la partie passée sans toucher à
 * l'encours observé, qui les contient déjà.
 */
function timelineEntries(liability: Liability, asOfDate: string): LoanScheduleEntry[] {
  const timeline = buildLoanTimeline(liability, asOfDate);
  const pastEvents: LoanScheduleEntry[] = [
    ...repaymentEvents(liability),
    ...chargeEvents(liability),
  ]
    .filter((event) => event.date <= asOfDate)
    .map((event) =>
      event.type === "CHARGE"
        ? entry(liability, {
            paymentNumber: 0,
            entryKind: "CHARGE",
            dueDate: event.date,
            openingBalance: 0,
            interest: 0,
            capitalisedInterest: 0,
            principal: 0,
            insurance: 0,
            fees: event.amount,
            closingBalance: 0,
            kind: "ACTUAL",
          })
        : entry(liability, {
            paymentNumber: 0,
            entryKind: "EARLY_REPAYMENT",
            dueDate: event.date,
            openingBalance: 0,
            interest: 0,
            capitalisedInterest: 0,
            principal: event.repayment.amount,
            insurance: 0,
            fees: event.repayment.penalty ?? 0,
            closingBalance: 0,
            kind: event.repayment.penalty === null ? "MODEL_ASSUMPTION" : "ACTUAL",
          }),
    );
  return [
    ...timeline.contractual.entries.filter((row) => row.dueDate <= asOfDate),
    ...pastEvents,
    ...timeline.forward.entries,
  ];
}

/**
 * Décomposition du service de dette sur une période.
 *
 * `totalCashOut` est ce qui sort du compte, `economicCost` ce qui appauvrit réellement.
 * Le principal remboursé n'appartient qu'au premier : il éteint un passif, il ne détruit
 * pas de patrimoine. Les intérêts capitalisés n'appartiennent qu'au second : ils ne
 * sortent pas du compte mais alourdissent la dette.
 */
export interface DebtServiceBreakdown {
  principal: number;
  interest: number;
  capitalisedInterest: number;
  insurance: number;
  /** Frais décaissés. */
  fees: number;
  /** Frais incorporés au financement : coût économique sans sortie de trésorerie. */
  capitalisedCharges: number;
  totalCashOut: number;
  economicCost: number;
}

const EMPTY_BREAKDOWN: DebtServiceBreakdown = {
  principal: 0,
  interest: 0,
  capitalisedInterest: 0,
  insurance: 0,
  fees: 0,
  capitalisedCharges: 0,
  totalCashOut: 0,
  economicCost: 0,
};

export function debtServiceBreakdownForPeriod(
  liabilities: Liability[],
  asOfDate: string,
  startDate: string,
  endDate: string,
): DebtServiceBreakdown {
  return liabilities
    .flatMap((liability) =>
      timelineEntries(liability, asOfDate).filter(
        (row) => row.dueDate >= startDate && row.dueDate <= endDate,
      ),
    )
    .reduce<DebtServiceBreakdown>(
      (total, row) => ({
        principal: total.principal + row.principal,
        interest: total.interest + row.interest,
        capitalisedInterest: total.capitalisedInterest + row.capitalisedInterest,
        insurance: total.insurance + row.insurance,
        fees: total.fees + row.fees,
        capitalisedCharges: total.capitalisedCharges + row.capitalisedCharges,
        totalCashOut: total.totalCashOut + row.totalCashOut,
        economicCost:
          total.economicCost +
          row.interest +
          row.capitalisedInterest +
          row.insurance +
          row.fees +
          row.capitalisedCharges,
      }),
      { ...EMPTY_BREAKDOWN },
    );
}

/** Σ des cash-outs exigibles dans [startDate, endDate], bornes incluses. */
export function debtServiceForPeriod(
  liabilities: Liability[],
  asOfDate: string,
  startDate: string,
  endDate: string,
): number {
  return debtServiceBreakdownForPeriod(liabilities, asOfDate, startDate, endDate).totalCashOut;
}

/** Service de dette du mois civil contenant `asOfDate`. Vaut 0 hors période de remboursement. */
export function monthlyDebtServiceAt(liabilities: Liability[], asOfDate: string): number {
  const { start, end } = monthBounds(asOfDate);
  return debtServiceForPeriod(liabilities, asOfDate, start, end);
}

export interface DebtEvent {
  liability: Liability;
  entry: LoanScheduleEntry;
  daysAway: number | null;
  isFirstPayment: boolean;
}

/** Échéances exigibles strictement après `asOfDate`, projetées depuis l'encours observé. */
export function upcomingDebtEvents(
  liabilities: Liability[],
  asOfDate: string,
  horizonDays?: number,
): DebtEvent[] {
  const horizonDate =
    horizonDays === undefined
      ? null
      : toIso(new Date((parseIsoDate(asOfDate)?.getTime() ?? 0) + horizonDays * DAY));
  return liabilities
    .flatMap((liability) =>
      buildForwardSchedule(liability, asOfDate)
        .entries.filter((row) => horizonDate === null || row.dueDate <= horizonDate)
        .map((row) => ({
          liability,
          entry: row,
          daysAway: daysBetween(asOfDate, row.dueDate),
          isFirstPayment: row.entryKind === "PAYMENT" && row.paymentNumber === 1,
        })),
    )
    .sort((a, b) => a.entry.dueDate.localeCompare(b.entry.dueDate));
}

export function nextDebtEvent(liabilities: Liability[], asOfDate: string): DebtEvent | null {
  return upcomingDebtEvents(liabilities, asOfDate)[0] ?? null;
}

/**
 * Capital restant dû à `targetDate`, projeté depuis l'encours observé à `asOfDate`.
 * Une date cible antérieure ou égale à la date d'observation rend l'encours observé tel
 * quel : les échéances déjà payées y sont incorporées et ne sont jamais redéduites.
 */
export function outstandingBalanceAt(
  liability: Liability,
  asOfDate: string,
  targetDate: string = asOfDate,
): number {
  return projectedBalanceAt(liability, asOfDate, targetDate);
}

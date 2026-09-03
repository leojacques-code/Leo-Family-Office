/**
 * OPEN BANKING — LECTURE D'UNE OPÉRATION OBSERVÉE
 *
 * Fonctions pures. Aucun accès réseau, aucun accès base, aucune horloge implicite, aucune
 * finance. Cette couche traduit ce que le fournisseur a dit en une OBSERVATION explicite,
 * et refuse de compléter ce qui manque.
 *
 * Ce qu'elle ne fait jamais :
 *
 *   * elle ne CLASSE aucun flux : une opération observée naît sans catégorie, et le Cash
 *     Flow Engine la compte comme non classée ;
 *   * elle ne CONVERTIT aucune devise : `FX ABSENT ≠ FX ÉGAL À 1`, et un montant converti
 *     par la banque conserve son montant d'origine sans qu'un taux soit déduit du rapport
 *     des deux — ce rapport inclut la marge de la banque, ce n'est pas un taux de marché ;
 *   * elle ne CHOISIT pas une date à la place d'une autre : les trois dates sont
 *     conservées, et l'absence de date d'opération BLOQUE au lieu de se replier sur une
 *     autre ;
 *   * elle ne DÉDUIT aucun montant d'un solde : `SOLDE ABSENT ≠ SOLDE À ZÉRO`, et une
 *     variation de solde n'est pas un flux de trésorerie.
 */
import type { ImportIssueCode, ImportIssueSeverity, ImportRowStatus } from "../types";
import type {
  BankObservationState,
  BankProviderCapabilities,
  BankSyncIssue,
  ProviderBalance,
  ProviderTransaction,
} from "./types";

/** Une opération observée, lue et qualifiée, prête à être mise en attente de décision. */
export interface NormalizedObservation {
  providerTransactionId: string | null;
  providerAccountId: string;
  state: BankObservationState;
  /** Date retenue pour le fait canonique. Toujours la date d'OPÉRATION, jamais une autre. */
  operationDate: string | null;
  valueDate: string | null;
  bookingDate: string | null;
  amount: number | null;
  currency: string | null;
  label: string | null;
  counterparty: string | null;
  reference: string | null;
  originalAmount: number | null;
  originalCurrency: string | null;
  replacesProviderTransactionId: string | null;
  /**
   * Empreinte de RESSEMBLANCE, lisible, servant à expliquer pourquoi deux observations se
   * ressemblent. Ce n'est PAS une identité : aucune unicité ne s'y appuie.
   */
  matchKey: string | null;
  /**
   * Identité DÉMONTRÉE, préfixée par le fournisseur. Renseignée UNIQUEMENT quand
   * l'adaptateur déclare ses identifiants stables. C'est la seule clé qui porte une unicité.
   */
  externalKey: string | null;
  status: ImportRowStatus;
  issues: BankSyncIssue[];
}

function issue(
  code: ImportIssueCode,
  severity: ImportIssueSeverity,
  message: string,
  field: string | null = null,
  sourceValue: string | null = null,
): BankSyncIssue {
  return { code, severity, field, sourceValue, message };
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Une date fournisseur n'est acceptée qu'en ISO, et seulement si c'est une date de
 * calendrier réelle. `2026-02-30` est syntaxiquement correcte et n'existe pas : la laisser
 * passer produirait une opération à une date inexistante.
 */
export function readProviderDate(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  if (!ISO_DATE.test(trimmed)) return null;
  const [year, month, day] = trimmed.split("-").map((part) => Number(part));
  if (month < 1 || month > 12 || day < 1) return null;
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return null;
  }
  return trimmed;
}

/** Code devise ISO 4217 sur trois lettres. Rien d'autre n'est accepté, ni complété. */
export function readCurrency(value: string | null): string | null {
  if (value === null) return null;
  const folded = value.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(folded) ? folded : null;
}

/**
 * Empreinte de libellé pour la RESSEMBLANCE seule : casse, accents, ponctuation et espaces
 * multiples neutralisés. Elle ne prouve rien, elle explique.
 */
export function foldLabel(value: string | null): string {
  if (value === null) return "";
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export interface NormalizeInput {
  transaction: ProviderTransaction;
  capabilities: BankProviderCapabilities;
  providerId: string;
  /** Devise du compte fournisseur, quand elle est connue. Sert au CONTRÔLE, jamais au repli. */
  accountCurrency: string | null;
  /** Le compte fournisseur est-il rattaché à un compte canonique ? */
  mappedAccountId: string | null;
  /** Plusieurs comptes canoniques revendiquent-ils ce compte fournisseur ? */
  accountAmbiguous: boolean;
}

/**
 * Lit une opération fournisseur.
 *
 * Une observation est BLOQUÉE dès qu'il lui manque de quoi produire un fait canonique
 * complet : date d'opération, montant, devise, libellé ou compte cible. Elle n'est jamais
 * « presque prête » : le Cash Flow Engine refuserait la transaction, et l'apprendre à
 * l'écriture est trop tard.
 *
 * Une opération en attente est LISIBLE mais jamais committable d'office : `PENDING ≠
 * BOOKED`, et écrire une opération en attente puis la revoir comptabilisée doublerait la
 * dépense. Elle reste donc `WARNING`, visible, décochée par défaut.
 */
export function normalizeObservation(input: NormalizeInput): NormalizedObservation {
  const { transaction: tx, capabilities } = input;
  const issues: BankSyncIssue[] = [];

  const operationDate = readProviderDate(tx.operationDate);
  if (tx.operationDate !== null && operationDate === null) {
    issues.push(
      issue(
        "DATE_UNPARSEABLE",
        "ERROR",
        "Date d'opération illisible ou inexistante au calendrier. Elle n'est PAS remplacée par la date de valeur ni par la date de comptabilisation.",
        "operationDate",
        tx.operationDate,
      ),
    );
  } else if (operationDate === null) {
    issues.push(
      issue(
        "BANK_OPERATION_DATE_MISSING",
        "ERROR",
        "Aucune date d'opération. Sans elle, la période d'un flux n'est pas connue, et se replier sur une autre date déplacerait la dépense d'un mois.",
        "operationDate",
        null,
      ),
    );
  }

  const valueDate = readProviderDate(tx.valueDate);
  if (!capabilities.valueDate && tx.valueDate === null) {
    issues.push(
      issue(
        "BANK_VALUE_DATE_NOT_SERVED",
        "INFO",
        "Ce fournisseur ne sert pas de date de valeur. Absente signifie NON SERVIE, pas égale à la date d'opération.",
        "valueDate",
        null,
      ),
    );
  } else if (tx.valueDate !== null && valueDate === null) {
    issues.push(
      issue(
        "VALUE_DATE_UNPARSEABLE",
        "WARNING",
        "Date de valeur illisible. Elle est laissée absente ; le fait canonique reste daté par la date d'opération.",
        "valueDate",
        tx.valueDate,
      ),
    );
  }

  const bookingDate = readProviderDate(tx.bookingDate);
  if (!capabilities.bookingDate && tx.bookingDate === null) {
    issues.push(
      issue(
        "BANK_BOOKING_DATE_NOT_SERVED",
        "INFO",
        "Ce fournisseur ne sert pas de date de comptabilisation. Absente signifie NON SERVIE.",
        "bookingDate",
        null,
      ),
    );
  }

  const currency = readCurrency(tx.currency);
  if (tx.currency === null) {
    issues.push(
      issue(
        "BANK_CURRENCY_MISSING",
        "ERROR",
        "Aucune devise rendue par le fournisseur. La devise du compte n'est PAS reprise en silence : FX ABSENT ≠ FX ÉGAL À 1.",
        "currency",
        null,
      ),
    );
  } else if (currency === null) {
    issues.push(
      issue(
        "CURRENCY_UNKNOWN",
        "ERROR",
        "Devise non reconnue comme un code ISO 4217 sur trois lettres.",
        "currency",
        tx.currency,
      ),
    );
  } else if (input.accountCurrency !== null && currency !== input.accountCurrency) {
    issues.push(
      issue(
        "BANK_CURRENCY_MISMATCH",
        "WARNING",
        `Opération en ${currency} sur un compte déclaré en ${input.accountCurrency}. Le montant est conservé dans SA devise, aucune conversion n'est appliquée.`,
        "currency",
        currency,
      ),
    );
  }

  const amount = typeof tx.amount === "number" && Number.isFinite(tx.amount) ? tx.amount : null;
  if (amount === null) {
    issues.push(
      issue(
        "BANK_AMOUNT_MISSING",
        "ERROR",
        "Aucun montant exploitable. ABSENT ≠ ZÉRO : une opération sans montant n'est pas une opération à zéro.",
        "amount",
        tx.amount === null ? null : String(tx.amount),
      ),
    );
  } else if (amount === 0) {
    issues.push(
      issue(
        "AMOUNT_ZERO",
        "WARNING",
        "Montant à zéro rendu explicitement par le fournisseur. C'est une information, pas une absence.",
        "amount",
        "0",
      ),
    );
  }

  const label = tx.label !== null && tx.label.trim().length > 0 ? tx.label.trim() : null;
  if (label === null) {
    issues.push(
      issue(
        "BANK_LABEL_MISSING",
        "ERROR",
        "Aucun libellé. Une transaction canonique sans libellé n'est pas relisible, et le fournisseur n'en fabrique pas.",
        "label",
        null,
      ),
    );
  }

  const originalCurrency = readCurrency(tx.originalCurrency);
  const originalAmount =
    typeof tx.originalAmount === "number" && Number.isFinite(tx.originalAmount)
      ? tx.originalAmount
      : null;
  if (originalCurrency !== null && originalAmount !== null && currency !== null) {
    issues.push(
      issue(
        "BANK_ORIGINAL_CURRENCY_WITHOUT_RATE",
        "INFO",
        `Opération convertie par la banque : ${originalAmount} ${originalCurrency} pour ${amount ?? "?"} ${currency}. AUCUN taux n'est déduit de ce rapport — il contient la marge de change de la banque, ce n'est pas un taux de marché.`,
        "originalCurrency",
        originalCurrency,
      ),
    );
  }

  if (input.accountAmbiguous) {
    issues.push(
      issue(
        "BANK_ACCOUNT_AMBIGUOUS",
        "ERROR",
        "Plusieurs comptes canoniques revendiquent ce compte fournisseur. Aucun n'est choisi : le rattachement se décide, il ne se devine pas.",
        "providerAccountId",
        tx.providerAccountId,
      ),
    );
  } else if (input.mappedAccountId === null) {
    issues.push(
      issue(
        "BANK_ACCOUNT_NOT_MAPPED",
        "ERROR",
        "Ce compte fournisseur n'est rattaché à aucun compte canonique. Aucun compte n'est créé d'office : un compte inventé fausserait le patrimoine.",
        "providerAccountId",
        tx.providerAccountId,
      ),
    );
  }

  if (tx.state === "PENDING") {
    issues.push(
      issue(
        "BANK_PENDING_OBSERVATION",
        "WARNING",
        "Opération EN ATTENTE. PENDING ≠ BOOKED : son montant et sa date peuvent encore changer, et l'écrire puis la revoir comptabilisée doublerait la dépense. Décochée par défaut.",
        "state",
        tx.state,
      ),
    );
  }
  if (tx.state === "CANCELLED") {
    issues.push(
      issue(
        "BANK_TRANSACTION_CANCELLED",
        "ERROR",
        "Opération annulée par la banque. Elle est conservée comme OBSERVATION et n'est jamais écrite au canonique.",
        "state",
        tx.state,
      ),
    );
  }
  if (tx.state === "CORRECTED") {
    issues.push(
      issue(
        "BANK_TRANSACTION_CORRECTED",
        "WARNING",
        "Opération signalée corrigée par la banque. La version antérieure reste observée ; c'est la correction qui est proposée.",
        "state",
        tx.state,
      ),
    );
  }

  const providerTransactionId =
    tx.providerTransactionId !== null && tx.providerTransactionId.trim().length > 0
      ? tx.providerTransactionId.trim()
      : null;
  if (providerTransactionId === null) {
    issues.push(
      issue(
        "BANK_TRANSACTION_ID_MISSING",
        "INFO",
        "Le fournisseur n'a rendu aucun identifiant pour cette opération. Elle ne pourra jamais être reconnue par identité, seulement par ressemblance.",
        "providerTransactionId",
        null,
      ),
    );
  } else if (!capabilities.stableTransactionIds) {
    issues.push(
      issue(
        "BANK_TRANSACTION_ID_UNSTABLE",
        "INFO",
        "Identifiant rendu par un fournisseur qui ne DÉCLARE PAS ses identifiants stables. Il est conservé tel quel et ne décide d'aucune identité : un identifiant réattribué rejetterait des opérations réelles.",
        "providerTransactionId",
        providerTransactionId,
      ),
    );
  }

  const externalKey =
    capabilities.stableTransactionIds && providerTransactionId !== null
      ? `${input.providerId}:${providerTransactionId}`
      : null;

  const matchKey =
    operationDate !== null && amount !== null && currency !== null
      ? [tx.providerAccountId, operationDate, amount.toFixed(6), currency, foldLabel(label)].join(
          "|",
        )
      : null;

  const blocking = issues.some((entry) => entry.severity === "ERROR");
  const warning = issues.some((entry) => entry.severity === "WARNING");
  const status: ImportRowStatus = blocking ? "BLOCKED" : warning ? "WARNING" : "READY";

  return {
    providerTransactionId,
    providerAccountId: tx.providerAccountId,
    state: tx.state,
    operationDate,
    valueDate,
    bookingDate,
    amount,
    currency,
    label,
    counterparty:
      tx.counterparty !== null && tx.counterparty.trim().length > 0 ? tx.counterparty.trim() : null,
    reference: tx.reference !== null && tx.reference.trim().length > 0 ? tx.reference.trim() : null,
    originalAmount,
    originalCurrency,
    replacesProviderTransactionId: tx.replacesProviderTransactionId,
    matchKey,
    externalKey,
    status,
    issues,
  };
}

/** Un solde observé, lu et qualifié. */
export interface NormalizedBalance {
  providerAccountId: string;
  balanceType: string;
  amount: number | null;
  currency: string | null;
  observedAt: string | null;
  issues: BankSyncIssue[];
}

/**
 * Lit un solde fournisseur.
 *
 * Un solde absent reste `null`. Le remplacer par zéro afficherait un compte vide là où le
 * fournisseur n'a simplement rien dit, et un patrimoine faux ne laisse aucune trace.
 */
export function normalizeBalance(
  balance: ProviderBalance,
  capabilities: BankProviderCapabilities,
): NormalizedBalance {
  const issues: BankSyncIssue[] = [];
  const amount =
    typeof balance.amount === "number" && Number.isFinite(balance.amount) ? balance.amount : null;
  if (amount === null) {
    issues.push(
      issue(
        "BANK_BALANCE_NOT_SERVED",
        "WARNING",
        "Solde NON SERVI par le fournisseur. Il reste absent : un solde inconnu n'est pas un solde à zéro.",
        "amount",
        null,
      ),
    );
  }
  if (!capabilities.balanceTypes.includes(balance.balanceType)) {
    issues.push(
      issue(
        "BANK_BALANCE_TYPE_NOT_SERVED",
        "INFO",
        `Nature de solde « ${balance.balanceType} » hors des natures que cet adaptateur déclare servir. Elle est conservée telle quelle, sans être requalifiée.`,
        "balanceType",
        balance.balanceType,
      ),
    );
  }
  const currency = readCurrency(balance.currency);
  if (balance.currency !== null && currency === null) {
    issues.push(
      issue(
        "CURRENCY_UNKNOWN",
        "WARNING",
        "Devise de solde non reconnue. Le solde reste observé, son total n'est pas calculable.",
        "currency",
        balance.currency,
      ),
    );
  }
  return {
    providerAccountId: balance.providerAccountId,
    balanceType: balance.balanceType,
    amount,
    currency,
    observedAt: readProviderDate(balance.observedAt),
    issues,
  };
}

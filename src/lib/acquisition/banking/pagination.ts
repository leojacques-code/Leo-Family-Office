/**
 * OPEN BANKING — PAGINATION, REPRISE ET PROTECTION CONTRE LE REJEU
 *
 * Fonction pure sur un adaptateur injecté. Aucun accès base : elle rend un PLAN de pages
 * lues, que l'appelant persiste page par page. C'est cette séparation qui rend la reprise
 * possible : une page lue et persistée n'est jamais relue, même si le processus meurt.
 *
 * Trois choses qu'un lecteur naïf confond, et qui coûtent des données :
 *
 *   PAGE VIDE ≠ FIN DE PAGINATION      un fournisseur peut rendre une page vide et un
 *                                      curseur ; s'arrêter là perdrait le reste
 *   CURSEUR IDENTIQUE ≠ FIN            un curseur qui ne progresse pas est une BOUCLE,
 *                                      pas une fin : elle est nommée et interrompue
 *   MÊME EMPREINTE ≠ MÊME PAGE UTILE   une page dont l'empreinte est déjà connue est un
 *                                      REJEU : ses éléments ne sont pas recomptés
 */
import type { ImportIssueCode, ImportIssueSeverity } from "../types";
import type {
  BankProviderFailure,
  BankSyncContext,
  BankSyncIssue,
  ProviderPage,
  ProviderResult,
} from "./types";
import { RETRYABLE_PROVIDER_FAILURES } from "./types";

/**
 * Plafond de pages par synchronisation. Il REFUSE au lieu de tronquer en silence : la
 * synchronisation s'arrête en signalant qu'elle est incomplète, et son curseur reste
 * exploitable pour reprendre.
 */
export const MAX_PAGES_PER_SYNC = 200;

/** Nombre maximal de tentatives d'un même appel, pour un échec RÉESSAYABLE seulement. */
export const MAX_ATTEMPTS_PER_PAGE = 3;

const FAILURE_ISSUE_CODES: Record<string, ImportIssueCode> = {
  UNAUTHORIZED: "BANK_PROVIDER_UNAUTHORIZED",
  FORBIDDEN: "BANK_PROVIDER_FORBIDDEN",
  CONSENT_EXPIRED: "BANK_CONSENT_EXPIRED",
  CONSENT_REVOKED: "BANK_CONSENT_REVOKED",
  RATE_LIMITED: "BANK_PROVIDER_RATE_LIMITED",
  SERVER_ERROR: "BANK_PROVIDER_SERVER_ERROR",
  TIMEOUT: "BANK_PROVIDER_TIMEOUT",
  NETWORK_ERROR: "BANK_PROVIDER_NETWORK_ERROR",
  MALFORMED_RESPONSE: "BANK_PROVIDER_MALFORMED_RESPONSE",
  ACCOUNT_UNKNOWN: "BANK_PROVIDER_NOT_SERVED",
  NOT_SERVED: "BANK_PROVIDER_NOT_SERVED",
};

function issue(
  code: ImportIssueCode,
  severity: ImportIssueSeverity,
  message: string,
  field: string | null = null,
  sourceValue: string | null = null,
): BankSyncIssue {
  return { code, severity, field, sourceValue, message };
}

/** Traduit un échec fournisseur en anomalie nommée. Un échec sans code n'est pas exploitable. */
export function failureIssue(failure: BankProviderFailure): BankSyncIssue {
  return issue(
    FAILURE_ISSUE_CODES[failure.code] ?? "BANK_PROVIDER_SERVER_ERROR",
    "ERROR",
    failure.message,
    "provider",
    failure.code,
  );
}

export interface FetchedPage<T> {
  pageNumber: number;
  /** Curseur DEMANDÉ pour obtenir cette page. `null` pour la première. */
  requestCursor: string | null;
  nextCursor: string | null;
  payloadHash: string;
  rawPayload: string;
  items: readonly T[];
  /** La page a-t-elle déjà été vue lors d'une exécution antérieure ? */
  replayed: boolean;
}

export interface PaginationOutcome<T> {
  pages: FetchedPage<T>[];
  /** Curseur à reprendre. `null` = le fournisseur a déclaré la fin. */
  resumeCursor: string | null;
  /** La pagination est-elle allée jusqu'à la fin déclarée par le fournisseur ? */
  complete: boolean;
  failure: BankProviderFailure | null;
  issues: BankSyncIssue[];
}

export interface PaginationInput<T> {
  context: BankSyncContext;
  /** Curseur de reprise persisté, ou `null` pour partir du début. */
  startCursor: string | null;
  /** Empreintes des pages DÉJÀ persistées, pour reconnaître un rejeu. */
  knownPayloadHashes: ReadonlySet<string>;
  /** Numéro de la dernière page persistée, pour que la numérotation reste continue. */
  lastPageNumber: number;
  fetchPage: (cursor: string | null) => Promise<ProviderResult<ProviderPage<T>>>;
}

/**
 * Lit les pages à partir du curseur de reprise.
 *
 * Sur un échec RÉESSAYABLE, l'appel est retenté jusqu'à `MAX_ATTEMPTS_PER_PAGE`. Sur un
 * échec non réessayable — consentement expiré ou révoqué, autorisation refusée — la
 * pagination s'arrête IMMÉDIATEMENT : réessayer un consentement révoqué ne le ressuscite
 * pas, et insister est ce qui fait bloquer un accès par l'agrégateur.
 *
 * Dans tous les cas d'arrêt, `resumeCursor` porte le dernier curseur exploitable : une
 * interruption n'oblige jamais à tout relire.
 */
export async function readAllTransactionPages<T>(
  input: PaginationInput<T>,
): Promise<PaginationOutcome<T>> {
  const pages: FetchedPage<T>[] = [];
  const issues: BankSyncIssue[] = [];
  const seenCursors = new Set<string>();
  let cursor = input.startCursor;
  let pageNumber = input.lastPageNumber;

  if (input.startCursor !== null) {
    issues.push(
      issue(
        "BANK_SYNC_RESUMED",
        "INFO",
        "Synchronisation REPRISE au curseur persisté. Les pages déjà écrites ne sont pas relues.",
        "cursor",
        input.startCursor,
      ),
    );
  }

  for (let read = 0; read < MAX_PAGES_PER_SYNC; read += 1) {
    if (cursor !== null) {
      if (seenCursors.has(cursor)) {
        issues.push(
          issue(
            "BANK_CURSOR_NOT_ADVANCING",
            "ERROR",
            "Le fournisseur rend le même curseur que précédemment : c'est une BOUCLE, pas une fin de pagination. La lecture s'arrête ici plutôt que de tourner indéfiniment.",
            "cursor",
            cursor,
          ),
        );
        return { pages, resumeCursor: cursor, complete: false, failure: null, issues };
      }
      seenCursors.add(cursor);
    }

    let result: ProviderResult<ProviderPage<T>> | null = null;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS_PER_PAGE; attempt += 1) {
      result = await input.fetchPage(cursor);
      if (result.ok) break;
      if (!RETRYABLE_PROVIDER_FAILURES.includes(result.failure.code)) break;
      if (attempt === MAX_ATTEMPTS_PER_PAGE) break;
    }
    if (result === null || !result.ok) {
      const failure = result === null ? null : result.failure;
      if (failure !== null) issues.push(failureIssue(failure));
      return { pages, resumeCursor: cursor, complete: false, failure, issues };
    }

    const page = result.value;
    pageNumber += 1;
    const replayed = input.knownPayloadHashes.has(page.payloadHash);
    if (replayed) {
      issues.push(
        issue(
          "BANK_PAGE_REPLAYED",
          "INFO",
          "Page déjà reçue à l'identique lors d'une exécution antérieure : son contenu n'est pas recompté. Rejouer une synchronisation ne crée aucun doublon.",
          "payloadHash",
          page.payloadHash,
        ),
      );
    }
    pages.push({
      pageNumber,
      requestCursor: cursor,
      nextCursor: page.nextCursor,
      payloadHash: page.payloadHash,
      rawPayload: page.rawPayload,
      items: page.items,
      replayed,
    });

    // PAGE VIDE ≠ FIN. Seul un curseur `null` déclare la fin.
    if (page.nextCursor === null) {
      return { pages, resumeCursor: null, complete: true, failure: null, issues };
    }
    cursor = page.nextCursor;
  }

  issues.push(
    issue(
      "BANK_PAGE_LIMIT_REACHED",
      "WARNING",
      `Plafond de ${MAX_PAGES_PER_SYNC} pages atteint. La synchronisation est INCOMPLÈTE et le déclare ; son curseur reste exploitable pour reprendre.`,
      "cursor",
      cursor,
    ),
  );
  return { pages, resumeCursor: cursor, complete: false, failure: null, issues };
}

/**
 * Lecture paginée des ledgers.
 *
 * PostgREST borne implicitement chaque réponse. Sans pagination, un ledger long serait
 * tronqué en silence ; avec une pagination sans garde-fou, il le serait toujours au-delà
 * de la borne. Or un ledger amputé de ses dernières pages produit des quantités, un cash
 * et un coût de revient parfaitement calculés sur des faits incomplets : faux, sans que
 * rien ne le dise.
 *
 * La règle est donc explicite : une lecture tronquée n'est jamais rendue comme
 * exploitable. C'est une défaillance de la couche données, pas une incertitude
 * financière, et elle remonte comme telle.
 */

/** Nombre maximum de pages lues avant de refuser une lecture tronquée. */
export const LEDGER_MAX_PAGES = 20;
/** Taille d'une page. Alignée sur la borne par défaut de PostgREST. */
export const LEDGER_PAGE_SIZE = 1000;

export interface PageResponse<TRow, TError> {
  data: TRow[] | null;
  error: TError | null;
}

/** Signalée quand la borne de pagination est atteinte : la lecture est incomplète. */
export class LedgerTruncationError extends Error {
  constructor(label: string, limit: number) {
    super(
      `Supabase lecture ${label} : plus de ${limit} lignes, lecture tronquée. ` +
        "Un ledger partiel ne peut pas être présenté comme complet.",
    );
    this.name = "LedgerTruncationError";
  }
}

/**
 * Lit toutes les pages d'une source jusqu'à épuisement.
 *
 * S'arrête à la première page incomplète, propage une erreur de lecture telle quelle, et
 * LÈVE `LedgerTruncationError` si la borne est atteinte sans avoir vu de page incomplète.
 */
export async function readAllPages<TRow, TError>(
  label: string,
  fetchPage: (from: number, to: number) => Promise<PageResponse<TRow, TError>>,
  options: { maxPages?: number; pageSize?: number } = {},
): Promise<PageResponse<TRow, TError>> {
  const maxPages = options.maxPages ?? LEDGER_MAX_PAGES;
  const pageSize = options.pageSize ?? LEDGER_PAGE_SIZE;
  const rows: TRow[] = [];
  for (let page = 0; page < maxPages; page += 1) {
    const from = page * pageSize;
    const result = await fetchPage(from, from + pageSize - 1);
    if (result.error) return { data: null, error: result.error };
    const batch = result.data ?? [];
    rows.push(...batch);
    if (batch.length < pageSize) return { data: rows, error: null };
  }
  throw new LedgerTruncationError(label, maxPages * pageSize);
}

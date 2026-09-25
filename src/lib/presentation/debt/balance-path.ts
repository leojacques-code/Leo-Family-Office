import type { LoanScheduleEntry } from "@/lib/types";

/**
 * Trajectoire de l'encours pour le graphe du poste Dette (V10 §12 et §22). Ce module ne
 * calcule rien : il REPREND les soldes de clôture produits par le Debt Engine et les met en
 * forme pour un tracé en escalier.
 *
 * Trois règles, parce qu'un graphe qui relie des points en diagonale ment :
 * - aucun échantillonnage : sauter des lignes ferait disparaître un palier (un in fine
 *   paraîtrait s'amortir linéairement) ;
 * - le point de départ est l'encours OBSERVÉ à sa date, puis un point par date d'échéance,
 *   le solde retenu étant celui de la DERNIÈRE ligne de la date (échéance, frais et
 *   remboursement anticipé peuvent tomber le même jour) ;
 * - une ligne d'assurance séparée ne change pas l'encours : elle n'entre pas dans le tracé.
 */
export interface BalancePoint {
  date: string;
  balance: number;
}

export function balancePath(
  entries: readonly Pick<LoanScheduleEntry, "dueDate" | "entryKind" | "closingBalance">[],
  observed: { date: string; balance: number } | null,
): BalancePoint[] {
  const byDate = new Map<string, number>();
  if (observed) byDate.set(observed.date, observed.balance);
  for (const entry of entries) {
    if (entry.entryKind === "INSURANCE") continue;
    byDate.set(entry.dueDate, entry.closingBalance);
  }
  return [...byDate.entries()]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([date, balance]) => ({ date, balance }));
}

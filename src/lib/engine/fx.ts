import type { Provenance } from "@/lib/types";

export interface CurrencyRate {
  id?: string;
  baseCurrency: string;
  quoteCurrency: string;
  rate: number;
  rateDate: string;
  provenance: Provenance;
}

export type FxStatus = "IDENTITY" | "CURRENT" | "STALE" | "MISSING";

export interface FxResolution {
  baseCurrency: string;
  quoteCurrency: string;
  valueDate: string;
  rate: number | null;
  rateDate: string | null;
  status: FxStatus;
  inverted: boolean;
  provenance: Provenance;
  flags: string[];
}

export const FX_STALE_AFTER_DAYS = 3;

function daysBetween(earlier: string, later: string): number {
  return Math.floor(
    (Date.parse(`${later}T00:00:00Z`) - Date.parse(`${earlier}T00:00:00Z`)) / 86_400_000,
  );
}

/**
 * Convention unique : rate(base, quote) représente les unités de quote pour une unité
 * de base. Le taux admissible est le plus récent dont rateDate <= valueDate.
 */
export function resolveFxRate(
  baseCurrency: string,
  quoteCurrency: string,
  valueDate: string,
  rates: CurrencyRate[],
): FxResolution {
  const base = baseCurrency.toUpperCase();
  const quote = quoteCurrency.toUpperCase();
  if (base === quote) {
    return {
      baseCurrency: base,
      quoteCurrency: quote,
      valueDate,
      rate: 1,
      rateDate: valueDate,
      status: "IDENTITY",
      inverted: false,
      provenance: {
        kind: "DERIVED",
        confidence: "HIGH",
        effectiveDate: valueDate,
        source: "currency identity",
      },
      flags: [],
    };
  }

  const eligible = rates
    .filter((candidate) => candidate.rate > 0 && candidate.rateDate <= valueDate)
    .filter((candidate) => {
      const candidateBase = candidate.baseCurrency.toUpperCase();
      const candidateQuote = candidate.quoteCurrency.toUpperCase();
      return (
        (candidateBase === base && candidateQuote === quote) ||
        (candidateBase === quote && candidateQuote === base)
      );
    })
    .sort((left, right) => {
      const dateOrder = right.rateDate.localeCompare(left.rateDate);
      if (dateOrder !== 0) return dateOrder;
      const leftDirect = left.baseCurrency.toUpperCase() === base ? 1 : 0;
      const rightDirect = right.baseCurrency.toUpperCase() === base ? 1 : 0;
      return rightDirect - leftDirect;
    });
  const source = eligible[0];
  if (!source) {
    return {
      baseCurrency: base,
      quoteCurrency: quote,
      valueDate,
      rate: null,
      rateDate: null,
      status: "MISSING",
      inverted: false,
      provenance: { kind: "MISSING", confidence: "UNKNOWN", source: "currency_rates" },
      flags: [`FX_MISSING:${base}/${quote}@${valueDate}`],
    };
  }

  const inverted = source.baseCurrency.toUpperCase() !== base;
  const ageDays = daysBetween(source.rateDate, valueDate);
  const stale = ageDays > FX_STALE_AFTER_DAYS;
  return {
    baseCurrency: base,
    quoteCurrency: quote,
    valueDate,
    rate: inverted ? 1 / source.rate : source.rate,
    rateDate: source.rateDate,
    status: stale ? "STALE" : "CURRENT",
    inverted,
    provenance: inverted
      ? {
          kind: "DERIVED",
          confidence: source.provenance.confidence,
          effectiveDate: source.rateDate,
          source: `inverse:${source.baseCurrency}/${source.quoteCurrency}`,
        }
      : source.provenance,
    flags: stale ? [`STALE_FX:${base}/${quote}:${ageDays}d`] : [],
  };
}

export function convertWithFx(amount: number, fx: FxResolution): number | null {
  return fx.rate === null ? null : amount * fx.rate;
}

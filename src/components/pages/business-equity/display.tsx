"use client";

import type { ReactNode } from "react";

import type {
  BusinessAmount,
  BusinessQuality,
  BusinessValueRange,
} from "@/lib/engine/business-equity";
import type { BusinessBridgeStep, SensitivityMatrix } from "@/lib/engine/business-valuation";
import {
  describeBlocker,
  describeBridgeStep,
  describeFlag,
  formatBusinessDate,
  summariseQuality,
  type ExplainContext,
} from "@/lib/engine/business-equity-explain";
import { NOT_COMPUTABLE } from "@/components/pages/shared";

/**
 * Primitives d'affichage du domaine Business Equity.
 *
 * Aucune formule ici : ces composants RENDENT ce que le moteur a produit. Leur seule
 * responsabilité financière est de ne jamais transformer un `null` en zéro, et de ne jamais
 * exposer un code technique là où une phrase française est attendue.
 */

const currencyFormatter = (currency: string, compact: boolean) =>
  new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency,
    notation: compact ? "compact" : "standard",
    maximumFractionDigits: compact ? 1 : 0,
  });

export function formatMoney(value: number, currency: string, compact = false): string {
  try {
    return currencyFormatter(currency, compact).format(value);
  } catch {
    return `${value.toLocaleString("fr-FR", { maximumFractionDigits: 0 })} ${currency}`;
  }
}

const percentFormatter = new Intl.NumberFormat("fr-FR", {
  style: "percent",
  minimumFractionDigits: 1,
  maximumFractionDigits: 2,
});

/** Motifs d'un montant non calculable, en français, prêts pour une infobulle. */
export function reasonsOf(amount: BusinessAmount, context: ExplainContext): string {
  return amount.blockers.map((item) => describeBlocker(item, context)).join(" · ");
}

export function Amount({
  amount,
  currency,
  compact = false,
  context,
  sign = false,
}: {
  amount: BusinessAmount;
  currency: string;
  compact?: boolean;
  context: ExplainContext;
  sign?: boolean;
}) {
  if (amount.value === null)
    return (
      <span className="warning-text" title={reasonsOf(amount, context)}>
        {NOT_COMPUTABLE}
      </span>
    );
  const prefix = sign && amount.value > 0 ? "+" : "";
  return <>{`${prefix}${formatMoney(amount.value, currency, compact)}`}</>;
}

export function RateValue({
  amount,
  context,
}: {
  amount: BusinessAmount;
  context: ExplainContext;
}) {
  if (amount.value === null)
    return (
      <span className="warning-text" title={reasonsOf(amount, context)}>
        {NOT_COMPUTABLE}
      </span>
    );
  return <>{percentFormatter.format(amount.value)}</>;
}

export function RatioValue({
  amount,
  context,
  unit = "×",
  digits = 2,
}: {
  amount: BusinessAmount;
  context: ExplainContext;
  unit?: string;
  digits?: number;
}) {
  if (amount.value === null)
    return (
      <span className="warning-text" title={reasonsOf(amount, context)}>
        {NOT_COMPUTABLE}
      </span>
    );
  return (
    <>{`${amount.value.toLocaleString("fr-FR", { minimumFractionDigits: digits, maximumFractionDigits: digits })} ${unit}`}</>
  );
}

/** Fourchette basse — haute. Un intervalle réduit à un point ne s'affiche pas comme un intervalle. */
export function RangeValue({ range, currency }: { range: BusinessValueRange; currency: string }) {
  const { low, high } = range;
  if (low.value === null || high.value === null)
    return <span className="muted-copy">Fourchette non calculable</span>;
  if (low.value === high.value)
    return <span className="muted-copy">Aucune fourchette déclarée</span>;
  return (
    <>
      {formatMoney(low.value, currency, true)} — {formatMoney(high.value, currency, true)}
    </>
  );
}

/** Barre de fourchette : position du central entre la borne basse et la borne haute. */
export function RangeBar({ range }: { range: BusinessValueRange }) {
  const { low, central, high } = range;
  if (low.value === null || high.value === null || central.value === null) return null;
  if (high.value <= low.value) return null;
  const position = ((central.value - low.value) / (high.value - low.value)) * 100;
  return (
    <div className="range-bar" aria-hidden="true">
      <span className="range-track" />
      <span className="range-marker" style={{ left: `${Math.min(100, Math.max(0, position))}%` }} />
    </div>
  );
}

const OPERATOR: Record<BusinessBridgeStep["kind"], string> = {
  METRIC: "",
  ADJUSTMENT: "+",
  SUBTOTAL: "=",
  MULTIPLIER: "×",
  ADD: "+",
  SUBTRACT: "−",
  RESULT: "=",
};

/**
 * Le pont, tel qu'un analyste l'écrirait sur une feuille : une opération par ligne, un
 * total à chaque palier. C'est la réponse à « d'où vient ce chiffre ? ».
 */
export function BridgeTable({
  bridge,
  currency,
  context,
}: {
  bridge: BusinessBridgeStep[];
  currency: string;
  context: ExplainContext;
}) {
  if (bridge.length === 0)
    return (
      <p className="muted-copy">
        Aucun pont à afficher : aucune méthode de valorisation n’est encore déclarée.
      </p>
    );
  return (
    <div className="bridge-table">
      {bridge.map((step, index) => {
        const negative = step.kind === "ADJUSTMENT" && (step.amount.value ?? 0) < 0;
        const operator = negative ? "−" : OPERATOR[step.kind];
        const displayed =
          negative && step.amount.value !== null
            ? { ...step.amount, value: Math.abs(step.amount.value) }
            : step.amount;
        return (
          <div
            className={`bridge-row ${step.kind === "SUBTOTAL" || step.kind === "RESULT" ? "subtotal" : ""} ${step.kind === "RESULT" ? "result" : ""}`}
            key={`${step.key}-${index}`}
          >
            <span className="bridge-operator">{operator}</span>
            <span className="bridge-label">
              <strong>{describeBridgeStep(step, context)}</strong>
              {step.date ? <small>{formatBusinessDate(step.date)}</small> : null}
            </span>
            <span className="bridge-value">
              {step.unit === "MULTIPLE" ? (
                <RatioValue amount={displayed} context={context} digits={2} />
              ) : step.unit === "RATE" ? (
                <RateValue amount={displayed} context={context} />
              ) : (
                <Amount amount={displayed} currency={currency} context={context} />
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function SensitivityTable({
  matrix,
  currency,
  context,
  rowLabel,
  columnLabel,
  formatRow,
  formatColumn,
}: {
  matrix: SensitivityMatrix;
  currency: string;
  context: ExplainContext;
  rowLabel: string;
  columnLabel: string;
  formatRow: (value: number) => string;
  formatColumn: (value: number) => string;
}) {
  return (
    <div className="sensitivity-table">
      <div className="sensitivity-head">
        <span>
          {rowLabel} \ {columnLabel}
        </span>
        {matrix.columns.map((column) => (
          <span key={column}>{formatColumn(column)}</span>
        ))}
      </div>
      {matrix.rows.map((row, rowIndex) => (
        <div className="sensitivity-row" key={row}>
          <span className="sensitivity-row-label">{formatRow(row)}</span>
          {matrix.cells[rowIndex].map((cell, columnIndex) => (
            <span
              key={`${row}-${matrix.columns[columnIndex]}`}
              className={rowIndex === 1 && columnIndex === 1 ? "central" : ""}
            >
              <Amount amount={cell.amount} currency={currency} compact context={context} />
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * Qualité d'un résultat. « Calculable » n'est jamais affiché pour un résultat qui ne l'est
 * pas, et aucun motif n'est rendu sous forme de code.
 */
export function QualityPanel({
  quality,
  computed,
  context,
  title = "Qualité du résultat",
}: {
  quality: BusinessQuality;
  computed: boolean;
  context: ExplainContext;
  title?: string;
}) {
  const summary = summariseQuality(quality, computed, context);
  if (summary.level === "COMPLETE" && summary.reserves.length === 0) {
    return (
      <div className="quality-panel complete">
        <strong>{title}</strong>
        <p>Calculée sans réserve : tous les faits nécessaires sont déclarés.</p>
      </div>
    );
  }
  return (
    <div className={`quality-panel ${summary.level.toLowerCase()}`}>
      <strong>
        {title} — {summary.headline}
      </strong>
      {summary.reasons.length > 0 ? (
        <>
          <span className="quality-section">Ce qui bloque</span>
          <ul>
            {summary.reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </>
      ) : null}
      {summary.reserves.length > 0 ? (
        <>
          <span className="quality-section">À lire avec réserve</span>
          <ul className="reserves">
            {summary.reserves.map((reserve) => (
              <li key={reserve}>{reserve}</li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}

/** Ligne d'un tableau de faits : libellé, valeur, précision. */
export function FactRow({
  label,
  value,
  detail,
}: {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
}) {
  return (
    <div className="fact-row">
      <span>
        <strong>{label}</strong>
        {detail ? <small>{detail}</small> : null}
      </span>
      <span className="fact-value">{value}</span>
    </div>
  );
}

export function flagList(quality: BusinessQuality, context: ExplainContext): string[] {
  return quality.flags.map((item) => describeFlag(item, context));
}

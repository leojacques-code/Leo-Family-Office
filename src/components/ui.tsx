"use client";

import { useEffect } from "react";
import { AlertTriangle, Check, CircleHelp, Info, X } from "lucide-react";
import type { DataKind } from "@/lib/types";

const eur = new Intl.NumberFormat("fr-FR", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});
const compactEur = new Intl.NumberFormat("fr-FR", {
  style: "currency",
  currency: "EUR",
  notation: "compact",
  maximumFractionDigits: 1,
});
const percent = new Intl.NumberFormat("fr-FR", {
  style: "percent",
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

export function Currency({
  value,
  compact = false,
  sign = false,
}: {
  value: number | null;
  compact?: boolean;
  sign?: boolean;
}) {
  if (value === null) return <span className="warning-text">Non calculable</span>;
  const formatted = (compact ? compactEur : eur).format(Math.abs(value));
  return (
    <>
      {value < 0 ? "−" : sign && value > 0 ? "+" : ""}
      {formatted}
    </>
  );
}

export function Percent({ value, sign = false }: { value: number | null; sign?: boolean }) {
  if (value === null) return <span className="warning-text">Non calculable</span>;
  return (
    <>
      {sign && value > 0 ? "+" : ""}
      {percent.format(value)}
    </>
  );
}

export function DataBadge({ kind }: { kind: DataKind }) {
  const labels: Record<DataKind, string> = {
    ACTUAL: "Actual",
    USER_ASSUMPTION: "User assumption",
    MODEL_ASSUMPTION: "Model assumption",
    EXTERNAL_DATA: "External",
    DERIVED: "Derived",
    MISSING: "Missing",
  };
  return <span className={`data-badge ${kind.toLowerCase()}`}>{labels[kind]}</span>;
}

export function SectionHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <header className="section-header">
      <div>
        {eyebrow ? <span className="eyebrow">{eyebrow}</span> : null}
        <h1>{title}</h1>
        {description ? <p>{description}</p> : null}
      </div>
      {actions ? <div className="header-actions">{actions}</div> : null}
    </header>
  );
}

export function MetricCard({
  label,
  value,
  detail,
  tone = "neutral",
  children,
  onExplain,
}: {
  label: string;
  value: React.ReactNode;
  detail?: React.ReactNode;
  tone?: "neutral" | "positive" | "negative" | "warning";
  children?: React.ReactNode;
  onExplain?: () => void;
}) {
  return (
    <article className={`metric-card ${tone}`}>
      <div className="metric-label">
        <span>{label}</span>
        {onExplain ? (
          <button
            className="icon-button subtle"
            aria-label={`Expliquer ${label}`}
            onClick={onExplain}
          >
            <CircleHelp size={15} />
          </button>
        ) : null}
      </div>
      <div className="metric-value">{value}</div>
      {detail ? <div className="metric-detail">{detail}</div> : null}
      {children}
    </article>
  );
}

export function ProgressBar({
  value,
  tone = "teal",
}: {
  value: number;
  tone?: "teal" | "blue" | "gold" | "red";
}) {
  return (
    <div className="progress-track" aria-label={`${Math.round(value * 100)} %`}>
      <span
        className={`progress-fill ${tone}`}
        style={{ width: `${Math.min(100, Math.max(0, value * 100))}%` }}
      />
    </div>
  );
}

export function Callout({
  tone = "info",
  title,
  children,
}: {
  tone?: "info" | "warning" | "success";
  title: string;
  children: React.ReactNode;
}) {
  const Icon = tone === "warning" ? AlertTriangle : tone === "success" ? Check : Info;
  return (
    <div className={`callout ${tone}`}>
      <Icon size={18} />
      <div>
        <strong>{title}</strong>
        <p>{children}</p>
      </div>
    </div>
  );
}

export function Modal({
  open,
  title,
  subtitle,
  children,
  onClose,
  wide = false,
}: {
  open: boolean;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className={`modal ${wide ? "wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header>
          <div>
            <h2>{title}</h2>
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Fermer">
            <X size={18} />
          </button>
        </header>
        <div className="modal-body">{children}</div>
      </section>
    </div>
  );
}

export interface Explanation {
  title: string;
  formula: string;
  inputs: Array<{ label: string; value: string; kind: DataKind; date?: string; source?: string }>;
  note?: string;
}

export function ExplanationPanel({ explanation }: { explanation: Explanation }) {
  return (
    <div className="explanation">
      <div className="formula-box">
        <span>Formule</span>
        <code>{explanation.formula}</code>
      </div>
      <h3>Inputs utilisés</h3>
      <div className="explain-inputs">
        {explanation.inputs.map((input) => (
          <div key={input.label}>
            <div>
              <strong>{input.label}</strong>
              <small>
                {input.date ? `Au ${input.date}` : ""}
                {input.source ? ` · ${input.source}` : ""}
              </small>
            </div>
            <div className="explain-value">
              <span>{input.value}</span>
              <DataBadge kind={input.kind} />
            </div>
          </div>
        ))}
      </div>
      {explanation.note ? <Callout title="Lecture">{explanation.note}</Callout> : null}
    </div>
  );
}

export function EmptyState({
  title,
  detail,
  action,
}: {
  title: string;
  detail: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-visual">
        <span />
        <span />
        <span />
      </div>
      <h3>{title}</h3>
      <p>{detail}</p>
      {action}
    </div>
  );
}

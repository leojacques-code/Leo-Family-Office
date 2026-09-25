"use client";

import { formatCurrency } from "@/lib/presentation/currency";
import { useEffect, useRef } from "react";
import { AlertTriangle, Check, CircleHelp, Info, X } from "lucide-react";
import type { DataKind } from "@/lib/types";
import { DATA_KIND_LABELS } from "@/lib/presentation/language";

const percent = new Intl.NumberFormat("fr-FR", {
  style: "percent",
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

export function Currency({
  value,
  compact = false,
  sign = false,
  currency = "EUR",
}: {
  value: number | null;
  compact?: boolean;
  sign?: boolean;
  /** Défaut historique pour les écrans non migrés. Une devise native absente passe null. */
  currency?: string | null;
}) {
  if (value === null) return <span className="warning-text">Non calculable</span>;
  const formatted = formatCurrency(Math.abs(value), currency, compact);
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

/**
 * Nature d'une donnée.
 *
 * Les six libellés étaient écrits en ANGLAIS ici même : « Actual », « User assumption »,
 * « Model assumption », « External », « Derived », « Missing ». Ce sont les codes internes à
 * peine déguisés, dans une interface dont le plan de refonte exige qu'elle soit entièrement
 * française. Ils viennent maintenant du registre de langage, unique source de ces mots.
 *
 * Le `title` porte la définition, parce qu'un badge de deux mots ne transmet pas à lui seul
 * que ACTUAL ≠ USER_ASSUMPTION ≠ MODEL_ASSUMPTION.
 */
export function DataBadge({ kind }: { kind: DataKind }) {
  const entry = DATA_KIND_LABELS[kind];
  return (
    <span className={`data-badge ${kind.toLowerCase()}`} title={entry.definition}>
      {entry.label}
    </span>
  );
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
  const dialog = useRef<HTMLElement>(null);
  // `onClose` est souvent recréée à chaque rendu : l'effet ne doit dépendre que de `open`,
  // sans quoi chaque frappe dans le formulaire renverrait le focus au premier champ.
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);
  // Dialogue modal accessible : le focus y entre à l'ouverture, Tab n'en sort pas, et il
  // revient à l'élément d'origine à la fermeture. Sans cela, un utilisateur au clavier ou au
  // lecteur d'écran reste derrière un formulaire qu'il ne sait pas ouvert.
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusables = () =>
      Array.from(
        dialog.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      ).filter((node) => {
        // Invisible : dans un bloc masqué, ou dans un <details> fermé (hors de son résumé).
        if (node.closest("[hidden]")) return false;
        const details = node.closest("details");
        return !details || details.open || node.closest("summary") !== null;
      });
    const first = focusables().find((node) => node.getAttribute("aria-label") !== "Fermer");
    (first ?? dialog.current)?.focus();
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeRef.current();
        return;
      }
      if (event.key !== "Tab" || !dialog.current) return;
      const items = focusables();
      if (items.length === 0) {
        event.preventDefault();
        return;
      }
      const head = items[0]!;
      const tail = items[items.length - 1]!;
      const active = document.activeElement;
      if (event.shiftKey && (active === head || !dialog.current.contains(active))) {
        event.preventDefault();
        tail.focus();
      } else if (!event.shiftKey && (active === tail || !dialog.current.contains(active))) {
        event.preventDefault();
        head.focus();
      }
    };
    window.addEventListener("keydown", handler);
    return () => {
      window.removeEventListener("keydown", handler);
      if (previous && previous.isConnected) previous.focus();
    };
  }, [open]);
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
        ref={dialog}
        tabIndex={-1}
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

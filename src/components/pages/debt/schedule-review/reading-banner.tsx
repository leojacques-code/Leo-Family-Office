"use client";

import { MetricHelp } from "@/components/primitives/metric-help";
import { formatDate } from "@/components/pages/shared";
import type { ScheduleCheckView, ScheduleRunSummary } from "@/lib/data/schedule-document-contracts";
import { formatCurrency } from "@/lib/presentation/currency";
import type { ScheduleSynthesis } from "@/lib/presentation/debt/schedule-review";
import { RUN_STATUS_LABELS } from "./client";

const CURRENCY_SOURCES: Record<NonNullable<ScheduleRunSummary["currencySource"]>, string> = {
  COLUMN: "lue dans une colonne",
  HEADER: "lue dans un en-tête",
  CELL: "lue dans une cellule",
  DECLARED: "déclarée au dépôt",
};

export function PartialHelp() {
  return (
    <MetricHelp term="extrait partiel">
      Un échéancier n’est dit complet que si son premier solde égale le capital déclaré du contrat
      et si son dernier solde est nul. Sinon c’est un extrait : ses sommes ne portent que sur les
      lignes lues et ne disent pas le coût du prêt.
    </MetricHelp>
  );
}

export function NotComputableHelp() {
  return (
    <MetricHelp term="contrôle non calculable">
      Un contrôle dont une valeur manque (colonne absente, cellule vide ou illisible) n’est ni
      réussi ni échoué : il n’a pas pu être vérifié. Il n’empêche pas la validation, mais il reste
      visible.
    </MetricHelp>
  );
}

/** Bandeau compact de la lecture : d'où elle vient et dans quel état elle est. */
export function ReadingBanner({
  run,
  synthesis,
}: {
  run: ScheduleRunSummary;
  synthesis: ScheduleSynthesis;
}) {
  return (
    <dl className="schedule-banner" aria-label="Lecture">
      <div>
        <dt>Fichier</dt>
        <dd>
          {run.fileName ?? "sans nom"} · {run.sourceFormat}
          {run.sheetName ? ` · feuille « ${run.sheetName} »` : ""}
        </dd>
      </div>
      <div>
        <dt>État</dt>
        <dd>{RUN_STATUS_LABELS[run.status]}</dd>
      </div>
      <div>
        <dt>Période</dt>
        <dd>
          {run.firstDueDate && run.lastDueDate
            ? `${formatDate(run.firstDueDate)} → ${formatDate(run.lastDueDate)}`
            : "non lue"}
          {" · "}
          {synthesis.lineCount} échéance{synthesis.lineCount > 1 ? "s" : ""}
        </dd>
      </div>
      <div>
        <dt>
          Complétude <PartialHelp />
        </dt>
        <dd className={synthesis.partial ? "warning-text" : undefined}>
          {synthesis.partial ? "Extrait partiel" : "Échéancier complet"}
        </dd>
      </div>
      <div>
        <dt>Devise</dt>
        <dd className={run.currency ? undefined : "warning-text"}>
          {run.currency
            ? `${run.currency}${run.currencySource ? `, ${CURRENCY_SOURCES[run.currencySource]}` : ""}`
            : "non déclarée"}
        </dd>
      </div>
      <div>
        <dt>
          Contrôles <NotComputableHelp />
        </dt>
        <dd className={synthesis.failedChecks > 0 ? "warning-text" : undefined}>
          {synthesis.failedChecks} en échec · {synthesis.notComputableChecks} non calculable
          {synthesis.notComputableChecks > 1 ? "s" : ""}
        </dd>
      </div>
      <div>
        <dt>Version de lecture</dt>
        <dd>{run.extractorVersion}</dd>
      </div>
    </dl>
  );
}

/**
 * Conflits visibles avant toute décision : contrôles en échec, cases illisibles, extrait
 * partiel, dates déjà présentes sur la dette. Chacun renvoie à la case concernée.
 */
export function ConflictList({
  run,
  synthesis,
  failedChecks,
  overlapping,
  onShowCheck,
}: {
  run: ScheduleRunSummary;
  synthesis: ScheduleSynthesis;
  failedChecks: ScheduleCheckView[];
  overlapping: string[];
  onShowCheck: (check: ScheduleCheckView) => void;
}) {
  const runWarnings = run.issues.filter((issue) => issue.severity !== "INFO");
  const items: React.ReactNode[] = [];
  if (run.supersedesRunId) {
    items.push(
      <li key="supersedes">
        Ce dépôt remplace une lecture précédente du même fichier, non validée.
      </li>,
    );
  }
  if (synthesis.blockedFieldCount > 0) {
    items.push(
      <li key="blocked">
        {synthesis.blockedFieldCount} case{synthesis.blockedFieldCount > 1 ? "s" : ""} illisible
        {synthesis.blockedFieldCount > 1 ? "s" : ""} : à corriger ou écarter avant de valider.
      </li>,
    );
  }
  if (synthesis.partial) {
    items.push(
      <li key="partial">
        Extrait partiel : {run.completenessReasons.join(" ") || "complétude non prouvée."}
      </li>,
    );
  }
  if (overlapping.length > 0) {
    items.push(
      <li key="overlap">
        {overlapping.length} date{overlapping.length > 1 ? "s" : ""} déjà présente
        {overlapping.length > 1 ? "s" : ""} dans l’échéancier enregistré de la dette (première :{" "}
        {formatDate(overlapping[0]!)}). Le remplacement se décidera au rattachement.
      </li>,
    );
  }
  for (const check of failedChecks) {
    items.push(
      <li key={check.checkCode}>
        {check.severity === "BLOCKING" ? "Bloquant · " : ""}
        {check.label ?? check.checkCode}
        {check.difference !== null
          ? ` : écart de ${formatCurrency(Math.abs(check.difference), run.currency)}`
          : ""}
        {check.left.length + check.right.length > 0 ? (
          <>
            {" "}
            <button className="link-button" onClick={() => onShowCheck(check)} type="button">
              Voir la case
            </button>
          </>
        ) : null}
      </li>,
    );
  }
  for (const issue of runWarnings) {
    items.push(<li key={`${issue.code}-${issue.message}`}>{issue.message}</li>);
  }
  if (items.length === 0) return null;
  return (
    <section className="schedule-conflicts" aria-label="Points à examiner">
      <h3>Points à examiner ({items.length})</h3>
      <ul>{items}</ul>
    </section>
  );
}

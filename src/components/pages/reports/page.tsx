"use client";

import Link from "next/link";
import { ChevronDown, Download, Printer } from "lucide-react";
import { useMemo, useState } from "react";
import { SectionHeader } from "@/components/ui";
import type { SectionProps } from "@/components/pages/shared";
import { formatDate, formatNative } from "@/components/pages/shared";
import { buildInstitutionalReport } from "@/lib/reporting/report-builder";
import type { ReportType } from "@/lib/reporting/report-types";

const TYPES: Array<{ type: ReportType; title: string; description: string }> = [
  {
    type: "CURRENT_SNAPSHOT",
    title: "Rapport patrimonial actuel",
    description: "Vue canonique actuelle, qualité et provenance.",
  },
  {
    type: "MONTHLY_REVIEW",
    title: "Revue mensuelle",
    description: "Deux dernières clôtures fiables, sans annualisation.",
  },
  {
    type: "ANNUAL_REVIEW",
    title: "Revue annuelle",
    description: "Historique strictement disponible pour l’année.",
  },
  {
    type: "INVESTMENT_COMMITTEE_MEMO",
    title: "Investment Committee Memo",
    description: "Document de décision, jamais une recommandation fabriquée.",
  },
];

export default function ReportsPage({ state }: SectionProps) {
  const [type, setType] = useState<ReportType>("CURRENT_SNAPSHOT");
  const [year, setYear] = useState(Number(state.asOfDate.slice(0, 4)));
  const [decisionCaseId, setDecisionCaseId] = useState(state.decisionCases?.[0]?.id ?? "");
  const report = useMemo(
    () => buildInstitutionalReport(state, { type, year, decisionCaseId: decisionCaseId || null }),
    [state, type, year, decisionCaseId],
  );
  const query = new URLSearchParams({
    type,
    expectedFingerprint: report.manifest.financialFingerprint,
  });
  if (type === "ANNUAL_REVIEW") query.set("year", String(year));
  if (type === "INVESTMENT_COMMITTEE_MEMO" && decisionCaseId)
    query.set("decisionCaseId", decisionCaseId);
  return (
    <div className="page-stack">
      <SectionHeader
        eyebrow={`${formatDate(state.asOfDate)} · ${state.reportingCurrency}`}
        title="Reports"
        description="Rapports institutionnels déterministes. La couche organise les vérités canoniques sans les recalculer."
      />
      <section className="metrics-grid four" aria-label="Types de rapports">
        {TYPES.map((item) => (
          <button
            type="button"
            key={item.type}
            className={`metric-card report-type-card ${type === item.type ? "selected" : ""}`}
            onClick={() => setType(item.type)}
            aria-pressed={type === item.type}
          >
            <span>{item.title}</span>
            <small>{item.description}</small>
          </button>
        ))}
      </section>
      {type === "ANNUAL_REVIEW" || type === "INVESTMENT_COMMITTEE_MEMO" ? (
        <section className="panel quick-actions">
          {type === "ANNUAL_REVIEW" ? (
            <label>
              Année{" "}
              <input
                type="number"
                min="2000"
                max="2100"
                value={year}
                onChange={(event) => setYear(Number(event.target.value))}
              />
            </label>
          ) : (
            <label>
              Decision Case{" "}
              <select
                value={decisionCaseId}
                onChange={(event) => setDecisionCaseId(event.target.value)}
              >
                <option value="">Memo de surveillance incomplet</option>
                {(state.decisionCases ?? []).map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </section>
      ) : null}
      <div className="uncertainty-strip">
        <span
          className={`data-badge ${report.manifest.nonComputableSections.length ? "model_assumption" : "observed"}`}
        >
          {report.manifest.nonComputableSections.length ? "PARTIEL" : "CALCULABLE"}
        </span>
        <span className="completeness">
          <strong>{report.manifest.blockers.length}</strong> blocker(s) ·{" "}
          {report.manifest.financialFingerprint}
        </span>
        <span className="data-badge observed">LECTURE SEULE</span>
      </div>
      <div className="quick-actions">
        <button className="button secondary" type="button" onClick={() => window.print()}>
          <Printer size={15} />
          Imprimer
        </button>
        <a className="button primary" href={`/api/reports/pdf?${query.toString()}`}>
          <Download size={15} />
          Télécharger le PDF
        </a>
      </div>
      <section className="panel">
        <div className="panel-header">
          <div>
            <span className="eyebrow">Aperçu</span>
            <h2>{report.title}</h2>
          </div>
          <strong>
            {report.manifest.period.from} — {report.manifest.period.to}
          </strong>
        </div>
        {report.manifest.blockers.length ? (
          <div className="callout">
            <strong>Limites explicites</strong>
            <p>{report.manifest.blockers.join(" · ")}</p>
          </div>
        ) : null}
      </section>
      {report.sections.map((section) => (
        <details
          className="panel"
          key={section.id}
          open={
            section.id === "executive" ||
            section.id === "historical-summary" ||
            section.id === "decision-question"
          }
        >
          <summary>
            <ChevronDown size={15} />
            <strong>{section.title}</strong>
            <span
              className={`data-badge ${section.status === "COMPUTABLE" ? "observed" : "model_assumption"}`}
            >
              {section.status}
            </span>
          </summary>
          <p>{section.summary}</p>
          {section.amounts.map((item) => (
            <div className="callout" key={item.label}>
              <strong>{item.label}</strong>
              <p>
                {item.value === null ? "Non calculable" : formatNative(item.value, item.currency)} ·{" "}
                {item.date} · {item.nature} · {item.source}
              </p>
            </div>
          ))}
          {section.items.length ? (
            <ul>
              {section.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          ) : null}
          {section.ownerHref ? (
            <Link className="button secondary" href={section.ownerHref}>
              Ouvrir le domaine propriétaire
            </Link>
          ) : null}
        </details>
      ))}
      <details className="panel">
        <summary>
          <ChevronDown size={15} />
          <strong>Méthodologie et preuves</strong>
        </summary>
        <p>Opening: {report.manifest.openingFingerprint}</p>
        <p>Events: {report.manifest.eventSetVersion}</p>
        <p>Fingerprint financier: {report.manifest.financialFingerprint}</p>
        <p>
          La date technique de génération du PDF est séparée et n’entre pas dans ce fingerprint.
        </p>
      </details>
    </div>
  );
}

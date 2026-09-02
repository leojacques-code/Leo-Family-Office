"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { BrainCircuit, ChevronDown } from "lucide-react";
import { Callout, SectionHeader } from "@/components/ui";
import { formatDate, formatNative } from "@/components/pages/shared";
import type { SectionProps } from "@/components/pages/shared";
import { answerAdvisorIntent, buildAdvisorPacket } from "@/lib/advisor/advisor-core";
import type { AdvisorIntent } from "@/lib/advisor/advisor-types";

const QUESTIONS: Array<{ intent: AdvisorIntent; label: string }> = [
  { intent: "NOW", label: "Que dois-je regarder maintenant ?" },
  { intent: "CHANGED", label: "Qu’est-ce qui a changé ?" },
  { intent: "GOALS", label: "Quels Goals sont à risque ?" },
  { intent: "DECISIONS", label: "Quelles décisions dois-je revoir ?" },
  { intent: "WHY_NOT_COMPUTABLE", label: "Pourquoi ce résultat est-il non calculable ?" },
];

export default function AdvisorPage({ state }: SectionProps) {
  const packet = useMemo(() => buildAdvisorPacket({ state }), [state]);
  const [intent, setIntent] = useState<AdvisorIntent>("NOW");
  const answer = answerAdvisorIntent(packet, intent);
  return (
    <div className="page-stack">
      <SectionHeader
        eyebrow={`${formatDate(packet.observedAt)} · aide à la décision en lecture seule`}
        title="Beyonder"
        description="Priorités déterministes fondées exclusivement sur le contexte financier canonique — aucune décision ni exécution autonome."
      />
      <div className="uncertainty-strip">
        <span className="data-badge observed">CORE DÉTERMINISTE</span>
        <span className="completeness">
          <strong>{packet.completeness}</strong> · fingerprint{" "}
          {packet.contextFingerprint.slice(0, 24)}
        </span>
        <span className="data-badge model_assumption">IA · {packet.providerStatus}</span>
      </div>
      <section className="metrics-grid four" aria-label="Synthèse Beyonder">
        <article className="metric-card">
          <span>Priorité principale</span>
          <strong>{packet.insights[0]?.title ?? "Aucune"}</strong>
          <small>Règle {packet.insights[0]?.priority ?? "—"}</small>
        </article>
        <article className="metric-card">
          <span>Actionnables</span>
          <strong>{packet.counts.actionable}</strong>
          <small>CTA vers le domaine propriétaire</small>
        </article>
        <article className="metric-card">
          <span>Bloqués</span>
          <strong>{packet.counts.blocked}</strong>
          <small>Aucune réconciliation silencieuse</small>
        </article>
        <article className="metric-card">
          <span>Non calculables</span>
          <strong>{packet.counts.notComputable}</strong>
          <small>Inconnu ≠ zéro</small>
        </article>
      </section>
      <section className="panel">
        <div className="panel-header">
          <div>
            <span className="eyebrow">Questions guidées</span>
            <h2>{answer.title}</h2>
          </div>
        </div>
        <div className="quick-actions">
          {QUESTIONS.map((question) => (
            <button
              key={question.intent}
              className={`button ${intent === question.intent ? "primary" : "secondary"}`}
              onClick={() => setIntent(question.intent)}
            >
              {question.label}
            </button>
          ))}
        </div>
        <p>{answer.message}</p>
      </section>
      <section>
        <div className="panel-header">
          <div>
            <span className="eyebrow">Priorités</span>
            <h2>Conclusions et preuves</h2>
          </div>
        </div>
        <div className="page-stack">
          {packet.insights
            .filter((item) => intent === "NOW" || answer.insightIds.includes(item.id))
            .map((item) => (
              <article className="panel" key={item.id}>
                <div className="panel-header">
                  <div>
                    <span className="eyebrow">
                      Priorité {item.priority} · {item.status} · {item.domain}
                    </span>
                    <h2>{item.title}</h2>
                  </div>
                  {item.amount !== null && item.currency ? (
                    <strong>{formatNative(item.amount, item.currency)}</strong>
                  ) : null}
                </div>
                <p>{item.summary}</p>
                <p>
                  <strong>Pourquoi :</strong> {item.priorityReason}
                </p>
                {item.blockers.length ? (
                  <Callout tone="warning" title="Blockers">
                    {item.blockers.join(" · ")}
                  </Callout>
                ) : null}
                <details>
                  <summary>
                    <ChevronDown size={15} /> Preuves ({item.evidence.length})
                  </summary>
                  <div className="page-stack">
                    {item.evidence.map((proof) => (
                      <div className="callout" key={proof.id}>
                        <strong>{proof.nature}</strong>
                        <p>
                          {formatDate(proof.date)} · {proof.provenance} · {proof.calculability}
                          {proof.amount !== null && proof.currency
                            ? ` · ${formatNative(proof.amount, proof.currency)}`
                            : ""}
                        </p>
                        <Link href={proof.href}>Ouvrir la source</Link>
                      </div>
                    ))}
                  </div>
                </details>
                <Link className="button secondary" href={item.cta.href}>
                  <BrainCircuit size={15} />
                  {item.cta.label}
                </Link>
              </article>
            ))}
        </div>
      </section>
      <Callout title="Explication générative indisponible">
        Le provider réel n’est pas configuré. Le Core déterministe, les questions guidées, les
        preuves et les liens restent pleinement utilisables.
      </Callout>
    </div>
  );
}

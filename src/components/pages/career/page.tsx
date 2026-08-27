"use client";

import { BriefcaseBusiness, CalendarClock, CircleDollarSign, Gem } from "lucide-react";
import { Callout, EmptyState, MetricCard, SectionHeader } from "@/components/ui";
import { OptionalCurrency, formatDate, type SectionProps } from "@/components/pages/shared";

function CareerPage({ state }: SectionProps) {
  const roles = state.careerRoles ?? [];
  const terms = state.careerCompensationTerms ?? [];
  const events = state.careerEvents ?? [];
  const equity = state.careerEquityGrants ?? [];
  const scenarios = state.careerScenarios ?? [];
  const analytics = state.careerAnalytics;
  const tax = state.taxCalculation;
  const currentRole = roles.find((role) => role.status === "ACTIVE") ?? null;
  const currentTerm = currentRole
    ? terms
        .filter(
          (term) =>
            term.roleId === currentRole.id &&
            term.effectiveFrom <= state.asOfDate &&
            (term.effectiveTo === null || term.effectiveTo >= state.asOfDate),
        )
        .sort((left, right) => right.effectiveFrom.localeCompare(left.effectiveFrom))[0]
    : null;
  const nextEvent = events
    .filter((event) => event.eventDate > state.asOfDate)
    .sort((left, right) => left.eventDate.localeCompare(right.eventDate))[0];

  return (
    <div className="page-stack">
      <SectionHeader
        eyebrow="Career engine"
        title="Career"
        description="Rôles, rémunérations et événements datés. Le brut vient de Career ; le net vient de Tax."
      />
      {roles.length === 0 ? (
        <EmptyState
          title="Aucun fait de carrière canonique"
          detail="Les anciens revenus nets restent visibles dans Cash Flow, mais aucun brut, employeur ou impôt n’en est déduit. Enregistrez un rôle et un terme daté pour activer le moteur."
        />
      ) : (
        <>
          <section className="metrics-grid four">
            <MetricCard
              label="Rôle actuel"
              value={currentRole?.jobTitle ?? currentRole?.employmentType ?? "Non déclaré"}
              detail={currentRole?.employer ?? "Organisation non déclarée"}
            />
            <MetricCard
              label="Fixe annualisé"
              value={<OptionalCurrency value={analytics?.annualisedFixedCompensation ?? null} />}
              detail={
                currentTerm ? `Terme du ${formatDate(currentTerm.effectiveFrom)}` : "Terme manquant"
              }
              tone={analytics?.annualisedFixedCompensation === null ? "warning" : undefined}
            />
            <MetricCard
              label="Total cible annualisé"
              value={<OptionalCurrency value={analytics?.annualisedTargetCompensation ?? null} />}
              detail="Target n’est ni gagné ni payé"
              tone={analytics?.annualisedTargetCompensation === null ? "warning" : undefined}
            />
            <MetricCard
              label="Net annuel disponible"
              value={<OptionalCurrency value={tax?.netCashIncome ?? null} />}
              detail={tax?.status ?? "TAX_RULES_MISSING"}
              tone={tax?.netCashIncome === null ? "warning" : undefined}
            />
          </section>

          {tax?.blockers.length ? (
            <Callout tone="warning" title="Net non calculable honnêtement">
              {tax.blockers.join(" · ")}. Le brut reste visible ; aucune règle fiscale ou donnée
              manquante n’est remplacée par un taux implicite.
            </Callout>
          ) : null}

          <section className="two-column">
            <article className="panel">
              <div className="panel-header">
                <div>
                  <span className="eyebrow">History</span>
                  <h2>Career timeline</h2>
                </div>
                <BriefcaseBusiness size={18} />
              </div>
              <div className="governance-list">
                {[...roles]
                  .sort((a, b) => a.startDate.localeCompare(b.startDate))
                  .map((role) => (
                    <div key={role.id}>
                      <span>
                        {formatDate(role.startDate)}
                        {role.endDate ? ` → ${formatDate(role.endDate)}` : " → aujourd’hui"}
                      </span>
                      <strong>
                        {role.employer ?? "Organisation non déclarée"} ·{" "}
                        {role.jobTitle ?? role.employmentType}
                      </strong>
                      <small className="status-outline">{role.dataKind}</small>
                    </div>
                  ))}
              </div>
            </article>

            <article className="panel">
              <div className="panel-header">
                <div>
                  <span className="eyebrow">Compensation</span>
                  <h2>Pont brut → net cash</h2>
                </div>
                <CircleDollarSign size={18} />
              </div>
              <div className="governance-list">
                <div>
                  <span>Rémunération brute</span>
                  <strong>
                    <OptionalCurrency value={tax?.grossIncome ?? null} />
                  </strong>
                </div>
                <div>
                  <span>Cotisations salariales</span>
                  <strong>
                    <OptionalCurrency value={tax?.payrollContributions ?? null} />
                  </strong>
                </div>
                <div>
                  <span>Revenu imposable</span>
                  <strong>
                    <OptionalCurrency value={tax?.taxableIncome ?? null} />
                  </strong>
                </div>
                <div>
                  <span>Liability fiscale</span>
                  <strong>
                    <OptionalCurrency value={tax?.taxLiability ?? null} />
                  </strong>
                </div>
                <div>
                  <span>Impôt cash retenu / payé</span>
                  <strong>
                    <OptionalCurrency value={tax?.taxCashNet ?? null} />
                  </strong>
                </div>
                <div>
                  <span>Net cash</span>
                  <strong>
                    <OptionalCurrency value={tax?.netCashIncome ?? null} />
                  </strong>
                </div>
              </div>
            </article>
          </section>

          <section className="two-column">
            <article className="panel">
              <div className="panel-header">
                <div>
                  <span className="eyebrow">Events</span>
                  <h2>Prochain événement connu</h2>
                </div>
                <CalendarClock size={18} />
              </div>
              {nextEvent ? (
                <div className="assumption-row">
                  <div>
                    <strong>{nextEvent.label ?? nextEvent.type}</strong>
                    <span>{formatDate(nextEvent.eventDate)}</span>
                  </div>
                  <span className="status-outline">{nextEvent.dataKind}</span>
                </div>
              ) : (
                <p className="muted-copy">
                  Aucun événement futur déclaré. Le moteur n’invente ni promotion ni hausse
                  salariale.
                </p>
              )}
            </article>
            <article className="panel">
              <div className="panel-header">
                <div>
                  <span className="eyebrow">Equity</span>
                  <h2>Instruments déclarés</h2>
                </div>
                <Gem size={18} />
              </div>
              {equity.length ? (
                equity.map((grant) => (
                  <div className="assumption-row" key={grant.id}>
                    <div>
                      <strong>
                        {grant.company} · {grant.instrumentType}
                      </strong>
                      <span>Attribué le {formatDate(grant.grantDate)}</span>
                    </div>
                    <span className="status-outline">{grant.liquidityStatus}</span>
                  </div>
                ))
              ) : (
                <p className="muted-copy">
                  Aucun instrument déclaré. Aucune valeur ni fiscalité d’equity n’est inventée.
                </p>
              )}
            </article>
          </section>

          <section className="panel">
            <div className="panel-header">
              <div>
                <span className="eyebrow">Offers / Scenarios</span>
                <h2>Trajectoires datées</h2>
              </div>
            </div>
            {scenarios.length ? (
              scenarios.map((scenario) => (
                <div className="assumption-row" key={scenario.id}>
                  <div>
                    <strong>{scenario.name}</strong>
                    <span>
                      {scenario.type} à partir du {formatDate(scenario.effectiveFrom)}
                    </span>
                  </div>
                  <span className="status-outline">{scenario.dataKind}</span>
                </div>
              ))
            ) : (
              <p className="muted-copy">
                Aucun scénario Career. Les scénarios patrimoniaux globaux ne sont pas réinterprétés
                comme trajectoires professionnelles.
              </p>
            )}
          </section>
        </>
      )}
    </div>
  );
}

export default CareerPage;

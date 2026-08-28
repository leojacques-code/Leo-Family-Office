"use client";

import { Landmark, ReceiptText, ShieldCheck } from "lucide-react";
import { Callout, EmptyState, MetricCard, SectionHeader } from "@/components/ui";
import { OptionalCurrency, formatDate, type SectionProps } from "@/components/pages/shared";

function TaxPage({ state }: SectionProps) {
  const calculation = state.taxCalculation;
  const profiles = state.taxProfiles ?? [];
  const ruleSets = state.taxRuleSets ?? [];
  const observations = state.taxObservations ?? [];
  const profile = profiles
    .filter(
      (item) =>
        item.effectiveFrom <= state.asOfDate &&
        (item.effectiveTo === null || item.effectiveTo >= state.asOfDate),
    )
    .sort((left, right) => right.effectiveFrom.localeCompare(left.effectiveFrom))[0];
  const ruleSet = ruleSets.find((item) => item.taxYear === calculation?.taxYear);

  return (
    <div className="page-stack">
      <SectionHeader
        eyebrow="Tax engine"
        title="Tax"
        description="Liability économique, retenues et paiements sont séparés. Une estimation n’est jamais présentée comme un impôt certain."
      />
      <Callout tone="warning" title="Pas de règle française implicite">
        Aucune règle France 2026 vérifiée n’est embarquée. Sans rule set sourcé et daté, le moteur
        affiche TAX_RULES_MISSING et ne produit aucun faux net.
      </Callout>

      <section className="metrics-grid four">
        <MetricCard
          label="Juridiction"
          value={profile?.jurisdiction ?? "Non déclarée"}
          detail={profile ? `Depuis le ${formatDate(profile.effectiveFrom)}` : "Profil manquant"}
          tone={profile ? undefined : "warning"}
        />
        <MetricCard
          label="Année fiscale"
          value={String(calculation?.taxYear ?? state.asOfDate.slice(0, 4))}
          detail={ruleSet?.name ?? "Aucun rule set actif"}
          tone={ruleSet ? undefined : "warning"}
        />
        <MetricCard
          label="Liability fiscale"
          value={<OptionalCurrency value={calculation?.taxLiability ?? null} />}
          detail={calculation?.status ?? "NOT_COMPUTABLE"}
          tone={calculation?.taxLiability === null ? "warning" : undefined}
        />
        <MetricCard
          label="Impôt cash net"
          value={<OptionalCurrency value={calculation?.taxCashNet ?? null} />}
          detail="Retenues + paiements − remboursements"
          tone={calculation ? undefined : "warning"}
        />
      </section>

      {calculation?.blockers.length ? (
        <Callout tone="warning" title="Calcul bloqué">
          {calculation.blockers.join(" · ")}. Complétez uniquement les faits ou règles réellement
          connus ; une donnée absente ne vaut pas zéro.
        </Callout>
      ) : null}

      <section className="two-column">
        <article className="panel">
          <div className="panel-header">
            <div>
              <span className="eyebrow">Pourquoi ce net ?</span>
              <h2>Pont fiscal annuel</h2>
            </div>
            <ReceiptText size={18} />
          </div>
          {calculation ? (
            <div className="governance-list">
              <div>
                <span>Rémunération brute</span>
                <strong>
                  <OptionalCurrency value={calculation.grossIncome} />
                </strong>
              </div>
              <div>
                <span>Cotisations salariales</span>
                <strong>
                  <OptionalCurrency value={calculation.payrollContributions} />
                </strong>
              </div>
              <div>
                <span>Revenu imposable</span>
                <strong>
                  <OptionalCurrency value={calculation.taxableIncome} />
                </strong>
              </div>
              <div>
                <span>Impôt économiquement dû</span>
                <strong>
                  <OptionalCurrency value={calculation.taxLiability} />
                </strong>
              </div>
              <div>
                <span>Retenues à la source</span>
                <strong>
                  <OptionalCurrency value={calculation.taxWithheld} />
                </strong>
              </div>
              <div>
                <span>Paiements hors retenue</span>
                <strong>
                  <OptionalCurrency value={calculation.taxPaid} />
                </strong>
              </div>
              <div>
                <span>Remboursements</span>
                <strong>
                  <OptionalCurrency value={calculation.taxRefund} />
                </strong>
              </div>
              <div>
                <span>Solde restant dû</span>
                <strong>
                  <OptionalCurrency value={calculation.taxBalanceDue} />
                </strong>
              </div>
              <div>
                <span>Net cash disponible</span>
                <strong>
                  <OptionalCurrency value={calculation.netCashIncome} />
                </strong>
              </div>
            </div>
          ) : (
            <EmptyState
              title="Aucun calcul fiscal"
              detail="Le moteur attend un profil, des revenus Career et un rule set déclaré."
            />
          )}
        </article>

        <article className="panel">
          <div className="panel-header">
            <div>
              <span className="eyebrow">Profile & sources</span>
              <h2>Qualité de la règle</h2>
            </div>
            <ShieldCheck size={18} />
          </div>
          {ruleSet ? (
            <div className="governance-list">
              <div>
                <span>Statut</span>
                <strong>{ruleSet.status}</strong>
              </div>
              <div>
                <span>Source</span>
                <strong>{ruleSet.source}</strong>
              </div>
              <div>
                <span>Date de source</span>
                <strong>{formatDate(ruleSet.sourceDate)}</strong>
              </div>
              <div>
                <span>Confiance</span>
                <strong>{ruleSet.confidence}</strong>
              </div>
              <div>
                <span>Référence</span>
                <strong>{ruleSet.legalReference ?? "Non déclarée"}</strong>
              </div>
            </div>
          ) : (
            <p className="muted-copy">
              Aucun rule set actif. Le JSON legacy « MISSING » n’est pas transformé en barème.
            </p>
          )}
        </article>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <span className="eyebrow">Actuals</span>
            <h2>Observations fiscales</h2>
          </div>
          <Landmark size={18} />
        </div>
        {observations.length ? (
          observations.map((observation) => (
            <div className="assumption-row" key={observation.id}>
              <div>
                <strong>{observation.type}</strong>
                <span>
                  {formatDate(observation.observedDate)} ·{" "}
                  {observation.source ?? "Source non renseignée"}
                </span>
              </div>
              <OptionalCurrency value={observation.amount} />
              <span className="status-outline">
                {observation.transactionId ? "Rapproché transaction" : "Fait fiscal"}
              </span>
            </div>
          ))
        ) : (
          <p className="muted-copy">
            Aucune retenue, liability, paiement ou remboursement observé. Aucun flux bancaire n’est
            dupliqué.
          </p>
        )}
      </section>
    </div>
  );
}

export default TaxPage;

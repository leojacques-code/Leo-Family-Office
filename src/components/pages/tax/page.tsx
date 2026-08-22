"use client";

import { ReceiptText } from "lucide-react";
import { Callout, DataBadge, MetricCard, SectionHeader } from "@/components/ui";
import type { SectionProps } from "@/components/pages/shared";

function TaxPage({ state }: SectionProps) {
  return (
    <div className="page-stack">
      <SectionHeader
        eyebrow="Tax architecture"
        title="Tax"
        description="Couche fiscale datée et paramétrable. Aucune règle non vérifiée n’est appliquée comme vérité."
      />
      <Callout tone="warning" title="Pas de conseil fiscal">
        La V1 n’émet pas de conseil juridique ou fiscal. Les paramètres 2026 doivent être vérifiés à
        partir de sources officielles avant tout calcul décisionnel.
      </Callout>
      <section className="metrics-grid four">
        <MetricCard label="Résidence fiscale" value="France" detail="Profil individuel" />
        <MetricCard label="Foyer" value="Individuel" detail="Compagne exclue du patrimoine" />
        <MetricCard
          label="Règles actives vérifiées"
          value="0"
          tone="warning"
          detail="Architecture prête"
        />
        <MetricCard label="Année de référence" value="2026" detail="À sourcer" />
      </section>
      <section className="two-column">
        <article className="panel">
          <div className="panel-header">
            <div>
              <span className="eyebrow">Enveloppes</span>
              <h2>Traitements prévus</h2>
            </div>
          </div>
          <div className="feature-list">
            {[
              "Impôt sur le revenu français",
              "Prélèvements sociaux",
              "PEA",
              "CTO",
              "Assurance-vie",
              "Immobilier",
              "Dividendes & plus-values",
              "Business equity",
            ].map((item) => (
              <div key={item}>
                <ReceiptText size={15} />
                <span>{item}</span>
                <span className="status-outline">Paramétrable</span>
              </div>
            ))}
          </div>
        </article>
        <article className="panel">
          <div className="panel-header">
            <div>
              <span className="eyebrow">Gouvernance</span>
              <h2>Règle fiscale</h2>
            </div>
          </div>
          <div className="governance-list">
            <div>
              <span>Année applicable</span>
              <strong>Obligatoire</strong>
            </div>
            <div>
              <span>Source officielle</span>
              <strong>Obligatoire</strong>
            </div>
            <div>
              <span>Dernière vérification</span>
              <strong>Obligatoire</strong>
            </div>
            <div>
              <span>Modification utilisateur</span>
              <strong>Historisée</strong>
            </div>
            <div>
              <span>Confiance</span>
              <strong>Visible</strong>
            </div>
          </div>
        </article>
      </section>
      <section className="panel">
        <div className="panel-header">
          <div>
            <span className="eyebrow">Hypothèses fiscales</span>
            <h2>Registre</h2>
          </div>
        </div>
        {state.assumptions
          .filter((assumption) => assumption.id === "asm_tax")
          .map((assumption) => (
            <div className="assumption-row" key={assumption.id}>
              <div>
                <strong>{assumption.name}</strong>
                <span>{String(assumption.value)}</span>
              </div>
              <DataBadge kind={assumption.provenance.kind} />
              <span className="confidence low">Confiance faible</span>
            </div>
          ))}
      </section>
    </div>
  );
}

export default TaxPage;

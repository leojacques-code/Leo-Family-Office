"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Callout, Currency, DataBadge, MetricCard, Percent, SectionHeader } from "@/components/ui";
import type { SectionProps } from "@/components/pages/shared";

function BusinessPage({}: SectionProps) {
  const [revenue, setRevenue] = useState(500000);
  const [ebitda, setEbitda] = useState(80000);
  const [multiple, setMultiple] = useState(6);
  const [debt, setDebt] = useState(100000);
  const [cash, setCash] = useState(30000);
  const [ownership, setOwnership] = useState(100);
  const enterpriseValue = ebitda * multiple;
  const equityValue = enterpriseValue - debt + cash;
  const attributable = (equityValue * ownership) / 100;
  return (
    <div className="page-stack">
      <SectionHeader
        eyebrow="Private assets"
        title="Business Equity"
        description="Bac à sable de valorisation ; aucune participation entrepreneuriale n’est actuellement déclarée."
        actions={
          <button className="button secondary">
            <Plus size={15} />
            Ajouter une société <span className="soon">V1.1</span>
          </button>
        }
      />
      <Callout title="Aucun actif business actuel">
        Les calculs ci-dessous restent isolés du patrimoine tant qu’une participation réelle n’est
        pas enregistrée.
      </Callout>
      <section className="business-layout">
        <article className="panel input-panel">
          <div className="panel-header">
            <div>
              <span className="eyebrow">Multiple EBITDA</span>
              <h2>Valorisation sandbox</h2>
            </div>
            <DataBadge kind="USER_ASSUMPTION" />
          </div>
          <div className="mini-form-grid business-form">
            <label>
              Chiffre d’affaires
              <div className="suffix-input">
                <input
                  type="number"
                  value={revenue}
                  onChange={(event) => setRevenue(Number(event.target.value))}
                />
                <span>€</span>
              </div>
            </label>
            <label>
              EBITDA
              <div className="suffix-input">
                <input
                  type="number"
                  value={ebitda}
                  onChange={(event) => setEbitda(Number(event.target.value))}
                />
                <span>€</span>
              </div>
            </label>
            <label>
              Multiple
              <div className="suffix-input">
                <input
                  type="number"
                  step="0.1"
                  value={multiple}
                  onChange={(event) => setMultiple(Number(event.target.value))}
                />
                <span>×</span>
              </div>
            </label>
            <label>
              Dette nette brute
              <div className="suffix-input">
                <input
                  type="number"
                  value={debt}
                  onChange={(event) => setDebt(Number(event.target.value))}
                />
                <span>€</span>
              </div>
            </label>
            <label>
              Cash
              <div className="suffix-input">
                <input
                  type="number"
                  value={cash}
                  onChange={(event) => setCash(Number(event.target.value))}
                />
                <span>€</span>
              </div>
            </label>
            <label>
              Participation
              <div className="suffix-input">
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={ownership}
                  onChange={(event) => setOwnership(Number(event.target.value))}
                />
                <span>%</span>
              </div>
            </label>
          </div>
        </article>
        <div className="results-stack">
          <section className="metrics-grid two">
            <MetricCard label="Valeur d’entreprise" value={<Currency value={enterpriseValue} />} />
            <MetricCard label="Equity value" value={<Currency value={equityValue} />} />
            <MetricCard
              label="Valeur attribuable"
              value={<Currency value={attributable} />}
              tone="positive"
            />
            <MetricCard
              label="Marge EBITDA"
              value={<Percent value={revenue === 0 ? 0 : ebitda / revenue} />}
            />
          </section>
          <article className="panel org-chart">
            <div className="panel-header">
              <div>
                <span className="eyebrow">Organigramme patrimonial</span>
                <h2>Structure testée</h2>
              </div>
            </div>
            <div className="org-tree">
              <div className="org-person">
                Léo
                <br />
                <small>{ownership} %</small>
              </div>
              <span className="org-line" />
              <div className="org-company">
                Société cible
                <br />
                <small>
                  Valeur attribuable <Currency value={attributable} />
                </small>
              </div>
            </div>
          </article>
        </div>
      </section>
    </div>
  );
}

export default BusinessPage;

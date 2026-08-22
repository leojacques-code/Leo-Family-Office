"use client";

import { useState } from "react";
import { Check, Landmark, TrendingUp } from "lucide-react";
import { compareDebtVsInvest } from "@/lib/engine/decision";
import { Callout, Currency, DataBadge, SectionHeader } from "@/components/ui";
import type { SectionProps } from "@/components/pages/shared";

function DecisionLabPage({ state }: SectionProps) {
  const [cash, setCash] = useState(5000);
  const [returnRate, setReturnRate] = useState(5.5);
  const [volatility, setVolatility] = useState(15);
  const [years, setYears] = useState(5);
  const result = compareDebtVsInvest({
    availableCash: cash,
    debtBalance: state.metrics.debt,
    debtRate: 0,
    investmentReturn: returnRate / 100,
    volatility: volatility / 100,
    inflation: 0.02,
    years,
    liquidityWeight: 0.03,
  });
  const cases = [
    "Louer vs acheter",
    "RP vs locatif",
    "Paris vs autre zone",
    "Immobilier vs bourse",
    "Rembourser vs investir",
    "PEA vs CTO vs assurance-vie",
    "Apport faible vs élevé",
    "M&A vs PE",
    "Salariat vs entrepreneuriat",
    "Cash vs investir",
  ];
  return (
    <div className="page-stack">
      <SectionHeader
        eyebrow="Decision framework"
        title="Decision Lab"
        description="Comparer le rendement, mais aussi liquidité, risque, flexibilité et coût d’opportunité."
      />
      <section className="decision-case-strip">
        {cases.map((item) => (
          <button key={item} className={item === "Rembourser vs investir" ? "active" : ""}>
            {item}
            {item !== "Rembourser vs investir" ? <span>Préparé</span> : <Check size={13} />}
          </button>
        ))}
      </section>
      <section className="decision-workbench">
        <article className="panel input-panel">
          <div className="panel-header">
            <div>
              <span className="eyebrow">Cas actif</span>
              <h2>Rembourser vs investir</h2>
            </div>
          </div>
          <div className="decision-slider-list">
            <label>
              <span>
                Capital disponible
                <strong>
                  <Currency value={cash} />
                </strong>
              </span>
              <input
                type="range"
                min="500"
                max="16745"
                step="250"
                value={cash}
                onChange={(event) => setCash(Number(event.target.value))}
              />
            </label>
            <label>
              <span>
                Rendement espéré<strong>{returnRate.toFixed(1)} %</strong>
              </span>
              <input
                type="range"
                min="0"
                max="12"
                step="0.1"
                value={returnRate}
                onChange={(event) => setReturnRate(Number(event.target.value))}
              />
            </label>
            <label>
              <span>
                Volatilité<strong>{volatility} %</strong>
              </span>
              <input
                type="range"
                min="0"
                max="35"
                step="1"
                value={volatility}
                onChange={(event) => setVolatility(Number(event.target.value))}
              />
            </label>
            <label>
              <span>
                Horizon<strong>{years} ans</strong>
              </span>
              <input
                type="range"
                min="1"
                max="15"
                value={years}
                onChange={(event) => setYears(Number(event.target.value))}
              />
            </label>
          </div>
          <DataBadge kind="USER_ASSUMPTION" />
        </article>
        <div className="decision-results">
          <div className="option-card">
            <span className="option-icon">
              <Landmark size={20} />
            </span>
            <span className="eyebrow">Option A</span>
            <h2>Rembourser</h2>
            <strong className="option-value">
              <Currency value={result.repay.nominalBenefit} />
            </strong>
            <small>Valeur nominale équivalente</small>
            <dl>
              <div>
                <dt>Gain certain</dt>
                <dd>0 €</dd>
              </div>
              <div>
                <dt>Liquidité</dt>
                <dd>Très faible</dd>
              </div>
              <div>
                <dt>Risque</dt>
                <dd>Faible</dd>
              </div>
              <div>
                <dt>Flexibilité</dt>
                <dd>Faible</dd>
              </div>
            </dl>
          </div>
          <div className="option-card preferred">
            <span className="recommended">Espérance ajustée supérieure</span>
            <span className="option-icon">
              <TrendingUp size={20} />
            </span>
            <span className="eyebrow">Option B</span>
            <h2>Investir</h2>
            <strong className="option-value">
              <Currency value={result.invest.nominalBenefit} />
            </strong>
            <small>Valeur espérée non garantie</small>
            <dl>
              <div>
                <dt>Avantage ajusté</dt>
                <dd>
                  <Currency value={result.opportunityAdvantage} sign />
                </dd>
              </div>
              <div>
                <dt>Liquidité</dt>
                <dd>Modérée</dd>
              </div>
              <div>
                <dt>Risque</dt>
                <dd>{result.invest.risk}</dd>
              </div>
              <div>
                <dt>Flexibilité</dt>
                <dd>Élevée</dd>
              </div>
            </dl>
          </div>
        </div>
      </section>
      <Callout title="Conclusion multicritère">
        {result.conclusion} Avec seulement <Currency value={state.metrics.bankCash} /> de cash
        bancaire, la réserve de sécurité prévaut avant l’une ou l’autre option.
      </Callout>
    </div>
  );
}

export default DecisionLabPage;

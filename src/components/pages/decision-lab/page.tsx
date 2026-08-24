"use client";

import { useState } from "react";
import { Check, Landmark, TrendingUp } from "lucide-react";
import { compareDebtVsInvest } from "@/lib/engine/decision";
import { Callout, Currency, DataBadge, EmptyState, Percent, SectionHeader } from "@/components/ui";
import { type SectionProps, formatEur } from "@/components/pages/shared";

const CASES = [
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
const ACTIVE_CASE = "Rembourser vs investir";

function DecisionLabPage({ state }: SectionProps) {
  const [liabilityId, setLiabilityId] = useState(state.liabilities[0]?.id ?? "");
  const [scenarioId, setScenarioId] = useState(
    (state.scenarios.find((item) => item.name === "Central") ?? state.scenarios[0])?.id ?? "",
  );
  const [cash, setCash] = useState(Math.round(state.metrics.bankCash));
  const [returnRate, setReturnRate] = useState(5.5);
  const [volatility, setVolatility] = useState(15);
  const [years, setYears] = useState(5);
  const [showExperimental, setShowExperimental] = useState(false);

  const liability =
    state.liabilities.find((item) => item.id === liabilityId) ?? state.liabilities[0];
  const scenario = state.scenarios.find((item) => item.id === scenarioId) ?? state.scenarios[0];
  // Le capital arbitrable ne dépasse jamais la liquidité réellement disponible.
  const cashCeiling = Math.max(0, Math.round(state.metrics.bankCash));
  const boundedCash = Math.min(cash, cashCeiling);
  const result = liability
    ? compareDebtVsInvest({
        availableCash: boundedCash,
        debtBalance: liability.currentBalance,
        debtRate: liability.annualRate,
        investmentReturn: returnRate / 100,
        volatility: volatility / 100,
        inflation: scenario?.annualInflation ?? 0,
        years,
        liquidityWeight: 0.03,
      })
    : null;

  const header = (
    <SectionHeader
      eyebrow="Decision framework"
      title="Decision Lab"
      description="Comparer le rendement, mais aussi liquidité, risque, flexibilité et coût d’opportunité. Cet écran compare, il ne recommande pas."
    />
  );

  if (!liability || !result) {
    return (
      <div className="page-stack">
        {header}
        <EmptyState
          title="Aucune dette à arbitrer"
          detail="Le cas « rembourser vs investir » suppose au moins un passif enregistré avec son taux et son encours."
        />
      </div>
    );
  }

  return (
    <div className="page-stack">
      {header}
      <section className="decision-case-strip">
        {CASES.map((item) => (
          <button key={item} className={item === ACTIVE_CASE ? "active" : ""}>
            {item}
            {item !== ACTIVE_CASE ? <span>Préparé</span> : <Check size={13} />}
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
            {state.liabilities.length > 1 ? (
              <label>
                <span>Dette considérée</span>
                <select
                  className="text-input"
                  value={liability.id}
                  onChange={(event) => setLiabilityId(event.target.value)}
                >
                  {state.liabilities.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name} · {(item.annualRate * 100).toFixed(2)} %
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <label>
              <span>Scénario appliqué</span>
              <select
                className="text-input"
                value={scenario?.id ?? ""}
                onChange={(event) => setScenarioId(event.target.value)}
              >
                {state.scenarios.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} · inflation {(item.annualInflation * 100).toFixed(1)} %
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>
                Capital mobilisé
                <strong>
                  <Currency value={boundedCash} />
                </strong>
              </span>
              <input
                type="range"
                min="0"
                max={Math.max(cashCeiling, 1)}
                step="10"
                value={boundedCash}
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
          <p className="muted-copy">
            Rendement, volatilité et horizon sont des hypothèses utilisateur. Le taux de la dette (
            <Percent value={liability.annualRate} />) et l’inflation (
            <Percent value={scenario?.annualInflation ?? 0} /> du scénario{" "}
            {scenario?.name ?? "sélectionné"}) proviennent des données du dossier. Le curseur est
            borné par le cash bancaire réellement disponible ({formatEur(state.metrics.bankCash)}).
          </p>
        </article>
        <div className="decision-results">
          <div className="option-card">
            <span className="option-icon">
              <Landmark size={20} />
            </span>
            <span className="eyebrow">Option A</span>
            <h2>Rembourser</h2>
            <strong className="option-value">
              <Currency value={result.repay.interestAvoided} />
            </strong>
            <small>Intérêts évités sur {result.horizonYears} ans, montant certain</small>
            <dl>
              <div>
                <dt>Capital engagé</dt>
                <dd>
                  <Currency value={result.capital} />
                </dd>
              </div>
              <div>
                <dt>Dette restante</dt>
                <dd>
                  <Currency value={result.repay.remainingDebt} />
                </dd>
              </div>
              <div>
                <dt>Liquidité à l’horizon</dt>
                <dd>
                  <Currency value={result.repay.endingLiquidity} />
                </dd>
              </div>
              <div>
                <dt>Position nette nominale</dt>
                <dd>
                  <Currency value={result.repay.nominalPosition} sign />
                </dd>
              </div>
              <div>
                <dt>Position nette réelle</dt>
                <dd>
                  <Currency value={result.repay.realPosition} sign />
                </dd>
              </div>
            </dl>
          </div>
          <div className="option-card">
            <span className="option-icon">
              <TrendingUp size={20} />
            </span>
            <span className="eyebrow">Option B</span>
            <h2>Investir</h2>
            <strong className="option-value">
              <Currency value={result.invest.expectedGain} sign />
            </strong>
            <small>Gain espéré non garanti</small>
            <dl>
              <div>
                <dt>Valeur espérée</dt>
                <dd>
                  <Currency value={result.invest.expectedEndingValue} />
                </dd>
              </div>
              <div>
                <dt>Dette restante</dt>
                <dd>
                  <Currency value={result.invest.remainingDebt} />
                </dd>
              </div>
              <div>
                <dt>Liquidité à l’horizon</dt>
                <dd>
                  <Currency value={result.invest.endingLiquidity} />
                </dd>
              </div>
              <div>
                <dt>Position nette nominale</dt>
                <dd>
                  <Currency value={result.invest.nominalPosition} sign />
                </dd>
              </div>
              <div>
                <dt>Position nette réelle</dt>
                <dd>
                  <Currency value={result.invest.realPosition} sign />
                </dd>
              </div>
            </dl>
          </div>
        </div>
      </section>
      <section className="panel">
        <div className="panel-header">
          <div>
            <span className="eyebrow">Écart objectif</span>
            <h2>Ce que les deux options ne partagent pas</h2>
          </div>
          <button className="link-button" onClick={() => setShowExperimental(!showExperimental)}>
            {showExperimental ? "Masquer" : "Afficher"} les heuristiques expérimentales
          </button>
        </div>
        <dl className="loan-facts">
          <div>
            <dt>Gain espéré de l’investissement − intérêts évités</dt>
            <dd>
              <Currency value={result.nominalSpread} sign />
            </dd>
          </div>
          <div>
            <dt>Écart de liquidité à l’horizon</dt>
            <dd>
              <Currency value={result.invest.endingLiquidity - result.repay.endingLiquidity} sign />
            </dd>
          </div>
          <div>
            <dt>Écart d’encours de dette</dt>
            <dd>
              <Currency value={result.invest.remainingDebt - result.repay.remainingDebt} sign />
            </dd>
          </div>
        </dl>
        {showExperimental ? (
          <>
            <div className="uncertainty-strip">
              <DataBadge kind="MODEL_ASSUMPTION" />
              <span>MODEL_HEURISTIC / EXPERIMENTAL · coefficients non sourcés, non testés</span>
            </div>
            <dl className="loan-facts">
              <div>
                <dt>Décote de risque (capital × volatilité × √horizon × 0,25)</dt>
                <dd>
                  <Currency value={result.experimental.riskHaircut} />
                </dd>
              </div>
              <div>
                <dt>Valorisation de la liquidité (capital × 3 %)</dt>
                <dd>
                  <Currency value={result.experimental.liquidityValue} />
                </dd>
              </div>
              <div>
                <dt>Avantage ajusté expérimental</dt>
                <dd>
                  <Currency value={result.experimental.opportunityAdvantage} sign />
                </dd>
              </div>
            </dl>
          </>
        ) : null}
      </section>
      <Callout title="Ce que cet écran ne fait pas">
        Aucune option n’est désignée comme préférable : les coefficients qui produiraient cette
        conclusion ne sont ni sourcés ni testés. Avec <Currency value={state.metrics.bankCash} /> de
        cash bancaire et une couverture de{" "}
        {state.metrics.emergencyCoverageMonths.toLocaleString("fr-FR", {
          maximumFractionDigits: 1,
        })}{" "}
        mois de dépenses essentielles connues, la question de la réserve de sécurité précède celle
        de l’arbitrage.
      </Callout>
    </div>
  );
}

export default DecisionLabPage;

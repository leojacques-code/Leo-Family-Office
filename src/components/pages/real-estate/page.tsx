"use client";

import { useMemo, useState } from "react";
import { Save } from "lucide-react";
import { underwriteRealEstate, type RealEstateInputs } from "@/lib/engine/real-estate";
import { Callout, Currency, DataBadge, MetricCard, Percent, SectionHeader } from "@/components/ui";
import type { SectionProps } from "@/components/pages/shared";

const defaultProperty: RealEstateInputs = {
  purchasePrice: 220000,
  acquisitionCosts: 17600,
  renovation: 15000,
  furniture: 5000,
  downPayment: 30000,
  loanAmount: 227600,
  annualRate: 0.035,
  loanYears: 25,
  monthlyRent: 1100,
  vacancyRate: 0.05,
  annualOperatingCosts: 3200,
  annualPropertyGrowth: 0.015,
  rentGrowth: 0.015,
  holdingYears: 10,
  sellingCostsRate: 0.06,
  taxRate: 0.3,
};

function RealEstatePage({ setExplanation }: SectionProps) {
  const [inputs, setInputs] = useState(defaultProperty);
  const result = useMemo(() => underwriteRealEstate(inputs), [inputs]);
  function field(key: keyof RealEstateInputs, label: string, suffix: string, step = "1") {
    const display =
      key.toLowerCase().includes("rate") ||
      key === "vacancyRate" ||
      key === "annualPropertyGrowth" ||
      key === "rentGrowth" ||
      key === "taxRate"
        ? Number(inputs[key]) * 100
        : inputs[key];
    return (
      <label>
        {label}
        <div className="suffix-input">
          <input
            type="number"
            step={step}
            value={display}
            onChange={(event) => {
              const raw = Number(event.target.value);
              const value =
                key.toLowerCase().includes("rate") ||
                key === "vacancyRate" ||
                key === "annualPropertyGrowth" ||
                key === "rentGrowth" ||
                key === "taxRate"
                  ? raw / 100
                  : raw;
              setInputs({ ...inputs, [key]: value });
            }}
          />
          <span>{suffix}</span>
        </div>
      </label>
    );
  }
  return (
    <div className="page-stack">
      <SectionHeader
        eyebrow="Underwriting"
        title="Real Estate"
        description="Étude d’un actif locatif avec dette, vacance, fiscalité, sortie et métriques d’equity."
        actions={
          <button className="button secondary">
            <Save size={15} />
            Sauvegarder l’étude <span className="soon">V1.1</span>
          </button>
        }
      />
      <Callout title="Cas de travail non patrimonial">
        Cette étude n’ajoute rien au patrimoine actuel tant qu’un achat réel n’est pas enregistré.
        Toutes les valeurs ci-dessous sont des hypothèses modifiables.
      </Callout>
      <section className="underwriting-layout">
        <article className="panel input-panel">
          <div className="panel-header">
            <div>
              <span className="eyebrow">Hypothèses</span>
              <h2>Projet locatif</h2>
            </div>
            <DataBadge kind="USER_ASSUMPTION" />
          </div>
          <div className="input-sections">
            <h3>Acquisition</h3>
            <div className="mini-form-grid">
              {field("purchasePrice", "Prix d’achat", "€")}
              {field("acquisitionCosts", "Frais d’acquisition", "€")}
              {field("renovation", "Travaux", "€")}
              {field("furniture", "Mobilier", "€")}
            </div>
            <h3>Financement</h3>
            <div className="mini-form-grid">
              {field("downPayment", "Apport", "€")}
              {field("loanAmount", "Crédit", "€")}
              {field("annualRate", "Taux nominal", "%", "0.01")}
              {field("loanYears", "Durée", "ans")}
            </div>
            <h3>Exploitation & sortie</h3>
            <div className="mini-form-grid">
              {field("monthlyRent", "Loyer mensuel", "€")}
              {field("vacancyRate", "Vacance", "%", "0.1")}
              {field("annualOperatingCosts", "Charges annuelles", "€")}
              {field("taxRate", "Taux fiscal effectif", "%", "0.1")}
              {field("annualPropertyGrowth", "Croissance valeur", "%", "0.1")}
              {field("holdingYears", "Horizon", "ans")}
            </div>
          </div>
        </article>
        <div className="results-stack">
          <section className="metrics-grid two">
            <MetricCard
              label="TRI equity"
              value={result.irr === null ? "N/A" : <Percent value={result.irr} />}
              tone={result.irr !== null && result.irr > 0.06 ? "positive" : "neutral"}
              onExplain={() =>
                setExplanation({
                  title: "TRI immobilier",
                  formula: "Taux r tel que Σ CFₜ / (1+r)ᵗ = 0",
                  inputs: [
                    {
                      label: "Equity initiale",
                      value: new Intl.NumberFormat("fr-FR", {
                        style: "currency",
                        currency: "EUR",
                      }).format(-result.cashFlows[0]),
                      kind: "USER_ASSUMPTION",
                    },
                    {
                      label: "Cash flows annuels",
                      value: `${result.cashFlows.length - 1} années`,
                      kind: "DERIVED",
                    },
                    {
                      label: "Produit de cession net",
                      value: new Intl.NumberFormat("fr-FR", {
                        style: "currency",
                        currency: "EUR",
                      }).format(result.cashFlows.at(-1) ?? 0),
                      kind: "DERIVED",
                    },
                  ],
                  note: "Le TRI dépend fortement du prix de sortie, de la fiscalité simplifiée et de la vacance.",
                })
              }
            />
            <MetricCard
              label="VAN à 6 %"
              value={<Currency value={result.npv} />}
              tone={result.npv >= 0 ? "positive" : "negative"}
            />
            <MetricCard label="MOIC" value={`${result.moic.toFixed(2)}×`} />
            <MetricCard
              label="Cash flow annuel"
              value={<Currency value={result.annualCashFlow} sign />}
              tone={result.annualCashFlow >= 0 ? "positive" : "negative"}
            />
          </section>
          <article className="panel result-summary">
            <div className="panel-header">
              <div>
                <span className="eyebrow">Résultat</span>
                <h2>Économie du projet</h2>
              </div>
            </div>
            <dl>
              <div>
                <dt>Coût total projet</dt>
                <dd>
                  <Currency value={result.totalProjectCost} />
                </dd>
              </div>
              <div>
                <dt>Mensualité hors assurance</dt>
                <dd>
                  <Currency value={result.monthlyPayment} />
                </dd>
              </div>
              <div>
                <dt>Rendement brut</dt>
                <dd>
                  <Percent value={result.grossYield} />
                </dd>
              </div>
              <div>
                <dt>Rendement net d’exploitation</dt>
                <dd>
                  <Percent value={result.netYield} />
                </dd>
              </div>
              <div>
                <dt>Cash-on-cash initial</dt>
                <dd>
                  <Percent value={result.cashOnCash} />
                </dd>
              </div>
              <div>
                <dt>LTV</dt>
                <dd>
                  <Percent value={result.ltv} />
                </dd>
              </div>
              <div>
                <dt>DSCR</dt>
                <dd>
                  {Number.isFinite(result.dscr) ? `${result.dscr.toFixed(2)}×` : "Sans dette"}
                </dd>
              </div>
              <div>
                <dt>Intérêts totaux</dt>
                <dd>
                  <Currency value={result.totalInterest} />
                </dd>
              </div>
              <div>
                <dt>Valeur de sortie brute</dt>
                <dd>
                  <Currency value={result.exitValue} />
                </dd>
              </div>
            </dl>
          </article>
          <Callout
            tone={result.annualCashFlow < 0 ? "warning" : "success"}
            title={result.annualCashFlow < 0 ? "Effort d’épargne requis" : "Cash flow positif"}
          >
            {result.annualCashFlow < 0 ? (
              <>
                Le projet consomme <Currency value={-result.annualCashFlow / 12} /> par mois avant
                aléas et CAPEX exceptionnels.
              </>
            ) : (
              <>
                Le projet génère <Currency value={result.annualCashFlow / 12} /> par mois sous les
                hypothèses.
              </>
            )}
          </Callout>
        </div>
      </section>
    </div>
  );
}

export default RealEstatePage;

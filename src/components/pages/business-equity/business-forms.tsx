"use client";

import { useState } from "react";
import type { BusinessEntity } from "@/lib/engine/business-equity";
import type { Mutation } from "@/lib/data/contracts";

type Mutate = (mutation: Mutation) => Promise<boolean>;

function optionalNumber(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

export function BusinessForms({
  businesses,
  mutate,
  busy,
}: {
  businesses: BusinessEntity[];
  mutate: Mutate;
  busy: boolean;
}) {
  const [name, setName] = useState("");
  const [legalForm, setLegalForm] = useState("SAS");
  const [businessType, setBusinessType] = useState<"OPERATING" | "HOLDING" | "STARTUP" | "SPV" | "OTHER">("OPERATING");
  const [currency, setCurrency] = useState("EUR");
  const [selected, setSelected] = useState("");
  const [date, setDate] = useState("2026-08-26");
  const [legalRate, setLegalRate] = useState("100");
  const [economicRate, setEconomicRate] = useState("100");
  const [revenue, setRevenue] = useState("");
  const [ebitda, setEbitda] = useState("");
  const [cash, setCash] = useState("");
  const [debt, setDebt] = useState("");
  const [ev, setEv] = useState("");
  const [equity, setEquity] = useState("");
  const [method, setMethod] = useState<"EXTERNAL_APPRAISAL" | "TRANSACTION" | "EBITDA_MULTIPLE" | "REVENUE_MULTIPLE" | "DCF" | "FUNDING_ROUND" | "USER_ESTIMATE" | "LOOK_THROUGH">("USER_ESTIMATE");
  const [eventType, setEventType] = useState<"OPENING_COST_BASIS" | "ACQUISITION" | "CAPITAL_INJECTION" | "SALE" | "DIVIDEND" | "DISTRIBUTION" | "CAPITAL_RETURN">("OPENING_COST_BASIS");
  const [eventAmount, setEventAmount] = useState("");

  return (
    <div className="results-stack">
      <form
        className="panel input-panel"
        onSubmit={async (event) => {
          event.preventDefault();
          const ok = await mutate({
            action: "save_business",
            business: {
              businessId: null,
              name,
              legalForm: legalForm || null,
              type: businessType,
              functionalCurrency: currency || null,
              notes: null,
            },
          });
          if (ok) setName("");
        }}
      >
        <div className="panel-header"><div><span className="eyebrow">Identité</span><h2>Ajouter une société</h2></div></div>
        <div className="mini-form-grid business-form">
          <label>Nom<input value={name} onChange={(e) => setName(e.target.value)} required /></label>
          <label>Forme juridique<input value={legalForm} onChange={(e) => setLegalForm(e.target.value)} /></label>
          <label>Type<select value={businessType} onChange={(e) => setBusinessType(e.target.value as typeof businessType)}><option value="OPERATING">Société opérationnelle</option><option value="HOLDING">Holding</option><option value="STARTUP">Startup</option><option value="SPV">SPV</option><option value="OTHER">Autre</option></select></label>
          <label>Devise<input value={currency} maxLength={3} onChange={(e) => setCurrency(e.target.value.toUpperCase())} /></label>
        </div>
        <button className="button primary" disabled={busy || !name.trim()}>Créer</button>
      </form>

      {businesses.length > 0 && (
        <>
          <div className="panel"><label>Société<select value={selected} onChange={(e) => setSelected(e.target.value)}><option value="">Choisir…</option>{businesses.map((business) => <option key={business.id} value={business.id}>{business.name}</option>)}</select></label></div>

          <form className="panel input-panel" onSubmit={async (event) => { event.preventDefault(); if (!selected) return; await mutate({ action: "record_business_ownership", ownership: { businessId: selected, effectiveDate: date, legalRate: Number(legalRate) / 100, economicRate: optionalNumber(economicRate) === null ? null : Number(economicRate) / 100, votingRate: null, fullyDilutedRate: null, notes: null } }); }}>
            <h2>Détention</h2>
            <div className="mini-form-grid"><label>Date d’effet<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label><label>Détention juridique %<input value={legalRate} onChange={(e) => setLegalRate(e.target.value)} /></label><label>Droits économiques %<input value={economicRate} onChange={(e) => setEconomicRate(e.target.value)} /></label></div>
            <button className="button secondary" disabled={!selected || busy}>Enregistrer</button>
          </form>

          <form className="panel input-panel" onSubmit={async (event) => { event.preventDefault(); if (!selected) return; await mutate({ action: "record_business_financials", financials: { businessId: selected, periodEnd: date, currency: currency || null, revenue: optionalNumber(revenue), grossMargin: null, ebitda: optionalNumber(ebitda), ebit: null, netIncome: null, cash: optionalNumber(cash), grossDebt: optionalNumber(debt), workingCapital: null, capex: null, freeCashFlow: null, notes: null } }); }}>
            <h2>Financiers observés</h2>
            <p className="muted">0 est une information. Laisser vide signifie « inconnu » — notamment pour le cash et la dette.</p>
            <div className="mini-form-grid"><label>Chiffre d’affaires<input value={revenue} onChange={(e) => setRevenue(e.target.value)} /></label><label>EBITDA<input value={ebitda} onChange={(e) => setEbitda(e.target.value)} /></label><label>Cash<input value={cash} onChange={(e) => setCash(e.target.value)} placeholder="vide = inconnu" /></label><label>Dette brute corporate<input value={debt} onChange={(e) => setDebt(e.target.value)} placeholder="0 si réellement nulle" /></label></div>
            <button className="button secondary" disabled={!selected || busy}>Enregistrer</button>
          </form>

          <form className="panel input-panel" onSubmit={async (event) => { event.preventDefault(); if (!selected) return; await mutate({ action: "record_business_valuation", valuation: { businessId: selected, valuationDate: date, currency: currency || null, method, enterpriseValue: optionalNumber(ev), equityValue: optionalNumber(equity), valuationMultiple: null, notes: null } }); }}>
            <h2>Valorisation</h2>
            <div className="mini-form-grid"><label>Méthode<select value={method} onChange={(e) => setMethod(e.target.value as typeof method)}><option value="USER_ESTIMATE">Estimation utilisateur</option><option value="EXTERNAL_APPRAISAL">Valorisation externe</option><option value="TRANSACTION">Transaction</option><option value="EBITDA_MULTIPLE">Multiple EBITDA</option><option value="REVENUE_MULTIPLE">Multiple CA</option><option value="DCF">DCF</option><option value="FUNDING_ROUND">Levée de fonds</option></select></label><label>Enterprise Value<input value={ev} onChange={(e) => setEv(e.target.value)} /></label><label>Equity Value<input value={equity} onChange={(e) => setEquity(e.target.value)} /></label></div>
            <p className="muted">Si seule l’EV est connue, le moteur exige un bridge dette brute / cash daté. Il ne fait jamais EV × détention par défaut.</p>
            <button className="button secondary" disabled={!selected || busy || (optionalNumber(ev) === null && optionalNumber(equity) === null)}>Enregistrer</button>
          </form>

          <form className="panel input-panel" onSubmit={async (event) => { event.preventDefault(); if (!selected) return; await mutate({ action: "record_business_capital_event", event: { businessId: selected, type: eventType, eventDate: date, amount: Number(eventAmount), currency, ownershipDelta: null, transactionId: null, notes: null } }); }}>
            <h2>Capital & distributions</h2>
            <div className="mini-form-grid"><label>Nature<select value={eventType} onChange={(e) => setEventType(e.target.value as typeof eventType)}><option value="OPENING_COST_BASIS">Coût de revient d’ouverture</option><option value="ACQUISITION">Acquisition</option><option value="CAPITAL_INJECTION">Apport / augmentation</option><option value="SALE">Cession</option><option value="DIVIDEND">Dividende</option><option value="DISTRIBUTION">Distribution</option><option value="CAPITAL_RETURN">Remboursement de capital</option></select></label><label>Montant<input value={eventAmount} onChange={(e) => setEventAmount(e.target.value)} /></label></div>
            <button className="button secondary" disabled={!selected || busy || !eventAmount}>Enregistrer</button>
          </form>
        </>
      )}
    </div>
  );
}

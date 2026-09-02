"use client";

import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import {
  ArrowRight, Banknote, BriefcaseBusiness, Building2, CalendarRange, CheckCircle2, CircleDollarSign,
  Database, Eye, FileCheck2, FileText, FlaskConical, Landmark, Layers3, Network, Pencil,
  ReceiptText, Settings2, ShieldCheck, SlidersHorizontal, Target, TrendingUp, Upload, WalletCards,
  type LucideIcon,
} from "lucide-react";
import type { DashboardState } from "@/lib/types";

type Props = {
  section: string;
  state: DashboardState;
  children: ReactNode;
};

type SourceSpec = {
  icon: LucideIcon;
  label: string;
  hint: string;
  status: (state: DashboardState) => boolean;
};

type DomainSpec = {
  icon: LucideIcon;
  title: string;
  question: string;
  tone: string;
  sources: SourceSpec[];
  inspector: string[];
};

const money = (value: number | null | undefined) =>
  new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(Number(value ?? 0));
const compact = (value: number | null | undefined) =>
  new Intl.NumberFormat("fr-FR", { notation: "compact", maximumFractionDigits: 1 }).format(Number(value ?? 0));
const pct = (value: number) => `${Math.round(value * 10) / 10} %`;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const has = (value: unknown) => Array.isArray(value) ? value.length > 0 : Boolean(value);

const specs: Record<string, DomainSpec> = {
  "net-worth": {
    icon: WalletCards,
    title: "Patrimoine",
    question: "Où se trouve votre valeur — et quelle part est réellement mobilisable ?",
    tone: "blue",
    sources: [
      { icon: Banknote, label: "Banques", hint: "Soldes & liquidités", status: (s) => has(s.accounts) },
      { icon: TrendingUp, label: "Investissements", hint: "Positions", status: (s) => has(s.positions) },
      { icon: Building2, label: "Immobilier", hint: "Actifs", status: (s) => has((s as any).properties) },
      { icon: Landmark, label: "Dettes", hint: "Encours", status: (s) => has(s.liabilities) },
    ],
    inspector: ["Liquidité", "Concentration", "Variation", "Provenance"],
  },
  "cash-flow": {
    icon: CircleDollarSign,
    title: "Cash Flow",
    question: "Combien de liberté financière reste-t-il après les engagements réels du mois ?",
    tone: "green",
    sources: [
      { icon: Banknote, label: "Transactions", hint: "Flux observés", status: (s) => has(s.transactions) },
      { icon: BriefcaseBusiness, label: "Revenus", hint: "Salaire & autres", status: (s) => has((s as any).careerEvents) || has((s as any).recurringRules) },
      { icon: Landmark, label: "Dette", hint: "Échéances", status: (s) => has(s.liabilities) },
      { icon: FileCheck2, label: "Récurrents", hint: "Détectés / confirmés", status: (s) => has((s as any).recurringRules) },
    ],
    inspector: ["Flexibilité", "Taux d’épargne", "Fonds de sécurité", "Récurrents"],
  },
  investments: {
    icon: TrendingUp,
    title: "Investissements",
    question: "Votre portefeuille est-il cohérent avec vos projets, votre liquidité et votre risque ?",
    tone: "violet",
    sources: [
      { icon: TrendingUp, label: "Positions", hint: "Titres & fonds", status: (s) => has(s.positions) },
      { icon: Banknote, label: "Comptes", hint: "PEA · CTO · AV", status: (s) => has(s.accounts) },
      { icon: Database, label: "Historique", hint: "Achats & ventes", status: (s) => has(s.transactions) },
      { icon: Target, label: "Objectifs", hint: "Horizon & besoin de cash", status: (s) => has((s as any).goals) },
    ],
    inspector: ["Allocation", "Performance", "Liquidité", "Risque"],
  },
  debt: {
    icon: Landmark,
    title: "Dette",
    question: "Que vous coûte réellement votre dette et quelles échéances structurent votre avenir ?",
    tone: "coral",
    sources: [
      { icon: FileText, label: "Échéancier", hint: "Contrat bancaire", status: (s) => s.liabilities.some((x) => (x.providedSchedule?.length ?? 0) > 0) },
      { icon: FileCheck2, label: "Contrat", hint: "Taux & clauses", status: (s) => has(s.liabilities) },
      { icon: Banknote, label: "Prélèvements", hint: "Sorties observées", status: (s) => has(s.transactions) },
      { icon: ShieldCheck, label: "Assurance", hint: "Coût emprunteur", status: (s) => s.liabilities.some((x) => x.monthlyInsurance != null) },
    ],
    inspector: ["Capital", "Intérêts", "Assurance", "Renégociation"],
  },
  "real-estate": {
    icon: Building2,
    title: "Immobilier",
    question: "Le bien crée-t-il de la valeur après coût complet, dette, vacance et fiscalité ?",
    tone: "teal",
    sources: [
      { icon: Building2, label: "Bien", hint: "Prix · surface · zone", status: (s) => has((s as any).properties) },
      { icon: Landmark, label: "Financement", hint: "Crédit associé", status: (s) => has(s.liabilities) },
      { icon: FileText, label: "Documents", hint: "Acte · devis · copro", status: (s) => has((s as any).documents) },
      { icon: CircleDollarSign, label: "Exploitation", hint: "Loyers & charges", status: (s) => has(s.transactions) },
    ],
    inspector: ["Coût complet", "Cash-flow", "Rendement", "Création de valeur"],
  },
  career: {
    icon: BriefcaseBusiness,
    title: "Carrière",
    question: "Quelle capacité financière votre travail crée-t-il aujourd’hui et demain ?",
    tone: "indigo",
    sources: [
      { icon: FileText, label: "Contrat", hint: "Fixe · variable · avantages", status: (s) => has((s as any).careerEvents) },
      { icon: FileCheck2, label: "Paie", hint: "Bulletins", status: (s) => has((s as any).documents) },
      { icon: Banknote, label: "Banque", hint: "Net encaissé", status: (s) => has(s.transactions) },
      { icon: Target, label: "Projet", hint: "Offre / scénario", status: (s) => has((s as any).scenarios) },
    ],
    inspector: ["Net confirmé", "Brut → net", "Variable", "Trajectoire"],
  },
  "business-equity": {
    icon: Network,
    title: "Entreprise",
    question: "Votre entreprise transforme-t-elle son EBITDA en cash — et quelle valeur vous revient ?",
    tone: "pink",
    sources: [
      { icon: FileText, label: "Comptes", hint: "Liasse · bilan · P&L", status: (s) => has((s as any).businessStatements) || has((s as any).documents) },
      { icon: Database, label: "FEC", hint: "Grand livre", status: (s) => has((s as any).fecEntries) },
      { icon: Network, label: "Détention", hint: "Capital & parts", status: (s) => has((s as any).businessInterests) },
      { icon: Banknote, label: "Trésorerie", hint: "Cash & dette", status: (s) => has(s.accounts) || has(s.liabilities) },
    ],
    inspector: ["EBITDA → cash", "BFR", "Capex", "Equity Value"],
  },
  tax: {
    icon: ReceiptText,
    title: "Fiscalité",
    question: "Quelle différence entre performance économique et cash réellement disponible après impôt ?",
    tone: "amber",
    sources: [
      { icon: FileText, label: "Fiscal", hint: "Avis · IFU · déclarations", status: (s) => has((s as any).documents) },
      { icon: TrendingUp, label: "Investissements", hint: "Enveloppes & plus-values", status: (s) => has(s.positions) },
      { icon: Building2, label: "Immobilier", hint: "Régime & flux", status: (s) => has((s as any).properties) },
      { icon: Network, label: "Entreprise", hint: "Salaire · dividendes · cession", status: (s) => has((s as any).businessInterests) },
    ],
    inspector: ["Avant impôt", "Impôt estimé", "Après impôt", "Confiance"],
  },
  scenarios: {
    icon: Layers3,
    title: "Scénarios",
    question: "Comment votre trajectoire change-t-elle quand une hypothèse importante bouge ?",
    tone: "violet",
    sources: [
      { icon: ShieldCheck, label: "Situation réelle", hint: "Point de départ", status: () => true },
      { icon: SlidersHorizontal, label: "Hypothèses", hint: "Variables isolées", status: (s) => has((s as any).scenarios) },
      { icon: Target, label: "Objectifs", hint: "Contraintes", status: (s) => has((s as any).goals) },
    ],
    inspector: ["Central", "Stress", "Optimiste", "Sensibilités"],
  },
  "decision-lab": {
    icon: FlaskConical,
    title: "Décisions",
    question: "Quelle option améliore le mieux votre situation globale — pas seulement un KPI ?",
    tone: "violet",
    sources: [
      { icon: WalletCards, label: "Situation", hint: "Patrimoine actuel", status: () => true },
      { icon: SlidersHorizontal, label: "Option A", hint: "Hypothèses", status: () => true },
      { icon: SlidersHorizontal, label: "Option B", hint: "Alternative", status: () => true },
      { icon: Target, label: "Contraintes", hint: "Objectifs & limites", status: (s) => has((s as any).goals) },
    ],
    inspector: ["Patrimoine", "Liquidité", "Risque", "Objectifs"],
  },
  goals: {
    icon: Target,
    title: "Objectifs",
    question: "Quel chemin de financement rend votre objectif réaliste sans fragiliser le reste ?",
    tone: "magenta",
    sources: [
      { icon: Target, label: "Objectif", hint: "Montant & date", status: (s) => has((s as any).goals) },
      { icon: CircleDollarSign, label: "Épargne", hint: "Capacité mensuelle", status: (s) => has(s.transactions) },
      { icon: WalletCards, label: "Capital", hint: "Actifs mobilisables", status: (s) => has(s.accounts) || has(s.positions) },
      { icon: Landmark, label: "Dette", hint: "Contraintes", status: (s) => has(s.liabilities) },
    ],
    inspector: ["Besoin", "Capital actuel", "Épargne", "Écart"],
  },
};

function SourceRail({ spec, state }: { spec: DomainSpec; state: DashboardState }) {
  return (
    <aside className="v10-source-rail">
      <div className="v10-rail-label">Sources</div>
      {spec.sources.map((source) => {
        const Icon = source.icon;
        const ok = source.status(state);
        return (
          <button key={source.label} className={ok ? "ready" : "missing"} type="button">
            <span className="v10-source-icon"><Icon size={17} /></span>
            <span className="v10-source-copy"><strong>{source.label}</strong><small>{source.hint}</small></span>
            <i>{ok ? <CheckCircle2 size={14} /> : <Upload size={13} />}</i>
          </button>
        );
      })}
      <Link className="v10-add-source" href="/imports"><Upload size={15} /> Ajouter une source</Link>
    </aside>
  );
}

function MiniToolbar({ mode, setMode, onDetail }: { mode: "actual" | "scenario"; setMode: (v: "actual" | "scenario") => void; onDetail: () => void }) {
  return (
    <div className="v10-toolbar">
      <div className="v10-mode-switch">
        <button className={mode === "actual" ? "active" : ""} onClick={() => setMode("actual")}>Réel</button>
        <button className={mode === "scenario" ? "active scenario" : ""} onClick={() => setMode("scenario")}>Simulation</button>
      </div>
      <button className="v10-icon-action" title="Personnaliser la vue"><SlidersHorizontal size={16} /></button>
      <button className="v10-detail-button" onClick={onDetail}><Database size={15} /> Analyse détaillée</button>
    </div>
  );
}

function Inspector({ spec, state, section }: { spec: DomainSpec; state: DashboardState; section: string }) {
  const netWorth = Number(state.metrics.netWorth ?? 0);
  const liquidity = Number(state.metrics.bankCash ?? 0);
  const fcf = Number(state.metrics.freeCashFlow ?? 0);
  const debt = Math.max(0, Number(state.metrics.grossAssets ?? 0) - netWorth);
  const values: Record<string, string[]> = {
    "net-worth": [money(netWorth), money(liquidity), pct(netWorth ? (liquidity / Math.abs(netWorth)) * 100 : 0), `${state.accounts.length} comptes`],
    "cash-flow": [money(fcf), pct(Math.max(0, fcf) && Number((state.metrics as any).monthlyIncome ?? 0) ? (fcf / Number((state.metrics as any).monthlyIncome)) * 100 : 0), `${Math.max(0, Math.round(liquidity / Math.max(1, Math.abs(fcf) || 1000)))} mois`, `${state.transactions.length} flux`],
    investments: [money(state.positions.reduce((a, p) => a + Number(p.value || 0), 0)), `${state.positions.length} lignes`, money(liquidity), "À analyser"],
    debt: [money(debt), `${state.liabilities.length} contrats`, money(state.liabilities.reduce((a, l) => a + Number(l.monthlyPayment || 0), 0)), "Contrats"],
    "real-estate": [money((state as any).properties?.reduce?.((a: number, p: any) => a + Number(p.value || p.currentValue || 0), 0) ?? 0), money(debt), "À préciser", "Scénario"],
    career: [money(Number((state.metrics as any).monthlyIncome ?? 0)), "Observé", "Historique", "Simulation"],
    "business-equity": [money((state as any).businessInterests?.reduce?.((a: number, b: any) => a + Number(b.value || b.equityValue || 0), 0) ?? 0), "BFR", "Capex", "Valorisation"],
    tax: ["Économique", "À estimer", "Net", "Source"],
    scenarios: [money(netWorth), "Central", "Stress", "Optimiste"],
    "decision-lab": [money(netWorth), money(liquidity), "Risque", "Objectifs"],
    goals: ["Objectif", money(liquidity), money(Math.max(0, fcf)), "Écart"],
  };
  const row = values[section] ?? ["—", "—", "—", "—"];
  return (
    <aside className="v10-inspector">
      <div className="v10-inspector-head"><Eye size={15} /><span>Lecture rapide</span></div>
      {spec.inspector.map((label, index) => (
        <div className="v10-inspector-row" key={label}><span>{label}</span><strong>{row[index] ?? "—"}</strong></div>
      ))}
      <div className="v10-inspector-foot"><ShieldCheck size={14} /><span>Cliquer un élément du canvas doit ouvrir sa source ou son calcul.</span></div>
    </aside>
  );
}

function BalanceSheetVisual({ state }: { state: DashboardState }) {
  const net = Number(state.metrics.netWorth ?? 0);
  const assets = Math.max(net, Number(state.metrics.grossAssets ?? 0));
  const debt = Math.max(0, assets - net);
  const cash = Number(state.metrics.bankCash ?? 0);
  const investments = state.positions.reduce((sum, item) => sum + Number(item.value || 0), 0);
  const other = Math.max(0, assets - cash - investments);
  const total = Math.max(1, assets);
  return (
    <div className="v10-bs-visual">
      <div className="v10-bs-side assets">
        <div className="v10-bs-total"><small>Actifs</small><strong>{money(assets)}</strong></div>
        <div className="v10-bs-stack">
          <button style={{ flex: Math.max(.15, cash / total) }}><span>Liquidités</span><strong>{compact(cash)} €</strong></button>
          <button style={{ flex: Math.max(.15, investments / total) }}><span>Investissements</span><strong>{compact(investments)} €</strong></button>
          <button style={{ flex: Math.max(.15, other / total) }}><span>Autres actifs</span><strong>{compact(other)} €</strong></button>
        </div>
      </div>
      <div className="v10-bs-equation"><span>−</span></div>
      <div className="v10-bs-side debt"><div className="v10-bs-total"><small>Dettes</small><strong>{money(debt)}</strong></div><div className="v10-debt-block"><Landmark size={24}/><span>Engagements</span></div></div>
      <div className="v10-bs-equation"><span>=</span></div>
      <div className="v10-bs-net"><small>Patrimoine net</small><strong>{money(net)}</strong><em>{pct(net ? cash / Math.abs(net) * 100 : 0)} liquide</em></div>
    </div>
  );
}

function CashFlowVisual({ state }: { state: DashboardState }) {
  const fcf = Number(state.metrics.freeCashFlow ?? 0);
  const knownIncome = Number((state.metrics as any).monthlyIncome ?? 0);
  const income = knownIncome > 0 ? knownIncome : Math.max(3000, Math.abs(fcf) + 2400);
  const debt = state.liabilities.reduce((sum, x) => sum + Number(x.monthlyPayment || 0), 0);
  const spend = Math.max(0, income - debt - fcf);
  const essential = spend * .62;
  const flexible = spend - essential;
  const width = (v: number) => `${clamp((v / Math.max(1, income)) * 100, 8, 100)}%`;
  return (
    <div className="v10-flow-visual">
      <div className="v10-flow-source"><small>Revenus</small><strong>{money(income)}</strong><span>Salaire · autres entrées</span></div>
      <div className="v10-flow-bridge"><i></i><i></i><i></i><i></i></div>
      <div className="v10-flow-sinks">
        <button className="essential"><span>Incompressible</span><b style={{ width: width(essential) }}></b><strong>{money(essential)}</strong></button>
        <button className="flexible"><span>Flexible</span><b style={{ width: width(flexible) }}></b><strong>{money(flexible)}</strong></button>
        <button className="debt"><span>Dette</span><b style={{ width: width(debt) }}></b><strong>{money(debt)}</strong></button>
        <button className="free"><span>Liberté</span><b style={{ width: width(Math.max(0, fcf)) }}></b><strong>{money(fcf)}</strong></button>
      </div>
      <div className="v10-flow-footer"><span>Récurrent ≠ incompressible</span><span>{pct(income ? Math.max(0, fcf) / income * 100 : 0)} du revenu reste disponible</span></div>
    </div>
  );
}

function InvestmentVisual({ state }: { state: DashboardState }) {
  const total = state.positions.reduce((sum, p) => sum + Number(p.value || 0), 0);
  const cash = state.positions.filter((p) => p.isCash).reduce((sum, p) => sum + Number(p.value || 0), 0);
  const invested = Math.max(0, total - cash);
  return (
    <div className="v10-invest-visual">
      <div className="v10-invest-main">
        <div className="v10-chart-head"><div><small>Portefeuille</small><strong>{money(total)}</strong></div><div className="v10-range"><button>1A</button><button className="active">5A</button><button>MAX</button></div></div>
        <svg viewBox="0 0 720 320" preserveAspectRatio="none"><defs><linearGradient id="v10Inv" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#8b7cff" stopOpacity=".30"/><stop offset="1" stopColor="#8b7cff" stopOpacity="0"/></linearGradient></defs><path className="grid" d="M0 64H720M0 128H720M0 192H720M0 256H720"/><path className="area" d="M0 245 C90 225 135 230 190 195 S300 180 355 160 S440 178 500 125 S620 112 720 70 L720 320 L0 320Z"/><path className="benchmark" d="M0 250 C105 232 180 220 250 205 S400 168 510 146 S620 112 720 92"/><path className="portfolio" d="M0 245 C90 225 135 230 190 195 S300 180 355 160 S440 178 500 125 S620 112 720 70"/><circle cx="500" cy="125" r="6"/></svg>
        <div className="v10-chart-legend"><span><i className="portfolio"></i>Portefeuille</span><span><i className="benchmark"></i>Indice de référence</span><span><i className="event"></i>Apports</span></div>
      </div>
      <div className="v10-invest-side"><div className="v10-ring" style={{ "--cash": `${clamp(total ? cash / total * 100 : 0, 5, 95)}%` } as React.CSSProperties}><span><strong>{pct(total ? invested / total * 100 : 0)}</strong><small>investi</small></span></div><div className="v10-invest-facts"><span>Investi <b>{money(invested)}</b></span><span>Cash <b>{money(cash)}</b></span><span>Lignes <b>{state.positions.length}</b></span></div></div>
    </div>
  );
}

function DebtVisual({ state }: { state: DashboardState }) {
  const debt = state.liabilities.reduce((sum, l) => sum + Number(l.currentBalance || 0), 0);
  const payment = state.liabilities.reduce((sum, l) => sum + Number(l.monthlyPayment || 0), 0);
  const insurance = state.liabilities.reduce((sum, l) => sum + Number(l.monthlyInsurance || 0), 0);
  const interest = Math.max(0, payment * .28);
  const principal = Math.max(0, payment - interest - insurance);
  const max = Math.max(1, payment);
  return (
    <div className="v10-debt-visual">
      <div className="v10-debt-summary"><div><small>Capital restant dû</small><strong>{money(debt)}</strong></div><span>{state.liabilities.length} contrat{state.liabilities.length > 1 ? "s" : ""}</span></div>
      <svg viewBox="0 0 800 260" preserveAspectRatio="none"><path className="grid" d="M0 65H800M0 130H800M0 195H800"/><path className="balance" d="M10 45 C130 60 250 82 360 112 S600 170 790 225"/><path className="projection" d="M510 150 C610 175 705 200 790 225"/><circle cx="510" cy="150" r="6"/></svg>
      <div className="v10-payment-strip"><button style={{ flex: principal / max }} className="principal"><span>Capital</span><b>{money(principal)}</b></button><button style={{ flex: interest / max }} className="interest"><span>Intérêts</span><b>{money(interest)}</b></button><button style={{ flex: Math.max(.08, insurance / max) }} className="insurance"><span>Assurance</span><b>{money(insurance)}</b></button></div>
      <div className="v10-debt-timeline"><span>Aujourd’hui</span><i></i><span>Prochaine échéance</span><i></i><span>Maturité</span></div>
    </div>
  );
}

function PropertyVisual({ state }: { state: DashboardState }) {
  const propertyValue = Number((state as any).properties?.[0]?.value ?? (state as any).properties?.[0]?.currentValue ?? 450000);
  const debt = state.liabilities.reduce((sum, l) => sum + Number(l.currentBalance || 0), 0);
  const equity = Math.max(0, propertyValue - debt);
  return (
    <div className="v10-property-visual">
      <div className="v10-property-card"><span>Bien analysé</span><Building2 size={34}/><strong>{money(propertyValue)}</strong><small>Valeur / projet</small><div><b>{compact(equity)} €</b><small>Equity</small></div></div>
      <div className="v10-property-stack"><div className="v10-stack-head"><span>Coût complet</span><strong>{money(propertyValue)}</strong></div><button className="purchase" style={{ width: "74%" }}><span>Achat</span></button><button className="fees" style={{ width: "12%" }}><span>Frais</span></button><button className="works" style={{ width: "18%" }}><span>Travaux</span></button><button className="buffer" style={{ width: "8%" }}><span>Imprévus</span></button><div className="v10-stack-rule"><span>Prix d’achat</span><span>≠</span><strong>Coût économique total</strong></div></div>
      <div className="v10-property-finance"><small>Financement</small><div className="v10-finance-ring"><span><strong>{pct(propertyValue ? debt / propertyValue * 100 : 0)}</strong><small>LTV</small></span></div><div className="v10-finance-facts"><span>Dette <b>{money(debt)}</b></span><span>Equity <b>{money(equity)}</b></span><span>Vacance <b>à préciser</b></span></div></div>
    </div>
  );
}

function CareerVisual({ state }: { state: DashboardState }) {
  const net = Number((state.metrics as any).monthlyIncome ?? 3482);
  const gross = net / .78;
  const contributions = gross - net;
  return (
    <div className="v10-career-visual">
      <div className="v10-career-bridge"><div className="gross"><small>Brut</small><strong>{money(gross)}</strong></div><ArrowRight size={20}/><div className="deductions"><small>Cotisations & prélèvements</small><strong>− {money(contributions)}</strong></div><ArrowRight size={20}/><div className="net"><small>Net encaissé</small><strong>{money(net)}</strong><em><FileCheck2 size={13}/> Rapproché banque</em></div></div>
      <div className="v10-career-timeline"><span>Contrat</span><i className="done"></i><span>Paie</span><i className="done"></i><span>Banque</span><i className="done"></i><span>Cash Flow</span><i></i><span>Objectifs</span></div>
    </div>
  );
}

function BusinessVisual() {
  return (
    <div className="v10-business-visual">
      <div className="v10-waterfall"><div className="v10-waterfall-title">EBITDA → cash</div><button className="up"><span>EBITDA</span><strong>5,0 M€</strong></button><button className="down"><span>Δ BFR</span><strong>−1,1 M€</strong></button><button className="down"><span>Capex</span><strong>−1,5 M€</strong></button><button className="down"><span>Impôts cash</span><strong>−0,7 M€</strong></button><button className="final"><span>Cash opérationnel</span><strong>1,7 M€</strong></button></div>
      <div className="v10-business-bridge"><div><small>Enterprise Value</small><strong>8,5 M€</strong></div><span>− dette</span><span>+ cash</span><span>± ajustements</span><div className="final"><small>Equity Value</small><strong>6,9 M€</strong></div></div>
      <div className="v10-business-note">Résultat net ≠ cash · maintenance capex ≠ growth capex</div>
    </div>
  );
}

function TaxVisual() {
  return (
    <div className="v10-tax-visual"><div className="v10-tax-bars"><div><span>Performance économique</span><b style={{ height: "88%" }}>10 000 €</b></div><div className="tax"><span>Impôt estimé</span><b style={{ height: "34%" }}>−3 000 €</b></div><div className="net"><span>Disponible après impôt</span><b style={{ height: "61%" }}>7 000 €</b></div></div><div className="v10-tax-confidence"><ShieldCheck size={18}/><div><small>Niveau de confiance</small><strong>Estimation encadrée</strong><span>Règle + hypothèses visibles</span></div></div></div>
  );
}

function ScenarioVisual({ state, decision = false }: { state: DashboardState; decision?: boolean }) {
  const base = Number(state.metrics.netWorth ?? 0);
  if (decision) return <div className="v10-decision-visual"><div className="v10-decision-option current"><span>Option A</span><strong>Investir 50 k€</strong><div><small>Patrimoine à 5 ans</small><b>{money(base * 1.22)}</b></div><div><small>Liquidité immédiate</small><b>{money(Math.max(0, Number(state.metrics.bankCash ?? 0) - 50000))}</b></div><em>Plus de potentiel · moins de liquidité</em></div><div className="v10-decision-vs">VS</div><div className="v10-decision-option"><span>Option B</span><strong>Réduire la dette</strong><div><small>Patrimoine à 5 ans</small><b>{money(base * 1.16)}</b></div><div><small>Charge mensuelle</small><b>−320 €</b></div><em>Moins de coût · plus de flexibilité</em></div></div>;
  return (
    <div className="v10-scenario-visual"><svg viewBox="0 0 860 340" preserveAspectRatio="none"><path className="grid" d="M0 68H860M0 136H860M0 204H860M0 272H860"/><path className="fan fan3" d="M130 235 C350 210 510 160 850 60 L850 280 C540 235 350 230 130 235Z"/><path className="fan fan2" d="M130 235 C350 210 520 180 850 95 L850 250 C560 225 360 225 130 235Z"/><path className="central" d="M20 255 C90 246 115 240 130 235 C350 210 510 195 850 145"/><line x1="130" x2="130" y1="30" y2="305" className="today"/></svg><div className="v10-scenario-tabs"><button className="active">Central</button><button>Stress</button><button>Optimiste</button></div></div>
  );
}

function GoalVisual({ state }: { state: DashboardState }) {
  const cash = Number(state.metrics.bankCash ?? 0);
  const fcf = Math.max(0, Number(state.metrics.freeCashFlow ?? 0));
  const target = Math.max(100000, cash + fcf * 48);
  const progress = clamp(cash / target * 100, 0, 100);
  return <div className="v10-goal-visual"><div className="v10-goal-ring" style={{ "--progress": `${progress}%` } as React.CSSProperties}><span><strong>{Math.round(progress)}%</strong><small>financé</small></span></div><div className="v10-goal-path"><div><small>Capital disponible</small><strong>{money(cash)}</strong></div><i><ArrowRight size={18}/></i><div><small>Épargne mensuelle</small><strong>{money(fcf)}</strong></div><i><ArrowRight size={18}/></i><div className="target"><small>Objectif illustratif</small><strong>{money(target)}</strong></div></div></div>;
}

function DomainCanvas({ section, state }: { section: string; state: DashboardState }) {
  if (section === "net-worth") return <BalanceSheetVisual state={state} />;
  if (section === "cash-flow") return <CashFlowVisual state={state} />;
  if (section === "investments") return <InvestmentVisual state={state} />;
  if (section === "debt") return <DebtVisual state={state} />;
  if (section === "real-estate") return <PropertyVisual state={state} />;
  if (section === "career") return <CareerVisual state={state} />;
  if (section === "business-equity") return <BusinessVisual />;
  if (section === "tax") return <TaxVisual />;
  if (section === "scenarios") return <ScenarioVisual state={state} />;
  if (section === "decision-lab") return <ScenarioVisual state={state} decision />;
  if (section === "goals") return <GoalVisual state={state} />;
  return <div className="v10-generic-canvas"><Database size={36}/><strong>Vue opérationnelle</strong><span>Ouvrez l’espace détaillé pour gérer les enregistrements.</span></div>;
}

function OperationalFrame({ section, children }: { section: string; children: ReactNode }) {
  const title = section === "imports" ? "Sources" : section === "documents" ? "Documents" : section === "timeline" ? "Chronologie" : "Préférences";
  const Icon = section === "imports" ? Database : section === "documents" ? FileText : section === "timeline" ? CalendarRange : Settings2;
  return <div className="v10-operational"><header><span><Icon size={20}/></span><div><small>Gestion</small><h1>{title}</h1></div></header><div className="v10-operational-grid"><div className="v10-operational-summary"><button><Upload size={18}/><strong>Importer</strong><small>Ajouter une source</small></button><button><Pencil size={18}/><strong>Modifier</strong><small>Corriger une donnée</small></button><button><ShieldCheck size={18}/><strong>Réconcilier</strong><small>Vérifier les liens</small></button></div><div className="v10-operational-detail">{children}</div></div></div>;
}

export function GraphicalDomainV10({ section, state, children }: Props) {
  const [mode, setMode] = useState<"actual" | "scenario">("actual");
  const [detailOpen, setDetailOpen] = useState(false);
  const spec = specs[section];
  const coverage = useMemo(() => spec ? spec.sources.filter((source) => source.status(state)).length : 0, [spec, state]);

  if (!spec) return <OperationalFrame section={section}>{children}</OperationalFrame>;
  const Icon = spec.icon;
  return (
    <div className="v10-domain" data-domain={section} data-tone={spec.tone} data-mode={mode}>
      <header className="v10-domain-header">
        <div className="v10-domain-title"><span className="v10-domain-icon"><Icon size={21}/></span><div><small>{spec.title}</small><h1>{spec.question}</h1></div></div>
        <MiniToolbar mode={mode} setMode={setMode} onDetail={() => setDetailOpen((v) => !v)} />
      </header>
      <div className="v10-domain-status"><div><span className="dot"></span><strong>{coverage}/{spec.sources.length} sources actives</strong></div><span>Vue conceptuelle V10 · moteurs financiers inchangés</span></div>
      <main className="v10-workstation">
        <SourceRail spec={spec} state={state} />
        <section className="v10-canvas"><div className="v10-canvas-grid" aria-hidden="true"></div><DomainCanvas section={section} state={state} />{mode === "scenario" ? <div className="v10-scenario-watermark"><FlaskConical size={14}/> Simulation isolée</div> : null}</section>
        <Inspector spec={spec} state={state} section={section} />
      </main>
      <div className="v10-bottom-actions"><button><Eye size={15}/> Personnaliser les modules</button><Link href="/imports"><Upload size={15}/> Mettre à jour les sources</Link><button onClick={() => setDetailOpen(true)}><Database size={15}/> Ouvrir les écritures & calculs</button></div>
      {detailOpen ? <section className="v10-legacy-detail"><div className="v10-detail-head"><div><small>Profondeur complète</small><strong>Données, formulaires, calculs et historique</strong></div><button onClick={() => setDetailOpen(false)}>Fermer</button></div>{children}</section> : null}
    </div>
  );
}

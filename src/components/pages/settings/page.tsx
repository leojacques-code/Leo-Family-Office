"use client";

import Link from "next/link";
import {
  AlertTriangle,
  BadgeEuro,
  Check,
  Download,
  FileArchive,
  FileText,
  ShieldAlert,
} from "lucide-react";
import { Currency, DataBadge, MetricCard, SectionHeader } from "@/components/ui";
import type { SectionProps } from "@/components/pages/shared";

function SettingsPage({ state }: SectionProps) {
  return (
    <div className="page-stack">
      <SectionHeader
        eyebrow="Governance"
        title="Settings & Assumptions"
        description="Registre des hypothèses, provenance, confiance, sécurité et portabilité."
        actions={
          <Link className="button secondary" href="/api/export?format=json">
            <Download size={15} />
            Backup JSON
          </Link>
        }
      />
      <section className="metrics-grid four">
        <MetricCard label="Date zéro" value="19 août 2026" />
        <MetricCard
          label="Devise reporting"
          value={state.reportingCurrency}
          detail="Multi-devises prêt"
        />
        <MetricCard label="Adapter actif" value="SQLite local" detail="Supabase prêt à connecter" />
        <MetricCard label="Données externes actives" value="0" detail="Fallback manuel" />
      </section>
      <section className="panel">
        <div className="panel-header">
          <div>
            <span className="eyebrow">Assumption register</span>
            <h2>Hypothèses importantes</h2>
          </div>
        </div>
        <div className="assumption-table">
          <div className="table-head">
            <span>Hypothèse</span>
            <span>Valeur</span>
            <span>Unité</span>
            <span>Provenance</span>
            <span>Confiance</span>
          </div>
          {state.assumptions.map((assumption) => (
            <div className="table-row" key={assumption.id}>
              <span>
                <strong>{assumption.name}</strong>
                <small>{assumption.provenance.notes ?? assumption.provenance.source}</small>
              </span>
              <strong>
                {typeof assumption.value === "number" && assumption.unit.includes("EUR") ? (
                  <Currency value={assumption.value} />
                ) : (
                  String(assumption.value ?? "—")
                )}
              </strong>
              <span>{assumption.unit}</span>
              <DataBadge kind={assumption.provenance.kind} />
              <span className={`confidence ${assumption.provenance.confidence.toLowerCase()}`}>
                {assumption.provenance.confidence}
              </span>
            </div>
          ))}
        </div>
      </section>
      <section className="two-column">
        <article className="panel">
          <div className="panel-header">
            <div>
              <span className="eyebrow">Security</span>
              <h2>Statut V1</h2>
            </div>
            <ShieldAlert size={18} />
          </div>
          <div className="security-checklist">
            <div className="ok">
              <Check size={14} />
              <span>Routes protégées par session HttpOnly</span>
            </div>
            <div className="ok">
              <Check size={14} />
              <span>Validation stricte des inputs</span>
            </div>
            <div className="ok">
              <Check size={14} />
              <span>Aucun secret dans le frontend</span>
            </div>
            <div className="ok">
              <Check size={14} />
              <span>Fichiers privés et types limités</span>
            </div>
            <div className="ok">
              <Check size={14} />
              <span>Aucune écriture bancaire ou courtier</span>
            </div>
            <div className="pending">
              <AlertTriangle size={14} />
              <span>Déployer Supabase Auth + RLS avant exposition internet</span>
            </div>
          </div>
        </article>
        <article className="panel">
          <div className="panel-header">
            <div>
              <span className="eyebrow">Exports</span>
              <h2>Portabilité des données</h2>
            </div>
          </div>
          <div className="export-list">
            <Link href="/api/export?format=csv">
              <FileArchive size={18} />
              <span>
                <strong>Balance sheet CSV</strong>
                <small>Comptes et dettes consolidés</small>
              </span>
              <Download size={15} />
            </Link>
            <Link href="/api/export?format=json">
              <FileText size={18} />
              <span>
                <strong>Backup complet JSON</strong>
                <small>Données, hypothèses et scénarios</small>
              </span>
              <Download size={15} />
            </Link>
            <button>
              <BadgeEuro size={18} />
              <span>
                <strong>Rapport patrimonial PDF</strong>
                <small>Préparé pour V1.1</small>
              </span>
              <span className="soon">Coming soon</span>
            </button>
            <button>
              <FileText size={18} />
              <span>
                <strong>Investment Committee Memo</strong>
                <small>Préparé pour V1.1</small>
              </span>
              <span className="soon">Coming soon</span>
            </button>
          </div>
        </article>
      </section>
    </div>
  );
}

export default SettingsPage;

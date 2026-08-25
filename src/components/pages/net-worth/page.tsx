"use client";

import { useState } from "react";
import { ChevronRight, Landmark, Plus, Save } from "lucide-react";
import type { FinancialAccount } from "@/lib/types";
import {
  Callout,
  Currency,
  DataBadge,
  MetricCard,
  Modal,
  Percent,
  SectionHeader,
} from "@/components/ui";
import {
  type SectionProps,
  assetsExplanation,
  formatEur,
  inputNumber,
  netWorthExplanation,
} from "@/components/pages/shared";

function NetWorthPage({ state, mutate, busy, setExplanation }: SectionProps) {
  const [modal, setModal] = useState<"add" | "edit" | null>(null);
  const [selected, setSelected] = useState<FinancialAccount | null>(null);
  const [form, setForm] = useState({
    institution: "",
    name: "",
    accountType: "BANK" as FinancialAccount["type"],
    balance: "",
    currency: "EUR",
    date: state.asOfDate,
  });
  const bank = state.accounts.filter((item) => item.type === "BANK" || item.type === "SAVINGS");
  const investments = state.accounts.filter((item) => item.type === "PEA" || item.type === "CTO");
  // Aucune conversion FX n'est branchée : un compte en devise étrangère est signalé plutôt
  // qu'agrégé silencieusement à 1 pour 1.
  const foreignCurrencyAccounts = state.accounts.filter(
    (item) => item.currency !== state.reportingCurrency,
  );
  async function save(event: React.FormEvent) {
    event.preventDefault();
    const ok = selected
      ? await mutate({
          action: "update_account",
          accountId: selected.id,
          balance: inputNumber(form.balance),
          balanceDate: form.date,
        })
      : await mutate({
          action: "add_account",
          institution: form.institution,
          name: form.name,
          accountType: form.accountType,
          balance: inputNumber(form.balance),
          currency: form.currency.toUpperCase(),
        });
    if (ok) {
      setModal(null);
      setSelected(null);
    }
  }
  function edit(account: FinancialAccount) {
    setSelected(account);
    setForm({
      institution: account.institution,
      name: account.name,
      accountType: account.type,
      balance: String(account.balance),
      currency: account.currency,
      date: state.asOfDate,
    });
    setModal("edit");
  }
  return (
    <div className="page-stack">
      <SectionHeader
        eyebrow="Balance sheet"
        title="Net Worth"
        description="Un bilan consolidé sans double comptage. Les positions expliquent les comptes d’investissement, elles ne s’y ajoutent pas."
        actions={
          <button
            className="button primary"
            onClick={() => {
              setSelected(null);
              setForm({
                institution: "",
                name: "",
                accountType: "BANK",
                balance: "",
                currency: "EUR",
                date: state.asOfDate,
              });
              setModal("add");
            }}
          >
            <Plus size={16} />
            Ajouter un compte
          </button>
        }
      />
      <section className="metrics-grid four">
        <MetricCard
          label="Actifs financiers identifiés"
          value={<Currency value={state.metrics.grossAssets} />}
          detail="Périmètre financier seul, hors immobilier et business equity"
          onExplain={() => setExplanation(assetsExplanation(state))}
        />
        <MetricCard
          label="Dettes"
          value={<Currency value={state.metrics.debt} />}
          tone="negative"
        />
        <MetricCard
          label="Patrimoine net identifié"
          value={<Currency value={state.metrics.netWorth} />}
          tone={
            state.metrics.netWorth !== null && state.metrics.netWorth < 0 ? "negative" : "positive"
          }
          onExplain={() => setExplanation(netWorthExplanation(state))}
        />
        <MetricCard
          label="Liquid net worth"
          value={<Currency value={state.metrics.liquidNetWorth} />}
          tone={
            state.metrics.liquidNetWorth !== null && state.metrics.liquidNetWorth < 0
              ? "negative"
              : "positive"
          }
          detail={
            <>
              Actifs mobilisables <Currency value={state.metrics.liquidAssets} /> − dettes
            </>
          }
          onExplain={() =>
            setExplanation({
              title: "Liquid net worth",
              formula: "Σ soldes des comptes dont la liquidité n’est pas ILLIQUID − Σ dettes",
              inputs: [
                ...state.accounts.map((account) => ({
                  label: `${account.name} · ${account.liquidity}`,
                  value: formatEur(account.liquidity === "ILLIQUID" ? 0 : account.balance),
                  kind: account.provenance.kind,
                  date: account.balanceDate,
                })),
                {
                  label: "Dettes identifiées",
                  value: formatEur(state.metrics.debt),
                  kind: "DERIVED" as const,
                  date: state.asOfDate,
                },
              ],
              note: "Cette grandeur répond à « que resterait-il en soldant tout avec les seuls actifs liquides ». Elle est structurellement inférieure au patrimoine net dès qu’un actif est illiquide, et n’est pas un alias de celui-ci.",
            })
          }
        />
      </section>
      <Callout title="Périmètre identifié">
        Ce bilan inclut uniquement les actifs et dettes déclarés. Il ne prétend pas représenter un
        patrimoine économique exhaustif.
      </Callout>
      {foreignCurrencyAccounts.length ? (
        <Callout tone="warning" title="Devises non converties">
          {foreignCurrencyAccounts
            .map((account) => `${account.name} (${account.currency})`)
            .join(", ")}{" "}
          {foreignCurrencyAccounts.length > 1 ? "sont agrégés" : "est agrégé"} en{" "}
          {state.reportingCurrency} sans taux de change daté. Le total affiché est donc faux à
          hauteur de l’écart de change tant qu’aucun taux n’est branché.
        </Callout>
      ) : null}
      <section className="two-column">
        <AccountTable title="Cash bancaire" accounts={bank} onEdit={edit} />
        <AccountTable title="Investissements" accounts={investments} onEdit={edit} />
      </section>
      <section className="panel">
        <div className="panel-header">
          <div>
            <span className="eyebrow">Passif</span>
            <h2>Dettes identifiées</h2>
          </div>
        </div>
        {state.liabilities.map((liability) => (
          <div className="account-row" key={liability.id}>
            <span className="account-logo debt-logo">
              <Landmark size={17} />
            </span>
            <div className="account-main">
              <strong>{liability.name}</strong>
              <span>
                {liability.lender} ·{" "}
                {liability.annualRate === 0 ? "Taux 0 %" : <Percent value={liability.annualRate} />}
              </span>
            </div>
            <DataBadge kind={liability.provenance.kind} />
            <strong className="account-balance negative-text">
              −<Currency value={liability.currentBalance} />
            </strong>
          </div>
        ))}
      </section>
      <Modal
        open={Boolean(modal)}
        onClose={() => setModal(null)}
        title={selected ? `Mettre à jour ${selected.name}` : "Ajouter un compte"}
        subtitle="Toute nouvelle valeur conserve un historique daté"
      >
        <form className="form-grid" onSubmit={save}>
          {!selected ? (
            <>
              <label>
                Institution
                <input
                  className="text-input"
                  value={form.institution}
                  onChange={(event) => setForm({ ...form, institution: event.target.value })}
                  required
                />
              </label>
              <label>
                Nom du compte
                <input
                  className="text-input"
                  value={form.name}
                  onChange={(event) => setForm({ ...form, name: event.target.value })}
                  required
                />
              </label>
              <label>
                Type
                <select
                  className="text-input"
                  value={form.accountType}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      accountType: event.target.value as FinancialAccount["type"],
                    })
                  }
                >
                  <option value="BANK">Compte bancaire</option>
                  <option value="SAVINGS">Épargne</option>
                  <option value="PEA">PEA</option>
                  <option value="CTO">CTO</option>
                  <option value="OTHER">Autre</option>
                </select>
              </label>
              <label>
                Devise
                <input
                  className="text-input"
                  maxLength={3}
                  value={form.currency}
                  onChange={(event) => setForm({ ...form, currency: event.target.value })}
                  required
                />
              </label>
            </>
          ) : null}
          <label>
            Solde
            <input
              className="text-input"
              type="number"
              step="0.01"
              value={form.balance}
              onChange={(event) => setForm({ ...form, balance: event.target.value })}
              required
            />
          </label>
          {selected ? (
            <label>
              Date du solde
              <input
                className="text-input"
                type="date"
                value={form.date}
                onChange={(event) => setForm({ ...form, date: event.target.value })}
                required
              />
            </label>
          ) : null}
          <div className="form-actions">
            <button type="button" className="button secondary" onClick={() => setModal(null)}>
              Annuler
            </button>
            <button className="button primary" disabled={busy}>
              <Save size={15} />
              Enregistrer
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

function AccountTable({
  title,
  accounts,
  onEdit,
}: {
  title: string;
  accounts: FinancialAccount[];
  onEdit: (account: FinancialAccount) => void;
}) {
  return (
    <article className="panel">
      <div className="panel-header">
        <div>
          <span className="eyebrow">Actifs</span>
          <h2>{title}</h2>
        </div>
        <strong>
          <Currency value={accounts.reduce((sum, item) => sum + item.balance, 0)} />
        </strong>
      </div>
      <div className="account-list">
        {accounts.map((account) => (
          <button
            className="account-row account-button"
            key={account.id}
            onClick={() => onEdit(account)}
          >
            <span className="account-logo">{account.institution.slice(0, 2).toUpperCase()}</span>
            <div className="account-main">
              <strong>{account.name}</strong>
              <span>
                {account.institution} · {account.currency}
              </span>
            </div>
            <DataBadge kind={account.provenance.kind} />
            <strong className={`account-balance ${account.balance < 0 ? "negative-text" : ""}`}>
              <Currency value={account.balance} />
            </strong>
            <ChevronRight size={15} />
          </button>
        ))}
      </div>
    </article>
  );
}

export default NetWorthPage;

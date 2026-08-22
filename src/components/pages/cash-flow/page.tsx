"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  Callout,
  Currency,
  DataBadge,
  EmptyState,
  MetricCard,
  Modal,
  Percent,
  SectionHeader,
} from "@/components/ui";
import {
  type SectionProps,
  cashFlowExplanation,
  chartCurrency,
  inputNumber,
} from "@/components/pages/shared";

function CashFlowPage({ state, mutate, busy, setExplanation }: SectionProps) {
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState({
    accountId: state.accounts[0]?.id ?? "",
    categoryId: "exp_groceries",
    date: state.asOfDate,
    label: "",
    amount: "",
    updateBalance: true,
  });
  const chart = ["Mars", "Avr.", "Mai", "Juin", "Juil.", "Août"].map((month, index) => ({
    month,
    income: index === 5 ? state.metrics.monthlyIncome : 0,
    expense: index === 5 ? state.metrics.monthlyExpenses : 0,
  }));
  async function addTransaction(event: React.FormEvent) {
    event.preventDefault();
    const ok = await mutate({
      action: "add_transaction",
      accountId: form.accountId,
      categoryId: form.categoryId,
      date: form.date,
      label: form.label,
      amount: inputNumber(form.amount),
      updateBalance: form.updateBalance,
    });
    if (ok) {
      setModal(false);
      setForm({ ...form, label: "", amount: "" });
    }
  }
  return (
    <div className="page-stack">
      <SectionHeader
        eyebrow="Income & spending"
        title="Cash Flow"
        description="Les ratios restent provisoires tant que les catégories manquantes ne sont pas renseignées."
        actions={
          <button className="button primary" onClick={() => setModal(true)}>
            <Plus size={16} />
            Ajouter une transaction
          </button>
        }
      />
      <section className="metrics-grid four">
        <MetricCard
          label="Revenus actifs"
          value={<Currency value={state.metrics.monthlyIncome} />}
        />
        <MetricCard
          label="Dépenses connues"
          value={<Currency value={state.metrics.monthlyExpenses} />}
        />
        <MetricCard
          label="Free cash flow connu"
          value={<Currency value={state.metrics.freeCashFlow} sign />}
          tone={state.metrics.freeCashFlow >= 0 ? "positive" : "negative"}
          onExplain={() => setExplanation(cashFlowExplanation(state))}
        />
        <MetricCard
          label="Taux d’épargne provisoire"
          value={<Percent value={state.metrics.savingsRate} />}
          tone={state.metrics.savingsRate < 0 ? "negative" : "neutral"}
        />
      </section>
      <Callout tone="warning" title="Données partielles">
        {state.expenseCategories.filter((category) => category.monthlyAmount === null).length}{" "}
        catégories n’ont encore aucun montant. Aucun montant arbitraire n’est substitué.
      </Callout>
      <section className="two-column wide-left">
        <article className="panel chart-panel">
          <div className="panel-header">
            <div>
              <span className="eyebrow">Historique observé</span>
              <h2>Revenus et dépenses</h2>
            </div>
          </div>
          <div className="medium-chart">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chart}>
                <CartesianGrid vertical={false} stroke="var(--border-soft)" />
                <XAxis dataKey="month" axisLine={false} tickLine={false} />
                <YAxis tickFormatter={chartCurrency} axisLine={false} tickLine={false} />
                <Tooltip />
                <Bar dataKey="income" name="Revenus" fill="#39747a" radius={[4, 4, 0, 0]} />
                <Bar dataKey="expense" name="Dépenses" fill="#c6a765" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p className="muted-copy">Les mois sans données sont affichés à zéro, et non estimés.</p>
        </article>
        <article className="panel">
          <div className="panel-header">
            <div>
              <span className="eyebrow">Futur proche</span>
              <h2>Événements 365 jours</h2>
            </div>
          </div>
          <div className="timeline-mini">
            <div>
              <i />
              <span>
                <strong>5 déc. 2026</strong>
                <small>Première mensualité étudiant</small>
              </span>
              <b>−284,72 €</b>
            </div>
            <div className="muted">
              <i />
              <span>
                <strong>À dater</strong>
                <small>Revenu professeur de tennis</small>
              </span>
              <b>+130 €</b>
            </div>
            <div className="muted">
              <i />
              <span>
                <strong>À confirmer</strong>
                <small>CAF</small>
              </span>
              <b>—</b>
            </div>
          </div>
        </article>
      </section>
      <section className="panel">
        <div className="panel-header">
          <div>
            <span className="eyebrow">Budget confortable</span>
            <h2>Catégories mensuelles</h2>
          </div>
          <span className="panel-note">Cliquez pour renseigner</span>
        </div>
        <div className="category-grid">
          {state.expenseCategories
            .filter(
              (category) => category.groupName !== "Revenus" && category.groupName !== "Épargne",
            )
            .map((category) => (
              <label className="category-item" key={category.id}>
                <span>
                  <strong>{category.name}</strong>
                  <small>
                    {category.groupName} · {category.essential ? "Essentielle" : "Discrétionnaire"}
                  </small>
                </span>
                <div className="inline-amount">
                  <input
                    type="number"
                    min="0"
                    step="1"
                    placeholder="—"
                    defaultValue={category.monthlyAmount ?? ""}
                    onBlur={(event) => {
                      const next =
                        event.target.value === "" ? null : inputNumber(event.target.value);
                      if (next !== category.monthlyAmount)
                        void mutate({
                          action: "update_expense",
                          categoryId: category.id,
                          monthlyAmount: next,
                        });
                    }}
                  />
                  <span>€/mois</span>
                </div>
                <DataBadge kind={category.provenance.kind} />
              </label>
            ))}
        </div>
      </section>
      <section className="panel">
        <div className="panel-header">
          <div>
            <span className="eyebrow">Ledger</span>
            <h2>Transactions récentes</h2>
          </div>
        </div>
        {state.transactions.length ? (
          <div className="simple-table">
            <div className="table-head">
              <span>Date</span>
              <span>Libellé</span>
              <span>Catégorie</span>
              <span>Compte</span>
              <span>Montant</span>
            </div>
            {state.transactions.map((transaction) => (
              <div className="table-row" key={transaction.id}>
                <span>{new Date(transaction.date).toLocaleDateString("fr-FR")}</span>
                <strong>{transaction.label}</strong>
                <span>{transaction.categoryName}</span>
                <span>{transaction.accountName}</span>
                <strong className={transaction.amount < 0 ? "negative-text" : "positive-text"}>
                  <Currency value={transaction.amount} sign />
                </strong>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            title="Aucune transaction importée"
            detail="Ajoutez une première transaction manuelle ou importez un CSV dans une prochaine itération."
            action={
              <button className="button secondary" onClick={() => setModal(true)}>
                Ajouter la première
              </button>
            }
          />
        )}
      </section>
      <Modal
        open={modal}
        onClose={() => setModal(false)}
        title="Ajouter une transaction"
        subtitle="Une correction manuelle reste prioritaire sur toute future synchronisation"
      >
        <form className="form-grid" onSubmit={addTransaction}>
          <label>
            Compte
            <select
              className="text-input"
              value={form.accountId}
              onChange={(event) => setForm({ ...form, accountId: event.target.value })}
            >
              {state.accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Date
            <input
              className="text-input"
              type="date"
              value={form.date}
              onChange={(event) => setForm({ ...form, date: event.target.value })}
              required
            />
          </label>
          <label className="full">
            Libellé
            <input
              className="text-input"
              value={form.label}
              onChange={(event) => setForm({ ...form, label: event.target.value })}
              required
            />
          </label>
          <label>
            Catégorie
            <select
              className="text-input"
              value={form.categoryId}
              onChange={(event) => setForm({ ...form, categoryId: event.target.value })}
            >
              {state.expenseCategories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Montant signé
            <input
              className="text-input"
              type="number"
              step="0.01"
              value={form.amount}
              onChange={(event) => setForm({ ...form, amount: event.target.value })}
              placeholder="-45,20"
              required
            />
          </label>
          <label className="checkbox-row full">
            <input
              type="checkbox"
              checked={form.updateBalance}
              onChange={(event) => setForm({ ...form, updateBalance: event.target.checked })}
            />
            Répercuter ce mouvement sur le solde du compte
          </label>
          <div className="form-actions">
            <button type="button" className="button secondary" onClick={() => setModal(false)}>
              Annuler
            </button>
            <button className="button primary" disabled={busy}>
              Enregistrer
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

export default CashFlowPage;

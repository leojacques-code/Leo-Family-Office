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
  formatDate,
  inputNumber,
} from "@/components/pages/shared";
import { addMonths, monthBounds, upcomingDebtEvents } from "@/lib/engine/debt";
import { aggregateFlows, shouldDeriveBalance } from "@/lib/data/shared";

/** Lignes rendues dans la table. Les agrégats, eux, portent sur toute la fenêtre lue. */
const LEDGER_TABLE_ROWS = 50;

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
  // Agrégats mensuels construits depuis le ledger, jamais depuis les métriques courantes :
  // un mois sans transaction reste distinct d'un mois sans donnée.
  // Les flux sont classés par nature via leur catégorie, jamais par leur signe : un
  // versement vers le PEA sort du compte sans être une dépense de consommation.
  const months = Array.from({ length: 6 }, (_, index) => {
    const anchor = addMonths(state.asOfDate, index - 5);
    const { start, end } = monthBounds(anchor);
    const flows = aggregateFlows(state.transactions, state.expenseCategories, start, end);
    return { month: formatDate(start, { month: "short", year: "2-digit" }), ...flows };
  });
  const ledgerMonths = months.filter((month) => month.count > 0).length;
  const savingExcluded = months.reduce((sum, month) => sum + month.saving, 0);
  const latestBalanceDate =
    state.accounts.find((account) => account.id === form.accountId)?.balanceDate ?? state.asOfDate;
  // Un snapshot de solde postérieur contient déjà la transaction : le solde ne bouge pas.
  const canUpdateBalance = shouldDeriveBalance(form.date, latestBalanceDate);
  const futureEvents = upcomingDebtEvents(state.liabilities, state.asOfDate, 365);
  const undatedIncomes = state.incomes.filter((income) => !income.active);
  async function addTransaction(event: React.FormEvent) {
    event.preventDefault();
    const ok = await mutate({
      action: "add_transaction",
      accountId: form.accountId,
      categoryId: form.categoryId,
      date: form.date,
      label: form.label,
      amount: inputNumber(form.amount),
      updateBalance: canUpdateBalance && form.updateBalance,
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
          label="Taux d’épargne constaté"
          value={
            state.metrics.savingsRate === null ? (
              "Non calculable"
            ) : (
              <Percent value={state.metrics.savingsRate} />
            )
          }
          tone={
            state.metrics.savingsRate !== null && state.metrics.savingsRate < 0
              ? "negative"
              : "neutral"
          }
          detail={
            state.metrics.savingsRate === null
              ? "Aucun revenu encaissé observé au ledger sur le mois"
              : "Épargne constatée ÷ revenu encaissé"
          }
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
            <span className="panel-note">{state.transactions.length} transactions au ledger</span>
          </div>
          {ledgerMonths ? (
            <>
              <div className="medium-chart">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={months}>
                    <CartesianGrid vertical={false} stroke="var(--border-soft)" />
                    <XAxis dataKey="month" axisLine={false} tickLine={false} />
                    <YAxis tickFormatter={chartCurrency} axisLine={false} tickLine={false} />
                    <Tooltip />
                    <Bar dataKey="income" name="Revenus" fill="#39747a" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="expense" name="Dépenses" fill="#c6a765" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <p className="muted-copy">
                {ledgerMonths} mois sur 6 portent au moins une transaction. Les autres sont vides
                parce que le ledger ne contient rien, pas parce que le montant serait nul.
                {savingExcluded > 0 ? (
                  <>
                    {" "}
                    <Currency value={savingExcluded} /> d’épargne et d’investissement sont exclus
                    des dépenses de consommation.
                  </>
                ) : null}
              </p>
            </>
          ) : (
            <EmptyState
              title="Aucun historique au ledger"
              detail="Les six derniers mois ne contiennent aucune transaction. Aucun mois n’est affiché à zéro : l’absence de donnée n’est pas un montant nul."
              action={
                <button className="button secondary" onClick={() => setModal(true)}>
                  Ajouter une transaction
                </button>
              }
            />
          )}
        </article>
        <article className="panel">
          <div className="panel-header">
            <div>
              <span className="eyebrow">Futur proche</span>
              <h2>Événements 365 jours</h2>
            </div>
          </div>
          <div className="timeline-mini">
            {futureEvents.slice(0, 3).map((event) => (
              <div key={`${event.liability.id}-${event.entry.paymentNumber}`}>
                <i />
                <span>
                  <strong>
                    {formatDate(event.entry.dueDate, {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })}
                  </strong>
                  <small>
                    {event.isFirstPayment ? "Première mensualité" : "Mensualité"} ·{" "}
                    {event.liability.name}
                  </small>
                </span>
                <b>
                  −<Currency value={event.entry.totalCashOut} />
                </b>
              </div>
            ))}
            {undatedIncomes.map((income) => (
              <div className="muted" key={income.id}>
                <i />
                <span>
                  <strong>À dater</strong>
                  <small>{income.name}</small>
                </span>
                <b>
                  {income.monthlyNet === null ? (
                    "—"
                  ) : (
                    <>
                      +<Currency value={income.monthlyNet} />
                    </>
                  )}
                </b>
              </div>
            ))}
            {!futureEvents.length && !undatedIncomes.length ? (
              <p className="muted-copy">Aucun événement daté dans les 365 prochains jours.</p>
            ) : null}
          </div>
          <p className="muted-copy">
            Les échéances proviennent de l’échéancier dérivé des passifs. Un revenu sans date de
            début reste « À dater » et n’entre dans aucun agrégat.
          </p>
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
          <span className="panel-note">
            {state.transactions.length} sur la fenêtre de 6 mois
            {state.transactions.length > LEDGER_TABLE_ROWS
              ? ` · ${LEDGER_TABLE_ROWS} affichées`
              : ""}
          </span>
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
            {state.transactions.slice(0, LEDGER_TABLE_ROWS).map((transaction) => (
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
              checked={canUpdateBalance && form.updateBalance}
              disabled={!canUpdateBalance}
              onChange={(event) => setForm({ ...form, updateBalance: event.target.checked })}
            />
            Répercuter ce mouvement sur le solde du compte
          </label>
          {!canUpdateBalance ? (
            <p className="muted-copy full">
              Un solde plus récent existe déjà (au {formatDate(latestBalanceDate)} ) ; cette
              transaction sera ajoutée à l’historique sans modifier le solde actuel. Pour corriger
              le solde, utilisez la mise à jour de compte depuis Net Worth.
            </p>
          ) : null}
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

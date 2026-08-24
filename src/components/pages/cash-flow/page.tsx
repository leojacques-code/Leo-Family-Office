"use client";

import { useMemo, useState } from "react";
import { Plus, Repeat } from "lucide-react";
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
  formatEur,
  inputNumber,
} from "@/components/pages/shared";
import { addMonths, monthBounds } from "@/lib/engine/debt";
import { shouldDeriveBalance } from "@/lib/data/shared";
import {
  INTERNAL_TRANSFER_NOTICE,
  cashRunwayDays,
  compareBudgets,
  compareSurplusToScenario,
  computeObservedCashFlow,
  effectiveCashFlowKind,
  categoryIndex,
  forecastCashFlow,
  monthPeriod,
  trailingPeriod,
} from "@/lib/engine/cash-flow";
import { CASH_FLOW_KINDS, type CashFlowKind } from "@/lib/types";

/** Lignes rendues dans la table. Les agrégats, eux, portent sur toute la fenêtre lue. */
const LEDGER_TABLE_ROWS = 50;
const HORIZONS = [30, 90, 365];

const KIND_LABELS: Record<CashFlowKind, string> = {
  INCOME: "Revenu",
  EXPENSE: "Dépense",
  INTERNAL_TRANSFER: "Transfert interne",
  INVESTMENT: "Investissement",
  SAVING: "Épargne",
  DEBT_SERVICE: "Service de dette",
  TAX: "Impôt",
  REFUND: "Remboursement",
  OTHER_INFLOW: "Autre entrée",
  OTHER_OUTFLOW: "Autre sortie",
  UNCLASSIFIED: "À classer",
};

const QUALITY_LABELS = { COMPLETE: "Complet", PARTIAL: "Partiel", INCOMPLETE: "Incomplet" };

function CashFlowPage({ state, mutate, busy, setExplanation }: SectionProps) {
  const [modal, setModal] = useState<"transaction" | "rule" | "category" | null>(null);
  const [horizon, setHorizon] = useState(90);
  const [form, setForm] = useState({
    accountId: state.accounts[0]?.id ?? "",
    categoryId: "exp_groceries",
    date: state.asOfDate,
    label: "",
    amount: "",
    updateBalance: true,
  });
  const [ruleForm, setRuleForm] = useState({
    name: "",
    categoryId: state.expenseCategories[0]?.id ?? "",
    amount: "",
    frequency: "MONTHLY" as "MONTHLY" | "QUARTERLY" | "ANNUAL",
    startDate: state.asOfDate,
    dayOfMonth: "",
  });
  const [categoryForm, setCategoryForm] = useState({
    name: "",
    groupName: "Vie courante",
    cashFlowKind: "EXPENSE" as CashFlowKind,
    essentiality: "UNKNOWN" as "ESSENTIAL" | "NON_ESSENTIAL" | "UNKNOWN",
    behavior: "UNKNOWN" as "FIXED" | "VARIABLE" | "DISCRETIONARY" | "UNKNOWN",
  });

  const index = useMemo(() => categoryIndex(state.expenseCategories), [state.expenseCategories]);
  const month = monthPeriod(state.asOfDate);
  const observed = useMemo(
    () =>
      computeObservedCashFlow(state.transactions, state.expenseCategories, month.start, month.end),
    [state.transactions, state.expenseCategories, month.start, month.end],
  );
  const t3 = trailingPeriod(state.asOfDate, 3);
  const observedT3M = useMemo(
    () => computeObservedCashFlow(state.transactions, state.expenseCategories, t3.start, t3.end),
    [state.transactions, state.expenseCategories, t3.start, t3.end],
  );
  const central =
    state.scenarios.find((scenario) => scenario.name === "Central") ?? state.scenarios[0];
  const comparison = central
    ? compareSurplusToScenario(
        state.transactions,
        state.expenseCategories,
        state.asOfDate,
        central.monthlySavings,
      )
    : null;
  const forecast = useMemo(
    () =>
      forecastCashFlow({
        asOfDate: state.asOfDate,
        horizonDays: horizon,
        openingCash: state.metrics.bankCash,
        rules: state.recurringRules,
        liabilities: state.liabilities,
      }),
    [state.asOfDate, horizon, state.metrics.bankCash, state.recurringRules, state.liabilities],
  );
  const runway = cashRunwayDays(forecast);
  const budgetLines = useMemo(
    () =>
      compareBudgets(
        state.expenseCategories,
        state.transactions,
        month.start,
        month.end,
        forecast.occurrences,
      ),
    [state.expenseCategories, state.transactions, month.start, month.end, forecast.occurrences],
  );

  // Six mois d'historique, agrégés par nature et jamais par signe.
  const months = Array.from({ length: 6 }, (_, offset) => {
    const bounds = monthBounds(addMonths(state.asOfDate, offset - 5));
    const period = computeObservedCashFlow(
      state.transactions,
      state.expenseCategories,
      bounds.start,
      bounds.end,
    );
    return {
      month: formatDate(bounds.start, { month: "short", year: "2-digit" }),
      income: period.income,
      expense: period.consumerExpenses,
      debt: period.debtServicePaid,
      count: period.transactionCount,
    };
  });
  const ledgerMonths = months.filter((entry) => entry.count > 0).length;
  const currentMonthClose = state.cashFlowCloses.find(
    (close) => close.month === month.start.slice(0, 7),
  );

  async function addTransaction(event: React.FormEvent) {
    event.preventDefault();
    const account = state.accounts.find((item) => item.id === form.accountId);
    const canUpdate = shouldDeriveBalance(form.date, account?.balanceDate ?? state.asOfDate);
    const ok = await mutate({
      action: "add_transaction",
      accountId: form.accountId,
      categoryId: form.categoryId,
      date: form.date,
      label: form.label,
      amount: inputNumber(form.amount),
      updateBalance: canUpdate && form.updateBalance,
    });
    if (ok) {
      setModal(null);
      setForm({ ...form, label: "", amount: "" });
    }
  }

  async function addRule(event: React.FormEvent) {
    event.preventDefault();
    const category = index.get(ruleForm.categoryId);
    const ok = await mutate({
      action: "add_recurring_rule",
      name: ruleForm.name,
      cashFlowKind: category?.cashFlowKind ?? "EXPENSE",
      categoryId: ruleForm.categoryId,
      accountId: null,
      amount: inputNumber(ruleForm.amount),
      frequency: ruleForm.frequency,
      startDate: ruleForm.startDate,
      endDate: null,
      dayOfMonth: ruleForm.dayOfMonth ? inputNumber(ruleForm.dayOfMonth) : null,
    });
    if (ok) {
      setModal(null);
      setRuleForm({ ...ruleForm, name: "", amount: "" });
    }
  }

  async function addCategory(event: React.FormEvent) {
    event.preventDefault();
    const ok = await mutate({ action: "add_category", ...categoryForm });
    if (ok) {
      setModal(null);
      setCategoryForm({ ...categoryForm, name: "" });
    }
  }

  const selectedAccount = state.accounts.find((item) => item.id === form.accountId);
  const canUpdateBalance = shouldDeriveBalance(
    form.date,
    selectedAccount?.balanceDate ?? state.asOfDate,
  );

  return (
    <div className="page-stack">
      <SectionHeader
        eyebrow="Income & spending"
        title="Cash Flow"
        description="Ce que chaque euro signifie réellement : revenu, consommation, impôt, service de dette, allocation de capital ou simple déplacement entre poches."
        actions={
          <>
            <button className="button secondary" onClick={() => setModal("rule")}>
              <Repeat size={15} />
              Règle récurrente
            </button>
            <button className="button primary" onClick={() => setModal("transaction")}>
              <Plus size={16} />
              Ajouter une transaction
            </button>
          </>
        }
      />
      <section className="metrics-grid four">
        <MetricCard
          label="Revenus observés"
          value={<Currency value={observed.income} />}
          detail={`Mois en cours · ${QUALITY_LABELS[observed.dataQuality.status]}`}
        />
        <MetricCard
          label="Dépenses de consommation"
          value={<Currency value={observed.consumerExpenses} />}
          detail="Hors transferts, investissements et service de dette"
        />
        <MetricCard
          label="Surplus avant service de dette"
          value={<Currency value={observed.operatingCashFlowBeforeDebt} sign />}
          tone={observed.operatingCashFlowBeforeDebt >= 0 ? "positive" : "negative"}
          onExplain={() => setExplanation(cashFlowExplanation(state))}
        />
        <MetricCard
          label="Surplus après service de dette"
          value={<Currency value={observed.cashFlowAfterDebt} sign />}
          tone={observed.cashFlowAfterDebt >= 0 ? "positive" : "negative"}
          detail={
            <>
              Service de dette payé <Currency value={observed.debtServicePaid} />
            </>
          }
        />
      </section>
      {observed.dataQuality.status !== "COMPLETE" ? (
        <Callout
          tone="warning"
          title={`Qualité des données : ${QUALITY_LABELS[observed.dataQuality.status]}`}
        >
          {observed.dataQuality.reasons.join(" · ")}. Les agrégats portent sur ce qui est réellement
          classifié, sans substitution.
        </Callout>
      ) : null}
      <section className="two-column wide-left">
        <article className="panel chart-panel">
          <div className="panel-header">
            <div>
              <span className="eyebrow">Historique observé</span>
              <h2>Revenus, consommation et dette</h2>
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
                    <Tooltip formatter={(value) => formatEur(Number(value))} />
                    <Bar dataKey="income" name="Revenus" fill="#39747a" radius={[4, 4, 0, 0]} />
                    <Bar
                      dataKey="expense"
                      name="Consommation"
                      fill="#c6a765"
                      radius={[4, 4, 0, 0]}
                    />
                    <Bar
                      dataKey="debt"
                      name="Service de dette"
                      fill="#ab5a4e"
                      radius={[4, 4, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <p className="muted-copy">
                {ledgerMonths} mois sur 6 portent au moins une transaction.{" "}
                {INTERNAL_TRANSFER_NOTICE}{" "}
                {observed.internalTransferVolume > 0 ? (
                  <>
                    <Currency value={observed.internalTransferVolume} /> déplacés ce mois-ci entre
                    vos poches.
                  </>
                ) : null}
              </p>
            </>
          ) : (
            <EmptyState
              title="Aucun historique au ledger"
              detail="Les six derniers mois ne contiennent aucune transaction. Aucun mois n’est affiché à zéro : l’absence de donnée n’est pas un montant nul."
              action={
                <button className="button secondary" onClick={() => setModal("transaction")}>
                  Ajouter une transaction
                </button>
              }
            />
          )}
        </article>
        <article className="panel loan-facts">
          <div className="panel-header">
            <div>
              <span className="eyebrow">Structure des dépenses</span>
              <h2>Mois en cours</h2>
            </div>
          </div>
          <dl>
            <div>
              <dt>Essentielles</dt>
              <dd>
                <Currency value={observed.breakdown.essential} />
              </dd>
            </div>
            <div>
              <dt>Non essentielles</dt>
              <dd>
                <Currency value={observed.breakdown.nonEssential} />
              </dd>
            </div>
            <div>
              <dt>Fixes</dt>
              <dd>
                <Currency value={observed.fixedExpenses} />
              </dd>
            </div>
            <div>
              <dt>Variables</dt>
              <dd>
                <Currency value={observed.variableExpenses} />
              </dd>
            </div>
            <div>
              <dt>Discrétionnaires</dt>
              <dd>
                <Currency value={observed.discretionaryExpenses} />
              </dd>
            </div>
            <div>
              <dt>Non qualifiées</dt>
              <dd>
                <Currency value={observed.breakdown.unknownEssentiality} />
              </dd>
            </div>
          </dl>
        </article>
      </section>
      <section className="panel">
        <div className="panel-header">
          <div>
            <span className="eyebrow">Prévision de trésorerie</span>
            <h2>Horizon {horizon} jours</h2>
          </div>
          <div className="decision-case-strip">
            {HORIZONS.map((days) => (
              <button
                key={days}
                className={days === horizon ? "active" : ""}
                onClick={() => setHorizon(days)}
              >
                {days} j
              </button>
            ))}
          </div>
        </div>
        <div className="percentile-cards">
          <div>
            <span>Trésorerie projetée</span>
            <strong>
              <Currency value={forecast.forecastEndingCash} />
            </strong>
            <small>
              Départ <Currency value={forecast.openingCash} /> · net{" "}
              <Currency value={forecast.forecastNetCashFlow} sign />
            </small>
          </div>
          <div>
            <span>Point bas</span>
            <strong>
              <Currency value={forecast.minimumProjectedCash} />
            </strong>
            <small>
              Le {formatDate(forecast.minimumProjectedCashDate)}
              {runway !== null ? ` · trésorerie négative dans ${runway} jours` : ""}
            </small>
          </div>
          <div>
            <span>Service de dette prévu</span>
            <strong>
              <Currency value={forecast.forecastDebtService} />
            </strong>
            <small>Échéancier du Debt Engine, aucun second calcul</small>
          </div>
        </div>
        <p className="muted-copy">
          Seuls les flux explicitement déclarés entrent dans la prévision :{" "}
          {state.recurringRules.length} règle(s) récurrente(s) et les échéances de dette. Aucune
          dépense variable n’est extrapolée, aucun revenu futur n’est supposé, aucune inflation
          n’est appliquée.
        </p>
      </section>
      <section className="panel">
        <div className="panel-header">
          <div>
            <span className="eyebrow">Flux récurrents</span>
            <h2>{state.recurringRules.length} règles déclarées</h2>
          </div>
          <button className="link-button" onClick={() => setModal("rule")}>
            Ajouter une règle
          </button>
        </div>
        {state.recurringRules.length ? (
          <div className="simple-table">
            <div className="table-head">
              <span>Règle</span>
              <span>Nature</span>
              <span>Fréquence</span>
              <span>Depuis</span>
              <span>Montant</span>
            </div>
            {state.recurringRules.map((rule) => (
              <div className="table-row" key={rule.id}>
                <span>{rule.name}</span>
                <strong>{KIND_LABELS[rule.cashFlowKind]}</strong>
                <span>
                  {rule.frequency === "MONTHLY"
                    ? "Mensuelle"
                    : rule.frequency === "QUARTERLY"
                      ? "Trimestrielle"
                      : "Annuelle"}
                </span>
                <span>{formatDate(rule.startDate)}</span>
                <strong className={rule.amount < 0 ? "negative-text" : "positive-text"}>
                  <Currency value={rule.amount} sign />
                </strong>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            title="Aucune règle récurrente"
            detail="Aucune récurrence n’est déduite automatiquement d’un historique. Déclarez un loyer, un abonnement ou un salaire pour alimenter la prévision."
          />
        )}
      </section>
      {comparison ? (
        <section className="panel">
          <div className="panel-header">
            <div>
              <span className="eyebrow">Hypothèse de scénario vs réalité observée</span>
              <h2>Surplus avant service de dette</h2>
            </div>
          </div>
          <dl className="loan-facts">
            <div>
              <dt>Hypothèse du scénario {central?.name}</dt>
              <dd>
                <Currency value={comparison.scenarioAssumption} /> par mois
              </dd>
            </div>
            <div>
              <dt>Mois en cours à date</dt>
              <dd>
                <Currency value={comparison.monthToDate} sign /> ·{" "}
                {QUALITY_LABELS[comparison.monthToDateQuality]}
              </dd>
            </div>
            <div>
              <dt>Moyenne mensuelle sur 3 mois glissants</dt>
              <dd>
                {comparison.observedT3M === null ? (
                  <span className="warning-text">
                    Historique insuffisant · {comparison.coverageT3M.coveredMonths} mois couverts
                    sur {comparison.coverageT3M.requestedMonths}
                  </span>
                ) : (
                  <>
                    <Currency value={comparison.observedT3M} /> ·{" "}
                    <Currency value={comparison.differenceT3M ?? 0} sign />
                  </>
                )}
              </dd>
            </div>
            <div>
              <dt>Moyenne mensuelle sur 12 mois glissants</dt>
              <dd>
                {comparison.observedT12M === null ? (
                  <span className="warning-text">
                    Historique insuffisant · {comparison.coverageT12M.coveredMonths} mois couverts
                    sur {comparison.coverageT12M.requestedMonths}
                  </span>
                ) : (
                  <>
                    <Currency value={comparison.observedT12M} /> ·{" "}
                    <Currency value={comparison.differenceT12M ?? 0} sign />
                  </>
                )}
              </dd>
            </div>
            <div>
              <dt>Historique disponible depuis</dt>
              <dd>
                {comparison.historyStart ? formatDate(comparison.historyStart) : "Aucun historique"}
              </dd>
            </div>
          </dl>
          <p className="muted-copy">
            Une hypothèse mensuelle ne se compare qu’à une moyenne mensuelle réellement calculable :
            tant qu’une fenêtre n’est pas couverte par l’historique, la comparaison reste impossible
            plutôt que d’attribuer zéro euro aux mois inconnus. Le mois en cours est partiel par
            nature et n’est jamais présenté comme une moyenne. L’hypothèse du scénario reste une
            MODEL_ASSUMPTION, jamais remplacée automatiquement.
          </p>
        </section>
      ) : null}
      <section className="panel">
        <div className="panel-header">
          <div>
            <span className="eyebrow">Budget vs réalisé vs prévision</span>
            <h2>Catégories de dépense</h2>
          </div>
          <button className="link-button" onClick={() => setModal("category")}>
            Ajouter une catégorie
          </button>
        </div>
        <div className="category-grid">
          {state.expenseCategories
            .filter((category) => category.cashFlowKind === "EXPENSE" && !category.archived)
            .map((category) => {
              const line = budgetLines.find((entry) => entry.categoryId === category.id);
              return (
                <label className="category-item" key={category.id}>
                  <span>
                    <strong>{category.name}</strong>
                    <small>
                      {category.groupName} ·{" "}
                      {category.essentiality === "ESSENTIAL"
                        ? "Essentielle"
                        : category.essentiality === "NON_ESSENTIAL"
                          ? "Non essentielle"
                          : "Essentialité inconnue"}{" "}
                      ·{" "}
                      {category.behavior === "FIXED"
                        ? "Fixe"
                        : category.behavior === "VARIABLE"
                          ? "Variable"
                          : category.behavior === "DISCRETIONARY"
                            ? "Discrétionnaire"
                            : "Comportement inconnu"}
                    </small>
                    <small>
                      Réalisé <Currency value={line?.actual ?? 0} />
                      {line?.variance !== null && line?.variance !== undefined ? (
                        <>
                          {" "}
                          · écart{" "}
                          <span className={line.overBudget ? "negative-text" : "positive-text"}>
                            <Currency value={line.variance} sign />
                          </span>
                        </>
                      ) : null}
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
                  <select
                    className="text-input"
                    value={category.essentiality}
                    onChange={(event) =>
                      void mutate({
                        action: "update_category",
                        categoryId: category.id,
                        patch: {
                          essentiality: event.target.value as (typeof categoryForm)["essentiality"],
                        },
                      })
                    }
                  >
                    <option value="ESSENTIAL">Essentielle</option>
                    <option value="NON_ESSENTIAL">Non essentielle</option>
                    <option value="UNKNOWN">Inconnue</option>
                  </select>
                  <select
                    className="text-input"
                    value={category.behavior}
                    onChange={(event) =>
                      void mutate({
                        action: "update_category",
                        categoryId: category.id,
                        patch: {
                          behavior: event.target.value as (typeof categoryForm)["behavior"],
                        },
                      })
                    }
                  >
                    <option value="FIXED">Fixe</option>
                    <option value="VARIABLE">Variable</option>
                    <option value="DISCRETIONARY">Discrétionnaire</option>
                    <option value="UNKNOWN">Inconnu</option>
                  </select>
                  <DataBadge kind={category.provenance.kind} />
                </label>
              );
            })}
        </div>
      </section>
      <section className="panel">
        <div className="panel-header">
          <div>
            <span className="eyebrow">Clôture Cash Flow</span>
            <h2>{month.start.slice(0, 7)}</h2>
          </div>
          <button
            className="button secondary"
            disabled={busy}
            onClick={() =>
              mutate({ action: "close_cash_flow_month", month: month.start.slice(0, 7) })
            }
          >
            {currentMonthClose ? "Créer une nouvelle version" : "Clôturer le mois"}
          </button>
        </div>
        {state.cashFlowCloses.length ? (
          <div className="simple-table">
            <div className="table-head">
              <span>Mois</span>
              <span>Version</span>
              <span>Surplus avant dette</span>
              <span>Après dette</span>
              <span>Non classées</span>
            </div>
            {state.cashFlowCloses.slice(0, 6).map((close) => (
              <div className="table-row" key={close.id}>
                <span>{close.month}</span>
                <strong>v{close.version}</strong>
                <span>
                  <Currency value={close.operatingSurplusBeforeDebt} sign />
                </span>
                <span>
                  <Currency value={close.postDebtSurplus} sign />
                </span>
                <strong>{close.unclassifiedTransactionCount}</strong>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            title="Aucune clôture Cash Flow"
            detail="Une clôture fige les agrégats du mois. Une clôture existante n’est jamais écrasée : une nouvelle version est créée et toutes restent consultables."
          />
        )}
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
          <div className="holdings-table">
            <div className="table-head">
              <span>Date</span>
              <span>Libellé</span>
              <span>Catégorie</span>
              <span>Nature</span>
              <span>Montant</span>
              <span>Reclasser</span>
            </div>
            {state.transactions.slice(0, LEDGER_TABLE_ROWS).map((transaction) => {
              const kind = effectiveCashFlowKind(transaction, index);
              const isTransfer = kind === "INTERNAL_TRANSFER";
              return (
                <div className={`table-row ${isTransfer ? "muted" : ""}`} key={transaction.id}>
                  <span>{formatDate(transaction.date)}</span>
                  <strong>{transaction.label}</strong>
                  <span>{transaction.categoryName}</span>
                  <span className={isTransfer ? "warning-text" : ""}>
                    {KIND_LABELS[kind]}
                    {transaction.kindOverride ? " (forcée)" : ""}
                  </span>
                  <strong className={transaction.amount < 0 ? "negative-text" : "positive-text"}>
                    <Currency value={transaction.amount} sign />
                  </strong>
                  <select
                    className="text-input"
                    value={transaction.kindOverride ?? ""}
                    onChange={(event) =>
                      void mutate({
                        action: "classify_transaction",
                        transactionId: transaction.id,
                        kindOverride:
                          event.target.value === "" ? null : (event.target.value as CashFlowKind),
                      })
                    }
                  >
                    <option value="">Nature de la catégorie</option>
                    {CASH_FLOW_KINDS.map((value) => (
                      <option key={value} value={value}>
                        {KIND_LABELS[value]}
                      </option>
                    ))}
                  </select>
                </div>
              );
            })}
          </div>
        ) : (
          <EmptyState
            title="Aucune transaction importée"
            detail="Ajoutez une première transaction manuelle ou importez un CSV dans une prochaine itération."
            action={
              <button className="button secondary" onClick={() => setModal("transaction")}>
                Ajouter la première
              </button>
            }
          />
        )}
        <p className="muted-copy">
          {INTERNAL_TRANSFER_NOTICE} Une transaction reclassée en transfert interne quitte
          immédiatement les dépenses de consommation sans modifier aucun solde.
        </p>
      </section>
      <Modal
        open={modal === "transaction"}
        onClose={() => setModal(null)}
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
                  {category.name} · {KIND_LABELS[category.cashFlowKind]}
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
              Un solde plus récent existe déjà (au{" "}
              {formatDate(selectedAccount?.balanceDate ?? state.asOfDate)}) ; cette transaction sera
              ajoutée à l’historique sans modifier le solde actuel.
            </p>
          ) : null}
          <div className="form-actions">
            <button type="button" className="button secondary" onClick={() => setModal(null)}>
              Annuler
            </button>
            <button className="button primary" disabled={busy}>
              Enregistrer
            </button>
          </div>
        </form>
      </Modal>
      <Modal
        open={modal === "rule"}
        onClose={() => setModal(null)}
        title="Nouvelle règle récurrente"
        subtitle="Aucune récurrence n’est jamais déduite automatiquement d’un historique"
      >
        <form className="form-grid" onSubmit={addRule}>
          <label className="full">
            Nom
            <input
              className="text-input"
              value={ruleForm.name}
              onChange={(event) => setRuleForm({ ...ruleForm, name: event.target.value })}
              required
            />
          </label>
          <label>
            Catégorie
            <select
              className="text-input"
              value={ruleForm.categoryId}
              onChange={(event) => setRuleForm({ ...ruleForm, categoryId: event.target.value })}
            >
              {state.expenseCategories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name} · {KIND_LABELS[category.cashFlowKind]}
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
              value={ruleForm.amount}
              onChange={(event) => setRuleForm({ ...ruleForm, amount: event.target.value })}
              placeholder="-1140"
              required
            />
          </label>
          <label>
            Fréquence
            <select
              className="text-input"
              value={ruleForm.frequency}
              onChange={(event) =>
                setRuleForm({
                  ...ruleForm,
                  frequency: event.target.value as typeof ruleForm.frequency,
                })
              }
            >
              <option value="MONTHLY">Mensuelle</option>
              <option value="QUARTERLY">Trimestrielle</option>
              <option value="ANNUAL">Annuelle</option>
            </select>
          </label>
          <label>
            Première échéance
            <input
              className="text-input"
              type="date"
              value={ruleForm.startDate}
              onChange={(event) => setRuleForm({ ...ruleForm, startDate: event.target.value })}
              required
            />
          </label>
          <label>
            Jour du mois
            <input
              className="text-input"
              type="number"
              min="1"
              max="31"
              placeholder="Jour de la première échéance"
              value={ruleForm.dayOfMonth}
              onChange={(event) => setRuleForm({ ...ruleForm, dayOfMonth: event.target.value })}
            />
          </label>
          <div className="form-actions">
            <button type="button" className="button secondary" onClick={() => setModal(null)}>
              Annuler
            </button>
            <button className="button primary" disabled={busy}>
              Créer la règle
            </button>
          </div>
        </form>
      </Modal>
      <Modal
        open={modal === "category"}
        onClose={() => setModal(null)}
        title="Nouvelle catégorie"
        subtitle="La nature canonique pilote les calculs ; le libellé reste libre"
      >
        <form className="form-grid" onSubmit={addCategory}>
          <label>
            Nom
            <input
              className="text-input"
              value={categoryForm.name}
              onChange={(event) => setCategoryForm({ ...categoryForm, name: event.target.value })}
              required
            />
          </label>
          <label>
            Groupe
            <input
              className="text-input"
              value={categoryForm.groupName}
              onChange={(event) =>
                setCategoryForm({ ...categoryForm, groupName: event.target.value })
              }
              required
            />
          </label>
          <label>
            Nature du flux
            <select
              className="text-input"
              value={categoryForm.cashFlowKind}
              onChange={(event) =>
                setCategoryForm({
                  ...categoryForm,
                  cashFlowKind: event.target.value as CashFlowKind,
                })
              }
            >
              {CASH_FLOW_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {KIND_LABELS[kind]}
                </option>
              ))}
            </select>
          </label>
          <label>
            Essentialité
            <select
              className="text-input"
              value={categoryForm.essentiality}
              onChange={(event) =>
                setCategoryForm({
                  ...categoryForm,
                  essentiality: event.target.value as typeof categoryForm.essentiality,
                })
              }
            >
              <option value="ESSENTIAL">Essentielle</option>
              <option value="NON_ESSENTIAL">Non essentielle</option>
              <option value="UNKNOWN">Inconnue</option>
            </select>
          </label>
          <label>
            Comportement
            <select
              className="text-input"
              value={categoryForm.behavior}
              onChange={(event) =>
                setCategoryForm({
                  ...categoryForm,
                  behavior: event.target.value as typeof categoryForm.behavior,
                })
              }
            >
              <option value="FIXED">Fixe</option>
              <option value="VARIABLE">Variable</option>
              <option value="DISCRETIONARY">Discrétionnaire</option>
              <option value="UNKNOWN">Inconnu</option>
            </select>
          </label>
          <div className="form-actions">
            <button type="button" className="button secondary" onClick={() => setModal(null)}>
              Annuler
            </button>
            <button className="button primary" disabled={busy}>
              Créer la catégorie
            </button>
          </div>
        </form>
      </Modal>
      <Callout title="Taux constatés">
        Taux d’épargne observé{" "}
        {observed.observedSavingsRate === null ? (
          "non calculable"
        ) : (
          <Percent value={observed.observedSavingsRate} />
        )}{" "}
        · moyenne mensuelle T3M{" "}
        {observedT3M.monthlyAverageOperatingSurplus === null ? (
          <span className="warning-text">non calculable, historique insuffisant</span>
        ) : (
          <Currency value={observedT3M.monthlyAverageOperatingSurplus} />
        )}
        . Sans revenu encaissé observé, aucun taux n’est substitué ; sans historique couvrant la
        fenêtre, aucune moyenne n’est fabriquée.
      </Callout>
    </div>
  );
}

export default CashFlowPage;

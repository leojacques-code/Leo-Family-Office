"use client";

import { useMemo, useState } from "react";
import { Plus, Save } from "lucide-react";
import type { FinancialAccount } from "@/lib/types";
import { Callout, Currency, EmptyState, Modal, Percent } from "@/components/ui";
import { canonicalBalanceSheetOf } from "@/lib/engine/balance-sheet-view";
import { buildNetWorthView, type NetWorthBlock } from "@/lib/presentation/net-worth-view";
import { BalanceCanvas } from "@/components/pages/net-worth/balance-canvas";
import {
  AccountTable,
  ConversionNotice,
  NOT_COMPUTABLE,
  type SectionProps,
  assetsExplanation,
  canonicalLineInput,
  canonicalLineLabel,
  formatEur,
  issueSummary,
  netWorthExplanation,
  requiredNumberInput,
} from "@/components/pages/shared";

/**
 * POSTE DE TRAVAIL PATRIMOINE, phase 4A.
 *
 * La zone C ne rend plus la composition que le §29 de V10 fait échouer — un second en-tête,
 * une grille de quatre cartes de KPI, deux tables. Elle rend une équation spatiale :
 * `ACTIFS − DETTES = PATRIMOINE NET`, avec les cinq familles du §21, dont l'immobilier et les
 * sociétés détenues que l'ancienne page omettait alors que le bilan canonique les portait.
 *
 * LE SECOND EN-TÊTE DISPARAÎT. La zone A du poste de travail porte déjà le titre, la question,
 * la date d'arrêté, le sélecteur Réel/Simulation et l'action primaire. Le `SectionHeader` de
 * cette page les doublait, et son titre « Net Worth » était en anglais dans une interface dont
 * le §11 exige qu'elle soit entièrement française.
 *
 * AUCUNE FORMULE FINANCIÈRE ICI. Tout vient de `buildNetWorthView`, qui compose les vérités
 * canoniques. Ce composant sélectionne, clique et met en forme.
 */

function NetWorthPage({ state, mutate, busy, setExplanation }: SectionProps) {
  const [modal, setModal] = useState<"add" | "edit" | null>(null);
  const [selected, setSelected] = useState<FinancialAccount | null>(null);
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [form, setForm] = useState({
    institution: "",
    name: "",
    accountType: "BANK" as FinancialAccount["type"],
    balance: "",
    currency: "EUR",
    date: state.asOfDate,
  });
  // Vérité unique de l'écran : le bilan canonique et le modèle de lecture qui le groupe.
  // Aucun solde natif n'est resommé localement, aucune conversion refaite.
  const view = useMemo(() => buildNetWorthView(state), [state]);
  const sheet = useMemo(() => canonicalBalanceSheetOf(state), [state]);
  const bank = state.accounts.filter((item) => item.type === "BANK" || item.type === "SAVINGS");
  const investments = state.accounts.filter((item) => item.type === "PEA" || item.type === "CTO");

  /**
   * Sélection d'une famille : l'inspecteur reçoit ses lignes, avec provenance et date.
   *
   * Le §21 demande « accès par actif à la source et au domaine propriétaire », et le §4.4 de
   * V10 borne l'inspecteur à quatre à six faits visibles. Les lignes y vont telles que le
   * bilan les porte : montant natif ET converti quand la devise diffère, jamais un montant
   * étranger affiché avec un symbole de la devise de reporting.
   */
  function inspectBlock(block: NetWorthBlock) {
    setSelectedBlockId(block.id);
    setExplanation({
      title: block.label,
      formula:
        block.side === "ASSET"
          ? "Σ contributions d’actif de la famille, converties à la date de valorisation"
          : "Σ encours de passif du groupe, convertis à la date de valorisation",
      inputs: [
        ...block.lines.map((line) => canonicalLineInput(state, line)),
        {
          label: `Total ${block.label.toLowerCase()}`,
          value:
            block.aggregate.value === null
              ? `${NOT_COMPUTABLE} · ${issueSummary(block.aggregate.blockers)}`
              : formatEur(block.aggregate.value),
          kind: "DERIVED" as const,
          date: view.asOfDate,
        },
      ],
      note: `Domaine propriétaire : ${block.ownerDomain}. ${
        block.share === null
          ? "La part de cette famille n’est pas calculable tant que le total de son côté ne l’est pas."
          : `Cette famille pèse ${Math.round(block.share * 100)} % de son côté du bilan.`
      }${
        block.unknownLineCount > 0
          ? ` ${block.unknownLineCount} ligne(s) sans montant convertible : leur hauteur n’est pas mesurée, elle ne vaut pas zéro.`
          : ""
      }`,
    });
  }

  function inspectLiabilitiesTotal() {
    setSelectedBlockId("TOTAL_LIABILITIES");
    setExplanation({
      title: "Total des dettes",
      formula: "Σ encours de dette observés + découverts de compte, convertis",
      inputs: [
        ...sheet.contributions
          .filter((line) => line.side === "LIABILITY" && line.isAccountingPrimary)
          .map((line) => canonicalLineInput(state, line)),
        {
          label: "Total",
          value:
            view.totalLiabilities.value === null
              ? `${NOT_COMPUTABLE} · ${issueSummary(view.totalLiabilities.blockers)}`
              : formatEur(view.totalLiabilities.value),
          kind: "DERIVED" as const,
          date: view.asOfDate,
        },
      ],
      note: "La dette d’une société détenue réduit son Equity Value et n’entre jamais au passif personnel. Aucune ligne de passif immobilier n’est produite par le domaine immobilier : elle doublerait celle des dettes.",
    });
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    // Le solde est LU avant d'être envoyé, et un refus de lecture arrête la soumission.
    // Le helper de saisie rendait `Number("")`, donc `0` : un solde effacé partait à zéro
    // et écrasait la vérité du compte sans laisser aucune trace.
    const balance = requiredNumberInput(form.balance, "Solde");
    if (balance.error !== null) {
      setFormError(balance.error);
      return;
    }
    setFormError(null);
    const ok = selected
      ? await mutate({
          action: "update_account",
          accountId: selected.id,
          balance: balance.value,
          balanceDate: form.date,
        })
      : await mutate({
          action: "add_account",
          institution: form.institution,
          name: form.name,
          accountType: form.accountType,
          balance: balance.value,
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

  function openCreate() {
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
  }

  const accountForm = (
    <Modal
      onClose={() => setModal(null)}
      open={Boolean(modal)}
      subtitle="Toute nouvelle valeur conserve un historique daté"
      title={selected ? `Mettre à jour ${selected.name}` : "Ajouter un compte"}
    >
      <form className="form-grid" onSubmit={save}>
        {formError ? (
          <p className="form-error full" role="alert">
            {formError}
          </p>
        ) : null}
        {!selected ? (
          <>
            <label>
              Institution
              <input
                className="text-input"
                onChange={(event) => setForm({ ...form, institution: event.target.value })}
                required
                value={form.institution}
              />
            </label>
            <label>
              Nom du compte
              <input
                className="text-input"
                onChange={(event) => setForm({ ...form, name: event.target.value })}
                required
                value={form.name}
              />
            </label>
            <label>
              Type
              <select
                className="text-input"
                onChange={(event) =>
                  setForm({ ...form, accountType: event.target.value as FinancialAccount["type"] })
                }
                value={form.accountType}
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
                onChange={(event) => setForm({ ...form, currency: event.target.value })}
                required
                value={form.currency}
              />
            </label>
          </>
        ) : null}
        <label>
          Solde
          <input
            className="text-input"
            onChange={(event) => setForm({ ...form, balance: event.target.value })}
            required
            step="0.01"
            type="number"
            value={form.balance}
          />
        </label>
        {selected ? (
          <label>
            Date du solde
            <input
              className="text-input"
              onChange={(event) => setForm({ ...form, date: event.target.value })}
              required
              type="date"
              value={form.date}
            />
          </label>
        ) : null}
        <div className="form-actions">
          <button className="button secondary" onClick={() => setModal(null)} type="button">
            Annuler
          </button>
          <button className="button primary" disabled={busy}>
            <Save size={15} />
            Enregistrer
          </button>
        </div>
      </form>
    </Modal>
  );

  if (view.isEmpty) {
    return (
      <>
        <EmptyState
          action={
            <button className="button primary" onClick={openCreate}>
              <Plus size={15} /> Ajouter un actif ou un passif
            </button>
          }
          detail="Déclarez un compte, un bien ou une dette pour obtenir votre bilan. Une absence de saisie n’est pas une absence de patrimoine."
          title="Aucun actif ni passif déclaré"
        />
        {accountForm}
      </>
    );
  }

  return (
    <div className="page-stack">
      <BalanceCanvas
        onSelectAssets={() => {
          setSelectedBlockId("GROSS_ASSETS");
          setExplanation(assetsExplanation(state));
        }}
        onSelectBlock={inspectBlock}
        onSelectLiabilities={inspectLiabilitiesTotal}
        onSelectNetWorth={() => {
          setSelectedBlockId("NET_WORTH");
          setExplanation(netWorthExplanation(state));
        }}
        selectedId={selectedBlockId}
        view={view}
      />

      <Callout title="Périmètre identifié">
        Ce bilan inclut uniquement les actifs et dettes déclarés. Il ne prétend pas représenter un
        patrimoine économique exhaustif.
      </Callout>

      <ConversionNotice sheet={sheet} state={state} />

      {/* §28 de V10 : les tables, formulaires et enregistrements vivent derrière « Analyse
          détaillée ». Ils restent atteignables, ils ne sont plus la première impression. */}
      <details className="nw-details">
        <summary>Analyse détaillée</summary>
        <div className="two-column">
          <AccountTable
            accounts={bank}
            onEdit={edit}
            sheet={sheet}
            state={state}
            title="Cash bancaire"
          />
          <AccountTable
            accounts={investments}
            onEdit={edit}
            sheet={sheet}
            state={state}
            title="Investissements"
          />
        </div>
        {view.liabilities.length > 0 ? (
          <table className="nw-table">
            <caption>Passifs identifiés, encours convertis</caption>
            <thead>
              <tr>
                <th>Ligne</th>
                <th>Groupe</th>
                <th>Date de valeur</th>
                <th>Encours</th>
              </tr>
            </thead>
            <tbody>
              {view.liabilities.flatMap((block) =>
                block.lines.map((line) => (
                  <tr key={line.id}>
                    <td>{canonicalLineLabel(state, line)}</td>
                    <td>{block.label}</td>
                    <td>{line.valuationDate}</td>
                    <td className="negative-text">
                      {line.reportingValue === null ? (
                        <span title={issueSummary(line.valuationBlockers ?? line.fx.flags)}>
                          {NOT_COMPUTABLE}
                        </span>
                      ) : (
                        <>
                          −<Currency value={line.reportingValue} />
                        </>
                      )}
                    </td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
        ) : null}
        <p className="nw-note">
          Part liquide des actifs bruts :{" "}
          {view.liquidShareOfGrossAssets.value === null ? (
            <span title={issueSummary(view.liquidShareOfGrossAssets.blockers)}>
              {NOT_COMPUTABLE}
            </span>
          ) : (
            <Percent value={view.liquidShareOfGrossAssets.value} />
          )}
          . Concentration du plus gros compte :{" "}
          {view.largestAccountConcentration.value === null ? (
            <span title={issueSummary(view.largestAccountConcentration.blockers)}>
              {NOT_COMPUTABLE}
            </span>
          ) : (
            <Percent value={view.largestAccountConcentration.value} />
          )}
          .
        </p>
      </details>

      {accountForm}
    </div>
  );
}

export default NetWorthPage;

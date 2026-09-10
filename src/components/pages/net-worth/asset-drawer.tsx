"use client";

import { useState, type FormEvent } from "react";
import { Save } from "lucide-react";
import { FinancialDrawer } from "@/components/workstation/financial-drawer";
import { MoneyInput } from "@/components/primitives/money-input";
import { DateInput } from "@/components/primitives/date-input";
import type { FinancialAccount } from "@/lib/types";

/**
 * TIROIR D'ACTIF DU POSTE DE TRAVAIL PATRIMOINE.
 *
 * Le §7 de V10 sort les formulaires du canvas : « forms do not occupy the main canvas », et un
 * clic sur « Ajouter » ou sur un élément éditable ouvre un tiroir. Le §29 fait d'ailleurs échouer
 * un domaine dont « forms occupy the main first view ».
 *
 * AUCUN ZÉRO FABRIQUÉ. Le solde passe par `MoneyInput`, primitive de la phase 0 : un champ vide
 * reste vide, une saisie illisible reste affichée, et un zéro DÉCLARÉ est distingué des deux. Le
 * formulaire précédent utilisait un `<input type="number">` et `requiredNumberInput`, qui
 * refusait bien le vide mais laissait le navigateur refuser la virgule et modifier la valeur à la
 * molette de souris au survol.
 *
 * LA DATE N'EST PAS PRÉREMPLIE à la date d'arrêté. La section 18.3 l'interdit : une date par
 * défaut ferait passer la date du jour pour une date de valeur déclarée, ce qui est le même
 * mensonge qu'un montant prérempli à zéro. Elle est donc obligatoire et vide à l'ouverture.
 *
 * À LA CRÉATION, LA DATE N'EST PAS DEMANDÉE, parce qu'elle ne serait pas transmise : la mutation
 * `add_account` ne porte pas de date de solde et la RPC date l'observation au jour opérationnel
 * du serveur. Demander une date pour la jeter serait pire que ne pas la demander — l'utilisateur
 * croirait avoir déclaré une date d'observation. Le tiroir le DIT, et l'extension de la mutation
 * appartient à une phase qui touche le schéma. Une mise à jour, elle, porte bien sa date.
 */

export interface AssetDraft {
  institution: string;
  name: string;
  accountType: FinancialAccount["type"];
  currency: string;
  balance: number;
  /**
   * Date de l'observation, `null` à la création.
   *
   * `add_account` ne la transporte pas : la RPC date le solde au jour opérationnel du serveur.
   * Le champ n'est donc pas demandé à la création, et cette valeur ne prétend pas l'être.
   */
  balanceDate: string | null;
}

const TYPE_LABELS: Record<FinancialAccount["type"], string> = {
  BANK: "Compte bancaire",
  SAVINGS: "Épargne",
  PEA: "PEA",
  CTO: "CTO",
  OTHER: "Autre",
};

export function AssetDrawer({
  open,
  account,
  reportingCurrency,
  maxDate,
  busy,
  onClose,
  onSubmit,
}: {
  open: boolean;
  /** Compte existant à mettre à jour, ou `null` pour une création. */
  account: FinancialAccount | null;
  reportingCurrency: string;
  /** Borne haute des dates de valeur : un solde observé n'est pas daté dans le futur. */
  maxDate: string;
  busy: boolean;
  onClose: () => void;
  onSubmit: (draft: AssetDraft) => Promise<boolean>;
}) {
  const [institution, setInstitution] = useState(account?.institution ?? "");
  const [name, setName] = useState(account?.name ?? "");
  const [accountType, setAccountType] = useState<FinancialAccount["type"]>(account?.type ?? "BANK");
  const [currency, setCurrency] = useState(account?.currency ?? reportingCurrency);
  // Une mise à jour n'hérite PAS du solde connu : la valeur saisie est une NOUVELLE
  // observation, et préremplir l'ancienne invite à la revalider sans l'avoir lue.
  const [balance, setBalance] = useState<number | null>(null);
  // L'ÉTAT de la lecture, pas seulement sa valeur : « vide » et « illisible » rendent tous
  // deux `null`, et un message qui les confond dit « champ vide » sur une saisie visible.
  const [balanceState, setBalanceState] = useState<"EMPTY" | "INVALID" | "VALID">("EMPTY");
  const [balanceDate, setBalanceDate] = useState<string | null>(null);
  // La date n'est demandée QUE là où elle est transmise, c'est-à-dire sur une mise à jour.
  const datesObservation = account !== null;
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (balance === null) {
      setError(
        balanceState === "INVALID"
          ? // La primitive affiche déjà le détail du refus au niveau du champ. Ce message dit
            // la CONSÉQUENCE : rien n'est enregistré, et surtout pas un zéro de repli.
            "Le solde saisi n’est pas lisible : il n’est pas interprété comme zéro."
          : "Le solde observé est obligatoire. Un champ vide n’est pas un solde nul.",
      );
      return;
    }
    if (datesObservation && balanceDate === null) {
      setError("La date du solde est obligatoire : une observation sans date n’est pas datable.");
      return;
    }
    if (!/^[A-Za-z]{3}$/.test(currency)) {
      setError("La devise s’écrit en trois lettres, par exemple EUR.");
      return;
    }
    setError(null);
    if (
      await onSubmit({
        institution: institution.trim(),
        name: name.trim(),
        accountType,
        currency: currency.toUpperCase(),
        balance,
        balanceDate,
      })
    ) {
      onClose();
    }
  }

  return (
    <FinancialDrawer
      onClose={onClose}
      open={open}
      subtitle={
        account
          ? "Une nouvelle valeur s’ajoute à l’historique, elle ne remplace pas la précédente"
          : "Un solde négatif devient un découvert au passif, il ne réduit pas les actifs bruts"
      }
      title={account ? `Mettre à jour ${account.name}` : "Ajouter un actif"}
    >
      <form className="form-grid" onSubmit={submit}>
        {account ? null : (
          <>
            <label>
              Établissement
              <input
                className="text-input"
                onChange={(event) => setInstitution(event.target.value)}
                required
                value={institution}
              />
            </label>
            <label>
              Nom du compte
              <input
                className="text-input"
                onChange={(event) => setName(event.target.value)}
                required
                value={name}
              />
            </label>
            <label>
              Type
              <select
                className="text-input"
                onChange={(event) => setAccountType(event.target.value as FinancialAccount["type"])}
                value={accountType}
              >
                {Object.entries(TYPE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Devise
              <input
                className="text-input"
                maxLength={3}
                onChange={(event) => setCurrency(event.target.value)}
                required
                value={currency}
              />
            </label>
          </>
        )}
        <MoneyInput
          currency={account?.currency ?? currency.toUpperCase()}
          hint="Le solde tel que le relevé l’affiche, signe compris"
          id="nw-asset-balance"
          label="Solde observé"
          onChange={(draft) => {
            setBalanceState(draft.state);
            setBalance(draft.state === "VALID" ? draft.value : null);
          }}
          required
          value={balance}
        />
        {datesObservation ? (
          <DateInput
            hint="Date à laquelle ce solde a été constaté"
            id="nw-asset-balance-date"
            label="Date du solde"
            max={maxDate}
            onChange={(draft) => setBalanceDate(draft.state === "VALID" ? draft.value : null)}
            required
            value={balanceDate}
          />
        ) : (
          <p className="nw-note full">
            Ce premier solde sera daté du jour d’enregistrement. Pour déclarer une date
            d’observation différente, enregistrez le compte puis mettez son solde à jour.
          </p>
        )}
        {error ? (
          <p className="form-error full" role="alert">
            {error}
          </p>
        ) : null}
        <div className="form-actions">
          <button className="button secondary" onClick={onClose} type="button">
            Annuler
          </button>
          <button className="button primary" disabled={busy}>
            <Save size={15} />
            {account ? "Enregistrer l’observation" : "Enregistrer l’actif"}
          </button>
        </div>
      </form>
    </FinancialDrawer>
  );
}

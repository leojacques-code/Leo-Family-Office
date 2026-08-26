"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";

import type { Mutation } from "@/lib/data/contracts";
import type {
  BusinessCapitalEvent,
  BusinessEbitdaAdjustment,
  BusinessEntity,
  BusinessEquityPosition,
  BusinessFinancialSnapshot,
  BusinessValuationBasis,
} from "@/lib/engine/business-equity";
import {
  BUSINESS_BRIDGE_ITEM_CATEGORIES,
  BUSINESS_CAPITAL_EVENT_TYPES,
  BUSINESS_CAPITAL_HISTORY_SOURCES,
  BUSINESS_EBITDA_ADJUSTMENT_CATEGORIES,
  BUSINESS_PERIOD_KINDS,
  BUSINESS_TYPES,
} from "@/lib/engine/business-equity";
import {
  BUSINESS_ADJUSTMENT_CATEGORY_LABELS,
  BUSINESS_AMOUNT_SCOPE_LABELS,
  BUSINESS_BRIDGE_CATEGORY_LABELS,
  BUSINESS_CAPITAL_EVENT_LABELS,
  BUSINESS_COVERAGE_LABELS,
  BUSINESS_PERIOD_KIND_LABELS,
  BUSINESS_TYPE_LABELS,
} from "@/lib/engine/business-equity-explain";
import { fundingRoundOutcome } from "@/lib/engine/business-ownership";
import { formatMoney } from "@/components/pages/business-equity/display";

export type Mutate = (mutation: Mutation) => Promise<boolean>;

/**
 * FORMULAIRES BUSINESS EQUITY
 *
 * Deux principes gouvernent chaque champ de ce fichier.
 *
 * UN CHAMP VIDE EST UN INCONNU. Il n'est jamais converti en zéro. Les libellés le disent à
 * l'endroit où l'ambiguïté coûte cher — trésorerie et dette brute d'abord, parce que c'est
 * là qu'un zéro supposé fabrique de la valeur qui n'existe pas.
 *
 * ON NE DEMANDE JAMAIS UN RÉSULTAT. Aucun formulaire de méthode dérivée ne propose de
 * saisir une Enterprise Value ou une Equity Value : ce sont des sorties. Les deux seuls
 * chemins qui les acceptent sont ceux où le montant est réellement OBSERVÉ hors du modèle,
 * et ils sont nommés comme tels.
 */

export function optionalNumber(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed.replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

export function optionalRate(value: string): number | null {
  const parsed = optionalNumber(value);
  return parsed === null ? null : parsed / 100;
}

const nullableText = (value: string): string | null => (value.trim() ? value.trim() : null);

function FormActions({
  busy,
  label,
  disabled,
  onCancel,
}: {
  busy: boolean;
  label: string;
  disabled?: boolean;
  onCancel?: () => void;
}) {
  return (
    <div className="form-actions">
      {onCancel ? (
        <button type="button" className="button" onClick={onCancel}>
          Annuler
        </button>
      ) : null}
      <button className="button primary" disabled={busy || disabled}>
        {label}
      </button>
    </div>
  );
}

/** Note posée sous un champ dont le vide a un sens économique. */
function UnknownHint({ children }: { children: React.ReactNode }) {
  return <small className="field-hint">{children}</small>;
}

// ─── Démarrage rapide ───────────────────────────────────────────────────────────────────

/**
 * MODE SIMPLE. Sept faits suffisent au moteur pour produire une valorisation complète,
 * son pont et sa fourchette. L'utilisateur ne saisit à aucun moment une Enterprise Value
 * ni une Equity Value : il déclare ce qu'il sait, le moteur fait le reste.
 *
 * Les quatre écritures qui en découlent — société, détention, période, base de
 * valorisation — partent en UNE mutation atomique : une société créée sans détention ni
 * base serait un patrimoine non calculable fabriqué par le produit lui-même.
 */
export function QuickStartForm({
  asOfDate,
  busy,
  mutate,
  onDone,
}: {
  asOfDate: string;
  busy: boolean;
  mutate: Mutate;
  onDone: () => void;
}) {
  const defaultPeriod = `${Number(asOfDate.slice(0, 4)) - 1}-12-31`;
  const [name, setName] = useState("");
  const [legalForm, setLegalForm] = useState("SAS");
  const [type, setType] = useState<(typeof BUSINESS_TYPES)[number]>("OPERATING");
  const [currency, setCurrency] = useState("EUR");
  const [periodEnd, setPeriodEnd] = useState(defaultPeriod);
  const [revenue, setRevenue] = useState("");
  const [ebitda, setEbitda] = useState("");
  const [cash, setCash] = useState("");
  const [grossDebt, setGrossDebt] = useState("");
  const [ownershipRate, setOwnershipRate] = useState("100");
  const [method, setMethod] = useState<"EBITDA_MULTIPLE" | "REVENUE_MULTIPLE">("EBITDA_MULTIPLE");
  const [multiple, setMultiple] = useState("6");
  const [multipleLow, setMultipleLow] = useState("");
  const [multipleHigh, setMultipleHigh] = useState("");
  const [historyComplete, setHistoryComplete] = useState(false);
  const [historyStart, setHistoryStart] = useState("");

  const metricValue =
    method === "EBITDA_MULTIPLE" ? optionalNumber(ebitda) : optionalNumber(revenue);
  const centralMultiple = optionalNumber(multiple);
  const preview =
    metricValue !== null &&
    centralMultiple !== null &&
    optionalNumber(cash) !== null &&
    optionalNumber(grossDebt) !== null
      ? metricValue * centralMultiple - optionalNumber(grossDebt)! + optionalNumber(cash)!
      : null;

  return (
    <form
      className="input-sections"
      onSubmit={async (event) => {
        event.preventDefault();
        const rate = optionalRate(ownershipRate);
        if (rate === null || centralMultiple === null) return;
        const ok = await mutate({
          action: "create_business_quick_start",
          quickStart: {
            name: name.trim(),
            legalForm: nullableText(legalForm),
            type,
            currency: currency.toUpperCase(),
            sector: null,
            country: null,
            periodEnd,
            periodKind: "ANNUAL",
            periodLabel: `FY${periodEnd.slice(0, 4)}`,
            revenue: optionalNumber(revenue),
            ebitda: optionalNumber(ebitda),
            cash: optionalNumber(cash),
            grossDebt: optionalNumber(grossDebt),
            legalRate: rate,
            economicRate: rate,
            valuationDate: asOfDate,
            method,
            multiple: centralMultiple,
            multipleLow: optionalNumber(multipleLow),
            multipleHigh: optionalNumber(multipleHigh),
            capitalHistoryStart: historyComplete ? historyStart || null : null,
            capitalHistorySource: historyComplete ? "DECLARED_COMPLETE" : "UNKNOWN",
            notes: null,
          },
        });
        if (ok) onDone();
      }}
    >
      <h3>Identité</h3>
      <div className="mini-form-grid">
        <label>
          Nom
          <input
            className="text-input"
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
          />
        </label>
        <label>
          Forme juridique
          <input
            className="text-input"
            value={legalForm}
            onChange={(event) => setLegalForm(event.target.value)}
          />
        </label>
        <label>
          Nature
          <select value={type} onChange={(event) => setType(event.target.value as typeof type)}>
            {BUSINESS_TYPES.map((option) => (
              <option key={option} value={option}>
                {BUSINESS_TYPE_LABELS[option]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Devise
          <input
            className="text-input"
            value={currency}
            maxLength={3}
            onChange={(event) => setCurrency(event.target.value.toUpperCase())}
          />
        </label>
      </div>

      <h3>Dernier exercice connu</h3>
      <div className="mini-form-grid">
        <label>
          Clôture
          <input
            type="date"
            className="text-input"
            max={asOfDate}
            value={periodEnd}
            onChange={(event) => setPeriodEnd(event.target.value)}
          />
        </label>
        <label>
          Chiffre d’affaires
          <input
            className="text-input"
            value={revenue}
            onChange={(event) => setRevenue(event.target.value)}
            inputMode="decimal"
          />
        </label>
        <label>
          EBITDA
          <input
            className="text-input"
            value={ebitda}
            onChange={(event) => setEbitda(event.target.value)}
            inputMode="decimal"
          />
        </label>
        <label>
          Trésorerie
          <input
            className="text-input"
            value={cash}
            onChange={(event) => setCash(event.target.value)}
            inputMode="decimal"
          />
          <UnknownHint>
            Vide = inconnu. Saisir 0 seulement si la trésorerie est réellement nulle.
          </UnknownHint>
        </label>
        <label>
          Dette brute corporate
          <input
            className="text-input"
            value={grossDebt}
            onChange={(event) => setGrossDebt(event.target.value)}
            inputMode="decimal"
          />
          <UnknownHint>
            Vide = inconnu, et la valeur restera non calculable. Une dette réellement nulle se
            déclare avec un 0.
          </UnknownHint>
        </label>
      </div>

      <h3>Détention et méthode</h3>
      <div className="mini-form-grid">
        <label>
          Détention économique
          <div className="suffix-input">
            <input
              className="text-input"
              value={ownershipRate}
              onChange={(event) => setOwnershipRate(event.target.value)}
              inputMode="decimal"
            />
            <span>%</span>
          </div>
        </label>
        <label>
          Méthode
          <select
            value={method}
            onChange={(event) => setMethod(event.target.value as typeof method)}
          >
            <option value="EBITDA_MULTIPLE">Multiple d’EBITDA</option>
            <option value="REVENUE_MULTIPLE">Multiple de chiffre d’affaires</option>
          </select>
        </label>
        <label>
          Multiple central
          <div className="suffix-input">
            <input
              className="text-input"
              value={multiple}
              onChange={(event) => setMultiple(event.target.value)}
              inputMode="decimal"
              required
            />
            <span>×</span>
          </div>
        </label>
        <label>
          Multiple bas
          <input
            className="text-input"
            value={multipleLow}
            onChange={(event) => setMultipleLow(event.target.value)}
            inputMode="decimal"
          />
          <UnknownHint>Facultatif. Une fourchette est plus honnête qu’un point unique.</UnknownHint>
        </label>
        <label>
          Multiple haut
          <input
            className="text-input"
            value={multipleHigh}
            onChange={(event) => setMultipleHigh(event.target.value)}
            inputMode="decimal"
          />
        </label>
      </div>

      <details className="debt-advanced">
        <summary>Historique de capital</summary>
        <div className="checkbox-row">
          <input
            id="quick-history"
            type="checkbox"
            checked={historyComplete}
            onChange={(event) => setHistoryComplete(event.target.checked)}
          />
          <label htmlFor="quick-history">
            Je déclare l’historique des apports et distributions complet à partir d’une date
          </label>
        </div>
        {historyComplete ? (
          <label>
            Complet depuis le
            <input
              type="date"
              className="text-input"
              max={asOfDate}
              value={historyStart}
              onChange={(event) => setHistoryStart(event.target.value)}
              required
            />
          </label>
        ) : (
          <UnknownHint>
            Sans cette déclaration, MOIC, XIRR et plus-value resteront non calculables : ils
            seraient faux sur un historique partiel.
          </UnknownHint>
        )}
      </details>

      {preview !== null ? (
        <p className="form-notice">
          Equity Value dérivée à ce stade : {formatMoney(preview, currency.toUpperCase())}. Le
          moteur la recalculera à la lecture, avec sa fourchette et son pont complet.
        </p>
      ) : (
        <p className="form-notice">
          La valeur sera dérivée dès que l’agrégat retenu, la trésorerie et la dette brute seront
          déclarés. Aucune Enterprise Value ne vous sera jamais demandée.
        </p>
      )}
      <FormActions
        busy={busy}
        label="Créer et valoriser"
        disabled={!name.trim() || centralMultiple === null}
        onCancel={onDone}
      />
    </form>
  );
}

// ─── Identité ───────────────────────────────────────────────────────────────────────────

export function IdentityForm({
  business,
  asOfDate,
  busy,
  mutate,
  onDone,
}: {
  business: BusinessEntity;
  asOfDate: string;
  busy: boolean;
  mutate: Mutate;
  onDone: () => void;
}) {
  const [name, setName] = useState(business.name);
  const [legalForm, setLegalForm] = useState(business.legalForm ?? "");
  const [type, setType] = useState(business.type ?? "OPERATING");
  const [currency, setCurrency] = useState(business.functionalCurrency ?? "EUR");
  const [sector, setSector] = useState(business.sector ?? "");
  const [country, setCountry] = useState(business.country ?? "");
  const [foundedOn, setFoundedOn] = useState(business.foundedOn ?? "");
  const [coverage, setCoverage] = useState(business.capitalHistorySource);
  const [coverageStart, setCoverageStart] = useState(business.capitalHistoryStart ?? "");
  const [notes, setNotes] = useState(business.notes ?? "");

  return (
    <form
      className="input-sections"
      onSubmit={async (event) => {
        event.preventDefault();
        const ok = await mutate({
          action: "save_business",
          business: {
            businessId: business.id,
            name: name.trim(),
            legalForm: nullableText(legalForm),
            type,
            functionalCurrency: nullableText(currency)?.toUpperCase() ?? null,
            sector: nullableText(sector),
            country: nullableText(country)?.toUpperCase() ?? null,
            foundedOn: nullableText(foundedOn),
            capitalHistoryStart: nullableText(coverageStart),
            capitalHistorySource: coverage,
            notes: nullableText(notes),
          },
        });
        if (ok) onDone();
      }}
    >
      <h3>Identité</h3>
      <div className="mini-form-grid">
        <label>
          Nom
          <input
            className="text-input"
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
          />
        </label>
        <label>
          Forme juridique
          <input
            className="text-input"
            value={legalForm}
            onChange={(event) => setLegalForm(event.target.value)}
          />
        </label>
        <label>
          Nature
          <select value={type} onChange={(event) => setType(event.target.value as typeof type)}>
            {BUSINESS_TYPES.map((option) => (
              <option key={option} value={option}>
                {BUSINESS_TYPE_LABELS[option]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Devise fonctionnelle
          <input
            className="text-input"
            maxLength={3}
            value={currency}
            onChange={(event) => setCurrency(event.target.value.toUpperCase())}
          />
        </label>
        <label>
          Secteur
          <input
            className="text-input"
            value={sector}
            onChange={(event) => setSector(event.target.value)}
          />
        </label>
        <label>
          Pays
          <input
            className="text-input"
            maxLength={2}
            value={country}
            onChange={(event) => setCountry(event.target.value.toUpperCase())}
          />
        </label>
        <label>
          Création
          <input
            type="date"
            className="text-input"
            max={asOfDate}
            value={foundedOn}
            onChange={(event) => setFoundedOn(event.target.value)}
          />
        </label>
      </div>

      <h3>Couverture de l’historique de capital</h3>
      <div className="mini-form-grid">
        <label>
          Déclaration
          <select
            value={coverage}
            onChange={(event) => setCoverage(event.target.value as typeof coverage)}
          >
            {BUSINESS_CAPITAL_HISTORY_SOURCES.map((option) => (
              <option key={option} value={option}>
                {BUSINESS_COVERAGE_LABELS[option]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Complet depuis le
          <input
            type="date"
            className="text-input"
            max={asOfDate}
            value={coverageStart}
            onChange={(event) => setCoverageStart(event.target.value)}
            required={coverage === "DECLARED_COMPLETE"}
          />
        </label>
      </div>
      <UnknownHint>
        Seule une couverture déclarée complète autorise le moteur à lire une absence d’événement
        comme un zéro, et donc à produire un MOIC, un XIRR et une plus-value.
      </UnknownHint>

      <label className="full">
        Notes
        <textarea
          className="text-input debt-textarea"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
        />
      </label>
      <FormActions busy={busy} label="Enregistrer" onCancel={onDone} />
    </form>
  );
}

// ─── Détention ──────────────────────────────────────────────────────────────────────────

export function OwnershipForm({
  businessId,
  asOfDate,
  busy,
  mutate,
  onDone,
}: {
  businessId: string;
  asOfDate: string;
  busy: boolean;
  mutate: Mutate;
  onDone: () => void;
}) {
  const [effectiveDate, setEffectiveDate] = useState(asOfDate);
  const [legalRate, setLegalRate] = useState("100");
  const [differentEconomic, setDifferentEconomic] = useState(false);
  const [economicRate, setEconomicRate] = useState("");
  const [votingRate, setVotingRate] = useState("");
  const [fullyDilutedRate, setFullyDilutedRate] = useState("");
  const [sharesHeld, setSharesHeld] = useState("");
  const [sharesOutstanding, setSharesOutstanding] = useState("");
  const [fullyDilutedShares, setFullyDilutedShares] = useState("");
  const [shareClass, setShareClass] = useState("");

  const legal = optionalRate(legalRate);
  return (
    <form
      className="input-sections"
      onSubmit={async (event) => {
        event.preventDefault();
        if (legal === null) return;
        const ok = await mutate({
          action: "record_business_ownership",
          ownership: {
            businessId,
            effectiveDate,
            legalRate: legal,
            economicRate: differentEconomic ? optionalRate(economicRate) : legal,
            votingRate: optionalRate(votingRate),
            fullyDilutedRate: optionalRate(fullyDilutedRate),
            sharesHeld: optionalNumber(sharesHeld),
            sharesOutstanding: optionalNumber(sharesOutstanding),
            fullyDilutedShares: optionalNumber(fullyDilutedShares),
            shareClass: nullableText(shareClass),
            notes: null,
          },
        });
        if (ok) onDone();
      }}
    >
      <h3>Détention à une date</h3>
      <div className="mini-form-grid">
        <label>
          Date d’effet
          <input
            type="date"
            className="text-input"
            max={asOfDate}
            value={effectiveDate}
            onChange={(event) => setEffectiveDate(event.target.value)}
          />
        </label>
        <label>
          Détention juridique
          <div className="suffix-input">
            <input
              className="text-input"
              value={legalRate}
              onChange={(event) => setLegalRate(event.target.value)}
              inputMode="decimal"
            />
            <span>%</span>
          </div>
          <UnknownHint>
            0 % est un fait : c’est une sortie totale, pas une absence de donnée.
          </UnknownHint>
        </label>
      </div>
      <div className="checkbox-row">
        <input
          id="different-economic"
          type="checkbox"
          checked={differentEconomic}
          onChange={(event) => setDifferentEconomic(event.target.checked)}
        />
        <label htmlFor="different-economic">
          Les droits économiques diffèrent de la détention juridique (actions de préférence,
          répartition contractuelle)
        </label>
      </div>
      {differentEconomic ? (
        <div className="mini-form-grid">
          <label>
            Droits économiques
            <div className="suffix-input">
              <input
                className="text-input"
                value={economicRate}
                onChange={(event) => setEconomicRate(event.target.value)}
                inputMode="decimal"
              />
              <span>%</span>
            </div>
            <UnknownHint>
              Laisser vide rendra la valeur personnelle non calculable : la détention juridique ne
              peut pas en tenir lieu.
            </UnknownHint>
          </label>
        </div>
      ) : null}

      <details className="debt-advanced">
        <summary>Cap table détaillée</summary>
        <div className="mini-form-grid">
          <label>
            Droits de vote
            <div className="suffix-input">
              <input
                className="text-input"
                value={votingRate}
                onChange={(event) => setVotingRate(event.target.value)}
                inputMode="decimal"
              />
              <span>%</span>
            </div>
          </label>
          <label>
            Pleinement dilué
            <div className="suffix-input">
              <input
                className="text-input"
                value={fullyDilutedRate}
                onChange={(event) => setFullyDilutedRate(event.target.value)}
                inputMode="decimal"
              />
              <span>%</span>
            </div>
          </label>
          <label>
            Titres détenus
            <input
              className="text-input"
              value={sharesHeld}
              onChange={(event) => setSharesHeld(event.target.value)}
              inputMode="decimal"
            />
          </label>
          <label>
            Titres en circulation
            <input
              className="text-input"
              value={sharesOutstanding}
              onChange={(event) => setSharesOutstanding(event.target.value)}
              inputMode="decimal"
            />
          </label>
          <label>
            Titres pleinement dilués
            <input
              className="text-input"
              value={fullyDilutedShares}
              onChange={(event) => setFullyDilutedShares(event.target.value)}
              inputMode="decimal"
            />
          </label>
          <label>
            Catégorie de titres
            <input
              className="text-input"
              value={shareClass}
              onChange={(event) => setShareClass(event.target.value)}
            />
          </label>
        </div>
        <UnknownHint>
          Quand les titres sont connus, le moteur en dérive le taux et signale toute contradiction
          avec le taux déclaré plutôt que d’arbitrer en silence.
        </UnknownHint>
      </details>
      <FormActions
        busy={busy}
        label="Enregistrer la détention"
        disabled={legal === null}
        onCancel={onDone}
      />
    </form>
  );
}

// ─── Période financière ─────────────────────────────────────────────────────────────────

export function FinancialPeriodForm({
  businessId,
  currency,
  asOfDate,
  existing,
  busy,
  mutate,
  onDone,
}: {
  businessId: string;
  currency: string;
  asOfDate: string;
  existing: BusinessFinancialSnapshot | null;
  busy: boolean;
  mutate: Mutate;
  onDone: () => void;
}) {
  const number = (value: number | null) => (value === null ? "" : String(value));
  const [periodEnd, setPeriodEnd] = useState(
    existing?.periodEnd ?? `${Number(asOfDate.slice(0, 4)) - 1}-12-31`,
  );
  const [periodKind, setPeriodKind] = useState(existing?.periodKind ?? "ANNUAL");
  const [periodLabel, setPeriodLabel] = useState(existing?.periodLabel ?? "");
  const [periodStart, setPeriodStart] = useState(existing?.periodStart ?? "");
  const [revenue, setRevenue] = useState(number(existing?.revenue ?? null));
  const [grossProfit, setGrossProfit] = useState(number(existing?.grossProfit ?? null));
  const [ebitda, setEbitda] = useState(number(existing?.ebitda ?? null));
  const [ebit, setEbit] = useState(number(existing?.ebit ?? null));
  const [netIncome, setNetIncome] = useState(number(existing?.netIncome ?? null));
  const [cash, setCash] = useState(number(existing?.cash ?? null));
  const [grossDebt, setGrossDebt] = useState(number(existing?.grossDebt ?? null));
  const [workingCapital, setWorkingCapital] = useState(number(existing?.workingCapital ?? null));
  const [capex, setCapex] = useState(number(existing?.capex ?? null));
  const [da, setDa] = useState(number(existing?.depreciationAmortisation ?? null));
  const [interest, setInterest] = useState(number(existing?.interestExpense ?? null));
  const [tax, setTax] = useState(number(existing?.taxExpense ?? null));
  const [freeCashFlow, setFreeCashFlow] = useState(number(existing?.freeCashFlow ?? null));

  return (
    <form
      className="input-sections"
      onSubmit={async (event) => {
        event.preventDefault();
        const ok = await mutate({
          action: "record_business_financials",
          financials: {
            businessId,
            periodEnd,
            periodStart: nullableText(periodStart),
            periodKind,
            periodLabel: nullableText(periodLabel),
            currency,
            revenue: optionalNumber(revenue),
            grossProfit: optionalNumber(grossProfit),
            ebitda: optionalNumber(ebitda),
            ebit: optionalNumber(ebit),
            netIncome: optionalNumber(netIncome),
            cash: optionalNumber(cash),
            grossDebt: optionalNumber(grossDebt),
            workingCapital: optionalNumber(workingCapital),
            capex: optionalNumber(capex),
            depreciationAmortisation: optionalNumber(da),
            interestExpense: optionalNumber(interest),
            taxExpense: optionalNumber(tax),
            freeCashFlow: optionalNumber(freeCashFlow),
            notes: null,
          },
        });
        if (ok) onDone();
      }}
    >
      <h3>Période</h3>
      <div className="mini-form-grid">
        <label>
          Clôture
          <input
            type="date"
            className="text-input"
            max={asOfDate}
            value={periodEnd}
            onChange={(event) => setPeriodEnd(event.target.value)}
            required
          />
        </label>
        <label>
          Nature
          <select
            value={periodKind}
            onChange={(event) => setPeriodKind(event.target.value as typeof periodKind)}
          >
            {BUSINESS_PERIOD_KINDS.map((option) => (
              <option key={option} value={option}>
                {BUSINESS_PERIOD_KIND_LABELS[option]}
              </option>
            ))}
          </select>
          <UnknownHint>
            Un exercice et un cumul glissant ne se comparent jamais entre eux.
          </UnknownHint>
        </label>
        <label>
          Libellé
          <input
            className="text-input"
            value={periodLabel}
            onChange={(event) => setPeriodLabel(event.target.value)}
            placeholder="FY2025"
          />
        </label>
      </div>

      <h3>Exploitation</h3>
      <div className="mini-form-grid">
        <label>
          Chiffre d’affaires
          <input
            className="text-input"
            value={revenue}
            onChange={(event) => setRevenue(event.target.value)}
            inputMode="decimal"
          />
        </label>
        <label>
          EBITDA
          <input
            className="text-input"
            value={ebitda}
            onChange={(event) => setEbitda(event.target.value)}
            inputMode="decimal"
          />
        </label>
        <label>
          Trésorerie
          <input
            className="text-input"
            value={cash}
            onChange={(event) => setCash(event.target.value)}
            inputMode="decimal"
          />
          <UnknownHint>Vide = inconnu.</UnknownHint>
        </label>
        <label>
          Dette brute corporate
          <input
            className="text-input"
            value={grossDebt}
            onChange={(event) => setGrossDebt(event.target.value)}
            inputMode="decimal"
          />
          <UnknownHint>
            Vide = inconnu. 0 uniquement si la société est réellement sans dette.
          </UnknownHint>
        </label>
      </div>

      <details className="debt-advanced">
        <summary>Compte de résultat et flux détaillés</summary>
        <div className="mini-form-grid">
          <label>
            Marge brute
            <input
              className="text-input"
              value={grossProfit}
              onChange={(event) => setGrossProfit(event.target.value)}
              inputMode="decimal"
            />
          </label>
          <label>
            Résultat d’exploitation
            <input
              className="text-input"
              value={ebit}
              onChange={(event) => setEbit(event.target.value)}
              inputMode="decimal"
            />
          </label>
          <label>
            Résultat net
            <input
              className="text-input"
              value={netIncome}
              onChange={(event) => setNetIncome(event.target.value)}
              inputMode="decimal"
            />
          </label>
          <label>
            Amortissements
            <input
              className="text-input"
              value={da}
              onChange={(event) => setDa(event.target.value)}
              inputMode="decimal"
            />
          </label>
          <label>
            Charges d’intérêts
            <input
              className="text-input"
              value={interest}
              onChange={(event) => setInterest(event.target.value)}
              inputMode="decimal"
            />
          </label>
          <label>
            Impôt
            <input
              className="text-input"
              value={tax}
              onChange={(event) => setTax(event.target.value)}
              inputMode="decimal"
            />
          </label>
          <label>
            Besoin en fonds de roulement
            <input
              className="text-input"
              value={workingCapital}
              onChange={(event) => setWorkingCapital(event.target.value)}
              inputMode="decimal"
            />
          </label>
          <label>
            Capex
            <input
              className="text-input"
              value={capex}
              onChange={(event) => setCapex(event.target.value)}
              inputMode="decimal"
            />
          </label>
          <label>
            Free cash flow déclaré
            <input
              className="text-input"
              value={freeCashFlow}
              onChange={(event) => setFreeCashFlow(event.target.value)}
              inputMode="decimal"
            />
            <UnknownHint>
              À défaut, il sera dérivé de l’exploitation et signalé comme tel.
            </UnknownHint>
          </label>
          <label>
            Début de période
            <input
              type="date"
              className="text-input"
              max={asOfDate}
              value={periodStart}
              onChange={(event) => setPeriodStart(event.target.value)}
            />
          </label>
        </div>
      </details>
      <FormActions busy={busy} label="Enregistrer la période" onCancel={onDone} />
    </form>
  );
}

// ─── Base de valorisation ───────────────────────────────────────────────────────────────

const DERIVED_METHOD_OPTIONS = [
  { value: "EBITDA_MULTIPLE", label: "Multiple d’EBITDA" },
  { value: "REVENUE_MULTIPLE", label: "Multiple de chiffre d’affaires" },
  { value: "DCF", label: "Flux de trésorerie actualisés" },
] as const;

const OBSERVED_METHOD_OPTIONS = [
  { value: "TRANSACTION", label: "Transaction réelle" },
  { value: "EXTERNAL_APPRAISAL", label: "Expertise externe" },
  { value: "USER_ESTIMATE", label: "Montant déclaré (non dérivé)" },
] as const;

type ValuationMethodChoice =
  | (typeof DERIVED_METHOD_OPTIONS)[number]["value"]
  | (typeof OBSERVED_METHOD_OPTIONS)[number]["value"];

/**
 * Choix de la méthode et de SES HYPOTHÈSES.
 *
 * Le formulaire bascule entre deux mondes qui ne se mélangent jamais : une méthode dérivée
 * demande une base et un multiple, une valeur observée demande le montant réellement connu
 * et sa source. Aucun écran ne propose les deux à la fois, parce qu'aucune valorisation
 * n'est les deux à la fois.
 */
export function ValuationBasisForm({
  businessId,
  currency,
  asOfDate,
  periods,
  hasDcf,
  busy,
  mutate,
  onDone,
}: {
  businessId: string;
  currency: string;
  asOfDate: string;
  periods: BusinessFinancialSnapshot[];
  hasDcf: boolean;
  busy: boolean;
  mutate: Mutate;
  onDone: () => void;
}) {
  const [method, setMethod] = useState<ValuationMethodChoice>("EBITDA_MULTIPLE");
  const [valuationDate, setValuationDate] = useState(asOfDate);
  const [multiple, setMultiple] = useState("6");
  const [multipleLow, setMultipleLow] = useState("");
  const [multipleHigh, setMultipleHigh] = useState("");
  const [metricPeriodEnd, setMetricPeriodEnd] = useState(periods.at(-1)?.periodEnd ?? "");
  const [enterpriseValue, setEnterpriseValue] = useState("");
  const [equityValue, setEquityValue] = useState("");
  const [source, setSource] = useState("");
  const [notes, setNotes] = useState("");

  const isMultiple = method === "EBITDA_MULTIPLE" || method === "REVENUE_MULTIPLE";
  const isObserved =
    method === "TRANSACTION" || method === "EXTERNAL_APPRAISAL" || method === "USER_ESTIMATE";

  return (
    <form
      className="input-sections"
      onSubmit={async (event) => {
        event.preventDefault();
        const ok = await mutate({
          action: "record_business_valuation",
          valuation: {
            businessId,
            valuationDate,
            currency,
            method,
            enterpriseValue: isObserved ? optionalNumber(enterpriseValue) : null,
            equityValue: isObserved ? optionalNumber(equityValue) : null,
            multiple: isMultiple ? optionalNumber(multiple) : null,
            multipleLow: isMultiple ? optionalNumber(multipleLow) : null,
            multipleHigh: isMultiple ? optionalNumber(multipleHigh) : null,
            metricBasis:
              method === "REVENUE_MULTIPLE"
                ? "REVENUE"
                : method === "EBITDA_MULTIPLE"
                  ? "EBITDA"
                  : null,
            metricPeriodEnd: isMultiple ? nullableText(metricPeriodEnd) : null,
            preMoneyEquityValue: null,
            primaryNewMoney: null,
            secondaryAmount: null,
            investorContribution: null,
            preferredRightsKnown: null,
            source: nullableText(source),
            notes: nullableText(notes),
          },
        });
        if (ok) onDone();
      }}
    >
      <h3>Méthode</h3>
      <div className="mini-form-grid">
        <label>
          Approche
          <select
            value={method}
            onChange={(event) => setMethod(event.target.value as ValuationMethodChoice)}
          >
            <optgroup label="Dérivée par le moteur">
              {DERIVED_METHOD_OPTIONS.filter((option) => option.value !== "DCF" || hasDcf).map(
                (option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ),
              )}
            </optgroup>
            <optgroup label="Valeur observée ou déclarée">
              {OBSERVED_METHOD_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </optgroup>
          </select>
          {!hasDcf ? (
            <UnknownHint>
              Le DCF n’apparaît qu’une fois ses hypothèses saisies : une méthode sans hypothèses
              n’est pas une méthode.
            </UnknownHint>
          ) : null}
        </label>
        <label>
          Date de valorisation
          <input
            type="date"
            className="text-input"
            max={asOfDate}
            value={valuationDate}
            onChange={(event) => setValuationDate(event.target.value)}
          />
        </label>
      </div>

      {isMultiple ? (
        <>
          <h3>Hypothèses du multiple</h3>
          <div className="mini-form-grid">
            <label>
              Période de référence
              <select
                value={metricPeriodEnd}
                onChange={(event) => setMetricPeriodEnd(event.target.value)}
              >
                <option value="">La plus récente disponible</option>
                {periods.map((period) => (
                  <option key={period.id} value={period.periodEnd}>
                    {period.periodLabel ?? period.periodEnd}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Multiple central
              <div className="suffix-input">
                <input
                  className="text-input"
                  value={multiple}
                  onChange={(event) => setMultiple(event.target.value)}
                  inputMode="decimal"
                  required
                />
                <span>×</span>
              </div>
            </label>
            <label>
              Multiple bas
              <input
                className="text-input"
                value={multipleLow}
                onChange={(event) => setMultipleLow(event.target.value)}
                inputMode="decimal"
              />
            </label>
            <label>
              Multiple haut
              <input
                className="text-input"
                value={multipleHigh}
                onChange={(event) => setMultipleHigh(event.target.value)}
                inputMode="decimal"
              />
            </label>
          </div>
          <p className="form-notice">
            Le moteur applique ce multiple à l’agrégat ajusté de la période retenue, puis ponte vers
            l’Equity Value par la dette brute et la trésorerie. Ni l’Enterprise Value ni l’Equity
            Value ne se saisissent ici : elles sont des résultats.
          </p>
        </>
      ) : null}

      {method === "DCF" ? (
        <p className="form-notice">
          La valeur sera dérivée des hypothèses de DCF déclarées pour cette société : flux projetés,
          WACC, valeur terminale, puis pont vers l’Equity Value.
        </p>
      ) : null}

      {isObserved ? (
        <>
          <h3>Valeur observée</h3>
          <div className="mini-form-grid">
            <label>
              Enterprise Value
              <input
                className="text-input"
                value={enterpriseValue}
                onChange={(event) => setEnterpriseValue(event.target.value)}
                inputMode="decimal"
              />
              <UnknownHint>
                Si seule l’EV est connue, le pont vers l’Equity Value exigera une dette brute et une
                trésorerie datées.
              </UnknownHint>
            </label>
            <label>
              Equity Value
              <input
                className="text-input"
                value={equityValue}
                onChange={(event) => setEquityValue(event.target.value)}
                inputMode="decimal"
              />
            </label>
            <label>
              Source
              <input
                className="text-input"
                value={source}
                onChange={(event) => setSource(event.target.value)}
                placeholder="Lettre d’intention, rapport d’expertise…"
              />
            </label>
          </div>
          {method === "USER_ESTIMATE" ? (
            <p className="form-notice">
              Ce montant sera présenté comme une SAISIE, jamais comme une valorisation dérivée d’une
              méthode, et sa confiance restera faible.
            </p>
          ) : null}
        </>
      ) : null}

      <label className="full">
        Notes
        <textarea
          className="text-input debt-textarea"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
        />
      </label>
      <FormActions busy={busy} label="Enregistrer la base" onCancel={onDone} />
    </form>
  );
}

// ─── Ajustements d'EBITDA et éléments de bridge ─────────────────────────────────────────

export function EbitdaAdjustmentForm({
  businessId,
  currency,
  asOfDate,
  periods,
  busy,
  mutate,
  onDone,
}: {
  businessId: string;
  currency: string;
  asOfDate: string;
  periods: BusinessFinancialSnapshot[];
  busy: boolean;
  mutate: Mutate;
  onDone: () => void;
}) {
  const [periodEnd, setPeriodEnd] = useState(periods.at(-1)?.periodEnd ?? asOfDate);
  const [category, setCategory] =
    useState<(typeof BUSINESS_EBITDA_ADJUSTMENT_CATEGORIES)[number]>("OWNER_COMPENSATION");
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  const [recurring, setRecurring] = useState(false);
  const [source, setSource] = useState("");

  return (
    <form
      className="input-sections"
      onSubmit={async (event) => {
        event.preventDefault();
        const value = optionalNumber(amount);
        if (value === null) return;
        const ok = await mutate({
          action: "record_business_ebitda_adjustment",
          adjustment: {
            businessId,
            periodEnd,
            category,
            label: label.trim(),
            amount: value,
            currency,
            recurring,
            source: nullableText(source),
            notes: null,
          },
        });
        if (ok) onDone();
      }}
    >
      <div className="mini-form-grid">
        <label>
          Période retraitée
          <select value={periodEnd} onChange={(event) => setPeriodEnd(event.target.value)}>
            {periods.map((period) => (
              <option key={period.id} value={period.periodEnd}>
                {period.periodLabel ?? period.periodEnd}
              </option>
            ))}
          </select>
        </label>
        <label>
          Nature
          <select
            value={category}
            onChange={(event) => setCategory(event.target.value as typeof category)}
          >
            {BUSINESS_EBITDA_ADJUSTMENT_CATEGORIES.map((option) => (
              <option key={option} value={option}>
                {BUSINESS_ADJUSTMENT_CATEGORY_LABELS[option]}
              </option>
            ))}
          </select>
        </label>
        <label className="full">
          Libellé
          <input
            className="text-input"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            required
          />
        </label>
        <label>
          Montant signé
          <input
            className="text-input"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            inputMode="decimal"
            required
          />
          <UnknownHint>Positif : augmente l’EBITDA retenu. Négatif : le réduit.</UnknownHint>
        </label>
        <label>
          Source
          <input
            className="text-input"
            value={source}
            onChange={(event) => setSource(event.target.value)}
          />
        </label>
      </div>
      <div className="checkbox-row">
        <input
          id="adjustment-recurring"
          type="checkbox"
          checked={recurring}
          onChange={(event) => setRecurring(event.target.checked)}
        />
        <label htmlFor="adjustment-recurring">Retraitement récurrent</label>
      </div>
      {category === "PRO_FORMA" ? (
        <p className="form-notice">
          Un pro forma sera SIGNALÉ : le résultat retenu ne sera plus un résultat constaté.
        </p>
      ) : null}
      <FormActions
        busy={busy}
        label="Ajouter le retraitement"
        disabled={!label.trim()}
        onCancel={onDone}
      />
    </form>
  );
}

export function BridgeItemForm({
  businessId,
  currency,
  asOfDate,
  busy,
  mutate,
  onDone,
}: {
  businessId: string;
  currency: string;
  asOfDate: string;
  busy: boolean;
  mutate: Mutate;
  onDone: () => void;
}) {
  const [effectiveDate, setEffectiveDate] = useState(asOfDate);
  const [category, setCategory] =
    useState<(typeof BUSINESS_BRIDGE_ITEM_CATEGORIES)[number]>("MINORITY_INTERESTS");
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  const [source, setSource] = useState("");

  return (
    <form
      className="input-sections"
      onSubmit={async (event) => {
        event.preventDefault();
        const value = optionalNumber(amount);
        if (value === null) return;
        const ok = await mutate({
          action: "record_business_bridge_item",
          item: {
            businessId,
            effectiveDate,
            category,
            label: label.trim(),
            amount: value,
            currency,
            source: nullableText(source),
            notes: null,
          },
        });
        if (ok) onDone();
      }}
    >
      <div className="mini-form-grid">
        <label>
          Date d’effet
          <input
            type="date"
            className="text-input"
            max={asOfDate}
            value={effectiveDate}
            onChange={(event) => setEffectiveDate(event.target.value)}
          />
        </label>
        <label>
          Nature
          <select
            value={category}
            onChange={(event) => setCategory(event.target.value as typeof category)}
          >
            {BUSINESS_BRIDGE_ITEM_CATEGORIES.map((option) => (
              <option key={option} value={option}>
                {BUSINESS_BRIDGE_CATEGORY_LABELS[option]}
              </option>
            ))}
          </select>
        </label>
        <label className="full">
          Libellé
          <input
            className="text-input"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            required
          />
        </label>
        <label>
          Montant signé
          <input
            className="text-input"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            inputMode="decimal"
            required
          />
          <UnknownHint>Positif : ajoute à l’Equity Value. Négatif : la réduit.</UnknownHint>
        </label>
        <label>
          Source
          <input
            className="text-input"
            value={source}
            onChange={(event) => setSource(event.target.value)}
          />
        </label>
      </div>
      <FormActions busy={busy} label="Ajouter au pont" disabled={!label.trim()} onCancel={onDone} />
    </form>
  );
}

// ─── DCF ────────────────────────────────────────────────────────────────────────────────

interface DcfPeriodDraft {
  yearIndex: number;
  revenue: string;
  ebitda: string;
  ebit: string;
  da: string;
  capex: string;
  workingCapitalChange: string;
}

const emptyDcfPeriod = (yearIndex: number): DcfPeriodDraft => ({
  yearIndex,
  revenue: "",
  ebitda: "",
  ebit: "",
  da: "",
  capex: "",
  workingCapitalChange: "",
});

/**
 * Hypothèses de DCF. Toutes DÉCLARÉES : LFO ne fournit ni WACC, ni croissance, ni marge.
 * Le déroulé annuel est saisi en valeurs absolues, ce qui évite qu'une croissance affichée
 * soit une hypothèse cachée : la croissance est LUE de la série, elle ne la produit pas.
 */
export function DcfForm({
  businessId,
  currency,
  asOfDate,
  busy,
  mutate,
  onDone,
}: {
  businessId: string;
  currency: string;
  asOfDate: string;
  busy: boolean;
  mutate: Mutate;
  onDone: () => void;
}) {
  const [valuationDate, setValuationDate] = useState(asOfDate);
  const [wacc, setWacc] = useState("10");
  const [taxRate, setTaxRate] = useState("25");
  const [terminalMethod, setTerminalMethod] = useState<"PERPETUAL_GROWTH" | "EXIT_MULTIPLE">(
    "PERPETUAL_GROWTH",
  );
  const [terminalGrowth, setTerminalGrowth] = useState("2");
  const [terminalExitMultiple, setTerminalExitMultiple] = useState("");
  const [terminalExitMetric, setTerminalExitMetric] = useState<"EBITDA" | "EBIT">("EBITDA");
  const [discountConvention, setDiscountConvention] = useState<"YEAR_END" | "MID_YEAR">("YEAR_END");
  const [periods, setPeriods] = useState<DcfPeriodDraft[]>([1, 2, 3, 4, 5].map(emptyDcfPeriod));

  const update = (yearIndex: number, patch: Partial<DcfPeriodDraft>) =>
    setPeriods((current) =>
      current.map((period) => (period.yearIndex === yearIndex ? { ...period, ...patch } : period)),
    );

  const waccValue = optionalRate(wacc);
  const growthValue = optionalRate(terminalGrowth);
  const growthInvalid =
    terminalMethod === "PERPETUAL_GROWTH" &&
    waccValue !== null &&
    growthValue !== null &&
    growthValue >= waccValue;

  return (
    <form
      className="input-sections"
      onSubmit={async (event) => {
        event.preventDefault();
        if (waccValue === null) return;
        const ok = await mutate({
          action: "set_business_dcf",
          dcf: {
            businessId,
            valuationDate,
            currency,
            wacc: waccValue,
            taxRate: optionalRate(taxRate) ?? 0,
            terminalMethod,
            terminalGrowth: terminalMethod === "PERPETUAL_GROWTH" ? growthValue : null,
            terminalExitMultiple:
              terminalMethod === "EXIT_MULTIPLE" ? optionalNumber(terminalExitMultiple) : null,
            terminalExitMetric: terminalMethod === "EXIT_MULTIPLE" ? terminalExitMetric : null,
            discountConvention,
            periods: periods.map((period) => ({
              yearIndex: period.yearIndex,
              revenue: optionalNumber(period.revenue),
              ebitda: optionalNumber(period.ebitda),
              ebit: optionalNumber(period.ebit),
              depreciationAmortisation: optionalNumber(period.da),
              capex: optionalNumber(period.capex),
              workingCapitalChange: optionalNumber(period.workingCapitalChange),
            })),
            notes: null,
          },
        });
        if (ok) onDone();
      }}
    >
      <h3>Paramètres</h3>
      <div className="mini-form-grid">
        <label>
          Date de valorisation
          <input
            type="date"
            className="text-input"
            max={asOfDate}
            value={valuationDate}
            onChange={(event) => setValuationDate(event.target.value)}
          />
        </label>
        <label>
          WACC
          <div className="suffix-input">
            <input
              className="text-input"
              value={wacc}
              onChange={(event) => setWacc(event.target.value)}
              inputMode="decimal"
              required
            />
            <span>%</span>
          </div>
        </label>
        <label>
          Taux d’impôt
          <div className="suffix-input">
            <input
              className="text-input"
              value={taxRate}
              onChange={(event) => setTaxRate(event.target.value)}
              inputMode="decimal"
              required
            />
            <span>%</span>
          </div>
        </label>
        <label>
          Actualisation
          <select
            value={discountConvention}
            onChange={(event) =>
              setDiscountConvention(event.target.value as typeof discountConvention)
            }
          >
            <option value="YEAR_END">Fin d’année</option>
            <option value="MID_YEAR">Mi-année</option>
          </select>
        </label>
        <label>
          Valeur terminale
          <select
            value={terminalMethod}
            onChange={(event) => setTerminalMethod(event.target.value as typeof terminalMethod)}
          >
            <option value="PERPETUAL_GROWTH">Croissance perpétuelle</option>
            <option value="EXIT_MULTIPLE">Multiple de sortie</option>
          </select>
        </label>
        {terminalMethod === "PERPETUAL_GROWTH" ? (
          <label>
            Croissance perpétuelle
            <div className="suffix-input">
              <input
                className="text-input"
                value={terminalGrowth}
                onChange={(event) => setTerminalGrowth(event.target.value)}
                inputMode="decimal"
                required
              />
              <span>%</span>
            </div>
            {growthInvalid ? (
              <span className="form-error">
                La croissance perpétuelle doit rester inférieure au WACC, sans quoi la valeur
                terminale n’existe pas.
              </span>
            ) : null}
          </label>
        ) : (
          <>
            <label>
              Multiple de sortie
              <div className="suffix-input">
                <input
                  className="text-input"
                  value={terminalExitMultiple}
                  onChange={(event) => setTerminalExitMultiple(event.target.value)}
                  inputMode="decimal"
                  required
                />
                <span>×</span>
              </div>
            </label>
            <label>
              Agrégat de sortie
              <select
                value={terminalExitMetric}
                onChange={(event) =>
                  setTerminalExitMetric(event.target.value as typeof terminalExitMetric)
                }
              >
                <option value="EBITDA">EBITDA</option>
                <option value="EBIT">Résultat d’exploitation</option>
              </select>
            </label>
          </>
        )}
      </div>

      <h3>Déroulé projeté</h3>
      <p className="muted-copy">
        Chaque année est déclarée en valeurs absolues. Le free cash flow en est dérivé : EBIT × (1 −
        impôt) + amortissements − capex − variation de BFR. Une année incomplète rend le DCF non
        calculable plutôt que d’en combler les trous.
      </p>
      <div className="dcf-grid">
        <div className="dcf-head">
          <span>Année</span>
          <span>CA</span>
          <span>EBITDA</span>
          <span>EBIT</span>
          <span>Amort.</span>
          <span>Capex</span>
          <span>Δ BFR</span>
          <span />
        </div>
        {periods.map((period) => (
          <div className="dcf-row" key={period.yearIndex}>
            <span>N+{period.yearIndex}</span>
            <input
              className="text-input"
              value={period.revenue}
              onChange={(event) => update(period.yearIndex, { revenue: event.target.value })}
              inputMode="decimal"
            />
            <input
              className="text-input"
              value={period.ebitda}
              onChange={(event) => update(period.yearIndex, { ebitda: event.target.value })}
              inputMode="decimal"
            />
            <input
              className="text-input"
              value={period.ebit}
              onChange={(event) => update(period.yearIndex, { ebit: event.target.value })}
              inputMode="decimal"
            />
            <input
              className="text-input"
              value={period.da}
              onChange={(event) => update(period.yearIndex, { da: event.target.value })}
              inputMode="decimal"
            />
            <input
              className="text-input"
              value={period.capex}
              onChange={(event) => update(period.yearIndex, { capex: event.target.value })}
              inputMode="decimal"
            />
            <input
              className="text-input"
              value={period.workingCapitalChange}
              onChange={(event) =>
                update(period.yearIndex, { workingCapitalChange: event.target.value })
              }
              inputMode="decimal"
            />
            <button
              type="button"
              className="icon-button"
              aria-label={`Retirer l’année ${period.yearIndex}`}
              onClick={() =>
                setPeriods((current) =>
                  current.filter((item) => item.yearIndex !== period.yearIndex),
                )
              }
              disabled={periods.length <= 1}
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        className="button compact"
        onClick={() =>
          setPeriods((current) => [
            ...current,
            emptyDcfPeriod((current.at(-1)?.yearIndex ?? 0) + 1),
          ])
        }
      >
        <Plus size={13} /> Ajouter une année
      </button>
      <FormActions
        busy={busy}
        label="Enregistrer les hypothèses"
        disabled={growthInvalid}
        onCancel={onDone}
      />
    </form>
  );
}

// ─── Capital et distributions ───────────────────────────────────────────────────────────

const DISTRIBUTION_TYPES = ["DIVIDEND", "DISTRIBUTION", "CAPITAL_RETURN"];
const DISPOSAL_TYPES = ["SALE", "BUYBACK"];

export function CapitalEventForm({
  businessId,
  currency,
  asOfDate,
  currentOwnership,
  busy,
  mutate,
  onDone,
}: {
  businessId: string;
  currency: string;
  asOfDate: string;
  currentOwnership: number | null;
  busy: boolean;
  mutate: Mutate;
  onDone: () => void;
}) {
  const [type, setType] = useState<(typeof BUSINESS_CAPITAL_EVENT_TYPES)[number]>("ACQUISITION");
  const [eventDate, setEventDate] = useState(asOfDate);
  const [amount, setAmount] = useState("");
  const [amountScope, setAmountScope] = useState<"USER_CASH" | "COMPANY_TOTAL">("USER_CASH");
  const [fees, setFees] = useState("");
  const [ownershipAfter, setOwnershipAfter] = useState("");
  const [label, setLabel] = useState("");

  const isDistribution = DISTRIBUTION_TYPES.includes(type);
  const isDisposal = DISPOSAL_TYPES.includes(type);
  const after = optionalRate(ownershipAfter);
  const delta = after !== null && currentOwnership !== null ? after - currentOwnership : null;

  return (
    <form
      className="input-sections"
      onSubmit={async (event) => {
        event.preventDefault();
        const value = optionalNumber(amount);
        if (value === null) return;
        const ok = await mutate({
          action: "record_business_capital_event",
          event: {
            businessId,
            type,
            eventDate,
            amount: value,
            amountScope: isDistribution ? amountScope : "USER_CASH",
            fees: optionalNumber(fees),
            currency,
            ownershipDelta: isDisposal ? delta : null,
            ownershipRateAfter: isDisposal ? after : null,
            sharesDelta: null,
            pricePerShare: null,
            label: nullableText(label),
            transactionId: null,
            notes: null,
          },
        });
        if (ok) onDone();
      }}
    >
      <div className="mini-form-grid">
        <label>
          Nature
          <select value={type} onChange={(event) => setType(event.target.value as typeof type)}>
            {BUSINESS_CAPITAL_EVENT_TYPES.map((option) => (
              <option key={option} value={option}>
                {BUSINESS_CAPITAL_EVENT_LABELS[option]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Date
          <input
            type="date"
            className="text-input"
            max={asOfDate}
            value={eventDate}
            onChange={(event) => setEventDate(event.target.value)}
          />
        </label>
        <label>
          Montant
          <input
            className="text-input"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            inputMode="decimal"
            required
          />
        </label>
        {isDistribution ? (
          <label>
            Périmètre du montant
            <select
              value={amountScope}
              onChange={(event) => setAmountScope(event.target.value as typeof amountScope)}
            >
              <option value="USER_CASH">{BUSINESS_AMOUNT_SCOPE_LABELS.USER_CASH}</option>
              <option value="COMPANY_TOTAL">{BUSINESS_AMOUNT_SCOPE_LABELS.COMPANY_TOTAL}</option>
            </select>
            <UnknownHint>
              Une distribution votée par la société n’est pas le cash que vous recevez : la part
              personnelle sera dérivée au prorata de vos droits économiques à cette date.
            </UnknownHint>
          </label>
        ) : null}
        {isDisposal ? (
          <>
            <label>
              Détention après l’opération
              <div className="suffix-input">
                <input
                  className="text-input"
                  value={ownershipAfter}
                  onChange={(event) => setOwnershipAfter(event.target.value)}
                  inputMode="decimal"
                />
                <span>%</span>
              </div>
              <UnknownHint>
                Sans elle, la part de coût de revient libérée est inconnue et la plus-value réalisée
                restera non calculable.
              </UnknownHint>
            </label>
            <label>
              Frais de transaction
              <input
                className="text-input"
                value={fees}
                onChange={(event) => setFees(event.target.value)}
                inputMode="decimal"
              />
            </label>
          </>
        ) : null}
        <label className="full">
          Libellé
          <input
            className="text-input"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
          />
        </label>
      </div>
      {isDisposal && delta !== null ? (
        <p className="form-notice">
          Quote-part cédée dérivée : {(Math.abs(delta) * 100).toFixed(2)} points de détention.
          Pensez ensuite à enregistrer la détention résiduelle à cette même date.
        </p>
      ) : null}
      <FormActions busy={busy} label="Enregistrer l’opération" onCancel={onDone} />
    </form>
  );
}

// ─── Holdings ───────────────────────────────────────────────────────────────────────────

export function HoldingLinkForm({
  parentBusinessId,
  candidates,
  asOfDate,
  busy,
  mutate,
  onDone,
}: {
  parentBusinessId: string;
  candidates: BusinessEntity[];
  asOfDate: string;
  busy: boolean;
  mutate: Mutate;
  onDone: () => void;
}) {
  const [childBusinessId, setChildBusinessId] = useState(candidates[0]?.id ?? "");
  const [effectiveDate, setEffectiveDate] = useState(asOfDate);
  const [ownershipRate, setOwnershipRate] = useState("100");

  const rate = optionalRate(ownershipRate);
  return (
    <form
      className="input-sections"
      onSubmit={async (event) => {
        event.preventDefault();
        if (!childBusinessId || rate === null) return;
        const ok = await mutate({
          action: "set_business_holding",
          holding: {
            parentBusinessId,
            childBusinessId,
            effectiveDate,
            ownershipRate: rate,
            notes: null,
          },
        });
        if (ok) onDone();
      }}
    >
      <div className="mini-form-grid">
        <label>
          Filiale détenue
          <select
            value={childBusinessId}
            onChange={(event) => setChildBusinessId(event.target.value)}
            required
          >
            {candidates.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Date d’effet
          <input
            type="date"
            className="text-input"
            max={asOfDate}
            value={effectiveDate}
            onChange={(event) => setEffectiveDate(event.target.value)}
          />
        </label>
        <label>
          Quote-part détenue
          <div className="suffix-input">
            <input
              className="text-input"
              value={ownershipRate}
              onChange={(event) => setOwnershipRate(event.target.value)}
              inputMode="decimal"
            />
            <span>%</span>
          </div>
        </label>
      </div>
      <p className="form-notice">
        La filiale n’entrera pas séparément au patrimoine : sa valeur remontera par la holding, au
        travers de cette quote-part et du bilan propre de la mère.
      </p>
      <FormActions
        busy={busy}
        label="Rattacher"
        disabled={!childBusinessId || rate === null}
        onCancel={onDone}
      />
    </form>
  );
}

// ─── Tour de table ──────────────────────────────────────────────────────────────────────

/**
 * Une levée est UN fait économique. L'utilisateur déclare les termes du tour ; la détention
 * post-money en est DÉRIVÉE et affichée avant validation. Il ne saisit jamais deux vérités
 * qui pourraient se contredire.
 */
export function FundingRoundForm({
  position,
  currency,
  asOfDate,
  busy,
  mutate,
  onDone,
}: {
  position: BusinessEquityPosition;
  currency: string;
  asOfDate: string;
  busy: boolean;
  mutate: Mutate;
  onDone: () => void;
}) {
  const ownershipBefore = position.ownership.economicRate.value;
  const [roundDate, setRoundDate] = useState(asOfDate);
  const [preMoney, setPreMoney] = useState("");
  const [primaryNewMoney, setPrimaryNewMoney] = useState("");
  const [secondaryAmount, setSecondaryAmount] = useState("");
  const [investorContribution, setInvestorContribution] = useState("0");
  const [preferredRightsKnown, setPreferredRightsKnown] = useState(false);
  const [source, setSource] = useState("");

  const pre = optionalNumber(preMoney);
  const primary = optionalNumber(primaryNewMoney);
  const contribution = optionalNumber(investorContribution) ?? 0;
  const preview =
    pre !== null && primary !== null && ownershipBefore !== null
      ? fundingRoundOutcome({
          preMoneyEquityValue: pre,
          primaryNewMoney: primary,
          secondaryAmount: optionalNumber(secondaryAmount),
          ownershipBefore,
          investorContribution: contribution,
          preferredRightsKnown,
        })
      : null;

  return (
    <form
      className="input-sections"
      onSubmit={async (event) => {
        event.preventDefault();
        if (pre === null || primary === null || ownershipBefore === null) return;
        const ok = await mutate({
          action: "apply_business_funding_round",
          round: {
            businessId: position.business.id,
            roundDate,
            currency,
            preMoneyEquityValue: pre,
            primaryNewMoney: primary,
            secondaryAmount: optionalNumber(secondaryAmount),
            investorContribution: contribution,
            ownershipBefore,
            preferredRightsKnown,
            source: nullableText(source),
            notes: null,
          },
        });
        if (ok) onDone();
      }}
    >
      {ownershipBefore === null ? (
        <p className="form-error">
          La détention économique actuelle n’est pas déclarée : la dilution ne peut pas en être
          dérivée. Enregistrez d’abord une détention.
        </p>
      ) : null}
      <div className="mini-form-grid">
        <label>
          Date du tour
          <input
            type="date"
            className="text-input"
            max={asOfDate}
            value={roundDate}
            onChange={(event) => setRoundDate(event.target.value)}
          />
        </label>
        <label>
          Valorisation pre-money
          <input
            className="text-input"
            value={preMoney}
            onChange={(event) => setPreMoney(event.target.value)}
            inputMode="decimal"
            required
          />
        </label>
        <label>
          Argent frais primaire
          <input
            className="text-input"
            value={primaryNewMoney}
            onChange={(event) => setPrimaryNewMoney(event.target.value)}
            inputMode="decimal"
            required
          />
          <UnknownHint>Seul le primaire crée de la valeur post-money.</UnknownHint>
        </label>
        <label>
          Secondaire
          <input
            className="text-input"
            value={secondaryAmount}
            onChange={(event) => setSecondaryAmount(event.target.value)}
            inputMode="decimal"
          />
          <UnknownHint>
            Rachat de titres existants : change qui détient, jamais la valeur.
          </UnknownHint>
        </label>
        <label>
          Votre souscription
          <input
            className="text-input"
            value={investorContribution}
            onChange={(event) => setInvestorContribution(event.target.value)}
            inputMode="decimal"
          />
        </label>
      </div>
      <div className="checkbox-row">
        <input
          id="preferred-known"
          type="checkbox"
          checked={preferredRightsKnown}
          onChange={(event) => setPreferredRightsKnown(event.target.checked)}
        />
        <label htmlFor="preferred-known">
          Les droits attachés aux nouveaux titres sont connus (préférences, liquidation, conversion)
        </label>
      </div>
      {preview && preview.ownershipAfter.value !== null ? (
        <p className="form-notice">
          Post-money dérivé : {formatMoney(preview.postMoneyEquityValue.value ?? 0, currency)} ·
          votre détention passerait de {((ownershipBefore ?? 0) * 100).toFixed(2)} % à{" "}
          {(preview.ownershipAfter.value * 100).toFixed(2)} %
          {preferredRightsKnown
            ? "."
            : ". Sans connaître les droits préférentiels, post-money × détention reste une borne haute."}
        </p>
      ) : null}
      <label className="full">
        Source
        <input
          className="text-input"
          value={source}
          onChange={(event) => setSource(event.target.value)}
          placeholder="Term sheet, pacte d’actionnaires…"
        />
      </label>
      <FormActions
        busy={busy}
        label="Appliquer le tour"
        disabled={pre === null || primary === null || ownershipBefore === null}
        onCancel={onDone}
      />
    </form>
  );
}

/** Suppression d'un fait déclaré. Une correction est un droit, pas une exception. */
export function DeleteButton({
  label,
  busy,
  onDelete,
}: {
  label: string;
  busy: boolean;
  onDelete: () => void;
}) {
  return (
    <button
      type="button"
      className="icon-button"
      aria-label={label}
      title={label}
      disabled={busy}
      onClick={onDelete}
    >
      <Trash2 size={14} />
    </button>
  );
}

export type { BusinessCapitalEvent, BusinessEbitdaAdjustment, BusinessValuationBasis };

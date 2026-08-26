"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { Save } from "lucide-react";

import type {
  RealEstateAssetInput,
  RealEstateCapitalEventInput,
  RealEstateFinancingLinkInput,
  RealEstateOperatingTermsInput,
  RealEstateValuationInput,
} from "@/lib/data/contracts";
import {
  REAL_ESTATE_CAPITAL_EVENT_TYPES,
  REAL_ESTATE_USAGES,
  REAL_ESTATE_VALUATION_METHODS,
  type Liability,
  type RealEstateAsset,
  type RealEstateCapitalEventType,
  type RealEstateUsage,
  type RealEstateValuationMethod,
} from "@/lib/types";

/**
 * FORMULAIRES DU DOMAINE IMMOBILIER
 *
 * Un champ vide vaut `null`, jamais zéro. C'est la règle centrale de ces formulaires :
 * l'utilisateur qui ne sait pas laisse vide, et celui qui sait que la charge est nulle
 * saisit 0. Les deux gestes disent des choses différentes et le produit les distingue,
 * parce que le moteur en dépend : un terme non déclaré rend le rendement net non
 * calculable, un terme déclaré à zéro ne le rend pas.
 */
const number = (value: string) => Number(value.replace(",", "."));
const nullableNumber = (value: string) => (value === "" ? null : number(value));
const nullableText = (value: string) => (value.trim() === "" ? null : value.trim());
/** Un pourcentage saisi devient une part d'unité. Un champ vide reste `null`. */
const nullableRate = (value: string) => {
  const parsed = nullableNumber(value);
  return parsed === null ? null : parsed / 100;
};
const asPercent = (value: number | null) => (value === null ? "" : String(value * 100));

export const USAGE_LABELS: Record<RealEstateUsage, string> = {
  PRIMARY_RESIDENCE: "Résidence principale",
  SECONDARY_RESIDENCE: "Résidence secondaire",
  RENTAL: "Locatif",
  MIXED_USE: "Usage mixte",
  LAND: "Terrain",
  OTHER: "Autre usage",
};

export const VALUATION_METHOD_LABELS: Record<RealEstateValuationMethod, string> = {
  MARKET_APPRAISAL: "Expertise de marché",
  NOTARY_ESTIMATE: "Estimation notariale",
  AGENT_ESTIMATE: "Estimation d’agence",
  INDEX_ADJUSTED: "Valeur indexée",
  USER_ESTIMATE: "Estimation personnelle",
  PURCHASE_PRICE: "Prix d’achat retenu comme valeur",
};

export const CAPITAL_EVENT_LABELS: Record<RealEstateCapitalEventType, string> = {
  ACQUISITION_PRICE: "Prix d’achat",
  ACQUISITION_COST: "Frais d’acquisition",
  CAPEX: "Travaux capitalisés",
  DISPOSAL_PRICE: "Prix de cession",
  DISPOSAL_COST: "Frais de cession",
};

function FormShell({
  children,
  busy,
  onCancel,
  submitLabel,
  onSubmit,
  notice,
}: {
  children: ReactNode;
  busy: boolean;
  onCancel: () => void;
  submitLabel: string;
  onSubmit: (event: FormEvent) => void;
  notice?: ReactNode;
}) {
  return (
    <form className="form-grid" onSubmit={onSubmit}>
      {children}
      {notice ? <p className="form-notice full">{notice}</p> : null}
      <div className="form-actions">
        <button type="button" className="button secondary" onClick={onCancel} disabled={busy}>
          Annuler
        </button>
        <button type="submit" className="button primary" disabled={busy}>
          <Save size={15} /> {submitLabel}
        </button>
      </div>
    </form>
  );
}

// ─── Identité du bien ─────────────────────────────────────────────────────────────────

export function RealEstateAssetForm({
  asset,
  busy,
  onSave,
  onCancel,
}: {
  asset: RealEstateAsset | null;
  busy: boolean;
  onSave: (input: RealEstateAssetInput) => Promise<boolean>;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<RealEstateAssetInput>(() => ({
    propertyId: asset?.id ?? null,
    name: asset?.name ?? "",
    location: asset?.location ?? null,
    surfaceSqm: asset?.surfaceSqm ?? null,
    usage: asset?.usage ?? null,
    ownershipShare: asset?.ownershipShare ?? null,
    isDebtFinanced: asset?.isDebtFinanced ?? null,
    acquisitionDate: asset?.acquisitionDate ?? null,
    disposalDate: asset?.disposalDate ?? null,
    notes: asset?.notes ?? null,
  }));

  return (
    <FormShell
      busy={busy}
      onCancel={onCancel}
      submitLabel={asset ? "Enregistrer le bien" : "Créer le bien"}
      onSubmit={async (event) => {
        event.preventDefault();
        if (await onSave(form)) onCancel();
      }}
      notice="Aucun montant n’est saisi ici : prix d’achat, valeur et loyers sont des faits datés, enregistrés séparément avec leur propre provenance. Le financement demande une réponse explicite : tant qu’il n’est pas déclaré, ni l’equity du bien ni le rendement sur fonds propres ne sont calculables. Ne rien déclarer n’équivaut pas à déclarer un achat comptant."
    >
      <label>
        Nom du bien
        <input
          className="text-input"
          value={form.name}
          onChange={(event) => setForm({ ...form, name: event.target.value })}
          required
        />
      </label>
      <label>
        Localisation
        <input
          className="text-input"
          value={form.location ?? ""}
          onChange={(event) => setForm({ ...form, location: nullableText(event.target.value) })}
        />
      </label>
      <label>
        Usage économique
        <select
          className="text-input"
          value={form.usage ?? ""}
          onChange={(event) =>
            setForm({ ...form, usage: (event.target.value || null) as RealEstateUsage | null })
          }
        >
          <option value="">Non déclaré</option>
          {REAL_ESTATE_USAGES.map((usage) => (
            <option key={usage} value={usage}>
              {USAGE_LABELS[usage]}
            </option>
          ))}
        </select>
      </label>
      <label>
        Quote-part détenue
        <div className="suffix-input">
          <input
            type="number"
            min="0"
            max="100"
            step="0.01"
            value={asPercent(form.ownershipShare)}
            onChange={(event) =>
              setForm({ ...form, ownershipShare: nullableRate(event.target.value) })
            }
          />
          <span>%</span>
        </div>
      </label>
      <label>
        Financement du bien
        <select
          className="text-input"
          value={form.isDebtFinanced === null ? "" : form.isDebtFinanced ? "true" : "false"}
          onChange={(event) =>
            setForm({
              ...form,
              isDebtFinanced: event.target.value === "" ? null : event.target.value === "true",
            })
          }
        >
          <option value="">Non déclaré</option>
          <option value="false">Aucune dette ne finance ce bien</option>
          <option value="true">Une dette finance ce bien</option>
        </select>
      </label>
      <label>
        Surface
        <div className="suffix-input">
          <input
            type="number"
            min="0"
            step="0.01"
            value={form.surfaceSqm ?? ""}
            onChange={(event) =>
              setForm({ ...form, surfaceSqm: nullableNumber(event.target.value) })
            }
          />
          <span>m²</span>
        </div>
      </label>
      <label>
        Date d’acquisition
        <input
          className="text-input"
          type="date"
          value={form.acquisitionDate ?? ""}
          onChange={(event) =>
            setForm({ ...form, acquisitionDate: nullableText(event.target.value) })
          }
        />
      </label>
      <label>
        Date de cession
        <input
          className="text-input"
          type="date"
          value={form.disposalDate ?? ""}
          onChange={(event) => setForm({ ...form, disposalDate: nullableText(event.target.value) })}
        />
      </label>
      <label className="full">
        Notes
        <input
          className="text-input"
          value={form.notes ?? ""}
          onChange={(event) => setForm({ ...form, notes: nullableText(event.target.value) })}
        />
      </label>
    </FormShell>
  );
}

// ─── Valorisation ─────────────────────────────────────────────────────────────────────

export function RealEstateValuationForm({
  propertyId,
  asOfDate,
  reportingCurrency,
  busy,
  onSave,
  onCancel,
}: {
  propertyId: string;
  asOfDate: string;
  reportingCurrency: string;
  busy: boolean;
  onSave: (input: RealEstateValuationInput) => Promise<boolean>;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<RealEstateValuationInput>(() => ({
    propertyId,
    valuedAt: asOfDate,
    value: 0,
    currency: reportingCurrency,
    method: "AGENT_ESTIMATE",
    notes: null,
  }));

  return (
    <FormShell
      busy={busy}
      onCancel={onCancel}
      submitLabel="Enregistrer la valorisation"
      onSubmit={async (event) => {
        event.preventDefault();
        if (await onSave(form)) onCancel();
      }}
      notice="Valeur du bien ENTIER. La quote-part détenue est appliquée par le moteur : la saisir déjà réduite la compterait deux fois."
    >
      <label>
        Valeur observée
        <input
          className="text-input"
          type="number"
          min="0"
          step="0.01"
          value={form.value}
          onChange={(event) => setForm({ ...form, value: number(event.target.value) })}
          required
        />
      </label>
      <label>
        Devise
        <input
          className="text-input"
          maxLength={3}
          value={form.currency}
          onChange={(event) => setForm({ ...form, currency: event.target.value.toUpperCase() })}
          required
        />
      </label>
      <label>
        Date de valorisation
        <input
          className="text-input"
          type="date"
          value={form.valuedAt}
          onChange={(event) => setForm({ ...form, valuedAt: event.target.value })}
          required
        />
      </label>
      <label>
        Méthode
        <select
          className="text-input"
          value={form.method}
          onChange={(event) =>
            setForm({ ...form, method: event.target.value as RealEstateValuationMethod })
          }
        >
          {REAL_ESTATE_VALUATION_METHODS.map((method) => (
            <option key={method} value={method}>
              {VALUATION_METHOD_LABELS[method]}
            </option>
          ))}
        </select>
      </label>
      <label className="full">
        Notes
        <input
          className="text-input"
          value={form.notes ?? ""}
          onChange={(event) => setForm({ ...form, notes: nullableText(event.target.value) })}
        />
      </label>
    </FormShell>
  );
}

// ─── Fait de capital ──────────────────────────────────────────────────────────────────

export function RealEstateCapitalEventForm({
  propertyId,
  asOfDate,
  reportingCurrency,
  busy,
  onSave,
  onCancel,
}: {
  propertyId: string;
  asOfDate: string;
  reportingCurrency: string;
  busy: boolean;
  onSave: (input: RealEstateCapitalEventInput) => Promise<boolean>;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<RealEstateCapitalEventInput>(() => ({
    propertyId,
    type: "ACQUISITION_COST",
    eventDate: asOfDate,
    amount: 0,
    currency: reportingCurrency,
    label: null,
    transactionId: null,
    notes: null,
  }));

  return (
    <FormShell
      busy={busy}
      onCancel={onCancel}
      submitLabel="Enregistrer le fait"
      onSubmit={async (event) => {
        event.preventDefault();
        if (await onSave(form)) onCancel();
      }}
      notice="Montant toujours positif : la direction économique vient du type. Les travaux capitalisés augmentent le coût de revient ; l’entretien courant est une charge et se déclare dans les termes d’exploitation."
    >
      <label>
        Nature
        <select
          className="text-input"
          value={form.type}
          onChange={(event) =>
            setForm({ ...form, type: event.target.value as RealEstateCapitalEventType })
          }
        >
          {REAL_ESTATE_CAPITAL_EVENT_TYPES.map((type) => (
            <option key={type} value={type}>
              {CAPITAL_EVENT_LABELS[type]}
            </option>
          ))}
        </select>
      </label>
      <label>
        Montant
        <input
          className="text-input"
          type="number"
          min="0"
          step="0.01"
          value={form.amount}
          onChange={(event) => setForm({ ...form, amount: number(event.target.value) })}
          required
        />
      </label>
      <label>
        Devise
        <input
          className="text-input"
          maxLength={3}
          value={form.currency}
          onChange={(event) => setForm({ ...form, currency: event.target.value.toUpperCase() })}
          required
        />
      </label>
      <label>
        Date
        <input
          className="text-input"
          type="date"
          value={form.eventDate}
          onChange={(event) => setForm({ ...form, eventDate: event.target.value })}
          required
        />
      </label>
      <label className="full">
        Libellé
        <input
          className="text-input"
          value={form.label ?? ""}
          onChange={(event) => setForm({ ...form, label: nullableText(event.target.value) })}
        />
      </label>
    </FormShell>
  );
}

// ─── Termes d'exploitation ────────────────────────────────────────────────────────────

export function RealEstateOperatingTermsForm({
  propertyId,
  asOfDate,
  reportingCurrency,
  current,
  busy,
  onSave,
  onCancel,
}: {
  propertyId: string;
  asOfDate: string;
  reportingCurrency: string;
  current: RealEstateOperatingTermsInput | null;
  busy: boolean;
  onSave: (input: RealEstateOperatingTermsInput) => Promise<boolean>;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<RealEstateOperatingTermsInput>(() => ({
    propertyId,
    effectiveFrom: current?.effectiveFrom ?? asOfDate,
    currency: current?.currency ?? reportingCurrency,
    annualGrossRent: current?.annualGrossRent ?? null,
    vacancyRate: current?.vacancyRate ?? null,
    annualOperatingCharges: current?.annualOperatingCharges ?? null,
    annualPropertyTax: current?.annualPropertyTax ?? null,
    annualInsurance: current?.annualInsurance ?? null,
    annualMaintenance: current?.annualMaintenance ?? null,
    annualManagementFees: current?.annualManagementFees ?? null,
    managementFeeRate: current?.managementFeeRate ?? null,
    annualOtherCosts: current?.annualOtherCosts ?? null,
    effectiveIncomeTaxRate: current?.effectiveIncomeTaxRate ?? null,
    notes: current?.notes ?? null,
  }));

  const amountField = (key: keyof RealEstateOperatingTermsInput, label: string) => (
    <label key={key}>
      {label}
      <div className="suffix-input">
        <input
          type="number"
          min="0"
          step="0.01"
          placeholder="non déclaré"
          value={(form[key] as number | null) ?? ""}
          onChange={(event) => setForm({ ...form, [key]: nullableNumber(event.target.value) })}
        />
        <span>{form.currency}/an</span>
      </div>
    </label>
  );

  return (
    <FormShell
      busy={busy}
      onCancel={onCancel}
      submitLabel="Déclarer les termes"
      onSubmit={async (event) => {
        event.preventDefault();
        if (await onSave(form)) onCancel();
      }}
      notice="Laisser un champ vide signifie « je ne sais pas » : le rendement net qui en dépend restera non calculable. Saisir 0 signifie « cette charge est nulle ». Les deux gestes ne disent pas la même chose et le moteur les distingue."
    >
      <label>
        Date d’effet
        <input
          className="text-input"
          type="date"
          value={form.effectiveFrom}
          onChange={(event) => setForm({ ...form, effectiveFrom: event.target.value })}
          required
        />
      </label>
      <label>
        Devise des termes
        <input
          className="text-input"
          maxLength={3}
          value={form.currency}
          onChange={(event) => setForm({ ...form, currency: event.target.value.toUpperCase() })}
          required
        />
      </label>
      {amountField("annualGrossRent", "Loyer brut annuel")}
      <label>
        Taux de vacance
        <div className="suffix-input">
          <input
            type="number"
            min="0"
            max="100"
            step="0.1"
            placeholder="non déclaré"
            value={asPercent(form.vacancyRate)}
            onChange={(event) =>
              setForm({ ...form, vacancyRate: nullableRate(event.target.value) })
            }
          />
          <span>%</span>
        </div>
      </label>
      {amountField("annualOperatingCharges", "Charges non récupérables")}
      {amountField("annualPropertyTax", "Taxe foncière")}
      {amountField("annualInsurance", "Assurance")}
      {amountField("annualMaintenance", "Entretien courant")}
      {amountField("annualManagementFees", "Frais de gestion (montant)")}
      <label>
        Frais de gestion (part du loyer encaissé)
        <div className="suffix-input">
          <input
            type="number"
            min="0"
            max="100"
            step="0.1"
            placeholder="non déclaré"
            value={asPercent(form.managementFeeRate)}
            onChange={(event) =>
              setForm({
                ...form,
                managementFeeRate: nullableRate(event.target.value),
                // Les deux formes s'excluent : ensemble, elles compteraient deux fois la
                // même charge. La base refuse d'ailleurs la combinaison.
                annualManagementFees:
                  nullableRate(event.target.value) === null ? form.annualManagementFees : null,
              })
            }
          />
          <span>%</span>
        </div>
      </label>
      {amountField("annualOtherCosts", "Autres charges")}
      <label>
        Taux d’imposition effectif déclaré
        <div className="suffix-input">
          <input
            type="number"
            min="0"
            max="100"
            step="0.1"
            placeholder="non déclaré"
            value={asPercent(form.effectiveIncomeTaxRate)}
            onChange={(event) =>
              setForm({ ...form, effectiveIncomeTaxRate: nullableRate(event.target.value) })
            }
          />
          <span>%</span>
        </div>
      </label>
      <label className="full">
        Notes
        <input
          className="text-input"
          value={form.notes ?? ""}
          onChange={(event) => setForm({ ...form, notes: nullableText(event.target.value) })}
        />
      </label>
    </FormShell>
  );
}

// ─── Rattachement du financement ──────────────────────────────────────────────────────

export function RealEstateFinancingLinkForm({
  propertyId,
  liabilities,
  busy,
  onSave,
  onCancel,
}: {
  propertyId: string;
  liabilities: Liability[];
  busy: boolean;
  onSave: (input: RealEstateFinancingLinkInput) => Promise<boolean>;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<RealEstateFinancingLinkInput>(() => ({
    propertyId,
    liabilityId: liabilities[0]?.id ?? "",
    allocationShare: 1,
    notes: null,
  }));

  return (
    <FormShell
      busy={busy}
      onCancel={onCancel}
      submitLabel="Rattacher le financement"
      onSubmit={async (event) => {
        event.preventDefault();
        if (await onSave(form)) onCancel();
      }}
      notice="Ce rattachement ne crée aucun passif : la dette est déjà au bilan. Il indique seulement quelle part de ce concours finance ce bien, ce qui permet de calculer l’equity sans compter la dette deux fois."
    >
      <label className="full">
        Dette existante
        <select
          className="text-input"
          value={form.liabilityId}
          onChange={(event) => setForm({ ...form, liabilityId: event.target.value })}
          required
        >
          {liabilities.map((liability) => (
            <option key={liability.id} value={liability.id}>
              {liability.name} · {liability.lender}
            </option>
          ))}
        </select>
      </label>
      <label>
        Quote-part du concours
        <div className="suffix-input">
          <input
            type="number"
            min="0.01"
            max="100"
            step="0.01"
            value={asPercent(form.allocationShare)}
            onChange={(event) =>
              setForm({ ...form, allocationShare: nullableRate(event.target.value) ?? 1 })
            }
            required
          />
          <span>%</span>
        </div>
      </label>
      <label>
        Notes
        <input
          className="text-input"
          value={form.notes ?? ""}
          onChange={(event) => setForm({ ...form, notes: nullableText(event.target.value) })}
        />
      </label>
    </FormShell>
  );
}

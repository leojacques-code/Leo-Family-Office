import type { DebtContractInput } from "@/lib/data/contracts";

/**
 * Sérialisation du formulaire de contrat de dette en brouillon, et relecture DÉFENSIVE.
 *
 * Un brouillon peut être incomplet, ancien, ou écrit par une version antérieure de
 * l'application : il n'est jamais cru sur parole. Chaque champ relu doit avoir le type que le
 * formulaire attend, sinon la valeur de départ du formulaire est conservée. Rien n'est déduit :
 * un montant absent redevient absent (NaN ou `null` selon le champ), jamais zéro.
 *
 * Ce module ne calcule rien et n'écrit rien : la validation du contrat reste celle du
 * formulaire, du schéma serveur et de la base, au moment de VALIDER, pas d'enregistrer un
 * brouillon.
 */
export interface ContractDraftState {
  contract: DebtContractInput;
  structure: {
    mode: string;
    paymentFrequency: string;
    interestConvention: string;
    rateType: string;
  };
  requiredValues: {
    principal: number | null;
    initialBalance: number | null;
    annualRate: number | null;
  };
  insurance: { choice: string; policies: DebtContractInput["insurancePolicies"] };
}

const STRUCTURE_VALUES: Record<keyof ContractDraftState["structure"], readonly string[]> = {
  mode: ["", "AMORTIZING", "INTEREST_ONLY", "BULLET", "BALLOON"],
  paymentFrequency: ["", "MONTHLY", "QUARTERLY", "SEMIANNUAL", "ANNUAL"],
  interestConvention: ["", "PROPORTIONAL", "ACTUAL_365"],
  rateType: ["", "FIXED", "VARIABLE"],
};
const INSURANCE_CHOICES = ["", "INCLUDED", "SEPARATE", "NONE", "UNKNOWN"];

/** Montants qu'une saisie en cours porte en NaN quand ils manquent (JSON les écrit `null`). */
const MISSING_AS_NAN = new Set([
  "premiumAmount",
  "coverageShare",
  "amount",
  "principal",
  "annualRate",
]);

/** Montants et nombres FACULTATIFS : un nombre fini ou `null`, jamais une autre forme. */
const OPTIONAL_NUMBERS = new Set([
  "paymentAmount",
  "paymentCount",
  "balloonAmount",
  "insuranceAmount",
  "recurringFees",
  "initialBalance",
  "penalty",
]);

/** Le JSON perd NaN : il devient `null`, ce que la relecture sait retraduire. */
export function serializeContractDraft(state: ContractDraftState): Record<string, unknown> {
  return JSON.parse(JSON.stringify(state)) as Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Valeur relue si elle a la même forme que la valeur de départ ; sinon la valeur de départ.
 * Les listes sont relues élément par élément contre un modèle (le premier élément de départ
 * s'il existe, sinon l'élément relu tel quel après normalisation des montants absents).
 */
function sameShape(base: unknown, value: unknown, key: string): unknown {
  if (value === undefined) return base;
  if (value === null) {
    if (base === null) return null;
    if (typeof base === "number") return MISSING_AS_NAN.has(key) ? Number.NaN : base;
    return base;
  }
  if (typeof base === "number" || (base === null && MISSING_AS_NAN.has(key)))
    return typeof value === "number" && Number.isFinite(value) ? value : base;
  // Champ facultatif (`null` au départ) : un nombre fini, une chaîne ou un objet saisis sont
  // repris ; toute autre forme redevient absente.
  if (base === null && OPTIONAL_NUMBERS.has(key))
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  if (base === null)
    return (typeof value === "number" && Number.isFinite(value)) ||
      typeof value === "string" ||
      isRecord(value)
      ? value
      : null;
  if (typeof base === "string") return typeof value === "string" ? value : base;
  if (typeof base === "boolean") return typeof value === "boolean" ? value : base;
  if (Array.isArray(base)) return Array.isArray(value) ? value.map(normaliseMissing) : base;
  if (isRecord(base)) {
    if (!isRecord(value)) return base;
    return Object.fromEntries(
      Object.entries(base).map(([field, initial]) => [
        field,
        sameShape(initial, value[field], field),
      ]),
    );
  }
  return base;
}

function normaliseMissing(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normaliseMissing);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([field, item]) => [
      field,
      item === null && MISSING_AS_NAN.has(field) ? Number.NaN : normaliseMissing(item),
    ]),
  );
}

function allowed(value: unknown, values: readonly string[], fallback: string): string {
  return typeof value === "string" && values.includes(value) ? value : fallback;
}

/**
 * Relit un brouillon sur l'état de départ du formulaire. La dette visée ne vient JAMAIS du
 * brouillon : elle est celle que le formulaire ouvre.
 */
export function restoreContractDraft(
  content: Record<string, unknown>,
  base: ContractDraftState,
): ContractDraftState {
  const contract = sameShape(base.contract, content.contract, "contract") as DebtContractInput;
  const structure = isRecord(content.structure) ? content.structure : {};
  const required = isRecord(content.requiredValues) ? content.requiredValues : {};
  const insurance = isRecord(content.insurance) ? content.insurance : {};
  const numberOrNull = (value: unknown, fallback: number | null) =>
    value === null ? null : typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return {
    contract: { ...contract, liabilityId: base.contract.liabilityId },
    structure: {
      mode: allowed(structure.mode, STRUCTURE_VALUES.mode, base.structure.mode),
      paymentFrequency: allowed(
        structure.paymentFrequency,
        STRUCTURE_VALUES.paymentFrequency,
        base.structure.paymentFrequency,
      ),
      interestConvention: allowed(
        structure.interestConvention,
        STRUCTURE_VALUES.interestConvention,
        base.structure.interestConvention,
      ),
      rateType: allowed(structure.rateType, STRUCTURE_VALUES.rateType, base.structure.rateType),
    },
    requiredValues: {
      principal: numberOrNull(required.principal, base.requiredValues.principal),
      initialBalance: numberOrNull(required.initialBalance, base.requiredValues.initialBalance),
      annualRate: numberOrNull(required.annualRate, base.requiredValues.annualRate),
    },
    insurance: {
      choice: allowed(insurance.choice, INSURANCE_CHOICES, base.insurance.choice),
      policies: Array.isArray(insurance.policies)
        ? (normaliseMissing(insurance.policies) as DebtContractInput["insurancePolicies"])
        : base.insurance.policies,
    },
  };
}

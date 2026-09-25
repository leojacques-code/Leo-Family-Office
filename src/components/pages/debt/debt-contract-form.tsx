"use client";

import { Children, useMemo, useState, type FormEvent } from "react";
import { ScheduleImport } from "./schedule-import";
import { Plus, Save, Trash2 } from "lucide-react";
import { MoneyInput } from "@/components/primitives/money-input";
import { OptionalNumberInput } from "@/components/primitives/optional-number-input";
import { PercentInput } from "@/components/primitives/percent-input";

import type { DebtContractInput } from "@/lib/data/contracts";
import { formatCurrency } from "@/lib/presentation/currency";
import { draftSynthesis } from "@/lib/presentation/debt/contract-draft";
import {
  restoreContractDraft,
  serializeContractDraft,
  type ContractDraftState,
} from "@/lib/presentation/debt/contract-draft-storage";
import { type FormDraft, type FormDraftKind } from "@/lib/presentation/drafts/contracts";
import { insurancePeriodsOverlap } from "@/lib/engine/debt";
import { operationalToday } from "@/lib/financial-date";
import { formatDate } from "@/components/pages/shared";
import type { Liability, OutstandingDebt } from "@/lib/types";

/**
 * CONTRAT DE DETTE ADAPTATIF (B16, document 04 §3).
 *
 * Le formulaire commence par le MODE DE REMBOURSEMENT, puis ne révèle que les champs que ce
 * mode exige. Aucun fait inconnu n'est prérempli : ni date d'échéance, ni maturité
 * « aujourd'hui + un an », ni nombre d'échéances, ni convention. Pour un prêt amortissable,
 * il suffit de connaître la mensualité OU la durée OU la maturité : le Debt Engine déduit le
 * reste et la synthèse dit ce qui est déduit. Une synthèse (étape F) précède l'enregistrement.
 */

type Mode = "" | DebtContractInput["amortisationProfile"];
type Structure = {
  mode: Mode;
  paymentFrequency: "" | DebtContractInput["paymentFrequency"];
  interestConvention: "" | DebtContractInput["interestConvention"];
  rateType: "" | DebtContractInput["rateType"];
};

const MODES: Array<{ value: Exclude<Mode, "">; label: string; hint: string }> = [
  {
    value: "AMORTIZING",
    label: "Amortissable à échéance constante",
    hint: "Taux, convention, fréquence, première échéance ; mensualité ou durée ou maturité.",
  },
  {
    value: "INTEREST_ONLY",
    label: "Intérêts seuls puis capital final",
    hint: "Seuls les intérêts sont servis ; le capital est dû à la fin.",
  },
  {
    value: "BULLET",
    label: "In fine",
    hint: "Intérêts à chaque échéance, tout le capital à la dernière.",
  },
  {
    value: "BALLOON",
    label: "Ballon",
    hint: "Amortissement partiel puis un solde final important.",
  },
];

/** Structures que le moteur ne calcule pas encore : enregistrables autrement, jamais converties. */
const UNSUPPORTED =
  "Amortissement constant, taux indexé avec reset, ligne renouvelable, découvert et échéances modulables ne sont pas encore calculés : enregistrez l’encours seul, ou fournissez l’échéancier de la banque.";

function blankContract(): DebtContractInput {
  return {
    liabilityId: null,
    name: "",
    lender: "",
    principal: Number.NaN,
    initialBalance: null,
    balanceDate: null,
    annualRate: Number.NaN,
    paymentAmount: null,
    paymentCount: null,
    firstPaymentDate: "",
    maturityDate: null,
    // Remplacés par la structure CHOISIE avant tout enregistrement (voir `submit`).
    amortisationProfile: "AMORTIZING",
    balloonAmount: null,
    paymentFrequency: "MONTHLY",
    interestConvention: "PROPORTIONAL",
    rateType: "FIXED",
    insuranceAmount: null,
    recurringFees: null,
    paymentIncludesInsurance: null,
    // Remplacé par le choix DÉCLARÉ avant tout enregistrement (voir `submit`).
    insuranceMode: "UNKNOWN",
    insurancePolicies: [],
    deferral: null,
    facilityId: null,
    notes: null,
    rateSchedule: [],
    paymentSchedule: [],
    earlyRepayments: [],
    charges: [],
    providedSchedule: [],
  };
}

/**
 * Réédition : les termes DÉCLARÉS, jamais ceux que le moteur a déduits. Réenregistrer une
 * durée déduite la ferait passer pour une clause du contrat.
 */
function fromLiability(loan: Liability): DebtContractInput {
  const declared = loan.declaredTerms ?? {
    monthlyPayment: loan.monthlyPayment > 0 ? loan.monthlyPayment : null,
    paymentCount: loan.paymentCount > 0 ? loan.paymentCount : null,
    maturityDate: loan.maturityDate || null,
  };
  return {
    liabilityId: loan.id,
    name: loan.name,
    lender: loan.lender,
    principal: loan.principal,
    initialBalance: null,
    balanceDate: null,
    annualRate: loan.annualRate,
    paymentAmount: declared.monthlyPayment,
    paymentCount: declared.paymentCount,
    firstPaymentDate: loan.firstPaymentDate,
    maturityDate: declared.maturityDate,
    amortisationProfile: loan.amortisationProfile,
    balloonAmount: loan.balloonAmount,
    paymentFrequency: loan.paymentFrequency,
    interestConvention: loan.interestConvention,
    rateType: loan.rateType,
    insuranceAmount: loan.monthlyInsurance,
    recurringFees: loan.recurringFees,
    paymentIncludesInsurance: loan.paymentIncludesInsurance,
    insuranceMode: loan.insuranceMode ?? "UNKNOWN",
    insurancePolicies: (loan.insurancePolicies ?? []).map(policyDraft),
    deferral: loan.deferral
      ? {
          kind: loan.deferral.kind === "NONE" ? "PRINCIPAL_ONLY" : loan.deferral.kind,
          months: loan.deferral.months,
          interestTreatment: loan.deferral.interestTreatment,
        }
      : null,
    facilityId: loan.facilityId,
    notes: loan.contractNotes ?? null,
    // B18 : un terme issu d'un événement du journal n'est pas une clause du contrat ; le
    // réenregistrer ici le dupliquerait et le rendrait inannulable.
    rateSchedule: loan.rateSchedule
      .filter((change) => !change.eventId)
      .map(({ effectiveFrom, annualRate, kind }) => ({ effectiveFrom, annualRate, kind })),
    paymentSchedule: loan.paymentSchedule
      .filter((change) => !change.eventId)
      .map(({ effectiveFrom, amount, kind }) => ({ effectiveFrom, amount, kind })),
    earlyRepayments: loan.earlyRepayments
      .filter((repayment) => !repayment.eventId)
      .map((repayment) => ({
        id: repayment.id,
        date: repayment.date,
        amount: repayment.amount,
        penalty: repayment.penalty,
        outcome: repayment.outcome,
      })),
    charges: loan.oneOffCharges.map((charge) => ({
      id: charge.id,
      date: charge.date,
      amount: charge.amount,
      label: charge.label,
      financed: charge.financed,
    })),
    providedSchedule: loan.providedSchedule.map((row) => ({ ...row })),
  };
}

type InsuranceChoice = "" | DebtContractInput["insuranceMode"];

function formatDateTime(iso: string): string {
  const value = new Date(iso);
  if (Number.isNaN(value.getTime())) return "date inconnue";
  return value.toLocaleString("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Paris",
  });
}

/** Police persistée → brouillon : chaque détail inconnu reste inconnu (`null`). */
function policyDraft(
  policy: NonNullable<Liability["insurancePolicies"]>[number],
): DebtContractInput["insurancePolicies"][number] {
  return {
    insurer: policy.insurer,
    contractReference: policy.contractReference,
    effectiveDate: policy.effectiveDate ?? null,
    endDate: policy.endDate ?? null,
    insuredBase: policy.insuredBase ?? null,
    debitAccountId: policy.debitAccountId ?? null,
    insured: policy.insured.map((person) => ({ ...person })),
    periods: policy.periods.map((period) => ({ ...period })),
  };
}

/**
 * Choix d'assurance d'un contrat existant. Un contrat antérieur à B17 n'a pas de choix
 * DÉCLARÉ : une prime « en sus » est reprise en police séparée, VISIBLE et modifiable avant
 * enregistrement ; une convention inconnue laisse le choix à faire.
 */
function initialInsurance(loan: Liability | null): {
  choice: InsuranceChoice;
  policies: DebtContractInput["insurancePolicies"];
} {
  if (!loan) return { choice: "", policies: [] };
  if (loan.insuranceMode)
    return {
      choice: loan.insuranceMode,
      policies: (loan.insurancePolicies ?? []).map(policyDraft),
    };
  if (loan.monthlyInsurance !== null && loan.paymentIncludesInsurance === true)
    return { choice: "INCLUDED", policies: [] };
  if (loan.monthlyInsurance !== null && loan.paymentIncludesInsurance === false)
    return {
      choice: "SEPARATE",
      policies: [
        {
          insurer: null,
          contractReference: null,
          effectiveDate: null,
          endDate: null,
          insuredBase: null,
          debitAccountId: null,
          insured: [],
          periods: [
            {
              firstDebitDate: loan.firstPaymentDate,
              lastDebitDate: null,
              frequency: loan.paymentFrequency,
              premiumAmount: loan.monthlyInsurance,
            },
          ],
        },
      ],
    };
  return { choice: "", policies: [] };
}

const INSURANCE_CHOICES: Array<{ value: Exclude<InsuranceChoice, "">; label: string }> = [
  { value: "INCLUDED", label: "Incluse dans les paiements du prêt" },
  { value: "SEPARATE", label: "Prélevée séparément" },
  { value: "NONE", label: "Absence d’assurance confirmée" },
  { value: "UNKNOWN", label: "Inconnue (coût incomplet)" },
];

const number = (value: string) => Number(value.replace(",", "."));
const nullableNumber = (value: string) => (value === "" ? null : number(value));

/**
 * B16 : contrat d'une dette connue par son seul encours. La MÊME ligne devient contractuelle
 * (aucune seconde dette) ; son encours observé et son historique ne sont pas redemandés, ils
 * restent l'observé que le Debt Engine confronte au contrat.
 */
function fromOutstanding(debt: OutstandingDebt): DebtContractInput {
  return {
    ...blankContract(),
    liabilityId: debt.id,
    promoteOutstanding: true,
    name: debt.name,
    lender: debt.lender ?? "",
  };
}

/** Accordé au féminin : il qualifie la durée ou la maturité. */
const RESOLUTION_LABELS: Record<string, string> = {
  DECLARED: "déclarée",
  DERIVED_FROM_MATURITY: "déduite de la maturité",
  DERIVED_FROM_PAYMENT: "déduite de la mensualité",
  DERIVED_FROM_COUNT: "déduite de la durée",
  UNRESOLVED: "non calculable",
};

export function DebtContractForm({
  loan,
  promoteFrom = null,
  asOfDate,
  reportingCurrency,
  busy,
  accounts = [],
  draft = null,
  onSaveDraft,
  onDiscardDraft,
  onSave,
  onCancel,
}: {
  loan: Liability | null;
  /** Dette encours seul dont on décrit le contrat (B16). Exclusif de `loan`. */
  promoteFrom?: OutstandingDebt | null;
  asOfDate: string;
  reportingCurrency: string;
  busy: boolean;
  /** Comptes proposés comme compte débité d'une assurance séparée (facultatif). */
  accounts?: ReadonlyArray<{ id: string; name: string; institution: string }>;
  /** Brouillon repris (document 03 §8) : l'état du formulaire en repart. */
  draft?: FormDraft | null;
  /** Enregistre le brouillon ; rend le brouillon enregistré, ou le message du refus. */
  onSaveDraft?: (input: {
    draftId: string | null;
    expectedVersion: number | null;
    kind: FormDraftKind;
    subjectId: string | null;
    title: string;
    content: Record<string, unknown>;
    /** Décision explicite après un conflit : écrire sur la version COURANTE, relue. */
    replaceLatest?: boolean;
  }) => Promise<
    { ok: true; draft: FormDraft } | { ok: false; message: string; conflict?: boolean }
  >;
  /** Retire le brouillon consommé par une validation réussie. */
  onDiscardDraft?: (draft: FormDraft) => Promise<boolean>;
  /** `changeReason` : motif d'une correction de saisie d'un contrat existant (B18). */
  onSave: (contract: DebtContractInput, changeReason?: string | null) => Promise<boolean>;
  onCancel: () => void;
}) {
  // La RPC de création omet currency : le schéma persiste EUR. L’édition conserve la devise native.
  // Une dette encours seul garde SA devise : la promotion ne change que les termes.
  const currency = loan ? (loan.currency ?? null) : promoteFrom ? promoteFrom.currency : "EUR";
  // Ligne déjà existante : l'encours observé initial n'est pas redemandé.
  const existing = loan !== null || promoteFrom !== null;
  const currencyLabel = currency ?? "devise non renseignée";
  // État de départ : la dette ouverte, puis, si un brouillon est repris, sa saisie relue
  // défensivement par-dessus. La dette visée ne vient jamais du brouillon.
  const [initial] = useState<ContractDraftState>(() => {
    const base: ContractDraftState = {
      contract: loan
        ? fromLiability(loan)
        : promoteFrom
          ? fromOutstanding(promoteFrom)
          : blankContract(),
      structure: {
        mode: loan ? loan.amortisationProfile : "",
        paymentFrequency: loan ? loan.paymentFrequency : "",
        interestConvention: loan ? loan.interestConvention : "",
        rateType: loan ? loan.rateType : "",
      },
      requiredValues: {
        principal: loan?.principal ?? null,
        initialBalance: null,
        annualRate: loan?.annualRate ?? null,
      },
      insurance: initialInsurance(loan),
      changeReason: "",
    };
    return draft ? restoreContractDraft(draft.content, base) : base;
  });
  const [contract, setContract] = useState<DebtContractInput>(initial.contract);
  const [structure, setStructure] = useState<Structure>(initial.structure as Structure);
  const [requiredValues, setRequiredValues] = useState(initial.requiredValues);
  const [insurance, setInsurance] = useState(
    initial.insurance as ReturnType<typeof initialInsurance>,
  );
  const draftKind: FormDraftKind = loan
    ? "DEBT_CONTRACT_EDIT"
    : promoteFrom
      ? "DEBT_CONTRACT_PROMOTION"
      : "DEBT_CONTRACT_NEW";
  const [currentDraft, setCurrentDraft] = useState<FormDraft | null>(draft);
  const [draftStatus, setDraftStatus] = useState<{ tone: "ok" | "error"; text: string } | null>(
    draft
      ? {
          tone: "ok",
          text: `Brouillon du ${formatDateTime(draft.updatedAt)} repris. Il n’alimente ni le patrimoine ni les calculs tant que le contrat n’est pas enregistré.`,
        }
      : null,
  );
  const [savingDraft, setSavingDraft] = useState(false);
  const [changeReason, setChangeReason] = useState(initial.changeReason ?? "");
  const [draftConflict, setDraftConflict] = useState(false);

  async function saveDraft(resolution: "normal" | "replace" | "copy" = "normal") {
    if (!onSaveDraft) return;
    setSavingDraft(true);
    const target = resolution === "copy" ? null : currentDraft;
    const result = await onSaveDraft({
      draftId: target?.id ?? null,
      expectedVersion: target?.version ?? null,
      ...(resolution === "replace" ? { replaceLatest: true } : {}),
      kind: draftKind,
      subjectId: loan?.id ?? promoteFrom?.id ?? null,
      title: contract.name.trim() || promoteFrom?.name || loan?.name || "Dette sans nom",
      content: serializeContractDraft({
        contract,
        structure,
        requiredValues,
        insurance,
        ...(loan ? { changeReason } : {}),
      }),
    });
    setSavingDraft(false);
    setDraftConflict(!result.ok && result.conflict === true);
    if (result.ok) {
      setCurrentDraft(result.draft);
      setDraftStatus({
        tone: "ok",
        text: `Brouillon enregistré le ${formatDateTime(result.draft.updatedAt)}. Il n’alimente ni le patrimoine ni les calculs ; « ${loan || promoteFrom ? "Enregistrer le contrat" : "Ajouter cette dette"} » valide le contrat.`,
      });
    } else if (result.conflict) {
      // Conflit : rien n'est écrasé en silence. La saisie reste affichée, et l'utilisateur
      // choisit : remplacer la version enregistrée ailleurs, ou garder les deux.
      setDraftStatus({
        tone: "error",
        text: "Ce brouillon a été enregistré ailleurs depuis son ouverture. Votre saisie reste affichée : choisissez de remplacer la version enregistrée par votre saisie, ou de garder les deux.",
      });
    } else {
      // La saisie reste affichée : seul le message change.
      setDraftStatus({ tone: "error", text: result.message });
    }
  }
  const [formError, setFormError] = useState<string | null>(null);
  const mode = structure.mode;
  const structureComplete =
    mode !== "" &&
    structure.paymentFrequency !== "" &&
    structure.interestConvention !== "" &&
    structure.rateType !== "";

  function setRequiredValue(key: keyof typeof requiredValues, value: number | null) {
    setRequiredValues((current) => ({ ...current, [key]: value }));
    if (value !== null) setContract((current) => ({ ...current, [key]: value }));
  }

  /** Le contrat tel qu'il serait enregistré, structure CHOISIE comprise ; `null` si incomplète. */
  const candidate = useMemo<DebtContractInput | null>(() => {
    if (!structureComplete) return null;
    return {
      ...contract,
      amortisationProfile: mode as DebtContractInput["amortisationProfile"],
      paymentFrequency: structure.paymentFrequency as DebtContractInput["paymentFrequency"],
      interestConvention: structure.interestConvention as DebtContractInput["interestConvention"],
      rateType: structure.rateType as DebtContractInput["rateType"],
      principal: requiredValues.principal ?? Number.NaN,
      annualRate: requiredValues.annualRate ?? Number.NaN,
      initialBalance: existing ? null : requiredValues.initialBalance,
      // Un in fine ou des intérêts seuls n'ont pas de mensualité déclarée : l'échéance est
      // l'intérêt de la période, que le moteur calcule.
      paymentAmount: mode === "INTEREST_ONLY" || mode === "BULLET" ? null : contract.paymentAmount,
      balloonAmount: mode === "BALLOON" ? contract.balloonAmount : null,
      // Un coût, une fois : seule une assurance INCLUSE a une prime par échéance, et seules
      // des polices SÉPARÉES ont leur propre calendrier. Sans choix, l'assurance est inconnue
      // pour la synthèse, et l'enregistrement est refusé.
      insuranceMode: insurance.choice === "" ? "UNKNOWN" : insurance.choice,
      insuranceAmount: insurance.choice === "INCLUDED" ? contract.insuranceAmount : null,
      paymentIncludesInsurance:
        insurance.choice === "INCLUDED"
          ? true
          : insurance.choice === "SEPARATE" || insurance.choice === "NONE"
            ? false
            : null,
      insurancePolicies: insurance.choice === "SEPARATE" ? insurance.policies : [],
    };
  }, [contract, structure, mode, structureComplete, requiredValues, existing, insurance]);

  const synthesis = useMemo(
    () =>
      candidate
        ? draftSynthesis(
            candidate,
            {
              id: loan?.id ?? promoteFrom?.id ?? "draft",
              currency,
              observedBalance: loan
                ? loan.currentBalance
                : promoteFrom
                  ? promoteFrom.currentBalance
                  : requiredValues.initialBalance,
              observedBalanceDate: loan
                ? (loan.balanceDate ?? null)
                : promoteFrom
                  ? (promoteFrom.balanceDate ?? null)
                  : contract.balanceDate,
            },
            asOfDate,
          )
        : null,
    [
      candidate,
      loan,
      promoteFrom,
      currency,
      requiredValues.initialBalance,
      contract.balanceDate,
      asOfDate,
    ],
  );

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!structureComplete || !candidate) {
      setFormError(
        "Choisissez le mode de remboursement, la périodicité, la convention d’intérêt et le type de taux.",
      );
      return;
    }
    if (
      requiredValues.principal === null ||
      requiredValues.annualRate === null ||
      !contract.firstPaymentDate ||
      (!existing && (requiredValues.initialBalance === null || !contract.balanceDate))
    ) {
      setFormError(
        existing
          ? "Complétez le capital emprunté, le taux et la première échéance."
          : "Complétez le capital emprunté, l’encours initial et sa date, le taux et la première échéance.",
      );
      return;
    }
    const fixesTerm =
      candidate.paymentCount !== null ||
      candidate.maturityDate !== null ||
      (mode === "AMORTIZING" && candidate.paymentAmount !== null);
    if (!fixesTerm) {
      setFormError(
        mode === "AMORTIZING"
          ? "Indiquez ce que vous connaissez : la mensualité, le nombre d’échéances ou la maturité."
          : "Indiquez le nombre d’échéances ou la maturité.",
      );
      return;
    }
    if (insurance.choice === "") {
      setFormError(
        "Indiquez le traitement de l’assurance : incluse, séparée, absente ou inconnue.",
      );
      return;
    }
    if (
      insurance.choice === "SEPARATE" &&
      (insurance.policies.length === 0 ||
        insurance.policies.some(
          (policy) =>
            policy.periods.length === 0 ||
            policy.periods.some(
              (period) =>
                !period.firstDebitDate ||
                !isPaymentFrequency(period.frequency) ||
                !Number.isFinite(period.premiumAmount),
            ),
        ))
    ) {
      setFormError(
        "Une assurance séparée exige une police avec au moins une période : première date de débit, fréquence et prime.",
      );
      return;
    }
    if (
      insurance.choice === "SEPARATE" &&
      insurance.policies.some((policy) =>
        policy.insured.some(
          (person) =>
            person.name.trim() === "" ||
            !Number.isFinite(person.coverageShare) ||
            person.coverageShare <= 0 ||
            person.coverageShare > 1,
        ),
      )
    ) {
      setFormError("Chaque assuré a un nom et une quotité entre 0 et 100 %.");
      return;
    }
    if (
      insurance.choice === "SEPARATE" &&
      insurance.policies.some((policy) => insurancePeriodsOverlap(policy.periods))
    ) {
      setFormError(
        "Deux périodes de prime d’une même police se chevauchent : renseignez le dernier débit de la période précédente, avant le premier débit de la suivante.",
      );
      return;
    }
    if (
      insurance.choice === "SEPARATE" &&
      insurance.policies.some(
        (policy) =>
          policy.effectiveDate !== null &&
          policy.endDate !== null &&
          policy.endDate < policy.effectiveDate,
      )
    ) {
      setFormError("La fin de couverture d’une police précède sa date d’effet.");
      return;
    }
    if (
      candidate.charges.some(
        (charge) =>
          !charge.date ||
          charge.label.trim() === "" ||
          !Number.isFinite(charge.amount) ||
          charge.amount <= 0,
      )
    ) {
      setFormError("Chaque frais ponctuel a une date, un libellé et un montant positif.");
      return;
    }
    if (mode === "BALLOON" && candidate.balloonAmount === null) {
      setFormError("Le solde final du ballon est requis pour ce mode.");
      return;
    }
    if (synthesis?.resolution?.blocker) {
      setFormError(
        synthesis.resolution.blocker === "MATURITY_NOT_ON_SCHEDULE"
          ? "La maturité ne tombe sur aucune échéance du calendrier : vérifiez la première échéance, la périodicité ou la maturité."
          : synthesis.resolution.blocker === "INCLUDED_INSURANCE_UNKNOWN"
            ? "L’assurance est incluse dans la mensualité sans montant : indiquez sa part, ou la durée ou la maturité, pour que la durée soit calculable."
            : "Cette mensualité ne rembourse pas le capital au taux indiqué : la durée n’est pas calculable.",
      );
      return;
    }
    setFormError(null);
    if (await onSave(candidate, loan ? changeReason.trim() || null : null)) {
      // Le brouillon consommé par la validation est retiré ; un échec de retrait laisse le
      // brouillon visible dans la liste, jamais un contrat non enregistré.
      if (currentDraft && onDiscardDraft) await onDiscardDraft(currentDraft);
      onCancel();
    }
  }

  return (
    <form className="form-grid debt-contract-form" onSubmit={submit}>
      <p className="full">
        Tous les montants de ce contrat et de son échéancier sont en {currencyLabel}.
        {!existing && reportingCurrency !== "EUR"
          ? " La création est actuellement limitée à EUR, indépendamment de votre devise de lecture."
          : ""}
      </p>
      <div className="full">
        <label htmlFor="debt-mode">Mode de remboursement</label>
        <select
          aria-describedby="debt-mode-hint"
          className="text-input"
          id="debt-mode"
          onChange={(event) => setStructure({ ...structure, mode: event.target.value as Mode })}
          required
          value={mode}
        >
          <option value="">Choisir le mode du contrat</option>
          {MODES.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
        <small id="debt-mode-hint">
          {mode ? MODES.find((item) => item.value === mode)?.hint : UNSUPPORTED}
        </small>
      </div>
      <ScheduleImport
        currency={currency}
        disabled={busy}
        onConfirm={(rows, source) =>
          setContract((current) => ({
            ...current,
            providedSchedule: rows,
            notes: [current.notes, `Échéancier fourni : ${source}`].filter(Boolean).join("\n"),
          }))
        }
      />
      <label>
        Nom de la dette
        <input
          className="text-input"
          value={contract.name}
          onChange={(event) => setContract({ ...contract, name: event.target.value })}
          required
        />
      </label>
      <label>
        Prêteur
        <input
          className="text-input"
          value={contract.lender}
          onChange={(event) => setContract({ ...contract, lender: event.target.value })}
          required
        />
      </label>
      <MoneyInput
        id="debt-principal"
        label="Capital initial emprunté (hors assurance et frais futurs)"
        currency={currencyLabel}
        value={requiredValues.principal}
        onChange={(draft) =>
          setRequiredValue("principal", draft.state === "VALID" ? draft.value : null)
        }
        required
      />
      {promoteFrom ? (
        <p className="full outstanding-debt-note">
          L’encours de {formatCurrency(promoteFrom.currentBalance, promoteFrom.currency)} observé
          {promoteFrom.balanceDate ? ` au ${formatDate(promoteFrom.balanceDate)}` : ""} et son
          historique sont conservés : le contrat décrit ce qui était prévu, l’encours observé reste
          ce qui a été constaté. Aucune seconde dette n’est créée.
        </p>
      ) : null}
      {!existing ? (
        <MoneyInput
          id="debt-initial-balance"
          label="Encours observé initial"
          currency={currencyLabel}
          value={requiredValues.initialBalance}
          onChange={(draft) =>
            setRequiredValue("initialBalance", draft.state === "VALID" ? draft.value : null)
          }
          required
        />
      ) : null}
      {!existing ? (
        <label>
          Date de l’encours initial
          <input
            className="text-input"
            type="date"
            max={operationalToday()}
            value={contract.balanceDate ?? ""}
            onChange={(event) =>
              setContract({ ...contract, balanceDate: event.target.value || null })
            }
            required
          />
        </label>
      ) : null}
      {mode ? (
        <>
          <PercentInput
            id="debt-annual-rate"
            label="Taux annuel nominal"
            rateNature="NOMINAL"
            value={requiredValues.annualRate}
            onChange={(draft) =>
              setRequiredValue("annualRate", draft.state === "VALID" ? draft.value : null)
            }
            required
          />
          <label>
            Type de taux
            <select
              className="text-input"
              value={structure.rateType}
              onChange={(event) =>
                setStructure({
                  ...structure,
                  rateType: event.target.value as Structure["rateType"],
                })
              }
              required
            >
              <option value="">Choisir</option>
              <option value="FIXED">Fixe</option>
              <option value="VARIABLE">Révisable</option>
            </select>
          </label>
          <label>
            Périodicité des échéances
            <select
              className="text-input"
              value={structure.paymentFrequency}
              onChange={(event) =>
                setStructure({
                  ...structure,
                  paymentFrequency: event.target.value as Structure["paymentFrequency"],
                })
              }
              required
            >
              <option value="">Choisir</option>
              <option value="MONTHLY">Mensuelle</option>
              <option value="QUARTERLY">Trimestrielle</option>
              <option value="SEMIANNUAL">Semestrielle</option>
              <option value="ANNUAL">Annuelle</option>
            </select>
          </label>
          <label>
            Convention d’intérêt
            <select
              className="text-input"
              value={structure.interestConvention}
              onChange={(event) =>
                setStructure({
                  ...structure,
                  interestConvention: event.target.value as Structure["interestConvention"],
                })
              }
              required
            >
              <option value="">Choisir</option>
              <option value="PROPORTIONAL">Proportionnelle à la période</option>
              <option value="ACTUAL_365">Jours réels / 365</option>
            </select>
          </label>
          <label>
            Première échéance
            <input
              className="text-input"
              type="date"
              value={contract.firstPaymentDate}
              onChange={(event) =>
                setContract({ ...contract, firstPaymentDate: event.target.value })
              }
              required
            />
          </label>
          <fieldset className="full debt-terms">
            <legend>
              {mode === "AMORTIZING"
                ? "Ce que vous connaissez : au moins la mensualité, le nombre d’échéances ou la maturité"
                : "Durée : le nombre d’échéances ou la maturité"}
            </legend>
            {mode === "AMORTIZING" || mode === "BALLOON" ? (
              <MoneyInput
                id="debt-payment"
                label="Paiement par échéance (facultatif si la durée est connue)"
                currency={currencyLabel}
                value={contract.paymentAmount}
                onChange={(draft) =>
                  setContract({
                    ...contract,
                    paymentAmount: draft.state === "VALID" ? draft.value : null,
                  })
                }
              />
            ) : null}
            <OptionalNumberInput
              id="debt-payment-count"
              label="Nombre d’échéances"
              unit="échéances"
              value={contract.paymentCount}
              onChange={(draft) =>
                setContract({
                  ...contract,
                  paymentCount: draft.state === "VALID" ? draft.value : null,
                })
              }
            />
            <label>
              Maturité contractuelle
              <input
                className="text-input"
                type="date"
                value={contract.maturityDate ?? ""}
                onChange={(event) =>
                  setContract({ ...contract, maturityDate: event.target.value || null })
                }
              />
            </label>
            {mode === "BALLOON" ? (
              <MoneyInput
                id="debt-balloon"
                label="Solde final du ballon"
                currency={currencyLabel}
                value={contract.balloonAmount}
                onChange={(draft) =>
                  setContract({
                    ...contract,
                    balloonAmount: draft.state === "VALID" ? draft.value : null,
                  })
                }
                required
              />
            ) : null}
          </fieldset>
        </>
      ) : null}

      {mode ? (
        <fieldset className="full debt-terms">
          <legend>Assurance emprunteur</legend>
          <div className="radio-row full" role="radiogroup" aria-label="Traitement de l’assurance">
            {INSURANCE_CHOICES.map((item) => (
              <label className="checkbox-row" key={item.value}>
                <input
                  checked={insurance.choice === item.value}
                  name="insurance-choice"
                  onChange={() =>
                    setInsurance({
                      choice: item.value,
                      policies:
                        item.value === "SEPARATE" && insurance.policies.length === 0
                          ? [emptyPolicy()]
                          : insurance.policies,
                    })
                  }
                  type="radio"
                />
                {item.label}
              </label>
            ))}
          </div>
          {insurance.choice === "INCLUDED" ? (
            <MoneyInput
              id="debt-insurance-included"
              label="Part d’assurance dans chaque paiement (vide = montant inconnu)"
              currency={currencyLabel}
              value={contract.insuranceAmount}
              onChange={(draft) =>
                setContract({
                  ...contract,
                  insuranceAmount: draft.state === "VALID" ? draft.value : null,
                })
              }
            />
          ) : null}
          {insurance.choice === "SEPARATE" ? (
            <InsurancePoliciesEditor
              accounts={accounts}
              currency={currencyLabel}
              policies={insurance.policies}
              onChange={(policies) => setInsurance({ ...insurance, policies })}
            />
          ) : null}
          {insurance.choice === "UNKNOWN" ? (
            <p className="full muted-copy">
              Le coût complet du crédit ne sera pas calculé : l’assurance reste inconnue, jamais
              comptée zéro.
            </p>
          ) : null}
        </fieldset>
      ) : null}

      {synthesis ? (
        <section aria-label="Synthèse du contrat" className="full debt-synthesis">
          <strong>Synthèse avant enregistrement</strong>
          {synthesis.resolution?.blocker ? (
            <p className="form-error" role="status">
              Échéancier non calculable avec ces termes :{" "}
              {synthesis.resolution.blocker === "MATURITY_NOT_ON_SCHEDULE"
                ? "la maturité ne tombe sur aucune échéance."
                : synthesis.resolution.blocker === "PAYMENT_DOES_NOT_AMORTISE"
                  ? "la mensualité ne rembourse pas le capital."
                  : synthesis.resolution.blocker === "INCLUDED_INSURANCE_UNKNOWN"
                    ? "la mensualité contient une assurance de montant inconnu, sa part qui rembourse le capital est inconnue."
                    : "il manque la mensualité, la durée ou la maturité."}
            </p>
          ) : (
            <dl>
              <div>
                <dt>Capital d’origine</dt>
                <dd>{formatCurrency(synthesis.principal, currency)}</dd>
              </div>
              <div>
                <dt>Encours observé</dt>
                <dd>
                  {formatCurrency(synthesis.observedBalance, currency)}
                  {synthesis.observedBalanceDate
                    ? ` au ${formatDate(synthesis.observedBalanceDate)}`
                    : ""}
                </dd>
              </div>
              <div>
                <dt>Prochaine sortie</dt>
                <dd>
                  {synthesis.nextCashOut
                    ? `${formatCurrency(synthesis.nextCashOut.amount, currency)} le ${formatDate(synthesis.nextCashOut.date)}`
                    : "Aucune à venir"}
                </dd>
              </div>
              <div>
                <dt>Premier remboursement de capital</dt>
                <dd>
                  {synthesis.firstPrincipalDate
                    ? formatDate(synthesis.firstPrincipalDate)
                    : "Aucun à venir"}
                </dd>
              </div>
              <div>
                <dt>Dernière échéance</dt>
                <dd>
                  {synthesis.lastDueDate ? formatDate(synthesis.lastDueDate) : "Non calculable"}
                  {synthesis.resolution
                    ? ` (maturité ${RESOLUTION_LABELS[synthesis.resolution.maturityDate]})`
                    : ""}
                </dd>
              </div>
              <div>
                <dt>Prélèvements à venir</dt>
                <dd>
                  {synthesis.paymentCount}, dont {synthesis.amortisingPaymentCount} amortissant du
                  capital
                  {synthesis.resolution
                    ? ` (durée ${RESOLUTION_LABELS[synthesis.resolution.paymentCount]})`
                    : ""}
                </dd>
              </div>
              <div>
                <dt>Capital futur remboursé</dt>
                <dd>{formatCurrency(synthesis.futurePrincipal, currency)}</dd>
              </div>
              <div>
                <dt>Intérêts futurs</dt>
                <dd>{formatCurrency(synthesis.futureInterest, currency)}</dd>
              </div>
              <div>
                <dt>Assurance future</dt>
                <dd>
                  {synthesis.futureInsurance === null
                    ? "Inconnue"
                    : formatCurrency(synthesis.futureInsurance, currency)}
                </dd>
              </div>
              <div>
                <dt>Frais futurs</dt>
                <dd>
                  {synthesis.futureFees === null
                    ? "Inconnus"
                    : formatCurrency(synthesis.futureFees, currency)}
                </dd>
              </div>
              <div>
                <dt>Total des sorties futures</dt>
                <dd>
                  {synthesis.futureCashOut.value === null
                    ? "Non calculable"
                    : `${formatCurrency(synthesis.futureCashOut.value, currency)}${
                        synthesis.futureCashOut.complete
                          ? ""
                          : ` connus, hors ${synthesis.unknowns.join(" et ")}`
                      }`}
                </dd>
              </div>
            </dl>
          )}
          {synthesis.flags.length ? (
            <ul className="muted-copy">
              {synthesis.flags.map((flag, index) => (
                <li key={`${flag.code}-${index}`}>{flag.detail}</li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      <details className="debt-advanced full">
        <summary>Conditions avancées et événements</summary>
        <div className="form-grid">
          <label>
            Frais récurrents (vide = inconnus)
            <input
              className="text-input"
              type="number"
              min="0"
              step="0.01"
              value={contract.recurringFees ?? ""}
              onChange={(event) =>
                setContract({ ...contract, recurringFees: nullableNumber(event.target.value) })
              }
            />
          </label>
          <label>
            Différé
            <select
              className="text-input"
              value={contract.deferral?.kind ?? "NONE"}
              onChange={(event) =>
                setContract({
                  ...contract,
                  deferral:
                    event.target.value === "NONE"
                      ? null
                      : {
                          kind: event.target.value as "PRINCIPAL_ONLY" | "TOTAL",
                          months: contract.deferral?.months ?? 1,
                          interestTreatment: contract.deferral?.interestTreatment ?? "UNKNOWN",
                        },
                })
              }
            >
              <option value="NONE">Aucun</option>
              <option value="PRINCIPAL_ONLY">Capital seulement</option>
              <option value="TOTAL">Total</option>
            </select>
          </label>
          {contract.deferral ? (
            <>
              <label>
                Échéances différées
                <input
                  className="text-input"
                  type="number"
                  min="1"
                  value={contract.deferral.months}
                  onChange={(event) =>
                    setContract({
                      ...contract,
                      deferral: { ...contract.deferral!, months: number(event.target.value) },
                    })
                  }
                />
              </label>
              <label>
                Traitement des intérêts
                <select
                  className="text-input"
                  value={contract.deferral.interestTreatment}
                  onChange={(event) =>
                    setContract({
                      ...contract,
                      deferral: {
                        ...contract.deferral!,
                        interestTreatment: event.target.value as "PAID" | "CAPITALISED" | "UNKNOWN",
                      },
                    })
                  }
                >
                  <option value="UNKNOWN">Inconnu</option>
                  <option value="PAID">Payés</option>
                  <option value="CAPITALISED">Capitalisés</option>
                </select>
              </label>
            </>
          ) : null}
          <label>
            Identifiant de facilité (optionnel)
            <input
              className="text-input"
              value={contract.facilityId ?? ""}
              onChange={(event) =>
                setContract({ ...contract, facilityId: event.target.value || null })
              }
            />
          </label>
          <label className="full">
            Notes contractuelles
            <textarea
              className="text-input debt-textarea"
              value={contract.notes ?? ""}
              onChange={(event) => setContract({ ...contract, notes: event.target.value || null })}
            />
          </label>
        </div>

        <NestedSection
          title="Révisions de taux"
          onAdd={() =>
            setContract({
              ...contract,
              rateSchedule: [
                ...contract.rateSchedule,
                { effectiveFrom: asOfDate, annualRate: contract.annualRate, kind: "CONTRACTUAL" },
              ],
            })
          }
        >
          {contract.rateSchedule.map((change, index) => (
            <div className="debt-editor-row" key={`${change.effectiveFrom}-${index}`}>
              <input
                className="text-input"
                type="date"
                value={change.effectiveFrom}
                onChange={(event) => {
                  const rows = [...contract.rateSchedule];
                  rows[index] = { ...change, effectiveFrom: event.target.value };
                  setContract({ ...contract, rateSchedule: rows });
                }}
              />
              <input
                className="text-input"
                type="number"
                min="0"
                step="0.001"
                value={change.annualRate * 100}
                onChange={(event) => {
                  const rows = [...contract.rateSchedule];
                  rows[index] = { ...change, annualRate: number(event.target.value) / 100 };
                  setContract({ ...contract, rateSchedule: rows });
                }}
              />
              <select
                className="text-input"
                value={change.kind}
                onChange={(event) => {
                  const rows = [...contract.rateSchedule];
                  rows[index] = {
                    ...change,
                    kind: event.target.value as "CONTRACTUAL" | "ASSUMPTION",
                  };
                  setContract({ ...contract, rateSchedule: rows });
                }}
              >
                <option value="CONTRACTUAL">Contractuel</option>
                <option value="ASSUMPTION">Hypothèse</option>
              </select>
              <RemoveButton
                onClick={() =>
                  setContract({
                    ...contract,
                    rateSchedule: contract.rateSchedule.filter((_, row) => row !== index),
                  })
                }
              />
            </div>
          ))}
        </NestedSection>

        <NestedSection
          title="Paliers de paiement"
          onAdd={() =>
            setContract({
              ...contract,
              paymentSchedule: [
                ...contract.paymentSchedule,
                {
                  effectiveFrom: contract.firstPaymentDate || asOfDate,
                  amount: contract.paymentAmount ?? 0,
                  kind: "CONTRACTUAL",
                },
              ],
            })
          }
        >
          {contract.paymentSchedule.map((change, index) => (
            <div className="debt-editor-row" key={`${change.effectiveFrom}-${index}`}>
              <input
                className="text-input"
                type="date"
                value={change.effectiveFrom}
                onChange={(event) => {
                  const rows = [...contract.paymentSchedule];
                  rows[index] = { ...change, effectiveFrom: event.target.value };
                  setContract({ ...contract, paymentSchedule: rows });
                }}
              />
              <input
                className="text-input"
                type="number"
                min="0"
                step="0.01"
                value={change.amount}
                onChange={(event) => {
                  const rows = [...contract.paymentSchedule];
                  rows[index] = { ...change, amount: number(event.target.value) };
                  setContract({ ...contract, paymentSchedule: rows });
                }}
              />
              <select
                className="text-input"
                value={change.kind}
                onChange={(event) => {
                  const rows = [...contract.paymentSchedule];
                  rows[index] = {
                    ...change,
                    kind: event.target.value as "CONTRACTUAL" | "ASSUMPTION",
                  };
                  setContract({ ...contract, paymentSchedule: rows });
                }}
              >
                <option value="CONTRACTUAL">Contractuel</option>
                <option value="ASSUMPTION">Hypothèse</option>
              </select>
              <RemoveButton
                onClick={() =>
                  setContract({
                    ...contract,
                    paymentSchedule: contract.paymentSchedule.filter((_, row) => row !== index),
                  })
                }
              />
            </div>
          ))}
        </NestedSection>

        <NestedSection
          title="Remboursements anticipés"
          onAdd={() =>
            setContract({
              ...contract,
              earlyRepayments: [
                ...contract.earlyRepayments,
                {
                  id: crypto.randomUUID(),
                  date: asOfDate,
                  amount: 0,
                  penalty: null,
                  outcome: "UNKNOWN",
                },
              ],
            })
          }
        >
          {contract.earlyRepayments.map((repayment, index) => (
            <div className="debt-editor-row five" key={repayment.id}>
              <input
                className="text-input"
                type="date"
                value={repayment.date}
                onChange={(event) => {
                  const rows = [...contract.earlyRepayments];
                  rows[index] = { ...repayment, date: event.target.value };
                  setContract({ ...contract, earlyRepayments: rows });
                }}
              />
              <input
                className="text-input"
                type="number"
                min="0.01"
                step="0.01"
                placeholder="Capital"
                value={repayment.amount}
                onChange={(event) => {
                  const rows = [...contract.earlyRepayments];
                  rows[index] = { ...repayment, amount: number(event.target.value) };
                  setContract({ ...contract, earlyRepayments: rows });
                }}
              />
              <input
                className="text-input"
                type="number"
                min="0"
                step="0.01"
                placeholder="Indemnité inconnue"
                value={repayment.penalty ?? ""}
                onChange={(event) => {
                  const rows = [...contract.earlyRepayments];
                  rows[index] = { ...repayment, penalty: nullableNumber(event.target.value) };
                  setContract({ ...contract, earlyRepayments: rows });
                }}
              />
              <select
                className="text-input"
                value={repayment.outcome}
                onChange={(event) => {
                  const rows = [...contract.earlyRepayments];
                  rows[index] = {
                    ...repayment,
                    outcome: event.target
                      .value as DebtContractInput["earlyRepayments"][number]["outcome"],
                  };
                  setContract({ ...contract, earlyRepayments: rows });
                }}
              >
                <option value="UNKNOWN">Convention inconnue</option>
                <option value="SHORTEN_TERM">Durée réduite</option>
                <option value="REDUCE_PAYMENT">Paiement réduit</option>
              </select>
              <RemoveButton
                onClick={() =>
                  setContract({
                    ...contract,
                    earlyRepayments: contract.earlyRepayments.filter((_, row) => row !== index),
                  })
                }
              />
            </div>
          ))}
        </NestedSection>

        <NestedSection
          title="Frais ponctuels"
          onAdd={() =>
            setContract({
              ...contract,
              charges: [
                ...contract.charges,
                // Ni date ni montant supposés : un frais se déclare, il ne se devine pas.
                {
                  id: crypto.randomUUID(),
                  date: "",
                  amount: Number.NaN,
                  label: "",
                  financed: false,
                },
              ],
            })
          }
        >
          {contract.charges.map((charge, index) => (
            <div className="debt-editor-row five" key={charge.id}>
              <input
                aria-label={`Date du frais ${index + 1}`}
                className="text-input"
                type="date"
                value={charge.date}
                onChange={(event) => {
                  const rows = [...contract.charges];
                  rows[index] = { ...charge, date: event.target.value };
                  setContract({ ...contract, charges: rows });
                }}
              />
              <input
                aria-label={`Libellé du frais ${index + 1}`}
                className="text-input"
                maxLength={160}
                value={charge.label}
                placeholder="Libellé"
                onChange={(event) => {
                  const rows = [...contract.charges];
                  rows[index] = { ...charge, label: event.target.value };
                  setContract({ ...contract, charges: rows });
                }}
              />
              <input
                aria-label={`Montant du frais ${index + 1}, en ${currencyLabel}`}
                className="text-input"
                type="number"
                min="0.01"
                step="0.01"
                value={Number.isFinite(charge.amount) ? charge.amount : ""}
                onChange={(event) => {
                  const rows = [...contract.charges];
                  rows[index] = {
                    ...charge,
                    amount: nullableNumber(event.target.value) ?? Number.NaN,
                  };
                  setContract({ ...contract, charges: rows });
                }}
              />
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={charge.financed}
                  onChange={(event) => {
                    const rows = [...contract.charges];
                    rows[index] = { ...charge, financed: event.target.checked };
                    setContract({ ...contract, charges: rows });
                  }}
                />
                Financé par le prêt
              </label>
              <RemoveButton
                onClick={() =>
                  setContract({
                    ...contract,
                    charges: contract.charges.filter((_, row) => row !== index),
                  })
                }
              />
            </div>
          ))}
        </NestedSection>

        <NestedSection
          title="Lignes bancaires confirmées"
          onAdd={() =>
            setContract({
              ...contract,
              providedSchedule: [
                ...contract.providedSchedule,
                {
                  paymentNumber: contract.providedSchedule.length + 1,
                  dueDate: asOfDate,
                  openingBalance: 0,
                  interest: 0,
                  principal: 0,
                  insurance: 0,
                  fees: 0,
                  closingBalance: 0,
                },
              ],
            })
          }
        >
          {contract.providedSchedule.map((row, index) => (
            <div className="provided-schedule-row" key={`${row.paymentNumber}-${index}`}>
              {(
                [
                  ["paymentNumber", "N°", "1"],
                  ["openingBalance", "Ouverture", "0.01"],
                  ["interest", "Intérêt", "0.01"],
                  ["principal", "Principal", "0.01"],
                  ["insurance", "Assurance", "0.01"],
                  ["fees", "Frais", "0.01"],
                  ["closingBalance", "Clôture", "0.01"],
                ] as const
              ).map(([key, placeholder, step]) => (
                <input
                  className="text-input"
                  key={key}
                  type="number"
                  min="0"
                  step={step}
                  aria-label={placeholder}
                  placeholder={placeholder}
                  value={row[key]}
                  onChange={(event) => {
                    const rows = [...contract.providedSchedule];
                    rows[index] = { ...row, [key]: number(event.target.value) };
                    setContract({ ...contract, providedSchedule: rows });
                  }}
                />
              ))}
              <input
                className="text-input"
                type="date"
                value={row.dueDate}
                onChange={(event) => {
                  const rows = [...contract.providedSchedule];
                  rows[index] = { ...row, dueDate: event.target.value };
                  setContract({ ...contract, providedSchedule: rows });
                }}
              />
              <RemoveButton
                onClick={() =>
                  setContract({
                    ...contract,
                    providedSchedule: contract.providedSchedule.filter(
                      (_, rowIndex) => rowIndex !== index,
                    ),
                  })
                }
              />
            </div>
          ))}
        </NestedSection>
      </details>

      {loan ? (
        <label className="full">
          Motif de la correction (facultatif)
          <input
            className="text-input"
            maxLength={500}
            placeholder="Ex. taux mal recopié depuis l’offre"
            value={changeReason}
            onChange={(event) => setChangeReason(event.target.value)}
          />
          <small>
            Corriger une erreur de saisie crée une nouvelle version du contrat. Un changement réel
            (avenant, révision, report, remboursement) s’enregistre comme événement daté.
          </small>
        </label>
      ) : null}
      {formError ? (
        <p className="full" role="alert">
          {formError}
        </p>
      ) : null}
      {draftStatus ? (
        <p
          className={`full draft-status ${draftStatus.tone === "error" ? "form-error" : ""}`}
          role={draftStatus.tone === "error" ? "alert" : "status"}
        >
          {draftStatus.text}
        </p>
      ) : null}
      {draftConflict ? (
        <div className="full debt-draft-confirm">
          <button
            className="button secondary"
            disabled={savingDraft}
            onClick={() => saveDraft("replace")}
            type="button"
          >
            Remplacer par ma saisie
          </button>
          {draftKind === "DEBT_CONTRACT_NEW" ? (
            <button
              className="button secondary"
              disabled={savingDraft}
              onClick={() => saveDraft("copy")}
              type="button"
            >
              Enregistrer comme nouveau brouillon
            </button>
          ) : null}
        </div>
      ) : null}
      <div className="form-actions">
        <button type="button" className="button secondary" onClick={onCancel}>
          Annuler
        </button>
        {onSaveDraft ? (
          <button
            className="button secondary"
            disabled={busy || savingDraft}
            onClick={() => saveDraft()}
            type="button"
          >
            Enregistrer le brouillon
          </button>
        ) : null}
        <button className="button primary" disabled={busy}>
          <Save size={15} />
          {promoteFrom
            ? "Enregistrer le contrat"
            : existing
              ? "Enregistrer le contrat"
              : "Ajouter cette dette"}
        </button>
      </div>
    </form>
  );
}

function NestedSection({
  title,
  onAdd,
  children,
}: {
  title: string;
  onAdd: () => void;
  children: React.ReactNode;
}) {
  return (
    <section aria-label={title} className="debt-nested-editor">
      <header>
        <strong>{title}</strong>
        <button
          aria-label={`Ajouter une ligne : ${title}`}
          className="button secondary compact"
          onClick={onAdd}
          type="button"
        >
          <Plus size={13} /> Ajouter
        </button>
      </header>
      {/* Une liste vide est un tableau, donc « vraie » : c'est le nombre d'enfants qui compte. */}
      {Children.count(children) ? children : <small>Aucune ligne déclarée.</small>}
    </section>
  );
}

function RemoveButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="icon-button" onClick={onClick} aria-label="Supprimer la ligne">
      <Trash2 size={14} />
    </button>
  );
}

type PremiumFrequency =
  DebtContractInput["insurancePolicies"][number]["periods"][number]["frequency"];
const PREMIUM_FREQUENCIES: readonly string[] = ["MONTHLY", "QUARTERLY", "SEMIANNUAL", "ANNUAL"];
/**
 * Fréquence de débit pas encore choisie. Le brouillon la porte vide plutôt que « mensuelle » :
 * une fréquence supposée changerait le coût de l'assurance sans que personne l'ait déclarée.
 * Elle ne quitte jamais le formulaire, la soumission la refuse.
 */
const UNCHOSEN = "" as PremiumFrequency;
function isPaymentFrequency(value: string): value is PremiumFrequency {
  return PREMIUM_FREQUENCIES.includes(value);
}

function emptyPolicy(): DebtContractInput["insurancePolicies"][number] {
  return {
    insurer: null,
    contractReference: null,
    effectiveDate: null,
    endDate: null,
    insuredBase: null,
    debitAccountId: null,
    insured: [],
    periods: [
      { firstDebitDate: "", lastDebitDate: null, frequency: UNCHOSEN, premiumAmount: Number.NaN },
    ],
  };
}

/**
 * Polices d'une assurance SÉPARÉE (document 04, étape D) : assureur, contrat, assurés et
 * quotités, périodes de prime. Plusieurs assurés et plusieurs périodes sont permis ; la
 * quotité décrit une couverture et n'entre dans aucun calcul de passif.
 */
function InsurancePoliciesEditor({
  accounts,
  currency,
  policies,
  onChange,
}: {
  accounts: ReadonlyArray<{ id: string; name: string; institution: string }>;
  currency: string;
  policies: DebtContractInput["insurancePolicies"];
  onChange: (policies: DebtContractInput["insurancePolicies"]) => void;
}) {
  const update = (index: number, policy: DebtContractInput["insurancePolicies"][number]) =>
    onChange(policies.map((item, row) => (row === index ? policy : item)));
  return (
    <div className="full debt-insurance-policies">
      {policies.map((policy, index) => (
        <section className="debt-nested-editor" key={index} aria-label={`Police ${index + 1}`}>
          <header>
            <strong>Police {index + 1}</strong>
            <RemoveButton onClick={() => onChange(policies.filter((_, row) => row !== index))} />
          </header>
          <div className="form-grid">
            <label>
              Assureur (facultatif)
              <input
                className="text-input"
                maxLength={160}
                value={policy.insurer ?? ""}
                onChange={(event) =>
                  update(index, { ...policy, insurer: event.target.value || null })
                }
              />
            </label>
            <label>
              Référence du contrat (facultative)
              <input
                className="text-input"
                maxLength={160}
                value={policy.contractReference ?? ""}
                onChange={(event) =>
                  update(index, { ...policy, contractReference: event.target.value || null })
                }
              />
            </label>
            <label>
              Début de couverture (facultatif)
              <input
                className="text-input"
                type="date"
                value={policy.effectiveDate ?? ""}
                onChange={(event) =>
                  update(index, { ...policy, effectiveDate: event.target.value || null })
                }
              />
            </label>
            <label>
              Fin de couverture (facultative)
              <input
                className="text-input"
                type="date"
                value={policy.endDate ?? ""}
                onChange={(event) =>
                  update(index, { ...policy, endDate: event.target.value || null })
                }
              />
            </label>
            <div className="field-with-hint">
              <label>
                Base assurée (facultative)
                <select
                  aria-describedby={`insured-base-hint-${index}`}
                  className="text-input"
                  value={policy.insuredBase ?? ""}
                  onChange={(event) =>
                    update(index, {
                      ...policy,
                      insuredBase:
                        (event.target.value as NonNullable<typeof policy.insuredBase>) || null,
                    })
                  }
                >
                  <option value="">Inconnue</option>
                  <option value="INITIAL_CAPITAL">Capital initial</option>
                  <option value="OUTSTANDING_CAPITAL">Capital restant dû</option>
                  <option value="OTHER">Autre</option>
                </select>
              </label>
              <small id={`insured-base-hint-${index}`}>
                Information seulement : les primes restent celles des périodes déclarées.
              </small>
            </div>
            <label>
              Compte débité (facultatif)
              <select
                className="text-input"
                value={policy.debitAccountId ?? ""}
                onChange={(event) =>
                  update(index, { ...policy, debitAccountId: event.target.value || null })
                }
              >
                <option value="">Non renseigné</option>
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name} · {account.institution}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <strong>Assurés et quotités</strong>
          {policy.insured.map((person, personIndex) => (
            <div className="debt-editor-row" key={personIndex}>
              <input
                aria-label={`Nom de l’assuré ${personIndex + 1}`}
                className="text-input"
                maxLength={160}
                placeholder="Nom de l’assuré"
                value={person.name}
                onChange={(event) =>
                  update(index, {
                    ...policy,
                    insured: policy.insured.map((item, row) =>
                      row === personIndex ? { ...item, name: event.target.value } : item,
                    ),
                  })
                }
              />
              <input
                aria-label={`Quotité de l’assuré ${personIndex + 1}, en pourcentage`}
                className="text-input"
                inputMode="decimal"
                placeholder="Quotité %"
                value={
                  Number.isFinite(person.coverageShare) ? String(person.coverageShare * 100) : ""
                }
                onChange={(event) =>
                  update(index, {
                    ...policy,
                    insured: policy.insured.map((item, row) =>
                      row === personIndex
                        ? {
                            ...item,
                            // Quatre décimales en pourcentage = six en fraction, la précision
                            // exacte de la colonne : rien n'est arrondi en silence en base.
                            coverageShare:
                              Math.round(number(event.target.value) * 10_000) / 1_000_000,
                          }
                        : item,
                    ),
                  })
                }
              />
              <RemoveButton
                onClick={() =>
                  update(index, {
                    ...policy,
                    insured: policy.insured.filter((_, row) => row !== personIndex),
                  })
                }
              />
            </div>
          ))}
          <button
            className="button secondary compact"
            onClick={() =>
              update(index, {
                ...policy,
                insured: [...policy.insured, { name: "", coverageShare: Number.NaN }],
              })
            }
            type="button"
          >
            <Plus size={13} /> Ajouter un assuré
          </button>
          <strong>Périodes de prime</strong>
          <small className="muted-copy">
            Une variation de prime ouvre une nouvelle période : la précédente se clôt à son dernier
            débit. Seule la dernière période peut rester ouverte.
          </small>
          {policy.periods.map((period, periodIndex) => (
            <div className="debt-insurance-period" key={periodIndex}>
              <label>
                Premier débit
                <input
                  className="text-input"
                  type="date"
                  value={period.firstDebitDate}
                  onChange={(event) =>
                    update(index, {
                      ...policy,
                      periods: policy.periods.map((item, row) =>
                        row === periodIndex
                          ? { ...item, firstDebitDate: event.target.value }
                          : item,
                      ),
                    })
                  }
                  required
                />
              </label>
              <label>
                Dernier débit (vide = jusqu’à la dernière échéance du prêt)
                <input
                  className="text-input"
                  type="date"
                  value={period.lastDebitDate ?? ""}
                  onChange={(event) =>
                    update(index, {
                      ...policy,
                      periods: policy.periods.map((item, row) =>
                        row === periodIndex
                          ? { ...item, lastDebitDate: event.target.value || null }
                          : item,
                      ),
                    })
                  }
                />
              </label>
              <label>
                Fréquence des débits
                <select
                  className="text-input"
                  value={period.frequency}
                  onChange={(event) =>
                    update(index, {
                      ...policy,
                      periods: policy.periods.map((item, row) =>
                        row === periodIndex
                          ? {
                              ...item,
                              frequency: event.target.value as typeof period.frequency,
                            }
                          : item,
                      ),
                    })
                  }
                >
                  <option value="">Choisir la fréquence</option>
                  <option value="MONTHLY">Mensuelle</option>
                  <option value="QUARTERLY">Trimestrielle</option>
                  <option value="SEMIANNUAL">Semestrielle</option>
                  <option value="ANNUAL">Annuelle</option>
                </select>
              </label>
              <MoneyInput
                id={`debt-insurance-premium-${index}-${periodIndex}`}
                label="Prime par débit"
                currency={currency}
                value={Number.isFinite(period.premiumAmount) ? period.premiumAmount : null}
                onChange={(draft) =>
                  update(index, {
                    ...policy,
                    periods: policy.periods.map((item, row) =>
                      row === periodIndex
                        ? {
                            ...item,
                            premiumAmount: draft.state === "VALID" ? draft.value : Number.NaN,
                          }
                        : item,
                    ),
                  })
                }
                required
              />
              {policy.periods.length > 1 ? (
                <RemoveButton
                  onClick={() =>
                    update(index, {
                      ...policy,
                      periods: policy.periods.filter((_, row) => row !== periodIndex),
                    })
                  }
                />
              ) : null}
            </div>
          ))}
          <button
            className="button secondary compact"
            onClick={() =>
              update(index, {
                ...policy,
                periods: [
                  ...policy.periods,
                  {
                    firstDebitDate: "",
                    lastDebitDate: null,
                    frequency: UNCHOSEN,
                    premiumAmount: Number.NaN,
                  },
                ],
              })
            }
            type="button"
          >
            <Plus size={13} /> Ajouter une période (variation de prime)
          </button>
        </section>
      ))}
      <button
        className="button secondary"
        onClick={() => onChange([...policies, emptyPolicy()])}
        type="button"
      >
        <Plus size={15} /> Ajouter une police
      </button>
    </div>
  );
}

import { resolveContractTerms, summariseContract, type ContractSynthesis } from "@/lib/engine/debt";
import type { DebtContractInput } from "@/lib/data/contracts";
import type { Liability } from "@/lib/types";

/**
 * Brouillon de contrat → dette RÉSOLUE par le Debt Engine, pour la synthèse de l'étape F du
 * document 04. Ce module ne calcule rien : il traduit les champs du formulaire dans la forme
 * du moteur, puis délègue la résolution des termes et la synthèse au moteur.
 *
 * Tant que les termes de structure (mode, fréquence, convention, première échéance, capital,
 * taux) ne sont pas tous renseignés, aucune synthèse n'est produite : une synthèse sur des
 * valeurs par défaut ferait passer une supposition pour un calcul.
 */
export interface ContractDraftContext {
  id: string;
  currency: string | null;
  /** Encours observé : celui de la dette existante, ou l'encours initial saisi. */
  observedBalance: number | null;
  observedBalanceDate: string | null;
}

export function draftLiability(
  contract: DebtContractInput,
  context: ContractDraftContext,
): Liability | null {
  if (
    !contract.firstPaymentDate ||
    context.observedBalance === null ||
    !Number.isFinite(contract.principal) ||
    !Number.isFinite(contract.annualRate)
  )
    return null;
  const base: Liability = {
    id: context.id,
    name: contract.name,
    lender: contract.lender,
    principal: contract.principal,
    currentBalance: context.observedBalance,
    ...(context.currency ? { currency: context.currency } : {}),
    ...(context.observedBalanceDate ? { balanceDate: context.observedBalanceDate } : {}),
    annualRate: contract.annualRate,
    monthlyPayment: 0,
    paymentCount: 0,
    firstPaymentDate: contract.firstPaymentDate,
    maturityDate: "",
    monthlyInsurance: contract.insuranceAmount,
    recurringFees: contract.recurringFees,
    paymentIncludesInsurance: contract.paymentIncludesInsurance,
    insuranceMode: contract.insuranceMode,
    // Une période sans date, fréquence ou prime lisible n'est pas projetée : rien n'est supposé.
    insurancePolicies: contract.insurancePolicies.map((policy, index) => ({
      id: `draft-policy-${index}`,
      insurer: policy.insurer,
      contractReference: policy.contractReference,
      insured: policy.insured,
      periods: policy.periods.filter(
        (period) =>
          period.firstDebitDate !== "" &&
          (period.frequency as string) !== "" &&
          Number.isFinite(period.premiumAmount),
      ),
    })),
    deferral: contract.deferral,
    amortisationProfile: contract.amortisationProfile,
    balloonAmount: contract.balloonAmount,
    paymentFrequency: contract.paymentFrequency,
    interestConvention: contract.interestConvention,
    rateType: contract.rateType,
    rateSchedule: contract.rateSchedule,
    paymentSchedule: contract.paymentSchedule,
    earlyRepayments: contract.earlyRepayments.map((repayment) => ({
      ...repayment,
      liabilityId: context.id,
    })),
    // Un frais en cours de saisie (sans date ni montant) n'entre pas dans la synthèse.
    oneOffCharges: contract.charges
      .filter((charge) => charge.date !== "" && Number.isFinite(charge.amount) && charge.amount > 0)
      .map((charge) => ({ ...charge, liabilityId: context.id })),
    providedSchedule: contract.providedSchedule,
    facilityId: contract.facilityId,
    provenance: { kind: "USER_ASSUMPTION", confidence: "HIGH" },
  };
  return resolveContractTerms(base, {
    monthlyPayment: contract.paymentAmount,
    paymentCount: contract.paymentCount,
    maturityDate: contract.maturityDate,
  });
}

export function draftSynthesis(
  contract: DebtContractInput,
  context: ContractDraftContext,
  asOfDate: string,
): ContractSynthesis | null {
  const liability = draftLiability(contract, context);
  return liability ? summariseContract(liability, asOfDate) : null;
}

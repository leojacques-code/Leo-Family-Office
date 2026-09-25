import { describe, expect, it } from "vitest";
import {
  restoreContractDraft,
  serializeContractDraft,
  type ContractDraftState,
} from "../contract-draft-storage";
import type { DebtContractInput } from "@/lib/data/contracts";

const contract = {
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
  amortisationProfile: "AMORTIZING",
  balloonAmount: null,
  paymentFrequency: "MONTHLY",
  interestConvention: "PROPORTIONAL",
  rateType: "FIXED",
  insuranceAmount: null,
  recurringFees: null,
  paymentIncludesInsurance: null,
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
} as DebtContractInput;
const base: ContractDraftState = {
  contract,
  structure: { mode: "", paymentFrequency: "", interestConvention: "", rateType: "" },
  requiredValues: { principal: null, initialBalance: null, annualRate: null },
  insurance: { choice: "", policies: [] },
};

describe("Brouillon de contrat : sérialisation et relecture défensive", () => {
  it("rend une saisie incomplète telle quelle, montants absents compris", () => {
    const typed: ContractDraftState = {
      ...base,
      contract: {
        ...contract,
        name: "Prêt immobilier",
        paymentAmount: 850,
        maturityDate: "2046-01-05",
      },
      structure: { ...base.structure, mode: "AMORTIZING" },
      requiredValues: { principal: 200_000, initialBalance: null, annualRate: null },
      insurance: {
        choice: "SEPARATE",
        policies: [
          {
            insurer: null,
            contractReference: null,
            effectiveDate: null,
            endDate: null,
            insuredBase: null,
            debitAccountId: null,
            insured: [{ name: "A", coverageShare: Number.NaN }],
            periods: [
              {
                firstDebitDate: "",
                lastDebitDate: null,
                frequency: "MONTHLY",
                premiumAmount: Number.NaN,
              },
            ],
          },
        ],
      },
    };
    const restored = restoreContractDraft(
      JSON.parse(JSON.stringify(serializeContractDraft(typed))),
      base,
    );
    expect(restored.contract.name).toBe("Prêt immobilier");
    expect(restored.contract.paymentAmount).toBe(850);
    expect(restored.contract.maturityDate).toBe("2046-01-05");
    expect(Number.isNaN(restored.contract.principal)).toBe(true);
    expect(restored.structure.mode).toBe("AMORTIZING");
    expect(restored.requiredValues).toEqual({
      principal: 200_000,
      initialBalance: null,
      annualRate: null,
    });
    // Un montant absent reste absent (NaN), il ne devient jamais zéro.
    expect(Number.isNaN(restored.insurance.policies[0]!.periods[0]!.premiumAmount)).toBe(true);
    expect(Number.isNaN(restored.insurance.policies[0]!.insured[0]!.coverageShare)).toBe(true);
  });

  it("écarte les valeurs de mauvaise forme et ne reprend jamais la dette visée du brouillon", () => {
    const restored = restoreContractDraft(
      {
        contract: { liabilityId: "autre-dette", name: 42, paymentAmount: "850", principal: "1e9" },
        structure: { mode: "PYRAMIDE", rateType: "FIXED" },
        requiredValues: { principal: "cent" },
        insurance: { choice: "PEUT-ÊTRE", policies: "aucune" },
      },
      { ...base, contract: { ...contract, liabilityId: "dette-ouverte" } },
    );
    expect(restored.contract.liabilityId).toBe("dette-ouverte");
    expect(restored.contract.name).toBe("");
    expect(restored.contract.paymentAmount).toBeNull();
    expect(Number.isNaN(restored.contract.principal)).toBe(true);
    expect(restored.structure).toEqual({ ...base.structure, rateType: "FIXED" });
    expect(restored.requiredValues.principal).toBeNull();
    expect(restored.insurance).toEqual(base.insurance);
  });
});

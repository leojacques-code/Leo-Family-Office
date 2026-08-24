import { describe, expect, it } from "vitest";

import { mutationSchema } from "@/lib/validation/mutations";

const contract = {
  liabilityId: null,
  name: "Prêt immobilier",
  lender: "Banque",
  principal: 100000,
  initialBalance: 100000,
  balanceDate: "2026-08-19",
  annualRate: 0.036,
  paymentAmount: 702.13,
  paymentCount: 240,
  firstPaymentDate: "2026-09-05",
  maturityDate: "2046-08-05",
  amortisationProfile: "AMORTIZING" as const,
  balloonAmount: null,
  paymentFrequency: "MONTHLY" as const,
  interestConvention: "PROPORTIONAL" as const,
  rateType: "FIXED" as const,
  insuranceAmount: null,
  recurringFees: 0,
  paymentIncludesInsurance: null,
  deferral: null,
  facilityId: null,
  notes: null,
  rateSchedule: [],
  paymentSchedule: [],
  earlyRepayments: [],
  charges: [],
  providedSchedule: [],
};

describe("mutations Debt Contract Input", () => {
  it("préserve la différence entre null et zéro", () => {
    const result = mutationSchema.safeParse({ action: "save_debt_contract", contract });
    expect(result.success).toBe(true);
    if (!result.success || result.data.action !== "save_debt_contract") return;
    expect(result.data.contract.insuranceAmount).toBeNull();
    expect(result.data.contract.recurringFees).toBe(0);
    expect(result.data.contract.paymentIncludesInsurance).toBeNull();
  });

  it("n’exige pas d’encours dans une édition de contrat", () => {
    const result = mutationSchema.safeParse({
      action: "save_debt_contract",
      contract: {
        ...contract,
        liabilityId: "22222222-2222-4222-8222-222222222222",
        initialBalance: null,
        balanceDate: null,
      },
    });
    expect(result.success).toBe(true);
  });

  it("exige l’encours initial à la création", () => {
    const result = mutationSchema.safeParse({
      action: "save_debt_contract",
      contract: { ...contract, initialBalance: null },
    });
    expect(result.success).toBe(false);
  });

  it("exige un solde final pour un balloon", () => {
    const result = mutationSchema.safeParse({
      action: "save_debt_contract",
      contract: { ...contract, amortisationProfile: "BALLOON", balloonAmount: null },
    });
    expect(result.success).toBe(false);
  });

  it("valide séparément une observation d’encours", () => {
    expect(
      mutationSchema.safeParse({
        action: "record_debt_balance",
        liabilityId: "22222222-2222-4222-8222-222222222222",
        observedAt: "2026-08-25",
        balance: 99850,
        notes: null,
      }).success,
    ).toBe(true);
  });
});

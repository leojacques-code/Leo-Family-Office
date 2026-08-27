import { describe, expect, it } from "vitest";

import { mutationSchema } from "@/lib/validation/mutations";

const provenance = { confidence: "HIGH" as const, source: "Contrat", notes: null };

describe("Career + Tax V2 mutation contracts", () => {
  it("accepts a dated career package without inventing missing compensation", () => {
    expect(
      mutationSchema.safeParse({
        action: "save_career_package",
        career: {
          roleId: null,
          employer: "ACME",
          jobTitle: "Analyst",
          employmentType: "EMPLOYEE",
          industry: null,
          country: "FR",
          currency: "EUR",
          startDate: "2026-01-01",
          endDate: null,
          status: "ACTIVE",
          dataKind: "CONTRACTUAL",
          ...provenance,
          compensation: null,
        },
      }).success,
    ).toBe(true);
  });

  it("requires a payment date for a PAID variable", () => {
    const result = mutationSchema.safeParse({
      action: "record_career_event",
      event: {
        roleId: null,
        type: "BONUS_PAID",
        eventDate: "2026-03-01",
        amount: 5_000,
        currency: "EUR",
        variableState: "PAID",
        paidDate: null,
        label: "Bonus",
        dataKind: "ACTUAL",
        ...provenance,
      },
    });
    expect(result.success).toBe(false);
  });

  it("accepts a sourced, versioned parametric tax rule set", () => {
    expect(
      mutationSchema.safeParse({
        action: "save_tax_rule_set",
        ruleSet: {
          id: null,
          jurisdiction: "FR",
          taxYear: 2026,
          name: "Hypothèses déclarées",
          effectiveFrom: "2026-01-01",
          effectiveTo: null,
          source: "Utilisateur",
          sourceDate: "2026-01-01",
          confidence: "MEDIUM",
          status: "DECLARED",
          legalReference: null,
          notes: null,
          rules: [
            {
              name: "Retenue",
              taxType: "WITHHOLDING_RATE",
              incomeCategory: "EMPLOYMENT",
              parameters: { rate: 0.1 },
              effectiveFrom: "2026-01-01",
              effectiveTo: null,
              verifiedAt: null,
              confidence: "MEDIUM",
              legalNote: null,
              notes: null,
            },
          ],
        },
      }).success,
    ).toBe(true);
  });

  it("rejects negative observed tax cash", () => {
    expect(
      mutationSchema.safeParse({
        action: "record_tax_observation",
        observation: {
          type: "PAID",
          observedDate: "2026-05-15",
          taxYear: 2026,
          amount: -1,
          currency: "EUR",
          transactionId: null,
          documentId: null,
          ...provenance,
        },
      }).success,
    ).toBe(false);
  });
});

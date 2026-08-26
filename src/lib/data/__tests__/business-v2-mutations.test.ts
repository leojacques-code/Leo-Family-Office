import { describe, expect, it } from "vitest";

import { mutationSchema } from "@/lib/validation/mutations";

const BUSINESS_ID = "11111111-1111-4111-8111-111111111111";

const quickStart = {
  action: "create_business_quick_start" as const,
  quickStart: {
    name: "Atelier test",
    legalForm: "SAS",
    type: "OPERATING" as const,
    currency: "EUR",
    sector: null,
    country: null,
    periodEnd: "2025-12-31",
    periodKind: "ANNUAL" as const,
    periodLabel: "FY2025",
    revenue: null,
    ebitda: 100_000,
    cash: 0,
    grossDebt: 0,
    legalRate: 1,
    economicRate: 1,
    valuationDate: "2026-08-19",
    method: "EBITDA_MULTIPLE" as const,
    multiple: 6,
    multipleLow: null,
    multipleHigh: null,
    bridgeStatus: "DECLARED_NONE" as const,
    capitalHistoryStart: null,
    capitalHistorySource: "UNKNOWN" as const,
    notes: null,
  },
};

describe("Business V2.1 — validation des inconnues et mutations composées", () => {
  it("refuse dette et cash vides dans le Quick Start, mais accepte les zéros explicites", () => {
    expect(mutationSchema.safeParse(quickStart).success).toBe(true);
    expect(
      mutationSchema.safeParse({
        ...quickStart,
        quickStart: { ...quickStart.quickStart, cash: null },
      }).success,
    ).toBe(false);
    expect(
      mutationSchema.safeParse({
        ...quickStart,
        quickStart: { ...quickStart.quickStart, grossDebt: null },
      }).success,
    ).toBe(false);
  });

  it("exige l’agrégat sélectionné, le multiple et une détention économique valide", () => {
    expect(
      mutationSchema.safeParse({
        ...quickStart,
        quickStart: { ...quickStart.quickStart, ebitda: null },
      }).success,
    ).toBe(false);
    expect(
      mutationSchema.safeParse({
        ...quickStart,
        quickStart: { ...quickStart.quickStart, multiple: 0 },
      }).success,
    ).toBe(false);
    expect(
      mutationSchema.safeParse({
        ...quickStart,
        quickStart: { ...quickStart.quickStart, economicRate: 0 },
      }).success,
    ).toBe(false);
  });

  it("refuse un taux fiscal DCF absent et accepte 0 % lorsqu’il est explicite", () => {
    const dcf = {
      action: "set_business_dcf" as const,
      dcf: {
        businessId: BUSINESS_ID,
        valuationDate: "2026-08-19",
        currency: "EUR",
        wacc: 0.1,
        taxRate: 0,
        terminalMethod: "PERPETUAL_GROWTH" as const,
        terminalGrowth: 0.02,
        terminalExitMultiple: null,
        terminalExitMetric: null,
        discountConvention: "YEAR_END" as const,
        periods: [
          {
            yearIndex: 1,
            revenue: null,
            ebitda: null,
            ebit: 100_000,
            depreciationAmortisation: 10_000,
            capex: 20_000,
            workingCapitalChange: 5_000,
          },
        ],
        notes: null,
      },
    };
    expect(mutationSchema.safeParse(dcf).success).toBe(true);
    expect(mutationSchema.safeParse({ ...dcf, dcf: { ...dcf.dcf, taxRate: null } }).success).toBe(
      false,
    );
  });

  it("exige et signe correctement la variation des acquisitions, cessions et rachats", () => {
    const event = {
      action: "record_business_capital_event" as const,
      event: {
        businessId: BUSINESS_ID,
        type: "ACQUISITION" as const,
        eventDate: "2026-08-19",
        amount: 10_000,
        amountScope: "USER_CASH" as const,
        fees: null,
        currency: "EUR",
        ownershipDelta: 0.15,
        ownershipRateAfter: 0.35,
        sharesDelta: null,
        pricePerShare: null,
        label: null,
        transactionId: null,
        notes: null,
      },
    };
    expect(mutationSchema.safeParse(event).success).toBe(true);
    expect(
      mutationSchema.safeParse({
        ...event,
        event: { ...event.event, ownershipRateAfter: null },
      }).success,
    ).toBe(false);
    expect(
      mutationSchema.safeParse({
        ...event,
        event: { ...event.event, type: "SALE", ownershipDelta: 0.15 },
      }).success,
    ).toBe(false);
    expect(
      mutationSchema.safeParse({
        ...event,
        event: { ...event.event, type: "SALE", ownershipDelta: -0.3, ownershipRateAfter: 0.7 },
      }).success,
    ).toBe(true);
  });
});

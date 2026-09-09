import { describe, expect, it } from "vitest";
import { OBLIGATION_WINDOW_DAYS, buildObligations } from "@/lib/presentation/today/obligations";
import { CANONICAL_EVENT_TYPE_LABELS } from "@/lib/presentation/language/events";
import { CANONICAL_EVENT_TYPES, type CanonicalEvent } from "@/lib/engine/event-contracts";

/**
 * Échéances à trente jours (§20 item 6).
 *
 * DEUX FILTRES, ET AUCUN NE REMPLACE L'AUTRE. La nature de preuve dit si l'on peut se fier à
 * la date ; le type d'événement dit si l'objet EST une échéance. Le défaut trouvé par le jeu
 * de démonstration venait d'avoir cru que le premier suffisait.
 */

function event(
  overrides: Partial<CanonicalEvent> & Pick<CanonicalEvent, "id" | "type">,
): CanonicalEvent {
  return {
    domain: "DEBT",
    effectiveDate: "2026-09-20",
    eventDate: "2026-09-20",
    createdAt: null,
    dataKind: "CONTRACTUAL",
    confidence: "HIGH",
    source: null,
    provenance: {
      source: null,
      sourceRecordId: null,
      engine: "test",
      formulaReference: null,
      assumptions: [],
    },
    target: { entityType: "LIABILITY", entityId: null },
    status: "PLANNED",
    shape: "SCHEDULE_CONSEQUENCE",
    effectiveConvention: "IMMEDIATE",
    sequence: 1,
    supersededBy: null,
    scenarioId: null,
    blockers: [],
    consequences: [],
    ...overrides,
  };
}

const base = { asOfDate: "2026-09-08", reportingCurrency: "EUR" };

describe("ce qui EST une échéance", () => {
  it("retient une échéance de prêt contractuelle dans la fenêtre", () => {
    const found = buildObligations({
      ...base,
      events: [event({ id: "e1", type: "LOAN_PAYMENT" })],
    });
    expect(found).toHaveLength(1);
    expect(found[0]!.label).toBe("Échéance de prêt");
    expect(found[0]!.domainLabel).toBe("Dettes");
  });

  it("EXCLUT une opération bancaire déjà comptabilisée", () => {
    // Le défaut trouvé par la démonstration : la page annonçait « Opération observée · Flux ·
    // 34 € » comme une échéance à venir. Une opération bookée a déjà eu lieu.
    const found = buildObligations({
      ...base,
      events: [
        event({
          id: "e1",
          type: "OBSERVED_TRANSACTION",
          domain: "CASH_FLOW",
          dataKind: "OBSERVED",
        }),
      ],
    });
    expect(found).toHaveLength(0);
  });

  it("EXCLUT une projection et une hypothèse, même de bon type", () => {
    for (const dataKind of ["PROJECTED", "USER_ASSUMPTION", "MODEL_ASSUMPTION"] as const) {
      const found = buildObligations({
        ...base,
        events: [event({ id: `e-${dataKind}`, type: "LOAN_PAYMENT", dataKind })],
      });
      expect(found, dataKind).toHaveLength(0);
    }
  });

  it("EXCLUT un événement annulé ou remplacé", () => {
    for (const status of ["CANCELLED", "SUPERSEDED"] as const) {
      const found = buildObligations({
        ...base,
        events: [event({ id: `e-${status}`, type: "LOAN_PAYMENT", status })],
      });
      expect(found, status).toHaveLength(0);
    }
  });
});

describe("la fenêtre est EXACTEMENT trente jours", () => {
  it("retient le trentième jour et rejette le trente-et-unième", () => {
    const inside = buildObligations({
      ...base,
      events: [event({ id: "in", type: "LOAN_PAYMENT", effectiveDate: "2026-10-08" })],
    });
    const outside = buildObligations({
      ...base,
      events: [event({ id: "out", type: "LOAN_PAYMENT", effectiveDate: "2026-10-09" })],
    });
    expect(OBLIGATION_WINDOW_DAYS).toBe(30);
    expect(inside).toHaveLength(1);
    expect(outside).toHaveLength(0);
  });

  it("retient la date d'arrêté elle-même et rejette la veille", () => {
    expect(
      buildObligations({
        ...base,
        events: [event({ id: "today", type: "LOAN_PAYMENT", effectiveDate: "2026-09-08" })],
      }),
    ).toHaveLength(1);
    expect(
      buildObligations({
        ...base,
        events: [event({ id: "past", type: "LOAN_PAYMENT", effectiveDate: "2026-09-07" })],
      }),
    ).toHaveLength(0);
  });
});

describe("montant attendu", () => {
  it("reste `null` quand aucune conséquence ne porte de flux : ce n'est pas zéro", () => {
    // Une fin de bail ou une expiration d'assurance sont des échéances sans montant.
    const found = buildObligations({
      ...base,
      events: [event({ id: "e1", type: "LEASE_END", domain: "REAL_ESTATE" })],
    });
    expect(found[0]!.amount).toBeNull();
  });

  it("reste `null` dès qu'une devise diffère de la devise de reporting", () => {
    const found = buildObligations({
      ...base,
      events: [
        event({
          id: "e1",
          type: "LOAN_PAYMENT",
          consequences: [
            {
              id: "c1",
              month: "2026-09",
              economicDate: "2026-09-20",
              sourceDomain: "DEBT",
              sourceEntityId: null,
              sourceEventId: "e1",
              eventType: "LOAN_PAYMENT",
              effectKind: "DEBT_SERVICE",
              currency: "USD",
              cashIn: null,
              cashOut: 300,
            } as unknown as CanonicalEvent["consequences"][number],
          ],
        }),
      ],
    });
    // FX ABSENT ≠ FX ÉGAL À 1 : Aujourd'hui ne convertit pas ce que le moteur de change n'a
    // pas converti.
    expect(found[0]!.amount).toBeNull();
  });
});

describe("traduction des types d'événement", () => {
  it("porte un libellé français pour les soixante-et-un types canoniques", () => {
    for (const type of CANONICAL_EVENT_TYPES) {
      const label = CANONICAL_EVENT_TYPE_LABELS[type];
      expect(label, type).toBeTruthy();
      // Un code anglais dont on retire les soulignés n'est pas du français.
      expect(label, type).not.toMatch(/[A-Z]{2,}/);
      expect(label, type).not.toContain("_");
    }
  });
});

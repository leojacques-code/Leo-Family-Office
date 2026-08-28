import { describe, expect, it } from "vitest";
import { createGoalVersion } from "@/lib/engine/goal-engine";
import { mapGoal } from "@/lib/data/supabase-repository";
import { mutationSchema } from "@/lib/validation/mutations";

const row = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  user_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  name: "Legacy",
  target_amount: 100_000,
  target_date: "2032-12-31",
  priority: 2,
  status: "ACTIVE",
  current_version: 3,
  constraint_strength: "SOFT",
  created_at: "2026-08-28T00:00:00.000Z",
  updated_at: "2026-08-28T00:00:00.000Z",
  archived_at: null,
};

describe("Goals V2 persistence contracts", () => {
  it("mappe le snapshot V2 courant plutôt que les colonnes legacy", () => {
    const definition = {
      ...createGoalVersion({
        goalId: row.id,
        name: "Liquidité cible",
        target: {
          metric: "IMMEDIATE_CASH" as const,
          operator: "AT_LEAST" as const,
          value: 30_000,
          currency: "EUR",
          entityId: null,
        },
        targetDate: "2030-06-15",
        createdAt: row.updated_at,
      }),
      version: 3,
    };
    const mapped = mapGoal(row, definition, "EUR");
    expect(mapped).toMatchObject({
      name: "Liquidité cible",
      targetAmount: 30_000,
      targetDate: "2030-06-15",
      version: 3,
    });
    expect(mapped.definition?.target.metric).toBe("IMMEDIATE_CASH");
  });

  it("convertit explicitement un goal legacy en NET_WORTH AT_LEAST", () => {
    const mapped = mapGoal({ ...row, current_version: undefined }, undefined, "EUR");
    expect(mapped.definition).toMatchObject({
      schemaVersion: 2,
      version: 1,
      legacyCompatibility: true,
      target: { metric: "NET_WORTH", operator: "AT_LEAST", currency: "EUR" },
    });
  });

  it("accepte une création V2 complète", () => {
    const definition = createGoalVersion({
      goalId: row.id,
      name: "Patrimoine",
      target: {
        metric: "NET_WORTH",
        operator: "AT_LEAST",
        value: 1_000_000,
        currency: "EUR",
        entityId: null,
      },
    });
    expect(mutationSchema.safeParse({ action: "create_goal_v2", definition }).success).toBe(true);
  });

  it("refuse une version sans optimistic lock", () => {
    const definition = createGoalVersion({
      goalId: row.id,
      name: "Patrimoine",
      target: {
        metric: "NET_WORTH",
        operator: "AT_LEAST",
        value: 1_000_000,
        currency: "EUR",
        entityId: null,
      },
    });
    expect(
      mutationSchema.safeParse({ action: "save_goal_version_v2", goalId: row.id, definition })
        .success,
    ).toBe(false);
  });

  it("valide les quatre transitions de cycle de vie", () => {
    for (const status of ["ACTIVE", "PAUSED", "ACHIEVED", "ARCHIVED"] as const) {
      expect(
        mutationSchema.safeParse({
          action: "set_goal_status_v2",
          goalId: row.id,
          expectedVersion: 3,
          status,
        }).success,
      ).toBe(true);
    }
  });
});

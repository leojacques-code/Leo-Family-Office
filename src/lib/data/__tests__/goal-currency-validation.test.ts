import { describe, expect, it } from "vitest";
import { mutationSchema } from "@/lib/validation/mutations";
import { createGoalVersion } from "@/lib/engine/goal-engine";

describe("devise d’objectif à la frontière de persistance, sans calcul", () => {
  it.each(["create_goal_v2", "save_goal_version_v2"] as const)(
    "%s refuse null comme SQL, préserve USD et zéro",
    (action) => {
      const definition = createGoalVersion({
        purpose: "CAPITAL",
        goalId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        name: "Fixture devise",
        target: {
          metric: "NET_WORTH",
          operator: "AT_LEAST",
          value: 0,
          currency: "USD",
          entityId: null,
        },
      });
      const command =
        action === "create_goal_v2"
          ? { action, definition }
          : { action, definition, goalId: definition.goalId, expectedVersion: 1 };
      expect(mutationSchema.parse(command)).toMatchObject({
        definition: { target: { currency: "USD", value: 0 } },
      });
      const refused = mutationSchema.safeParse({
        ...command,
        definition: { ...definition, target: { ...definition.target, currency: null } },
      });
      expect(refused.success).toBe(false);
      if (!refused.success)
        expect(refused.error.issues).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              message: "La devise de la cible doit être déclarée avant l’enregistrement",
            }),
          ]),
        );
    },
  );
});

import { describe, expect, it } from "vitest";
import { mutationSchema } from "@/lib/validation/mutations";
import { readDecisionResult } from "@/lib/data/decision-snapshots";
import { decisionCurrencyFixture } from "./decision-currency.fixture";

const command = (result: ReturnType<typeof decisionCurrencyFixture>) => ({
  action: "save_decision_run_v2",
  caseId: result.caseVersion.caseId,
  caseVersion: 1,
  run: result.run,
  result,
});
describe("Devise du snapshot Decision Lab : validation et relecture, sans calcul", () => {
  it.each(["USD", "CHF", null, undefined])(
    "conserve %s au passage commande → JSON → lecteur",
    (currency) => {
      const result = decisionCurrencyFixture();
      result.reportingCurrency = currency;
      const parsed = mutationSchema.parse(command(result));
      if (parsed.action !== "save_decision_run_v2") throw new Error("Commande inattendue");
      const reloaded = readDecisionResult(JSON.parse(JSON.stringify(parsed.result)));
      expect(reloaded).toBeDefined();
      expect(reloaded?.reportingCurrency).toBe(currency);
      expect(reloaded?.options[0].goalImpacts[0].option.observation?.currency).toBe("CHF");
    },
  );
  it.each(["", "usd", "US", 42, {}])(
    "refuse une devise malformée (%s) sans inventer EUR",
    (currency) => {
      const result = { ...decisionCurrencyFixture(), reportingCurrency: currency };
      expect(
        mutationSchema.safeParse({ ...command(decisionCurrencyFixture()), result }).success,
      ).toBe(false);
      expect(readDecisionResult(result)).toBeUndefined();
    },
  );
});

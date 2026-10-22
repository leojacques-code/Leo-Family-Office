import { describe, expect, it } from "vitest";
import { setupEntryFor, setupReturnTo } from "../personal-setup-navigation";
describe("Premier accès personnel", () => {
  it.each(["/", "/debt", "/net-worth?view=detail"])(
    "passe par les choix initiaux et conserve %s",
    (next) => {
      expect(setupEntryFor(next)).toBe(`/setup?next=${encodeURIComponent(next)}`);
      expect(setupReturnTo(next)).toBe(next);
    },
  );
  it.each([
    "//evil.invalid",
    "/\\evil.invalid",
    "/\n/evil.invalid",
    "https://evil.invalid",
    "/setup",
    "/login",
    null,
  ])("refuse une destination externe ou cyclique : %s", (value) =>
    expect(setupReturnTo(value)).toBe("/"),
  );
});

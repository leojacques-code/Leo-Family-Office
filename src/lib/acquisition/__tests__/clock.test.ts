import { describe, expect, it } from "vitest";

import { civilDateIn, DEFAULT_TIME_ZONE, resolveTimeZone } from "@/lib/acquisition/clock";

describe("date civile d'observation", () => {
  it("00 h 30 à Paris en été n'est pas la date UTC de la veille", () => {
    // 2026-07-14T22:30:00Z correspond au 15 juillet 00 h 30 à Paris.
    const instant = new Date("2026-07-14T22:30:00.000Z");
    expect(instant.toISOString().slice(0, 10)).toBe("2026-07-14");
    expect(civilDateIn(instant, "Europe/Paris")).toBe("2026-07-15");
  });

  it("00 h 30 à Paris en hiver aussi", () => {
    const instant = new Date("2026-01-14T23:30:00.000Z");
    expect(instant.toISOString().slice(0, 10)).toBe("2026-01-14");
    expect(civilDateIn(instant, "Europe/Paris")).toBe("2026-01-15");
  });

  it("23 h 30 à Paris reste le jour local, pas le lendemain UTC", () => {
    const instant = new Date("2026-07-15T21:30:00.000Z");
    expect(civilDateIn(instant, "Europe/Paris")).toBe("2026-07-15");
  });

  it("un fuseau à l'ouest de Greenwich décale dans l'autre sens", () => {
    const instant = new Date("2026-07-15T03:00:00.000Z");
    expect(civilDateIn(instant, "America/New_York")).toBe("2026-07-14");
    expect(civilDateIn(instant, "UTC")).toBe("2026-07-15");
  });

  it("le fuseau par défaut est celui du produit", () => {
    expect(resolveTimeZone(undefined)).toBe(DEFAULT_TIME_ZONE);
    expect(resolveTimeZone("   ")).toBe(DEFAULT_TIME_ZONE);
    expect(resolveTimeZone("UTC")).toBe("UTC");
  });

  it("un fuseau inconnu ÉCHOUE au lieu de se replier sur l'UTC", () => {
    expect(() => resolveTimeZone("Mars/Olympus")).toThrow(/LFO_TIME_ZONE invalide/);
  });
});

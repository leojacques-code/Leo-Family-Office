import { describe, expect, it } from "vitest";
import { railSourcesFor } from "@/lib/presentation/rail-sources";
import { PAGE_REGISTRY } from "@/lib/presentation/registry/pages";
import type { PageManifest } from "@/lib/presentation/registry/contracts";
import type { DashboardState } from "@/lib/types";

/**
 * L'état est construit à la main, champ par champ, et NON repris d'un fixture complet.
 *
 * C'est délibéré : la question posée au rail est « cette famille de faits est-elle
 * présente ? ». Un fixture riche répondrait « oui » partout et ne prouverait donc jamais le
 * cas ABSENTE, qui est celui où le produit peut mentir.
 */
const empty = {} as DashboardState;

function stateWith(patch: Partial<DashboardState>): DashboardState {
  return patch as DashboardState;
}

describe("railSourcesFor — pertinence déclarée, état lu dans les faits", () => {
  it("ne rend aucune source pour une page sans manifeste", () => {
    expect(railSourcesFor(null, empty)).toEqual([]);
  });

  it("ne rend aucune source pour une page qui ne déclare pas la zone", () => {
    // Today et Rapports n'ont pas de rail : Today lit les vérités des autres domaines, un
    // rapport restitue au lieu de s'alimenter.
    expect(PAGE_REGISTRY.today.zones).not.toContain("SOURCE_RAIL");
    expect(railSourcesFor(PAGE_REGISTRY.today, empty)).toEqual([]);
    expect(PAGE_REGISTRY.reports.zones).not.toContain("SOURCE_RAIL");
    expect(railSourcesFor(PAGE_REGISTRY.reports, empty)).toEqual([]);
  });

  it("ignore des sources déclarées si la zone ne l'est pas", () => {
    // Le gate de registre refuse déjà cette incohérence ; la lecture ne s'y fie pas, parce
    // qu'un manifeste construit à la main dans un test ou une future page contourne le gate.
    const manifest = {
      ...PAGE_REGISTRY.debt,
      zones: ["OPERATIONAL_HEADER", "FINANCIAL_CANVAS"],
    } as unknown as PageManifest;
    expect(railSourcesFor(manifest, empty)).toEqual([]);
  });

  it("rend une ligne par déclaration, dans l'ordre du manifeste", () => {
    const derived = railSourcesFor(PAGE_REGISTRY.debt, empty);
    expect(derived.map((s) => s.id)).toEqual(PAGE_REGISTRY.debt.sources.map((s) => s.id));
    // §24 : « l'échéancier bancaire fourni domine la reconstruction ». Il vient en premier.
    expect(derived[0]?.id).toBe("provided-schedule");
  });

  it("déclare ABSENTE une source dont aucun fait n'existe", () => {
    const derived = railSourcesFor(PAGE_REGISTRY.debt, empty);
    expect(derived.every((s) => s.status === "ABSENTE")).toBe(true);
    expect(derived.every((s) => s.latestDate === null)).toBe(true);
  });

  it("déclare ACTIVE une source dont un fait existe, et porte la date la PLUS RÉCENTE", () => {
    const derived = railSourcesFor(
      PAGE_REGISTRY.debt,
      stateWith({
        liabilities: [
          { balanceDate: "2026-07-31", providedSchedule: [] },
          { balanceDate: "2026-08-31", providedSchedule: [] },
        ] as unknown as DashboardState["liabilities"],
      }),
    );
    const contract = derived.find((s) => s.id === "contract");
    expect(contract?.status).toBe("ACTIVE");
    // La plus récente, pas la première rencontrée : un rail qui affiche la première date
    // annoncerait un contrat plus vieux qu'il n'est.
    expect(contract?.latestDate).toBe("2026-08-31");
  });

  it("ne compte pas un échéancier VIDE comme un échéancier fourni", () => {
    // Le cas subtil du §24 : une dette existe, mais aucun échéancier bancaire n'a été fourni.
    // Compter la dette au lieu de ses lignes dirait « À jour » sur une reconstruction.
    const derived = railSourcesFor(
      PAGE_REGISTRY.debt,
      stateWith({
        liabilities: [
          { balanceDate: "2026-08-31", providedSchedule: [] },
        ] as unknown as DashboardState["liabilities"],
      }),
    );
    expect(derived.find((s) => s.id === "contract")?.status).toBe("ACTIVE");
    expect(derived.find((s) => s.id === "provided-schedule")?.status).toBe("ABSENTE");
  });

  it("déclare ACTIVE l'échéancier dès qu'une seule dette en porte un", () => {
    const derived = railSourcesFor(
      PAGE_REGISTRY.debt,
      stateWith({
        liabilities: [
          { balanceDate: "2026-08-31", providedSchedule: [] },
          {
            balanceDate: "2026-08-31",
            providedSchedule: [{ dueDate: "2026-09-05" }, { dueDate: "2026-12-05" }],
          },
        ] as unknown as DashboardState["liabilities"],
      }),
    );
    const schedule = derived.find((s) => s.id === "provided-schedule");
    expect(schedule?.status).toBe("ACTIVE");
    expect(schedule?.latestDate).toBe("2026-12-05");
  });

  it("ne lève jamais sur une famille de faits absente de l'état", () => {
    // Un état partiel n'est pas une erreur de programmation : anciens fixtures, états de
    // test, et demain une lecture ciblée par route. Le rail doit répondre « À fournir », pas
    // faire tomber la page.
    for (const manifest of Object.values(PAGE_REGISTRY)) {
      expect(() => railSourcesFor(manifest, empty)).not.toThrow();
    }
  });

  it("n'émet JAMAIS A_RENOUVELER : aucun seuil de fraîcheur n'est déclaré", () => {
    // La section 16 interdit à un agent de décider « si une anomalie est assez importante
    // pour alerter ». Inventer trois mois pour un relevé ou deux ans pour une valorisation
    // ferait clignoter le rail sur une convention que personne n'a écrite.
    const rich = stateWith({
      accounts: [{}] as unknown as DashboardState["accounts"],
      transactions: [{ date: "2019-01-01" }] as unknown as DashboardState["transactions"],
      documents: [{ uploadedAt: "2015-01-01" }] as unknown as DashboardState["documents"],
      realEstateValuations: [
        { valuedAt: "2010-01-01" },
      ] as unknown as DashboardState["realEstateValuations"],
    });
    for (const manifest of Object.values(PAGE_REGISTRY)) {
      for (const source of railSourcesFor(manifest, rich)) {
        expect(["ACTIVE", "ABSENTE"]).toContain(source.status);
      }
    }
  });

  it("reprend le nom et la catégorie du manifeste sans les réécrire", () => {
    for (const manifest of Object.values(PAGE_REGISTRY)) {
      const derived = railSourcesFor(manifest, empty);
      derived.forEach((source, index) => {
        const declaration = manifest.sources[index];
        expect(source.name).toBe(declaration?.name);
        expect(source.category).toBe(declaration?.category);
      });
    }
  });
});

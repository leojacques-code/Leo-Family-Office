import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  PAGES_SERVING_PRIMARY_ACTION,
  PRIMARY_ACTION_DEBT,
  unservedPrimaryActions,
} from "@/lib/presentation/primary-action-debt";
import { PAGE_REGISTRY } from "@/lib/presentation/registry/pages";

const PAGES_DIR = join(process.cwd(), "src/components/pages");

/** Pages dont le fichier appelle réellement `useRegisterPrimaryAction`. */
function pagesWiredInSource(): string[] {
  return readdirSync(PAGES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .filter((entry) => {
      const file = join(PAGES_DIR, entry.name, "page.tsx");
      try {
        return readFileSync(file, "utf8").includes("useRegisterPrimaryAction(");
      } catch {
        return false;
      }
    })
    .map((entry) => entry.name)
    .sort();
}

describe("zone A : la dette d'actions primaires est mesurée, pas déclarée", () => {
  it("la liste déclarée correspond aux pages RÉELLEMENT câblées", () => {
    // Sans cette lecture des fichiers, la liste serait une intention : on pourrait la
    // rallonger sans brancher quoi que ce soit et le gate applaudirait.
    expect(pagesWiredInSource()).toEqual([...PAGES_SERVING_PRIMARY_ACTION].sort());
  });

  it("chaque page câblée déclare bien une action primaire au manifeste", () => {
    // Une page qui branche une action sans libellé au manifeste ne rendrait aucun bouton :
    // le cadre exige les deux. Le câblage serait alors du code mort.
    for (const id of PAGES_SERVING_PRIMARY_ACTION) {
      expect(PAGE_REGISTRY[id], `page ${id}`).toBeTruthy();
      expect(PAGE_REGISTRY[id].primaryAction, `page ${id}`).toBeTruthy();
    }
  });

  it("la dette vaut exactement son plafond", () => {
    const findings = unservedPrimaryActions();
    expect(
      findings.length,
      `Actions primaires déclarées et non servies : ${findings
        .map((f) => `${f.page} (« ${f.label} »)`)
        .join(", ")}. ` +
        `Si le nombre a baissé, abaissez PRIMARY_ACTION_DEBT à ${findings.length}.`,
    ).toBe(PRIMARY_ACTION_DEBT);
  });

  it("nomme les pages qui restent à solder, phase par phase", () => {
    // Le §37 donne à chacune sa phase. Les nommer ici évite qu'une dette devienne un chiffre
    // dont personne ne sait plus ce qu'il recouvre.
    expect(unservedPrimaryActions().map((f) => f.page)).toEqual([
      "net-worth",
      "investments",
      "real-estate",
      "career",
      "tax",
      "decision-lab",
      "sources",
      "reports",
    ]);
  });

  it("Aujourd'hui ne déclare aucune action primaire et n'entre donc pas dans la dette", () => {
    // §20 : « Today n'a pas de formulaire financier propre ». Une action primaire y serait
    // une saisie que la page ne possède pas.
    expect(PAGE_REGISTRY.today.primaryAction).toBeNull();
    expect(unservedPrimaryActions().some((f) => f.page === "today")).toBe(false);
  });

  it("le calcul de la dette réagit à la liste des pages servies", () => {
    // Le gate doit être un CLIQUET, pas une constante décorative : servir une page de plus
    // doit faire baisser le compte, et en retirer une doit le faire monter.
    const withNetWorthServed = unservedPrimaryActions([
      ...PAGES_SERVING_PRIMARY_ACTION,
      "net-worth",
    ]);
    expect(withNetWorthServed.length).toBe(PRIMARY_ACTION_DEBT - 1);
    const withNoneServed = unservedPrimaryActions([]);
    expect(withNoneServed.length).toBe(PRIMARY_ACTION_DEBT + PAGES_SERVING_PRIMARY_ACTION.length);
  });
});

import { describe, expect, it } from "vitest";
import {
  DEFAULT_SECTION,
  NAV_GROUPS,
  NAV_ITEMS,
  SECONDARY_SECTIONS,
  groupOfSection,
  isRoutedSection,
  isValidSection,
  secondarySection,
  sectionLabel,
} from "@/lib/navigation";

/**
 * Liste des sections adressables AVANT la phase 1, relevée dans l'historique du module et non
 * de mémoire.
 *
 * Elle sert de garde-fou de non-régression : le regroupement de la section 7 du plan réorganise
 * la navigation, il ne SUPPRIME aucune destination. Un lien déjà partagé vers /timeline doit
 * continuer de répondre après le regroupement, sinon la refonte casse des URL que personne
 * n'a demandé de casser.
 */
const SECTIONS_BEFORE_PHASE_1 = [
  "today",
  "advisor",
  "net-worth",
  "cash-flow",
  "investments",
  "debt",
  "real-estate",
  "career",
  "business-equity",
  "tax",
  "scenarios",
  "decision-lab",
  "goals",
  "reports",
  "imports",
  "documents",
  "timeline",
  "settings",
] as const;

describe("navigation", () => {
  it("expose des données sérialisables entre serveur et client", () => {
    // Régression du crash de production : un Set exporté depuis un module "use client"
    // arrivait côté serveur sans sa méthode has().
    const roundTripped = JSON.parse(JSON.stringify(NAV_ITEMS));
    expect(roundTripped).toEqual(JSON.parse(JSON.stringify(NAV_ITEMS)));
    expect(Array.isArray(roundTripped)).toBe(true);
    expect(Array.isArray(JSON.parse(JSON.stringify(NAV_GROUPS)))).toBe(true);
  });

  it("valide les sections connues et rejette les autres", () => {
    expect(isValidSection("net-worth")).toBe(true);
    expect(isValidSection(DEFAULT_SECTION)).toBe(true);
    expect(isValidSection("inconnue")).toBe(false);
    expect(isValidSection("")).toBe(false);
  });

  it("exclut la section racine du routage /[section]", () => {
    expect(isRoutedSection(DEFAULT_SECTION)).toBe(false);
    expect(isRoutedSection("scenarios")).toBe(true);
  });

  it("donne un href absolu à chaque entrée et des identifiants uniques", () => {
    expect(NAV_ITEMS.every((item) => item.href.startsWith("/"))).toBe(true);
    expect(new Set(NAV_ITEMS.map((item) => item.id)).size).toBe(NAV_ITEMS.length);
  });

  it("retombe sur la section racine pour un libellé inconnu", () => {
    // Critère de la section 11 pour cette phase : navigation entièrement française. Le repli
    // porte donc le libellé français de la section racine, pas le mot « Today ».
    expect(sectionLabel("scenarios")).toBe("Scénarios");
    expect(sectionLabel("inconnue")).toBe(sectionLabel(DEFAULT_SECTION));
    expect(sectionLabel("inconnue")).toBe("Aujourd’hui");
  });

  it("n'affiche aucun libellé de navigation en anglais", () => {
    // La liste est celle des libellés d'avant la phase 1 qui ne sont pas des mots français.
    // « Documents » n'y figure pas : il s'écrit pareil dans les deux langues.
    const anglicismes = [
      "Today",
      "Net Worth",
      "Cash Flow",
      "Investments",
      "Debt",
      "Real Estate",
      "Career",
      "Business Equity",
      "Tax",
      "Scenarios",
      "Decision Lab",
      "Goals",
      "Reports",
      "Imports",
      "Timeline",
      "Settings",
    ];
    const libelles = [
      ...NAV_GROUPS.flatMap((group) => [group.label, ...group.items.map((item) => item.label)]),
      ...SECONDARY_SECTIONS.map((item) => item.label),
    ];
    expect(libelles.filter((label) => anglicismes.includes(label))).toEqual([]);
  });

  it("présente six entrées de premier niveau", () => {
    // Constat 5.5 : « la navigation présente 18 destinations comme équivalentes ». La section 7
    // en fait six. Le nombre est le critère, pas une préférence de mise en page.
    expect(NAV_GROUPS).toHaveLength(6);
    expect(NAV_GROUPS.map((group) => group.id)).toEqual([
      "today",
      "wealth",
      "flows",
      "projects",
      "decisions",
      "sources",
    ]);
  });

  it("fait pointer chaque groupe vers une de ses propres sous-vues", () => {
    // Cliquer une entrée de premier niveau doit MENER quelque part. Un groupe qui pointerait
    // ailleurs que sur l'une de ses sous-vues afficherait un contenu sans rapport avec
    // l'entrée sélectionnée.
    for (const group of NAV_GROUPS) {
      expect(group.items.length).toBeGreaterThan(0);
      expect(group.items.map((item) => item.href)).toContain(group.href);
    }
  });

  it("ne supprime aucune destination existante", () => {
    for (const section of SECTIONS_BEFORE_PHASE_1) {
      expect(isValidSection(section)).toBe(true);
    }
    // Et rien n'a été ajouté en douce : une nouvelle destination appartient à la phase de son
    // domaine, pas à celle du shell.
    expect([...NAV_ITEMS].map((item) => item.id).sort()).toEqual(
      [...SECTIONS_BEFORE_PHASE_1].sort(),
    );
  });

  it("classe chaque section soit dans un groupe, soit dans les sections secondaires", () => {
    // Exclusivité : une section rangée aux deux endroits apparaîtrait deux fois dans le shell,
    // et une section rangée nulle part deviendrait inatteignable au clic tout en répondant à
    // son URL, ce qui est exactement la page perdue que la section 7 ne demande pas.
    for (const item of NAV_ITEMS) {
      const grouped = groupOfSection(item.id) !== null;
      const secondary = secondarySection(item.id) !== null;
      expect(grouped !== secondary).toBe(true);
    }
  });

  it("donne à chaque section secondaire l'endroit d'où on l'atteint", () => {
    expect(SECONDARY_SECTIONS.map((item) => item.id)).toEqual(["advisor", "reports", "settings"]);
    for (const item of SECONDARY_SECTIONS) {
      expect(["PROFILE_MENU", "HEADER_ACTION", "SECONDARY_VIEW"]).toContain(item.reachedFrom);
    }
  });
});

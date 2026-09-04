/**
 * Les motifs sont CONSTRUITS par répétition et jamais écrits en littéral : ce fichier est
 * lui-même suivi par git, et le contrôle qu'il teste le balaierait.
 */
import { describe, expect, it } from "vitest";

import { findConflictMarkers, formatConflictMarkerReport } from "./conflict-markers.ts";

const OURS = "<".repeat(7);
const BASE = "|".repeat(7);
const THEIRS = ">".repeat(7);
const SEPARATOR = "=".repeat(7);

describe("marqueurs non ambigus", () => {
  it("signale un conflit complet, ligne par ligne, séparateur compris", () => {
    const content = [
      "AVANT=",
      `${OURS} HEAD`,
      "A=1",
      SEPARATOR,
      "B=2",
      `${THEIRS} origin/autre`,
      "APRES=",
    ].join("\n");
    expect(findConflictMarkers(".env.example", content)).toEqual([
      { file: ".env.example", line: 2, marker: OURS },
      { file: ".env.example", line: 4, marker: SEPARATOR },
      { file: ".env.example", line: 6, marker: THEIRS },
    ]);
  });

  it("signale le marqueur de base d'un conflit à trois voies", () => {
    const content = [
      `${OURS} HEAD`,
      "a",
      `${BASE} base`,
      "b",
      SEPARATOR,
      "c",
      `${THEIRS} eux`,
    ].join("\n");
    expect(findConflictMarkers("f.ts", content).map((hit) => hit.marker)).toEqual([
      OURS,
      BASE,
      SEPARATOR,
      THEIRS,
    ]);
  });

  it("signale une borne ORPHELINE : c'est le cas qu'une résolution partielle laisse", () => {
    // Retirer `<<<<<<<` et `=======` en oubliant `>>>>>>>` est l'oubli le plus courant.
    expect(findConflictMarkers("f.ts", ["a", `${THEIRS} origine/x`, "b"].join("\n"))).toEqual([
      { file: "f.ts", line: 2, marker: THEIRS },
    ]);
  });

  it("remonte les séparateurs même quand seule la borne FERMANTE subsiste", () => {
    // La borne arrive après le séparateur : un contrôle en une seule passe le manquerait.
    const content = ["a", SEPARATOR, "b", `${THEIRS} origine/x`].join("\n");
    expect(findConflictMarkers("f.ts", content).map((hit) => hit.line)).toEqual([2, 4]);
  });

  it("accepte une ligne de sept chevrons SUIVIE d'un huitième : ce n'est pas un marqueur git", () => {
    expect(findConflictMarkers("f.ts", `${OURS}<TOUJOURS`)).toEqual([]);
  });
});

describe("séparateur ambigu", () => {
  it("n'est PAS signalé seul : un soulignement Markdown n'est pas un conflit", () => {
    const content = ["Titre", SEPARATOR, "", "Corps de la note."].join("\n");
    expect(findConflictMarkers("docs/NOTE.md", content)).toEqual([]);
  });

  it("n'est pas signalé non plus sur un filet de bandeau plus long", () => {
    expect(findConflictMarkers("f.ts", `// ${"=".repeat(40)}`)).toEqual([]);
  });
});

describe("fichier propre", () => {
  it("ne signale rien sur un contenu sans marqueur", () => {
    expect(findConflictMarkers("f.ts", "const a = 1;\nexport default a;\n")).toEqual([]);
  });
});

describe("rapport", () => {
  it("nomme le fichier ET la ligne : c'est ce qui permet de corriger", () => {
    const report = formatConflictMarkerReport([{ file: ".env.example", line: 40, marker: OURS }]);
    expect(report).toContain(".env.example:40");
    expect(report).toContain("1 marqueur(s)");
  });

  it("dit explicitement qu'il n'a rien trouvé, plutôt que de ne rien dire", () => {
    expect(formatConflictMarkerReport([])).toContain("Aucun marqueur");
  });
});

describe("arbre suivi réel", () => {
  it("ne porte aucun marqueur de conflit", async () => {
    // Le contrôle porte sur l'ARBRE, pas sur un diff : un marqueur introduit par un commit
    // antérieur à la fenêtre examinée échappe à `git diff --check`, pas à celui-ci.
    const { execFileSync } = await import("node:child_process");
    const { readFileSync } = await import("node:fs");
    const files = execFileSync("git", ["ls-files", "-z"], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    })
      .split("\0")
      .filter((entry) => entry.length > 0);

    const hits = files.flatMap((file) => {
      let buffer: Buffer;
      try {
        buffer = readFileSync(file);
      } catch {
        return [];
      }
      if (buffer.subarray(0, Math.min(buffer.length, 8_192)).includes(0)) return [];
      return findConflictMarkers(file, buffer.toString("utf8"));
    });

    expect(formatConflictMarkerReport(hits)).toContain("Aucun marqueur");
  });
});

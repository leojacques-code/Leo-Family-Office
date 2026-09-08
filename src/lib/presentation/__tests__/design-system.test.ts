import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  FUNCTIONAL_TEXT_FLOOR_PX,
  MIN_CONTROL_PX,
  PAGE_TEXT_FLOOR_DEBT,
  SHELL_CONTROL_SELECTORS,
  readStylesheetDeclarations,
  scopeOfSelector,
  shellControlsBelowMinimum,
  textBelowFloor,
} from "@/lib/presentation/design-system";

const STYLESHEETS = new URL("../../../app/", import.meta.url).pathname;

function fixture(css: Readonly<Record<string, string>>): string {
  const directory = mkdtempSync(join(tmpdir(), "lfo-design-"));
  for (const [name, content] of Object.entries(css)) {
    const path = join(directory, name);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, content, "utf8");
  }
  return directory;
}

describe("gate : plancher typographique du shell", () => {
  const declarations = readStylesheetDeclarations(STYLESHEETS);

  it("ne laisse AUCUN texte du shell sous 12 px", () => {
    // Mesure technique du §13 du plan, reprise du §10.2. Avant cette phase, treize
    // déclarations du shell descendaient jusqu'à 8 px : le statut de confidentialité, les
    // libellés de la barre latérale et le fil d'Ariane étaient sous le plancher.
    const findings = textBelowFloor(declarations, "SHELL");
    expect(
      findings.map(
        (finding) => `${finding.file}:${finding.line} ${finding.selector} — ${finding.reason}`,
      ),
      `texte fonctionnel du shell sous ${FUNCTIONAL_TEXT_FLOOR_PX} px`,
    ).toEqual([]);
  });

  it("borne la dette typographique des pages, qui ne peut que décroître", () => {
    // CLIQUET, pas objectif. Le §11 interdit la grande PR transversale et le §14 de refaire
    // toutes les pages en une fois : la dette est mesurée et plafonnée, chaque phase de
    // domaine soldant la sienne. Ce test échoue dans les DEUX sens — une déclaration ajoutée
    // dépasse le plafond, une déclaration corrigée demande de baisser la constante.
    const findings = textBelowFloor(declarations, "PAGE");
    expect(
      findings.length,
      `dette typographique des pages : ${findings.length} déclarations sous ${FUNCTIONAL_TEXT_FLOOR_PX} px. ` +
        `Si le nombre a baissé, abaissez PAGE_TEXT_FLOOR_DEBT à ${findings.length}.`,
    ).toBe(PAGE_TEXT_FLOOR_DEBT);
  });

  it("distingue une règle de shell d'une règle partagée", () => {
    expect(scopeOfSelector(".topbar-actions .button")).toBe("SHELL");
    expect(scopeOfSelector(".inspector-facts dt")).toBe("SHELL");
    // `.button` et `.icon-button` sont portés aussi par les contrôles internes des pages :
    // les compter comme shell attribuerait à cette phase un travail qu'elle n'a pas fait.
    expect(scopeOfSelector(".button")).toBe("PAGE");
    expect(scopeOfSelector(".icon-button")).toBe("PAGE");
    expect(scopeOfSelector(".kpi-card strong")).toBe("PAGE");
  });
});

describe("gate : taille des contrôles du shell", () => {
  it("déclare au moins 40 px pour chaque contrôle du shell", () => {
    const findings = shellControlsBelowMinimum(readStylesheetDeclarations(STYLESHEETS));
    expect(
      findings.map(
        (finding) => `${finding.control} — ${finding.reason} (${finding.file}:${finding.line})`,
      ),
      `contrôles du shell sous ${MIN_CONTROL_PX} px`,
    ).toEqual([]);
  });

  it("couvre les contrôles réellement présents dans le shell", () => {
    // Une liste de contrôles qui aurait cessé de correspondre au CSS rendrait le gate vert
    // sans rien vérifier : chaque sélecteur surveillé doit exister dans la feuille de style.
    const declarations = readStylesheetDeclarations(STYLESHEETS);
    const selectors = new Set(
      declarations.flatMap((declaration) =>
        declaration.selector.split(",").map((part) => part.trim()),
      ),
    );
    for (const control of SHELL_CONTROL_SELECTORS) {
      expect(selectors, `${control} ne correspond à aucune règle CSS`).toContain(control);
    }
  });
});

describe("le contrôle attrape réellement ce qu'il prétend attraper", () => {
  it("attrape une déclaration sous le plancher, même marquée importante", () => {
    const directory = fixture({
      "a.css": ".source-status {\n  font-size: 9px !important;\n}\n",
    });
    const findings = textBelowFloor(readStylesheetDeclarations(directory), "SHELL");
    expect(findings).toHaveLength(1);
    expect(findings[0].line).toBe(2);
    expect(findings[0].reason).toContain("9 px");
  });

  it("juge un clamp sur sa borne basse", () => {
    // C'est la taille réellement rendue sur la fenêtre la plus étroite, celle où le texte est
    // déjà le plus difficile à lire. Retenir la borne haute déclarerait conforme un texte de
    // 9 px sur tablette.
    const directory = fixture({
      "a.css": ".workstation-question {\n  font-size: clamp(9px, 2vw, 32px);\n}\n",
    });
    expect(textBelowFloor(readStylesheetDeclarations(directory), "SHELL")).toHaveLength(1);

    const conforme = fixture({
      "a.css": ".workstation-question {\n  font-size: clamp(24px, 2.4vw, 32px);\n}\n",
    });
    expect(textBelowFloor(readStylesheetDeclarations(conforme), "SHELL")).toEqual([]);
  });

  it("ignore une taille héritée au lieu de l'inventer", () => {
    // `inherit` ne dit RIEN de la taille rendue : la déduire d'un ancêtre demanderait la
    // cascade complète, et la déclarer fautive transformerait une inconnue en verdict.
    const directory = fixture({
      "a.css":
        ".source-text small {\n  font-size: inherit;\n}\n.source-status {\n  font-size: 0.7em;\n}\n",
    });
    expect(textBelowFloor(readStylesheetDeclarations(directory), "SHELL")).toEqual([]);
  });

  it("attribue une déclaration au sélecteur de son bloc, à travers une at-rule", () => {
    const directory = fixture({
      "a.css": "@media (max-width: 1023px) {\n  .source-rail {\n    font-size: 8px;\n  }\n}\n",
    });
    const findings = textBelowFloor(readStylesheetDeclarations(directory), "SHELL");
    expect(findings).toHaveLength(1);
    expect(findings[0].selector).toBe(".source-rail");
    // La ligne pointée est celle de la DÉCLARATION, pas celle du sélecteur : c'est la ligne
    // que l'auteur doit corriger.
    expect(findings[0].line).toBe(3);
  });

  it("ne se laisse pas décaler par un commentaire contenant une accolade", () => {
    // Un exemple de règle écrit dans un commentaire ferait sinon dériver tous les numéros de
    // ligne suivants, et un finding dont la ligne est fausse est un finding inexploitable.
    const directory = fixture({
      "a.css":
        "/* exemple : .x { font-size: 4px } sur\n   deux lignes */\n.source-status {\n  font-size: 9px;\n}\n",
    });
    const findings = textBelowFloor(readStylesheetDeclarations(directory), "SHELL");
    expect(findings).toHaveLength(1);
    // Sans neutralisation, l'accolade du commentaire empilerait un faux bloc et la
    // déclaration serait rattachée à « exemple : .x » au lieu de son vrai sélecteur.
    expect(findings[0].selector).toBe(".source-status");
    expect(findings[0].line).toBe(4);
  });

  it("signale un contrôle dont la hauteur n'est pas déclarée", () => {
    // Une hauteur qui vient d'un rembourrage vient du CONTENU : elle change avec le libellé,
    // donc elle n'est pas une garantie de cible. Le compter conforme rendrait le gate vert
    // sur exactement le cas qu'il doit attraper.
    const directory = fixture({
      "a.css": ".source-row {\n  padding: 6px;\n}\n",
    });
    const findings = shellControlsBelowMinimum(readStylesheetDeclarations(directory));
    const row = findings.find((finding) => finding.control === ".source-row");
    expect(row?.declaration).toBe("aucune min-height");
  });

  it("retient la DERNIÈRE déclaration d'un contrôle, comme la cascade", () => {
    const conforme = fixture({
      "a.css": ".source-row {\n  min-height: 34px;\n}\n.source-row {\n  min-height: 48px;\n}\n",
    });
    expect(
      shellControlsBelowMinimum(readStylesheetDeclarations(conforme)).find(
        (finding) => finding.control === ".source-row",
      ),
    ).toBeUndefined();

    // Et une règle tardive qui RÉTRÉCIT le contrôle est bien attrapée, ce qu'une lecture de
    // la première déclaration laisserait passer.
    const regression = fixture({
      "a.css": ".source-row {\n  min-height: 48px;\n}\n.source-row {\n  min-height: 30px;\n}\n",
    });
    expect(
      shellControlsBelowMinimum(readStylesheetDeclarations(regression)).find(
        (finding) => finding.control === ".source-row",
      )?.reason,
    ).toContain("30 px");
  });

  it("ne confond pas une liste de sélecteurs avec un sélecteur composé", () => {
    // `.source-row, .other` dimensionne bien `.source-row` ; `.source-row .child` ne le
    // dimensionne PAS, et le compter reviendrait à déclarer conforme un contrôle dont seul un
    // descendant a été dimensionné.
    const liste = fixture({
      "a.css": ".other,\n.source-row {\n  min-height: 44px;\n}\n",
    });
    expect(
      shellControlsBelowMinimum(readStylesheetDeclarations(liste)).find(
        (finding) => finding.control === ".source-row",
      ),
    ).toBeUndefined();

    const descendant = fixture({
      "a.css": ".source-row .source-text {\n  min-height: 44px;\n}\n",
    });
    expect(
      shellControlsBelowMinimum(readStylesheetDeclarations(descendant)).find(
        (finding) => finding.control === ".source-row",
      )?.declaration,
    ).toBe("aucune min-height");
  });
});

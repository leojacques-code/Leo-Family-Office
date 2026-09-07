import { describe, expect, it } from "vitest";
import {
  CODE_TRANSLATIONS,
  DATA_KIND_LABELS,
  translateCode,
  translateIssues,
} from "@/lib/presentation/language";
import {
  EXCLUDED_RESERVE_UNIONS,
  inventoryReserveCodes,
  literalCodesInLib,
} from "@/lib/presentation/language/code-inventory";
import {
  ISSUE_FAMILY_LABELS,
  STATE_CONTRACTS,
  dominantState,
  issueFamilyOf,
  splitCode,
  type PresentationState,
} from "@/lib/presentation/language";

const REPO_ROOT = new URL("../../../../", import.meta.url).pathname;
const CODE_SHAPE = /^[A-Z][A-Z0-9]*(_[A-Z0-9]+)*$/;

describe("gate : tout code de réserve émis par un moteur est traduit", () => {
  it("ne laisse AUCUN code sans traduction française", () => {
    // C'est le gate de la section 39 : « un code interne sans traduction » doit faire échouer
    // le CI. Sans lui, un moteur peut ajouter un code demain et l'utilisateur lira
    // « EV_TO_EQUITY_CASH_MISSING » sur son écran, comme c'était le cas avant cette phase.
    const inventory = inventoryReserveCodes(REPO_ROOT);
    // Plancher de vigilance : si l'extraction cesse de trouver les unions déclarées (un
    // renommage, un déplacement de fichier), le gate deviendrait vert en ne vérifiant plus
    // rien. Un gate qui ne trouve rien doit échouer, pas se taire.
    expect(inventory.length).toBeGreaterThan(80);
    const missing = inventory.filter((entry) => !(entry.code in CODE_TRANSLATIONS));
    expect(
      missing.map((entry) => `${entry.code} (${entry.sources.join(", ")})`),
      "codes de réserve sans traduction : ajoutez-les à src/lib/presentation/language/codes.ts",
    ).toEqual([]);
  });

  it("n’héberge AUCUNE traduction morte", () => {
    // Gate INVERSE. Une traduction qui ne correspond à aucun code du produit est un vestige
    // d'un code renommé : elle donne l'illusion d'une couverture, et elle masquerait le jour
    // où un code proche réapparaîtrait sous un autre nom.
    const literals = literalCodesInLib(REPO_ROOT);
    const dead = Object.keys(CODE_TRANSLATIONS).filter((code) => !literals.has(code));
    expect(dead, "traductions sans code correspondant dans src/lib").toEqual([]);
  });

  it("documente ses exclusions au lieu de les cacher", () => {
    // Une exclusion qu'on ne peut pas lire est une exclusion qu'on ne peut pas contester.
    expect(Object.keys(EXCLUDED_RESERVE_UNIONS).sort()).toEqual([
      "BusinessBlockerCode",
      "BusinessFlagCode",
      "DateParseReason",
      "NumberParseReason",
    ]);
    for (const motive of Object.values(EXCLUDED_RESERVE_UNIONS)) {
      expect(motive.length).toBeGreaterThan(10);
    }
  });
});

describe("qualité des traductions", () => {
  it("n’écrit AUCUN code technique dans un libellé visible", () => {
    for (const [code, translation] of Object.entries(CODE_TRANSLATIONS)) {
      expect(translation.label, `${code} laisse passer du SCREAMING_SNAKE`).not.toMatch(
        /[A-Z]{2,}_[A-Z_]+/,
      );
      expect(translation.label.length, `${code} : libellé vide`).toBeGreaterThan(3);
      // Un libellé de réserve tient sur une ligne d'interface : au-delà, ce n'est plus une
      // étiquette mais un paragraphe, et le constat 5.6 reproche déjà les murs de texte.
      expect(translation.label.length, `${code} : libellé trop long`).toBeLessThanOrEqual(70);
      expect(translation.label[0], `${code} : libellé non capitalisé`).toBe(
        translation.label[0].toUpperCase(),
      );
    }
  });

  it("ne classe AUCUN code en tâche priorisée", () => {
    // La section 16 interdit à une IA de décider « si une anomalie est assez importante pour
    // alerter ». Promouvoir un code en `UNKNOWN_BLOCKING` est une décision humaine, prise
    // dans la phase du domaine concerné. Ce test tombera le jour où quelqu'un le fera, et
    // c'est voulu : il faudra alors le mettre à jour DÉLIBÉRÉMENT.
    const blocking = Object.entries(CODE_TRANSLATIONS).filter(
      ([, translation]) => translation.state === "UNKNOWN_BLOCKING",
    );
    expect(blocking.map(([code]) => code)).toEqual([]);
  });

  it("n’a que des clés de forme SCREAMING_SNAKE, sans identifiant collé", () => {
    for (const code of Object.keys(CODE_TRANSLATIONS)) {
      expect(code, `${code} : clé mal formée`).toMatch(CODE_SHAPE);
      expect(code).not.toContain(":");
    }
  });
});

describe("splitCode", () => {
  it("sépare l’identifiant technique du code", () => {
    // `ENVELOPE_EXPOSURE_UNKNOWN:<uuid>` faisait apparaître un UUID ENTIER dans le texte
    // visible de la page, ce que le constat 5.4 du plan interdit explicitement.
    expect(splitCode("ENVELOPE_EXPOSURE_UNKNOWN:9f1c-42")).toEqual({
      code: "ENVELOPE_EXPOSURE_UNKNOWN",
      identifier: "9f1c-42",
    });
    expect(splitCode("FX_MISSING")).toEqual({ code: "FX_MISSING", identifier: null });
    // Deux-points final sans identifiant : `null`, pas une chaîne vide qui s'afficherait.
    expect(splitCode("FX_MISSING:")).toEqual({ code: "FX_MISSING", identifier: null });
  });
});

describe("translateIssues", () => {
  it("rend des phrases françaises et sort l’identifiant du texte visible", () => {
    const result = translateIssues(["ENVELOPE_EXPOSURE_UNKNOWN:9f1c-42", "FX_STALE"]);
    expect(result.issues.map((issue) => issue.label)).toEqual([
      "Exposition de l’enveloppe inconnue",
      "Taux de change ancien",
    ]);
    expect(result.issues[0].identifier).toBe("9f1c-42");
    // L'identifiant n'est nulle part dans ce que l'utilisateur lit.
    expect(result.issues.map((issue) => issue.label).join(" ")).not.toContain("9f1c-42");
  });

  it("dédoublonne par LIBELLÉ, pas par code", () => {
    // Deux codes distincts peuvent se dire de la même façon : une quote-part manquante en
    // immobilier et en participation. Les afficher deux fois donnerait l'impression de deux
    // problèmes là où l'utilisateur n'en voit qu'un.
    const result = translateIssues([
      "REAL_ESTATE_OWNERSHIP_SHARE_MISSING",
      "REAL_ESTATE_OWNERSHIP_SHARE_MISSING:abc",
    ]);
    expect(result.issues).toHaveLength(1);
  });

  it("traite un code INCONNU comme un incident, sans jamais l’afficher", () => {
    const result = translateIssues(["FX_STALE", "CODE_QUI_NEXISTE_PAS"]);
    expect(result.untranslated).toEqual(["CODE_QUI_NEXISTE_PAS"]);
    // Le code brut ne se retrouve dans aucun libellé : le taire à l'écran est le but, mais
    // le taire tout court ferait croire que tout va bien, d'où l'incident.
    expect(result.issues.map((issue) => issue.label)).not.toContain("CODE_QUI_NEXISTE_PAS");
    expect(result.state).toBe("SYSTEM_ERROR");
  });

  it("rend AVAILABLE sur un ensemble vide : rien ne fait réserve", () => {
    expect(translateIssues([]).state).toBe("AVAILABLE");
    expect(translateIssues([]).issues).toEqual([]);
  });

  it("retient l’état DOMINANT, un conflit primant sur une donnée à compléter", () => {
    // Une valeur affichée qui peut être fausse prime sur une valeur qu'on sait absente.
    const result = translateIssues(["FX_MISSING", "BALANCE_MISMATCH"]);
    expect(result.state).toBe("SOURCE_CONFLICT");
  });
});

describe("états de présentation", () => {
  it("porte les huit états de la section 6.3, et seulement eux", () => {
    expect(Object.keys(STATE_CONTRACTS).sort()).toEqual(
      [
        "AVAILABLE",
        "DECLARED_NONE",
        "PARTIAL",
        "SOURCE_CONFLICT",
        "SYSTEM_ERROR",
        "UNKNOWN_ACTIVATABLE",
        "UNKNOWN_BLOCKING",
        "UNKNOWN_NON_ESSENTIAL",
      ].sort(),
    );
  });

  it("n’autorise une VALEUR que sur les états qui en portent une", () => {
    // Garde-fou de composition du constat 5.6 : un état sans valeur ne doit pas occuper une
    // carte de métrique. « Non calculable » répété sur dix cartes vient exactement de là.
    expect(STATE_CONTRACTS.AVAILABLE.carriesValue).toBe(true);
    expect(STATE_CONTRACTS.PARTIAL.carriesValue).toBe(true);
    for (const state of [
      "UNKNOWN_NON_ESSENTIAL",
      "UNKNOWN_ACTIVATABLE",
      "UNKNOWN_BLOCKING",
      "DECLARED_NONE",
      "SOURCE_CONFLICT",
      "SYSTEM_ERROR",
    ] as const) {
      expect(STATE_CONTRACTS[state].carriesValue, state).toBe(false);
    }
  });

  it("n’écrit aucun code technique dans un titre d’état", () => {
    for (const contract of Object.values(STATE_CONTRACTS)) {
      expect(contract.label).not.toMatch(/[A-Z]{2,}_[A-Z_]+/);
    }
    for (const label of Object.values(ISSUE_FAMILY_LABELS)) {
      expect(label).not.toMatch(/[A-Z]{2,}_[A-Z_]+/);
    }
  });

  it("ne met dans l’inbox que ce qui appelle une intervention", () => {
    // Un domaine déclaré non concerné n'est pas une tâche : c'est une réponse.
    expect(issueFamilyOf("DECLARED_NONE")).toBeNull();
    expect(issueFamilyOf("AVAILABLE")).toBeNull();
    expect(issueFamilyOf("UNKNOWN_NON_ESSENTIAL")).toBeNull();
    expect(issueFamilyOf("SOURCE_CONFLICT")).toBe("CONFLICT");
    expect(issueFamilyOf("SYSTEM_ERROR")).toBe("INCIDENT");
    expect(issueFamilyOf("UNKNOWN_ACTIVATABLE")).toBe("INCOMPLETE");
    expect(issueFamilyOf("PARTIAL")).toBe("TO_CONFIRM");
  });

  it("fait primer l’incident technique sur toute réserve financière", () => {
    // Afficher « à compléter » alors que le chargement a échoué ferait chercher une donnée
    // qui existe déjà.
    const states: PresentationState[] = ["PARTIAL", "SOURCE_CONFLICT", "SYSTEM_ERROR"];
    expect(dominantState(states)).toBe("SYSTEM_ERROR");
    expect(dominantState(["DECLARED_NONE", "PARTIAL"])).toBe("PARTIAL");
    expect(dominantState([])).toBe("AVAILABLE");
  });
});

describe("natures de donnée", () => {
  it("rend les six natures en FRANÇAIS", () => {
    // `DataBadge` rendait « Actual », « User assumption », « Model assumption »,
    // « External », « Derived », « Missing » : des codes internes à peine déguisés.
    expect(Object.values(DATA_KIND_LABELS).map((entry) => entry.label)).toEqual([
      "Constaté",
      "Votre hypothèse",
      "Hypothèse du modèle",
      "Source externe",
      "Calculé",
      "Non renseigné",
    ]);
  });

  it("distingue les trois natures que la constitution interdit de confondre", () => {
    // ACTUAL ≠ USER_ASSUMPTION ≠ MODEL_ASSUMPTION.
    const labels = new Set([
      DATA_KIND_LABELS.ACTUAL.label,
      DATA_KIND_LABELS.USER_ASSUMPTION.label,
      DATA_KIND_LABELS.MODEL_ASSUMPTION.label,
    ]);
    expect(labels.size).toBe(3);
    expect(DATA_KIND_LABELS.MISSING.definition).toContain("pas un zéro");
  });
});

describe("translateCode", () => {
  it("rend null sur un code inconnu, sans repli sur le code brut", () => {
    expect(translateCode("PAS_UN_CODE_CONNU")).toBeNull();
  });
});

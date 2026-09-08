import { describe, expect, it } from "vitest";
import { KPI_REGISTRY } from "@/lib/presentation/registry/kpis";
import { OBJECTIVE_REGISTRY } from "@/lib/presentation/registry/objectives";
import { PAGE_REGISTRY } from "@/lib/presentation/registry/pages";
import { unverifiableRules, validateRegistries } from "@/lib/presentation/registry/validate";
import type { FieldDefinition, PageManifest } from "@/lib/presentation/registry/contracts";
import { SOURCE_CATEGORY_LABELS } from "@/components/workstation/source-rail";

describe("gate : les cinq refus vérifiables de la section 39", () => {
  it("ne trouve AUCUNE violation dans les registres livrés", () => {
    const violations = validateRegistries();
    expect(violations.map((violation) => `[règle ${violation.rule}] ${violation.message}`)).toEqual(
      [],
    );
  });

  it("refuse une page qui référence un KPI hors registre", () => {
    // Quatrième refus de la section 39. C'est le plus probable en pratique : un manifeste
    // écrit avant son KPI, ou un KPI renommé sans que la page suive.
    const violations = validateRegistries({
      pages: {
        fantome: { ...PAGE_REGISTRY.today, id: "fantome", essentialKpis: ["kpi_inexistant"] },
      },
    });
    expect(violations.some((violation) => violation.rule === 4)).toBe(true);
    expect(violations.map((violation) => violation.message).join(" ")).toContain("kpi_inexistant");
  });

  it("refuse un KPI sans formule et un KPI sans données requises", () => {
    const withoutFormula = validateRegistries({
      kpis: { casse: { ...KPI_REGISTRY.net_worth, id: "casse", formula: "  " } },
    });
    expect(withoutFormula.some((violation) => violation.rule === 2)).toBe(true);

    const withoutData = validateRegistries({
      kpis: { casse: { ...KPI_REGISTRY.net_worth, id: "casse", requiredData: [] } },
    });
    expect(withoutData.some((violation) => violation.rule === 2)).toBe(true);
  });

  it("refuse un objectif qui n’ouvre aucun usage", () => {
    // Troisième refus. Un objectif qui ne débloque rien fait cocher une case pour rien, et
    // pire, fait remplir les champs qu'il révèle sans qu'aucun calcul n'en dépende.
    const violations = validateRegistries({
      objectives: {
        vide: {
          ...OBJECTIVE_REGISTRY.track_liquidity,
          id: "vide",
          unlocksKpis: [],
          revealsFieldGroups: [],
        },
      },
    });
    expect(violations.some((violation) => violation.rule === 3)).toBe(true);
  });

  it("refuse un champ que rien ne consomme", () => {
    // Premier refus. Le registre des champs est VIDE en phase 0, donc cette règle ne trouve
    // rien sur les registres livrés : le test la prouve sur un champ construit exprès,
    // faute de quoi elle serait « verte » sans avoir jamais rien vérifié.
    const orphan: FieldDefinition = {
      id: "champ_orphelin",
      label: "Champ orphelin",
      definition: "Un champ que ni objectif ni KPI ne consomme.",
      type: "MONEY",
      unit: null,
      currency: "REPORTING",
      precision: 2,
      nullable: true,
      acceptedKinds: ["ACTUAL"],
      carriesEconomicDate: true,
      validation: [],
      consumedByObjectives: [],
      consumedByKpis: [],
      sensitive: false,
      supersession: "REPLACE_WITH_AUDIT",
      help: "",
      placeholderExample: null,
    };
    const violations = validateRegistries({ fields: { champ_orphelin: orphan } });
    expect(violations.some((violation) => violation.rule === 1)).toBe(true);
  });

  it("refuse un registre de traduction vide", () => {
    const violations = validateRegistries({ codeTranslations: {} });
    expect(violations.some((violation) => violation.rule === 5)).toBe(true);
  });

  it("NOMME la règle qu’il ne peut pas vérifier à cette phase", () => {
    // Un gate silencieux sur une règle donne l'illusion qu'elle est tenue.
    const unverifiable = unverifiableRules();
    expect(unverifiable).toHaveLength(1);
    expect(unverifiable[0].rule).toBe(6);
    expect(unverifiable[0].message).toContain("phase 1");
  });
});

describe("registre des pages", () => {
  it("porte les QUATORZE pages des sections 20 à 33", () => {
    expect(Object.keys(PAGE_REGISTRY).sort()).toEqual(
      [
        "today",
        "net-worth",
        "cash-flow",
        "investments",
        "debt",
        "real-estate",
        "career",
        "business-equity",
        "tax",
        "goals",
        "scenarios",
        "decision-lab",
        "sources",
        "reports",
      ].sort(),
    );
  });

  it("ne porte NI Settings NI Beyonder", () => {
    // Les sections 34 et 35 les sortent de la navigation principale. Leur donner un manifeste
    // de page reconstituerait la navigation à dix-huit destinations équivalentes que le
    // constat 5.5 reproche au produit actuel.
    expect(PAGE_REGISTRY).not.toHaveProperty("settings");
    expect(PAGE_REGISTRY).not.toHaveProperty("advisor");
    expect(PAGE_REGISTRY).not.toHaveProperty("beyonder");
  });

  it("donne à chaque page UNE action primaire au plus, nommée par un verbe", () => {
    // Section 17 : « une action primaire maximum ». C'est le TYPE qui l'impose
    // (`string | null`), pas ce test : chercher un « ou » dans le libellé confondrait
    // « Ajouter un actif ou un passif », qui est UNE action sur deux natures d'objet, avec
    // deux actions distinctes. Ce test vérifie ce qui reste vérifiable sur le texte : une
    // action se nomme par un verbe et tient en quelques mots.
    for (const [id, page] of Object.entries(PAGE_REGISTRY)) {
      if (page.primaryAction === null) continue;
      expect(page.primaryAction.length, `${id} : libellé d’action trop long`).toBeLessThanOrEqual(
        40,
      );
      expect(page.primaryAction, `${id} : l’action ne commence pas par un verbe`).toMatch(
        /^(Ajouter|Importer|Créer|Produire|Poser|Connecter|Déposer)\b/,
      );
    }
  });

  it("écrit une question en FRANÇAIS, sans code technique", () => {
    for (const [id, page] of Object.entries(PAGE_REGISTRY)) {
      expect(page.question, `${id}`).not.toMatch(/[A-Z]{2,}_[A-Z_]+/);
      expect(page.question.endsWith("?"), `${id} : la question n’en est pas une`).toBe(true);
    }
  });

  it("déclare ce qu’elle DIFFÈRE, et pas seulement ce qu’elle montre", () => {
    // La section 8 liste pour chaque espace un « à masquer ou différer ». Une exclusion non
    // écrite se perd à la première relecture.
    for (const [id, page] of Object.entries(PAGE_REGISTRY)) {
      expect(page.deferred.length, `${id} : rien de différé n’est déclaré`).toBeGreaterThan(0);
    }
  });

  it("place l’analyse disponible APRÈS le canvas financier", () => {
    // Remonter le catalogue « Aller plus loin » ferait de la liste des indicateurs manquants
    // le contenu principal : c'est exactement le constat 5.6.
    for (const [id, page] of Object.entries(PAGE_REGISTRY)) {
      const canvas = page.zones.indexOf("FINANCIAL_CANVAS");
      const analysis = page.zones.indexOf("AVAILABLE_ANALYSIS");
      if (canvas === -1 || analysis === -1) continue;
      expect(analysis, `${id} : l’analyse disponible précède le canvas`).toBeGreaterThan(canvas);
    }
  });

  it("sait rendre « vous n’êtes pas concerné » partout où le domaine peut ne pas s’appliquer", () => {
    // Section 18.1 : `DECLARED_NONE` n'est jamais traité comme une donnée inconnue ni comme
    // une erreur. Une page de domaine qui ne le supporte pas restera visible avec des cartes
    // vides pour quelqu'un qui n'a ni bien, ni société, ni dette.
    for (const id of ["real-estate", "business-equity", "debt", "investments", "career"]) {
      expect(PAGE_REGISTRY[id].supportedStates, id).toContain("DECLARED_NONE");
    }
  });
});

describe("registre des KPI", () => {
  it("ne présente JAMAIS un null comme un zéro", () => {
    // C'est l'invariant `NULL ≠ ZERO` au niveau du contrat de KPI : aucun comportement de
    // repli sur zéro n'existe dans le type, et ce test verrouille qu'on n'en ajoute pas un.
    for (const [id, kpi] of Object.entries(KPI_REGISTRY)) {
      expect(["NOT_COMPUTABLE", "EXCLUDE_AND_FLAG"], `${id}`).toContain(kpi.onNull);
    }
  });

  it("distingue un zéro DÉCLARÉ d’une absence", () => {
    // Un prêt à taux zéro, une charge déclarée à zéro : ce sont des informations. Un KPI qui
    // les traiterait comme des absences perdrait une déclaration explicite.
    const computingOnZero = Object.values(KPI_REGISTRY).filter(
      (kpi) => kpi.onDeclaredZero === "COMPUTE",
    );
    expect(computingOnZero.length).toBeGreaterThan(0);
    // Et symétriquement, un ratio dont le dénominateur serait nul reste non calculable.
    expect(KPI_REGISTRY.liquidity_coverage_months.onDeclaredZero).toBe("NOT_COMPUTABLE");
    expect(KPI_REGISTRY.savings_rate.onDeclaredZero).toBe("NOT_COMPUTABLE");
  });

  it("n’annualise jamais implicitement une période partielle", () => {
    for (const [id, kpi] of Object.entries(KPI_REGISTRY)) {
      expect(["LABEL_AS_PARTIAL", "NOT_COMPUTABLE", "NOT_APPLICABLE"], `${id}`).toContain(
        kpi.onPartialPeriod,
      );
    }
  });

  it("marque SIMULÉ tout ce qui dépend d’une hypothèse", () => {
    // Une hypothèse ne devient jamais un fait. La provenance le porte dans le contrat, donc
    // la surface ne peut pas rendre une trajectoire comme une observation.
    expect(KPI_REGISTRY.scenario_trajectory.provenance).toBe("SIMULATED");
    expect(KPI_REGISTRY.goal_monthly_effort.provenance).toBe("SIMULATED");
    expect(KPI_REGISTRY.decision_option_comparison.provenance).toBe("SIMULATED");
  });

  it("écrit ses explications en FRANÇAIS, sans code technique", () => {
    for (const [id, kpi] of Object.entries(KPI_REGISTRY)) {
      expect(kpi.userExplanation, `${id}`).not.toMatch(/[A-Z]{2,}_[A-Z_]+/);
      expect(kpi.label, `${id}`).not.toMatch(/[A-Z]{2,}_[A-Z_]+/);
      expect(kpi.userExplanation.length, `${id} : explication trop courte`).toBeGreaterThan(20);
      expect(kpi.technicalDetail.length, `${id} : détail technique absent`).toBeGreaterThan(10);
    }
  });

  it("rattache chaque KPI monétaire à une devise déclarée", () => {
    // « Chaque montant porte sa devise » : un KPI monétaire sans devise laisserait supposer
    // l'euro, et une somme de devises différentes se ferait sans le dire.
    for (const [id, kpi] of Object.entries(KPI_REGISTRY)) {
      const monetary = ["net_worth", "gross_assets", "debt_outstanding", "portfolio_value"];
      if (monetary.includes(id)) expect(kpi.currency, id).not.toBeNull();
    }
  });

  it("exige une couverture déclarée pour les performances de portefeuille", () => {
    // Section 9 : « TWR/XIRR seulement avec couverture temporelle et flux fiables ».
    for (const id of ["portfolio_twr", "portfolio_xirr"]) {
      expect(KPI_REGISTRY[id].requiredData.join(" "), id).toMatch(/couverture|flux/i);
      expect(KPI_REGISTRY[id].onPartialPeriod, id).toBe("NOT_COMPUTABLE");
    }
  });

  it("ne rend AUCUN rendement immobilier sans son dénominateur nommé", () => {
    // « Le rendement brut indique toujours son dénominateur » (section 25).
    expect(KPI_REGISTRY.property_gross_yield.requiredData.join(" ")).toContain("Dénominateur");
    expect(KPI_REGISTRY.property_gross_yield.conventions.join(" ")).toContain("dénominateur");
  });
});

describe("registre des objectifs", () => {
  it("nomme ce qui reste un JUGEMENT HUMAIN sur les sujets de la section 38-9", () => {
    // QoE, multiples privés, croissance salariale, comparables faibles, préférences de
    // liquidation : cocher un objectif ne délègue jamais ces jugements au produit.
    for (const id of [
      "business_quality_of_earnings",
      "business_estimate_value",
      "business_model_disposal",
      "property_track_value",
      "career_simulate_evolution",
      "tax_estimate_liability",
    ]) {
      expect(
        OBJECTIVE_REGISTRY[id].humanJudgementRemains.length,
        `${id} : aucun jugement humain nommé`,
      ).toBeGreaterThan(0);
    }
  });

  it("ne perd JAMAIS de donnée en silence quand on décoche", () => {
    // Section 18.3 : « une section conditionnelle redevient masquée sans perdre silencieusement
    // ses données ; l'utilisateur choisit conserver ou supprimer ».
    for (const [id, objective] of Object.entries(OBJECTIVE_REGISTRY)) {
      expect(["KEEP_DATA_HIDE_SECTION", "ASK_KEEP_OR_DELETE"], id).toContain(
        objective.onDeactivate,
      );
    }
  });

  it("marque SIMULATION les objectifs qui ne produisent aucun fait", () => {
    for (const id of [
      "stress_income_drop",
      "project_portfolio",
      "loan_simulate_early_repayment",
      "property_prepare_sale",
      "career_simulate_evolution",
      "business_model_disposal",
      "goal_plan_effort",
      "scenario_change_market",
      "scenario_add_events",
      "tax_compare_before_after",
    ]) {
      expect(OBJECTIVE_REGISTRY[id].mode, id).toBe("SIMULATION");
    }
  });

  it("n’a AUCUNE dépendance circulaire", () => {
    // Un cycle rendrait un objectif impossible à activer, sans que rien ne le dise.
    const seen = new Map<string, "VISITING" | "DONE">();
    const cycles: string[] = [];
    const visit = (id: string, path: string[]) => {
      const state = seen.get(id);
      if (state === "DONE") return;
      if (state === "VISITING") {
        cycles.push([...path, id].join(" → "));
        return;
      }
      seen.set(id, "VISITING");
      for (const next of OBJECTIVE_REGISTRY[id]?.dependsOn ?? []) visit(next, [...path, id]);
      seen.set(id, "DONE");
    };
    for (const id of Object.keys(OBJECTIVE_REGISTRY)) visit(id, []);
    expect(cycles).toEqual([]);
  });

  it("écrit ses libellés et raisons en FRANÇAIS, sans code technique", () => {
    for (const [id, objective] of Object.entries(OBJECTIVE_REGISTRY)) {
      expect(objective.label, id).not.toMatch(/[A-Z]{2,}_[A-Z_]+/);
      expect(objective.reason, id).not.toMatch(/[A-Z]{2,}_[A-Z_]+/);
      // La raison n'est pas une reformulation du libellé : elle dit ce qu'on y gagne.
      expect(objective.reason.toLowerCase(), `${id} : la raison répète le libellé`).not.toBe(
        objective.label.toLowerCase(),
      );
    }
  });

  it("est ENTIÈREMENT atteignable depuis les pages", () => {
    // Un objectif qu'aucune page n'autorise est inaccessible : il ne peut pas être coché.
    const reachable = new Set<string>();
    for (const page of Object.values(PAGE_REGISTRY)) {
      for (const id of page.allowedObjectives) reachable.add(id);
    }
    // Les dépendances comptent comme atteignables : elles s'activent par l'objectif qui en
    // dépend, sans avoir besoin de leur propre entrée de page.
    for (const objective of Object.values(OBJECTIVE_REGISTRY)) {
      for (const id of objective.dependsOn) reachable.add(id);
    }
    const unreachable = Object.keys(OBJECTIVE_REGISTRY).filter((id) => !reachable.has(id));
    expect(unreachable, "objectifs qu’aucune page n’autorise").toEqual([]);
  });
});

describe("couverture croisée des registres", () => {
  it("n’héberge AUCUN KPI qu’aucune page ni aucun objectif n’utilise", () => {
    // Section 14 : « ne pas créer de nouveaux KPI tant que la tâche utilisateur associée
    // n'est pas définie ». Un KPI orphelin est exactement cela.
    const used = new Set<string>();
    for (const page of Object.values(PAGE_REGISTRY)) {
      for (const id of page.essentialKpis) used.add(id);
    }
    for (const objective of Object.values(OBJECTIVE_REGISTRY)) {
      for (const id of objective.unlocksKpis) used.add(id);
    }
    const orphans = Object.keys(KPI_REGISTRY).filter((id) => !used.has(id));
    expect(orphans, "KPI qu’aucune page ni objectif n’utilise").toEqual([]);
  });
});

describe("gate : zone B, les sources déclarées d'une page", () => {
  /** Manifeste minimal valide, pour n'exercer qu'une règle à la fois. */
  function page(patch: Partial<PageManifest>): PageManifest {
    return {
      id: "essai",
      version: 1,
      title: "Essai",
      question: "Question ?",
      zones: ["OPERATIONAL_HEADER", "SOURCE_RAIL", "FINANCIAL_CANVAS"],
      sources: [
        { id: "bank", category: "BANQUE", name: "Banque", evidence: "BANK_ACCOUNTS", planRef: "§17" },
      ],
      primaryAction: null,
      essentialKpis: ["net_worth"],
      allowedObjectives: [],
      supportedStates: ["AVAILABLE", "SYSTEM_ERROR"],
      realityModes: ["REAL"],
      viewport: "ALL_VIEWPORTS",
      deferred: [],
      ...patch,
    } as PageManifest;
  }

  function violationsOf(patch: Partial<PageManifest>) {
    return validateRegistries({ pages: { essai: page(patch) } })
      .filter((v) => v.rule === 4)
      .map((v) => v.message);
  }

  it("accepte le manifeste de référence", () => {
    expect(violationsOf({})).toEqual([]);
  });

  it("refuse une zone SOURCE_RAIL sans aucune source", () => {
    // Un rail vide n'est pas un rail : c'est la carte vide que le §6 de V10 refuse.
    expect(violationsOf({ sources: [] }).join(" ")).toContain("sans aucune source");
  });

  it("refuse des sources sans la zone qui les affiche", () => {
    expect(
      violationsOf({ zones: ["OPERATIONAL_HEADER", "FINANCIAL_CANVAS"] }).join(" "),
    ).toContain("sans la zone SOURCE_RAIL");
  });

  it("refuse deux sources de même identifiant", () => {
    expect(
      violationsOf({
        sources: [
          { id: "x", category: "BANQUE", name: "Banque", evidence: "BANK_ACCOUNTS", planRef: "§17" },
          { id: "x", category: "CONTRAT", name: "Contrat", evidence: "LIABILITIES", planRef: "§17" },
        ],
      }).join(" "),
    ).toContain("portent l’identifiant");
  });

  it("refuse deux sources appuyées sur la même preuve", () => {
    // Elles afficheraient toujours le même état : l'utilisateur croirait avoir deux pièces à
    // fournir là où il n'en manque qu'une.
    expect(
      violationsOf({
        sources: [
          { id: "a", category: "BANQUE", name: "Banque", evidence: "BANK_ACCOUNTS", planRef: "§17" },
          { id: "b", category: "DOCUMENT", name: "Relevé", evidence: "BANK_ACCOUNTS", planRef: "§17" },
        ],
      }).join(" "),
    ).toContain("s’appuient sur la preuve");
  });

  it("refuse un nom de source de plus de deux mots", () => {
    expect(
      violationsOf({
        sources: [
          {
            id: "a",
            category: "BANQUE",
            name: "Relevé de compte bancaire",
            evidence: "BANK_ACCOUNTS",
            planRef: "§17",
          },
        ],
      }).join(" "),
    ).toContain("autorise deux");
  });

  it("accepte un nom de deux mots et refuse un nom vide", () => {
    expect(
      violationsOf({
        sources: [
          {
            id: "a",
            category: "RELEVE_COURTIER",
            name: "Relevé courtier",
            evidence: "POSITIONS",
            planRef: "§23",
          },
        ],
      }),
    ).toEqual([]);
    expect(
      violationsOf({
        sources: [
          { id: "a", category: "BANQUE", name: "   ", evidence: "BANK_ACCOUNTS", planRef: "§17" },
        ],
      }).join(" "),
    ).toContain("n’a pas de nom");
  });

  it("refuse une source qui ne cite aucun passage du plan", () => {
    // Une source non fondée est une composition inventée, ce que la section 16 interdit.
    expect(
      violationsOf({
        sources: [
          { id: "a", category: "BANQUE", name: "Banque", evidence: "BANK_ACCOUNTS", planRef: "" },
        ],
      }).join(" "),
    ).toContain("ne cite aucun passage");
  });

  it("le registre réel passe ses propres gates", () => {
    const railViolations = validateRegistries().filter(
      (v) => v.rule === 4 && v.message.includes("source"),
    );
    expect(railViolations).toEqual([]);
  });

  it("chaque page à rail déclare au moins une source, et les autres aucune", () => {
    for (const [id, manifest] of Object.entries(PAGE_REGISTRY)) {
      if (manifest.zones.includes("SOURCE_RAIL")) {
        expect(manifest.sources.length, `page ${id}`).toBeGreaterThan(0);
      } else {
        expect(manifest.sources, `page ${id}`).toEqual([]);
      }
    }
  });

  it("toute catégorie déclarée est dessinable par le rail", () => {
    // Une catégorie déclarée par une page et inconnue du composant serait une composition
    // que rien ne peut afficher. C'est la raison pour laquelle la liste close a déménagé
    // dans le contrat.
    for (const manifest of Object.values(PAGE_REGISTRY)) {
      for (const source of manifest.sources) {
        expect(SOURCE_CATEGORY_LABELS[source.category]).toBeTruthy();
      }
    }
  });
});

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  getDemoTodayReadModel,
  buildDemoState,
  demoDeclarations,
} from "@/lib/data/read-models/today-demo";

/**
 * Espace de démonstration (§19.3) : ce qu'il montre, et ce qu'il ne peut PAS atteindre.
 *
 * La route `/demo` est publique, donc ces tests portent sur une garantie de sécurité et pas
 * seulement sur un contenu. La garantie n'est pas une promesse de relecture : elle est
 * structurelle, et le premier test la vérifie sur les imports du module.
 */

const MODULE = new URL("../today-demo.ts", import.meta.url).pathname;

describe("cloisonnement — la démonstration ne peut pas lire de donnée réelle", () => {
  it("n'importe ni le dépôt, ni le client Supabase, ni la lecture d'état", () => {
    const raw = readFileSync(MODULE, "utf8");
    // Les COMMENTAIRES sont retirés avant l'examen, et ce n'est pas une commodité : l'en-tête
    // du module explique justement qu'il n'importe pas `getRepository`, et un contrôle
    // lexical naïf accusait donc la phrase qui documente la garantie. Un commentaire n'appelle
    // rien.
    const source = raw.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " ");
    const imports = [...source.matchAll(/^import[^;]*from "([^"]+)";/gm)].map((match) => match[1]!);
    // `today.ts` est importé pour `todayViewInputFrom`, qui est une fonction PURE prenant un
    // état en paramètre. C'est le seul lien, et il ne va chercher aucune donnée.
    expect(imports).not.toContain("@/lib/data/repository");
    expect(imports).not.toContain("@/lib/data/supabase-client");
    expect(imports).not.toContain("@/lib/data/supabase-repository");
    expect(source).not.toContain("getRepository");
    expect(source).not.toContain("getTodayReadModel");
    expect(source).not.toContain("supabaseAdmin");
  });

  it("ne porte aucune donnée personnelle : identifiants et libellés sont de démonstration", () => {
    const model = getDemoTodayReadModel("2026-09-09");
    const serialised = JSON.stringify(model);
    // Un UUID en clair signalerait une donnée recopiée d'ailleurs.
    expect(serialised).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    // Aucune adresse électronique ni IBAN, mêmes fictifs : le §19.3 exige « aucune donnée
    // personnelle réelle », et le plus sûr est de n'en porter la FORME nulle part.
    expect(serialised).not.toMatch(/[\w.]+@[\w.]+\.\w+/);
    expect(serialised).not.toMatch(/\bFR\d{2}[\dA-Z]{10,}/);
  });

  it("est en LECTURE SEULE de bout en bout", () => {
    expect(getDemoTodayReadModel("2026-09-09").readOnlyDemo).toBe(true);
  });
});

describe("ce que la démonstration montre réellement", () => {
  const model = getDemoTodayReadModel("2026-09-09");

  it("répond aux six questions, dont cinq avec une valeur", () => {
    expect(model.answers).toHaveLength(6);
    const withValue = model.answers.filter((answer) => answer.value !== null);
    // Les six sont servies ; le solde libre porte une réserve, ce qui reste une valeur.
    expect(withValue).toHaveLength(6);
  });

  it("montre un cas PARTIEL expliqué, et non une valeur muette", () => {
    const partial = model.answers.find((answer) => answer.state === "PARTIAL");
    expect(partial).toBeDefined();
    expect(partial!.reserve).toBeTruthy();
  });

  it("montre un CONFLIT expliqué : une déclaration contre un fait", () => {
    const conflicts = model.inbox.sections.find((section) => section.id === "CONFLICTS")!;
    expect(conflicts.tasks).toHaveLength(1);
    expect(conflicts.tasks[0]!.state).toBe("SOURCE_CONFLICT");
  });

  it("montre les trois réponses du §18.1 côte à côte", () => {
    const answers = new Set(model.domains.map((domain) => domain.applicability));
    expect(answers.has("APPLICABLE")).toBe(true);
    expect(answers.has("DECLARED_NONE")).toBe(true);
    expect(answers.has("UNDECIDED")).toBe(true);
    // Et un domaine jamais déclaré, pour que le parcours ait encore une question à poser.
    expect(answers.has("UNDECLARED")).toBe(true);
  });

  it("montre une évolution entre deux clôtures comparables, avec ses causes", () => {
    expect(model.closeChange).not.toBeNull();
    expect(model.closeChange!.causes.length).toBeGreaterThan(0);
  });

  it("n'annonce aucune fraîcheur postérieure à la date d'arrêté", () => {
    // Une source relue « demain » est le défaut qui a fait corriger deux choses : les dates
    // des opérations de démonstration, et la fraîcheur d'un échéancier, qui rendait son
    // horizon.
    for (const source of model.railSources) {
      if (source.hint) expect(source.hint <= model.asOfDate, source.id).toBe(true);
    }
  });
});

describe("les dates sont RELATIVES, jamais figées", () => {
  it("suit la date qu'on lui donne", () => {
    // Le constat 5.1 est qu'« la date financière est codée en dur ». Une démonstration arrêtée
    // à une date fixe le rejouerait, et ses échéances à trente jours seraient vides dès le
    // mois suivant.
    expect(buildDemoState("2027-03-15").asOfDate).toBe("2027-03-15");
    expect(demoDeclarations("2027-03-15")[0]!.declaredOn).toBe("2027-02-13");
    const later = getDemoTodayReadModel("2027-03-15");
    expect(later.obligations.length).toBeGreaterThan(0);
    expect(later.closeChange).not.toBeNull();
  });

  it("ne date aucune opération après la date d'arrêté", () => {
    const state = buildDemoState("2026-09-03");
    for (const transaction of state.transactions) {
      expect(transaction.date <= state.asOfDate, transaction.id).toBe(true);
    }
  });
});

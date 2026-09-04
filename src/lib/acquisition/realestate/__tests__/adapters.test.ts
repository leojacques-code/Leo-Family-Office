import { describe, expect, it } from "vitest";

import {
  createDvfProvider,
  dvfCoverage,
  dvfDescriptor,
  readDvfRow,
} from "@/lib/acquisition/realestate/dvf";
import {
  createDpeProvider,
  DPE_ENERGY_UNIT,
  dpeDescriptor,
  readDpeRow,
} from "@/lib/acquisition/realestate/dpe";
import {
  readArea,
  readCode,
  readEnergyLabel,
  readIsoDate,
  readNumber,
  readRecordArray,
} from "@/lib/acquisition/realestate/read";
import type { PublicDataIssue } from "@/lib/acquisition/realestate/types";

function issues(): PublicDataIssue[] {
  return [];
}

describe("lecteurs défensifs", () => {
  it("refuse une chaîne qui ne décrit pas ENTIÈREMENT un nombre", () => {
    const collected = issues();
    // « 12 m² » n'est pas 12 : l'amputer inventerait une unité.
    expect(readNumber({ a: "12 m2" }, "a", 0, collected)).toBeNull();
    expect(collected[0].code).toBe("FIELD_UNREADABLE");
  });

  it("refuse une valeur portant à la fois virgule et point", () => {
    const collected = issues();
    expect(readNumber({ a: "1.234,56" }, "a", 0, collected)).toBeNull();
    expect(collected[0].message).toContain("indécidable");
  });

  it("accepte la virgule décimale seule", () => {
    expect(readNumber({ a: "1234,56" }, "a", 0, issues())).toBeCloseTo(1234.56, 6);
  });

  it("ne coerce PAS une chaîne vide en zéro", () => {
    // `Number("")` vaut 0 : c'est exactement le mensonge que ces lecteurs empêchent.
    expect(readNumber({ a: "" }, "a", 0, issues())).toBeNull();
  });

  it("refuse une surface nulle : une surface nulle n'est pas une surface", () => {
    const collected = issues();
    expect(readArea({ a: 0 }, "a", 0, collected)).toBeNull();
    expect(collected[0].message).toContain("reste inconnue");
  });

  it("refuse une date non ISO plutôt que d'arbitrer jour/mois", () => {
    const collected = issues();
    expect(readIsoDate({ a: "03/04/2025" }, "a", 0, collected)).toBeNull();
    expect(collected[0].message).toContain("jour/mois");
  });

  it("accepte une date ISO et ignore la partie horaire", () => {
    expect(readIsoDate({ a: "2026-03-15T10:00:00Z" }, "a", 0, issues())).toBe("2026-03-15");
  });

  it("refuse un code de mauvaise longueur plutôt que de le tronquer", () => {
    expect(readCode({ a: "7501" }, "a", 5, 0, issues())).toBeNull();
    expect(readCode({ a: "75012" }, "a", 5, 0, issues())).toBe("75012");
  });

  it("accepte un code INSEE corse porteur d'une lettre", () => {
    expect(readCode({ a: "2A004" }, "a", 5, 0, issues())).toBe("2A004");
  });

  it("refuse une étiquette hors A à G : elle reste inconnue, jamais G", () => {
    const collected = issues();
    expect(readEnergyLabel({ a: "H" }, "a", 0, collected)).toBeNull();
    expect(collected[0].message).toContain("pas une étiquette G");
  });

  it("refuse une forme de réponse inattendue plutôt que de rendre un tableau vide", () => {
    const collected = issues();
    expect(readRecordArray({ autre: 1 }, ["results"], collected)).toBeNull();
    expect(collected[0].code).toBe("SHAPE_UNEXPECTED");
  });

  it("lit un tableau nu, et un tableau imbriqué sous une clé connue", () => {
    expect(readRecordArray([{ a: 1 }], ["results"], issues())).toHaveLength(1);
    expect(readRecordArray({ results: [{ a: 1 }] }, ["results"], issues())).toHaveLength(1);
  });
});

describe("lecture d'une mutation DVF", () => {
  it("lit les termes principaux et déclare la devise", () => {
    const sale = readDvfRow(
      {
        id_mutation: "2026-1234",
        date_mutation: "2026-03-15",
        valeur_fonciere: "300000",
        surface_reelle_bati: "60",
        nombre_lots: "1",
        code_commune: "75112",
        adresse_numero: "12",
        adresse_nom_voie: "AVENUE DES LILAS",
      },
      0,
    );
    expect(sale).not.toBeNull();
    expect(sale!.price).toBe(300_000);
    expect(sale!.builtAreaSqm).toBe(60);
    expect(sale!.currency).toBe("EUR");
    expect(sale!.streetLabel).toBe("12 AVENUE DES LILAS");
  });

  it("écarte une mutation sans date ni prix : ce n'est pas une vente", () => {
    expect(readDvfRow({ valeur_fonciere: "300000" }, 0)).toBeNull();
    expect(readDvfRow({ date_mutation: "2026-03-15" }, 0)).toBeNull();
  });

  it("écarte une mutation à prix nul : une donation n'est pas un comparable", () => {
    expect(readDvfRow({ date_mutation: "2026-03-15", valeur_fonciere: "0" }, 0)).toBeNull();
  });

  it("signale une mutation multi-lots sans la jeter", () => {
    const sale = readDvfRow(
      {
        date_mutation: "2026-03-15",
        valeur_fonciere: "900000",
        surface_reelle_bati: "60",
        nombre_lots: "3",
      },
      0,
    );
    expect(sale!.lotCount).toBe(3);
    expect(sale!.issues.map((issue) => issue.code)).toContain("AMOUNT_NOT_COMPARABLE");
  });

  it("essaie toutes les graphies : un champ illisible ne masque pas un synonyme lisible", () => {
    const sale = readDvfRow(
      { datemut: "pas une date", date_mutation: "2026-03-15", valeur_fonciere: "250000" },
      0,
    );
    expect(sale!.mutatedOn).toBe("2026-03-15");
  });

  it("laisse la surface à null quand elle manque, sans la remplacer", () => {
    const sale = readDvfRow({ date_mutation: "2026-03-15", valeur_fonciere: "250000" }, 0);
    expect(sale!.builtAreaSqm).toBeNull();
  });
});

describe("couverture déclarée DVF", () => {
  const descriptor = dvfDescriptor({ baseUrl: "https://example.invalid/dvf" });

  it("déclare une zone couverte", () => {
    expect(dvfCoverage({ dataset: "DVF", communeCode: "75112" }, descriptor).state).toBe(
      "DECLARED_COVERED",
    );
  });

  it("déclare une zone NON couverte : un vide y est muet", () => {
    const coverage = dvfCoverage({ dataset: "DVF", communeCode: "67482" }, descriptor);
    expect(coverage.state).toBe("DECLARED_NOT_COVERED");
    expect(coverage.note).toContain("aucune vente");
  });

  it("refuse de déclarer une couverture sans repère géographique", () => {
    expect(dvfCoverage({ dataset: "DVF" }, descriptor).state).toBe("COVERAGE_UNKNOWN");
  });

  it("découpe le département sur trois caractères en outre-mer", () => {
    expect(dvfCoverage({ dataset: "DVF", communeCode: "97601" }, descriptor).state).toBe(
      "DECLARED_NOT_COVERED",
    );
  });
});

describe("lecture d'un DPE", () => {
  it("lit l'étiquette et attache l'unité à la valeur", () => {
    const certificate = readDpeRow(
      {
        numero_dpe: "2345E0000001",
        date_etablissement_dpe: "2025-06-01",
        date_fin_validite_dpe: "2035-06-01",
        etiquette_dpe: "C",
        consommation_energie_primaire: "132",
        surface_habitable_logement: "62",
        adresse_ban: "12 avenue des Lilas 75012 Paris",
      },
      0,
    );
    expect(certificate.energyLabel).toBe("C");
    expect(certificate.energyValue).toBe(132);
    expect(certificate.energyUnit).toBe(DPE_ENERGY_UNIT);
    expect(certificate.validUntil).toBe("2035-06-01");
  });

  it("laisse la validité INCONNUE quand la source ne la déclare pas", () => {
    const certificate = readDpeRow({ etiquette_dpe: "D" }, 0);
    expect(certificate.validUntil).toBeNull();
    const message = certificate.issues.map((issue) => issue.message).join(" ");
    expect(message).toContain("n'est pas déduite d'une règle");
  });

  it("n'attache aucune unité à une valeur absente", () => {
    const certificate = readDpeRow({ etiquette_dpe: "D" }, 0);
    expect(certificate.energyValue).toBeNull();
    expect(certificate.energyUnit).toBeNull();
  });

  it("refuse de déduire une étiquette d'une consommation", () => {
    const certificate = readDpeRow({ consommation_energie_primaire: "400" }, 0);
    expect(certificate.energyLabel).toBeNull();
    expect(certificate.issues.map((issue) => issue.code)).toContain("CAPABILITY_NOT_SERVED");
  });

  it("signale une validité antérieure à l'établissement plutôt que de la corriger", () => {
    const certificate = readDpeRow(
      { date_etablissement_dpe: "2025-06-01", date_fin_validite_dpe: "2024-01-01" },
      0,
    );
    expect(certificate.issues.map((issue) => issue.message).join(" ")).toContain(
      "refusé par la base",
    );
  });

  it("ne déclare AUCUNE couverture d'adresse : un DPE peut ne pas exister", () => {
    expect(dpeDescriptor().capabilities.declaresCoverage).toBe(false);
  });

  it("ne déclare AUCUN identifiant stable : un rejet automatique ferait disparaître un fait", () => {
    expect(dpeDescriptor().capabilities.stableRecordId).toBe(false);
    expect(dvfDescriptor().capabilities.stableRecordId).toBe(false);
  });
});

/**
 * PROPAGATION DU SIGNAL DE L'APPELANT — DVF ET DPE
 *
 * Le durcissement du transport ne sert à rien si le signal de la requête HTTP entrante
 * s'arrête à la porte de l'adaptateur. Les deux jeux de données publics sont vérifiés
 * séparément : ils partagent le transport, pas leur code d'URL.
 */
describe("propagation du signal jusqu'au transport", () => {
  it("DVF : un appelant DÉJÀ parti n'engendre AUCUN appel réseau", async () => {
    const controller = new AbortController();
    controller.abort();
    let called = false;
    const provider = createDvfProvider({
      baseUrl: "https://dvf.test/mutations",
      transport: {
        fetchImpl: async () => {
          called = true;
          return new Response("{}", { status: 200 });
        },
        maxAttempts: 1,
      },
    });
    const fetched = await provider.fetch(
      { dataset: "DVF", communeCode: "75056" },
      { signal: controller.signal },
    );
    expect(called).toBe(false);
    expect(fetched.status).toBe("FAILED");
    expect(fetched.errorCode).toBe("CANCELLED");
    // Un abandon reste un FAIT daté, pas une absence de mutations.
    expect(fetched.sales).toEqual([]);
  });

  it("DPE : un appelant DÉJÀ parti n'engendre AUCUN appel réseau", async () => {
    const controller = new AbortController();
    controller.abort();
    let called = false;
    const provider = createDpeProvider({
      baseUrl: "https://dpe.test/certificats",
      transport: {
        fetchImpl: async () => {
          called = true;
          return new Response("{}", { status: 200 });
        },
        maxAttempts: 1,
      },
    });
    const fetched = await provider.fetch(
      { dataset: "DPE", communeCode: "75056" },
      { signal: controller.signal },
    );
    expect(called).toBe(false);
    expect(fetched.errorCode).toBe("CANCELLED");
    expect(fetched.certificates).toEqual([]);
  });

  it("DVF : le signal transmis à fetch est le COMPOSÉ, non celui de l'appelant", async () => {
    const controller = new AbortController();
    let seen: AbortSignal | null = null;
    const provider = createDvfProvider({
      baseUrl: "https://dvf.test/mutations",
      transport: {
        fetchImpl: async (_url, init) => {
          seen = (init?.signal as AbortSignal) ?? null;
          return new Response(JSON.stringify({ results: [] }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        },
        maxAttempts: 1,
      },
    });
    await provider.fetch({ dataset: "DVF", communeCode: "75056" }, { signal: controller.signal });
    expect(seen).not.toBeNull();
    expect(seen).not.toBe(controller.signal);
    expect(seen!.aborted).toBe(false);
  });

  it("DVF : le plafond de taille se durcit PAR ADAPTATEUR sans second transport", async () => {
    // Le même corps passe sous un plafond large et est refusé sous un plafond serré : c'est
    // la surcharge par connexion, et elle n'exige aucune duplication du transport.
    const body = JSON.stringify({ results: [] });
    const build = (maxResponseBytes: number) =>
      createDvfProvider({
        baseUrl: "https://dvf.test/mutations",
        transport: {
          fetchImpl: async () =>
            new Response(body, { status: 200, headers: { "content-type": "application/json" } }),
          maxAttempts: 1,
          maxResponseBytes,
        },
      });
    const large = await build(4_096).fetch({ dataset: "DVF", communeCode: "75056" });
    const tight = await build(4).fetch({ dataset: "DVF", communeCode: "75056" });
    expect(large.errorCode).toBeNull();
    expect(tight.errorCode).toBe("RESPONSE_TOO_LARGE");
    // NOTRE plafond a tranché : ce n'est pas une absence de mutations.
    expect(tight.sales).toEqual([]);
  });

  it("DVF : un diagnostic d'échec ne restitue NI l'URL NI la chaîne de requête", async () => {
    // L'URL DVF porte les paramètres de la requête, et un point d'accès configuré peut
    // porter un jeton : le message est persisté puis affiché.
    const provider = createDvfProvider({
      baseUrl: "https://dvf.test/mutations?cle=secret-de-test",
      transport: {
        fetchImpl: async () => {
          throw new Error(
            "request to https://dvf.test/mutations?cle=secret-de-test&code_commune=75056 failed",
          );
        },
        maxAttempts: 1,
      },
    });
    const fetched = await provider.fetch({ dataset: "DVF", communeCode: "75056" });
    expect(fetched.errorCode).toBe("NETWORK");
    const surface = `${fetched.errorMessage ?? ""}|${fetched.issues.map((i) => i.message).join("|")}`;
    expect(surface).not.toContain("secret-de-test");
    expect(surface).not.toContain("https://");
    expect(surface).not.toContain("code_commune=");
  });
});

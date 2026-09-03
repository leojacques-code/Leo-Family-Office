import { describe, expect, it } from "vitest";

import { createRechercheEntreprisesAdapter } from "@/lib/acquisition/registry/recherche-entreprises";
import type { RegistryRawResponse } from "@/lib/acquisition/registry/types";
import {
  EMPTY_PAYLOAD,
  MALFORMED_PAYLOAD,
  OTHER_ENTITY_PAYLOAD,
  SEARCH_PAYLOAD,
  SIREN_ALPHA,
  SIREN_BETA,
} from "./fixtures/recherche-entreprises";

const adapter = createRechercheEntreprisesAdapter({
  // Aucun appel réseau : la lecture est testée sur des charges, le transport ailleurs.
  fetchImpl: async () => new Response("{}", { status: 200 }),
});

function response(payload: unknown, query: Record<string, unknown> = {}): RegistryRawResponse {
  return {
    endpoint: "ENTITY",
    query,
    httpStatus: 200,
    payload,
    payloadBytes: JSON.stringify(payload).length,
    observedAt: "2026-08-31T10:00:00.000Z",
    providerUpdatedAt: null,
    errorCode: null,
    errorMessage: null,
  };
}

function codes(list: { code: string }[]): string[] {
  return list.map((issue) => issue.code);
}

describe("capacités déclarées", () => {
  it("n'annonce PAS ce que l'annuaire ne publie pas", () => {
    // Ces absences ne sont pas des oublis : elles font écrire « non servi » à l'écran plutôt
    // qu'afficher un vide qu'on prendrait pour une donnée manquante.
    expect(adapter.capabilities).not.toContain("share_capital");
    expect(adapter.capabilities).not.toContain("legal_form_label");
    expect(adapter.capabilities).not.toContain("naf_label");
    expect(adapter.capabilities).not.toContain("greffe");
    expect(adapter.capabilities).not.toContain("documents");
    expect(adapter.capabilities).toContain("legal_form_code");
    expect(adapter.capabilities).toContain("naf_code");
  });

  it("n'exige aucun secret et déclare une fraîcheur", () => {
    expect(adapter.authMode).toBe("NONE");
    expect(adapter.credentialEnvVar).toBeNull();
    expect(adapter.snapshotTtlMinutes).toBe(24 * 60);
    expect(adapter.rateLimitPerMinute).toBeGreaterThan(0);
  });
});

describe("lecture d'une fiche conforme", () => {
  const reading = adapter.readEntity(response(SEARCH_PAYLOAD, { siren: SIREN_ALPHA }));

  it("extrait l'identité et préfère la dénomination LÉGALE au nom complet", () => {
    expect(reading.profile?.siren).toBe(SIREN_ALPHA);
    expect(reading.profile?.legalName).toBe("SOCIÉTÉ FICTIVE ALPHA");
    expect(reading.profile?.tradeName).toBe("SOCIÉTÉ FICTIVE ALPHA (ALPHA CONSEIL)");
    expect(reading.profile?.acronym).toBe("SFA");
  });

  it("conserve le CODE de forme juridique et laisse le libellé vide", () => {
    expect(reading.profile?.legalFormCode).toBe("5710");
    expect(reading.profile?.legalFormLabel).toBeNull();
  });

  it("ne renseigne ni capital, ni date de cessation, faute de source", () => {
    expect(reading.profile?.shareCapital).toBeNull();
    expect(reading.profile?.shareCapitalCurrency).toBeNull();
    // Un état administratif « cessée » ne DATE pas la cessation : la déduire serait inventer.
    expect(reading.profile?.ceasedOn).toBeNull();
  });

  it("lit le siège, l'activité, la création et l'état", () => {
    expect(reading.profile?.headOfficeSiret).toBe(`${SIREN_ALPHA}00009`);
    expect(reading.profile?.postalCode).toBe("75002");
    expect(reading.profile?.city).toBe("PARIS 2E ARRONDISSEMENT");
    expect(reading.profile?.nafCode).toBe("70.22Z");
    expect(reading.profile?.createdOn).toBe("2019-04-15");
    expect(reading.profile?.registryStatus).toBe("ACTIVE");
    expect(reading.profile?.establishmentCount).toBe(2);
  });

  it("lit les dirigeants en distinguant personne physique et personne morale", () => {
    expect(reading.officers).toHaveLength(2);
    expect(reading.officers[0]).toMatchObject({
      officerKind: "PERSON",
      lastName: "DUPONT-FICTIF",
      birthYear: 1978,
      roleLabel: "Président",
    });
    expect(reading.officers[1]).toMatchObject({
      officerKind: "COMPANY",
      companySiren: SIREN_BETA,
      companyName: "HOLDING FICTIVE BETA",
    });
    // Aucune date de prise de fonction n'est publiée : elle reste nulle.
    expect(reading.officers[0].sinceOn).toBeNull();
  });

  it("ne rend AUCUN dépôt : l'annuaire n'en publie pas", () => {
    expect(reading.documents).toEqual([]);
  });
});

describe("lecture d'une fiche malformée", () => {
  const reading = adapter.readEntity(response(MALFORMED_PAYLOAD, { siren: SIREN_ALPHA }));

  it("produit un profil PARTIEL sans jamais coercer une valeur", () => {
    expect(reading.profile).not.toBeNull();
    // Dénomination reçue comme objet : refusée, pas convertie en « [object Object] ».
    expect(reading.profile?.legalName).toBeNull();
    // Date française : illisible sans convention devinée.
    expect(reading.profile?.createdOn).toBeNull();
    // Décompte textuel : refusé.
    expect(reading.profile?.establishmentCount).toBeNull();
  });

  it("nomme chaque anomalie", () => {
    const list = codes([...reading.issues, ...(reading.profile?.issues ?? [])]);
    expect(list).toContain("FIELD_UNEXPECTED_TYPE");
    expect(list).toContain("FIELD_UNREADABLE_DATE");
    expect(list).toContain("FIELD_UNREADABLE_NUMBER");
    // Le siège porte un autre SIREN : refusé, et dit.
    expect(list).toContain("SIRET_SIREN_MISMATCH");
    // Dirigeants reçus comme objet et non comme liste.
    expect(list).toContain("PAYLOAD_SHAPE_UNEXPECTED");
  });

  it("laisse le statut INCONNU quand le code d'état n'est pas reconnu", () => {
    expect(reading.profile?.registryStatus).toBe("UNKNOWN");
  });
});

describe("garde-fous d'identité", () => {
  it("REFUSE un résultat portant un autre SIREN que celui demandé", () => {
    const reading = adapter.readEntity(response(OTHER_ENTITY_PAYLOAD, { siren: SIREN_ALPHA }));
    expect(reading.profile).toBeNull();
    expect(codes(reading.issues)).toContain("RESULT_SET_EMPTY");
  });

  it("refuse une racine qui n'a pas la forme attendue", () => {
    const reading = adapter.readEntity(response("pas un objet", { siren: SIREN_ALPHA }));
    expect(reading.profile).toBeNull();
    expect(codes(reading.issues)).toContain("PAYLOAD_SHAPE_UNEXPECTED");
  });
});

describe("lecture d'une recherche", () => {
  it("rend les résultats exploitables et l'annonce de volume", () => {
    const reading = adapter.readSearch(response(SEARCH_PAYLOAD));
    expect(reading.hits).toHaveLength(1);
    expect(reading.hits[0].siren).toBe(SIREN_ALPHA);
    expect(reading.hits[0].officerNames).toEqual(["CAMILLE DUPONT-FICTIF", "HOLDING FICTIVE BETA"]);
    expect(reading.totalResults).toBe(1);
  });

  it("dit qu'une recherche a répondu sans rien trouver", () => {
    const reading = adapter.readSearch(response(EMPTY_PAYLOAD));
    expect(reading.hits).toEqual([]);
    expect(codes(reading.issues)).toContain("RESULT_SET_EMPTY");
  });

  it("signale une troncature plutôt que de laisser croire à l'exhaustivité", () => {
    const reading = adapter.readSearch(response({ ...SEARCH_PAYLOAD, total_results: 240 }));
    expect(codes(reading.issues)).toContain("RESULT_SET_TRUNCATED");
  });
});

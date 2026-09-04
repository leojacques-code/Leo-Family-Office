import { describe, expect, it } from "vitest";

import { createRegistryAdapter } from "@/lib/acquisition/registry";
import {
  createInpiRneAdapter,
  INPI_RNE_CREDENTIAL_ENV_VAR,
} from "@/lib/acquisition/registry/inpi-rne";
import {
  createFixtureAdapter,
  FIXTURE_SIREN_COMPLETE,
  FIXTURE_SIREN_SPARSE,
} from "@/lib/acquisition/registry/fixture-provider";

describe("adaptateur INPI / RNE", () => {
  it("refuse SANS appel réseau quand le jeton est absent", async () => {
    let called = false;
    const adapter = createInpiRneAdapter({
      token: null,
      fetchImpl: async () => {
        called = true;
        return new Response("{}", { status: 200 });
      },
    });
    const response = await adapter.entity("900000001");
    expect(called).toBe(false);
    expect(response.errorCode).toBe("CREDENTIALS_MISSING");
    expect(response.errorMessage).toContain(INPI_RNE_CREDENTIAL_ENV_VAR);
    // L'échec reste un fait daté : il porte une date d'observation.
    expect(response.observedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("déclare exiger un jeton, et n'expose que le NOM de la variable", () => {
    const adapter = createInpiRneAdapter({ token: "secret-de-test" });
    expect(adapter.authMode).toBe("BEARER_TOKEN");
    expect(adapter.credentialEnvVar).toBe(INPI_RNE_CREDENTIAL_ENV_VAR);
    expect(JSON.stringify(adapter)).not.toContain("secret-de-test");
  });

  it("renvoie vers l'annuaire ouvert pour une recherche par raison sociale", async () => {
    const adapter = createInpiRneAdapter({ token: "jeton" });
    const response = await adapter.search({ text: "SOCIÉTÉ FICTIVE" });
    expect(response.errorCode).toBe("INVALID_RESPONSE");
    expect(response.errorMessage).toContain("annuaire ouvert");
  });

  it("sert les champs que l'annuaire ouvert ne sert pas", () => {
    const adapter = createInpiRneAdapter({ token: "jeton" });
    expect(adapter.capabilities).toContain("share_capital");
    expect(adapter.capabilities).toContain("legal_form_label");
    expect(adapter.capabilities).toContain("documents");
  });

  it("lit un capital sans devise comme NON exploitable", () => {
    const adapter = createInpiRneAdapter({ token: "jeton" });
    const reading = adapter.readEntity({
      endpoint: "ENTITY",
      query: { siren: "900000001" },
      httpStatus: 200,
      payload: {
        siren: "900000001",
        formality: {
          content: {
            personneMorale: {
              identite: {
                entreprise: { denomination: "SOCIÉTÉ FICTIVE ALPHA", formeJuridique: "5710" },
                description: { montantCapital: 50000 },
              },
            },
          },
        },
      },
      payloadBytes: 10,
      observedAt: "2026-08-31T10:00:00.000Z",
      providerUpdatedAt: null,
      errorCode: null,
      errorMessage: null,
    });
    expect(reading.profile?.legalName).toBe("SOCIÉTÉ FICTIVE ALPHA");
    expect(reading.profile?.shareCapital).toBeNull();
    expect(reading.profile?.issues.map((issue) => issue.code)).toContain(
      "CAPITAL_WITHOUT_CURRENCY",
    );
  });

  it("ne déduit pas une activité d'une absence de radiation", () => {
    const adapter = createInpiRneAdapter({ token: "jeton" });
    const reading = adapter.readEntity({
      endpoint: "ENTITY",
      query: { siren: "900000001" },
      httpStatus: 200,
      payload: { siren: "900000001", formality: { content: { personneMorale: {} } } },
      payloadBytes: 10,
      observedAt: "2026-08-31T10:00:00.000Z",
      providerUpdatedAt: null,
      errorCode: null,
      errorMessage: null,
    });
    expect(reading.profile?.registryStatus).toBeNull();
  });
});

describe("adaptateur de fixtures", () => {
  it("sert une fiche complète et une fiche pauvre", async () => {
    const adapter = createFixtureAdapter();
    const complete = adapter.readEntity(await adapter.entity(FIXTURE_SIREN_COMPLETE));
    expect(complete.profile?.legalName).toBe("SOCIÉTÉ FICTIVE ALPHA");
    expect(complete.profile?.shareCapital).toBe(50_000);
    expect(complete.officers).toHaveLength(2);
    expect(complete.documents).toHaveLength(2);

    const sparse = adapter.readEntity(await adapter.entity(FIXTURE_SIREN_SPARSE));
    expect(sparse.profile?.legalName).toBe("HOLDING FICTIVE BETA");
    // Une fiche pauvre laisse des `null`, jamais des zéros.
    expect(sparse.profile?.shareCapital).toBeNull();
    expect(sparse.profile?.nafCode).toBeNull();
    expect(sparse.officers).toEqual([]);
  });

  it("rend NOT_FOUND pour un SIREN inconnu, sans inventer d'entité", async () => {
    const adapter = createFixtureAdapter();
    const response = await adapter.entity("900000027");
    expect(response.errorCode).toBe("NOT_FOUND");
    expect(response.payload).toBeNull();
  });

  it("peut simuler un échec de fournisseur", async () => {
    const adapter = createFixtureAdapter({ failWith: "RATE_LIMITED" });
    const response = await adapter.entity(FIXTURE_SIREN_COMPLETE);
    expect(response.errorCode).toBe("RATE_LIMITED");
    expect(response.httpStatus).toBe(429);
  });

  it("peut déclarer une fraîcheur nulle, pour éprouver la péremption", () => {
    expect(createFixtureAdapter({ snapshotTtlMinutes: null }).snapshotTtlMinutes).toBeNull();
    expect(createFixtureAdapter({ snapshotTtlMinutes: 1 }).snapshotTtlMinutes).toBe(1);
  });

  it("trouve une entité par nom de dirigeant", async () => {
    const adapter = createFixtureAdapter();
    const reading = adapter.readSearch(await adapter.search({ officerName: "dupont" }));
    expect(reading.hits.map((hit) => hit.siren)).toEqual([FIXTURE_SIREN_COMPLETE]);
  });
});

describe("fabrique d'adaptateurs", () => {
  it("ne substitue JAMAIS un fournisseur à un autre", () => {
    // Demander l'INPI sans jeton doit rendre l'INPI, qui refusera : rendre l'annuaire ouvert
    // à la place produirait un instantané au nom d'un fournisseur qui n'a rien répondu.
    expect(createRegistryAdapter("INPI_RNE").provider).toBe("INPI_RNE");
    expect(createRegistryAdapter("RECHERCHE_ENTREPRISES").provider).toBe("RECHERCHE_ENTREPRISES");
    expect(createRegistryAdapter("FIXTURE").provider).toBe("FIXTURE");
  });
});

/**
 * PROPAGATION DU SIGNAL DE L'APPELANT
 *
 * Le durcissement du transport ne sert à rien si le signal de la requête HTTP entrante
 * s'arrête à la porte de l'adaptateur. Ces cas vérifient le CHAÎNAGE : ce que la route
 * transmet doit arriver jusqu'à `fetch`, et un appelant déjà parti ne doit produire aucun
 * appel réseau — donc aucune consommation de quota fournisseur.
 */
describe("propagation du signal jusqu'au transport", () => {
  it("INPI : le signal reçu par entity() est celui que fetch observe", async () => {
    const controller = new AbortController();
    let seen: AbortSignal | null = null;
    const adapter = createInpiRneAdapter({
      token: "jeton",
      fetchImpl: async (_url, init) => {
        seen = (init?.signal as AbortSignal) ?? null;
        return new Response(JSON.stringify({ formality: {} }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    });
    await adapter.entity("900000001", { signal: controller.signal });
    expect(seen).not.toBeNull();
    // Le signal transmis est le COMPOSÉ, pas celui de l'appelant : il porte aussi le délai
    // interne du transport.
    expect(seen).not.toBe(controller.signal);
    expect(seen!.aborted).toBe(false);
  });

  it("INPI : un appelant DÉJÀ parti ne déclenche AUCUN appel réseau", async () => {
    const controller = new AbortController();
    controller.abort();
    let called = false;
    const adapter = createInpiRneAdapter({
      token: "jeton",
      fetchImpl: async () => {
        called = true;
        return new Response("{}", { status: 200 });
      },
    });
    const response = await adapter.entity("900000001", { signal: controller.signal });
    // Aucun appel, donc aucun jeton de quota consommé pour une réponse que personne n'attend.
    expect(called).toBe(false);
    expect(response.errorCode).toBe("CANCELLED");
  });

  it("INPI : search() par SIREN transmet le signal à entity()", async () => {
    const controller = new AbortController();
    controller.abort();
    let called = false;
    const adapter = createInpiRneAdapter({
      token: "jeton",
      fetchImpl: async () => {
        called = true;
        return new Response("{}", { status: 200 });
      },
    });
    const response = await adapter.search({ siren: "900000001" }, { signal: controller.signal });
    expect(called).toBe(false);
    expect(response.errorCode).toBe("CANCELLED");
  });

  it("annuaire ouvert : search() et entity() transmettent tous deux le signal", async () => {
    const controller = new AbortController();
    controller.abort();
    let calls = 0;
    const adapter = createRegistryAdapter("RECHERCHE_ENTREPRISES", {
      fetchImpl: async () => {
        calls += 1;
        return new Response("{}", { status: 200 });
      },
    });
    const search = await adapter.search({ text: "boulangerie" }, { signal: controller.signal });
    const entity = await adapter.entity("900000001", { signal: controller.signal });
    expect(calls).toBe(0);
    expect(search.errorCode).toBe("CANCELLED");
    expect(entity.errorCode).toBe("CANCELLED");
  });

  it("la FIXTURE honore le signal, sans quoi un test d'annulation ne prouverait rien", async () => {
    // Une fixture qui ignorerait le signal ferait passer un test de propagation sur un
    // double qui ne lit rien : la conduite doit être la même que celle du transport.
    const controller = new AbortController();
    controller.abort();
    const adapter = createFixtureAdapter();
    const entity = await adapter.entity(FIXTURE_SIREN_COMPLETE, { signal: controller.signal });
    expect(entity.errorCode).toBe("CANCELLED");
    // Sans signal, la fixture répond normalement : le garde ne bride pas le cas nominal.
    expect((await adapter.entity(FIXTURE_SIREN_COMPLETE)).errorCode).toBeNull();
  });

  it("aucun signal fourni : le comportement nominal est INCHANGÉ", async () => {
    // Un appelant hors requête HTTP — un smoke, un script — n'a rien à propager, et le
    // transport garde son propre délai.
    const adapter = createInpiRneAdapter({
      token: "jeton",
      fetchImpl: async (_url, init) => {
        // Un signal composé est TOUJOURS transmis : c'est lui qui porte le délai interne.
        expect(init?.signal).toBeDefined();
        return new Response(JSON.stringify({ formality: {} }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    });
    expect((await adapter.entity("900000001")).errorCode).toBeNull();
  });
});

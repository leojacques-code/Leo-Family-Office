import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildDemoState, demoDeclarations } from "@/lib/data/read-models/today-demo";

/**
 * Route d'Aujourd'hui : ce qu'elle rend, et ce qu'elle refuse d'accepter du client.
 *
 * Le point dur est la DATE ÉCONOMIQUE d'une déclaration. Elle n'est pas reçue du navigateur :
 * un client pourrait sinon antidater une réponse et changer laquelle est la déclaration
 * courante. Le §5 de la constitution du dépôt le dit d'un cas voisin — une donnée dont le
 * « quand » est déclaratif ne répond pas à la question qu'elle prétend documenter.
 */

const mocks = vi.hoisted(() => ({
  authenticated: true,
  declared: [] as {
    domain: string;
    applicability: string;
    declaredOn: string;
    note: string | null;
  }[],
}));

vi.mock("@/lib/auth", () => ({
  requireAuthenticated: vi.fn(async () => {
    if (!mocks.authenticated) throw new Error("UNAUTHORIZED");
  }),
}));

vi.mock("@/lib/data/repository", () => ({
  getRepository: vi.fn(async () => ({
    getDashboardState: async () => buildDemoState("2026-09-08"),
    getDomainDeclarations: async () => demoDeclarations("2026-09-08"),
    declareDomainApplicability: async (input: (typeof mocks.declared)[number]) => {
      mocks.declared.push(input);
      return true;
    },
  })),
}));

vi.mock("@/lib/financial-date", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/financial-date")>()),
  operationalToday: () => "2026-09-11",
}));

import { GET, POST } from "./route";

function post(body: unknown) {
  return POST(
    new Request("http://localhost/api/today", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

describe("GET /api/today", () => {
  beforeEach(() => {
    mocks.authenticated = true;
    mocks.declared = [];
  });

  it("refuse une route non authentifiée", async () => {
    mocks.authenticated = false;
    expect((await GET()).status).toBe(401);
  });

  it("rend le modèle de lecture, et JAMAIS l'état global", async () => {
    const body = await (await GET()).json();
    // Le §13 : « aucune page de domaine ne sérialise tout DashboardState ». Les familles de
    // faits de l'état ne doivent pas apparaître dans la réponse.
    expect(body.answers).toHaveLength(6);
    expect(body.transactions).toBeUndefined();
    expect(body.accounts).toBeUndefined();
    expect(body.liabilities).toBeUndefined();
    expect(body.metrics).toBeUndefined();
  });
});

describe("POST /api/today", () => {
  beforeEach(() => {
    mocks.authenticated = true;
    mocks.declared = [];
  });

  it("refuse une route non authentifiée", async () => {
    mocks.authenticated = false;
    expect((await post({ domain: "IMMOBILIER", applicability: "DECLARED_NONE" })).status).toBe(401);
  });

  it("date la déclaration côté SERVEUR, et ignore toute date envoyée par le client", async () => {
    const response = await post({
      domain: "IMMOBILIER",
      applicability: "DECLARED_NONE",
      declaredOn: "2020-01-01",
    });
    expect(response.status).toBe(200);
    expect(mocks.declared).toHaveLength(1);
    // La date du client est absente du schéma, donc rejetée par omission : la déclaration
    // porte la date opérationnelle du serveur.
    expect(mocks.declared[0]!.declaredOn).toBe("2026-09-11");
  });

  it("refuse un domaine hors des huit du §19.1", async () => {
    expect((await post({ domain: "CRYPTOMONNAIE", applicability: "APPLICABLE" })).status).toBe(400);
  });

  it("refuse une réponse hors des trois du §18.1", async () => {
    expect((await post({ domain: "DETTE", applicability: "PEUT_ETRE" })).status).toBe(400);
  });

  it("refuse un corps vide ou illisible", async () => {
    expect((await post(null)).status).toBe(400);
    expect((await post({ domain: "DETTE" })).status).toBe(400);
  });

  it("transforme un motif vide en absence de motif, jamais en chaîne vide", async () => {
    // CHAÎNE VIDE ≠ ABSENCE, et la base refuse déjà la première.
    expect((await post({ domain: "DETTE", applicability: "APPLICABLE", note: "   " })).status).toBe(
      400,
    );
    await post({ domain: "DETTE", applicability: "APPLICABLE" });
    expect(mocks.declared.at(-1)!.note).toBeNull();
  });

  it("rend le modèle relu APRÈS écriture, pas celui d'avant", async () => {
    const body = await (await post({ domain: "IMMOBILIER", applicability: "APPLICABLE" })).json();
    expect(body.answers).toHaveLength(6);
    expect(body.domains).toHaveLength(8);
  });
});

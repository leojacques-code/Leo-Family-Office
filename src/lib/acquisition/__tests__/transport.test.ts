/**
 * TESTS DU TRANSPORT UNIQUE DE LA COUCHE D'ACQUISITION
 *
 * Deux transports coexistaient, chacun avec ses tests. Ce fichier est la fusion : il
 * conserve les cas de conduite en panne du transport de registre (quota plafonné, aucun
 * réessai sur une autorisation refusée ou une sortie bloquée, horodatage du fournisseur) ET
 * les cas durement acquis de celui des données publiques (corps illisible qui ne fait pas
 * perdre le statut, limite locale distinguée d'un refus de la source).
 */
import { describe, expect, it } from "vitest";

import {
  callJson,
  classifyFetchFailure,
  classifyHttpStatus,
  RateLimiter,
  type TransportClock,
  type TransportConfig,
} from "@/lib/acquisition/transport";

/** Horloge pilotée : une conduite en cas de panne ne se teste pas sur `Date.now()`. */
function fakeClock(start = 0): TransportClock & { advance: (ms: number) => void } {
  let current = start;
  return {
    now: () => current,
    advance: (ms: number) => {
      current += ms;
    },
  };
}

function config(
  overrides: Partial<TransportConfig> & Pick<TransportConfig, "fetchImpl">,
): TransportConfig {
  const clock = overrides.clock ?? fakeClock();
  return {
    clock,
    // Le sommeil est INSTANTANÉ dans les tests, et il fait avancer l'horloge : sans cela un
    // test de quota attendrait réellement une minute.
    sleep: async (ms: number) => {
      (clock as ReturnType<typeof fakeClock>).advance?.(ms);
    },
    timeoutMs: 50,
    maxAttempts: 3,
    backoffBaseMs: 1,
    backoffCapMs: 4,
    rateLimitPerMinute: null,
    maxRateLimitWaitMs: 3_000,
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("classement d'un statut HTTP", () => {
  it("nomme chaque famille, et n'invente pas de succès", () => {
    expect(classifyHttpStatus(200)).toBeNull();
    expect(classifyHttpStatus(204)).toBeNull();
    expect(classifyHttpStatus(401)).toBe("UNAUTHORIZED");
    expect(classifyHttpStatus(403)).toBe("UNAUTHORIZED");
    expect(classifyHttpStatus(404)).toBe("NOT_FOUND");
    expect(classifyHttpStatus(429)).toBe("RATE_LIMITED");
    expect(classifyHttpStatus(503)).toBe("PROVIDER_ERROR");
  });
});

describe("classement d'une exception réseau", () => {
  it("reconnaît une interruption pour dépassement de délai", () => {
    const error = new Error("aborted");
    error.name = "AbortError";
    expect(classifyFetchFailure(error).code).toBe("TIMEOUT");
  });

  it("reconnaît un refus de politique de sortie, sans le confondre avec une panne", () => {
    expect(classifyFetchFailure(new Error("tunneling socket could not be established")).code).toBe(
      "EGRESS_BLOCKED",
    );
  });

  it("retombe sur NETWORK plutôt que d'inventer un diagnostic", () => {
    expect(classifyFetchFailure(new Error("socket hang up")).code).toBe("NETWORK");
  });
});

describe("seau à jetons", () => {
  it("n'impose aucune attente sans quota déclaré", () => {
    const limiter = new RateLimiter(null, fakeClock());
    for (let index = 0; index < 100; index += 1) limiter.record();
    expect(limiter.waitFor()).toBe(0);
  });

  it("impose une attente au-delà du quota, et la libère après la fenêtre", () => {
    const clock = fakeClock(1_000);
    const limiter = new RateLimiter(2, clock);
    limiter.record();
    limiter.record();
    expect(limiter.waitFor()).toBe(60_000);
    clock.advance(60_001);
    expect(limiter.waitFor()).toBe(0);
  });
});

describe("appel borné", () => {
  it("rend le corps lu sur un succès, sans réessai inutile", async () => {
    let calls = 0;
    const result = await callJson(
      { url: "https://exemple.test/x" },
      config({
        fetchImpl: async () => {
          calls += 1;
          return jsonResponse({ ok: true });
        },
      }),
      new RateLimiter(null, fakeClock()),
    );
    expect(calls).toBe(1);
    expect(result.errorCode).toBeNull();
    expect(result.payload).toEqual({ ok: true });
    expect(result.attempts).toBe(1);
  });

  it("réessaie un 429 jusqu'au plafond, puis rend l'échec", async () => {
    let calls = 0;
    const result = await callJson(
      { url: "https://exemple.test/x" },
      config({
        fetchImpl: async () => {
          calls += 1;
          return jsonResponse({ error: "trop de requêtes" }, 429);
        },
      }),
      new RateLimiter(null, fakeClock()),
    );
    expect(calls).toBe(3);
    expect(result.errorCode).toBe("RATE_LIMITED");
  });

  it("ne réessaie PAS une autorisation refusée : la redemander ne la rendra pas vraie", async () => {
    let calls = 0;
    const result = await callJson(
      { url: "https://exemple.test/x" },
      config({
        fetchImpl: async () => {
          calls += 1;
          return jsonResponse({ error: "interdit" }, 401);
        },
      }),
      new RateLimiter(null, fakeClock()),
    );
    expect(calls).toBe(1);
    expect(result.errorCode).toBe("UNAUTHORIZED");
  });

  it("ne réessaie PAS un refus de politique de sortie", async () => {
    let calls = 0;
    const result = await callJson(
      { url: "https://exemple.test/x" },
      config({
        fetchImpl: async () => {
          calls += 1;
          throw new Error("gateway answered 403 to CONNECT");
        },
      }),
      new RateLimiter(null, fakeClock()),
    );
    expect(calls).toBe(1);
    expect(result.errorCode).toBe("EGRESS_BLOCKED");
  });

  it("finit par réussir après une panne transitoire", async () => {
    let calls = 0;
    const result = await callJson(
      { url: "https://exemple.test/x" },
      config({
        fetchImpl: async () => {
          calls += 1;
          if (calls < 3) throw new Error("socket hang up");
          return jsonResponse({ ok: true });
        },
      }),
      new RateLimiter(null, fakeClock()),
    );
    expect(calls).toBe(3);
    expect(result.errorCode).toBeNull();
    expect(result.attempts).toBe(3);
  });

  it("traite un 200 non JSON comme un échec de CONTRAT, non retryable", async () => {
    let calls = 0;
    const result = await callJson(
      { url: "https://exemple.test/x" },
      config({
        fetchImpl: async () => {
          calls += 1;
          return new Response("<html>maintenance</html>", { status: 200 });
        },
      }),
      new RateLimiter(null, fakeClock()),
    );
    expect(calls).toBe(1);
    expect(result.errorCode).toBe("INVALID_RESPONSE");
    expect(result.payload).toBeNull();
  });

  it("refuse l'appel plutôt que d'attendre au-delà de l'attente acceptée", async () => {
    const clock = fakeClock(1_000);
    const limiter = new RateLimiter(1, clock);
    limiter.record();
    let calls = 0;
    const result = await callJson(
      { url: "https://exemple.test/x" },
      config({
        clock,
        maxRateLimitWaitMs: 100,
        fetchImpl: async () => {
          calls += 1;
          return jsonResponse({ ok: true });
        },
      }),
      limiter,
    );
    expect(calls).toBe(0);
    expect(result.errorCode).toBe("RATE_LIMITED");
    expect(result.attempts).toBe(0);
  });

  it("lit l'horodatage publié par le fournisseur quand il en fournit un", async () => {
    const result = await callJson(
      { url: "https://exemple.test/x" },
      config({
        fetchImpl: async () =>
          new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: {
              "content-type": "application/json",
              "last-modified": "Sat, 30 Aug 2026 12:00:00 GMT",
            },
          }),
      }),
      new RateLimiter(null, fakeClock()),
    );
    expect(result.providerUpdatedAt).toBe("2026-08-30T12:00:00.000Z");
  });
});

describe("lecture de corps protégée", () => {
  it("CONSERVE le statut rendu par la source quand le corps est illisible", async () => {
    // Sans ce garde, un 503 dont le corps se coupe est classé « erreur réseau », et le
    // diagnostic remonté à l'utilisateur désigne la mauvaise cause.
    const broken = () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.error(new Error("corps interrompu"));
          },
        }),
        { status: 503 },
      );
    const result = await callJson(
      { url: "https://source.test/x" },
      config({ fetchImpl: async () => broken(), maxAttempts: 1 }),
      new RateLimiter(null),
    );
    expect(result.httpStatus).toBe(503);
    expect(result.errorCode).toBe("PROVIDER_ERROR");
    expect(result.errorMessage).toContain("corps illisible");
    expect(result.payloadBytes).toBeNull();
  });

  it("traite un 2xx au corps illisible comme un échec de CONTRAT, jamais comme un vide", async () => {
    const broken = () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.error(new Error("corps interrompu"));
          },
        }),
        { status: 200 },
      );
    const result = await callJson(
      { url: "https://source.test/x" },
      config({ fetchImpl: async () => broken(), maxAttempts: 1 }),
      new RateLimiter(null),
    );
    expect(result.httpStatus).toBe(200);
    expect(result.errorCode).toBe("INVALID_RESPONSE");
    expect(result.payload).toBeNull();
  });

  it("refuse un 200 au corps VIDE plutôt que d'en tirer un `null` silencieux", async () => {
    // Changement de comportement ASSUMÉ à l'intégration : l'un des deux transports rendait
    // `body: null` sur un corps vide, ce qui se lit ensuite comme « la source n'a rien ».
    // Un 200 vide sur une API JSON est un échec de contrat, et le dire évite de compter une
    // absence de réponse comme une absence de donnée.
    const result = await callJson(
      { url: "https://source.test/x" },
      config({
        fetchImpl: async () => new Response("", { status: 200 }),
        maxAttempts: 1,
      }),
      new RateLimiter(null),
    );
    expect(result.errorCode).toBe("INVALID_RESPONSE");
    expect(result.payload).toBeNull();
  });
});

describe("quota local", () => {
  it("dit explicitement que la source n'a RIEN refusé", async () => {
    const clock = fakeClock();
    const limiter = new RateLimiter(1, clock);
    limiter.record();
    const result = await callJson(
      { url: "https://source.test/x" },
      config({
        fetchImpl: async () => {
          throw new Error("la requête n'aurait pas dû partir");
        },
        clock,
        maxRateLimitWaitMs: 10,
        maxAttempts: 1,
      }),
      limiter,
    );
    expect(result.errorCode).toBe("RATE_LIMITED");
    expect(result.errorMessage).toContain("n'a donc rien refusé");
    expect(result.httpStatus).toBeNull();
  });
});

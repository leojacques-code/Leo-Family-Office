import { describe, expect, it } from "vitest";

import {
  callRegistry,
  classifyFetchFailure,
  classifyHttpStatus,
  RegistryRateLimiter,
  type RegistryClock,
  type RegistryTransportConfig,
} from "@/lib/acquisition/registry/transport";

/** Horloge pilotée : une conduite en cas de panne ne se teste pas sur `Date.now()`. */
function fakeClock(start = 0): RegistryClock & { advance: (ms: number) => void } {
  let current = start;
  return {
    now: () => current,
    advance: (ms: number) => {
      current += ms;
    },
  };
}

function config(
  overrides: Partial<RegistryTransportConfig> & Pick<RegistryTransportConfig, "fetchImpl">,
): RegistryTransportConfig {
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
    const limiter = new RegistryRateLimiter(null, fakeClock());
    for (let index = 0; index < 100; index += 1) limiter.record();
    expect(limiter.waitFor()).toBe(0);
  });

  it("impose une attente au-delà du quota, et la libère après la fenêtre", () => {
    const clock = fakeClock(1_000);
    const limiter = new RegistryRateLimiter(2, clock);
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
    const result = await callRegistry(
      { url: "https://exemple.test/x" },
      config({
        fetchImpl: async () => {
          calls += 1;
          return jsonResponse({ ok: true });
        },
      }),
      new RegistryRateLimiter(null, fakeClock()),
    );
    expect(calls).toBe(1);
    expect(result.errorCode).toBeNull();
    expect(result.payload).toEqual({ ok: true });
    expect(result.attempts).toBe(1);
  });

  it("réessaie un 429 jusqu'au plafond, puis rend l'échec", async () => {
    let calls = 0;
    const result = await callRegistry(
      { url: "https://exemple.test/x" },
      config({
        fetchImpl: async () => {
          calls += 1;
          return jsonResponse({ error: "trop de requêtes" }, 429);
        },
      }),
      new RegistryRateLimiter(null, fakeClock()),
    );
    expect(calls).toBe(3);
    expect(result.errorCode).toBe("RATE_LIMITED");
  });

  it("ne réessaie PAS une autorisation refusée : la redemander ne la rendra pas vraie", async () => {
    let calls = 0;
    const result = await callRegistry(
      { url: "https://exemple.test/x" },
      config({
        fetchImpl: async () => {
          calls += 1;
          return jsonResponse({ error: "interdit" }, 401);
        },
      }),
      new RegistryRateLimiter(null, fakeClock()),
    );
    expect(calls).toBe(1);
    expect(result.errorCode).toBe("UNAUTHORIZED");
  });

  it("ne réessaie PAS un refus de politique de sortie", async () => {
    let calls = 0;
    const result = await callRegistry(
      { url: "https://exemple.test/x" },
      config({
        fetchImpl: async () => {
          calls += 1;
          throw new Error("gateway answered 403 to CONNECT");
        },
      }),
      new RegistryRateLimiter(null, fakeClock()),
    );
    expect(calls).toBe(1);
    expect(result.errorCode).toBe("EGRESS_BLOCKED");
  });

  it("finit par réussir après une panne transitoire", async () => {
    let calls = 0;
    const result = await callRegistry(
      { url: "https://exemple.test/x" },
      config({
        fetchImpl: async () => {
          calls += 1;
          if (calls < 3) throw new Error("socket hang up");
          return jsonResponse({ ok: true });
        },
      }),
      new RegistryRateLimiter(null, fakeClock()),
    );
    expect(calls).toBe(3);
    expect(result.errorCode).toBeNull();
    expect(result.attempts).toBe(3);
  });

  it("traite un 200 non JSON comme un échec de CONTRAT, non retryable", async () => {
    let calls = 0;
    const result = await callRegistry(
      { url: "https://exemple.test/x" },
      config({
        fetchImpl: async () => {
          calls += 1;
          return new Response("<html>maintenance</html>", { status: 200 });
        },
      }),
      new RegistryRateLimiter(null, fakeClock()),
    );
    expect(calls).toBe(1);
    expect(result.errorCode).toBe("INVALID_RESPONSE");
    expect(result.payload).toBeNull();
  });

  it("refuse l'appel plutôt que d'attendre au-delà de l'attente acceptée", async () => {
    const clock = fakeClock(1_000);
    const limiter = new RegistryRateLimiter(1, clock);
    limiter.record();
    let calls = 0;
    const result = await callRegistry(
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
    const result = await callRegistry(
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
      new RegistryRateLimiter(null, fakeClock()),
    );
    expect(result.providerUpdatedAt).toBe("2026-08-30T12:00:00.000Z");
  });
});

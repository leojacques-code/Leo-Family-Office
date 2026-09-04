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
    // Plafond VOLONTAIREMENT bas dans les tests : un cas de dépassement ne doit pas exiger
    // de fabriquer 4 Mio de corps.
    maxResponseBytes: 1_024,
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

  it("traite un corps ANNONCÉ JSON mais non analysable comme un échec de CONTRAT, non retryable", async () => {
    let calls = 0;
    const result = await callJson(
      { url: "https://exemple.test/x" },
      config({
        fetchImpl: async () => {
          calls += 1;
          return new Response("{ ceci n'est pas du JSON", {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        },
      }),
      new RateLimiter(null, fakeClock()),
    );
    expect(calls).toBe(1);
    expect(result.errorCode).toBe("INVALID_RESPONSE");
    expect(result.payload).toBeNull();
    // Le corps n'est PAS cité : une page d'erreur ré-affiche couramment la requête reçue.
    expect(result.errorMessage).not.toContain("ceci n'est pas du JSON");
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
        { status: 503, headers: { "content-type": "application/json" } },
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
    // Le type est DÉCLARÉ JSON : sans lui, le contrôle de `Content-Type` trancherait le
    // premier et ce test ne prouverait plus rien sur la lecture elle-même.
    const broken = () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.error(new Error("corps interrompu"));
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
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
        fetchImpl: async () =>
          new Response("", { status: 200, headers: { "content-type": "application/json" } }),
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

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * DURCISSEMENT : PLAFOND DE TAILLE, TYPE DE CONTENU, ANNULATION, FUITES
 * ─────────────────────────────────────────────────────────────────────────────
 * Ces cas viennent d'un finding de revue : le transport lisait le corps sans borne, parsait
 * n'importe quel type, n'acceptait aucun signal d'appelant, et recopiait `error.message`
 * dans un diagnostic PERSISTÉ — alors que `fetch` cite l'URL demandée dans ce message, et
 * que cette URL porte les jetons passés en paramètre.
 */

/** Réponse en FLUX, morceau par morceau : c'est la seule façon de tester une lecture bornée. */
function streamed(
  chunks: readonly string[],
  init: { status?: number; headers?: Record<string, string> } = {},
): { response: () => Response; cancelled: () => boolean; emitted: () => number } {
  let cancelled = false;
  let emitted = 0;
  return {
    cancelled: () => cancelled,
    emitted: () => emitted,
    response: () =>
      new Response(
        new ReadableStream(
          {
            pull(controller) {
              if (emitted >= chunks.length) {
                controller.close();
                return;
              }
              const chunk = chunks[emitted];
              emitted += 1;
              controller.enqueue(new TextEncoder().encode(chunk));
            },
            cancel() {
              cancelled = true;
            },
          },
          // `pull` n'est appelé que sur un `read()` RÉEL. Avec la stratégie de file par
          // défaut (highWaterMark 1), le flux pré-tire un morceau dès sa construction : le
          // double émettrait alors des octets que le transport n'a jamais demandés, et
          // « aucun octet lu » deviendrait intestable.
          { highWaterMark: 0 },
        ),
        {
          status: init.status ?? 200,
          headers: init.headers ?? { "content-type": "application/json" },
        },
      ),
  };
}

describe("plafond de taille de réponse", () => {
  it("REFUSE AVANT LECTURE un Content-Length au-delà du plafond, sans lire un octet", async () => {
    const source = streamed(["{}"], {
      headers: { "content-type": "application/json", "content-length": "5000" },
    });
    const result = await callJson(
      { url: "https://source.test/x" },
      config({ fetchImpl: async () => source.response(), maxResponseBytes: 1_024, maxAttempts: 1 }),
      new RateLimiter(null),
    );
    expect(result.errorCode).toBe("RESPONSE_TOO_LARGE");
    // AUCUN octet lu : c'est tout l'intérêt d'un refus sur l'annonce.
    expect(source.emitted()).toBe(0);
    expect(result.payload).toBeNull();
    expect(result.errorMessage).toContain("5000");
    expect(result.errorMessage).toContain("Aucun octet n'a été lu");
  });

  it("reste protégé quand Content-Length est ABSENT : la lecture est bornée d'elle-même", async () => {
    // Aucune annonce, et un corps de 2 000 octets pour un plafond de 1 024.
    const source = streamed(["x".repeat(500), "x".repeat(500), "x".repeat(500), "x".repeat(500)]);
    const result = await callJson(
      { url: "https://source.test/x" },
      config({ fetchImpl: async () => source.response(), maxResponseBytes: 1_024, maxAttempts: 1 }),
      new RateLimiter(null),
    );
    expect(result.errorCode).toBe("RESPONSE_TOO_LARGE");
    expect(result.payload).toBeNull();
    // Le flux est INTERROMPU, pas drainé : le reader est annulé dès le dépassement.
    expect(source.cancelled()).toBe(true);
    expect(source.emitted()).toBeLessThan(4);
  });

  it("reste protégé quand Content-Length MENT en annonçant petit : la lecture tranche", async () => {
    // Le fournisseur annonce 10 octets et en émet 2 000. Un transport qui croirait l'annonce
    // n'aurait aucune borne réelle.
    const source = streamed(["y".repeat(1_000), "y".repeat(1_000)], {
      headers: { "content-type": "application/json", "content-length": "10" },
    });
    const result = await callJson(
      { url: "https://source.test/x" },
      config({ fetchImpl: async () => source.response(), maxResponseBytes: 1_024, maxAttempts: 1 }),
      new RateLimiter(null),
    );
    expect(result.errorCode).toBe("RESPONSE_TOO_LARGE");
    expect(source.cancelled()).toBe(true);
    expect(result.errorMessage).toContain("interrompu");
  });

  it("ACCEPTE un JSON exactement à la limite : le plafond est inclusif", async () => {
    // Un plafond exclusif refuserait la réponse d'un fournisseur parfaitement conforme, et
    // la frontière est justement l'endroit où une erreur d'un octet ne se voit pas.
    const filler = "a".repeat(1_024 - '{"v":""}'.length);
    const body = JSON.stringify({ v: filler });
    expect(Buffer.byteLength(body, "utf8")).toBe(1_024);
    const result = await callJson(
      { url: "https://source.test/x" },
      config({
        fetchImpl: async () =>
          new Response(body, { status: 200, headers: { "content-type": "application/json" } }),
        maxResponseBytes: 1_024,
        maxAttempts: 1,
      }),
      new RateLimiter(null),
    );
    expect(result.errorCode).toBeNull();
    expect(result.payloadBytes).toBe(1_024);
    expect(result.payload).toEqual({ v: filler });
  });

  it("refuse un seul octet AU-DELÀ de la limite", async () => {
    const body = "b".repeat(1_025);
    const result = await callJson(
      { url: "https://source.test/x" },
      config({
        fetchImpl: async () =>
          new Response(body, { status: 200, headers: { "content-type": "application/json" } }),
        maxResponseBytes: 1_024,
        maxAttempts: 1,
      }),
      new RateLimiter(null),
    );
    expect(result.errorCode).toBe("RESPONSE_TOO_LARGE");
  });

  it("NE RÉESSAIE PAS un dépassement : il sera identique au deuxième appel", async () => {
    let calls = 0;
    const result = await callJson(
      { url: "https://source.test/x" },
      config({
        fetchImpl: async () => {
          calls += 1;
          return new Response("c".repeat(2_000), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        },
        maxResponseBytes: 1_024,
      }),
      new RateLimiter(null),
    );
    expect(calls).toBe(1);
    expect(result.errorCode).toBe("RESPONSE_TOO_LARGE");
  });

  it("se configure PLUS RESTRICTIVEMENT par fournisseur", async () => {
    // Le même corps passe sous un plafond large et est refusé sous un plafond serré : c'est
    // ce qui permet à une connexion bavarde et à une connexion frugale de partager UN
    // transport, sans en écrire un second.
    const body = JSON.stringify({ v: "d".repeat(400) });
    const call = (maxResponseBytes: number) =>
      callJson(
        { url: "https://source.test/x" },
        config({
          fetchImpl: async () =>
            new Response(body, { status: 200, headers: { "content-type": "application/json" } }),
          maxResponseBytes,
          maxAttempts: 1,
        }),
        new RateLimiter(null),
      );
    expect((await call(4_096)).errorCode).toBeNull();
    expect((await call(64)).errorCode).toBe("RESPONSE_TOO_LARGE");
  });

  it("un statut d'ERREUR dont le corps déborde reste classé par son STATUT", async () => {
    // Requalifier un 503 en « réponse trop grosse » ferait chercher un problème de volume
    // là où la source est en panne.
    const result = await callJson(
      { url: "https://source.test/x" },
      config({
        fetchImpl: async () =>
          new Response("e".repeat(5_000), {
            status: 503,
            headers: { "content-type": "text/html" },
          }),
        maxResponseBytes: 1_024,
        maxAttempts: 1,
      }),
      new RateLimiter(null),
    );
    expect(result.httpStatus).toBe(503);
    expect(result.errorCode).toBe("PROVIDER_ERROR");
  });
});

describe("type de contenu accepté", () => {
  it("accepte application/json; charset=utf-8 : un paramètre n'est pas un autre type", async () => {
    const result = await callJson(
      { url: "https://source.test/x" },
      config({
        fetchImpl: async () =>
          new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { "content-type": "application/json; charset=utf-8" },
          }),
        maxAttempts: 1,
      }),
      new RateLimiter(null),
    );
    expect(result.errorCode).toBeNull();
    expect(result.payload).toEqual({ ok: true });
  });

  it("accepte application/problem+json : c'est la forme RFC 9457 d'une erreur décrite", async () => {
    const result = await callJson(
      { url: "https://source.test/x" },
      config({
        fetchImpl: async () =>
          new Response(JSON.stringify({ title: "Paramètre invalide", status: 200 }), {
            status: 200,
            headers: { "content-type": "application/problem+json" },
          }),
        maxAttempts: 1,
      }),
      new RateLimiter(null),
    );
    expect(result.errorCode).toBeNull();
    expect(result.payload).toEqual({ title: "Paramètre invalide", status: 200 });
  });

  it("accepte un +json avec paramètre, et se moque de la CASSE de l'en-tête", async () => {
    const result = await callJson(
      { url: "https://source.test/x" },
      config({
        fetchImpl: async () =>
          new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { "content-type": "Application/GeoJSON+JSON ; charset=UTF-8" },
          }),
        maxAttempts: 1,
      }),
      new RateLimiter(null),
    );
    expect(result.errorCode).toBeNull();
  });

  it("REFUSE text/html en HTTP 200 : un portail captif n'est pas une donnée", async () => {
    const result = await callJson(
      { url: "https://source.test/x" },
      config({
        fetchImpl: async () =>
          new Response("<html>maintenance</html>", {
            status: 200,
            headers: { "content-type": "text/html; charset=utf-8" },
          }),
        maxAttempts: 1,
      }),
      new RateLimiter(null),
    );
    expect(result.httpStatus).toBe(200);
    expect(result.errorCode).toBe("INVALID_RESPONSE");
    expect(result.payload).toBeNull();
    // Le TYPE annoncé est nommé — il aide à diagnostiquer — mais pas le corps.
    expect(result.errorMessage).toContain("text/html");
    expect(result.errorMessage).not.toContain("maintenance");
  });

  it("REFUSE un 200 sans type déclaré plutôt que de parser au cas où", async () => {
    const result = await callJson(
      { url: "https://source.test/x" },
      config({
        fetchImpl: async () =>
          new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { "content-length": "11" },
          }),
        maxAttempts: 1,
      }),
      new RateLimiter(null),
    );
    expect(result.errorCode).toBe("INVALID_RESPONSE");
    expect(result.errorMessage).toContain("aucun");
  });

  it("N'EXIGE PAS de type JSON sur un statut d'ERREUR : un corps HTML y sert le diagnostic", async () => {
    const result = await callJson(
      { url: "https://source.test/x" },
      config({
        fetchImpl: async () =>
          new Response("<html>indisponible</html>", {
            status: 502,
            headers: { "content-type": "text/html" },
          }),
        maxAttempts: 1,
      }),
      new RateLimiter(null),
    );
    expect(result.httpStatus).toBe(502);
    expect(result.errorCode).toBe("PROVIDER_ERROR");
  });
});

describe("annulation", () => {
  it("rend CANNCELLED sur un signal DÉJÀ abandonné, sans émettre le moindre appel", async () => {
    const controller = new AbortController();
    controller.abort();
    let calls = 0;
    const result = await callJson(
      { url: "https://source.test/x", signal: controller.signal },
      config({
        fetchImpl: async () => {
          calls += 1;
          return jsonResponse({ ok: true });
        },
      }),
      new RateLimiter(null),
    );
    expect(calls).toBe(0);
    expect(result.errorCode).toBe("CANCELLED");
    expect(result.attempts).toBe(0);
  });

  it("distingue une annulation EXTERNE d'un dépassement de délai, et ne la réessaie pas", async () => {
    const controller = new AbortController();
    let calls = 0;
    const result = await callJson(
      { url: "https://source.test/x", signal: controller.signal },
      config({
        // Délai interne largement supérieur : si le résultat était TIMEOUT, c'est que la
        // cause réelle n'est pas lue.
        timeoutMs: 10_000,
        fetchImpl: (_url, init) =>
          new Promise((_resolve, reject) => {
            calls += 1;
            const signal = init?.signal as AbortSignal | undefined;
            controller.abort();
            const error = new Error("The operation was aborted");
            error.name = "AbortError";
            if (signal?.aborted) reject(error);
            else signal?.addEventListener("abort", () => reject(error), { once: true });
          }),
      }),
      new RateLimiter(null),
    );
    expect(calls).toBe(1);
    expect(result.errorCode).toBe("CANCELLED");
    expect(result.errorMessage).toContain("abandonné par le demandeur");
  });

  it("rend TIMEOUT quand c'est le délai INTERNE qui tranche, signal externe présent mais intact", async () => {
    const controller = new AbortController();
    const result = await callJson(
      { url: "https://source.test/x", signal: controller.signal },
      config({
        timeoutMs: 5,
        maxAttempts: 1,
        // Ne se résout jamais de lui-même : seul le délai interne peut clore.
        fetchImpl: (_url, init) =>
          new Promise((_resolve, reject) => {
            const signal = init?.signal as AbortSignal | undefined;
            const error = new Error("The operation was aborted");
            error.name = "AbortError";
            signal?.addEventListener("abort", () => reject(error), { once: true });
          }),
      }),
      new RateLimiter(null),
    );
    expect(result.errorCode).toBe("TIMEOUT");
    expect(controller.signal.aborted).toBe(false);
  });

  it("COMPOSE le signal : celui reçu par fetch s'abandonne quand l'externe s'abandonne", async () => {
    // La composition se vérifie PENDANT l'appel, et pas après : l'écouteur est retiré à la
    // fin de la tentative (cf. le test suivant), donc un abandon postérieur ne doit
    // justement plus rien propager. Vérifier après l'appel testerait la fuite, pas le
    // contrat.
    const controller = new AbortController();
    let sameObject: boolean | null = null;
    let abortedBefore: boolean | null = null;
    let abortedAfter: boolean | null = null;

    const result = await callJson(
      { url: "https://source.test/x", signal: controller.signal },
      config({
        maxAttempts: 1,
        fetchImpl: async (_url, init) => {
          const inner = init?.signal as AbortSignal | undefined;
          sameObject = inner === controller.signal;
          abortedBefore = inner?.aborted ?? null;
          controller.abort();
          abortedAfter = inner?.aborted ?? null;
          return jsonResponse({ ok: true });
        },
      }),
      new RateLimiter(null),
    );

    // Le signal transmis à `fetch` n'est PAS celui de l'appelant : c'est le composé, qui
    // porte AUSSI le délai interne.
    expect(sameObject).toBe(false);
    expect(abortedBefore).toBe(false);
    // Abandonner l'appelant abandonne le composé : c'est cela, composer.
    expect(abortedAfter).toBe(true);
    expect(result.attempts).toBe(1);
  });

  it("RETIRE son écouteur du signal de l'appelant après chaque tentative", async () => {
    // Sans retrait, trois tentatives laisseraient trois écouteurs accrochés à un signal qui
    // vit plus longtemps qu'elles — une fuite invisible sur une requête entrante longue.
    const controller = new AbortController();
    const added: string[] = [];
    const removed: string[] = [];
    const realAdd = controller.signal.addEventListener.bind(controller.signal);
    const realRemove = controller.signal.removeEventListener.bind(controller.signal);
    controller.signal.addEventListener = ((type: string, ...rest: unknown[]) => {
      added.push(type);
      return (realAdd as (t: string, ...r: unknown[]) => void)(type, ...rest);
    }) as typeof controller.signal.addEventListener;
    controller.signal.removeEventListener = ((type: string, ...rest: unknown[]) => {
      removed.push(type);
      return (realRemove as (t: string, ...r: unknown[]) => void)(type, ...rest);
    }) as typeof controller.signal.removeEventListener;

    await callJson(
      { url: "https://source.test/x", signal: controller.signal },
      config({
        fetchImpl: async () => {
          throw new Error("socket hang up");
        },
      }),
      new RateLimiter(null),
    );
    expect(added.filter((type) => type === "abort")).toHaveLength(3);
    expect(removed.filter((type) => type === "abort")).toHaveLength(3);
  });
});

describe("fournisseur non coopératif", () => {
  it("borne un flux SANS FIN au lieu de consommer la mémoire du processus", async () => {
    // Un flux qui n'annonce rien et n'a pas de fin : `response.text()` ne rendrait jamais la
    // main, et le processus mourrait avant qu'un instantané d'échec soit persisté.
    let cancelled = false;
    let emitted = 0;
    const endless = () =>
      new Response(
        new ReadableStream(
          {
            pull(controller) {
              emitted += 1;
              controller.enqueue(new TextEncoder().encode("z".repeat(256)));
            },
            cancel() {
              cancelled = true;
            },
          },
          // Aucun pré-tirage : le compte de morceaux doit refléter ce que le transport a
          // RÉELLEMENT demandé, pas ce que la stratégie de file a anticipé.
          { highWaterMark: 0 },
        ),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    const result = await callJson(
      { url: "https://source.test/x" },
      config({ fetchImpl: async () => endless(), maxResponseBytes: 1_024, maxAttempts: 1 }),
      new RateLimiter(null),
    );
    expect(result.errorCode).toBe("RESPONSE_TOO_LARGE");
    expect(cancelled).toBe(true);
    // 1 024 / 256 = 4 morceaux sous le plafond, le 5e le franchit. Le flux s'arrête là.
    expect(emitted).toBe(5);
  });

  it("ne prend pas au sérieux un Content-Length non numérique ou négatif", async () => {
    for (const announced of ["beaucoup", "-1", "1e9", ""]) {
      const result = await callJson(
        { url: "https://source.test/x" },
        config({
          fetchImpl: async () =>
            new Response(JSON.stringify({ ok: true }), {
              status: 200,
              headers: { "content-type": "application/json", "content-length": announced },
            }),
          maxResponseBytes: 1_024,
          maxAttempts: 1,
        }),
        new RateLimiter(null),
      );
      // L'annonce est écartée, la lecture bornée tranche : le corps est petit, donc succès.
      expect(result.errorCode).toBeNull();
    }
  });

  it("BORNE un en-tête de type abusivement long avant de le citer", async () => {
    const result = await callJson(
      { url: "https://source.test/x" },
      config({
        fetchImpl: async () =>
          new Response("nope", {
            status: 200,
            headers: { "content-type": `text/${"a".repeat(500)}` },
          }),
        maxAttempts: 1,
      }),
      new RateLimiter(null),
    );
    expect(result.errorCode).toBe("INVALID_RESPONSE");
    expect(result.errorMessage!.length).toBeLessThan(400);
  });
});

describe("aucun secret dans un diagnostic", () => {
  const SECRET_URL = "https://registre.test/api/companies?token=secret-tres-confidentiel";

  /** Ce qui ne doit JAMAIS apparaître dans un résultat, quel que soit le chemin d'échec. */
  function assertNoLeak(result: { errorMessage: string | null; rawText: string }): void {
    const surface = `${result.errorMessage ?? ""}|${result.rawText}`;
    expect(surface).not.toContain("secret-tres-confidentiel");
    expect(surface).not.toContain("token=");
    expect(surface).not.toContain("registre.test");
    expect(surface).not.toContain("https://");
    expect(surface).not.toContain("Bearer");
  }

  it("ne restitue NI l'URL NI le jeton portés par le message d'exception de fetch", async () => {
    // C'est exactement ce que fait `fetch` de Node : il cite l'URL demandée dans son
    // message, et ce message était recopié tel quel dans un diagnostic PERSISTÉ.
    const result = await callJson(
      { url: SECRET_URL, headers: { authorization: "Bearer secret-tres-confidentiel" } },
      config({
        fetchImpl: async () => {
          throw new Error(`request to ${SECRET_URL} failed, reason: socket hang up`);
        },
        maxAttempts: 1,
      }),
      new RateLimiter(null),
    );
    expect(result.errorCode).toBe("NETWORK");
    assertNoLeak(result);
  });

  it("neutralise aussi un refus de sortie réseau citant l'URL", async () => {
    const result = await callJson(
      { url: SECRET_URL },
      config({
        fetchImpl: async () => {
          throw new Error(`tunneling socket could not be established to ${SECRET_URL}`);
        },
      }),
      new RateLimiter(null),
    );
    expect(result.errorCode).toBe("EGRESS_BLOCKED");
    assertNoLeak(result);
  });

  it("classifyFetchFailure elle-même ne rend jamais le message reçu", async () => {
    const classified = classifyFetchFailure(new Error(`request to ${SECRET_URL} failed`));
    expect(classified.code).toBe("NETWORK");
    expect(classified.message).not.toContain(SECRET_URL);
    expect(classified.message).not.toContain("secret-tres-confidentiel");
  });

  it("ne restitue PAS un corps d'erreur du fournisseur ré-affichant la requête reçue", async () => {
    // Une page d'erreur qui recopie la requête est la norme, pas l'exception : c'est le
    // second chemin par lequel un jeton arrivait dans un diagnostic persisté.
    const result = await callJson(
      { url: SECRET_URL },
      config({
        fetchImpl: async () =>
          new Response(`Requête refusée : GET ${SECRET_URL}`, {
            status: 401,
            headers: { "content-type": "text/plain" },
          }),
        maxAttempts: 1,
      }),
      new RateLimiter(null),
    );
    expect(result.errorCode).toBe("UNAUTHORIZED");
    expect(result.httpStatus).toBe(401);
    assertNoLeak(result);
    // Le corps est MESURÉ, pas cité : la taille aide au diagnostic sans rien divulguer.
    expect(result.payloadBytes).toBeGreaterThan(0);
  });

  it("n'expose rien non plus par rawText sur un dépassement de plafond", async () => {
    const result = await callJson(
      { url: SECRET_URL },
      config({
        fetchImpl: async () =>
          new Response(`${SECRET_URL} `.repeat(200), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        maxResponseBytes: 1_024,
        maxAttempts: 1,
      }),
      new RateLimiter(null),
    );
    expect(result.errorCode).toBe("RESPONSE_TOO_LARGE");
    assertNoLeak(result);
  });
});

describe("statut HTTP préservé", () => {
  it("CONSERVE le statut quand la lecture est interrompue par le plafond", async () => {
    const result = await callJson(
      { url: "https://source.test/x" },
      config({
        fetchImpl: async () =>
          new Response("f".repeat(4_000), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        maxResponseBytes: 1_024,
        maxAttempts: 1,
      }),
      new RateLimiter(null),
    );
    expect(result.httpStatus).toBe(200);
    expect(result.errorCode).toBe("RESPONSE_TOO_LARGE");
  });

  it("CONSERVE le statut quand le refus tient à la longueur ANNONCÉE", async () => {
    const result = await callJson(
      { url: "https://source.test/x" },
      config({
        fetchImpl: async () =>
          new Response("{}", {
            status: 206,
            headers: { "content-type": "application/json", "content-length": "99999" },
          }),
        maxResponseBytes: 1_024,
        maxAttempts: 1,
      }),
      new RateLimiter(null),
    );
    expect(result.httpStatus).toBe(206);
    expect(result.errorCode).toBe("RESPONSE_TOO_LARGE");
  });

  it("CONSERVE le statut d'erreur ET l'horodatage du fournisseur malgré un corps débordant", async () => {
    const result = await callJson(
      { url: "https://source.test/x" },
      config({
        fetchImpl: async () =>
          new Response("g".repeat(4_000), {
            status: 429,
            headers: {
              "content-type": "application/json",
              "last-modified": "Sat, 30 Aug 2026 12:00:00 GMT",
            },
          }),
        maxResponseBytes: 1_024,
        maxAttempts: 1,
      }),
      new RateLimiter(null),
    );
    expect(result.httpStatus).toBe(429);
    expect(result.errorCode).toBe("RATE_LIMITED");
    expect(result.providerUpdatedAt).toBe("2026-08-30T12:00:00.000Z");
  });
});

import { describe, expect, it, vi } from "vitest";

import { fetchJson, TokenBucket } from "@/lib/acquisition/transport";

const noSleep = () => Promise.resolve();

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe("anneau de jetons", () => {
  it("refuse d'émettre au-delà de la capacité", () => {
    const bucket = new TokenBucket(2, () => 0);
    expect(bucket.take()).toBe(true);
    expect(bucket.take()).toBe(true);
    expect(bucket.take()).toBe(false);
  });

  it("se recharge avec le temps", () => {
    let now = 0;
    const bucket = new TokenBucket(2, () => now);
    bucket.take();
    bucket.take();
    expect(bucket.take()).toBe(false);
    now = 60_000;
    expect(bucket.take()).toBe(true);
  });
});

describe("lecture JSON bornée", () => {
  it("rend le corps et le texte brut sur succès", async () => {
    const result = await fetchJson("https://example.invalid/x", {
      fetchImpl: vi.fn().mockResolvedValue(jsonResponse({ results: [1] })),
      sleepImpl: noSleep,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.body).toEqual({ results: [1] });
      expect(result.rawText).toBe('{"results":[1]}');
      expect(result.attempts).toBe(1);
    }
  });

  it("classe un 429 en RATE_LIMITED et retente", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({}, 429))
      .mockResolvedValueOnce(jsonResponse({ results: [] }));
    const result = await fetchJson("https://example.invalid/x", { fetchImpl, sleepImpl: noSleep });
    expect(result.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("ne retente PAS un 404 : le rejouer donne le même refus", async () => {
    const fetchImpl = vi.fn().mockImplementation(() => Promise.resolve(jsonResponse({}, 404)));
    const result = await fetchJson("https://example.invalid/x", { fetchImpl, sleepImpl: noSleep });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("CLIENT_ERROR");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("classe un refus de sortie réseau en EGRESS_BLOCKED, sans le retenter", async () => {
    // Le proxy répond 403 au CONNECT : la politique ne changera pas entre deux tentatives,
    // et insister masquerait la vraie cause derrière un timeout.
    const fetchImpl = vi
      .fn()
      .mockRejectedValue(new Error("tunneling socket could not be established"));
    const result = await fetchJson("https://example.invalid/x", { fetchImpl, sleepImpl: noSleep });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("EGRESS_BLOCKED");
      expect(result.message).toContain("pas une absence de donnée");
    }
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("retente un 500 puis abandonne en nommant l'échec", async () => {
    const fetchImpl = vi.fn().mockImplementation(() => Promise.resolve(jsonResponse({}, 503)));
    const result = await fetchJson("https://example.invalid/x", {
      fetchImpl,
      sleepImpl: noSleep,
      maxAttempts: 3,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("SERVER_ERROR");
      expect(result.attempts).toBe(3);
    }
  });

  it("rend MALFORMED_RESPONSE sur un corps illisible, jamais un tableau vide", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("<html>oops</html>", { status: 200 }));
    const result = await fetchJson("https://example.invalid/x", { fetchImpl, sleepImpl: noSleep });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("MALFORMED_RESPONSE");
  });

  it("distingue une limite LOCALE d'un refus de la source", async () => {
    const fetchImpl = vi.fn();
    const limiter = new TokenBucket(0, () => 0);
    const result = await fetchJson("https://example.invalid/x", {
      fetchImpl,
      sleepImpl: noSleep,
      limiter,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("RATE_LIMITED");
      expect(result.message).toContain("la source n'a donc rien refusé");
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rend un corps null sur une réponse vide, sans lever", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("", { status: 200 }));
    const result = await fetchJson("https://example.invalid/x", { fetchImpl, sleepImpl: noSleep });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.body).toBeNull();
  });
});

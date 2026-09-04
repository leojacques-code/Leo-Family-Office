import { describe, expect, it } from "vitest";

import {
  createSandboxProvider,
  MAX_ATTEMPTS_PER_PAGE,
  MAX_PAGES_PER_SYNC,
  readAllTransactionPages,
  SANDBOX_PROVIDER_ID,
} from "..";
import type { BankSyncContext, ProviderTransaction, SandboxScenario } from "..";
import { ACCOUNT, transaction } from "./fixtures/sandbox";

const CONTEXT: BankSyncContext = {
  consentReference: "consent-1",
  secret: { vault: "ENV", key: "SANDBOX_TOKEN_REF" },
  now: new Date("2026-08-21T10:00:00Z"),
};

function scenario(overrides: Partial<SandboxScenario> = {}): SandboxScenario {
  return {
    accounts: [ACCOUNT],
    balances: [],
    transactionPages: [
      [transaction({ providerTransactionId: "tx-1" })],
      [transaction({ providerTransactionId: "tx-2" })],
      [transaction({ providerTransactionId: "tx-3" })],
    ],
    ...overrides,
  };
}

async function paginate(
  input: SandboxScenario,
  options: { startCursor?: string | null; known?: Set<string>; lastPage?: number } = {},
) {
  const provider = createSandboxProvider(input);
  return readAllTransactionPages<ProviderTransaction>({
    context: CONTEXT,
    startCursor: options.startCursor ?? null,
    knownPayloadHashes: options.known ?? new Set<string>(),
    lastPageNumber: options.lastPage ?? 0,
    fetchPage: (cursor) => provider.listTransactions(CONTEXT, ACCOUNT.providerAccountId, cursor),
  });
}

function codes(issues: readonly { code: string }[]): string[] {
  return issues.map((issue) => issue.code);
}

describe("pagination", () => {
  it("lit toutes les pages jusqu'à la fin DÉCLARÉE par le fournisseur", async () => {
    const outcome = await paginate(scenario());
    expect(outcome.pages.map((page) => page.pageNumber)).toEqual([1, 2, 3]);
    expect(outcome.complete).toBe(true);
    expect(outcome.resumeCursor).toBeNull();
    expect(outcome.failure).toBeNull();
  });

  it("ne s'arrête PAS sur une page vide au milieu de la pagination", async () => {
    // PAGE VIDE ≠ FIN : s'arrêter là perdrait la troisième page.
    const outcome = await paginate(
      scenario({
        transactionPages: [
          [transaction({ providerTransactionId: "tx-1" })],
          [],
          [transaction({ providerTransactionId: "tx-3" })],
        ],
      }),
    );
    expect(outcome.pages).toHaveLength(3);
    expect(outcome.complete).toBe(true);
    expect(outcome.pages[2].items).toHaveLength(1);
  });

  it("REPREND au curseur persisté sans relire les pages écrites", async () => {
    const outcome = await paginate(scenario(), { startCursor: "page-1", lastPage: 1 });
    expect(outcome.pages.map((page) => page.requestCursor)).toEqual(["page-1", "page-2"]);
    // La numérotation reste CONTINUE : une reprise ne recommence pas à 1.
    expect(outcome.pages.map((page) => page.pageNumber)).toEqual([2, 3]);
    expect(codes(outcome.issues)).toContain("BANK_SYNC_RESUMED");
  });

  it("SIGNALE une page rejouée et ne la présente pas comme nouvelle", async () => {
    const first = await paginate(scenario());
    const known = new Set(first.pages.map((page) => page.payloadHash));
    const replay = await paginate(scenario(), { known });
    expect(replay.pages.every((page) => page.replayed)).toBe(true);
    expect(codes(replay.issues)).toContain("BANK_PAGE_REPLAYED");
  });

  it("interrompt une BOUCLE de curseur au lieu de tourner indéfiniment", async () => {
    const outcome = await paginate(scenario({ stuckCursorAtPage: 1 }));
    expect(codes(outcome.issues)).toContain("BANK_CURSOR_NOT_ADVANCING");
    expect(outcome.complete).toBe(false);
    expect(outcome.resumeCursor).toBe("page-1");
    expect(outcome.pages.length).toBeLessThan(MAX_PAGES_PER_SYNC);
  });

  it("REFUSE au lieu de tronquer quand le plafond de pages est atteint", async () => {
    const pages: ProviderTransaction[][] = Array.from(
      { length: MAX_PAGES_PER_SYNC + 5 },
      (_unused, index) => [transaction({ providerTransactionId: `tx-${index}` })],
    );
    const outcome = await paginate(scenario({ transactionPages: pages }));
    expect(outcome.pages).toHaveLength(MAX_PAGES_PER_SYNC);
    expect(outcome.complete).toBe(false);
    expect(outcome.resumeCursor).not.toBeNull();
    expect(codes(outcome.issues)).toContain("BANK_PAGE_LIMIT_REACHED");
  });
});

describe("échecs fournisseur", () => {
  it("réessaie un 429 puis aboutit", async () => {
    const outcome = await paginate(
      scenario({ failures: [{ onPage: 1, code: "RATE_LIMITED", attempts: 1 }] }),
    );
    expect(outcome.complete).toBe(true);
    expect(outcome.pages).toHaveLength(3);
  });

  it("abandonne après le nombre maximal de tentatives sur un 5xx persistant", async () => {
    const outcome = await paginate(
      scenario({
        failures: [{ onPage: 1, code: "SERVER_ERROR", attempts: MAX_ATTEMPTS_PER_PAGE + 1 }],
      }),
    );
    expect(outcome.failure?.code).toBe("SERVER_ERROR");
    // Le curseur de la page échouée est CONSERVÉ : la reprise ne relit pas la page 1.
    expect(outcome.resumeCursor).toBe("page-1");
    expect(outcome.pages).toHaveLength(1);
    expect(codes(outcome.issues)).toContain("BANK_PROVIDER_SERVER_ERROR");
  });

  it("NE réessaie PAS un consentement révoqué", async () => {
    const outcome = await paginate(
      scenario({ failures: [{ onPage: 0, code: "CONSENT_REVOKED", attempts: 99 }] }),
    );
    expect(outcome.failure?.code).toBe("CONSENT_REVOKED");
    expect(outcome.pages).toHaveLength(0);
    expect(codes(outcome.issues)).toContain("BANK_CONSENT_REVOKED");
  });

  it("NE réessaie PAS un consentement expiré", async () => {
    const outcome = await paginate(
      scenario({ failures: [{ onPage: 0, code: "CONSENT_EXPIRED", attempts: 99 }] }),
    );
    expect(outcome.failure?.code).toBe("CONSENT_EXPIRED");
    expect(codes(outcome.issues)).toContain("BANK_CONSENT_EXPIRED");
  });

  it("nomme un 401, un 403, un timeout et une réponse illisible", async () => {
    for (const [code, expected] of [
      ["UNAUTHORIZED", "BANK_PROVIDER_UNAUTHORIZED"],
      ["FORBIDDEN", "BANK_PROVIDER_FORBIDDEN"],
      ["TIMEOUT", "BANK_PROVIDER_TIMEOUT"],
      ["MALFORMED_RESPONSE", "BANK_PROVIDER_MALFORMED_RESPONSE"],
    ] as const) {
      const outcome = await paginate(scenario({ failures: [{ onPage: 0, code, attempts: 99 }] }));
      expect(outcome.failure?.code).toBe(code);
      expect(codes(outcome.issues)).toContain(expected);
    }
  });
});

describe("contrat de l'adaptateur sandbox", () => {
  it("refuse un appel sans référence de secret", async () => {
    const provider = createSandboxProvider(scenario());
    const result = await provider.listAccounts({
      ...CONTEXT,
      secret: { vault: "", key: "" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.code).toBe("UNAUTHORIZED");
  });

  it("n'expose AUCUNE primitive d'initiation de paiement", () => {
    const provider = createSandboxProvider(scenario());
    // Le contrat est en LECTURE SEULE, et c'est structurel : rien à désactiver.
    expect(Object.keys(provider).sort()).toEqual([
      "capabilities",
      "id",
      "listAccounts",
      "listBalances",
      "listTransactions",
      "version",
    ]);
    expect(provider.id).toBe(SANDBOX_PROVIDER_ID);
  });

  it("refuse un compte inconnu du fournisseur", async () => {
    const provider = createSandboxProvider(scenario());
    const result = await provider.listTransactions(CONTEXT, "inconnu", null);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.code).toBe("ACCOUNT_UNKNOWN");
  });

  it("ne rend que les opérations du compte demandé", async () => {
    const provider = createSandboxProvider(
      scenario({
        accounts: [ACCOUNT],
        transactionPages: [
          [
            transaction({ providerTransactionId: "tx-1" }),
            transaction({ providerTransactionId: "tx-autre", providerAccountId: "pa-2" }),
          ],
        ],
      }),
    );
    const result = await provider.listTransactions(CONTEXT, ACCOUNT.providerAccountId, null);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.items).toHaveLength(1);
  });
});

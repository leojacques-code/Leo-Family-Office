import { beforeEach, describe, expect, it, vi } from "vitest";

const OWNER = "11111111-1111-4111-8111-111111111111";
const ACCOUNT = "22222222-2222-4222-8222-222222222222";
const FOREIGN_ACCOUNT = "33333333-3333-4333-8333-333333333333";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  storageFrom: vi.fn(),
}));

vi.mock("@/lib/data/supabase-client", () => ({
  DOCUMENTS_BUCKET: "family-office-documents",
  ownerId: () => OWNER,
  supabaseAdmin: () => ({
    rpc: mocks.rpc,
    from: mocks.from,
    storage: { from: mocks.storageFrom },
  }),
}));

import { createImportRepository } from "@/lib/data/import-repository";
import { FR_SIGNED, utf8 } from "@/lib/acquisition/__tests__/fixtures/bank-csv";

type Result = { data: unknown; error: { message: string } | null };

/** Builder PostgREST factice : toute méthode de filtre se chaîne, l'attente résout. */
function builder(result: Result) {
  const calls: Array<[string, unknown[]]> = [];
  const self: Record<string, unknown> = {
    calls,
    then: (resolve: (value: Result) => unknown) => Promise.resolve(result).then(resolve),
  };
  for (const method of [
    "select",
    "eq",
    "gte",
    "lte",
    "not",
    "order",
    "range",
    "limit",
    "insert",
    "update",
  ]) {
    self[method] = (...args: unknown[]) => {
      calls.push([method, args]);
      return self;
    };
  }
  return self;
}

/** Réponses par table, plus la trace des filtres réellement appliqués. */
function withTables(tables: Record<string, Result>) {
  const builders = new Map<string, ReturnType<typeof builder>>();
  mocks.from.mockImplementation((table: string) => {
    const existing = builders.get(table);
    if (existing) return existing;
    const created = builder(tables[table] ?? { data: [], error: null });
    builders.set(table, created);
    return created;
  });
  return builders;
}

const activeAccount = {
  data: [{ id: ACCOUNT, name: "Compte courant", currency: "EUR", status: "ACTIVE" }],
  error: null,
};

const analyzeRequest = {
  accountId: ACCOUNT,
  declaredCurrency: "EUR",
  declaredPeriodStart: null,
  declaredPeriodEnd: null,
  mapping: null,
  stableTransactionIdDeclared: false,
  rememberMapping: false,
  retainFile: false,
};

const file = {
  name: "releve.csv",
  contentType: "text/csv",
  size: FR_SIGNED.length,
  bytes: utf8(FR_SIGNED),
};

function analysisPayload(): Record<string, unknown> {
  const call = mocks.rpc.mock.calls.find(([name]) => name === "lfo_analyze_import_session");
  if (!call) throw new Error("La RPC d'analyse n'a pas été appelée");
  return (call[1] as { p_payload: Record<string, unknown> }).p_payload;
}

describe("acquisition — cloisonnement du compte cible", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("refuse un compte qui n'appartient pas au propriétaire, sans tenter d'écrire", async () => {
    // La lecture est filtrée par user_id : le compte d'un autre propriétaire revient vide,
    // même en connaissant son UUID.
    withTables({ financial_accounts: { data: [], error: null } });
    const repository = createImportRepository();
    await expect(
      repository.analyze({ ...analyzeRequest, accountId: FOREIGN_ACCOUNT }, file),
    ).rejects.toThrow(/Compte cible introuvable/);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("refuse un compte inactif", async () => {
    withTables({
      financial_accounts: {
        data: [{ id: ACCOUNT, name: "Clôturé", currency: "EUR", status: "CLOSED" }],
        error: null,
      },
    });
    const repository = createImportRepository();
    await expect(repository.analyze(analyzeRequest, file)).rejects.toThrow(/inactif/);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("filtre la lecture du compte par propriétaire ET par identifiant", async () => {
    const builders = withTables({ financial_accounts: { data: [], error: null } });
    const repository = createImportRepository();
    await repository.analyze(analyzeRequest, file).catch(() => undefined);
    const calls = (builders.get("financial_accounts")!.calls as Array<[string, unknown[]]>).filter(
      ([method]) => method === "eq",
    );
    expect(calls).toEqual([
      ["eq", ["user_id", OWNER]],
      ["eq", ["id", ACCOUNT]],
    ]);
  });
});

describe("acquisition — le dry-run n'écrit aucun fait", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    withTables({
      financial_accounts: activeAccount,
      transactions: { data: [], error: null },
      import_record_links: { data: [], error: null },
      import_column_mappings: { data: [], error: null },
      import_sessions: { data: [], error: null },
      import_normalized_records: { data: [], error: null },
    });
    mocks.rpc.mockResolvedValue({ data: "session-1", error: null });
  });

  it("n'appelle QUE la RPC d'analyse", async () => {
    const repository = createImportRepository();
    await repository.analyze(analyzeRequest, file);
    const called = mocks.rpc.mock.calls.map(([name]) => name);
    expect(called).toEqual(["lfo_analyze_import_session"]);
    expect(called).not.toContain("lfo_commit_import_session");
  });

  it("ne dépose aucun fichier au coffre quand la conservation n'est pas demandée", async () => {
    const repository = createImportRepository();
    await repository.analyze(analyzeRequest, file);
    expect(mocks.storageFrom).not.toHaveBeenCalled();
  });

  it("persiste les lignes BRUTES telles quelles, pas une reconstitution", async () => {
    const repository = createImportRepository();
    await repository.analyze(analyzeRequest, file);
    const raw = analysisPayload().raw as Array<{
      row_number: number;
      raw_line: string;
      cells: string[];
    }>;
    expect(raw).toHaveLength(3);
    expect(raw[0].raw_line).toBe("13/08/2026;CARTE 1208 AMAZON EU;-54,28;EUR");
    expect(raw[0].cells).toEqual(["13/08/2026", "CARTE 1208 AMAZON EU", "-54,28", "EUR"]);
    expect(raw[0].row_number).toBe(2);
  });

  it("transmet le mapping et les conventions réellement appliqués", async () => {
    const repository = createImportRepository();
    await repository.analyze(analyzeRequest, file);
    const session = analysisPayload().session as Record<string, unknown>;
    expect(session.mapping).toEqual({ transactionDate: 0, label: 1, amount: 2, currency: 3 });
    expect(session.conventions).toEqual({
      amount: "DECIMAL_COMMA",
      date: "DAY_FIRST",
      valueDate: null,
    });
    expect(session.parser).toBe("bank-csv");
    expect(String(session.file_hash)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("transmet une clé de rapprochement par ligne, distincte à chaque ligne", async () => {
    const repository = createImportRepository();
    await repository.analyze(analyzeRequest, file);
    const normalized = analysisPayload().normalized as Array<Record<string, unknown>>;
    const keys = normalized.map((row) => row.match_key);
    expect(keys.every((value) => typeof value === "string" && value.length > 0)).toBe(true);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("ne transmet aucune catégorie de flux", async () => {
    const repository = createImportRepository();
    await repository.analyze(analyzeRequest, file);
    const serialised = JSON.stringify(analysisPayload());
    expect(serialised).not.toContain("category");
  });

  it("transmet une date d'observation de l'import, jamais la date d'arrêté du reporting", async () => {
    const repository = createImportRepository();
    await repository.analyze(analyzeRequest, file);
    const session = analysisPayload().session as Record<string, unknown>;
    const today = new Date().toISOString().slice(0, 10);
    expect(session.observation_date).toBe(today);
    // AS_OF_DATE est la date d'arrêté du cockpit : elle n'a rien à faire ici.
    expect(session.observation_date).not.toBe("2026-08-19");
  });

  it("transmet la déclaration de stabilité, fausse par défaut", async () => {
    const repository = createImportRepository();
    await repository.analyze(analyzeRequest, file);
    expect(
      (analysisPayload().session as Record<string, unknown>).stable_transaction_id_declared,
    ).toBe(false);
    const normalized = analysisPayload().normalized as Array<Record<string, unknown>>;
    // Sans déclaration, aucune identité n'est produite.
    expect(normalized.every((row) => row.external_key === null)).toBe(true);
  });

  it("lit les transactions à dédupliquer sur le seul compte cible du propriétaire", async () => {
    const builders = withTables({
      financial_accounts: activeAccount,
      transactions: { data: [], error: null },
      import_record_links: { data: [], error: null },
      import_column_mappings: { data: [], error: null },
      import_sessions: { data: [{ source_id: "source-1" }], error: null },
      import_normalized_records: { data: [], error: null },
    });
    const repository = createImportRepository();
    await repository.analyze(analyzeRequest, file);
    const calls = builders.get("transactions")!.calls as Array<[string, unknown[]]>;
    expect(calls.filter(([method]) => method === "eq")).toEqual([
      ["eq", ["user_id", OWNER]],
      ["eq", ["account_id", ACCOUNT]],
    ]);
    // Fenêtre bornée autour de la période observée, marge de rapprochement comprise.
    expect(calls.find(([method]) => method === "gte")).toEqual([
      "gte",
      ["transaction_date", "2026-08-06"],
    ]);
    expect(calls.find(([method]) => method === "lte")).toEqual([
      "lte",
      ["transaction_date", "2026-09-05"],
    ]);
  });
});

describe("acquisition — conservation idempotente du fichier", () => {
  const retaining = { ...analyzeRequest, retainFile: true };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.rpc.mockResolvedValue({ data: "session-1", error: null });
  });

  it("réutilise le document déjà conservé pour la même empreinte de fichier", async () => {
    // Corriger un mapping puis relire republie le même contenu : sans réutilisation,
    // l'utilisateur retrouverait cinq copies de son relevé au coffre pour un seul import.
    withTables({
      financial_accounts: activeAccount,
      transactions: { data: [], error: null },
      import_record_links: { data: [], error: null },
      import_column_mappings: { data: [], error: null },
      import_sessions: {
        data: [{ document_id: "doc-existant", source_id: "source-1" }],
        error: null,
      },
      import_normalized_records: { data: [], error: null },
    });
    const repository = createImportRepository();
    await repository.analyze(retaining, file);
    expect(mocks.storageFrom).not.toHaveBeenCalled();
    expect((analysisPayload().session as Record<string, unknown>).document_id).toBe("doc-existant");
  });

  it("refuse un fichier déjà validé AVANT de déposer une copie au coffre", async () => {
    withTables({
      financial_accounts: activeAccount,
      import_sessions: {
        data: [{ status: "COMMITTED", import_sources: { target_account_id: ACCOUNT } }],
        error: null,
      },
    });
    const repository = createImportRepository();
    await expect(repository.analyze(retaining, file)).rejects.toThrow(/déjà été importé/);
    expect(mocks.storageFrom).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("un fichier validé sur une AUTRE enveloppe ne bloque pas l'import", async () => {
    withTables({
      financial_accounts: activeAccount,
      transactions: { data: [], error: null },
      import_record_links: { data: [], error: null },
      import_column_mappings: { data: [], error: null },
      import_sessions: {
        data: [{ status: "COMMITTED", import_sources: { target_account_id: FOREIGN_ACCOUNT } }],
        error: null,
      },
      import_normalized_records: { data: [], error: null },
    });
    const repository = createImportRepository();
    await expect(repository.analyze(analyzeRequest, file)).resolves.toBeTruthy();
  });
});

describe("acquisition — validation et abandon", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    withTables({ import_sessions: { data: [{ committed_count: 2 }], error: null } });
  });

  it("transmet les inclusions nommées à la RPC de validation", async () => {
    mocks.rpc.mockResolvedValue({ data: "session-1", error: null });
    const repository = createImportRepository();
    const result = await repository.commit("session-1", ["record-1"]);
    expect(mocks.rpc).toHaveBeenCalledWith("lfo_commit_import_session", {
      p_user_id: OWNER,
      p_payload: { session_id: "session-1", include_record_ids: ["record-1"] },
    });
    expect(result.committedCount).toBe(2);
  });

  it("propage l'échec d'une validation au lieu de la déclarer réussie", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "déjà été importé" } });
    const repository = createImportRepository();
    await expect(repository.commit("session-1", [])).rejects.toThrow(/déjà été importé/);
  });

  it("abandonne par la RPC dédiée, sans écriture de table", async () => {
    mocks.rpc.mockResolvedValue({ data: "session-1", error: null });
    const repository = createImportRepository();
    await expect(repository.discard("session-1")).resolves.toBe("session-1");
    expect(mocks.rpc).toHaveBeenCalledWith("lfo_discard_import_session", {
      p_user_id: OWNER,
      p_session_id: "session-1",
    });
  });
});

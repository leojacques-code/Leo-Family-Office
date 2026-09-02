import { beforeEach, describe, expect, it, vi } from "vitest";
import { eventEngineCrossDomainFixture } from "@/lib/engine/__tests__/fixtures/event-engine";

const mocks = vi.hoisted(() => ({
  authenticated: true,
  state: null as unknown as ReturnType<typeof eventEngineCrossDomainFixture>,
}));
vi.mock("@/lib/auth", () => ({
  requireAuthenticated: vi.fn(async () => {
    if (!mocks.authenticated) throw new Error("UNAUTHORIZED");
  }),
}));
vi.mock("@/lib/data/repository", () => ({
  getRepository: vi.fn(async () => ({ getDashboardState: async () => mocks.state })),
}));
import { buildInstitutionalReport } from "@/lib/reporting/report-builder";
import { GET } from "./route";

describe("GET /api/reports/pdf", () => {
  beforeEach(() => {
    mocks.authenticated = true;
    mocks.state = eventEngineCrossDomainFixture();
  });
  it("refuse une route non authentifiée", async () => {
    mocks.authenticated = false;
    expect(
      (await GET(new Request("http://localhost/api/reports/pdf?type=CURRENT_SNAPSHOT"))).status,
    ).toBe(401);
  });
  it("refuse type et paramètres invalides", async () => {
    expect((await GET(new Request("http://localhost/api/reports/pdf?type=NOPE"))).status).toBe(400);
    expect(
      (await GET(new Request("http://localhost/api/reports/pdf?type=ANNUAL_REVIEW&year=x"))).status,
    ).toBe(400);
    expect(
      (
        await GET(
          new Request(
            "http://localhost/api/reports/pdf?type=INVESTMENT_COMMITTEE_MEMO&decisionCaseId=%3Cscript%3E",
          ),
        )
      ).status,
    ).toBe(400);
  });
  it("retourne un PDF privé avec un nom sûr et les données du repository courant", async () => {
    const response = await GET(
      new Request(
        `http://localhost/api/reports/pdf?type=CURRENT_SNAPSHOT&expectedFingerprint=${buildInstitutionalReport(mocks.state, { type: "CURRENT_SNAPSHOT" }).manifest.financialFingerprint}`,
      ),
    );
    const bytes = Buffer.from(await response.arrayBuffer());
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("content-disposition")).toMatch(
      /^attachment; filename="leo-current-snapshot-[0-9-]+\.pdf"$/,
    );
    expect(bytes.subarray(0, 4).toString()).toBe("%PDF");
    expect(bytes.length).toBeGreaterThan(1_000);
  });
});

describe("cohérence aperçu et export", () => {
  beforeEach(() => {
    mocks.authenticated = true;
    mocks.state = eventEngineCrossDomainFixture();
  });
  const request = (
    parameters: {
      type: "CURRENT_SNAPSHOT" | "ANNUAL_REVIEW" | "INVESTMENT_COMMITTEE_MEMO";
      year?: number;
      decisionCaseId?: string;
    },
    fingerprint: string,
  ) =>
    new Request(
      `http://localhost/api/reports/pdf?${new URLSearchParams({ ...Object.fromEntries(Object.entries(parameters).map(([k, v]) => [k, String(v)])), expectedFingerprint: fingerprint })}`,
    );
  it("refuse un fingerprint manquant ou invalide", async () => {
    expect(
      (await GET(new Request("http://localhost/api/reports/pdf?type=CURRENT_SNAPSHOT"))).status,
    ).toBe(400);
    expect((await GET(request({ type: "CURRENT_SNAPSHOT" }, "bad"))).status).toBe(400);
  });
  it("refuse HTTP 409 si l’état serveur change après l’aperçu", async () => {
    const parameters = { type: "CURRENT_SNAPSHOT" as const };
    const fingerprint = buildInstitutionalReport(mocks.state, parameters).manifest
      .financialFingerprint;
    mocks.state.metrics.freeCashFlow = 12345;
    const response = await GET(request(parameters, fingerprint));
    expect(response.status).toBe(409);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.json()).toMatchObject({
      error: expect.stringContaining("Rechargez l’aperçu"),
    });
  });
  it.each([
    [
      { type: "ANNUAL_REVIEW" as const, year: 2026 },
      { type: "ANNUAL_REVIEW" as const, year: 2025 },
    ],
    [
      { type: "INVESTMENT_COMMITTEE_MEMO" as const, decisionCaseId: "A" },
      { type: "INVESTMENT_COMMITTEE_MEMO" as const, decisionCaseId: "B" },
    ],
  ])("lie le fingerprint à l’année et au Decision Case", async (preview, download) => {
    const fingerprint = buildInstitutionalReport(mocks.state, preview).manifest
      .financialFingerprint;
    expect((await GET(request(download, fingerprint))).status).toBe(409);
  });
  it("normalise les paramètres inactifs comme l’UI et ignore tout contenu financier client", async () => {
    const fingerprint = buildInstitutionalReport(mocks.state, {
      type: "CURRENT_SNAPSHOT",
      year: 2026,
      decisionCaseId: "unused",
    }).manifest.financialFingerprint;
    const url =
      request({ type: "CURRENT_SNAPSHOT" }, fingerprint).url +
      "&netWorth=999999999&conclusion=CLIENT_FINANCE";
    const response = await GET(new Request(url));
    expect(response.status).toBe(200);
    expect(Buffer.from(await response.arrayBuffer()).toString("latin1")).not.toContain(
      "CLIENT_FINANCE",
    );
  });
});

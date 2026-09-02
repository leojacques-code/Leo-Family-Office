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
      new Request("http://localhost/api/reports/pdf?type=CURRENT_SNAPSHOT"),
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

import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { DebtReadModel } from "@/lib/presentation/debt/contracts";
import type { Mutation } from "@/lib/data/contracts";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }),
}));
vi.mock("@/components/pages", () => ({ SectionContent: () => <p>Etat global interdit</p> }));
vi.mock("@/components/pages/debt/page", () => ({
  default: ({
    mutate,
    state,
  }: {
    mutate: (value: Mutation) => Promise<boolean>;
    state: DebtReadModel;
  }) => (
    <>
      <p>Lecture {state.readAt}</p>
      <button
        onClick={() =>
          mutate({
            action: "record_debt_balance",
            liabilityId: "11111111-1111-4111-8111-111111111111",
            observedAt: "2026-09-13",
            balance: 0,
            notes: null,
          })
        }
      >
        Enregistrer encours
      </button>
    </>
  ),
}));
import { AppShell } from "@/components/app-shell";
const model = {
  asOfDate: "2026-09-13",
  readAt: "initiale",
  railSources: [],
} as unknown as DebtReadModel;
afterEach(() => vi.unstubAllGlobals());
describe("Dettes : routes et acquittement ciblés", () => {
  it("rafraîchit exclusivement le modèle du domaine", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ ...model, readAt: "actualisée" })));
    vi.stubGlobal("fetch", fetcher);
    render(<AppShell section="debt" source={{ kind: "DEBT", model }} />);
    await userEvent.click(screen.getByRole("button", { name: "Actualiser" }));
    expect(fetcher).toHaveBeenCalledWith("/api/debt", { cache: "no-store" });
    expect(screen.getByText("Lecture actualisée")).toBeInTheDocument();
    expect(screen.queryByText("Etat global interdit")).toBeNull();
  });
  it("une lecture échouée après écriture n'annonce pas un échec d'enregistrement", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response('{"saved":true}'))
      .mockResolvedValueOnce(new Response("{}", { status: 500 }));
    vi.stubGlobal("fetch", fetcher);
    render(<AppShell section="debt" source={{ kind: "DEBT", model }} />);
    await userEvent.click(screen.getByRole("button", { name: "Enregistrer encours" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Dette enregistrée"));
    expect(screen.queryByRole("button", { name: "Masquer l’erreur" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Enregistrer encours" }));
    expect(screen.getByText("Lecture initiale")).toBeInTheDocument();
    expect(fetcher.mock.calls.map((call) => call[0])).toEqual(["/api/debt", "/api/debt"]);
    expect(fetcher.mock.calls.filter((call) => call[1]?.method === "POST")).toHaveLength(1);
  });
});

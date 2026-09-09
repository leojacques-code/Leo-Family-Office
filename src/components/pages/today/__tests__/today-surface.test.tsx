import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { getDemoTodayReadModel } from "@/lib/data/read-models/today-demo";
import { buildTodayView, type TodayViewInput } from "@/lib/presentation/today/view";
import { DOMAIN_IDS } from "@/lib/presentation/today/domains";
import TodayPage from "@/components/pages/today/page";

/**
 * La SURFACE d'Aujourd'hui, rendue.
 *
 * Le §12.2 exige « tests composants clavier/souris », « contrôle de texte interdisant codes et
 * fingerprints » et « test du profil non concerné ». Ces tests montent la page réelle sur des
 * modèles réels : un modèle de lecture correct ne prouve rien de ce qui s'affiche, et c'est
 * exactement ce que la phase 1 a appris de son rail de sources testé mais jamais monté.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }),
}));

const EMPTY_INPUT: TodayViewInput = {
  asOfDate: "2026-09-08",
  reportingCurrency: "EUR",
  netWorth: { value: null, blockers: [] },
  immediateCash: { value: null, blockers: [] },
  closes: [],
  observedFlow: {
    periodStart: "2026-09-01",
    periodEnd: "2026-09-30",
    transactionCount: 0,
    income: 0,
    essentialExpenses: 0,
    debtServicePaid: 0,
    cashFlowAfterDebt: 0,
    unclassifiedFlows: 0,
    fullyCovered: false,
  },
  goal: null,
  events: [],
  reserves: [],
  declarations: [],
  domainFacts: DOMAIN_IDS.map((domain) => ({ domain, hasFacts: false })),
  railSources: [],
  readOnlyDemo: false,
};

const noop = () => undefined;

describe("profil vide — un parcours, pas des erreurs", () => {
  it("affiche l'installation et ses trois réponses, pas quatre cartes « Non calculable »", () => {
    render(<TodayPage model={buildTodayView(EMPTY_INPUT)} onModelChange={noop} />);
    expect(screen.getByRole("region", { name: "Installation" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Êtes-vous concerné ?" })).toBeVisible();
    // Les trois réponses du §18.1, pour chacun des domaines à qualifier.
    expect(screen.getAllByRole("button", { name: "Oui" }).length).toBe(DOMAIN_IDS.length);
    expect(screen.getAllByRole("button", { name: "Non" }).length).toBe(DOMAIN_IDS.length);
    expect(screen.getAllByRole("button", { name: "Je ne sais pas encore" }).length).toBe(
      DOMAIN_IDS.length,
    );
  });

  it("n'affiche JAMAIS « Non calculable » : chaque absence porte son état", () => {
    const { container } = render(
      <TodayPage model={buildTodayView(EMPTY_INPUT)} onModelChange={noop} />,
    );
    // La chaîne unique du constat 5.6, répétée pour quatre situations qui ne demandent pas la
    // même chose. Elle est remplacée par les huit états du §6.3.
    expect(container.textContent).not.toContain("Non calculable");
    expect(container.textContent).toContain("À compléter");
  });

  it("n'affiche aucun zéro fabriqué là où la donnée manque", () => {
    const { container } = render(
      <TodayPage model={buildTodayView(EMPTY_INPUT)} onModelChange={noop} />,
    );
    // Aucun montant en euros ne peut être rendu sur un profil sans aucun fait.
    expect(container.textContent).not.toMatch(/0,00\s*€|\b0\s*€/);
  });
});

describe("contrôle de texte — §12.2", () => {
  it("ne laisse AUCUN code technique sur la surface, même modèle chargé", () => {
    const { container } = render(
      <TodayPage model={getDemoTodayReadModel("2026-09-09")} onModelChange={noop} />,
    );
    const text = container.textContent ?? "";
    // Un code d'union en majuscules avec soulignés : c'est le constat 5.4.
    expect(text).not.toMatch(/[A-Z]{3,}_[A-Z]{3,}/);
    // Ni empreinte, ni UUID.
    expect(text).not.toMatch(/\b[0-9a-f]{32,}\b/i);
    expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  });

  it("pose les six questions du §3 en français", () => {
    const { container } = render(
      <TodayPage model={getDemoTodayReadModel("2026-09-09")} onModelChange={noop} />,
    );
    for (const question of [
      "Combien est-ce que je possède réellement ?",
      "Combien est disponible maintenant ?",
      "Est-ce que ma situation s’améliore ou se dégrade ?",
      "Suis-je en sécurité par rapport à mes engagements et objectifs ?",
      "Où vais-je si je ne change rien ?",
      "Quelle décision mérite mon attention aujourd’hui ?",
    ]) {
      expect(container.textContent, question).toContain(question);
    }
  });
});

describe("trois actions au plus — §20 item 5", () => {
  it("ne rend jamais plus de trois actions prioritaires", () => {
    const model = buildTodayView({
      ...EMPTY_INPUT,
      reserves: [
        "REAL_ESTATE_VALUATION_MISSING",
        "ENVELOPE_VALUE_MISSING",
        "POSITION_ORPHAN",
        "OPERATING_TERMS_MISSING",
        "USAGE_UNDECLARED",
      ].map((code) => ({ code, blocking: true, origin: "le bilan canonique", href: "/net-worth" })),
    });
    render(<TodayPage model={model} onModelChange={noop} />);
    const actions = screen.getByRole("region", { name: "Actions prioritaires" });
    expect(within(actions).getAllByRole("link").length).toBeLessThanOrEqual(3);
  });
});

describe("boîte de réception — tiroir, six vues, quatre explications", () => {
  it("s'ouvre dans un tiroir et non dans une septième section de la page", async () => {
    const user = userEvent.setup();
    render(<TodayPage model={getDemoTodayReadModel("2026-09-09")} onModelChange={noop} />);
    // Le §7 de V10 : « forms do not occupy the main canvas ». Rien avant le clic.
    expect(screen.queryByRole("dialog")).toBeNull();
    await user.click(screen.getByRole("button", { name: /Boîte de réception/ }));
    const drawer = screen.getByRole("dialog", { name: "Boîte de réception" });
    expect(drawer).toBeVisible();
    // Les six vues du §32, en onglets.
    const tabs = within(drawer).getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent?.replace(/\d+$/, ""))).toEqual([
      "À vérifier",
      "Conflits",
      "Données manquantes",
      "Données anciennes",
      "À venir",
      "Résolus automatiquement",
    ]);
  });

  it("explique une tâche par fait, importance, preuve et effet — à l'ouverture, pas avant", async () => {
    const user = userEvent.setup();
    render(<TodayPage model={getDemoTodayReadModel("2026-09-09")} onModelChange={noop} />);
    await user.click(screen.getByRole("button", { name: /Boîte de réception/ }));
    const drawer = screen.getByRole("dialog", { name: "Boîte de réception" });
    // Le §4.4 de V10 : « explanation appears on interaction, not permanently ».
    expect(within(drawer).queryByText("Pourquoi cela compte")).toBeNull();
    const [firstTask] = within(drawer).getAllByRole("button", { expanded: false });
    await user.click(firstTask!);
    for (const label of [
      "Ce qui s’est passé",
      "Pourquoi cela compte",
      "La preuve",
      "Ce que change l’acceptation",
    ]) {
      expect(within(drawer).getByText(label)).toBeVisible();
    }
  });

  it("dit pourquoi « Données anciennes » est vide au lieu d'affirmer une fraîcheur", async () => {
    const user = userEvent.setup();
    render(<TodayPage model={getDemoTodayReadModel("2026-09-09")} onModelChange={noop} />);
    await user.click(screen.getByRole("button", { name: /Boîte de réception/ }));
    const drawer = screen.getByRole("dialog", { name: "Boîte de réception" });
    await user.click(within(drawer).getByRole("tab", { name: /Données anciennes/ }));
    expect(within(drawer).getByText(/Aucun seuil de fraîcheur n’est déclaré/)).toBeVisible();
  });

  it("se ferme au clavier, par Échap", async () => {
    const user = userEvent.setup();
    render(<TodayPage model={getDemoTodayReadModel("2026-09-09")} onModelChange={noop} />);
    await user.click(screen.getByRole("button", { name: /Boîte de réception/ }));
    expect(screen.getByRole("dialog")).toBeVisible();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("démonstration en lecture seule", () => {
  it("annonce la lecture seule et ne propose AUCUN contrôle d'écriture", () => {
    render(<TodayPage model={getDemoTodayReadModel("2026-09-09")} onModelChange={noop} />);
    expect(screen.getByRole("status").textContent).toContain("lecture seule");
    // Un contrôle inerte coûte plus qu'un contrôle absent : les réponses ne sont pas rendues.
    expect(screen.queryByRole("button", { name: "Je ne sais pas encore" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Changer" })).toBeNull();
  });
});

describe("déclaration d'applicabilité", () => {
  it("écrit par la route d'Aujourd'hui et remplace le MODÈLE, pas l'état global", async () => {
    const user = userEvent.setup();
    const model = buildTodayView(EMPTY_INPUT);
    const next = buildTodayView({
      ...EMPTY_INPUT,
      declarations: [
        {
          domain: "IMMOBILIER",
          applicability: "DECLARED_NONE",
          declaredOn: "2026-09-08",
          note: null,
        },
      ],
    });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => next });
    vi.stubGlobal("fetch", fetchMock);
    const onModelChange = vi.fn();

    render(<TodayPage model={model} onModelChange={onModelChange} />);
    await user.click(screen.getAllByRole("button", { name: "Non" })[3]!);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/today");
    // §10.2 : « une mutation ne doit plus renvoyer tout DashboardState ».
    expect(JSON.parse(init.body).applicability).toBe("DECLARED_NONE");
    expect(onModelChange).toHaveBeenCalledWith(next);
    vi.unstubAllGlobals();
  });

  it("annonce un échec sans perdre le modèle affiché", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue({ ok: false, json: async () => ({ error: "Déclaration impossible" }) }),
    );
    render(<TodayPage model={buildTodayView(EMPTY_INPUT)} onModelChange={noop} />);
    await user.click(screen.getAllByRole("button", { name: "Non" })[0]!);
    expect(screen.getByRole("alert").textContent).toBe("Déclaration impossible");
    // Le parcours est toujours là : un échec d'écriture ne vide pas l'écran.
    expect(screen.getByRole("region", { name: "Installation" })).toBeVisible();
    vi.unstubAllGlobals();
  });
});

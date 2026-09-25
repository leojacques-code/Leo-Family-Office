import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { DebtContractForm } from "../debt-contract-form";

const chooseStructure = () => {
  fireEvent.change(screen.getByLabelText("Mode de remboursement"), {
    target: { value: "AMORTIZING" },
  });
};

describe("nouveau contrat de dette : vide reste vide (document 03 §8, document 04 §3)", () => {
  it("commence par le mode de remboursement et ne préremplit aucun fait inconnu", () => {
    render(
      <DebtContractForm
        asOfDate="2026-09-09"
        reportingCurrency="EUR"
        busy={false}
        loan={null}
        onCancel={vi.fn()}
        onSave={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("Mode de remboursement")).toHaveValue("");
    // Rien du contrat n'est demandé tant que le mode n'est pas choisi.
    expect(screen.queryByLabelText(/Taux annuel/)).toBeNull();
    chooseStructure();
    for (const input of [
      screen.getByLabelText(/Capital initial emprunté.*EUR/),
      screen.getByLabelText(/Encours observé initial.*EUR/),
      screen.getByLabelText(/Taux annuel.*pourcentage/),
      screen.getByLabelText(/Paiement par échéance.*EUR/),
      screen.getByLabelText(/Nombre d’échéances.*échéances/),
      screen.getByLabelText("Maturité contractuelle"),
      screen.getByLabelText("Première échéance"),
      screen.getByLabelText("Date de l’encours initial"),
    ]) {
      expect(input).toHaveValue("");
    }
    // Aucune convention n'est supposée : périodicité, convention et type de taux sont à choisir.
    expect(screen.getByLabelText("Périodicité des échéances")).toHaveValue("");
    expect(screen.getByLabelText("Convention d’intérêt")).toHaveValue("");
    expect(screen.getByLabelText("Type de taux")).toHaveValue("");
  });

  it("refuse l’enregistrement tant que la structure n’est pas choisie", () => {
    const onSave = vi.fn();
    render(
      <DebtContractForm
        asOfDate="2026-09-09"
        reportingCurrency="EUR"
        busy={false}
        loan={null}
        onCancel={vi.fn()}
        onSave={onSave}
      />,
    );
    fireEvent.submit(screen.getByRole("button", { name: "Ajouter cette dette" }).closest("form")!);
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(/Choisissez le mode de remboursement/);
  });
});

it("conserve les notes du contrat distinctes de la dernière observation lors d’une réédition", async () => {
  const { buildDemoState } = await import("@/lib/data/read-models/today-demo");
  const base = buildDemoState("2026-09-14").liabilities[0]!;
  const loan = {
    ...base,
    contractNotes: "Échéancier fourni : extrait bancaire",
    provenance: { ...base.provenance, notes: "Observation du solde" },
  };
  const save = vi.fn().mockResolvedValue(true);
  render(
    <DebtContractForm
      loan={loan}
      asOfDate="2026-09-14"
      reportingCurrency="EUR"
      busy={false}
      onSave={save}
      onCancel={vi.fn()}
    />,
  );
  fireEvent.submit(screen.getByRole("button", { name: "Enregistrer le contrat" }).closest("form")!);
  expect(save).toHaveBeenCalledWith(
    expect.objectContaining({
      notes: "Échéancier fourni : extrait bancaire",
      initialBalance: null,
    }),
  );
});

describe("B16 : contrat minimal et synthèse avant enregistrement", () => {
  const fillMoney = (label: RegExp, value: string) => {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
    fireEvent.blur(screen.getByLabelText(label));
  };
  it("accepte la seule mensualité, montre la durée déduite et n'envoie aucune durée inventée", async () => {
    const onSave = vi.fn().mockResolvedValue(true);
    render(
      <DebtContractForm
        asOfDate="2026-01-01"
        reportingCurrency="EUR"
        busy={false}
        loan={null}
        onCancel={vi.fn()}
        onSave={onSave}
      />,
    );
    fireEvent.change(screen.getByLabelText("Mode de remboursement"), {
      target: { value: "AMORTIZING" },
    });
    fireEvent.change(screen.getByLabelText("Nom de la dette"), { target: { value: "Prêt O03" } });
    fireEvent.change(screen.getByLabelText("Prêteur"), { target: { value: "Banque" } });
    fillMoney(/Capital initial emprunté/, "1200");
    fillMoney(/Encours observé initial/, "1200");
    fireEvent.change(screen.getByLabelText("Date de l’encours initial"), {
      target: { value: "2026-01-01" },
    });
    fillMoney(/Taux annuel/, "0");
    fireEvent.change(screen.getByLabelText("Type de taux"), { target: { value: "FIXED" } });
    fireEvent.change(screen.getByLabelText("Périodicité des échéances"), {
      target: { value: "MONTHLY" },
    });
    fireEvent.change(screen.getByLabelText("Convention d’intérêt"), {
      target: { value: "PROPORTIONAL" },
    });
    fireEvent.change(screen.getByLabelText("Première échéance"), {
      target: { value: "2026-01-05" },
    });
    fillMoney(/Paiement par échéance/, "100");
    fireEvent.click(screen.getByLabelText("Inconnue (coût incomplet)"));
    const synthesis = screen.getByRole("region", { name: "Synthèse du contrat" });
    expect(synthesis).toHaveTextContent(
      "12, dont 12 amortissant du capital (durée déduite de la mensualité)",
    );
    expect(synthesis).toHaveTextContent("5 décembre 2026 (maturité déduite de la durée)");
    // Assurance et frais non déclarés : inconnus, jamais zéro, et le total le dit.
    expect(synthesis).toHaveTextContent("Assurance futureInconnue");
    expect(synthesis).toHaveTextContent("connus, hors assurance et frais récurrents");
    fireEvent.submit(screen.getByRole("button", { name: "Ajouter cette dette" }).closest("form")!);
    await vi.waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0]![0]).toMatchObject({
      paymentAmount: 100,
      paymentCount: null,
      maturityDate: null,
      amortisationProfile: "AMORTIZING",
    });
  });

  it("refuse une mensualité qui ne rembourse pas le capital, sans rien envoyer", () => {
    const onSave = vi.fn();
    render(
      <DebtContractForm
        asOfDate="2026-01-01"
        reportingCurrency="EUR"
        busy={false}
        loan={null}
        onCancel={vi.fn()}
        onSave={onSave}
      />,
    );
    fireEvent.change(screen.getByLabelText("Mode de remboursement"), {
      target: { value: "AMORTIZING" },
    });
    fireEvent.change(screen.getByLabelText("Nom de la dette"), { target: { value: "Prêt" } });
    fireEvent.change(screen.getByLabelText("Prêteur"), { target: { value: "Banque" } });
    fillMoney(/Capital initial emprunté/, "100000");
    fillMoney(/Encours observé initial/, "100000");
    fireEvent.change(screen.getByLabelText("Date de l’encours initial"), {
      target: { value: "2026-01-01" },
    });
    fillMoney(/Taux annuel/, "6");
    fireEvent.change(screen.getByLabelText("Type de taux"), { target: { value: "FIXED" } });
    fireEvent.change(screen.getByLabelText("Périodicité des échéances"), {
      target: { value: "MONTHLY" },
    });
    fireEvent.change(screen.getByLabelText("Convention d’intérêt"), {
      target: { value: "PROPORTIONAL" },
    });
    fireEvent.change(screen.getByLabelText("Première échéance"), {
      target: { value: "2026-01-05" },
    });
    fillMoney(/Paiement par échéance/, "400");
    expect(screen.getByRole("region", { name: "Synthèse du contrat" })).toHaveTextContent(
      "la mensualité ne rembourse pas le capital",
    );
    fireEvent.submit(screen.getByRole("button", { name: "Ajouter cette dette" }).closest("form")!);
    expect(onSave).not.toHaveBeenCalled();
  });
});

describe("B17 : assurance séparée dans le contrat (document 04, étape D)", () => {
  const fillMoney = (label: RegExp | string, value: string) => {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
    fireEvent.blur(screen.getByLabelText(label));
  };
  const fillO03 = () => {
    fireEvent.change(screen.getByLabelText("Mode de remboursement"), {
      target: { value: "AMORTIZING" },
    });
    fireEvent.change(screen.getByLabelText("Nom de la dette"), { target: { value: "Prêt O03" } });
    fireEvent.change(screen.getByLabelText("Prêteur"), { target: { value: "Banque" } });
    fillMoney(/Capital initial emprunté/, "1200");
    fillMoney(/Encours observé initial/, "1200");
    fireEvent.change(screen.getByLabelText("Date de l’encours initial"), {
      target: { value: "2026-01-01" },
    });
    fillMoney(/Taux annuel/, "0");
    fireEvent.change(screen.getByLabelText("Type de taux"), { target: { value: "FIXED" } });
    fireEvent.change(screen.getByLabelText("Périodicité des échéances"), {
      target: { value: "MONTHLY" },
    });
    fireEvent.change(screen.getByLabelText("Convention d’intérêt"), {
      target: { value: "PROPORTIONAL" },
    });
    fireEvent.change(screen.getByLabelText("Première échéance"), {
      target: { value: "2026-01-05" },
    });
    fillMoney(/Paiement par échéance/, "100");
  };

  it("exige un choix d'assurance avant l'enregistrement", () => {
    const onSave = vi.fn();
    render(
      <DebtContractForm
        asOfDate="2026-01-01"
        reportingCurrency="EUR"
        busy={false}
        loan={null}
        onCancel={vi.fn()}
        onSave={onSave}
      />,
    );
    fillO03();
    fireEvent.submit(screen.getByRole("button", { name: "Ajouter cette dette" }).closest("form")!);
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("Indiquez le traitement de l’assurance");
  });

  it("enregistre une police séparée, ses assurés et sa période, sans prime par échéance", async () => {
    const onSave = vi.fn().mockResolvedValue(true);
    render(
      <DebtContractForm
        asOfDate="2026-01-01"
        reportingCurrency="EUR"
        busy={false}
        loan={null}
        onCancel={vi.fn()}
        onSave={onSave}
      />,
    );
    fillO03();
    fireEvent.click(screen.getByLabelText("Prélevée séparément"));
    fireEvent.change(screen.getByLabelText("Assureur (facultatif)"), {
      target: { value: "Assureur" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Ajouter un assuré/ }));
    fireEvent.change(screen.getByLabelText("Nom de l’assuré 1"), {
      target: { value: "Emprunteur" },
    });
    fireEvent.change(screen.getByLabelText("Quotité de l’assuré 1, en pourcentage"), {
      target: { value: "100" },
    });
    fireEvent.change(screen.getByLabelText("Premier débit"), { target: { value: "2026-01-05" } });
    fillMoney(/Prime par débit/, "5");
    const synthesis = screen.getByRole("region", { name: "Synthèse du contrat" });
    // Oracle O03 : 12 débits de 5 € sur le calendrier propre de l'assurance.
    expect(synthesis).toHaveTextContent("Assurance future60 €");
    fireEvent.submit(screen.getByRole("button", { name: "Ajouter cette dette" }).closest("form")!);
    await vi.waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0]![0]).toMatchObject({
      insuranceMode: "SEPARATE",
      insuranceAmount: null,
      paymentIncludesInsurance: false,
      insurancePolicies: [
        {
          insurer: "Assureur",
          insured: [{ name: "Emprunteur", coverageShare: 1 }],
          periods: [
            {
              firstDebitDate: "2026-01-05",
              lastDebitDate: null,
              frequency: "MONTHLY",
              premiumAmount: 5,
            },
          ],
        },
      ],
    });
  });

  it("ne laisse pas une quotité hors bornes partir au serveur", () => {
    const onSave = vi.fn();
    render(
      <DebtContractForm
        asOfDate="2026-01-01"
        reportingCurrency="EUR"
        busy={false}
        loan={null}
        onCancel={vi.fn()}
        onSave={onSave}
      />,
    );
    fillO03();
    fireEvent.click(screen.getByLabelText("Prélevée séparément"));
    fireEvent.click(screen.getByRole("button", { name: /Ajouter un assuré/ }));
    fireEvent.change(screen.getByLabelText("Nom de l’assuré 1"), { target: { value: "A" } });
    fireEvent.change(screen.getByLabelText("Quotité de l’assuré 1, en pourcentage"), {
      target: { value: "150" },
    });
    fireEvent.change(screen.getByLabelText("Premier débit"), { target: { value: "2026-01-05" } });
    fillMoney(/Prime par débit/, "5");
    fireEvent.submit(screen.getByRole("button", { name: "Ajouter cette dette" }).closest("form")!);
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("quotité entre 0 et 100 %");
  });
});

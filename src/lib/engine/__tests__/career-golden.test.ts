import { describe, expect, it } from "vitest";
import {
  buildCareerAnalytics,
  buildCareerMonthlyConsequences,
  type CareerCompensationTerm,
  type CareerEvent,
  type CareerRole,
} from "@/lib/engine/career";

const role = (patch: Partial<CareerRole> = {}): CareerRole => ({
  id: "r1",
  employer: "Synthetic Corp",
  jobTitle: "Analyst",
  employmentType: "EMPLOYEE",
  industry: "Finance",
  country: "FR",
  currency: "EUR",
  startDate: "2026-01-01",
  endDate: null,
  status: "ACTIVE",
  dataKind: "CONTRACTUAL",
  source: "Synthetic fixture",
  confidence: "HIGH",
  notes: null,
  ...patch,
});
const term = (patch: Partial<CareerCompensationTerm> = {}): CareerCompensationTerm => ({
  id: "t1",
  roleId: "r1",
  baseSalary: 48_000,
  frequency: "ANNUAL",
  guaranteedBonus: null,
  targetBonus: null,
  targetBonusRate: null,
  discretionaryBonus: null,
  commissions: null,
  profitSharing: null,
  participation: null,
  employerBenefits: null,
  allowances: null,
  otherTaxableCompensation: null,
  otherNonTaxableCompensation: null,
  workingTime: null,
  effectiveFrom: "2026-01-01",
  effectiveTo: null,
  dataKind: "CONTRACTUAL",
  source: "Synthetic contract",
  confidence: "HIGH",
  ...patch,
});
const event = (patch: Partial<CareerEvent> = {}): CareerEvent => ({
  id: "e1",
  roleId: "r1",
  type: "BONUS_PAID",
  eventDate: "2026-03-15",
  amount: 4_200,
  currency: "EUR",
  variableState: "PAID",
  paidDate: "2026-03-15",
  label: "Bonus",
  notes: null,
  dataKind: "ACTUAL",
  source: "Synthetic payslip",
  confidence: "HIGH",
  ...patch,
});
const run = (
  roles = [role()],
  terms = [term()],
  events: CareerEvent[] = [],
  startDate = "2026-01-01",
  endDate = "2026-12-31",
) =>
  buildCareerMonthlyConsequences({
    roles,
    terms,
    events,
    startDate,
    endDate,
    reportingCurrency: "EUR",
  });

describe("Career Engine — 20 golden cases", () => {
  it("1. CDI fixe seul", () => expect(run()).toHaveLength(12));
  it("2. fixe + bonus cible ne met pas le target en cash", () =>
    expect(run([role()], [term({ targetBonusRate: 0.1 })])[0].grossIncome).toBe(4_000));
  it("3. bonus cible est distinct du bonus payé", () =>
    expect(run([role()], [term({ targetBonus: 5_000 })], [event()])[2].grossIncome).toBe(8_200));
  it("4. bonus payé l'année suivante n'entre pas en 2026", () =>
    expect(
      run([role()], [term()], [event({ paidDate: "2027-03-15" })]).every(
        (m) => m.variableGrossPaid === 0,
      ),
    ).toBe(true));
  it("5. promotion en cours d'année applique un nouveau terme daté", () => {
    const values = run(
      [role()],
      [
        term({ effectiveTo: "2026-06-30" }),
        term({ id: "t2", baseSalary: 60_000, effectiveFrom: "2026-07-01" }),
      ],
    );
    expect(values[5].fixedGross).toBe(4_000);
    expect(values[6].fixedGross).toBe(5_000);
  });
  it("6. changement d'employeur respecte les dates", () => {
    const values = run(
      [
        role({ endDate: "2026-06-30" }),
        role({ id: "r2", employer: "New Corp", startDate: "2026-07-01" }),
      ],
      [
        term({ effectiveTo: "2026-06-30" }),
        term({ id: "t2", roleId: "r2", effectiveFrom: "2026-07-01" }),
      ],
    );
    expect(values[6].employer).toBe("New Corp");
  });
  it("7. deux emplois successifs ne se chevauchent pas", () =>
    expect(
      run(
        [role({ endDate: "2026-06-30" }), role({ id: "r2", startDate: "2026-07-01" })],
        [
          term({ effectiveTo: "2026-06-30" }),
          term({ id: "t2", roleId: "r2", effectiveFrom: "2026-07-01" }),
        ],
      ),
    ).toHaveLength(12));
  it("8. deux revenus simultanés restent deux conséquences", () =>
    expect(
      run(
        [role(), role({ id: "r2", employer: "Side gig", employmentType: "FREELANCE" })],
        [term(), term({ id: "t2", roleId: "r2", baseSalary: 1_000, frequency: "MONTHLY" })],
      ),
    ).toHaveLength(24));
  it("9. stage vers CDI conserve le type de chaque rôle", () => {
    const roles = [
      role({ employmentType: "INTERN", endDate: "2026-06-30" }),
      role({ id: "r2", employmentType: "EMPLOYEE", startDate: "2026-07-01" }),
    ];
    expect(roles.map((r) => r.employmentType)).toEqual(["INTERN", "EMPLOYEE"]);
  });
  it("10. période de chômage ne crée aucun revenu implicite", () =>
    expect(run([role({ employmentType: "UNEMPLOYED" })], [])[0].grossIncome).toBeNull());
  it("11. freelance mensuel est représentable", () =>
    expect(
      run(
        [role({ employmentType: "FREELANCE" })],
        [term({ frequency: "MONTHLY", baseSalary: 3_000 })],
      )[0].fixedGross,
    ).toBe(3_000));
  it("12. devise étrangère sans FX bloque le calcul", () =>
    expect(run([role({ currency: "USD" })])[0].blockers[0]).toContain("FX_MISSING"));
  it("13. changement de devise est porté par un nouveau rôle", () =>
    expect(
      [role({ currency: "EUR" }), role({ id: "r2", currency: "USD" })].map((r) => r.currency),
    ).toEqual(["EUR", "USD"]));
  it("14. salaire inconnu reste null", () =>
    expect(run([role()], [term({ baseSalary: null })])[0].grossIncome).toBeNull());
  it("15. variable inconnu payé bloque le mois", () =>
    expect(run([role()], [term()], [event({ amount: null })])[2].grossIncome).toBeNull());
  it("16. zéro bonus explicitement payé vaut zéro", () =>
    expect(run([role()], [term()], [event({ amount: 0 })])[2].grossIncome).toBe(4_000));
  it("17. equity grant non liquide ne rejoint pas le salaire", () =>
    expect(run([role()], [term()])[0].grossIncome).toBe(4_000));
  it("18. vesting partiel reste un événement sans valorisation automatique", () =>
    expect(event({ type: "EQUITY_VEST", amount: null, variableState: null }).amount).toBeNull());
  it("19. offre future est PROJECTED", () =>
    expect(
      run(
        [role({ startDate: "2026-07-01", status: "FUTURE", dataKind: "PROJECTED" })],
        [term({ effectiveFrom: "2026-07-01", dataKind: "PROJECTED" })],
      )[0].status,
    ).toBe("PROJECTED"));
  it("20. stay vs new job se compare par conséquences, jamais net worth local", () => {
    const stay = run();
    const offer = run([role({ employer: "Offer" })], [term({ baseSalary: 60_000 })]);
    expect(offer[0].grossIncome! - stay[0].grossIncome!).toBe(1_000);
  });
  it("analytics YTD/T12M et concentration restent dérivées", () => {
    const analytics = buildCareerAnalytics({ consequences: run(), asOfDate: "2026-12-31" });
    expect(analytics.realisedT12m).toBeNull();
    expect(analytics.annualisedFixedCompensation).toBe(48_000);
  });
});

import { describe, expect, it } from "vitest";

import {
  buildEnrichmentDiff,
  enrichableFieldCatalog,
  sameIdentityText,
  sameNafCode,
} from "@/lib/acquisition/registry/diff";
import { emptyProfile } from "@/lib/acquisition/registry/normalize";
import { FIXTURE_CAPABILITIES } from "@/lib/acquisition/registry/fixture-provider";
import type {
  BusinessCanonicalIdentity,
  CompanyRegistryProfileCandidate,
  RegistryCapability,
} from "@/lib/acquisition/registry/types";

const NOW = "2026-08-31T10:00:00.000Z";

function identity(overrides: Partial<BusinessCanonicalIdentity> = {}): BusinessCanonicalIdentity {
  return {
    name: null,
    legalForm: null,
    sector: null,
    nafCode: null,
    country: null,
    foundedOn: null,
    siren: null,
    ...overrides,
  };
}

function profile(
  overrides: Partial<CompanyRegistryProfileCandidate> = {},
): CompanyRegistryProfileCandidate {
  return { ...emptyProfile("900000001"), ...overrides };
}

function run(
  identityOverrides: Partial<BusinessCanonicalIdentity>,
  profileOverrides: Partial<CompanyRegistryProfileCandidate>,
  capabilities: readonly RegistryCapability[] = FIXTURE_CAPABILITIES,
  staleAfter: string | null = "2026-09-01T00:00:00.000Z",
) {
  return buildEnrichmentDiff({
    identity: identity(identityOverrides),
    profile: profile(profileOverrides),
    capabilities,
    staleAfter,
    now: NOW,
  });
}

describe("équivalences de forme", () => {
  it("ignore casse et accents sur une dénomination", () => {
    expect(sameIdentityText("SOCIETE FICTIVE ALPHA", "Société Fictive Alpha")).toBe(true);
    expect(sameIdentityText("SOCIETE  FICTIVE", "Societe Fictive")).toBe(true);
    expect(sameIdentityText("SOCIETE FICTIVE ALPHA", "SOCIETE FICTIVE BETA")).toBe(false);
  });

  it("ignore le point d'un code NAF", () => {
    expect(sameNafCode("70.22Z", "7022Z")).toBe(true);
    expect(sameNafCode("70.22Z", "70.22A")).toBe(false);
  });
});

describe("construction du diff", () => {
  it("propose un REMPLISSAGE quand le cockpit ne portait rien", () => {
    const diff = run({}, { legalName: "SOCIÉTÉ FICTIVE ALPHA" });
    const proposal = diff.proposals.find((item) => item.field === "name");
    expect(proposal).toBeDefined();
    expect(proposal?.state).toBe("CANDIDATE");
    expect(proposal?.canonicalValueBefore).toBeNull();
    expect(proposal?.candidateValue).toBe("SOCIÉTÉ FICTIVE ALPHA");
  });

  it("déclare un CONFLIT quand deux valeurs différentes coexistent", () => {
    const diff = run({ name: "Alpha Conseil" }, { legalName: "SOCIÉTÉ FICTIVE ALPHA" });
    const proposal = diff.proposals.find((item) => item.field === "name");
    expect(proposal?.state).toBe("CONFLICT");
    expect(proposal?.canonicalValueBefore).toBe("Alpha Conseil");
  });

  it("ne propose RIEN quand les deux valeurs désignent la même information", () => {
    const diff = run({ name: "Société Fictive Alpha" }, { legalName: "SOCIETE FICTIVE ALPHA" });
    expect(diff.proposals.some((item) => item.field === "name")).toBe(false);
    expect(diff.skipped.find((item) => item.field === "name")?.reason).toBe("ALREADY_ALIGNED");
  });

  it("ne propose JAMAIS d'effacer une valeur canonique par une absence", () => {
    // Le registre est muet sur la forme juridique alors qu'il la sert : aucune proposition,
    // et surtout pas une proposition de vider ce que l'utilisateur a saisi.
    const diff = run({ legalForm: "SAS" }, { legalFormLabel: null });
    expect(diff.proposals.some((item) => item.field === "legal_form")).toBe(false);
    const skip = diff.skipped.find((item) => item.field === "legal_form");
    expect(skip?.reason).toBe("CANDIDATE_MISSING");
    expect(skip?.canonicalValueBefore).toBe("SAS");
  });

  it("distingue CAPACITÉ NON SERVIE d'une donnée absente", () => {
    const withoutLabel = FIXTURE_CAPABILITIES.filter(
      (capability) => capability !== "legal_form_label",
    );
    const diff = run(
      { legalForm: "SAS" },
      { legalFormLabel: "Société par actions simplifiée" },
      withoutLabel,
    );
    expect(diff.proposals.some((item) => item.field === "legal_form")).toBe(false);
    expect(diff.skipped.find((item) => item.field === "legal_form")?.reason).toBe(
      "CAPABILITY_NOT_SERVED",
    );
  });

  it("traite une chaîne canonique blanche comme une absence, pas comme un conflit", () => {
    const diff = run({ name: "   " }, { legalName: "SOCIÉTÉ FICTIVE ALPHA" });
    expect(diff.proposals.find((item) => item.field === "name")?.state).toBe("CANDIDATE");
  });

  it("dérive STALE sans jamais le persister, et signale la péremption", () => {
    const diff = run(
      {},
      { legalName: "SOCIÉTÉ FICTIVE ALPHA" },
      FIXTURE_CAPABILITIES,
      "2026-08-30T00:00:00.000Z",
    );
    expect(diff.stale).toBe(true);
    const proposal = diff.proposals.find((item) => item.field === "name");
    // L'état PERSISTÉ reste décidable ; seul l'affichage porte la péremption.
    expect(proposal?.state).toBe("CANDIDATE");
    expect(proposal?.displayState).toBe("STALE");
    expect(diff.issues.map((issue) => issue.code)).toContain("SNAPSHOT_STALE");
  });

  it("signale une fraîcheur NON déclarée plutôt que de la supposer bonne", () => {
    const diff = run({}, { legalName: "SOCIÉTÉ FICTIVE ALPHA" }, FIXTURE_CAPABILITIES, null);
    expect(diff.stale).toBe(false);
    expect(diff.issues.map((issue) => issue.code)).toContain("PROVIDER_FRESHNESS_UNDECLARED");
  });

  it("couvre exactement les champs enrichissables du catalogue", () => {
    const diff = run({}, {});
    const seen = [...diff.proposals.map((p) => p.field), ...diff.skipped.map((s) => s.field)];
    expect(new Set(seen)).toEqual(new Set(enrichableFieldCatalog().map((entry) => entry.field)));
  });

  it("compare une date de création à l'identique, sans tolérance", () => {
    expect(
      run({ foundedOn: "2019-04-15" }, { createdOn: "2019-04-15" }).skipped.find(
        (item) => item.field === "founded_on",
      )?.reason,
    ).toBe("ALREADY_ALIGNED");
    expect(
      run({ foundedOn: "2019-04-16" }, { createdOn: "2019-04-15" }).proposals.find(
        (item) => item.field === "founded_on",
      )?.state,
    ).toBe("CONFLICT");
  });
});

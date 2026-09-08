import { describe, expect, it } from "vitest";
import {
  EXEMPT_SURFACES,
  findTechnicalContentInSource,
  findTechnicalContentInSurfaces,
} from "@/lib/presentation/surface-content";

const REPO_ROOT = new URL("../../../../", import.meta.url).pathname;

describe("gate : aucune valeur technique dans les surfaces principales", () => {
  it("ne trouve AUCUNE empreinte, UUID ni identifiant rendu comme texte", () => {
    // Règle de contenu de la section 11, motivée par le constat 5.4. Avant cette phase, six
    // sites rendaient une empreinte en clair, dont le bandeau d'Aujourd'hui et celui de
    // Beyonder, les deux pages les plus consultées du produit.
    const findings = findTechnicalContentInSurfaces(REPO_ROOT);
    expect(
      findings.map((finding) => `${finding.file}:${finding.line} — ${finding.reason}`),
      "valeurs techniques rendues à l’écran : déplacez-les dans <TechnicalDetails>",
    ).toEqual([]);
  });

  it("n’exempte QUE le volet prévu pour ces valeurs, et le motive", () => {
    // Une exemption générique viderait le gate de son sens. Celle-ci est nominative : le
    // volet de détail technique EST la solution du constat 5.4, pas une infraction tolérée.
    expect(Object.keys(EXEMPT_SURFACES)).toEqual([
      "src/components/primitives/technical-details.tsx",
    ]);
    for (const motive of Object.values(EXEMPT_SURFACES)) {
      expect(motive.length).toBeGreaterThan(20);
    }
  });
});

describe("le contrôle attrape réellement ce qu’il prétend attraper", () => {
  // Un gate vert peut l'être parce qu'il est correct, ou parce qu'il ne cherche rien. Ces
  // cas construits exprès distinguent les deux, et ils tomberont si quelqu'un affaiblit le
  // détecteur pour faire passer une infraction.
  const scan = (source: string) => findTechnicalContentInSource("test.tsx", source);

  it("attrape une empreinte rendue comme texte", () => {
    expect(scan("<dd>{result.run.baselineFingerprint}</dd>")).toHaveLength(1);
    expect(scan("<p>Empreinte : {manifest.financialFingerprint}</p>")).toHaveLength(1);
  });

  it("attrape un UUID et une empreinte écrits en clair", () => {
    expect(scan('<p>{"3f2504e0-4f89-11d3-9a0c-0305e82c3301"}</p>')[0].reason).toContain("UUID");
    expect(scan("<p>a3f5c9e1b7d24608a3f5c9e1b7d24608</p>")[0].reason).toContain("empreinte");
  });

  it("ne s’émeut PAS d’un identifiant passé en attribut", () => {
    // C'est la moitié qui compte : un gate qui crie sur `key={item.id}` serait désactivé
    // dans la semaine, et il ne protégerait plus rien.
    expect(scan("<button key={item.id} value={entity.id} />")).toEqual([]);
    expect(scan("<Component onCopy={() => copy(run.fingerprint)} />")).toEqual([]);
  });

  it("ne s’émeut PAS d’un littéral d’objet passé en propriété", () => {
    expect(
      scan('  { label: "Empreinte d’ouverture", value: manifest.openingFingerprint },'),
    ).toEqual([]);
  });

  it("ne lit PAS les commentaires", () => {
    // Sans cela, expliquer la règle dans un commentaire la violerait, et le code deviendrait
    // impossible à documenter.
    expect(scan("// l’empreinte {run.baselineFingerprint} va au volet technique")).toEqual([]);
    expect(scan("/* {manifest.financialFingerprint} */")).toEqual([]);
  });
});

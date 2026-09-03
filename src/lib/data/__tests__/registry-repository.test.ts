import { describe, expect, it } from "vitest";

import { canonicalJson, hashPayload } from "@/lib/data/registry-repository";

/**
 * L'empreinte d'une réponse sert à comparer DEUX RÉPONSES, pas à horodater un appel. Elle
 * doit donc être stable pour un même contenu, quel que soit l'ordre dans lequel le
 * fournisseur a sérialisé ses clés — sans quoi chaque appel dirait « contenu différent » et
 * l'empreinte ne servirait à rien.
 */
describe("JSON canonique", () => {
  it("trie les clés à toute profondeur", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
  });

  it("préserve l'ordre des tableaux : un rang porte du sens", () => {
    expect(canonicalJson([3, 1, 2])).toBe("[3,1,2]");
  });

  it("distingue null, chaîne vide et zéro", () => {
    expect(canonicalJson({ a: null })).toBe('{"a":null}');
    expect(canonicalJson({ a: "" })).toBe('{"a":""}');
    expect(canonicalJson({ a: 0 })).toBe('{"a":0}');
  });

  it("ignore les clés absentes plutôt que de les sérialiser", () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}');
  });
});

describe("empreinte d'une réponse", () => {
  it("est identique pour deux ordres de clés du même contenu", () => {
    expect(hashPayload({ siren: "900000001", nom: "ALPHA" })).toBe(
      hashPayload({ nom: "ALPHA", siren: "900000001" }),
    );
  });

  it("diffère dès que le contenu diffère", () => {
    expect(hashPayload({ siren: "900000001" })).not.toBe(hashPayload({ siren: "900000019" }));
  });

  it("a la forme attendue par la contrainte de base", () => {
    expect(hashPayload({ a: 1 })).toMatch(/^[0-9a-f]{64}$/);
  });
});

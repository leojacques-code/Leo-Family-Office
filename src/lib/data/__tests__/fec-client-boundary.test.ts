import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * FRONTIÈRE NAVIGATEUR / SERVEUR DE L'ACQUISITION COMPTABLE.
 *
 * Ces contrôles portent sur le CODE lui-même, et c'est délibéré : la propriété à garantir
 * est structurelle, pas comportementale. « Le fichier ne traverse pas la fonction serveur »
 * et « la clé de service ne franchit pas la frontière » ne se testent pas par un appel — ils
 * se lisent, et une régression future les casserait en silence sans qu'aucun test de
 * comportement n'échoue.
 */
describe("frontière client · aucune clé de service, aucun dépôt artisanal", () => {
  const browser = readFileSync("src/lib/data/supabase-storage-browser.ts", "utf-8");
  const section = readFileSync("src/components/pages/imports/fec-section.tsx", "utf-8");
  const route = readFileSync("src/app/api/imports/fec/route.ts", "utf-8");

  it("le module navigateur n'emploie QUE la clé publiable", () => {
    expect(browser).toContain("NEXT_PUBLIC_SUPABASE_ANON_KEY");
    expect(browser).not.toContain("SUPABASE_SECRET_KEY");
    expect(browser).not.toContain("supabaseAdmin");
  });

  it("le dépôt passe par la primitive officielle, pas par un PUT assemblé à la main", () => {
    // Pour un `File`, `uploadToSignedUrl` construit un corps multipart/form-data que le
    // service attend. Un PUT du fichier brut n'est PAS équivalent.
    expect(browser).toContain("uploadToSignedUrl");
    expect(section).toContain("uploadToSignedStoragePath");
    expect(section).not.toMatch(/method:\s*"PUT"/);
  });

  it("le module navigateur ne touche QUE le stockage", () => {
    expect(browser).toContain("client.storage");
    expect(browser).not.toContain(".rpc(");
  });

  it("la route d'API ne lit AUCUN fichier", () => {
    // C'est la propriété qui rend la lecture à 150 000 lignes possible en production.
    expect(route).not.toContain("formData");
    expect(route).not.toContain("arrayBuffer");
  });

  it("le fichier ne remonte pas non plus à la VALIDATION", () => {
    // Le serveur reprend le contenu depuis l'objet de staging qu'il a lui-même écrit.
    expect(section).toContain("staging");
    expect(section).not.toContain("new FormData");
  });
});

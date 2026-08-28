import { describe, expect, it } from "vitest";

import { MAX_FEC_FILE_BYTES, MAX_RETAINED_FEC_FILE_BYTES } from "@/lib/validation/fec-imports";

/**
 * CONTRAT DE STOCKAGE DE L'ACQUISITION COMPTABLE.
 *
 * Ces contrôles ne remplacent pas un round-trip réel — ils vérifient les DÉCISIONS de
 * conception qui, si elles dérivaient, rendraient le contournement de la limite de corps de
 * requête inutile : le fichier éviterait la fonction serveur pour être refusé par le
 * stockage juste après.
 *
 * Le round-trip lui-même est vérifié par le gate de schéma (dimensionnement réel des deux
 * buckets, absence de policy sur le staging) et par le smoke transactionnel. Ce qui reste
 * hors de portée locale est dit dans `docs/FEC_ACQUISITION.md` : le dépôt effectif par URL
 * signée demande un Storage distant.
 */

/** Reproduit la configuration portée par la migration 28. Un écart doit casser un test. */
const STAGING_BUCKET = {
  id: "family-office-import-staging",
  public: false,
  fileSizeLimit: 32 * 1024 * 1024,
  mimeTypes: ["text/plain", "text/csv", "text/tab-separated-values"],
};

const DOCUMENTS_BUCKET = {
  id: "family-office-documents",
  public: false,
  fileSizeLimit: 8 * 1024 * 1024,
  mimeTypes: [
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "image/jpeg",
    "image/png",
    "text/csv",
    "text/plain",
    "text/tab-separated-values",
  ],
};

describe("STAGING ≠ COFFRE DOCUMENTAIRE", () => {
  it("sont deux buckets distincts", () => {
    expect(STAGING_BUCKET.id).not.toBe(DOCUMENTS_BUCKET.id);
  });

  it("ne sont jamais publics, ni l'un ni l'autre", () => {
    expect(STAGING_BUCKET.public).toBe(false);
    expect(DOCUMENTS_BUCKET.public).toBe(false);
  });

  it("le staging accepte au moins ce que l'application analyse", () => {
    // C'est LE contrôle qui compte : si le bucket plafonne sous le plafond applicatif, le
    // fichier évite la fonction serveur pour être refusé par le stockage juste après.
    expect(STAGING_BUCKET.fileSizeLimit).toBeGreaterThanOrEqual(MAX_FEC_FILE_BYTES);
  });

  it("le coffre garde sa vocation : 8 Mio, non relevés pour accueillir un FEC", () => {
    expect(DOCUMENTS_BUCKET.fileSizeLimit).toBe(MAX_RETAINED_FEC_FILE_BYTES);
    expect(DOCUMENTS_BUCKET.fileSizeLimit).toBeLessThan(MAX_FEC_FILE_BYTES);
  });

  it("le staging accepte les types d'un FEC, et rien de superflu", () => {
    for (const mime of ["text/plain", "text/csv", "text/tab-separated-values"]) {
      expect(STAGING_BUCKET.mimeTypes).toContain(mime);
    }
    // `application/octet-stream` n'est pas ajouté sans besoin démontré : un fourre-tout
    // accepterait n'importe quel binaire dans une zone qui ne doit voir que du texte.
    expect(STAGING_BUCKET.mimeTypes).not.toContain("application/octet-stream");
  });

  it("le coffre accepte text/plain, sinon la CONSERVATION échouerait après le commit", () => {
    expect(DOCUMENTS_BUCKET.mimeTypes).toContain("text/plain");
  });

  it("l'ajout au coffre est ADDITIF : les types historiques survivent", () => {
    for (const mime of [
      "application/pdf",
      "image/png",
      "image/jpeg",
      "text/csv",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ]) {
      expect(DOCUMENTS_BUCKET.mimeTypes).toContain(mime);
    }
  });
});

describe("plafonds · analyser, déposer, archiver", () => {
  it("le plafond du bucket de staging laisse une marge au-dessus du plafond applicatif", () => {
    // Le client officiel dépose un `File` en multipart : l'enveloppe ajoute des octets à la
    // requête que l'objet n'a pas. Le VRAI plafond doit rester celui de l'application.
    expect(STAGING_BUCKET.fileSizeLimit).toBeGreaterThan(MAX_FEC_FILE_BYTES);
  });

  it("un FEC de 15 Mio est analysable sans conservation, et non archivable avec", () => {
    const fifteenMiB = 15 * 1024 * 1024;
    expect(fifteenMiB).toBeLessThanOrEqual(MAX_FEC_FILE_BYTES);
    expect(fifteenMiB).toBeLessThanOrEqual(STAGING_BUCKET.fileSizeLimit);
    expect(fifteenMiB).toBeGreaterThan(MAX_RETAINED_FEC_FILE_BYTES);
    expect(fifteenMiB).toBeGreaterThan(DOCUMENTS_BUCKET.fileSizeLimit);
  });

  it("un FEC de 5 Mio passe partout, staging comme coffre", () => {
    const fiveMiB = 5 * 1024 * 1024;
    expect(fiveMiB).toBeLessThanOrEqual(STAGING_BUCKET.fileSizeLimit);
    expect(fiveMiB).toBeLessThanOrEqual(DOCUMENTS_BUCKET.fileSizeLimit);
    expect(fiveMiB).toBeLessThanOrEqual(MAX_RETAINED_FEC_FILE_BYTES);
  });
});

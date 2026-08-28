import { describe, expect, it } from "vitest";

import { MAX_FEC_LINES } from "@/lib/acquisition/fec";
import { PREVIEW_LINE_LIMIT } from "@/lib/data/fec-repository";
import {
  LEDGER_MAX_PAGES,
  LEDGER_PAGE_SIZE,
  LedgerTruncationError,
  pagesFor,
  readAllPages,
} from "@/lib/data/pagination";
import { readFileSync } from "node:fs";

/**
 * VOLUMÉTRIE DE LECTURE D'UN EXERCICE COMPTABLE.
 *
 * Le budget générique des ledgers — 20 pages de 1 000 lignes — est bon pour un ledger
 * bancaire. Il est absurde pour une comptabilité : un exercice de PME dépasse couramment
 * 20 000 lignes, et l'appliquer au FEC refusait la lecture de faits que l'application venait
 * elle-même d'accepter d'écrire.
 *
 * Deux lecteurs, deux budgets, et la distinction est la correction elle-même :
 *
 *     PREVIEW UI          →  300 lignes, bornées CÔTÉ BASE
 *     RECONSTRUCTION      →  l'exercice entier, jusqu'à 150 000 lignes
 *     BUDGET GÉNÉRIQUE    →  inchangé, 20 000 lignes
 */

const FEC_READ_PAGES = pagesFor(MAX_FEC_LINES, LEDGER_PAGE_SIZE);

/** Source paginée simulée, de taille exacte. Compte les pages réellement demandées. */
function source(totalRows: number) {
  const requested: Array<{ from: number; to: number }> = [];
  const fetchPage = async (from: number, to: number) => {
    requested.push({ from, to });
    const rows: number[] = [];
    for (let index = from; index <= Math.min(to, totalRows - 1); index += 1) rows.push(index);
    return { data: rows, error: null as null };
  };
  return { fetchPage, requested };
}

describe("budget de pages · une page de contrôle, jamais une marge de confort", () => {
  it("une source pleine au dernier octet exige une page supplémentaire pour se prouver complète", () => {
    // 150 000 lignes tiennent en 150 pages EXACTEMENT pleines : la boucle ne verrait jamais
    // de page incomplète, donc elle ne pourrait pas conclure, donc elle refuserait.
    expect(MAX_FEC_LINES / LEDGER_PAGE_SIZE).toBe(150);
    expect(FEC_READ_PAGES).toBe(151);
  });

  it("le budget générique des autres ledgers reste inchangé", () => {
    expect(LEDGER_MAX_PAGES).toBe(20);
    expect(LEDGER_PAGE_SIZE).toBe(1000);
    expect(LEDGER_MAX_PAGES * LEDGER_PAGE_SIZE).toBe(20_000);
  });

  it("le budget générique refuse toujours au-delà de 20 000 lignes", async () => {
    const { fetchPage } = source(20_000);
    await expect(readAllPages("ledger générique", fetchPage)).rejects.toBeInstanceOf(
      LedgerTruncationError,
    );
  });
});

describe("reconstruction canonique · l'exercice entier, ou rien", () => {
  it("lit 46 870 lignes complètement — le volume réel du test de bout en bout", async () => {
    const { fetchPage, requested } = source(46_870);
    const result = await readAllPages("écritures persistées", fetchPage, {
      maxPages: FEC_READ_PAGES,
      pageSize: LEDGER_PAGE_SIZE,
    });
    expect(result.error).toBeNull();
    expect(result.data).toHaveLength(46_870);
    // 46 pages pleines, puis une 47e incomplète qui prouve la fin.
    expect(requested).toHaveLength(47);
  });

  it("un exercice de 46 870 lignes ne lève PLUS d'erreur de troncature", async () => {
    const { fetchPage } = source(46_870);
    await expect(
      readAllPages("écritures persistées", fetchPage, {
        maxPages: FEC_READ_PAGES,
        pageSize: LEDGER_PAGE_SIZE,
      }),
    ).resolves.toBeTruthy();
    // Alors qu'avec le budget générique, il échouait : c'était exactement le bug.
    const generic = source(46_870);
    await expect(readAllPages("écritures persistées", generic.fetchPage)).rejects.toBeInstanceOf(
      LedgerTruncationError,
    );
  });

  it("lit EXACTEMENT 150 000 lignes, le cas limite", async () => {
    const { fetchPage, requested } = source(MAX_FEC_LINES);
    const result = await readAllPages("écritures persistées", fetchPage, {
      maxPages: FEC_READ_PAGES,
      pageSize: LEDGER_PAGE_SIZE,
    });
    expect(result.data).toHaveLength(MAX_FEC_LINES);
    // 150 pages pleines, puis la page de contrôle VIDE : c'est elle qui prouve la complétude.
    expect(requested).toHaveLength(151);
  });

  it("au-delà du budget FEC, la lecture est REFUSÉE, jamais tronquée en silence", async () => {
    const { fetchPage } = source(FEC_READ_PAGES * LEDGER_PAGE_SIZE);
    await expect(
      readAllPages("écritures persistées", fetchPage, {
        maxPages: FEC_READ_PAGES,
        pageSize: LEDGER_PAGE_SIZE,
      }),
    ).rejects.toBeInstanceOf(LedgerTruncationError);
  });
});

describe("preview · 300 lignes lues, pas 46 870", () => {
  const repository = readFileSync("src/lib/data/fec-repository.ts", "utf-8");
  const body = repository.slice(repository.indexOf("async function getSessionLines"));

  it("le lecteur d'affichage ne pagine PAS : il borne côté base", () => {
    // C'est la correction elle-même. Relire tout l'exercice pour en afficher 300 heurtait le
    // budget de pagination sur un fichier que l'application avait pourtant bien importé.
    expect(body).not.toContain("readAllPages");
    expect(body).toContain(".limit(limit)");
  });

  it("le plafond d'affichage est de 300 écritures", () => {
    expect(PREVIEW_LINE_LIMIT).toBe(300);
    expect(PREVIEW_LINE_LIMIT).toBeLessThan(LEDGER_PAGE_SIZE);
  });

  it("le preview lit les PREMIÈRES lignes du fichier, dans l'ordre du fichier", () => {
    // Le numéro de ligne vit sur le brut : c'est lui qu'on borne, par sa clé indexée.
    expect(body).toContain("import_raw_records");
    expect(body).toContain('.order("row_number", { ascending: true })');
  });

  it("la reconstruction canonique, elle, pagine avec le budget FEC", () => {
    const rebuild = repository.slice(
      repository.indexOf("async function rebuildStatement"),
      repository.indexOf("async function retainSessionFile"),
    );
    expect(rebuild).toContain("readAllPages");
    expect(rebuild).toContain("FEC_READ_PAGES");
  });
});

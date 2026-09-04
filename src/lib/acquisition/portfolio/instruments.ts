/**
 * RÉSOLUTION D'INSTRUMENT
 *
 * Fonctions pures. Elles rapprochent ce que la source écrit — un ISIN, un ticker, un libellé
 * — des instruments DÉJÀ connus, et s'arrêtent là.
 *
 * Trois refus, chacun une décision :
 *
 *   INSTRUMENT NON RÉSOLU ≠ INSTRUMENT NOUVEAU. Un ISIN qui ne correspond à rien peut être
 *   un instrument absent du référentiel, ou une faute de frappe. Le créer d'office peuplerait
 *   le référentiel de doublons silencieux, et les positions se répartiraient entre deux
 *   instruments qui sont le même. La ligne est donc BLOQUÉE jusqu'à décision humaine.
 *
 *   PLUSIEURS CANDIDATS ≠ LE PREMIER. Deux instruments du référentiel qui répondent au même
 *   libellé rendent le rapprochement ambigu ; en choisir un rattacherait des titres au
 *   mauvais. Aucun n'est retenu, et les deux sont montrés.
 *
 *   UN TICKER N'EST PAS UNE IDENTITÉ MONDIALE. Le même ticker désigne des sociétés
 *   différentes sur des places différentes. Il ne résout donc qu'à défaut d'ISIN, et le
 *   rapprochement qui en découle est signalé comme reposant sur un identifiant faible.
 */

import { issue } from "@/lib/acquisition/normalization";
import type { ImportIssue } from "@/lib/acquisition/types";

import type { InstrumentKey, InstrumentResolution } from "./types";

/** Instrument déjà connu, tel que le référentiel le porte. */
export interface KnownSecurity {
  securityId: string;
  name: string;
  isin: string | null;
  ticker: string | null;
  currency: string;
}

/** Forme comparable d'un ISIN : douze caractères alphanumériques, sans espaces. */
export function foldIsin(value: string | null): string | null {
  if (value === null) return null;
  const compact = value.replace(/[\s-]+/g, "").toUpperCase();
  return /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(compact) ? compact : null;
}

export function foldTicker(value: string | null): string | null {
  if (value === null) return null;
  const compact = value.trim().toUpperCase();
  return compact.length === 0 ? null : compact;
}

/** Forme comparable d'un libellé : sans accent, sans ponctuation, espaces compactés. */
export function foldName(value: string | null): string | null {
  if (value === null) return null;
  const folded = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
  return folded.length === 0 ? null : folded;
}

/**
 * Clé de source d'un instrument. Elle est STABLE DANS LE FICHIER : c'est elle qui porte la
 * décision de résolution, pour que toutes les lignes citant le même titre se résolvent
 * ensemble plutôt qu'une par une.
 *
 * Elle n'est jamais une identité entre deux fichiers : elle sert à regrouper, pas à prouver.
 */
export function instrumentSourceKey(key: InstrumentKey): string | null {
  const isin = foldIsin(key.isin);
  if (isin !== null) return `ISIN:${isin}`;
  const ticker = foldTicker(key.ticker);
  if (ticker !== null) return `TICKER:${ticker}`;
  const name = foldName(key.name);
  if (name !== null) return `NAME:${name}`;
  return null;
}

export interface ResolveInstrumentsInput {
  /** Clés rencontrées dans le fichier, dédupliquées par `instrumentSourceKey`. */
  keys: ReadonlyMap<string, InstrumentKey>;
  known: readonly KnownSecurity[];
  /**
   * Décisions déjà prises par l'utilisateur pour cette session, par clé de source. Elles
   * l'emportent sur toute inférence : une décision humaine ne se rejoue pas.
   */
  decisions?: ReadonlyMap<string, string | null>;
}

/**
 * Résout chaque clé rencontrée. Ne crée aucun instrument, n'en modifie aucun.
 */
export function resolveInstruments(input: ResolveInstrumentsInput): InstrumentResolution[] {
  const byIsin = new Map<string, KnownSecurity[]>();
  const byTicker = new Map<string, KnownSecurity[]>();
  const byName = new Map<string, KnownSecurity[]>();

  for (const security of input.known) {
    const isin = foldIsin(security.isin);
    if (isin !== null) byIsin.set(isin, [...(byIsin.get(isin) ?? []), security]);
    const ticker = foldTicker(security.ticker);
    if (ticker !== null) byTicker.set(ticker, [...(byTicker.get(ticker) ?? []), security]);
    const name = foldName(security.name);
    if (name !== null) byName.set(name, [...(byName.get(name) ?? []), security]);
  }

  const resolutions: InstrumentResolution[] = [];

  for (const [sourceKey, key] of input.keys) {
    const issues: ImportIssue[] = [];

    // Décision humaine : elle l'emporte, et elle est dite.
    const decided = input.decisions?.get(sourceKey);
    if (decided !== undefined) {
      if (decided === null) {
        resolutions.push({
          sourceKey,
          key,
          state: "UNRESOLVED",
          securityId: null,
          candidates: [],
          issues: [
            issue(
              "MAPPING_UNKNOWN_COLUMN",
              "ERROR",
              `Instrument « ${sourceKey} » écarté par décision explicite : les lignes qui le citent ne seront pas écrites`,
            ),
          ],
        });
        continue;
      }
      resolutions.push({
        sourceKey,
        key,
        state: "RESOLVED",
        securityId: decided,
        candidates: [],
        issues: [
          issue(
            "MAPPING_UNKNOWN_COLUMN",
            "INFO",
            `Instrument « ${sourceKey} » rattaché par décision explicite de l'utilisateur`,
          ),
        ],
      });
      continue;
    }

    const isin = foldIsin(key.isin);
    const ticker = foldTicker(key.ticker);
    const name = foldName(key.name);

    // ISIN d'abord : c'est le seul identifiant dont l'unicité est structurelle.
    if (isin !== null) {
      const matches = byIsin.get(isin) ?? [];
      if (matches.length === 1) {
        resolutions.push({
          sourceKey,
          key,
          state: "RESOLVED",
          securityId: matches[0].securityId,
          candidates: candidatesOf(matches, "ISIN"),
          issues,
        });
        continue;
      }
      if (matches.length > 1) {
        resolutions.push({
          sourceKey,
          key,
          state: "AMBIGUOUS",
          securityId: null,
          candidates: candidatesOf(matches, "ISIN"),
          issues: [
            issue(
              "MAPPING_AMBIGUOUS",
              "ERROR",
              `${matches.length} instruments du référentiel portent l'ISIN ${isin} : aucun n'est retenu, choisissez-en un`,
            ),
          ],
        });
        continue;
      }
      // ISIN valide mais inconnu : ce n'est pas un instrument nouveau, c'est un instrument
      // à rattacher ou à créer sur décision.
      resolutions.push({
        sourceKey,
        key,
        state: "UNRESOLVED",
        securityId: null,
        candidates: [],
        issues: [
          issue(
            "MAPPING_UNKNOWN_COLUMN",
            "ERROR",
            `ISIN ${isin} absent du référentiel. Il n'est PAS créé d'office : rattachez-le à un instrument existant ou créez-le explicitement, sans quoi les mêmes titres se répartiraient entre deux instruments`,
            "isin",
            key.isin,
          ),
        ],
      });
      continue;
    }

    if (key.isin !== null && key.isin.trim().length > 0) {
      // Une chaîne présente qui n'est pas un ISIN valide : le dire vaut mieux que de
      // basculer en silence sur le ticker.
      issues.push(
        issue(
          "MAPPING_UNKNOWN_COLUMN",
          "WARNING",
          `« ${key.isin} » n'a pas la forme d'un ISIN : la résolution se rabat sur les autres identifiants, plus faibles`,
          "isin",
          key.isin,
        ),
      );
    }

    if (ticker !== null) {
      const matches = byTicker.get(ticker) ?? [];
      if (matches.length === 1) {
        resolutions.push({
          sourceKey,
          key,
          state: "RESOLVED",
          securityId: matches[0].securityId,
          candidates: candidatesOf(matches, "TICKER"),
          issues: [
            ...issues,
            issue(
              "MAPPING_UNKNOWN_COLUMN",
              "WARNING",
              `Instrument rapproché par son ticker « ${ticker} », faute d'ISIN. Un même ticker désigne des sociétés différentes selon la place : vérifiez le rattachement`,
              "ticker",
            ),
          ],
        });
        continue;
      }
      if (matches.length > 1) {
        resolutions.push({
          sourceKey,
          key,
          state: "AMBIGUOUS",
          securityId: null,
          candidates: candidatesOf(matches, "TICKER"),
          issues: [
            ...issues,
            issue(
              "MAPPING_AMBIGUOUS",
              "ERROR",
              `${matches.length} instruments portent le ticker « ${ticker} » : aucun n'est retenu`,
            ),
          ],
        });
        continue;
      }
    }

    if (name !== null) {
      const matches = byName.get(name) ?? [];
      if (matches.length === 1) {
        resolutions.push({
          sourceKey,
          key,
          state: "RESOLVED",
          securityId: matches[0].securityId,
          candidates: candidatesOf(matches, "NAME"),
          issues: [
            ...issues,
            issue(
              "MAPPING_UNKNOWN_COLUMN",
              "WARNING",
              `Instrument rapproché par son seul libellé « ${key.name} ». Un libellé n'est pas un identifiant : vérifiez le rattachement`,
              "instrumentName",
            ),
          ],
        });
        continue;
      }
      if (matches.length > 1) {
        resolutions.push({
          sourceKey,
          key,
          state: "AMBIGUOUS",
          securityId: null,
          candidates: candidatesOf(matches, "NAME"),
          issues: [
            ...issues,
            issue(
              "MAPPING_AMBIGUOUS",
              "ERROR",
              `${matches.length} instruments répondent au libellé « ${key.name} » : aucun n'est retenu`,
            ),
          ],
        });
        continue;
      }
    }

    resolutions.push({
      sourceKey,
      key,
      state: "UNRESOLVED",
      securityId: null,
      candidates: [],
      issues: [
        ...issues,
        issue(
          "MAPPING_UNKNOWN_COLUMN",
          "ERROR",
          `Aucun instrument du référentiel ne correspond à « ${sourceKey} ». Il n'est pas créé d'office : la décision est explicite`,
        ),
      ],
    });
  }

  return resolutions;
}

function candidatesOf(
  matches: readonly KnownSecurity[],
  basis: string,
): InstrumentResolution["candidates"] {
  return matches.map((match) => ({
    securityId: match.securityId,
    name: match.name,
    isin: match.isin,
    ticker: match.ticker,
    basis,
  }));
}

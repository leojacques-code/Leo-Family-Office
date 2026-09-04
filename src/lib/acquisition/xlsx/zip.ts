/**
 * LECTEUR ZIP MINIMAL
 *
 * Un fichier XLSX est une archive ZIP de documents XML. Ce module l'ouvre, et rien d'autre :
 * il ne suit aucun lien, n'exécute rien, ne résout aucune entité externe.
 *
 * Aucune dépendance ajoutée, et c'est un choix : les bibliothèques de tableur généralistes
 * évaluent les formules, suivent les liens externes et acceptent des classeurs porteurs de
 * macros. Ce dépôt a besoin de l'inverse — lire des valeurs et REFUSER tout le reste — donc
 * la surface d'attaque est réduite à ce fichier, dont on peut vérifier qu'il ne fait
 * qu'inflater des octets.
 *
 * Le module ne lève jamais : une archive illisible est un RÉSULTAT nommé.
 */

import { inflateRawSync } from "node:zlib";

/** Signature de fin de répertoire central. */
const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;

/** Méthodes de compression acceptées : aucune autre n'est tentée. */
const STORED = 0;
const DEFLATED = 8;

/**
 * Plafond de taille APRÈS décompression, par entrée. Une archive de quelques kilooctets
 * peut déclarer une entrée de plusieurs gigaoctets : sans ce plafond, ouvrir un fichier
 * suffirait à épuiser la mémoire du serveur.
 */
export const MAX_ENTRY_BYTES = 64 * 1024 * 1024;

/**
 * Budget GLOBAL d'octets décompressés, toutes entrées confondues.
 *
 * Le plafond par entrée ne suffisait pas : avec 4 096 entrées à 64 Mio, une archive de
 * quelques kilo-octets pouvait réclamer 256 Gio de mémoire. C'est le schéma classique d'une
 * archive piégée, et le plafond par entrée ne le voit jamais passer.
 *
 * Le budget est STRICT et il REFUSE : une lecture partielle d'un classeur produirait des
 * feuilles manquantes sans le dire, et un import muet d'une partie du portefeuille est pire
 * qu'un refus. Chaque entrée décompressée est bornée par ce qui RESTE du budget, jamais par
 * le plafond nominal.
 */
export const MAX_TOTAL_INFLATED_BYTES = 64 * 1024 * 1024;

/** Plafond du nombre d'entrées. Une archive à cent mille entrées n'est pas un classeur. */
export const MAX_ENTRIES = 4096;

export type ZipFailureCode =
  | "NOT_A_ZIP"
  | "TRUNCATED"
  | "TOO_MANY_ENTRIES"
  | "TOTAL_TOO_LARGE"
  | "ENTRY_TOO_LARGE"
  | "UNSUPPORTED_COMPRESSION"
  | "INFLATE_FAILED";

export interface ZipEntry {
  /** Nom exactement tel qu'il figure dans l'archive. */
  name: string;
  /** Contenu décompressé. */
  bytes: Uint8Array;
  compression: number;
}

export interface ZipArchive {
  ok: true;
  entries: Map<string, ZipEntry>;
  /** Noms rencontrés mais NON extraits, avec le motif. Rien ne disparaît en silence. */
  skipped: Array<{ name: string; reason: ZipFailureCode }>;
}

export interface ZipFailure {
  ok: false;
  code: ZipFailureCode;
  message: string;
}

function u16(view: DataView, offset: number): number {
  return view.getUint16(offset, true);
}

function u32(view: DataView, offset: number): number {
  return view.getUint32(offset, true);
}

/** Trouve la fin du répertoire central, en remontant depuis la fin. */
function findEocd(view: DataView): number {
  // Le commentaire d'archive fait au plus 65 535 octets : au-delà, ce n'est pas un ZIP.
  const minimum = Math.max(0, view.byteLength - 0xffff - 22);
  for (let offset = view.byteLength - 22; offset >= minimum; offset -= 1) {
    if (u32(view, offset) === EOCD_SIGNATURE) return offset;
  }
  return -1;
}

/**
 * Ouvre une archive. Le répertoire CENTRAL est la source de vérité, pas les en-têtes
 * locaux : un ZIP peut déclarer deux tailles différentes pour la même entrée, et n'utiliser
 * que l'en-tête local laisserait passer une divergence.
 */
export function openZip(bytes: Uint8Array): ZipArchive | ZipFailure {
  if (bytes.byteLength < 22) {
    return { ok: false, code: "NOT_A_ZIP", message: "Fichier trop court pour être une archive" };
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = findEocd(view);
  if (eocd < 0) {
    return {
      ok: false,
      code: "NOT_A_ZIP",
      message: "Aucune fin de répertoire central trouvée : ce n'est pas un fichier XLSX",
    };
  }

  const entryCount = u16(view, eocd + 10);
  if (entryCount > MAX_ENTRIES) {
    return {
      ok: false,
      code: "TOO_MANY_ENTRIES",
      message: `${entryCount} entrées dans l'archive, plafond ${MAX_ENTRIES} : ce n'est pas un classeur`,
    };
  }

  let cursor = u32(view, eocd + 16);
  const entries = new Map<string, ZipEntry>();
  const skipped: Array<{ name: string; reason: ZipFailureCode }> = [];
  // Budget consommé, entrées STOCKÉES comprises : une entrée non compressée occupe la même
  // mémoire qu'une entrée décompressée, et l'exclure du décompte laisserait le trou ouvert.
  let inflatedBytes = 0;

  for (let index = 0; index < entryCount; index += 1) {
    if (cursor + 46 > bytes.byteLength || u32(view, cursor) !== CENTRAL_SIGNATURE) {
      return {
        ok: false,
        code: "TRUNCATED",
        message: `Répertoire central interrompu à l'entrée ${index + 1}`,
      };
    }
    const compression = u16(view, cursor + 10);
    const compressedSize = u32(view, cursor + 20);
    const uncompressedSize = u32(view, cursor + 24);
    const nameLength = u16(view, cursor + 28);
    const extraLength = u16(view, cursor + 30);
    const commentLength = u16(view, cursor + 32);
    const localOffset = u32(view, cursor + 42);
    const name = new TextDecoder("utf-8").decode(
      bytes.subarray(cursor + 46, cursor + 46 + nameLength),
    );
    cursor += 46 + nameLength + extraLength + commentLength;

    // Un répertoire ne porte pas de contenu.
    if (name.endsWith("/")) continue;

    if (uncompressedSize > MAX_ENTRY_BYTES) {
      skipped.push({ name, reason: "ENTRY_TOO_LARGE" });
      continue;
    }
    if (compression !== STORED && compression !== DEFLATED) {
      skipped.push({ name, reason: "UNSUPPORTED_COMPRESSION" });
      continue;
    }

    // En-tête local : on ne s'en sert que pour trouver où commencent les données.
    if (localOffset + 30 > bytes.byteLength) {
      return { ok: false, code: "TRUNCATED", message: `En-tête local hors limites pour ${name}` };
    }
    const localNameLength = u16(view, localOffset + 26);
    const localExtraLength = u16(view, localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > bytes.byteLength) {
      return { ok: false, code: "TRUNCATED", message: `Données tronquées pour ${name}` };
    }

    const remaining = MAX_TOTAL_INFLATED_BYTES - inflatedBytes;
    if (remaining <= 0 || uncompressedSize > remaining) {
      // REFUS, pas un saut : au-delà du budget, le classeur ne peut plus être lu en entier,
      // et une lecture partielle tairait des feuilles.
      return {
        ok: false,
        code: "TOTAL_TOO_LARGE",
        message:
          `Budget global de décompression dépassé à l'entrée « ${name} » : ` +
          `${inflatedBytes} octets déjà extraits, plafond ${MAX_TOTAL_INFLATED_BYTES}. ` +
          "Le classeur est refusé, jamais lu partiellement",
      };
    }

    const raw = bytes.subarray(dataStart, dataEnd);
    if (compression === STORED) {
      entries.set(name, { name, bytes: raw, compression });
      inflatedBytes += raw.byteLength;
      continue;
    }
    try {
      // La borne est le RESTE du budget, jamais le plafond nominal : c'est ce qui empêche
      // une seule entrée de le consommer entièrement au détriment des suivantes.
      const inflated = inflateRawSync(raw, {
        maxOutputLength: Math.min(MAX_ENTRY_BYTES, remaining),
      });
      entries.set(name, { name, bytes: new Uint8Array(inflated), compression });
      inflatedBytes += inflated.byteLength;
    } catch {
      // Une entrée illisible n'est pas une entrée vide : elle est signalée et absente.
      skipped.push({ name, reason: "INFLATE_FAILED" });
    }
  }

  return { ok: true, entries, skipped };
}

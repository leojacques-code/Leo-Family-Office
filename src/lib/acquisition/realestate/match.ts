/**
 * RAPPROCHEMENT BIEN DÉTENU ↔ DONNÉE PUBLIQUE
 *
 * Fonctions pures. Elles produisent une PROPOSITION avec sa base nommée, jamais une décision.
 *
 * La règle qui gouverne tout le fichier : L'IDENTITÉ SE DÉMONTRE. Une adresse identique
 * désigne un immeuble, et un immeuble contient des lots. Le meilleur score possible reste
 * donc une ressemblance, et la confiance rendue ici ne dépasse jamais MEDIUM pour un DPE
 * tant que rien ne distingue le lot. Le déclarer HIGH inviterait à accepter d'un clic un
 * diagnostic qui appartient au voisin, et l'étiquette énergétique d'un bien détenu serait
 * fausse sans que rien ne le signale.
 */

import {
  compareAddresses,
  normalizeAddress,
  type AddressComparison,
} from "@/lib/acquisition/address";

import type { EnergyCertificateCandidate, PublicDataIssue } from "./types";
import { publicDataIssue } from "./types";

/** Nombre minimal de critères connus sous lequel un score ne veut rien dire. */
export const MIN_KNOWN_CRITERIA = 3;

/** Confiance d'un rapprochement. Elle n'est jamais HIGH sur une seule adresse. */
export type MatchConfidence = "HIGH" | "MEDIUM" | "LOW";

export interface MatchProposal {
  /** Base NOMMÉE, telle qu'elle sera persistée dans `match_basis` et affichée. */
  basis: Record<string, unknown>;
  /** Score sur les critères connus, ou `null` quand aucun ne l'est. */
  score: number | null;
  confidence: MatchConfidence;
  /** Ce qui empêche d'aller plus loin, dit en clair à l'utilisateur. */
  issues: PublicDataIssue[];
}

function basisFromComparison(comparison: AddressComparison): Record<string, unknown> {
  return {
    kind: "ADDRESS",
    score: comparison.score,
    knownCriteria: comparison.knownCount,
    criteria: comparison.criteria.map((criterion) => ({
      name: criterion.name,
      verdict: criterion.verdict,
      detail: criterion.detail,
    })),
  };
}

/**
 * Propose le rapprochement d'un DPE avec un bien, sur la seule information disponible :
 * l'adresse déclarée du bien et l'adresse imprimée du diagnostic.
 *
 * Plafond de confiance à MEDIUM, et ce n'est pas de la prudence décorative : sans référence
 * de lot, ni étage, ni surface concordante, deux appartements du même palier sont
 * indiscernables. Une surface concordante fait monter la confiance sans jamais la porter à
 * HIGH : deux lots identiques dans un immeuble existent.
 */
export function proposeCertificateMatch(input: {
  propertyLocation: string | null;
  propertySurfaceSqm: number | null;
  certificate: EnergyCertificateCandidate;
}): MatchProposal {
  const issues: PublicDataIssue[] = [];
  const left = normalizeAddress(input.propertyLocation);
  const right = normalizeAddress(input.certificate.addressLabel);
  const comparison = compareAddresses(left, right);
  const basis = basisFromComparison(comparison);

  if (input.propertyLocation === null || input.propertyLocation.trim() === "") {
    issues.push(
      publicDataIssue(
        "FIELD_MISSING",
        "ERROR",
        input.certificate.rowIndex,
        "properties.location",
        "Le bien ne porte aucune adresse déclarée : aucun rapprochement d'adresse n'est possible, et il ne s'invente pas",
      ),
    );
    return { basis, score: null, confidence: "LOW", issues };
  }
  if (input.certificate.addressLabel === null) {
    issues.push(
      publicDataIssue(
        "FIELD_MISSING",
        "ERROR",
        input.certificate.rowIndex,
        "adresse",
        "Le diagnostic ne porte aucune adresse lisible : il ne peut être rapproché de rien",
      ),
    );
    return { basis, score: null, confidence: "LOW", issues };
  }

  // Une surface concordante est un critère SUPPLÉMENTAIRE, ajouté à la base pour être
  // relisible. Il ne remplace pas l'identification du lot, il la resserre.
  let surfaceVerdict: "MATCH" | "MISMATCH" | "UNKNOWN" = "UNKNOWN";
  if (input.propertySurfaceSqm !== null && input.certificate.livingAreaSqm !== null) {
    const delta = Math.abs(input.propertySurfaceSqm - input.certificate.livingAreaSqm);
    const tolerance = Math.max(2, input.propertySurfaceSqm * 0.05);
    surfaceVerdict = delta <= tolerance ? "MATCH" : "MISMATCH";
  }
  basis.surface = {
    verdict: surfaceVerdict,
    property: input.propertySurfaceSqm,
    certificate: input.certificate.livingAreaSqm,
    detail:
      surfaceVerdict === "UNKNOWN"
        ? "Surface non comparable : elle manque d'un côté au moins, et une surface absente ne vaut pas zéro"
        : surfaceVerdict === "MATCH"
          ? "Surfaces concordantes à 5 % près"
          : "Surfaces discordantes : le diagnostic porte probablement sur un autre lot",
  };

  if (comparison.score === null || comparison.knownCount < MIN_KNOWN_CRITERIA) {
    issues.push(
      publicDataIssue(
        "FIELD_MISSING",
        "WARNING",
        input.certificate.rowIndex,
        null,
        `Seuls ${comparison.knownCount} critère(s) d'adresse sont connus : un score sur si peu de critères ne démontre rien`,
      ),
    );
    return { basis, score: comparison.score, confidence: "LOW", issues };
  }

  if (comparison.hasMismatch) {
    issues.push(
      publicDataIssue(
        "RECORD_SKIPPED",
        "WARNING",
        input.certificate.rowIndex,
        null,
        `Au moins un critère d'adresse est en désaccord franc : ${comparison.criteria
          .filter((criterion) => criterion.verdict === "MISMATCH")
          .map((criterion) => criterion.detail)
          .join(" ; ")}`,
      ),
    );
    return { basis, score: comparison.score, confidence: "LOW", issues };
  }

  if (surfaceVerdict === "MISMATCH") {
    issues.push(
      publicDataIssue(
        "RECORD_SKIPPED",
        "WARNING",
        input.certificate.rowIndex,
        "surface",
        "Adresse concordante mais surface discordante : c'est le signe d'un autre lot du même immeuble",
      ),
    );
    return { basis, score: comparison.score, confidence: "LOW", issues };
  }

  // ADRESSE ÉGALE ≠ BIEN IDENTIQUE : le plafond est structurel, pas conservateur.
  issues.push(
    publicDataIssue(
      "RECORD_SKIPPED",
      "INFO",
      input.certificate.rowIndex,
      null,
      "Confiance plafonnée à MEDIUM : une adresse désigne un immeuble, et un immeuble porte autant de diagnostics que de lots. L'acceptation reste une décision humaine",
    ),
  );
  return {
    basis,
    score: comparison.score,
    confidence: surfaceVerdict === "MATCH" ? "MEDIUM" : "LOW",
    issues,
  };
}

/**
 * Propose le rapprochement d'un jeu de comparables avec un bien.
 *
 * L'unité n'est pas la mutation mais l'INSTANTANÉ : rapprocher mutation par mutation
 * laisserait croire qu'une vente voisine est « la vente de mon bien ». La base du
 * rapprochement est donc géographique et déclarée à ce niveau.
 */
export function proposeComparableSetMatch(input: {
  propertyLocation: string | null;
  propertySurfaceSqm: number | null;
  /** Repère géographique effectivement interrogé. */
  queriedCommuneCode: string | null;
  queriedPostalCode: string | null;
  saleCount: number;
  usableSaleCount: number;
}): MatchProposal {
  const issues: PublicDataIssue[] = [];
  const property = normalizeAddress(input.propertyLocation);

  const geoVerdict =
    input.queriedCommuneCode === null && input.queriedPostalCode === null
      ? "UNKNOWN"
      : property.postalCode !== null && input.queriedPostalCode !== null
        ? property.postalCode === input.queriedPostalCode
          ? "MATCH"
          : "MISMATCH"
        : "UNKNOWN";

  const basis: Record<string, unknown> = {
    kind: "COMPARABLE_SET",
    geo: {
      verdict: geoVerdict,
      propertyPostalCode: property.postalCode,
      queriedPostalCode: input.queriedPostalCode,
      queriedCommuneCode: input.queriedCommuneCode,
      detail:
        geoVerdict === "MATCH"
          ? "Le code postal du bien correspond à la zone interrogée"
          : geoVerdict === "MISMATCH"
            ? "Le code postal du bien diffère de la zone interrogée : le jeu ne décrit pas son marché"
            : "Zone non comparable au bien : l'un des deux repères manque",
    },
    // Le nombre exploitable est le seul qui compte : les mutations sans surface et les
    // multi-lots ne portent aucun prix unitaire.
    saleCount: input.saleCount,
    usableSaleCount: input.usableSaleCount,
    propertySurfaceSqm: input.propertySurfaceSqm,
  };

  if (geoVerdict === "MISMATCH") {
    issues.push(
      publicDataIssue(
        "RECORD_SKIPPED",
        "ERROR",
        null,
        null,
        "Zone interrogée hors du code postal du bien : ce jeu ne décrit pas son marché, et l'accepter fonderait une estimation sur d'autres communes",
      ),
    );
    return { basis, score: 0, confidence: "LOW", issues };
  }

  if (input.propertySurfaceSqm === null) {
    issues.push(
      publicDataIssue(
        "FIELD_MISSING",
        "WARNING",
        null,
        "properties.surface_sqm",
        "Surface du bien non déclarée : le jeu peut être rattaché, mais aucune estimation au mètre carré n'en sera calculable. Une surface absente ne vaut pas zéro",
      ),
    );
  }

  if (input.usableSaleCount === 0) {
    issues.push(
      publicDataIssue(
        "AMOUNT_NOT_COMPARABLE",
        "ERROR",
        null,
        null,
        "Aucune mutation exploitable : sans surface bâtie ni prix sur un lot unique, il n'y a pas de prix au mètre carré à comparer",
      ),
    );
    return { basis, score: geoVerdict === "MATCH" ? 1 : null, confidence: "LOW", issues };
  }

  return {
    basis,
    score: geoVerdict === "MATCH" ? 1 : null,
    // Un jeu de comparables rattaché à la bonne zone reste un jeu de ventes d'autrui : la
    // confiance porte sur la PERTINENCE de la zone, jamais sur l'identité d'un bien.
    confidence: geoVerdict === "MATCH" && input.usableSaleCount >= 5 ? "MEDIUM" : "LOW",
    issues,
  };
}

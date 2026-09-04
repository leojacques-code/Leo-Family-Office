/**
 * DÉTECTION — de quel document parle-t-on, et de quel exercice ?
 *
 * Fonctions pures. Rien n'est déduit du NOM du fichier : « liasse.pdf » ne dit rien, et
 * « 2050.pdf » peut contenir autre chose. Tout vient du CONTENU, et chaque rapprochement
 * conserve la chaîne qui l'a produit — sans cette preuve, « c'est une 2050 » est une
 * affirmation invérifiable.
 */

import { readSiren } from "../../siren";
import { detectDateConvention, readFrenchDate, type DateConvention } from "../numbers";
import { foldLabel, pageText, type PdfTextLayer } from "../text-layer";
import { documentIssue, type DetectionEvidence, type DocumentIssue } from "../types";
import { FORM_ANCHORS, type LiasseRegime } from "./spec";

export interface LiasseDetection {
  /** Formulaire reconnu pour chaque page. Absence = page non reconnue, toujours lue. */
  formByPage: Map<number, string>;
  regime: LiasseRegime | null;
  /** Exercice de clôture retenu comme millésime, quand il est lisible. */
  variant: string | null;
  evidence: DetectionEvidence[];
  siren: string | null;
  fiscalYearStart: string | null;
  fiscalYearEnd: string | null;
  dateConvention: DateConvention;
  issues: DocumentIssue[];
}

/** Formulaire reconnu sur une page, avec la chaîne qui l'a permis. */
function detectForm(
  text: string,
): { formCode: string; regime: LiasseRegime; matched: string } | null {
  const folded = foldLabel(text);
  // Les formulaires à lettre (2033-A, 2058-B) sont testés AVANT les formulaires simples :
  // le motif `\b2033\b` ne s'appliquerait pas à « 2033-A », mais l'ordre garantit qu'une
  // page portant les deux numéros retient le plus précis.
  const ordered = [...FORM_ANCHORS].sort(
    (left, right) => right.formCode.length - left.formCode.length,
  );
  for (const anchor of ordered) {
    for (const pattern of anchor.patterns) {
      const match = pattern.exec(folded);
      if (match !== null) {
        return { formCode: anchor.formCode, regime: anchor.regime, matched: match[0] };
      }
    }
  }
  return null;
}

/**
 * Cherche le SIREN dans les premières pages.
 *
 * Deux règles, et la seconde compte davantage que la première :
 *
 *   1. un groupe de neuf chiffres précédé de « SIREN » est retenu en priorité ;
 *   2. si plusieurs SIREN DIFFÉRENTS apparaissent, aucun n'est retenu. Une liasse peut citer
 *      la société ET son expert-comptable, ou une filiale sur son tableau de participations :
 *      choisir « le premier » rattacherait la comptabilité d'une société à une autre.
 */
function detectSiren(texts: readonly string[], issues: DocumentIssue[]): string | null {
  const labelled = new Set<string>();
  const bare = new Set<string>();

  for (const text of texts) {
    const folded = foldLabel(text);
    for (const match of folded.matchAll(/SIREN[^0-9]{0,12}(\d{3}[\s.]?\d{3}[\s.]?\d{3})\b/g)) {
      const reading = readSiren(match[1]);
      if (reading.value !== null) labelled.add(reading.value);
    }
    for (const match of folded.matchAll(
      /SIRET[^0-9]{0,12}(\d{3}[\s.]?\d{3}[\s.]?\d{3})[\s.]?\d{5}\b/g,
    )) {
      const reading = readSiren(match[1]);
      if (reading.value !== null) labelled.add(reading.value);
    }
    for (const match of folded.matchAll(/\b(\d{3}[\s.]\d{3}[\s.]\d{3})\b/g)) {
      const reading = readSiren(match[1]);
      if (reading.value !== null) bare.add(reading.value);
    }
  }

  const candidates = labelled.size > 0 ? labelled : bare;
  if (candidates.size === 0) {
    issues.push(
      documentIssue(
        "SIREN_NOT_FOUND",
        "WARNING",
        null,
        null,
        null,
        "Aucun SIREN lisible dans le document : l'identité de la société n'est pas démontrée par la liasse elle-même",
      ),
    );
    return null;
  }
  if (candidates.size > 1) {
    issues.push(
      documentIssue(
        "MULTIPLE_SIREN_FOUND",
        "ERROR",
        null,
        null,
        [...candidates].join(", "),
        `Plusieurs SIREN différents dans le document (${[...candidates].join(", ")}) : aucun n'est retenu. En choisir un rattacherait la comptabilité d'une société à une autre`,
      ),
    );
    return null;
  }

  const siren = [...candidates][0];
  const reading = readSiren(siren);
  if (reading.checksumValid === false) {
    issues.push(
      documentIssue(
        "SIREN_CHECKSUM_FAILED",
        "WARNING",
        null,
        null,
        siren,
        "Clé de contrôle du SIREN non vérifiée. Des identifiants réellement attribués y échouent : la valeur est conservée et signalée",
      ),
    );
  }
  return siren;
}

/**
 * Cherche les bornes de l'exercice.
 *
 * Trois formes d'énoncé sont cherchées, dans cet ordre de précision :
 *
 *   1. « du JJ/MM/AAAA au JJ/MM/AAAA » — la plus explicite, elle donne les deux bornes ;
 *   2. « clos le JJ/MM/AAAA » — elle donne la clôture, et rien d'autre. La date d'ouverture
 *      n'est PAS reconstituée en retirant un an : un exercice de dix-huit mois existe, et le
 *      supposer de douze produirait une période fausse d'apparence normale ;
 *   3. « exercice AAAA » — elle ne donne qu'un millésime, pas une date. Aucune borne n'en est
 *      tirée.
 */
function detectFiscalYear(
  texts: readonly string[],
  convention: DateConvention,
  issues: DocumentIssue[],
): { start: string | null; end: string | null; variant: string | null } {
  let start: string | null = null;
  let end: string | null = null;

  for (const text of texts) {
    const folded = foldLabel(text);

    const range =
      /DU\s+(\d{1,2}[/.\-]\d{1,2}[/.\-]\d{4})\s+AU\s+(\d{1,2}[/.\-]\d{1,2}[/.\-]\d{4})/.exec(
        folded,
      );
    if (range !== null) {
      const from = readFrenchDate(range[1], convention);
      const to = readFrenchDate(range[2], convention);
      if (from.ambiguous || to.ambiguous) {
        issues.push(
          documentIssue(
            "FISCAL_YEAR_AMBIGUOUS_DATE",
            "ERROR",
            null,
            null,
            range[0],
            `Ordre jour/mois indécidable sur « ${range[0]} » : l'exercice n'est pas retenu. Une date inversée déplacerait la clôture de plusieurs mois`,
          ),
        );
      } else if (from.iso !== null && to.iso !== null && to.iso >= from.iso) {
        start = from.iso;
        end = to.iso;
        break;
      }
    }

    const closing = /CLOS(?:E|URE)?\s+(?:LE\s+)?(\d{1,2}[/.\-]\d{1,2}[/.\-]\d{4})/.exec(folded);
    if (closing !== null && end === null) {
      const to = readFrenchDate(closing[1], convention);
      if (to.ambiguous) {
        issues.push(
          documentIssue(
            "FISCAL_YEAR_AMBIGUOUS_DATE",
            "ERROR",
            null,
            null,
            closing[0],
            `Ordre jour/mois indécidable sur « ${closing[0]} » : la clôture n'est pas retenue`,
          ),
        );
      } else if (to.iso !== null) {
        end = to.iso;
      }
    }
  }

  if (end === null) {
    issues.push(
      documentIssue(
        "FISCAL_YEAR_NOT_FOUND",
        "ERROR",
        null,
        null,
        null,
        "Aucune date de clôture lisible : un instantané financier sans exercice démontré ne sera pas écrit",
      ),
    );
  }

  return { start, end, variant: end === null ? null : end.slice(0, 4) };
}

export function detectLiasse(layer: PdfTextLayer): LiasseDetection {
  const issues: DocumentIssue[] = [];
  const evidence: DetectionEvidence[] = [];
  const formByPage = new Map<number, string>();
  const regimes = new Set<LiasseRegime>();

  const texts = layer.pages.map((page) => pageText(page));

  texts.forEach((text, index) => {
    const page = layer.pages[index].pageNumber;
    const found = detectForm(text);
    if (found === null) return;
    formByPage.set(page, found.formCode);
    regimes.add(found.regime);
    evidence.push({ page, matched: found.matched, kind: found.formCode });
  });

  if (formByPage.size === 0) {
    issues.push(
      documentIssue(
        "FORM_NOT_RECOGNISED",
        "WARNING",
        null,
        null,
        null,
        "Aucun formulaire de liasse reconnu dans le contenu. Les cases restent extraites et lisibles, mais aucun contrôle inter-formulaires n'est possible",
      ),
    );
  }

  // Un document portant les DEUX régimes n'est pas une erreur de lecture : une entreprise
  // peut changer de régime, et une archive peut réunir deux exercices. Le signaler suffit ;
  // l'écarter perdrait un document valide.
  const regime: LiasseRegime | null =
    regimes.size === 0
      ? null
      : regimes.size > 1
        ? "LIASSE_MIXED"
        : ([...regimes][0] as LiasseRegime);

  if (regime === "LIASSE_MIXED") {
    issues.push(
      documentIssue(
        "FORM_VARIANT_NOT_RECOGNISED",
        "WARNING",
        null,
        null,
        [...regimes].join(", "),
        "Le document réunit des formulaires des deux régimes. Chaque page est lue avec la numérotation de son propre formulaire",
      ),
    );
  }

  // La convention de date est tranchée sur le DOCUMENT ENTIER, pas date par date.
  const dateConvention = detectDateConvention(texts);
  if (dateConvention === "UNDECIDED") {
    issues.push(
      documentIssue(
        "FISCAL_YEAR_AMBIGUOUS_DATE",
        "INFO",
        null,
        null,
        null,
        "Aucune date du document ne tranche l'ordre jour/mois. L'ordre français est retenu, comme le prévoit le formulaire — c'est une déclaration, pas une déduction",
      ),
    );
  }

  const siren = detectSiren(texts, issues);
  const fiscal = detectFiscalYear(texts, dateConvention, issues);

  return {
    formByPage,
    regime,
    variant: fiscal.variant,
    evidence,
    siren,
    fiscalYearStart: fiscal.start,
    fiscalYearEnd: fiscal.end,
    dateConvention,
    issues,
  };
}

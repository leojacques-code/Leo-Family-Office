/**
 * CONTRATS DE L'IMPORT DE PORTEFEUILLE
 *
 * Ce que le client REÇOIT, et rien de plus. Aucun secret, aucun chemin de stockage, aucune
 * URL signée au-delà de celle qu'il doit utiliser pour déposer son fichier.
 */

import type {
  ImportIssue,
  ImportRowStatus,
  ImportDedupeVerdict,
  SourceConventions,
} from "@/lib/acquisition/types";
import type {
  PortfolioColumnMapping,
  PortfolioEventType,
  PortfolioFileFormat,
  PortfolioImportKind,
  PortfolioRowCounts,
} from "@/lib/acquisition/portfolio/types";

export type {
  ImportIssue,
  ImportRowStatus,
  ImportDedupeVerdict,
  PortfolioColumnMapping,
  PortfolioEventType,
  PortfolioFileFormat,
  PortfolioImportKind,
  PortfolioRowCounts,
  SourceConventions,
};

/** Billet de dépôt. Le chemin est CALCULÉ en base ; le client ne le choisit pas. */
export interface PortfolioUploadTicket {
  ticketId: string;
  /** URL signée, à usage unique et expirante, pour un dépôt à ce chemin et à lui seul. */
  uploadUrl: string;
  bucket: string;
  path: string;
  token: string;
  expiresAt: string;
}

/** Instrument du référentiel, tel qu'il est proposé au rattachement. */
export interface InstrumentCandidateView {
  securityId: string;
  name: string;
  isin: string | null;
  ticker: string | null;
  basis: string;
}

export interface InstrumentResolutionView {
  id: string;
  sourceKey: string;
  sourceIsin: string | null;
  sourceTicker: string | null;
  sourceName: string | null;
  state: "CANDIDATE" | "AMBIGUOUS" | "RESOLVED" | "REJECTED";
  securityId: string | null;
  candidates: InstrumentCandidateView[];
  decidedAt: string | null;
  decidedReason: string | null;
  /** Nombre de lignes de l'import qui citent ce titre. */
  rowCount: number;
}

/** Une ligne du preview. Elle porte sa provenance au niveau de la ligne ET du champ. */
export interface PortfolioPreviewRow {
  recordId: string;
  rowNumber: number;
  /** Ligne brute reconstituée : ce que l'utilisateur relira pour comprendre le découpage. */
  rawLine: string;
  status: ImportRowStatus;
  verdict: ImportDedupeVerdict | null;
  eventType: PortfolioEventType | null;
  factDate: string | null;
  settlementDate: string | null;
  instrumentSourceKey: string | null;
  sourceIsin: string | null;
  sourceTicker: string | null;
  sourceInstrumentName: string | null;
  securityId: string | null;
  securityName: string | null;
  quantity: number | null;
  unitPrice: number | null;
  grossAmount: number | null;
  feeAmount: number | null;
  taxAmount: number | null;
  envelopeCashAmount: number | null;
  marketValue: number | null;
  costBasis: number | null;
  currency: string | null;
  externalReference: string | null;
  label: string | null;
  /** Corrections déjà appliquées, champ par champ : valeur d'origine et valeur retenue. */
  fieldCorrections: Record<string, unknown> | null;
  correctedAt: string | null;
  correctionReason: string | null;
  /** Fait canonique produit, une fois la session validée. */
  portfolioEventId: string | null;
  positionSnapshotId: string | null;
  commitState: "PENDING" | "COMMITTED" | "EXCLUDED";
  /**
   * OBSERVATION DÉJÀ PERSISTÉE à la même date pour la même détention, s'il en existe une.
   *
   * Elle est lue et remontée pour une seule raison : une décision de correction n'en est une
   * que si son auteur a VU ce qu'il remplace. Sans cela, « corriger » se réduit à cocher une
   * case, et c'est exactement ce que la revue a reproché au contrat précédent.
   *
   * `null` sur une ligne de ledger — un événement n'écrase aucune observation — et sur une
   * ligne de position dont la date est vierge.
   */
  existingObservation: PortfolioExistingObservation | null;
  issues: ImportIssue[];
}

/**
 * Ce que la base porte DÉJÀ pour cette détention à cette date, et ce qui changerait.
 *
 * INDICATIF, et il faut le dire : cette lecture n'est pas sous verrou, donc l'état peut avoir
 * changé quand la validation s'exécutera. C'est sans danger, et c'est le point du contrat :
 * la décision transmet `observed` comme état ATTENDU, la base le compare sous verrou, et une
 * divergence produit un conflit révisable — jamais un écrasement silencieux. Une
 * prévisualisation légèrement périmée fait donc échouer, elle ne fait pas perdre un fait.
 */
export interface PortfolioExistingObservation {
  /**
   * Valeurs telles que la base les rend, en TEXTE. Ce sont elles que la décision renvoie :
   * les faire passer par un nombre JavaScript perdrait de la précision sur un
   * `numeric(30,10)`.
   */
  observed: PortfolioObservedValues;
  snapshotDate: string;
  /**
   * `IDENTICAL` : rejouer ne change rien, et ce n'est donc PAS une correction.
   * `DIFFERENT` : un fait serait remplacé, et une décision motivée est exigée.
   */
  state: "IDENTICAL" | "DIFFERENT";
  /** Champs qui changeraient. Vide quand `state` vaut `IDENTICAL`. */
  changedFields: string[];
}

export interface PortfolioSessionSummary {
  sessionId: string;
  sourceId: string;
  kind: PortfolioImportKind;
  accountId: string;
  accountName: string;
  fileName: string | null;
  fileHash: string | null;
  format: PortfolioFileFormat | null;
  parser: string;
  parserVersion: string;
  status: "RECEIVING" | "ANALYZED" | "COMMITTED" | "DISCARDED" | "FAILED";
  counts: PortfolioRowCounts;
  committedCount: number;
  declaredCurrency: string | null;
  stableReferenceDeclared: boolean;
  analyzedAt: string | null;
  committedAt: string | null;
  issues: ImportIssue[];
}

export interface PortfolioPreview {
  session: PortfolioSessionSummary;
  headers: string[];
  mapping: PortfolioColumnMapping;
  mappingConfidence: "CERTAIN" | "AMBIGUOUS" | "INCOMPLETE";
  conventions: SourceConventions;
  sheetName: string | null;
  otherSheets: string[];
  /** Cellules issues d'une FORMULE : une valeur en cache n'est pas une valeur saisie. */
  formulaCells: string[];
  instruments: InstrumentResolutionView[];
  rows: PortfolioPreviewRow[];
  /** Vrai si l'affichage des lignes est plafonné. Le staging en contient l'intégralité. */
  rowsTruncated: boolean;
  issues: ImportIssue[];
}

export interface PortfolioCommitResult {
  sessionId: string;
  written: number;
  session: PortfolioSessionSummary;
}

/**
 * DÉCISION de remplacer une observation de position déjà persistée.
 *
 * Elle est structurée, et chaque champ répond à une question qu'un tableau d'identifiants
 * laissait sans réponse : quelle ligne, pourquoi, par qui, et sur la foi de quel état
 * courant.
 */
export interface PortfolioCorrectionDecision {
  /** Ligne de staging portant les valeurs de remplacement. */
  recordId: string;
  /** Motif. Non vide : une correction remplace un fait déjà lu par un humain. */
  reason: string;
  /**
   * Identité DÉCLARÉE du décideur. Facultative — la base retombe alors sur le rôle
   * PostgreSQL constaté plutôt que sur une personne inventée : « on ne sait pas qui » est
   * une information, un nom fabriqué n'en est pas une.
   */
  decidedBy?: string;
  /**
   * État de l'observation tel que la prévisualisation l'a MONTRÉ, verbatim.
   *
   * C'est le verrou de concurrence : la base compare cet état attendu à l'état réellement
   * persisté, sous verrou. S'ils diffèrent, une autre décision est passée entre-temps, et la
   * validation échoue avec un conflit révisable au lieu d'effacer cette décision.
   *
   * Les montants sont des CHAÎNES, telles que PostgreSQL les a rendues. Les faire passer par
   * un nombre JavaScript perdrait de la précision sur un `numeric(30,10)` : un écart de
   * précision fabriquerait un conflit, ou pire, en masquerait un.
   */
  expected: PortfolioObservedValues;
}

/** Valeurs comparées d'une observation, telles que la base les rend. */
export interface PortfolioObservedValues {
  snapshotId: string;
  quantity: string | null;
  costBasis: string | null;
  marketValue: string | null;
  currency: string;
}

export type PortfolioImportCommand =
  | {
      action: "ticket";
      fileName: string;
      byteSize: number;
      contentType: string;
      retainFile: boolean;
    }
  | {
      action: "analyze";
      ticketId: string;
      kind: PortfolioImportKind;
      accountId: string;
      declaredCurrency: string | null;
      /** Mapping confirmé. Absent = mapping inféré des en-têtes. */
      mapping: PortfolioColumnMapping | null;
      sheetName: string | null;
      stableReferenceDeclared: boolean;
      rememberMapping: boolean;
    }
  | {
      action: "resolve-instrument";
      resolutionId: string;
      decision: "RESOLVE" | "REJECT";
      securityId: string | null;
      reason: string | null;
    }
  | {
      action: "correct";
      recordId: string;
      /** Valeurs retenues par l'utilisateur. Chacune est tracée dans la provenance. */
      values: Record<string, string | null>;
      reason: string;
    }
  | {
      action: "commit";
      sessionId: string;
      recordIds: string[];
      /**
       * DÉCISIONS de correction d'observations déjà persistées. Vide par défaut : un second
       * fichier portant la même date ne suffit pas à autoriser le remplacement d'un fait.
       *
       * Un tableau d'identifiants ne suffisait pas — c'était un consentement anonyme, sans
       * motif, sans auteur, et sans rien conserver de la valeur remplacée. Une décision
       * porte donc son motif, son auteur, et l'état qu'elle CROIT corriger : sans cet état
       * attendu, deux sessions corrigeant la même observation s'écraseraient sans que
       * personne le remarque.
       */
      corrections: PortfolioCorrectionDecision[];
    }
  | { action: "discard"; sessionId: string };

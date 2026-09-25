/**
 * Brouillons persistants (document 03 §8). Un brouillon est l'état d'un formulaire, même
 * incomplet : il n'est ni une observation ni un contrat, et aucun moteur ne le lit.
 */
export const FORM_DRAFT_KINDS = [
  "DEBT_CONTRACT_NEW",
  "DEBT_CONTRACT_EDIT",
  "DEBT_CONTRACT_PROMOTION",
] as const;
export type FormDraftKind = (typeof FORM_DRAFT_KINDS)[number];

/** Version du format de contenu écrit par cette application. */
export const DEBT_CONTRACT_DRAFT_SCHEMA_VERSION = 1;

export interface FormDraft {
  readonly id: string;
  readonly kind: FormDraftKind;
  /** Dette visée par une modification ou une promotion ; `null` pour une dette nouvelle. */
  readonly subjectId: string | null;
  readonly title: string;
  /** Contenu opaque, relu défensivement par le formulaire qui l'a écrit. */
  readonly content: Record<string, unknown>;
  readonly schemaVersion: number;
  readonly version: number;
  readonly updatedAt: string;
}

export interface FormDraftSaveInput {
  readonly draftId: string | null;
  readonly expectedVersion: number | null;
  readonly kind: FormDraftKind;
  readonly subjectId: string | null;
  readonly title: string;
  readonly content: Record<string, unknown>;
  readonly schemaVersion: number;
}

export interface FormDraftSaved {
  readonly id: string;
  readonly version: number;
  readonly updatedAt: string;
}

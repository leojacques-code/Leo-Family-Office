import "server-only";

import type { DashboardState, DocumentRecord } from "@/lib/types";
import type { DocumentUpload, Mutation, SimulationRun } from "@/lib/data/contracts";
import type { DomainDeclaration } from "@/lib/presentation/today/contracts";

export type { DocumentUpload, Mutation, SimulationRun } from "@/lib/data/contracts";

/**
 * Une déclaration à écrire : « êtes-vous concerné ? », §18.1.
 *
 * La date économique est PORTÉE PAR L'APPELANT et non posée par la base. Elle doit être celle
 * que l'application a présentée à l'utilisateur, c'est-à-dire la date financière du contexte,
 * et non l'instant du `insert` : le §18.3 interdit qu'une date soit « forcée à la date
 * financière », et l'inverse — la forcer à l'horloge du serveur — daterait la réponse d'un
 * jour que l'utilisateur n'a pas vu.
 */
export interface DomainDeclarationInput {
  readonly domain: DomainDeclaration["domain"];
  readonly applicability: DomainDeclaration["applicability"];
  readonly declaredOn: string;
  readonly note: string | null;
}

export interface FamilyOfficeRepository {
  readonly adapter: "supabase";
  getDashboardState(): Promise<DashboardState>;
  mutateState(mutation: Mutation): Promise<DashboardState>;
  storeDocument(upload: DocumentUpload): Promise<DocumentRecord>;
  saveSimulation(run: SimulationRun): Promise<string>;
  /**
   * Les déclarations COURANTES, une par domaine déclaré.
   *
   * Un domaine jamais déclaré est ABSENT du tableau, il n'y figure pas avec une valeur neutre :
   * ABSENCE ≠ `UNDECIDED`, et le §38 règle 10 exige que « une donnée déclarée inexistante reste
   * distincte » d'une donnée absente.
   */
  getDomainDeclarations(): Promise<DomainDeclaration[]>;
  /**
   * Écrit une déclaration, ou constate qu'elle est déjà celle-là.
   *
   * Rend `false` quand rien n'a été écrit parce que la réponse ne change pas. La distinction
   * est utile à l'appelant : rouvrir l'onboarding et recocher les mêmes réponses ne doit pas
   * s'annoncer comme huit modifications.
   *
   * Elle ne rend PAS `DashboardState`. Le §10.2 : « une mutation ne doit plus renvoyer tout
   * DashboardState. Elle renvoie l'entité affectée, la nouvelle version du modèle local ou un
   * signal d'invalidation ciblé. »
   */
  declareDomainApplicability(input: DomainDeclarationInput): Promise<boolean>;
}

let cached: Promise<FamilyOfficeRepository> | undefined;

async function load(): Promise<FamilyOfficeRepository> {
  const { createSupabaseRepository } = await import("@/lib/data/supabase-repository");
  return createSupabaseRepository();
}

export function getRepository(): Promise<FamilyOfficeRepository> {
  if (!cached) cached = load();
  return cached;
}

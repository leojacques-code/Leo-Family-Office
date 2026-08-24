import "server-only";

import type { DashboardState, DocumentRecord } from "@/lib/types";
import type { DocumentUpload, Mutation, SimulationRun } from "@/lib/data/contracts";

export type { DocumentUpload, Mutation, SimulationRun } from "@/lib/data/contracts";

export interface FamilyOfficeRepository {
  readonly adapter: "supabase";
  getDashboardState(): Promise<DashboardState>;
  mutateState(mutation: Mutation): Promise<DashboardState>;
  storeDocument(upload: DocumentUpload): Promise<DocumentRecord>;
  saveSimulation(run: SimulationRun): Promise<string>;
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

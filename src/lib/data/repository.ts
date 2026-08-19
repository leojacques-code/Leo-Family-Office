import "server-only";

import type { DashboardState, DocumentRecord } from "@/lib/types";
import type { DocumentUpload, Mutation, SimulationRun } from "@/lib/data/contracts";

export type { DocumentUpload, Mutation, SimulationRun } from "@/lib/data/contracts";

export interface FamilyOfficeRepository {
  readonly adapter: "local" | "supabase";
  getDashboardState(): Promise<DashboardState>;
  mutateState(mutation: Mutation): Promise<DashboardState>;
  storeDocument(upload: DocumentUpload): Promise<DocumentRecord>;
  saveSimulation(run: SimulationRun): Promise<string>;
}

export type DataAdapterName = "local" | "supabase";

export function resolveAdapterName(): DataAdapterName {
  const configured = process.env.DATA_ADAPTER?.trim().toLowerCase();
  if (configured === "supabase" || configured === "local") return configured;
  // Sur Vercel le filesystem est en lecture seule et node:sqlite est expérimental sous Node 22 :
  // Supabase est le seul défaut viable.
  return process.env.VERCEL ? "supabase" : "local";
}

let cached: Promise<FamilyOfficeRepository> | undefined;

async function load(): Promise<FamilyOfficeRepository> {
  if (resolveAdapterName() === "supabase") {
    const { createSupabaseRepository } = await import("@/lib/data/supabase-repository");
    return createSupabaseRepository();
  }
  // Import dynamique volontaire : node:sqlite ne doit jamais être évalué en production.
  const { createLocalRepository } = await import("@/lib/data/local-repository");
  return createLocalRepository();
}

export function getRepository(): Promise<FamilyOfficeRepository> {
  if (!cached) cached = load();
  return cached;
}

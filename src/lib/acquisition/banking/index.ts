/**
 * OPEN BANKING (AIS) — POINT D'ENTRÉE DE LA COUCHE PURE
 *
 * Lecture seule. Aucune initiation de paiement n'existe dans ce module, et aucune n'y est
 * ajoutable sans changer le contrat d'adaptateur.
 */
export * from "./types";
export * from "./normalize";
export * from "./pagination";
export * from "./reconcile";
export {
  createSandboxProvider,
  SANDBOX_CAPABILITIES,
  SANDBOX_PROVIDER_ID,
  SANDBOX_PROVIDER_VERSION,
} from "./providers/sandbox";
export type { SandboxFailurePlan, SandboxScenario } from "./providers/sandbox";

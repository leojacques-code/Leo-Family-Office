/**
 * ACQUISITION DU REGISTRE D'ENTREPRISES — POINT D'ENTRÉE
 *
 * Rien ici n'appelle le réseau, n'accède à la base ni ne dépend de React. Le module rend
 * des adaptateurs et des fonctions pures ; la persistance est le travail de
 * `src/lib/data/registry-repository.ts`, et lui seul.
 *
 * Le choix du fournisseur est une DÉCISION DE CONFIGURATION, pas une préférence implicite :
 * `createRegistryAdapter` ne devine jamais un fournisseur de repli. Un appelant qui demande
 * l'INPI sans jeton obtient l'adaptateur INPI, qui répondra `CREDENTIALS_MISSING` — il
 * n'obtient PAS l'annuaire ouvert à la place. Substituer une source en silence est
 * exactement ce que la doctrine de provenance interdit : le résultat porterait le nom d'un
 * fournisseur qui n'a rien répondu.
 */

export * from "./types";
export * from "./siren";
export * from "./normalize";
export * from "./transport";
export * from "./diff";
export {
  createRechercheEntreprisesAdapter,
  RECHERCHE_ENTREPRISES_BASE_URL,
  RECHERCHE_ENTREPRISES_CAPABILITIES,
  RECHERCHE_ENTREPRISES_RATE_LIMIT_PER_MINUTE,
  RECHERCHE_ENTREPRISES_SCHEMA_VERSION,
  RECHERCHE_ENTREPRISES_TTL_MINUTES,
} from "./recherche-entreprises";
export {
  createInpiRneAdapter,
  INPI_RNE_BASE_URL,
  INPI_RNE_CAPABILITIES,
  INPI_RNE_CREDENTIAL_ENV_VAR,
  INPI_RNE_RATE_LIMIT_PER_MINUTE,
  INPI_RNE_SCHEMA_VERSION,
  INPI_RNE_TTL_MINUTES,
} from "./inpi-rne";
export {
  createFixtureAdapter,
  FIXTURE_CAPABILITIES,
  FIXTURE_SCHEMA_VERSION,
  FIXTURE_SIREN_CHECKSUM_KO,
  FIXTURE_SIREN_COMPLETE,
  FIXTURE_SIREN_SPARSE,
} from "./fixture-provider";

import { createFixtureAdapter } from "./fixture-provider";
import { createInpiRneAdapter } from "./inpi-rne";
import { createRechercheEntreprisesAdapter } from "./recherche-entreprises";
import type { RegistryTransportConfig } from "./transport";
import type { RegistryProvider, RegistryProviderAdapter } from "./types";

export interface RegistryAdapterOptions {
  fetchImpl?: typeof fetch;
  transport?: Partial<RegistryTransportConfig>;
  /** Jeton du fournisseur, lu par l'appelant SERVEUR. Jamais transmis au navigateur. */
  token?: string | null;
}

export function createRegistryAdapter(
  provider: RegistryProvider,
  options: RegistryAdapterOptions = {},
): RegistryProviderAdapter {
  switch (provider) {
    case "RECHERCHE_ENTREPRISES":
      return createRechercheEntreprisesAdapter(options);
    case "INPI_RNE":
      return createInpiRneAdapter(options);
    case "FIXTURE":
      return createFixtureAdapter({ clock: options.transport?.clock });
    default: {
      // Exhaustivité vérifiée à la compilation : ajouter un fournisseur sans l'implémenter
      // ne compile pas, plutôt que d'échouer à l'exécution devant l'utilisateur.
      const exhaustive: never = provider;
      throw new Error(`Fournisseur de registre non implémenté : ${String(exhaustive)}`);
    }
  }
}

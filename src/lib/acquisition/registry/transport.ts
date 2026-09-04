/**
 * TRANSPORT DU REGISTRE — ALIAS DU TRANSPORT UNIQUE
 *
 * Cette verticale n'a plus son propre transport. Le module partagé
 * `src/lib/acquisition/transport.ts` porte l'implémentation, fusion des deux qui
 * coexistaient : le quota par connexion, l'horloge et l'attente injectées, le
 * `Last-Modified` du fournisseur, ET la lecture de corps protégée qui empêche un corps
 * interrompu de faire perdre le statut réellement rendu.
 *
 * Les noms historiques de la verticale sont conservés comme ALIAS, pour deux raisons : le
 * vocabulaire d'erreur du registre (`RegistryErrorCode`) est déjà exactement celui du
 * transport partagé, et renommer ses appelants n'apporterait rien qu'un diff.
 */
export {
  callJson as callRegistry,
  classifyFetchFailure,
  classifyHttpStatus,
  DEFAULT_TRANSPORT,
  RateLimiter as RegistryRateLimiter,
  systemTransportClock as systemRegistryClock,
} from "@/lib/acquisition/transport";
export type {
  TransportClock as RegistryClock,
  TransportConfig as RegistryTransportConfig,
  TransportRequest as RegistryRequest,
  TransportResult as RegistryTransportResult,
} from "@/lib/acquisition/transport";

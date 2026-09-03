/**
 * TRANSPORT VERS UN REGISTRE EXTERNE
 *
 * Délais bornés, réessais bornés, quota respecté, erreurs TYPÉES. Tout est injecté —
 * `fetch`, l'horloge, l'attente — donc tout est testable sans réseau, ce qui est la seule
 * façon d'écrire des tests qui prouvent quelque chose sur la conduite en cas de panne.
 *
 * Trois principes :
 *
 *   UN ÉCHEC EST UN FAIT. Le transport ne lève pas : il rend un résultat portant son code
 *   d'erreur. L'appelant persiste cet échec comme un instantané daté, parce que « le
 *   registre n'a pas répondu le 31 août » est une information, et que la perdre ferait
 *   croire à une absence de donnée.
 *
 *   ON NE RÉESSAIE QUE CE QUI PEUT CHANGER. Un 401 ne devient pas vrai en le redemandant ;
 *   un 429 et un 503, oui. Réessayer une autorisation refusée ne fait que consommer un
 *   quota et retarder le diagnostic.
 *
 *   PAS DE CACHE EN MÉMOIRE. Le cache de cette verticale est la base : un instantané
 *   persisté porte sa date d'observation et sa péremption déclarée. Un cache de processus
 *   serait vide à chaque exécution serverless et donnerait un taux de succès imaginaire.
 */

import { RETRYABLE_REGISTRY_ERROR_CODES, type RegistryErrorCode } from "./types";

export interface RegistryClock {
  /** Millisecondes depuis l'epoch. */
  now(): number;
}

export const systemRegistryClock: RegistryClock = { now: () => Date.now() };

export interface RegistryTransportConfig {
  fetchImpl: typeof fetch;
  clock: RegistryClock;
  sleep: (ms: number) => Promise<void>;
  /** Délai maximal d'UN appel. Un registre qui ne répond pas en 8 s ne répondra pas. */
  timeoutMs: number;
  /** Nombre total de tentatives, réessais compris. 1 = aucun réessai. */
  maxAttempts: number;
  /** Base du recul exponentiel. Le recul est plafonné, pas illimité. */
  backoffBaseMs: number;
  backoffCapMs: number;
  /** Quota déclaré par le fournisseur. `null` = aucun quota déclaré. */
  rateLimitPerMinute: number | null;
  /**
   * Attente maximale acceptée pour respecter le quota. Au-delà, l'appel n'est pas tenté et
   * rend `RATE_LIMITED` : faire patienter une requête HTTP entrante trente secondes serait
   * pire qu'un refus explicite.
   */
  maxRateLimitWaitMs: number;
}

export const DEFAULT_TRANSPORT: Omit<RegistryTransportConfig, "fetchImpl" | "rateLimitPerMinute"> =
  {
    clock: systemRegistryClock,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    timeoutMs: 8_000,
    maxAttempts: 3,
    backoffBaseMs: 250,
    backoffCapMs: 2_000,
    maxRateLimitWaitMs: 3_000,
  };

export interface RegistryRequest {
  url: string;
  headers?: Record<string, string>;
}

export interface RegistryTransportResult {
  httpStatus: number | null;
  /** Corps décodé en JSON. `null` quand l'appel a échoué ou que le corps n'est pas du JSON. */
  payload: unknown;
  payloadBytes: number | null;
  errorCode: RegistryErrorCode | null;
  errorMessage: string | null;
  /** Nombre de tentatives RÉELLEMENT effectuées. Utile pour comprendre une latence. */
  attempts: number;
  /** `Last-Modified` du fournisseur, quand il en publie un. */
  providerUpdatedAt: string | null;
}

/**
 * Seau à jetons. Chaque instance porte l'état d'UNE connexion : deux fournisseurs ne
 * partagent pas un quota qui ne leur est pas commun.
 */
export class RegistryRateLimiter {
  private readonly timestamps: number[] = [];

  constructor(
    private readonly limitPerMinute: number | null,
    private readonly clock: RegistryClock,
  ) {}

  /** Attente nécessaire, en millisecondes, avant qu'un appel soit permis. */
  waitFor(): number {
    if (this.limitPerMinute === null || this.limitPerMinute <= 0) return 0;
    const now = this.clock.now();
    const windowStart = now - 60_000;
    while (this.timestamps.length > 0 && this.timestamps[0] <= windowStart) {
      this.timestamps.shift();
    }
    if (this.timestamps.length < this.limitPerMinute) return 0;
    return Math.max(0, this.timestamps[0] + 60_000 - now);
  }

  /** Enregistre un appel RÉELLEMENT parti. Un appel refusé ne consomme pas de jeton. */
  record(): void {
    if (this.limitPerMinute === null || this.limitPerMinute <= 0) return;
    this.timestamps.push(this.clock.now());
  }
}

/**
 * Classe une exception de `fetch`. La distinction entre une panne réseau et un refus de
 * politique de sortie est FAITE AU MIEUX : un proxy d'entreprise masque souvent la raison.
 * Le code par défaut est donc `NETWORK`, jamais un diagnostic inventé.
 */
export function classifyFetchFailure(error: unknown): {
  code: RegistryErrorCode;
  message: string;
} {
  const message = error instanceof Error ? error.message : String(error);
  const lowered = message.toLowerCase();
  if (error instanceof Error && error.name === "AbortError") {
    return { code: "TIMEOUT", message };
  }
  if (
    lowered.includes("proxy") ||
    lowered.includes("connect") ||
    lowered.includes("403") ||
    lowered.includes("407") ||
    lowered.includes("tunneling socket")
  ) {
    return {
      code: "EGRESS_BLOCKED",
      message: `${message} — sortie réseau refusée par la politique d'exécution, ce n'est pas une réponse du registre`,
    };
  }
  return { code: "NETWORK", message };
}

/** Classe un statut HTTP. Un 2xx sans corps JSON reste un échec de LECTURE, pas de réseau. */
export function classifyHttpStatus(status: number): RegistryErrorCode | null {
  if (status >= 200 && status < 300) return null;
  if (status === 401 || status === 403) return "UNAUTHORIZED";
  if (status === 404) return "NOT_FOUND";
  if (status === 429) return "RATE_LIMITED";
  if (status >= 500) return "PROVIDER_ERROR";
  return "PROVIDER_ERROR";
}

function backoffDelay(attempt: number, config: RegistryTransportConfig): number {
  return Math.min(config.backoffCapMs, config.backoffBaseMs * 2 ** (attempt - 1));
}

/**
 * Exécute un appel avec toutes les bornes. Le résultat porte toujours un sens : soit un
 * corps lu, soit un code d'erreur nommé.
 */
export async function callRegistry(
  request: RegistryRequest,
  config: RegistryTransportConfig,
  limiter: RegistryRateLimiter,
): Promise<RegistryTransportResult> {
  let attempts = 0;
  let last: RegistryTransportResult = {
    httpStatus: null,
    payload: null,
    payloadBytes: null,
    errorCode: "NETWORK",
    errorMessage: "Aucune tentative effectuée",
    attempts: 0,
    providerUpdatedAt: null,
  };

  for (let attempt = 1; attempt <= Math.max(1, config.maxAttempts); attempt += 1) {
    const wait = limiter.waitFor();
    if (wait > 0) {
      if (wait > config.maxRateLimitWaitMs) {
        return {
          httpStatus: null,
          payload: null,
          payloadBytes: null,
          errorCode: "RATE_LIMITED",
          errorMessage: `Quota du fournisseur atteint : ${Math.ceil(wait / 1000)} s d'attente nécessaires, au-delà de l'attente acceptée`,
          attempts,
          providerUpdatedAt: null,
        };
      }
      await config.sleep(wait);
    }

    attempts += 1;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs);
    try {
      limiter.record();
      const response = await config.fetchImpl(request.url, {
        method: "GET",
        headers: { accept: "application/json", ...(request.headers ?? {}) },
        signal: controller.signal,
        // Le cache HTTP ne décide pas de la fraîcheur d'un fait patrimonial : la péremption
        // est déclarée par la connexion et portée par l'instantané persisté.
        cache: "no-store",
      });
      const statusError = classifyHttpStatus(response.status);
      const text = await response.text();
      const providerUpdatedAt = readLastModified(response);

      if (statusError) {
        last = {
          httpStatus: response.status,
          payload: null,
          payloadBytes: text.length,
          errorCode: statusError,
          errorMessage: `HTTP ${response.status} : ${truncate(text)}`,
          attempts,
          providerUpdatedAt,
        };
        if (!RETRYABLE_REGISTRY_ERROR_CODES.includes(statusError)) return last;
        if (attempt < config.maxAttempts) await config.sleep(backoffDelay(attempt, config));
        continue;
      }

      let payload: unknown;
      try {
        payload = JSON.parse(text) as unknown;
      } catch {
        // Un 200 qui n'est pas du JSON est un échec de CONTRAT, non retryable : le
        // fournisseur a répondu, simplement pas ce qu'il documente.
        return {
          httpStatus: response.status,
          payload: null,
          payloadBytes: text.length,
          errorCode: "INVALID_RESPONSE",
          errorMessage: `Corps non JSON reçu en HTTP ${response.status} : ${truncate(text)}`,
          attempts,
          providerUpdatedAt,
        };
      }

      return {
        httpStatus: response.status,
        payload,
        payloadBytes: text.length,
        errorCode: null,
        errorMessage: null,
        attempts,
        providerUpdatedAt,
      };
    } catch (error) {
      const classified = classifyFetchFailure(error);
      last = {
        httpStatus: null,
        payload: null,
        payloadBytes: null,
        errorCode: classified.code,
        errorMessage: classified.message,
        attempts,
        providerUpdatedAt: null,
      };
      // Une sortie réseau refusée par la politique d'exécution ne se réessaie pas : la
      // politique ne changera pas d'avis dans 250 ms.
      if (classified.code === "EGRESS_BLOCKED") return last;
      if (attempt < config.maxAttempts) await config.sleep(backoffDelay(attempt, config));
    } finally {
      clearTimeout(timer);
    }
  }

  return last;
}

function readLastModified(response: Response): string | null {
  const header = response.headers?.get?.("last-modified");
  if (!header) return null;
  const parsed = new Date(header);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function truncate(text: string): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  return collapsed.length > 200 ? `${collapsed.slice(0, 197)}…` : collapsed;
}

/**
 * TRANSPORT HTTP BORNÉ — MODULE UNIQUE DE LA COUCHE D'ACQUISITION
 *
 * Un seul transport pour toutes les verticales qui lisent une source distante : registre
 * d'entreprises, données publiques immobilières, et tout adaptateur à venir. Deux
 * implémentations avaient été écrites en parallèle ; elles sont FUSIONNÉES ici, et chacune
 * apportait quelque chose que l'autre n'avait pas :
 *
 *   * le quota PAR CONNEXION avec plafond d'attente, l'horloge et l'attente injectées, le
 *     `Last-Modified` du fournisseur, et un vocabulaire d'erreur qui distingue un refus
 *     d'autorisation d'une absence de donnée ;
 *   * la LECTURE DE CORPS PROTÉGÉE : un corps interrompu ne doit pas faire perdre le statut
 *     que la source a réellement rendu. Sans ce garde, un 503 dont le corps se coupe est
 *     classé « erreur réseau », et le diagnostic remonté à l'utilisateur désigne la mauvaise
 *     cause. Le transport le plus riche ne l'avait pas ; il l'a maintenant.
 *
 * Quatre principes :
 *
 *   UN ÉCHEC EST UN FAIT. Le transport ne lève pas : il rend un résultat portant son code
 *   d'erreur. L'appelant persiste cet échec comme un instantané daté, parce que « la source
 *   n'a pas répondu le 31 août » est une information, et que la perdre ferait croire à une
 *   absence de donnée.
 *
 *   ON NE RÉESSAIE QUE CE QUI PEUT CHANGER. Un 401 ne devient pas vrai en le redemandant ;
 *   un 429 et un 503, oui. Une sortie réseau refusée par la politique d'exécution non plus :
 *   la politique ne changera pas d'avis dans 250 ms.
 *
 *   UNE LIMITE LOCALE N'EST PAS UN REFUS DE LA SOURCE. Quand le quota nous retient, la
 *   source n'a rien refusé — le message le dit, sans quoi on lui attribuerait un rejet
 *   qu'elle n'a pas émis.
 *
 *   PAS DE CACHE EN MÉMOIRE. Le cache de cette couche est la base : un instantané persisté
 *   porte sa date d'observation et sa péremption déclarée. Un cache de processus serait vide
 *   à chaque exécution serverless et donnerait un taux de succès imaginaire.
 */

/**
 * Vocabulaire d'échec, domaine-neutre. C'est l'union des deux vocabulaires antérieurs, et
 * chaque code décrit une CAUSE distincte : les fusionner ferait remonter un diagnostic faux.
 */
export const TRANSPORT_FAILURE_CODES = [
  "NETWORK",
  "TIMEOUT",
  "RATE_LIMITED",
  "UNAUTHORIZED",
  "CREDENTIALS_MISSING",
  "NOT_FOUND",
  "INVALID_RESPONSE",
  "PROVIDER_ERROR",
  "EGRESS_BLOCKED",
] as const;
export type TransportFailureCode = (typeof TRANSPORT_FAILURE_CODES)[number];

/**
 * Codes réessayables. `UNAUTHORIZED`, `NOT_FOUND`, `INVALID_RESPONSE` et `EGRESS_BLOCKED`
 * n'en font pas partie : aucun ne devient vrai en le redemandant.
 */
export const RETRYABLE_TRANSPORT_FAILURES: readonly TransportFailureCode[] = [
  "NETWORK",
  "TIMEOUT",
  "RATE_LIMITED",
  "PROVIDER_ERROR",
];

export interface TransportClock {
  /** Millisecondes depuis l'epoch. */
  now(): number;
}

export const systemTransportClock: TransportClock = { now: () => Date.now() };

export interface TransportConfig {
  fetchImpl: typeof fetch;
  clock: TransportClock;
  sleep: (ms: number) => Promise<void>;
  /** Délai maximal d'UN appel. Une source qui ne répond pas en 8 s ne répondra pas. */
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

export const DEFAULT_TRANSPORT: Omit<TransportConfig, "fetchImpl" | "rateLimitPerMinute"> = {
  clock: systemTransportClock,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  timeoutMs: 8_000,
  maxAttempts: 3,
  backoffBaseMs: 250,
  backoffCapMs: 2_000,
  maxRateLimitWaitMs: 3_000,
};

export interface TransportRequest {
  url: string;
  headers?: Record<string, string>;
}

export interface TransportResult {
  httpStatus: number | null;
  payload: unknown;
  /** Taille du corps réellement lu. `null` quand rien n'a pu être lu. */
  payloadBytes: number | null;
  /** Corps brut réellement reçu, tel quel. Vide quand la lecture a échoué. */
  rawText: string;
  errorCode: TransportFailureCode | null;
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
export class RateLimiter {
  private readonly timestamps: number[] = [];

  constructor(
    private readonly limitPerMinute: number | null,
    private readonly clock: TransportClock = systemTransportClock,
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
  code: TransportFailureCode;
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
      message: `${message} — sortie réseau refusée par la politique d'exécution, ce n'est pas une réponse de la source`,
    };
  }
  return { code: "NETWORK", message };
}

/** Classe un statut HTTP. Un 2xx sans corps JSON reste un échec de LECTURE, pas de réseau. */
export function classifyHttpStatus(status: number): TransportFailureCode | null {
  if (status >= 200 && status < 300) return null;
  if (status === 401 || status === 403) return "UNAUTHORIZED";
  if (status === 404) return "NOT_FOUND";
  if (status === 429) return "RATE_LIMITED";
  return "PROVIDER_ERROR";
}

function backoffDelay(attempt: number, config: TransportConfig): number {
  return Math.min(config.backoffCapMs, config.backoffBaseMs * 2 ** (attempt - 1));
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

/**
 * Exécute un appel avec toutes les bornes. Le résultat porte toujours un sens : soit un
 * corps lu, soit un code d'erreur nommé.
 */
export async function callJson(
  request: TransportRequest,
  config: TransportConfig,
  limiter: RateLimiter,
): Promise<TransportResult> {
  let attempts = 0;
  let last: TransportResult = {
    httpStatus: null,
    payload: null,
    payloadBytes: null,
    rawText: "",
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
          rawText: "",
          errorCode: "RATE_LIMITED",
          errorMessage:
            `Quota du fournisseur atteint : ${Math.ceil(wait / 1000)} s d'attente nécessaires, ` +
            "au-delà de l'attente acceptée. La requête n'a PAS été émise, et la source n'a donc rien refusé",
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
        redirect: "follow",
        // Le cache HTTP ne décide pas de la fraîcheur d'un fait patrimonial : la péremption
        // est déclarée par la connexion et portée par l'instantané persisté.
        cache: "no-store",
      });
      const statusError = classifyHttpStatus(response.status);
      const providerUpdatedAt = readLastModified(response);

      // LECTURE DE CORPS PROTÉGÉE. Un corps interrompu ne doit pas faire PERDRE le statut
      // que la source a réellement rendu : sans ce garde, un 503 dont le corps se coupe
      // serait classé « erreur réseau », et le diagnostic désignerait la mauvaise cause.
      let text = "";
      let bodyReadFailed = false;
      try {
        text = await response.text();
      } catch {
        bodyReadFailed = true;
      }

      if (statusError) {
        last = {
          httpStatus: response.status,
          payload: null,
          payloadBytes: bodyReadFailed ? null : text.length,
          rawText: text,
          errorCode: statusError,
          errorMessage: bodyReadFailed
            ? `HTTP ${response.status} : corps illisible, le statut rendu par la source est conservé`
            : `HTTP ${response.status} : ${truncate(text)}`,
          attempts,
          providerUpdatedAt,
        };
        if (!RETRYABLE_TRANSPORT_FAILURES.includes(statusError)) return last;
        if (attempt < config.maxAttempts) await config.sleep(backoffDelay(attempt, config));
        continue;
      }

      if (bodyReadFailed) {
        // Un 2xx dont le corps ne se lit pas : la source a répondu, mais rien n'est
        // exploitable. C'est un échec de CONTRAT, pas de réseau, et il n'est pas retryable.
        return {
          httpStatus: response.status,
          payload: null,
          payloadBytes: null,
          rawText: "",
          errorCode: "INVALID_RESPONSE",
          errorMessage: `Corps illisible reçu en HTTP ${response.status} : le statut est conservé, aucune valeur n'en est tirée`,
          attempts,
          providerUpdatedAt,
        };
      }

      let payload: unknown;
      try {
        payload = JSON.parse(text) as unknown;
      } catch {
        // Un 200 qui n'est pas du JSON est un échec de CONTRAT, non retryable : la source a
        // répondu, simplement pas ce qu'elle documente.
        return {
          httpStatus: response.status,
          payload: null,
          payloadBytes: text.length,
          rawText: text,
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
        rawText: text,
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
        rawText: "",
        errorCode: classified.code,
        errorMessage: classified.message,
        attempts,
        providerUpdatedAt: null,
      };
      // Une sortie réseau refusée par la politique d'exécution ne se réessaie pas.
      if (classified.code === "EGRESS_BLOCKED") return last;
      if (attempt < config.maxAttempts) await config.sleep(backoffDelay(attempt, config));
    } finally {
      clearTimeout(timer);
    }
  }

  return last;
}

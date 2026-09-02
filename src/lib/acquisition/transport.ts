/**
 * TRANSPORT BORNÉ VERS UNE SOURCE EXTERNE
 *
 * Fonctions pures au sens du dépôt : aucun accès base, aucun React. Elles font des appels
 * réseau, et c'est précisément ce qu'elles bornent.
 *
 * Le point de ce module n'est pas de « faire un fetch ». C'est de garantir qu'aucun échec
 * externe ne devient une donnée. Une source lente, en panne, saturée ou inaccessible produit
 * un ÉCHEC NOMMÉ, jamais un tableau vide silencieux : `[]` et « la source n'a pas répondu »
 * sont deux faits différents, et les confondre ferait disparaître des mutations réelles.
 *
 * TIMEOUT ≠ ABSENCE DE DONNÉE. RATE LIMIT ≠ ABSENCE DE DONNÉE. EGRESS BLOQUÉ ≠ ABSENCE DE
 * DONNÉE.
 */

/** Codes d'échec. Chacun dit ce qui s'est passé, et aucun ne se confond avec un résultat. */
export type TransportFailureCode =
  /** La requête n'a pas abouti dans le délai imparti. */
  | "TIMEOUT"
  /** La sortie réseau est refusée par la politique de l'environnement. */
  | "EGRESS_BLOCKED"
  /** La source a répondu 429, ou l'anneau de jetons local a refusé d'émettre. */
  | "RATE_LIMITED"
  /** 5xx : la source est en panne. */
  | "SERVER_ERROR"
  /** 4xx autre que 429 : la requête est refusée. */
  | "CLIENT_ERROR"
  /** Corps illisible, ou type de contenu inattendu. */
  | "MALFORMED_RESPONSE"
  /** Échec réseau non classé. */
  | "NETWORK_ERROR";

export interface TransportFailure {
  ok: false;
  code: TransportFailureCode;
  /** Statut HTTP, quand il y en a eu un. `null` si la requête n'a jamais abouti. */
  httpStatus: number | null;
  message: string;
  /** Nombre de tentatives réellement effectuées, la première comprise. */
  attempts: number;
}

export interface TransportSuccess<T> {
  ok: true;
  httpStatus: number;
  body: T;
  /** Corps brut, tel que reçu. Il sert l'empreinte de contenu, jamais la lecture métier. */
  rawText: string;
  attempts: number;
}

export type TransportResult<T> = TransportSuccess<T> | TransportFailure;

export interface TransportOptions {
  /** Délai maximal d'une TENTATIVE, en millisecondes. */
  timeoutMs?: number;
  /** Nombre maximal de tentatives, la première comprise. */
  maxAttempts?: number;
  /** En-têtes. Un jeton passé ici ne doit jamais être journalisé par l'appelant. */
  headers?: Record<string, string>;
  /** Limiteur partagé, quand l'appelant en tient un pour cette source. */
  limiter?: TokenBucket;
  /** Injection pour les tests. Par défaut le `fetch` global. */
  fetchImpl?: typeof fetch;
  /** Attente entre deux tentatives. Injectable pour que les tests n'attendent pas. */
  sleepImpl?: (ms: number) => Promise<void>;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 250;

/**
 * Les seuls codes qu'une seconde tentative peut résoudre. Un 404 ou un 400 rejoués donnent
 * le même refus : les rejouer ne fait que marteler la source publique.
 *
 * `EGRESS_BLOCKED` n'est JAMAIS rejoué : la politique réseau ne changera pas entre deux
 * tentatives, et insister masquerait la vraie cause derrière un timeout.
 */
const RETRYABLE: ReadonlySet<TransportFailureCode> = new Set<TransportFailureCode>([
  "TIMEOUT",
  "RATE_LIMITED",
  "SERVER_ERROR",
  "NETWORK_ERROR",
]);

/**
 * Anneau de jetons. Il protège la source publique autant que nous : dépasser une limite
 * documentée expose à un bannissement, qui transformerait toutes les lectures suivantes en
 * `RATE_LIMITED` sans que rien n'ait changé côté données.
 */
export class TokenBucket {
  private tokens: number;
  private lastRefill: number;

  constructor(
    private readonly capacityPerMinute: number,
    private readonly now: () => number = () => Date.now(),
  ) {
    this.tokens = capacityPerMinute;
    this.lastRefill = now();
  }

  /** Consomme un jeton. `false` = la limite locale refuse d'émettre maintenant. */
  take(): boolean {
    const current = this.now();
    const elapsedMinutes = (current - this.lastRefill) / 60_000;
    if (elapsedMinutes > 0) {
      this.tokens = Math.min(
        this.capacityPerMinute,
        this.tokens + elapsedMinutes * this.capacityPerMinute,
      );
      this.lastRefill = current;
    }
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Reconnaît un refus de sortie réseau. La politique d'egress répond 403 au CONNECT du
 * proxy, ce qui remonte dans Node comme une erreur de tunnel et non comme un statut HTTP.
 * Le nommer sépare « l'environnement interdit l'appel » de « la source a refusé ».
 */
function classifyNetworkError(error: unknown): { code: TransportFailureCode; message: string } {
  const message = error instanceof Error ? error.message : String(error);
  const folded = message.toLowerCase();
  if (
    folded.includes("proxy") ||
    folded.includes("tunnel") ||
    folded.includes("econnrefused") ||
    folded.includes("enotfound") ||
    folded.includes("eai_again")
  ) {
    return {
      code: "EGRESS_BLOCKED",
      message: `Sortie réseau refusée ou hôte injoignable : ${message}. Ce n'est pas une absence de donnée`,
    };
  }
  return { code: "NETWORK_ERROR", message };
}

function classifyStatus(status: number): TransportFailureCode {
  if (status === 429) return "RATE_LIMITED";
  if (status >= 500) return "SERVER_ERROR";
  return "CLIENT_ERROR";
}

/**
 * Lit du JSON depuis une source externe, avec délai, tentatives bornées et limitation de
 * débit. Ne lève jamais : tout se rend sous forme de résultat.
 *
 * La validation du CONTENU n'est pas ici. Ce module rend un `unknown` : c'est l'adaptateur
 * de domaine qui décide, champ par champ, ce qu'il a compris et ce qu'il refuse.
 */
export async function fetchJson<T = unknown>(
  url: string,
  options: TransportOptions = {},
): Promise<TransportResult<T>> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxAttempts = Math.max(1, options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS);
  const doFetch = options.fetchImpl ?? fetch;
  const doSleep = options.sleepImpl ?? sleep;

  let attempts = 0;
  let last: TransportFailure = {
    ok: false,
    code: "NETWORK_ERROR",
    httpStatus: null,
    message: "Aucune tentative effectuée",
    attempts: 0,
  };

  while (attempts < maxAttempts) {
    if (options.limiter && !options.limiter.take()) {
      // La limite est LOCALE : la source n'a rien refusé, nous nous sommes retenus. Le dire
      // évite d'attribuer à la source un rejet qu'elle n'a pas émis.
      return {
        ok: false,
        code: "RATE_LIMITED",
        httpStatus: null,
        message:
          "Limite de débit locale atteinte : la requête n'a pas été émise, et la source n'a donc rien refusé",
        attempts,
      };
    }

    attempts += 1;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await doFetch(url, {
        method: "GET",
        headers: { accept: "application/json", ...(options.headers ?? {}) },
        signal: controller.signal,
        redirect: "follow",
      });
      clearTimeout(timer);

      // La lecture du corps est protégée : un corps interrompu ne doit pas faire PERDRE le
      // statut que la source a réellement rendu. Sans ce garde, un 503 dont le corps se
      // coupe serait classé « erreur réseau », et le diagnostic remonté à l'utilisateur
      // désignerait la mauvaise cause.
      let rawText = "";
      let bodyReadFailed = false;
      try {
        rawText = await response.text();
      } catch {
        bodyReadFailed = true;
      }

      if (!response.ok) {
        const code = classifyStatus(response.status);
        last = {
          ok: false,
          code,
          httpStatus: response.status,
          message: `La source a répondu ${response.status}`,
          attempts,
        };
        if (!RETRYABLE.has(code) || attempts >= maxAttempts) return last;
        await doSleep(BASE_BACKOFF_MS * 2 ** (attempts - 1));
        continue;
      }

      if (bodyReadFailed) {
        // Statut 2xx mais corps illisible : ce n'est pas un résultat vide, et le dire
        // empêche de conclure sur un contenu qui n'a jamais été reçu.
        return {
          ok: false,
          code: "MALFORMED_RESPONSE",
          httpStatus: response.status,
          message: "Réponse acceptée par la source mais corps illisible : rien n'en est déduit",
          attempts,
        };
      }

      let body: unknown;
      try {
        body = rawText.length === 0 ? null : JSON.parse(rawText);
      } catch {
        // Un corps illisible n'est pas un corps vide : le rendre `[]` inventerait un
        // résultat que la source n'a pas donné.
        return {
          ok: false,
          code: "MALFORMED_RESPONSE",
          httpStatus: response.status,
          message: "Réponse illisible : le corps n'est pas du JSON",
          attempts,
        };
      }

      return { ok: true, httpStatus: response.status, body: body as T, rawText, attempts };
    } catch (error) {
      clearTimeout(timer);
      const aborted =
        (error instanceof Error && error.name === "AbortError") ||
        (error instanceof DOMException && error.name === "AbortError");
      const classified = aborted
        ? { code: "TIMEOUT" as TransportFailureCode, message: `Délai de ${timeoutMs} ms dépassé` }
        : classifyNetworkError(error);
      last = {
        ok: false,
        code: classified.code,
        httpStatus: null,
        message: classified.message,
        attempts,
      };
      if (!RETRYABLE.has(classified.code) || attempts >= maxAttempts) return last;
      await doSleep(BASE_BACKOFF_MS * 2 ** (attempts - 1));
    }
  }

  return last;
}

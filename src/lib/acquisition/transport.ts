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
 * Six principes :
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
 *
 *   UN FOURNISSEUR N'EST PAS COOPÉRATIF. Il est distant, il n'est pas sous notre contrôle, et
 *   rien de ce qu'il annonce ne se croit sur parole. `Content-Length` est une DÉCLARATION,
 *   pas une mesure : le corps est lu de façon incrémentale et interrompu au premier octet
 *   au-delà du plafond, qu'une longueur ait été annoncée ou non, juste ou fausse. Un flux
 *   sans fin sur une fonction serverless ne rend pas une mauvaise réponse : il consomme la
 *   mémoire du processus jusqu'à le tuer, et l'instantané d'échec qui aurait dû être persisté
 *   ne l'est jamais. `Content-Type` est traité de la même façon : seul du JSON est parsé,
 *   parce qu'un portail captif ou une page de maintenance rend un HTML en HTTP 200.
 *
 *   UN DIAGNOSTIC NE TRANSPORTE AUCUN SECRET. Le message d'échec rendu par ce module est
 *   CONSTRUIT ici, à partir de faits neutres — un code, un statut, une taille, un type
 *   annoncé. Il ne reprend jamais `error.message`, ni l'URL appelée, ni sa chaîne de requête,
 *   ni un en-tête, ni le corps du fournisseur. Ce n'est pas de la prudence décorative : un
 *   `fetch` de Node cite l'URL demandée dans le texte de son exception, cette URL porte les
 *   jetons passés en paramètre, et ce message est PERSISTÉ dans l'instantané d'échec puis
 *   affiché. Le détail brut, lui, part au journal serveur et n'en sort pas.
 */

/**
 * Vocabulaire d'échec, domaine-neutre. C'est l'union des deux vocabulaires antérieurs, et
 * chaque code décrit une CAUSE distincte : les fusionner ferait remonter un diagnostic faux.
 *
 * `RESPONSE_TOO_LARGE` est distinct d'`INVALID_RESPONSE` : la source n'a rien fait de mal,
 * c'est NOTRE plafond qui a tranché. Confondre les deux ferait chercher une malformation
 * là où il n'y a qu'un volume, et masquerait le seul cas où relever le plafond est la
 * bonne réponse.
 *
 * `CANCELLED` est distinct de `TIMEOUT` : l'appelant a renoncé — requête HTTP entrante
 * abandonnée par le navigateur, arrêt du processus. Le classer en `TIMEOUT` accuserait la
 * source d'une lenteur qu'elle n'a peut-être pas eue, et `TIMEOUT` est réessayable là où un
 * abandon de l'appelant ne doit RIEN relancer.
 *
 * `CONFIG_INVALID` est distinct de tout le reste, et c'est le seul code qui n'accuse NI la
 * source NI le réseau : la configuration de l'appel est inutilisable, donc AUCUNE requête
 * n'est émise. Le confondre avec `INVALID_RESPONSE` ferait chercher un défaut chez un
 * fournisseur qui n'a jamais été contacté.
 */
export const TRANSPORT_FAILURE_CODES = [
  "NETWORK",
  "TIMEOUT",
  "CANCELLED",
  "RATE_LIMITED",
  "UNAUTHORIZED",
  "CREDENTIALS_MISSING",
  "NOT_FOUND",
  "INVALID_RESPONSE",
  "RESPONSE_TOO_LARGE",
  "PROVIDER_ERROR",
  "EGRESS_BLOCKED",
  "CONFIG_INVALID",
] as const;
export type TransportFailureCode = (typeof TRANSPORT_FAILURE_CODES)[number];

/**
 * Codes réessayables. `UNAUTHORIZED`, `NOT_FOUND`, `INVALID_RESPONSE`, `RESPONSE_TOO_LARGE`,
 * `CANCELLED` et `EGRESS_BLOCKED` n'en font pas partie : aucun ne devient vrai en le
 * redemandant. Une réponse trop grosse le sera encore au deuxième appel, et un abandon de
 * l'appelant ne se rattrape pas en insistant.
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
  /**
   * PLAFOND DE TAILLE DE CORPS, en octets, avant décodage.
   *
   * Il est déclaré, pas implicite, et il est BORNANT dans les deux sens : un
   * `Content-Length` annoncé au-delà fait refuser l'appel AVANT toute lecture, et la lecture
   * elle-même est interrompue au premier octet qui le dépasse — la longueur annoncée peut
   * être absente ou mensongère.
   *
   * Une connexion peut seulement RESSERRER ce plafond, jamais le relever : le maximum
   * absolu est `MAX_TRANSPORT_RESPONSE_BYTES`, et une valeur au-delà — comme `Infinity`,
   * `NaN`, un non-entier, zéro ou un négatif — fait refuser l'appel AVANT tout réseau avec
   * `CONFIG_INVALID`. Une limite qu'un adaptateur peut relever ne protège de rien.
   */
  maxResponseBytes: number;
}

/**
 * MAXIMUM ABSOLU de taille de corps : 4 Mio. Ce n'est pas un défaut, c'est un PLAFOND.
 *
 * La distinction est le finding : une configuration par fournisseur pouvait choisir
 * `Infinity`, et le « plafond déclaré » n'en était plus un — le plafond devenait ce que
 * l'appelant voulait bien s'accorder. Une limite qu'un appelant peut relever ne protège de
 * rien. Une connexion peut donc seulement choisir une limite PLUS PETITE ; toute valeur
 * au-delà, non entière, nulle, négative, `NaN` ou infinie fait refuser l'appel AVANT tout
 * réseau, avec `CONFIG_INVALID`.
 *
 * Ce chiffre est un ARBITRAGE, et il est écrit ici pour qu'il soit discutable. Les corps
 * réellement attendus par les adaptateurs de cette couche — une fiche d'entité de registre,
 * une page de mutations DVF, un lot de certificats DPE — se comptent en dizaines ou centaines
 * de kilo-octets. 4 Mio laisse donc une marge d'un ordre de grandeur pour une page
 * inhabituellement large, tout en restant très en dessous de la mémoire d'une fonction
 * serverless. Le relever est une décision qui se prend ICI, pas dans un adaptateur.
 */
export const MAX_TRANSPORT_RESPONSE_BYTES = 4 * 1024 * 1024;

/**
 * Défaut, égal au maximum : un adaptateur qui ne déclare rien hérite du plafond le plus
 * large ACCEPTABLE, et non d'une absence de plafond.
 */
export const DEFAULT_MAX_RESPONSE_BYTES = MAX_TRANSPORT_RESPONSE_BYTES;

/**
 * Valide le plafond d'UNE connexion. Rend `null` quand il est utilisable, sinon la raison
 * NEUTRALISÉE du refus.
 *
 * Exporté pour être testable seul : c'est un contrôle de configuration, et le prouver ne
 * doit pas exiger de simuler une réponse HTTP.
 */
export function invalidResponseLimit(maxResponseBytes: unknown): string | null {
  if (typeof maxResponseBytes !== "number" || Number.isNaN(maxResponseBytes)) {
    return "Plafond de taille de réponse non numérique : aucune requête n'est émise";
  }
  // `Number.isFinite` d'abord : `Infinity` n'est pas un entier, mais le dire par « non
  // entier » masquerait la vraie faute — un plafond infini n'est pas un plafond.
  if (!Number.isFinite(maxResponseBytes)) {
    return "Plafond de taille de réponse infini : un plafond infini n'est pas un plafond, aucune requête n'est émise";
  }
  if (!Number.isInteger(maxResponseBytes)) {
    return "Plafond de taille de réponse non entier : un compte d'octets est un entier, aucune requête n'est émise";
  }
  if (maxResponseBytes <= 0) {
    return "Plafond de taille de réponse nul ou négatif : aucune réponse ne pourrait être lue, aucune requête n'est émise";
  }
  if (maxResponseBytes > MAX_TRANSPORT_RESPONSE_BYTES) {
    return (
      `Plafond de taille de réponse au-delà du maximum de ${MAX_TRANSPORT_RESPONSE_BYTES} octets : ` +
      "une connexion peut seulement choisir une limite PLUS PETITE, aucune requête n'est émise"
    );
  }
  return null;
}

export const DEFAULT_TRANSPORT: Omit<TransportConfig, "fetchImpl" | "rateLimitPerMinute"> = {
  clock: systemTransportClock,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  timeoutMs: 8_000,
  maxAttempts: 3,
  backoffBaseMs: 250,
  backoffCapMs: 2_000,
  maxRateLimitWaitMs: 3_000,
  maxResponseBytes: DEFAULT_MAX_RESPONSE_BYTES,
};

export interface TransportRequest {
  url: string;
  headers?: Record<string, string>;
  /**
   * Signal de l'APPELANT. Sur une route Next, c'est `request.signal` : quand le navigateur
   * abandonne, la lecture distante s'arrête au lieu de continuer à consommer un quota
   * fournisseur pour une réponse que personne n'attend plus.
   *
   * Il est COMPOSÉ avec le délai interne, il ne le remplace pas : un appelant sans signal
   * garde son plafond de temps, et un appelant qui en fournit un n'obtient pas le droit
   * d'attendre indéfiniment.
   */
  signal?: AbortSignal;
}

export interface TransportResult {
  httpStatus: number | null;
  payload: unknown;
  /** Taille du corps réellement lu, en OCTETS. `null` quand rien n'a pu être lu. */
  payloadBytes: number | null;
  /**
   * Corps brut réellement reçu, tel quel, UNIQUEMENT sur une lecture réussie.
   *
   * Vide dès qu'`errorCode` est renseigné : un corps d'erreur de fournisseur ré-affiche
   * couramment la requête reçue, chaîne de requête comprise, et il est en aval haché puis
   * conservé. Ce qui n'est pas exploitable n'a pas à être transporté.
   */
  rawText: string;
  errorCode: TransportFailureCode | null;
  /**
   * Diagnostic NEUTRALISÉ, construit par ce module. Ne contient jamais `error.message`,
   * l'URL appelée, sa chaîne de requête, un en-tête ni un corps de fournisseur.
   */
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
 *
 * Le texte brut de l'exception est LU pour classer, et n'est JAMAIS rendu : `fetch` cite
 * l'URL demandée dans son message, et cette URL porte les jetons passés en paramètre. Le
 * message rendu est construit ici, à partir du seul code.
 */
export function classifyFetchFailure(error: unknown): {
  code: TransportFailureCode;
  message: string;
} {
  const raw = error instanceof Error ? error.message : String(error);
  const lowered = raw.toLowerCase();
  if (error instanceof Error && error.name === "AbortError") {
    return { code: "TIMEOUT", message: FAILURE_DIAGNOSTICS.TIMEOUT };
  }
  if (
    lowered.includes("proxy") ||
    lowered.includes("connect") ||
    lowered.includes("403") ||
    lowered.includes("407") ||
    lowered.includes("tunneling socket")
  ) {
    return { code: "EGRESS_BLOCKED", message: FAILURE_DIAGNOSTICS.EGRESS_BLOCKED };
  }
  return { code: "NETWORK", message: FAILURE_DIAGNOSTICS.NETWORK };
}

/**
 * Diagnostics NEUTRES, un par cause. Ils décrivent ce qui s'est passé sans citer une seule
 * donnée venue de l'extérieur : ni message d'exception, ni URL, ni en-tête, ni corps.
 */
const FAILURE_DIAGNOSTICS = {
  TIMEOUT:
    "Délai d'attente dépassé avant toute réponse exploitable de la source. Ce n'est pas une absence de donnée",
  CANCELLED:
    "Appel abandonné par le demandeur avant la fin de la lecture. La source n'a rien refusé, et rien n'est déduit de cet abandon",
  EGRESS_BLOCKED:
    "Sortie réseau refusée par la politique d'exécution : la requête n'a pas atteint la source, ce n'est donc pas une réponse de sa part",
  NETWORK: "Échec réseau avant toute réponse de la source. Aucune valeur n'en est tirée",
} as const;

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

/**
 * TYPE DE CONTENU ACCEPTÉ : `application/json` et les types structurés compatibles
 * `application/<quelque chose>+json`.
 *
 * Les PARAMÈTRES sont autorisés et ignorés : `application/json; charset=utf-8` est du JSON,
 * et exiger un en-tête nu refuserait des fournisseurs parfaitement conformes.
 * `application/problem+json` (RFC 9457) l'est aussi — c'est justement la forme dans laquelle
 * une API sérieuse décrit son erreur, et refuser de la parser perdrait le diagnostic.
 *
 * Un en-tête ABSENT est refusé sur le chemin de succès. Ce n'est pas un formalisme : le corps
 * qui arrive sans type déclaré est typiquement une page de portail captif ou de maintenance
 * en HTTP 200, et la parser « au cas où » revient à accepter que n'importe quoi devienne une
 * donnée patrimoniale.
 */
export function isJsonContentType(header: string | null): boolean {
  if (header === null) return false;
  const essence = header.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (essence === "application/json") return true;
  return essence.startsWith("application/") && essence.endsWith("+json");
}

/** Type annoncé, réduit à son essence et borné : un en-tête est une donnée EXTERNE. */
function declaredContentType(header: string | null): string {
  if (header === null) return "aucun";
  const essence = header.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  // Seuls les caractères d'un type MIME sont conservés, et la longueur est bornée : un
  // en-tête est écrit par le fournisseur, et il finit dans un diagnostic persisté.
  const safe = essence.replace(/[^a-z0-9!#$&^_.+-/]/g, "");
  if (safe.length === 0) return "illisible";
  return safe.length > 64 ? `${safe.slice(0, 64)}…` : safe;
}

/** `Content-Length` annoncé. `null` dès qu'il est absent, non numérique ou négatif. */
function declaredLength(response: Response): number | null {
  const header = response.headers?.get?.("content-length");
  if (!header) return null;
  // CHIFFRES ASCII UNIQUEMENT, comme HTTP le définit. `Number()` accepterait `1e9`, `0x10`,
  // `Infinity` ou ` 12 ` : un en-tête non conforme deviendrait alors un plafond de un
  // milliard d'octets, et le refus AVANT lecture tomberait sur une réponse parfaitement
  // petite. Un en-tête illisible est traité comme ABSENT — la lecture bornée tranche seule,
  // ce qu'elle sait faire.
  const trimmed = header.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

interface BodyRead {
  /** Texte décodé, uniquement quand la lecture a abouti sous le plafond. */
  text: string;
  /** Octets réellement lus. `null` quand rien n'a pu être lu. */
  bytes: number | null;
  outcome: "OK" | "UNREADABLE" | "TOO_LARGE";
}

/**
 * LECTURE INCRÉMENTALE ET BORNÉE.
 *
 * `response.text()` accumule tout le corps avant de rendre la main : sur un flux sans fin, ou
 * simplement très gros, il n'y a pas de réponse à examiner — le processus meurt d'abord, et
 * l'instantané d'échec qui aurait dû être persisté ne l'est jamais. La lecture se fait donc
 * morceau par morceau, et s'interrompt au PREMIER morceau qui fait passer le total au-delà du
 * plafond. Le reader est annulé, ce qui ferme la connexion : sans cela le fournisseur
 * continuerait d'émettre dans le vide.
 *
 * Le décodage n'a lieu qu'APRÈS : décoder au fil de l'eau obligerait à gérer un caractère
 * multi-octets coupé entre deux morceaux, pour aucun gain — le plafond porte sur les octets.
 */
async function readBodyBounded(response: Response, maxBytes: number): Promise<BodyRead> {
  const body = response.body;

  // Pas de flux exposé : ni un corps vide ni une anomalie. Certaines implémentations de
  // `Response` (et les doubles de test) ne portent pas de `body` lisible ; on retombe alors
  // sur la lecture globale, qui reste bornée par le plafond APRÈS coup. C'est moins bon, et
  // c'est pourquoi le chemin par flux est le chemin normal.
  if (!body || typeof body.getReader !== "function") {
    try {
      const text = await response.text();
      const bytes = Buffer.byteLength(text, "utf8");
      if (bytes > maxBytes) return { text: "", bytes, outcome: "TOO_LARGE" };
      return { text, bytes, outcome: "OK" };
    } catch {
      return { text: "", bytes: null, outcome: "UNREADABLE" };
    }
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || value.byteLength === 0) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        // Annulation IMMÉDIATE : la connexion se ferme, le fournisseur cesse d'émettre, et
        // les morceaux déjà accumulés sont jetés — un JSON tronqué ne se parse pas, et un
        // JSON tronqué qui se parserait par accident serait bien pire.
        await reader.cancel().catch(() => undefined);
        return { text: "", bytes: total, outcome: "TOO_LARGE" };
      }
      chunks.push(value);
    }
  } catch {
    await reader.cancel().catch(() => undefined);
    return { text: "", bytes: null, outcome: "UNREADABLE" };
  }

  return { text: Buffer.concat(chunks).toString("utf8"), bytes: total, outcome: "OK" };
}

/**
 * Compose le signal de l'appelant avec le délai interne.
 *
 * `AbortSignal.any` ferait le travail en une ligne, mais il ne dit pas LAQUELLE des deux
 * causes a tranché, et la distinction compte : un abandon du demandeur n'est pas une lenteur
 * de la source, et l'un se réessaie quand l'autre non. Le contrôleur est donc explicite, et
 * l'écouteur posé sur le signal de l'appelant est RETIRÉ à la fin de chaque tentative — sur
 * une requête entrante longue, trois tentatives laisseraient sinon trois écouteurs sur un
 * signal qui vit plus longtemps qu'elles.
 */
interface ComposedAbort {
  signal: AbortSignal;
  /** Cause réellement survenue, lue APRÈS l'échec. */
  cause(): "TIMEOUT" | "CANCELLED" | null;
  release(): void;
}

function composeAbort(callerSignal: AbortSignal | undefined, timeoutMs: number): ComposedAbort {
  const controller = new AbortController();
  let cause: "TIMEOUT" | "CANCELLED" | null = null;

  const timer = setTimeout(() => {
    if (cause === null) cause = "TIMEOUT";
    controller.abort();
  }, timeoutMs);

  const onCallerAbort = () => {
    if (cause === null) cause = "CANCELLED";
    controller.abort();
  };

  if (callerSignal) {
    // Déjà abandonné AVANT la tentative : le cas d'un appelant qui renonce entre deux
    // réessais. `addEventListener` ne se déclencherait jamais, et l'appel partirait.
    if (callerSignal.aborted) onCallerAbort();
    else callerSignal.addEventListener("abort", onCallerAbort, { once: true });
  }

  return {
    signal: controller.signal,
    cause: () => cause,
    release: () => {
      clearTimeout(timer);
      callerSignal?.removeEventListener("abort", onCallerAbort);
    },
  };
}

function failed(
  code: TransportFailureCode,
  message: string,
  attempts: number,
  extra: Partial<TransportResult> = {},
): TransportResult {
  return {
    httpStatus: null,
    payload: null,
    payloadBytes: null,
    rawText: "",
    errorCode: code,
    errorMessage: message,
    attempts,
    providerUpdatedAt: null,
    ...extra,
  };
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
  // REFUS AVANT TOUT RÉSEAU. `Math.max(1, …)` coerçait en silence une configuration
  // absurde en configuration plausible : `0` devenait 1, `Infinity` restait infini. Une
  // configuration inutilisable est un ÉCHEC, pas une valeur à corriger d'office.
  const configFailure = invalidResponseLimit(config.maxResponseBytes);
  if (configFailure !== null) {
    return failed("CONFIG_INVALID", configFailure, 0);
  }
  const maxBytes = config.maxResponseBytes;
  let attempts = 0;
  let last: TransportResult = failed("NETWORK", "Aucune tentative effectuée", 0);

  for (let attempt = 1; attempt <= Math.max(1, config.maxAttempts); attempt += 1) {
    // Abandon de l'appelant constaté AVANT d'engager quoi que ce soit : ni attente de quota,
    // ni jeton consommé, ni appel émis pour une réponse que personne n'attend plus.
    if (request.signal?.aborted) {
      return failed("CANCELLED", FAILURE_DIAGNOSTICS.CANCELLED, attempts);
    }

    const wait = limiter.waitFor();
    if (wait > 0) {
      if (wait > config.maxRateLimitWaitMs) {
        return failed(
          "RATE_LIMITED",
          `Quota du fournisseur atteint : ${Math.ceil(wait / 1000)} s d'attente nécessaires, ` +
            "au-delà de l'attente acceptée. La requête n'a PAS été émise, et la source n'a donc rien refusé",
          attempts,
        );
      }
      await config.sleep(wait);
      // SIGNAL REVÉRIFIÉ APRÈS L'ATTENTE. Le contrôle d'entrée de boucle a eu lieu AVANT
      // l'attente : sur un quota atteint, l'appelant a eu tout le temps de renoncer
      // pendant qu'on patientait. Sans ce second contrôle, on consommerait un jeton local
      // et on émettrait une requête pour une réponse que plus personne n'attend — puis on
      // la réessaierait. L'ordre est donc : attendre, RE-CONTRÔLER, puis seulement
      // `record()` et `fetchImpl`.
      if (request.signal?.aborted) {
        return failed("CANCELLED", FAILURE_DIAGNOSTICS.CANCELLED, attempts);
      }
    }

    attempts += 1;
    const abort = composeAbort(request.signal, config.timeoutMs);
    try {
      limiter.record();
      const response = await config.fetchImpl(request.url, {
        method: "GET",
        headers: { accept: "application/json", ...(request.headers ?? {}) },
        signal: abort.signal,
        redirect: "follow",
        // Le cache HTTP ne décide pas de la fraîcheur d'un fait patrimonial : la péremption
        // est déclarée par la connexion et portée par l'instantané persisté.
        cache: "no-store",
      });
      const statusError = classifyHttpStatus(response.status);
      const providerUpdatedAt = readLastModified(response);

      // REFUS AVANT LECTURE sur une longueur annoncée au-delà du plafond. Aucun octet de
      // corps n'est alors accumulé : c'est le seul cas où le fournisseur nous permet de
      // décider sans rien lire, et il serait absurde de ne pas s'en servir.
      const announced = declaredLength(response);
      if (announced !== null && announced > maxBytes) {
        // Le flux est explicitement annulé : sans cela la connexion resterait ouverte et le
        // fournisseur continuerait d'émettre un corps que personne ne lira.
        await response.body?.cancel().catch(() => undefined);
        return failed(
          "RESPONSE_TOO_LARGE",
          tooLargeDiagnostic(announced, maxBytes, true),
          attempts,
          {
            httpStatus: response.status,
            providerUpdatedAt,
          },
        );
      }

      // TYPE DE CONTENU, AVANT TOUTE LECTURE, sur le chemin de SUCCÈS uniquement.
      //
      // L'ordre est le finding : ce contrôle avait lieu APRÈS la lecture bornée, donc une
      // page HTML de portail captif rendue en HTTP 200 était intégralement téléchargée —
      // jusqu'à 4 Mio — pour être ensuite refusée. Décider sur l'en-tête ne coûte rien, et
      // le corps est explicitement ANNULÉ : la connexion se ferme, le fournisseur cesse
      // d'émettre, et aucun contenu n'est ni lu ni restitué.
      //
      // Sur un statut d'ERREUR, le type n'est PAS exigé : un corps HTML ou texte y est la
      // norme et il sert au diagnostic. Le statut, lui, est conservé dans les deux cas.
      const contentType = response.headers?.get?.("content-type") ?? null;
      if (!statusError && !isJsonContentType(contentType)) {
        await response.body?.cancel().catch(() => undefined);
        return failed(
          "INVALID_RESPONSE",
          `Type de contenu non JSON reçu en HTTP ${response.status} (annoncé : ${declaredContentType(contentType)}) : le corps n'est PAS lu, et aucune valeur n'en est tirée`,
          attempts,
          { httpStatus: response.status, providerUpdatedAt },
        );
      }

      // LECTURE DE CORPS PROTÉGÉE ET BORNÉE. Un corps interrompu ne doit pas faire PERDRE le
      // statut que la source a réellement rendu : sans ce garde, un 503 dont le corps se
      // coupe serait classé « erreur réseau », et le diagnostic désignerait la mauvaise
      // cause. Le plafond s'applique quoi qu'ait annoncé le fournisseur.
      const read = await readBodyBounded(response, maxBytes);

      if (statusError) {
        // Le statut de la source PRIME sur ce que sa taille de corps a provoqué : un 503 dont
        // le corps déborde reste un 503, et le requalifier en « réponse trop grosse » ferait
        // chercher un problème de volume là où la source est en panne.
        last = {
          httpStatus: response.status,
          payload: null,
          payloadBytes: read.bytes,
          rawText: "",
          errorCode: statusError,
          errorMessage: errorStatusDiagnostic(response.status, read),
          attempts,
          providerUpdatedAt,
        };
        if (!RETRYABLE_TRANSPORT_FAILURES.includes(statusError)) return last;
        if (attempt < config.maxAttempts) await config.sleep(backoffDelay(attempt, config));
        continue;
      }

      if (read.outcome === "TOO_LARGE") {
        return failed(
          "RESPONSE_TOO_LARGE",
          tooLargeDiagnostic(read.bytes ?? maxBytes, maxBytes, false),
          attempts,
          { httpStatus: response.status, payloadBytes: read.bytes, providerUpdatedAt },
        );
      }

      if (read.outcome === "UNREADABLE") {
        // Un 2xx dont le corps ne se lit pas : la source a répondu, mais rien n'est
        // exploitable. C'est un échec de CONTRAT, pas de réseau, et il n'est pas retryable.
        return failed(
          "INVALID_RESPONSE",
          `Corps illisible reçu en HTTP ${response.status} : le statut est conservé, aucune valeur n'en est tirée`,
          attempts,
          { httpStatus: response.status, providerUpdatedAt },
        );
      }

      let payload: unknown;
      try {
        payload = JSON.parse(read.text) as unknown;
      } catch {
        // Un 200 annoncé JSON qui n'en est pas est un échec de CONTRAT, non retryable : la
        // source a répondu, simplement pas ce qu'elle documente. Le corps n'est PAS cité :
        // une page d'erreur ré-affiche couramment la requête reçue, jetons compris.
        return failed(
          "INVALID_RESPONSE",
          `Corps annoncé JSON mais non analysable, reçu en HTTP ${response.status} (${read.bytes ?? 0} octets) : aucune valeur n'en est tirée`,
          attempts,
          { httpStatus: response.status, payloadBytes: read.bytes, providerUpdatedAt },
        );
      }

      return {
        httpStatus: response.status,
        payload,
        payloadBytes: read.bytes,
        rawText: read.text,
        errorCode: null,
        errorMessage: null,
        attempts,
        providerUpdatedAt,
      };
    } catch (error) {
      // Un abandon est classé par SA CAUSE RÉELLE, pas par le nom de l'exception : le
      // contrôleur composé lève un `AbortError` dans les deux cas, et confondre l'abandon du
      // demandeur avec un dépassement de délai accuserait la source d'une lenteur qu'elle
      // n'a pas eue — et relancerait un appel dont plus personne n'attend le résultat.
      const abortCause = abort.cause();
      if (abortCause !== null) {
        last = failed(abortCause, FAILURE_DIAGNOSTICS[abortCause], attempts);
        if (abortCause === "CANCELLED") return last;
        if (attempt < config.maxAttempts) await config.sleep(backoffDelay(attempt, config));
        continue;
      }

      const classified = classifyFetchFailure(error);
      last = failed(classified.code, classified.message, attempts);
      // Une sortie réseau refusée par la politique d'exécution ne se réessaie pas.
      if (classified.code === "EGRESS_BLOCKED") return last;
      if (attempt < config.maxAttempts) await config.sleep(backoffDelay(attempt, config));
    } finally {
      // Timer ET écouteur : sur une requête entrante longue, trois tentatives laisseraient
      // sinon trois écouteurs accrochés à un signal qui vit plus longtemps qu'elles.
      abort.release();
    }
  }

  return last;
}

/**
 * Diagnostic de dépassement. Il nomme la CAUSE du refus — annonce du fournisseur ou lecture
 * réelle — parce que les deux ne se corrigent pas de la même façon : une annonce fausse est
 * un problème de fournisseur, un dépassement réel un problème de plafond ou de pagination.
 */
function tooLargeDiagnostic(bytes: number, maxBytes: number, announced: boolean): string {
  const observed = announced
    ? `longueur annoncée par la source : ${bytes} octets`
    : `lecture interrompue à ${bytes} octets`;
  return (
    `Corps au-delà du plafond de ${maxBytes} octets (${observed}). ` +
    (announced
      ? "Aucun octet n'a été lu"
      : "Le flux a été interrompu et les octets déjà reçus sont écartés") +
    " : c'est NOTRE plafond qui tranche, la source n'a rien refusé, et aucune absence de donnée n'en est déduite"
  );
}

/**
 * Diagnostic d'un statut d'erreur. Le corps du fournisseur n'est PAS cité, seulement mesuré :
 * une page d'erreur ré-affiche couramment la requête reçue, chaîne de requête et jetons
 * compris, et ce message est persisté puis affiché.
 */
function errorStatusDiagnostic(status: number, read: BodyRead): string {
  if (read.outcome === "UNREADABLE") {
    return `HTTP ${status} : corps illisible, le statut rendu par la source est conservé`;
  }
  if (read.outcome === "TOO_LARGE") {
    return `HTTP ${status} : corps au-delà du plafond de lecture, interrompu à ${read.bytes ?? 0} octets. Le statut rendu par la source est conservé`;
  }
  return `HTTP ${status} : corps reçu de ${read.bytes ?? 0} octets, non repris dans ce diagnostic. Le statut rendu par la source est conservé`;
}

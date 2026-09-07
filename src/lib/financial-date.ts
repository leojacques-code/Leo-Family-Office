import { monthBounds } from "@/lib/engine/debt";

/**
 * Contexte de date financière.
 *
 * Une constante `AS_OF_DATE = "2026-08-19"` portait trois rôles à la fois, et c'est la raison
 * pour laquelle l'écran annonçait le 19 août 2026 comme « aujourd'hui » :
 *
 *   R1 date de reporting : la date d'arrêté, qui doit rester IMMUABLE dans un rapport ;
 *   R2 date opérationnelle : « aujourd'hui », qui doit AVANCER ;
 *   R3 date de repli : une date inventée quand une observation n'en portait pas.
 *
 * R3 n'est pas un rôle : c'est un bug. Une date fabriquée est du même ordre qu'un zéro
 * fabriqué, et un solde sans observation datée se présentait comme observé au 19 août. Ce
 * module ne fournit donc AUCUNE date de repli : il n'expose que R1 et R2, nommées.
 *
 * DATE DE REPORTING ≠ DATE OPÉRATIONNELLE. Les confondre, c'est soit geler l'écran sur une
 * clôture, soit faire varier un rapport arrêté d'un jour sur l'autre.
 */
export interface FinancialDateContext {
  /**
   * Date civile courante dans le fuseau de reporting, au format `YYYY-MM-DD`.
   *
   * C'est ce que l'utilisateur appelle « aujourd'hui » : la fenêtre de ledger, l'année
   * fiscale en vigueur, la fraîcheur d'une observation et les échéances à venir s'y
   * rattachent. Elle ne vient jamais du navigateur, dont l'horloge n'est pas une source.
   */
  readonly today: string;
  /**
   * Date d'arrêté du reporting, au format `YYYY-MM-DD`.
   *
   * C'est la date à laquelle le patrimoine est présenté. Elle reste immuable tant qu'aucune
   * clôture plus récente n'est persistée, de sorte qu'un rapport déjà lu ne change pas de
   * chiffres entre deux consultations.
   */
  readonly asOfDate: string;
  /**
   * Origine de `asOfDate`. Ce n'est pas un niveau de confiance : c'est la réponse à
   * « d'où vient cette date ». Une date d'arrêté repliée sur le jour courant faute de
   * clôture est une information, et la surface a le droit de la signaler.
   */
  readonly asOfDateSource: AsOfDateSource;
  /** Mois calendaire contenant `asOfDate`. */
  readonly reportingPeriod: ReportingPeriod;
  /** Fuseau dans lequel `today` est une date civile et non un instant. */
  readonly timezone: string;
}

export type AsOfDateSource =
  /** Une clôture mensuelle persistée porte cette date. */
  | "MONTHLY_CLOSE"
  /** Aucune clôture n'existe : la date d'arrêté se replie sur le jour courant. */
  | "TODAY";

export interface ReportingPeriod {
  /** Premier jour du mois, `YYYY-MM-DD`. */
  readonly start: string;
  /** Dernier jour du mois, `YYYY-MM-DD`. */
  readonly end: string;
  /** Mois au format `YYYY-MM`, utile comme clé stable. */
  readonly month: string;
}

/**
 * Fuseau de reporting du produit.
 *
 * Il n'est pas déduit de l'environnement : un serveur en UTC et un utilisateur à Paris ne
 * sont pas le même jour pendant deux heures chaque nuit, et une échéance au 1er du mois
 * basculerait la veille. Le pilotage de ce fuseau par l'utilisateur appartient à la page
 * Settings, qui n'existe pas encore ; en attendant, la valeur est déclarée ici et nulle
 * part ailleurs.
 */
export const REPORTING_TIMEZONE = "Europe/Paris";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Date civile d'un instant dans un fuseau donné.
 *
 * `Date` ne porte pas de fuseau : `toISOString()` répond en UTC, ce qui décale la date d'un
 * jour pendant les premières heures de la journée parisienne en heure d'été. La conversion
 * passe donc par `Intl`, qui est la seule source de vérité de fuseau de la plateforme.
 */
export function civilDateIn(instant: Date, timezone: string): string {
  if (Number.isNaN(instant.getTime())) {
    throw new Error("Date financière invalide : instant non représentable");
  }
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
  // `en-CA` rend déjà `YYYY-MM-DD`. On le vérifie plutôt que de le supposer : une
  // plateforme sans données ICU complètes rendrait autre chose, et une date mal formée
  // traverserait ensuite toutes les comparaisons de chaînes du produit.
  if (!ISO_DATE.test(parts)) {
    throw new Error(`Date financière invalide : fuseau "${timezone}" a rendu "${parts}"`);
  }
  return parts;
}

/**
 * Construit le contexte de date à partir des clôtures réellement persistées.
 *
 * `closeDates` porte les dates de clôture connues, dans n'importe quel ordre : la plus
 * récente est retenue. Une liste vide n'est pas une erreur, c'est le cas d'un profil neuf,
 * et la date d'arrêté se replie alors sur le jour courant en le DÉCLARANT.
 *
 * Une clôture postérieure au jour courant est ignorée : une date d'arrêté dans le futur
 * présenterait un patrimoine qui n'a pas encore été observé.
 */
export function buildFinancialDateContext(input: {
  closeDates: readonly string[];
  now?: Date;
  timezone?: string;
}): FinancialDateContext {
  const timezone = input.timezone ?? REPORTING_TIMEZONE;
  const today = civilDateIn(input.now ?? new Date(), timezone);
  const latestClose = input.closeDates
    .filter((date) => ISO_DATE.test(date) && date <= today)
    .reduce<string | null>((best, date) => (best === null || date > best ? date : best), null);
  const asOfDate = latestClose ?? today;
  const bounds = monthBounds(asOfDate);
  return {
    today,
    asOfDate,
    asOfDateSource: latestClose === null ? "TODAY" : "MONTHLY_CLOSE",
    reportingPeriod: { start: bounds.start, end: bounds.end, month: asOfDate.slice(0, 7) },
    timezone,
  };
}

/**
 * Contexte de date pour un périmètre qui n'a pas de clôture à consulter.
 *
 * Les repositories d'acquisition datent des lectures et des écritures, pas un arrêté de
 * reporting : ils n'ont besoin que du jour courant. Cette fonction leur évite de charger
 * les clôtures pour rien, et surtout de retomber sur une constante.
 */
export function operationalDateContext(
  now?: Date,
  timezone = REPORTING_TIMEZONE,
): FinancialDateContext {
  return buildFinancialDateContext({ closeDates: [], now, timezone });
}

/**
 * Jour courant seul, pour les rares appelants qui n'ont pas de contexte à porter.
 *
 * Les schémas de validation en sont : un `refine` de zod s'évalue à la lecture, donc il lit
 * la date au moment où il valide et non au chargement du module. C'est exactement ce qu'il
 * faut, et c'est ce qu'une constante ne pouvait pas faire : un serveur démarré en août
 * refusait encore en septembre toute date postérieure au 19 août.
 */
export function operationalToday(now?: Date, timezone = REPORTING_TIMEZONE): string {
  return civilDateIn(now ?? new Date(), timezone);
}

/** Année fiscale en vigueur à la date opérationnelle. Jamais celle de la date d'arrêté. */
export function currentTaxYear(context: FinancialDateContext): number {
  return Number(context.today.slice(0, 4));
}

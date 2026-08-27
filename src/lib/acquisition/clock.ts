/**
 * DATE D'OBSERVATION D'UN IMPORT — fuseau explicite, jamais implicite.
 *
 * Un relevé bancaire porte des dates LOCALES. Comparer une de ces dates à une date UTC
 * produit un décalage d'un jour pendant une partie de chaque nuit : à 00 h 30 à Paris en
 * été, l'UTC est encore la veille, et une opération datée du jour serait signalée « après
 * le jour de l'import ». Ce n'est pas une perte de donnée, mais c'est une anomalie
 * fabriquée par le logiciel, que l'utilisateur devrait arbitrer sans raison.
 *
 * Le fuseau est donc DÉCLARÉ, pas déduit de l'horloge du serveur — un conteneur déployé
 * ailleurs ne doit pas changer la lecture d'un relevé.
 */

/** Fuseau par défaut du produit. Surchargeable par `LFO_TIME_ZONE`. */
export const DEFAULT_TIME_ZONE = "Europe/Paris";

/**
 * Date civile d'un instant dans un fuseau donné, au format `AAAA-MM-JJ`.
 *
 * Fonction pure : l'instant est reçu en paramètre. Aucun appel à l'horloge ici, pour que le
 * comportement de nuit soit testable au lieu d'être constaté en production.
 */
export function civilDateIn(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  const year = value("year");
  const month = value("month");
  const day = value("day");
  if (year.length !== 4 || month.length !== 2 || day.length !== 2) {
    throw new Error(`Fuseau horaire inexploitable pour la date d'observation : ${timeZone}`);
  }
  return `${year}-${month}-${day}`;
}

/**
 * Fuseau retenu pour l'acquisition. Un fuseau inconnu ÉCHOUE : se replier en silence sur
 * l'UTC réintroduirait exactement le décalage que cette primitive existe pour éviter.
 */
export function resolveTimeZone(configured: string | undefined): string {
  const timeZone = configured?.trim() || DEFAULT_TIME_ZONE;
  try {
    civilDateIn(new Date(0), timeZone);
  } catch {
    throw new Error(`Variable LFO_TIME_ZONE invalide : ${timeZone}`);
  }
  return timeZone;
}

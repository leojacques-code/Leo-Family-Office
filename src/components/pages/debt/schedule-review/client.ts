import type { ExtractionFieldStatus, ExtractionRunStatus } from "@/lib/acquisition/documents/types";

/** Appel de la route des échéanciers déposés. */
export class ScheduleCallError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
  }
}

export const SCHEDULE_ROUTE = "/api/debt/schedule-documents";

export async function callSchedule<T>(query: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${SCHEDULE_ROUTE}${query}`, init);
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      body && typeof body === "object" && "error" in body && typeof body.error === "string"
        ? body.error
        : "La demande n’a pas abouti.";
    // Le garde SQL est partagé avec des lectures rattachables au patrimoine. Dans cette
    // revue, valider confirme la pièce seulement : le rattachement reste une autre action.
    const readingMessage = message.replace(
      "valider ferait entrer dans le patrimoine une lecture que le document contredit",
      "la lecture contredit encore la pièce ; corrigez les écarts avant de la valider",
    );
    throw new ScheduleCallError(readingMessage, response.status, body);
  }
  return body as T;
}

/**
 * Télécharge la pièce conservée par un lien signé d'une minute. Le lien porte une disposition
 * de téléchargement : naviguer vers lui ne quitte pas la page, et un `window.open` après un
 * appel réseau serait bloqué comme fenêtre non sollicitée.
 */
export async function openPiece(runId: string) {
  const { url } = await callSchedule<{ url: string }>(`?piece=${encodeURIComponent(runId)}`);
  window.location.assign(url);
}

export const RUN_STATUS_LABELS: Record<ExtractionRunStatus, string> = {
  EXTRACTED: "À examiner",
  OCR_REQUIRED: "Illisible sans reconnaissance de caractères",
  FAILED: "Lecture impossible",
  REVIEWED: "Examinée",
  VALIDATED: "Lecture validée",
  LINKED: "Rattachée au prêt",
  REJECTED: "Lecture refusée",
};

export const FIELD_STATUS_LABELS: Record<ExtractionFieldStatus, string> = {
  EXTRACTED: "Lue",
  REVIEWED: "Confirmée",
  CORRECTED: "Corrigée",
  REJECTED: "Écartée",
  BLOCKED: "Illisible",
  UNKNOWN_BOX: "Colonne non reconnue",
};

/** Une lecture se décide tant qu'elle n'est ni validée, ni refusée, ni en échec. */
export function runIsOpen(status: ExtractionRunStatus): boolean {
  return status === "EXTRACTED" || status === "REVIEWED";
}

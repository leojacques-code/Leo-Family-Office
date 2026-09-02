import type { AdvisorPacket } from "@/lib/advisor/advisor-types";

export type AdvisorProviderStatus =
  "DISABLED" | "READY" | "BLOCKED_EXTERNAL" | "TEMPORARY_ERROR" | "INVALID_RESPONSE";

export interface AdvisorExplanationSection {
  insightId: string;
  evidenceIds: string[];
  text: string;
}

export interface AdvisorExplanation {
  status: "EXPLAINED";
  sections: AdvisorExplanationSection[];
}

export interface AdvisorExplanationProvider {
  readonly id: string;
  explain(packet: Readonly<AdvisorPacket>, signal?: AbortSignal): Promise<AdvisorExplanation>;
}

export type AdvisorExplanationResult =
  | AdvisorExplanation
  | { status: "BLOCKED_EXTERNAL" | "TEMPORARY_ERROR" | "INVALID_RESPONSE"; message: string };

function sectionIsGrounded(packet: AdvisorPacket, section: AdvisorExplanationSection): boolean {
  if (
    !section ||
    typeof section.text !== "string" ||
    section.text.length === 0 ||
    section.text.length > 1_000 ||
    !Array.isArray(section.evidenceIds) ||
    section.evidenceIds.length === 0
  )
    return false;
  const insight = packet.insights.find((item) => item.id === section.insightId);
  if (!insight) return false;
  const available = new Map(insight.evidence.map((proof) => [proof.id, proof]));
  if (section.evidenceIds.some((id) => !available.has(id))) return false;
  const cited = section.evidenceIds.map((id) => available.get(id)!);
  const dates = new Set(cited.map((proof) => proof.date));
  const currencies = new Set(cited.flatMap((proof) => (proof.currency ? [proof.currency] : [])));
  const numbers = new Set(
    cited.flatMap((proof) =>
      proof.amount === null ? [] : [String(proof.amount), String(proof.amount).replace(".", ",")],
    ),
  );
  const datesInText = section.text.match(/\b\d{4}-\d{2}-\d{2}\b/g) ?? [];
  if (datesInText.some((date) => !dates.has(date))) return false;
  const withoutDates = section.text.replace(/\b\d{4}-\d{2}-\d{2}\b/g, "");
  const numericClaims = withoutDates.match(/(?<![\p{L}\d])[-+]?\d+(?:[.,]\d+)?%?/gu) ?? [];
  if (numericClaims.some((claim) => claim.endsWith("%") || !numbers.has(claim.replace(/^\+/, ""))))
    return false;
  const currencyClaims = section.text.match(/\b[A-Z]{3}\b/g) ?? [];
  return currencyClaims.every((currency) => currencies.has(currency));
}

/**
 * La sortie externe ne remplace jamais le paquet. Elle n'est acceptée que si toutes ses
 * sections pointent vers les preuves de leur insight. Cette validation borne les affirmations
 * factuelles explicites ; elle ne transforme jamais la reformulation en vérité financière.
 */
export async function explainAdvisorPacket(
  packet: AdvisorPacket,
  provider?: AdvisorExplanationProvider,
  timeoutMs = 3_000,
): Promise<AdvisorExplanationResult> {
  if (!provider)
    return { status: "BLOCKED_EXTERNAL", message: "Aucun provider génératif configuré." };
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const providerPromise = Promise.resolve().then(() =>
    provider.explain(structuredClone(packet), controller.signal),
  );
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      reject(new DOMException("timeout", "AbortError"));
    }, timeoutMs);
  });
  try {
    const result = await Promise.race([providerPromise, timeoutPromise]);
    if (
      !result ||
      result.status !== "EXPLAINED" ||
      !Array.isArray(result.sections) ||
      result.sections.length === 0 ||
      result.sections.length > 10 ||
      result.sections.some((section) => !sectionIsGrounded(packet, section))
    )
      return {
        status: "INVALID_RESPONSE",
        message: "La reformulation externe ne respecte pas le contrat de preuve.",
      };
    return { status: "EXPLAINED", sections: structuredClone(result.sections) };
  } catch (error) {
    return {
      status: "TEMPORARY_ERROR",
      message:
        error instanceof DOMException && error.name === "AbortError"
          ? "Le provider a dépassé le délai autorisé."
          : "Le provider est temporairement indisponible.",
    };
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

/** Fixture injectable réservée aux tests ; aucune dépendance ni appel réseau. */
export class FixtureAdvisorExplanationProvider implements AdvisorExplanationProvider {
  readonly id = "fixture";
  constructor(private readonly response: AdvisorExplanation) {}
  async explain(): Promise<AdvisorExplanation> {
    return structuredClone(this.response);
  }
}

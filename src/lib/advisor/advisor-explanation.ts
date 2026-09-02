import type { AdvisorPacket } from "@/lib/advisor/advisor-types";

export interface AdvisorExplanation {
  status: "EXPLAINED";
  text: string;
  evidenceIds: string[];
}

export interface AdvisorExplanationProvider {
  readonly id: string;
  explain(packet: Readonly<AdvisorPacket>, signal?: AbortSignal): Promise<AdvisorExplanation>;
}

export type AdvisorExplanationResult =
  | AdvisorExplanation
  | { status: "BLOCKED_EXTERNAL" | "TEMPORARY_ERROR" | "INVALID_RESPONSE"; message: string };

const evidenceIds = (packet: AdvisorPacket) =>
  new Set(packet.insights.flatMap((item) => item.evidence.map((proof) => proof.id)));

/**
 * La sortie externe ne remplace jamais le paquet. Elle n'est acceptée que si toutes ses
 * affirmations pointent vers les preuves autorisées ; nombres, priorités et CTA restent ceux du Core.
 */
export async function explainAdvisorPacket(
  packet: AdvisorPacket,
  provider?: AdvisorExplanationProvider,
  timeoutMs = 3_000,
): Promise<AdvisorExplanationResult> {
  if (!provider)
    return { status: "BLOCKED_EXTERNAL", message: "Aucun provider génératif configuré." };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const result = await provider.explain(structuredClone(packet), controller.signal);
    if (
      !result ||
      result.status !== "EXPLAINED" ||
      typeof result.text !== "string" ||
      result.text.length > 2_000 ||
      !Array.isArray(result.evidenceIds) ||
      result.evidenceIds.length === 0 ||
      result.evidenceIds.some((id) => !evidenceIds(packet).has(id))
    )
      return {
        status: "INVALID_RESPONSE",
        message: "La reformulation externe ne respecte pas le contrat de preuve.",
      };
    return {
      status: "EXPLAINED",
      text: result.text,
      evidenceIds: [...new Set(result.evidenceIds)].sort(),
    };
  } catch (error) {
    return {
      status: "TEMPORARY_ERROR",
      message:
        error instanceof DOMException && error.name === "AbortError"
          ? "Le provider a dépassé le délai autorisé."
          : "Le provider est temporairement indisponible.",
    };
  } finally {
    clearTimeout(timeout);
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

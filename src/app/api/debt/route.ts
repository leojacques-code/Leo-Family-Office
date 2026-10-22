import { NextResponse } from "next/server";
import { requireAuthenticated } from "@/lib/auth";
import { getRepository } from "@/lib/data/repository";
import { API_HEADERS } from "@/lib/http";
import { mutationSchema } from "@/lib/validation/mutations";
import { MutationConflictError, MutationRejectedError } from "@/lib/data/mutation-errors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function failure(error: unknown, message: string) {
  // Refus MÉTIER : message fixe rédigé par le repository, jamais celui de la base.
  if (error instanceof MutationConflictError)
    return NextResponse.json(
      { error: error.message, code: "CONFLICT" },
      { status: 409, headers: API_HEADERS },
    );
  if (error instanceof MutationRejectedError)
    return NextResponse.json(
      { error: error.message, code: "REJECTED" },
      { status: 422, headers: API_HEADERS },
    );
  const unauthorized = error instanceof Error && error.message === "UNAUTHORIZED";
  // Le fournisseur, les pièces et les montants n'entrent pas dans le journal HTTP.
  if (!unauthorized) console.error("lfo.debt.failure", { message, at: new Date().toISOString() });
  return NextResponse.json(
    { error: unauthorized ? "Non authentifié" : message },
    {
      status: unauthorized ? 401 : 500,
      headers: API_HEADERS,
    },
  );
}

export async function GET() {
  try {
    await requireAuthenticated();
    return NextResponse.json(await (await getRepository()).getDebtReadModel(), {
      headers: API_HEADERS,
    });
  } catch (error) {
    return failure(error, "Lecture des dettes impossible");
  }
}

export async function POST(request: Request) {
  try {
    await requireAuthenticated();
    const parsed = mutationSchema.safeParse(await request.json().catch(() => null));
    if (
      !parsed.success ||
      ![
        "save_debt_contract",
        "record_debt_balance",
        "record_outstanding_debt",
        "archive_debt",
        "record_debt_event",
        "cancel_debt_event",
      ].includes(parsed.data.action)
    ) {
      // Le premier motif de refus est rendu tel que le schéma le rédige : il ne cite aucune
      // valeur, et l'utilisateur sait quoi corriger sans perdre sa saisie.
      const reason = parsed.success ? null : parsed.error.issues[0]?.message;
      return NextResponse.json(
        { error: reason ? `Commande de dette invalide : ${reason}` : "Commande de dette invalide" },
        { status: 400, headers: API_HEADERS },
      );
    }
    await (await getRepository()).executeMutation(parsed.data);
    // L'écriture est acquittée avant la relecture : un échec de rafraîchissement n'est
    // jamais présenté comme un échec d'enregistrement qui inciterait à écrire en double.
    return NextResponse.json({ saved: true }, { headers: API_HEADERS });
  } catch (error) {
    return failure(error, "Enregistrement de la dette impossible");
  }
}

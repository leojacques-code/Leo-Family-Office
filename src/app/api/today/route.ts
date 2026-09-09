import { NextResponse } from "next/server";
import { z } from "zod";
import { API_HEADERS } from "@/lib/http";
import { requireAuthenticated } from "@/lib/auth";
import { getRepository } from "@/lib/data/repository";
import { getTodayReadModel } from "@/lib/data/read-models/today";
import { DOMAIN_IDS } from "@/lib/presentation/today/domains";
import { operationalToday } from "@/lib/financial-date";

/**
 * Route d'Aujourd'hui : son modèle de lecture, et la seule écriture que la page autorise.
 *
 * ELLE NE REND JAMAIS `DashboardState`. Le §10.2 : « une mutation ne doit plus renvoyer tout
 * DashboardState. Elle renvoie l'entité affectée, la nouvelle version du modèle local ou un
 * signal d'invalidation ciblé. » Les deux verbes rendent donc le MODÈLE LOCAL, et la page
 * n'a jamais accès à l'état global — ce qui est ce qui rend la frontière réelle plutôt que
 * déclarative.
 *
 * LA SEULE ÉCRITURE EST UNE DÉCLARATION D'APPLICABILITÉ. Le §20 est explicite : « Today n'a
 * pas de formulaire financier propre ». Aucune autre mutation ne passe par ici : ajouter un
 * bien ou classer un flux appartient à son domaine, et ouvrir un second chemin d'écriture
 * depuis la page d'accueil créerait la seconde vérité que le §2 de la constitution interdit.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * La date économique de la déclaration n'est PAS reçue du client.
 *
 * Un client pourrait sinon antidater une réponse et changer laquelle est la déclaration
 * courante : le §5 de la constitution du dépôt le dit d'un cas voisin, une donnée dont le
 * « quand » est déclaratif ne répond pas à la question qu'elle prétend documenter.
 *
 * Elle vaut la date OPÉRATIONNELLE, pas la date d'arrêté. Les deux diffèrent — le §20 les
 * affiche côte à côte — et c'est la première qui est juste ici : une réponse est donnée le
 * jour où l'utilisateur la donne, pas à la clôture du dernier mois arrêté. Dater une
 * déclaration du 31 août parce que le reporting s'y arrête ferait mentir l'historique sur
 * « depuis quand ce domaine est-il masqué ».
 */
const declarationSchema = z.object({
  domain: z.enum(DOMAIN_IDS as unknown as [string, ...string[]]),
  applicability: z.enum(["APPLICABLE", "DECLARED_NONE", "UNDECIDED"]),
  // Un motif vide n'est pas un motif : il devient `null` plutôt qu'une chaîne vide, parce que
  // CHAÎNE VIDE ≠ ABSENCE et que la base refuse déjà la première.
  note: z.string().trim().min(1).max(2000).nullable().optional(),
});

function failure(error: unknown, fallback: string) {
  const unauthorized = error instanceof Error && error.message === "UNAUTHORIZED";
  if (!unauthorized) console.error(fallback, error);
  return NextResponse.json(
    { error: unauthorized ? "Non authentifié" : fallback },
    { status: unauthorized ? 401 : 500 },
  );
}

export async function GET() {
  try {
    await requireAuthenticated();
    return NextResponse.json(await getTodayReadModel(), { headers: API_HEADERS });
  } catch (error) {
    return failure(error, "Lecture impossible");
  }
}

export async function POST(request: Request) {
  try {
    await requireAuthenticated();
    const parsed = declarationSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Déclaration invalide", issues: parsed.error.flatten() },
        { status: 400 },
      );
    }
    const repository = await getRepository();
    await repository.declareDomainApplicability({
      domain: parsed.data.domain as (typeof DOMAIN_IDS)[number],
      applicability: parsed.data.applicability,
      declaredOn: operationalToday(),
      note: parsed.data.note ?? null,
    });
    // Le modèle est relu APRÈS écriture : le renvoyer construit depuis l'état d'avant ferait
    // apparaître la déclaration à l'écran suivant seulement, et l'utilisateur cliquerait deux
    // fois sur une réponse déjà enregistrée.
    return NextResponse.json(await getTodayReadModel());
  } catch (error) {
    return failure(error, "Déclaration impossible");
  }
}

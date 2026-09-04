import { NextResponse } from "next/server";
import { requireAuthenticated } from "@/lib/auth";
import { getRepository } from "@/lib/data/repository";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const allowedCategories = new Set([
  "bank",
  "investment",
  "tax",
  "real_estate",
  "business",
  "employment",
  "loan",
  "insurance",
  "other",
]);
const allowedTypes = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "text/csv",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

export async function POST(request: Request) {
  try {
    await requireAuthenticated();
    const formData = await request.formData();
    const file = formData.get("file");
    const category = String(formData.get("category") ?? "other");
    if (!(file instanceof File) || file.size === 0 || file.size > 8 * 1024 * 1024)
      return NextResponse.json({ error: "Fichier invalide ou supérieur à 8 Mo." }, { status: 400 });
    if (!allowedTypes.has(file.type))
      return NextResponse.json({ error: "Type de fichier non autorisé." }, { status: 400 });
    if (!allowedCategories.has(category))
      return NextResponse.json({ error: "Catégorie invalide." }, { status: 400 });
    const repository = await getRepository();
    const record = await repository.storeDocument({
      name: file.name.slice(0, 180),
      category,
      contentType: file.type,
      size: file.size,
      bytes: new Uint8Array(await file.arrayBuffer()),
    });
    return NextResponse.json(record, { status: 201 });
  } catch (error) {
    const unauthorized = error instanceof Error && error.message === "UNAUTHORIZED";
    if (!unauthorized) console.error("Import impossible", error);
    return NextResponse.json(
      { error: unauthorized ? "Non authentifié" : "Import impossible" },
      { status: unauthorized ? 401 : 500 },
    );
  }
}

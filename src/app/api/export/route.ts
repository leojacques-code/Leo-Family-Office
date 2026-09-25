import { requireAuthenticated } from "@/lib/auth";
import { getRepository } from "@/lib/data/repository";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function csvEscape(value: unknown) {
  const text = String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

export async function GET(request: Request) {
  await requireAuthenticated();
  const repository = await getRepository();
  const state = await repository.getDashboardState();
  const format = new URL(request.url).searchParams.get("format") ?? "json";
  if (format === "csv") {
    const rows = [
      // Montants en devise NATIVE, sans conversion : la colonne le dit, et la devise suit.
      ["type", "institution", "nom", "valeur_native", "devise", "date", "provenance"],
      ...state.accounts.map((account) => [
        "actif",
        account.institution,
        account.name,
        account.balance,
        account.currency,
        account.balanceDate,
        account.provenance.kind,
      ]),
      ...state.liabilities.map((liability) => [
        "passif",
        liability.lender,
        liability.name,
        -liability.currentBalance,
        liability.currency ?? "",
        liability.balanceDate ?? "",
        liability.provenance.kind,
      ]),
      // Encours seul : la date est celle de l'observation, jamais la date d'arrêté.
      ...(state.outstandingDebts ?? []).map((debt) => [
        "passif",
        debt.lender ?? "",
        debt.name,
        -debt.currentBalance,
        debt.currency,
        debt.balanceDate ?? "",
        debt.provenance.kind,
      ]),
    ];
    const csv = rows.map((row) => row.map(csvEscape).join(",")).join("\r\n");
    return new Response(`\uFEFF${csv}`, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="leo-family-office-${state.asOfDate}.csv"`,
      },
    });
  }
  return new Response(JSON.stringify(state, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="leo-family-office-${state.asOfDate}.json"`,
    },
  });
}

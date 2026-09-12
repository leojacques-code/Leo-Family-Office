import "server-only";

/** Incident F04 : le diagnostic ne contient ni jeton, ni URL, ni payload fournisseur. */
export function reportReadFailure(error: { message: string }, context: string): Error {
  const code = /JWT issued at future/i.test(error.message)
    ? "DATABASE_JWT_FUTURE"
    : "DATABASE_READ_FAILED";
  console.error("lfo.read.failure", {
    code,
    context: /^lecture #\d+$/.test(context) ? context : "database",
    serverTime: new Date().toISOString(),
  });
  return new Error("Les données de cette page sont momentanément indisponibles. Réessayez.");
}

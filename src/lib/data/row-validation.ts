type Row = Record<string, unknown>;

function invalid(context: string, expectation: string, value: unknown): never {
  throw new Error(`Supabase donnée invalide (${context}) : ${expectation}, reçu ${String(value)}`);
}

export function requiredField(row: Row, field: string, context: string): unknown {
  if (!Object.prototype.hasOwnProperty.call(row, field)) {
    throw new Error(
      `Schéma Supabase incomplet (${context}) : colonne obligatoire ${field} absente`,
    );
  }
  return row[field];
}

export function finiteNumber(value: unknown, context: string): number {
  if (value === null || value === undefined || value === "") {
    return invalid(context, "nombre fini obligatoire", value);
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return invalid(context, "nombre fini obligatoire", value);
  return parsed;
}

export function nullableFiniteNumber(value: unknown, context: string): number | null {
  if (value === undefined) {
    throw new Error(`Schéma Supabase incomplet (${context}) : colonne obligatoire absente`);
  }
  return value === null ? null : finiteNumber(value, context);
}

export function requiredString(value: unknown, context: string): string {
  if (value === null || value === undefined) return invalid(context, "texte obligatoire", value);
  const parsed = String(value);
  if (parsed.length === 0) return invalid(context, "texte non vide obligatoire", value);
  return parsed;
}

export function nullableString(value: unknown, context: string): string | null {
  if (value === undefined) {
    throw new Error(`Schéma Supabase incomplet (${context}) : colonne obligatoire absente`);
  }
  return value === null ? null : String(value);
}

export function nullableBoolean(value: unknown, context: string): boolean | null {
  if (value === undefined) {
    throw new Error(`Schéma Supabase incomplet (${context}) : colonne obligatoire absente`);
  }
  if (value === null) return null;
  if (typeof value !== "boolean") return invalid(context, "booléen ou null", value);
  return value;
}

export function enumValue<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
  context: string,
): T[number] {
  if (typeof value !== "string" || !allowed.includes(value)) {
    return invalid(context, `une valeur parmi ${allowed.join(", ")}`, value);
  }
  return value as T[number];
}

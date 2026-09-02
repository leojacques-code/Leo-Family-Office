export function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, stableValue(item)]),
    );
  return value;
}

/** Stable FNV-1a identifier: reproducibility marker, never a security primitive. */
export function stableFingerprint(value: unknown): string {
  let hash = 2166136261;
  for (const character of JSON.stringify(stableValue(value))) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `report-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export const safeText = (value: unknown, limit = 2_000) =>
  String(value ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .slice(0, limit);

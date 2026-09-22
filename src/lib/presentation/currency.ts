/** Formatage uniquement : aucune conversion ni devise inférée pour une valeur native. */
export function formatCurrency(value: number, currency: string | null, compact = false): string {
  const options: Intl.NumberFormatOptions = {
    minimumFractionDigits: 0,
    maximumFractionDigits: compact ? 1 : 2,
    ...(compact ? { notation: "compact" } : {}),
  };
  if (currency) {
    try {
      return new Intl.NumberFormat("fr-FR", { ...options, style: "currency", currency }).format(
        value,
      );
    } catch {
      // Une ancienne donnée invalide ne doit ni casser l’écran ni devenir un euro.
    }
  }
  return `${new Intl.NumberFormat("fr-FR", options).format(value)} ${currency || "(devise non renseignée)"}`;
}

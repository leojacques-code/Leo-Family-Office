/** Formatage uniquement : aucune conversion ni devise inférée pour une valeur native. */
export function formatCurrency(value: number, currency: string | null, compact = false): string {
  // Un montant qui porte des centimes les affiche TOUS : « 1 500,5 € » se lit comme une
  // valeur tronquée ou mal saisie. Un montant entier reste sans décimales.
  const hasCents = !compact && Math.round(Math.abs(value) * 100) % 100 !== 0;
  const options: Intl.NumberFormatOptions = {
    minimumFractionDigits: hasCents ? 2 : 0,
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

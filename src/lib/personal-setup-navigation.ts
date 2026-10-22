/** Ne conserve que les destinations du site, sans redirection externe ni boucle d’accueil. */
export function setupReturnTo(value: string | null | undefined): string {
  if (!value?.startsWith("/") || /[\u0000-\u0020\\]/.test(value)) return "/";
  try {
    const url = new URL(value, "https://lfo.invalid");
    if (
      url.origin !== "https://lfo.invalid" ||
      url.pathname === "/setup" ||
      url.pathname === "/login"
    )
      return "/";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/";
  }
}
export function setupEntryFor(value: string | null): string {
  return `/setup?next=${encodeURIComponent(setupReturnTo(value))}`;
}

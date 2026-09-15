/** Le Host reçu correspond à l'adresse du navigateur ; l'URL Next peut utiliser l'hôte interne. */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    const incoming = new URL(origin);
    const internal = new URL(request.url);
    const host = request.headers.get("host") ?? internal.host;
    const forwardedProtocol = request.headers.get("x-forwarded-proto");
    const protocol =
      forwardedProtocol === "https" || forwardedProtocol === "http"
        ? `${forwardedProtocol}:`
        : internal.protocol;
    return incoming.origin === `${protocol}//${host}`;
  } catch {
    return false;
  }
}

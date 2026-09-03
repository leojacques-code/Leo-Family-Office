import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { API_CACHE_CONTROL, API_HEADERS } from "@/lib/http";
import { withApiCacheControl } from "@/proxy";

/**
 * `Cache-Control: private, no-store` SUR TOUTES LES RÉPONSES D'API
 *
 * Une réponse d'API de ce produit porte des faits patrimoniaux nominatifs, et un cache
 * partagé qui en garderait une la servirait à la requête suivante.
 *
 * L'en-tête est posé au SEUL endroit qui le garantisse pour toutes les routes, y compris
 * celles qui n'existent pas encore : le middleware. Ces contrôles vérifient les deux moitiés
 * de la garantie — le middleware le pose, et aucune route ne déclare une valeur PLUS FAIBLE
 * qui prendrait le dessus.
 *
 * L'état constaté avant : les GET portaient `no-store` sans `private`, les POST et PATCH ne
 * portaient rien, et trois routes n'en portaient nulle part.
 */

function routeFiles(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      found.push(...routeFiles(path));
      continue;
    }
    if (entry === "route.ts") found.push(path);
  }
  return found;
}

describe("middleware", () => {
  it("pose l'en-tête sur une réponse d'API", () => {
    const response = withApiCacheControl(new Response("{}"), "/api/state");
    expect(response.headers.get("Cache-Control")).toBe(API_CACHE_CONTROL);
    expect(response.headers.get("Vary")).toBe("Cookie");
  });

  it("le pose aussi sur une route d'API PUBLIQUE", () => {
    // `/api/auth` échange un code d'accès : une réponse mise en cache serait rejouable.
    const response = withApiCacheControl(new Response("{}"), "/api/auth");
    expect(response.headers.get("Cache-Control")).toBe(API_CACHE_CONTROL);
  });

  it("ne touche PAS une réponse de page : le cache d'une page n'est pas ce contrat", () => {
    const response = withApiCacheControl(new Response("<html>"), "/patrimoine");
    expect(response.headers.get("Cache-Control")).toBeNull();
  });
});

describe("routes d'API", () => {
  const files = routeFiles(join(process.cwd(), "src", "app", "api"));

  it("il y a bien des routes à contrôler", () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it("aucune route ne déclare un Cache-Control PLUS FAIBLE que le contrat partagé", () => {
    const drifting: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(/"Cache-Control"\s*:\s*"([^"]*)"/g)) {
        if (match[1] !== API_CACHE_CONTROL) drifting.push(`${file} → « ${match[1]} »`);
      }
    }
    expect(drifting).toEqual([]);
  });

  it("les routes qui posent des en-têtes reprennent la constante partagée", () => {
    const literal: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      if (source.includes('"Cache-Control"') && !source.includes("API_HEADERS")) {
        literal.push(file);
      }
    }
    expect(literal).toEqual([]);
  });

  it("la constante partagée porte les trois directives, pas seulement no-store", () => {
    expect(API_HEADERS["Cache-Control"]).toContain("private");
    expect(API_HEADERS["Cache-Control"]).toContain("no-store");
    expect(API_HEADERS["Cache-Control"]).toContain("max-age=0");
  });
});

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // Les scripts de vérification de schéma sont testés comme le reste : leur logique de
    // comparaison décide si une divergence de base est détectée ou non.
    include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
    coverage: { reporter: ["text", "json-summary"] },
  },
  resolve: {
    alias: {
      "@": new URL("./src", import.meta.url).pathname,
      // Marqueur de frontière Next, sans implémentation exécutable. Le neutraliser permet
      // de tester les modules serveur sans démarrer Next.js.
      "server-only": new URL("./src/lib/data/__tests__/server-only-stub.ts", import.meta.url)
        .pathname,
    },
  },
});

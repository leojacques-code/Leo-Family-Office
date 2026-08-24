import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    coverage: { reporter: ["text", "json-summary"] },
  },
  resolve: {
    alias: {
      "@": new URL("./src", import.meta.url).pathname,
      // Marqueur de frontière Next, sans implémentation exécutable. Le neutraliser permet
      // de tester le repository local pour de vrai plutôt que de le simuler.
      "server-only": new URL("./src/lib/data/__tests__/server-only-stub.ts", import.meta.url)
        .pathname,
    },
  },
});

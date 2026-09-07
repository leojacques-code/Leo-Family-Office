import { defineConfig } from "vitest/config";

const alias = {
  "@": new URL("./src", import.meta.url).pathname,
  // Marqueur de frontière Next, sans implémentation exécutable. Le neutraliser permet
  // de tester les modules serveur sans démarrer Next.js.
  "server-only": new URL("./src/lib/data/__tests__/server-only-stub.ts", import.meta.url).pathname,
};

/**
 * Deux projets, deux environnements.
 *
 * Le projet `node` est l'existant, inchangé : moteurs financiers purs, repositories,
 * scripts. Il DOIT rester en environnement `node` : y monter un DOM ralentirait 99
 * fichiers de test pour rien, et masquerait un module client importé par erreur dans une
 * couche serveur.
 *
 * Le projet `dom` est ajouté par la phase 0 de productisation. Les primitives de saisie
 * portent un invariant qui n'est PAS testable comme une fonction pure : « effacer un
 * montant ne produit jamais zéro » naît de la combinaison d'un champ contrôlé, d'un état
 * React et d'un événement clavier. Un test sur la seule fonction de lecture le prouverait
 * à moitié.
 */
export default defineConfig({
  test: {
    coverage: { reporter: ["text", "json-summary"] },
    projects: [
      {
        resolve: { alias },
        test: {
          name: "node",
          environment: "node",
          // Les scripts de vérification de schéma sont testés comme le reste : leur logique
          // de comparaison décide si une divergence de base est détectée ou non.
          include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
        },
      },
      {
        resolve: { alias },
        test: {
          name: "dom",
          environment: "jsdom",
          include: ["src/**/*.test.tsx"],
          setupFiles: ["./src/test/dom-setup.ts"],
        },
      },
    ],
  },
});

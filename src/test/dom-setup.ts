import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
// Enregistre les matchers de `jest-dom` sur `expect` ET augmente les types de vitest, ce
// que l'import de `matchers` seul ne fait pas. Ils décrivent l'état RÉEL du document
// (`toHaveValue`, `toBeVisible`, `toHaveAccessibleDescription`) : sans eux, un test de
// champ de saisie se réduirait à comparer des chaînes, et laisserait passer un champ rendu
// mais invisible ou non relié à son libellé.
import "@testing-library/jest-dom/vitest";

// Chaque test monte son propre arbre. Sans démontage, un test lirait le champ d'un test
// précédent et passerait pour la mauvaise raison.
afterEach(() => {
  cleanup();
});

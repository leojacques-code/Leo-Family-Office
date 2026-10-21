export type Theme = "light" | "dark";

const STORAGE_KEY = "lfo.theme:v1";
const CHANGE_EVENT = "lfo:theme-changed";

/** Script statique avant peinture : aucune donnée personnelle ni valeur injectée. */
export const themeBootstrapScript = `(function(){try{var theme=localStorage.getItem('${STORAGE_KEY}');if(theme==='light'||theme==='dark')document.documentElement.dataset.theme=theme;}catch{}})();`;

export function themeSnapshot(): Theme {
  return typeof document !== "undefined" && document.documentElement.dataset.theme === "dark"
    ? "dark"
    : "light";
}

/** Le serveur et la première passe d'hydratation partagent la même valeur. */
export function serverThemeSnapshot(): Theme {
  return "light";
}

export function saveTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  try {
    window.localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Un stockage indisponible ne bloque pas le changement dans l'onglet courant.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/** Restauration après hydratation et synchronisation des onglets, sans état React parallèle. */
export function subscribeTheme(notify: () => void): () => void {
  function restore() {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved === "light" || saved === "dark") {
        document.documentElement.dataset.theme = saved;
      }
    } catch {
      // Le thème de la page reste utilisable si le navigateur refuse le stockage.
    }
    notify();
  }
  function storageChanged(event: StorageEvent) {
    if (event.key === STORAGE_KEY) restore();
  }
  window.addEventListener(CHANGE_EVENT, notify);
  window.addEventListener("storage", storageChanged);
  restore();
  return () => {
    window.removeEventListener(CHANGE_EVENT, notify);
    window.removeEventListener("storage", storageChanged);
  };
}

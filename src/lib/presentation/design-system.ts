import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, sep } from "node:path";

/**
 * Contrôle du système de design : plancher typographique et taille des contrôles.
 *
 * Deux règles du §10.2 du plan de refonte sont MESURABLES sur la feuille de style, et le §13
 * en reprend la première comme mesure technique : « aucun texte fonctionnel sous 12 px » et
 * « contrôles d'au moins 40 px ». Le §11 place « typographie, spacing, accessibilité clavier
 * et responsive » dans le contenu de la phase 1, c'est-à-dire ici.
 *
 * CE QUI EST DÉCLARÉ ≠ CE QUI EST RENDU, et c'est la limite assumée de ce contrôle. Il lit des
 * déclarations CSS, il ne mesure pas une géométrie : il ne suit ni la cascade complète, ni la
 * spécificité, ni un `transform: scale()`, ni une taille héritée d'un ancêtre. Ce qu'il
 * attrape est la régression la plus probable, celle d'une nouvelle règle écrite à 9 px, et il
 * le dit plutôt que de laisser croire à une preuve. La vérification visuelle réelle est la
 * recette du §41, qui est humaine.
 *
 * LE PLANCHER N'EST PAS APPLIQUÉ RÉTROACTIVEMENT À TOUT LE PRODUIT. Le §11 interdit « une
 * grande PR de redesign transversal » et le §14 « de refaire toutes les pages dans une seule
 * PR » : remonter les 152 déclarations des pages à 12 px changerait la densité des quatorze
 * domaines dans la PR du shell. Le contrôle est donc un CLIQUET : zéro dans le périmètre du
 * shell, et une dette de pages qui ne peut que décroître, chaque phase de domaine soldant la
 * sienne.
 */

export interface CssDeclaration {
  readonly file: string;
  readonly line: number;
  /** Sélecteur du bloc, tel qu'il est écrit. Une liste reste une seule chaîne. */
  readonly selector: string;
  readonly property: string;
  readonly value: string;
}

export interface DesignFinding {
  readonly file: string;
  readonly line: number;
  readonly selector: string;
  readonly declaration: string;
  readonly reason: string;
}

/** §10.2 : « aucun texte fonctionnel sous 12 px ». */
export const FUNCTIONAL_TEXT_FLOOR_PX = 12;
/** §10.2 : « contrôles d'au moins 40 px ». */
export const MIN_CONTROL_PX = 40;

/**
 * Classes du SHELL, c'est-à-dire du périmètre de cette phase.
 *
 * `.button` et `.icon-button` n'y sont PAS : ce sont des classes partagées, portées aussi par
 * les contrôles internes des pages. Les compter dans le shell laisserait croire que la phase 1
 * a traité une classe qu'elle n'a redimensionnée que dans ses propres conteneurs, et les
 * compter comme dette de page est la lecture honnête.
 */
const SHELL_CLASSES = [
  "app-shell",
  "app-main",
  "sidebar",
  "sidebar-top",
  "sidebar-footer",
  "brand-lockup",
  "brand-mark",
  "profile-switch",
  "profile-menu",
  "nav-group",
  "nav-subviews",
  "privacy-status",
  "logout-button",
  "mobile-close",
  "mobile-overlay",
  "menu-button",
  "topbar",
  "topbar-left",
  "topbar-actions",
  "topbar-group",
  "export-button",
  "global-error",
  "content-area",
  "busy-indicator",
  "workstation",
  "workstation-header",
  "workstation-identity",
  "workstation-domain",
  "workstation-question",
  "workstation-controls",
  "workstation-date",
  "workstation-body",
  "financial-canvas",
  "reality-switch",
  "reality-switch-option",
  "simulation-watermark",
  "source-rail",
  "source-rail-title",
  "source-rail-list",
  "source-row",
  "source-tile",
  "source-text",
  "source-status",
  "source-provide",
  "inspector",
  "inspector-header",
  "inspector-facts",
  "inspector-fact",
  "inspector-extra",
  "inspector-formula",
  "drawer-backdrop",
  "financial-drawer",
  "drawer-header",
  "drawer-sections",
  "drawer-section-tab",
  "drawer-body",
] as const;

/*
 * `.nav-count` n'y figure pas non plus, pour la même raison : la classe est née comme badge de
 * barre latérale, elle est aujourd'hui portée par les pages Imports, FEC et Documents. La
 * classer shell attribuerait à cette phase des compteurs qu'elle ne rend pas.
 */
const SHELL_CLASS_SET = new Set<string>(SHELL_CLASSES);

export type DesignScope = "SHELL" | "PAGE";

/**
 * À quel périmètre appartient un sélecteur.
 *
 * Le test se fait sur N'IMPORTE LAQUELLE des classes du sélecteur, ancêtres compris :
 * `.topbar .button` est du shell parce que la règle ne s'applique que dans l'en-tête, alors
 * que `.button` seul s'applique partout. C'est ce qui permet à la phase 1 de redimensionner
 * ses propres conteneurs sans s'attribuer les contrôles des pages.
 */
export function scopeOfSelector(selector: string): DesignScope {
  for (const raw of selector.matchAll(/\.([a-zA-Z][\w-]*)/g)) {
    if (SHELL_CLASS_SET.has(raw[1])) return "SHELL";
  }
  return "PAGE";
}

function cssFilesIn(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      found.push(...cssFilesIn(path));
      continue;
    }
    if (entry.endsWith(".css")) found.push(path);
  }
  return found;
}

/**
 * Lecture des déclarations, sélecteur par sélecteur.
 *
 * L'analyse est volontairement lexicale : suivre les accolades suffit à rattacher une
 * déclaration à son bloc, et une at-rule (`@media`, `@supports`) est traversée sans être
 * confondue avec un sélecteur, parce que son en-tête ne porte aucune déclaration.
 */
export function readStylesheetDeclarations(root: string): CssDeclaration[] {
  const base = root.endsWith(sep) ? root.length : root.length + 1;
  const declarations: CssDeclaration[] = [];

  for (const path of cssFilesIn(root)) {
    const file = path.slice(base);
    // Les commentaires sont NEUTRALISÉS en conservant les sauts de ligne : un commentaire qui
    // contient une accolade ou un exemple de règle décalerait sinon toute la suite du fichier,
    // et un numéro de ligne faux rend un finding inexploitable.
    const source = readFileSync(path, "utf8").replace(/\/\*[\s\S]*?\*\//g, (match) =>
      match.replace(/[^\n]/g, " "),
    );

    const stack: string[] = [];
    let buffer = "";
    let line = 1;
    let bufferStartLine = 1;

    const flushDeclaration = () => {
      const text = buffer.trim();
      buffer = "";
      if (text === "") return;
      const colon = text.indexOf(":");
      if (colon <= 0) return;
      const selector = stack[stack.length - 1];
      // Une déclaration hors de tout bloc n'existe pas en CSS valide ; une at-rule sans bloc
      // (`@import`) tombe ici et n'est pas une déclaration.
      if (selector === undefined || selector.startsWith("@")) return;
      declarations.push({
        file,
        line: bufferStartLine,
        selector,
        property: text.slice(0, colon).trim().toLowerCase(),
        value: text.slice(colon + 1).trim(),
      });
    };

    for (const character of source) {
      if (character === "\n") {
        line += 1;
        buffer += " ";
        continue;
      }
      if (character === "{") {
        stack.push(buffer.trim().replace(/\s+/g, " "));
        buffer = "";
        bufferStartLine = line;
        continue;
      }
      if (character === "}") {
        flushDeclaration();
        stack.pop();
        bufferStartLine = line;
        continue;
      }
      if (character === ";") {
        flushDeclaration();
        bufferStartLine = line;
        continue;
      }
      if (buffer.trim() === "") bufferStartLine = line;
      buffer += character;
    }
  }

  return declarations;
}

/** Toutes les longueurs en pixels d'une valeur, `clamp()` compris. */
function pixelLengths(value: string): number[] {
  return [...value.matchAll(/(-?\d+(?:\.\d+)?)px/g)].map((match) => Number(match[1]));
}

/**
 * Déclarations de taille de texte sous le plancher.
 *
 * Une valeur sans unité en pixels (`inherit`, `1.2em`, `smaller`) n'est PAS un manquement : la
 * taille effective vient alors d'un ancêtre, et l'inventer ici transformerait une inconnue en
 * verdict. Elle est ignorée, et cette ignorance fait partie de la limite déclarée du contrôle.
 */
export function textBelowFloor(
  declarations: readonly CssDeclaration[],
  scope: DesignScope,
): DesignFinding[] {
  const findings: DesignFinding[] = [];
  for (const declaration of declarations) {
    if (declaration.property !== "font-size") continue;
    if (scopeOfSelector(declaration.selector) !== scope) continue;
    const sizes = pixelLengths(declaration.value);
    if (sizes.length === 0) continue;
    // Sur un `clamp()`, c'est la BORNE BASSE qui décide : c'est la taille réellement rendue sur
    // la fenêtre la plus étroite, celle où le texte est déjà le plus difficile à lire.
    const smallest = Math.min(...sizes);
    if (smallest >= FUNCTIONAL_TEXT_FLOOR_PX) continue;
    findings.push({
      file: declaration.file,
      line: declaration.line,
      selector: declaration.selector,
      declaration: `font-size: ${declaration.value}`,
      reason: `texte fonctionnel à ${smallest} px, plancher ${FUNCTIONAL_TEXT_FLOOR_PX} px`,
    });
  }
  return findings;
}

/**
 * DETTE TYPOGRAPHIQUE DES PAGES, relevée à la fin de la phase 1.
 *
 * Ce nombre n'est pas un objectif : c'est un plafond qui ne doit que baisser. Il est relevé
 * par le contrôle lui-même, jamais écrit de mémoire — le §5 de la constitution du dépôt
 * rappelle qu'un compte recopié dérive au premier changement.
 */
export const PAGE_TEXT_FLOOR_DEBT = 152;

/**
 * Sélecteurs de contrôles interactifs du shell dont la taille est déclarée.
 *
 * La liste est NOMINATIVE. Déduire « ce sélecteur est-il interactif ? » d'une heuristique sur
 * son écriture donnerait un contrôle qui rate `.source-row` (une ligne cliquable) et qui
 * signale `.inspector-fact` (une ligne de définition). Une liste fausse se corrige ; une
 * heuristique fausse se discute à chaque revue.
 */
export const SHELL_CONTROL_SELECTORS = [
  ".sidebar nav a",
  ".nav-subviews a",
  ".profile-switch",
  ".profile-menu a",
  ".logout-button",
  ".reality-switch-option",
  ".source-row",
  ".source-provide",
  ".drawer-section-tab",
  ".topbar .icon-button",
  ".sidebar .icon-button",
  ".inspector-header .icon-button",
  ".drawer-header .icon-button",
  ".topbar-actions .button",
  // Action primaire de la zone A. Elle entre dans la liste EN MÊME TEMPS que son rendu :
  // ajouter un contrôle de shell sans l'y inscrire le ferait échapper au plancher en silence,
  // et un cliquet qui ne voit pas ce qu'on ajoute ne cliquette pas.
  ".workstation-controls .button",
] as const;

export interface ControlSizeFinding extends DesignFinding {
  readonly control: string;
}

/**
 * Contrôles du shell dont la hauteur déclarée reste sous le minimum.
 *
 * La règle retenue par sélecteur est la DERNIÈRE `min-height` qui le mentionne, l'ordre du
 * fichier étant celui de la cascade à spécificité égale, et `min-height` primant sur `height`
 * dans le modèle de boîte. Un sélecteur qu'aucune règle ne dimensionne est un manquement à
 * signaler et non un contrôle supposé conforme : sa hauteur vient alors d'un rembourrage, donc
 * du contenu, donc elle change avec le libellé.
 */
export function shellControlsBelowMinimum(
  declarations: readonly CssDeclaration[],
): ControlSizeFinding[] {
  const findings: ControlSizeFinding[] = [];
  for (const control of SHELL_CONTROL_SELECTORS) {
    const sized = declarations.filter(
      (declaration) =>
        declaration.property === "min-height" &&
        declaration.selector.split(",").some((part) => part.trim() === control),
    );
    const last = sized[sized.length - 1];
    if (!last) {
      findings.push({
        file: "—",
        line: 0,
        selector: control,
        control,
        declaration: "aucune min-height",
        reason: `hauteur non déclarée : elle dépend alors du contenu, minimum ${MIN_CONTROL_PX} px`,
      });
      continue;
    }
    const sizes = pixelLengths(last.value);
    const smallest = sizes.length === 0 ? null : Math.min(...sizes);
    if (smallest !== null && smallest >= MIN_CONTROL_PX) continue;
    findings.push({
      file: last.file,
      line: last.line,
      selector: last.selector,
      control,
      declaration: `min-height: ${last.value}`,
      reason:
        smallest === null
          ? `hauteur non exprimée en pixels, minimum ${MIN_CONTROL_PX} px`
          : `contrôle de ${smallest} px, minimum ${MIN_CONTROL_PX} px`,
    });
  }
  return findings;
}

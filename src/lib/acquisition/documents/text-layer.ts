/**
 * COUCHE TEXTE D'UN PDF, ET GÉOMÉTRIE DE LECTURE
 *
 * Fonctions pures, sans dépendance à un lecteur de PDF. Tout ce fichier travaille sur une
 * structure — `PdfTextLayer` — que l'adaptateur `pdf-extract.ts` produit et que les tests
 * peuvent fabriquer à la main.
 *
 * Cette séparation n'est pas cosmétique : elle est ce qui permet de tester la lecture d'un
 * formulaire sans PDF, donc de couvrir des cas de mise en page qu'aucun fichier d'exemple ne
 * contient — une colonne décalée, un libellé sur deux lignes, un code sans valeur.
 *
 * Convention de repère : celle du PDF. L'origine est en BAS À GAUCHE, `y` croît vers le HAUT.
 * Les lignes se lisent donc par `y` DÉCROISSANT. Confondre les deux repères inverserait
 * l'ordre des lignes, et un total se retrouverait avant ses composantes.
 */

/** Un fragment de texte positionné, tel que le PDF le contient. */
export interface PdfTextItem {
  text: string;
  /** Coin bas-gauche du fragment, repère PDF. */
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
}

export interface PdfPage {
  pageNumber: number;
  width: number;
  height: number;
  items: PdfTextItem[];
}

export interface PdfTextLayer {
  pages: PdfPage[];
  /** Nombre total de caractères non blancs. C'est lui qui distingue un scan d'un PDF natif. */
  charCount: number;
}

/** Une ligne visuelle : des fragments partageant la même ligne de base, ordonnés par `x`. */
export interface PdfLine {
  pageNumber: number;
  /** Ligne de base retenue : la médiane des `y` des fragments. */
  y: number;
  items: PdfTextItem[];
  /** Texte de la ligne, fragments joints par un espace unique. */
  text: string;
}

/**
 * Tolérance verticale, en points PDF, pour considérer deux fragments sur la même ligne.
 *
 * 2,5 points est un compromis mesuré : les formulaires administratifs alignent leurs cellules
 * au point près, et les indices ou exposants d'un libellé s'écartent de moins de 3 points.
 * Trop serré, une ligne se scinde en deux et le code perd sa valeur ; trop large, deux lignes
 * fusionnent et un montant se retrouve rattaché à la case du dessus.
 */
export const LINE_TOLERANCE = 2.5;

/**
 * Écart horizontal, en multiples de la taille de police, au-delà duquel deux fragments ne
 * sont plus le même mot. Sert à recomposer un nombre découpé par le PDF (« 1 » « 234 »).
 */
export const TOKEN_GAP_RATIO = 0.4;

function isBlank(text: string): boolean {
  return text.trim().length === 0;
}

/** Groupe les fragments d'une page en lignes visuelles, du haut vers le bas. */
export function pageLines(page: PdfPage, tolerance = LINE_TOLERANCE): PdfLine[] {
  const meaningful = page.items.filter((item) => !isBlank(item.text));
  if (meaningful.length === 0) return [];

  const sorted = [...meaningful].sort((left, right) => right.y - left.y || left.x - right.x);
  const lines: PdfLine[] = [];
  let current: PdfTextItem[] = [];
  let reference = sorted[0].y;

  const flush = () => {
    if (current.length === 0) return;
    const items = [...current].sort((left, right) => left.x - right.x);
    const ys = items.map((item) => item.y).sort((a, b) => a - b);
    lines.push({
      pageNumber: page.pageNumber,
      y: ys[Math.floor(ys.length / 2)],
      items,
      // Les fragments sont joints par UN espace : les espaces d'alignement du PDF ne portent
      // aucune information, et les conserver rendrait tout appariement de libellé illusoire.
      text: items
        .map((item) => item.text.trim())
        .filter((text) => text.length > 0)
        .join(" "),
    });
    current = [];
  };

  for (const item of sorted) {
    if (Math.abs(item.y - reference) <= tolerance) {
      current.push(item);
    } else {
      flush();
      current.push(item);
      reference = item.y;
    }
  }
  flush();
  return lines;
}

export function layerLines(layer: PdfTextLayer, tolerance = LINE_TOLERANCE): PdfLine[] {
  return layer.pages.flatMap((page) => pageLines(page, tolerance));
}

/** Un jeton : des fragments contigus recomposés, avec son cadre. */
export interface PdfToken {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
}

/**
 * Recompose les jetons d'une ligne. Un PDF découpe volontiers `1 234 567` en plusieurs
 * fragments : sans cette recomposition, chaque morceau serait lu comme un nombre distinct et
 * un million deviendrait un.
 */
export function lineTokens(line: PdfLine, gapRatio = TOKEN_GAP_RATIO): PdfToken[] {
  const tokens: PdfToken[] = [];
  for (const item of line.items) {
    const text = item.text.trim();
    if (text.length === 0) continue;
    const previous = tokens[tokens.length - 1];
    if (previous !== undefined) {
      const gap = item.x - (previous.x + previous.width);
      const threshold = Math.max(item.fontSize, previous.fontSize) * gapRatio;
      // Deux fragments séparés d'un espace typographique ou moins sont le même jeton — sauf
      // si le PDF a lui-même écrit un espace, qui est alors un séparateur de mots réel.
      if (gap <= threshold && !/\s$/.test(previous.text) && !/^\s/.test(item.text)) {
        previous.text += text;
        previous.width = item.x + item.width - previous.x;
        previous.height = Math.max(previous.height, item.height);
        continue;
      }
    }
    tokens.push({
      text,
      x: item.x,
      y: item.y,
      width: item.width,
      height: item.height,
      fontSize: item.fontSize,
    });
  }
  return tokens;
}

/**
 * Normalise un libellé pour l'appariement : accents retirés, casse et espaces unifiés,
 * apostrophes typographiques ramenées à l'apostrophe simple.
 *
 * Un formulaire imprime « TOTAL GÉNÉRAL » ici et « Total general » là. Apparier sur la forme
 * exacte ferait échouer un contrôle pour une raison typographique, et un contrôle qui échoue
 * pour une raison typographique est pire qu'absent : il apprend à ignorer les contrôles.
 */
export function foldLabel(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’‘`´]/g, "'")
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

/** Texte entier d'une page, lignes jointes par un retour. Sert à la DÉTECTION, pas à la lecture. */
export function pageText(page: PdfPage): string {
  return pageLines(page)
    .map((line) => line.text)
    .join("\n");
}

/** Cadre englobant d'un ensemble de jetons. `null` sur un ensemble vide. */
export function boundingBoxOf(tokens: readonly PdfToken[]): {
  x: number;
  y: number;
  width: number;
  height: number;
} | null {
  if (tokens.length === 0) return null;
  const minX = Math.min(...tokens.map((token) => token.x));
  const minY = Math.min(...tokens.map((token) => token.y));
  const maxX = Math.max(...tokens.map((token) => token.x + token.width));
  const maxY = Math.max(...tokens.map((token) => token.y + token.height));
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

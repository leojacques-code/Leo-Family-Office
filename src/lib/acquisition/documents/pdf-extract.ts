/**
 * ADAPTATEUR PDF → COUCHE TEXTE
 *
 * SEUL fichier du dépôt qui dépend d'un décodeur de PDF. Tout ce qui LIT un formulaire
 * travaille sur `PdfTextLayer`, une structure que les tests fabriquent à la main.
 *
 * Cette frontière est ce qui rend la verticale testable : un formulaire dont la colonne des
 * codes est décalée de vingt points, un libellé coupé en deux, un code sans valeur — aucun
 * fichier d'exemple ne contient tous ces cas, et une couche texte synthétique les contient
 * tous.
 *
 * Ce fichier n'est importé que par la couche de persistance, elle-même `server-only`. Il ne
 * doit jamais l'être depuis un composant client : le décodeur pèse plusieurs mégaoctets et
 * n'a rien à faire dans un bundle de navigateur.
 *
 * Ce qu'il ne fait PAS :
 *
 *   * aucun rendu, aucune image, aucun canvas. Seule la couche TEXTE est lue ;
 *   * aucun OCR. Un PDF sans texte est CONSTATÉ, et le constat s'arrête là ;
 *   * aucune interprétation. Un montant reste une chaîne à ce stade.
 */

import type { PdfPage, PdfTextItem, PdfTextLayer } from "./text-layer";
import { documentIssue, type DocumentIssue, type PdfKind } from "./types";

/**
 * Seuil de caractères non blancs en dessous duquel une page est considérée SANS couche texte.
 *
 * Une page scannée n'est jamais totalement vide : le PDF porte souvent un filigrane, un
 * numéro de page ou un identifiant de dépôt en texte réel. Exiger zéro caractère
 * classerait un scan comme « natif » à cause de son numéro de page, et l'extracteur
 * chercherait des cases dans un document qui n'en contient aucune, pour rendre une liasse
 * vide sans dire pourquoi.
 *
 * Quarante caractères est délibérément bas : un formulaire natif en porte des milliers.
 */
export const MIN_PAGE_TEXT_CHARS = 40;

/** Plafond de pages analysées. Une liasse complète en compte une trentaine. */
export const MAX_PDF_PAGES = 120;

export interface PdfExtractionResult {
  layer: PdfTextLayer;
  pdfKind: PdfKind;
  pageCount: number;
  /** Pages RÉELLEMENT dépourvues de couche texte, telles que l'utilisateur les numérote. */
  imageOnlyPages: number[];
  issues: DocumentIssue[];
}

function countChars(items: readonly PdfTextItem[]): number {
  return items.reduce((total, item) => total + item.text.replace(/\s+/g, "").length, 0);
}

/**
 * Lit la couche texte d'un PDF.
 *
 * Ne lève JAMAIS sur un fichier illisible : un échec de décodage est un fait à persister,
 * pas une exception à remonter jusqu'à l'utilisateur sous forme de trace technique.
 */
export async function extractPdfTextLayer(bytes: Uint8Array): Promise<PdfExtractionResult> {
  const issues: DocumentIssue[] = [];
  const empty: PdfTextLayer = { pages: [], charCount: 0 };

  if (bytes.byteLength === 0) {
    issues.push(
      documentIssue("PDF_EMPTY", "ERROR", null, null, null, "Fichier vide : rien à lire"),
    );
    return { layer: empty, pdfKind: "UNREADABLE", pageCount: 0, imageOnlyPages: [], issues };
  }

  // Import dynamique : le décodeur reste hors du graphe statique, ce qui évite de le faire
  // entrer dans un bundle qui n'en a pas besoin.
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");

  let document: Awaited<ReturnType<typeof pdfjs.getDocument>["promise"]>;
  try {
    document = await pdfjs.getDocument({
      data: bytes,
      // `isEvalSupported: false` figurait ici. L'option n'existe plus en pdfjs-dist 6 : elle a
      // été retirée avec la CAPACITÉ qu'elle désarmait, et les builds `legacy` de la version
      // installée ne contiennent ni `eval(` ni `new Function(`. La garantie voulue — un PDF
      // déposé par un tiers n'exécute rien dans le processus serveur — est donc le seul
      // comportement possible, et non un défaut qu'on aurait cessé de corriger. Si une version
      // future réintroduisait l'évaluation, ce commentaire est l'endroit où le vérifier.
      // Aucune police système : la lecture du texte n'en a pas besoin, et les charger ferait
      // dépendre le résultat de l'environnement d'exécution.
      useSystemFonts: false,
      // Les polices standard ne sont pas nécessaires pour extraire du texte. Leur absence
      // produit un avertissement du décodeur, pas une perte de contenu.
      standardFontDataUrl: undefined,
    }).promise;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const encrypted = /password|encrypt/i.test(message);
    issues.push(
      documentIssue(
        encrypted ? "PDF_ENCRYPTED" : "PDF_UNREADABLE",
        "ERROR",
        null,
        null,
        message,
        encrypted
          ? "PDF protégé par mot de passe : aucune lecture n'est possible, et aucune valeur n'est supposée"
          : `PDF illisible : ${message}`,
      ),
    );
    return { layer: empty, pdfKind: "UNREADABLE", pageCount: 0, imageOnlyPages: [], issues };
  }

  const pageCount = document.numPages;
  const readable = Math.min(pageCount, MAX_PDF_PAGES);
  if (pageCount > MAX_PDF_PAGES) {
    issues.push(
      documentIssue(
        "PDF_PARTIAL_TEXT_LAYER",
        "WARNING",
        null,
        null,
        pageCount,
        `${pageCount} pages, ${MAX_PDF_PAGES} lues. Le document est tronqué à l'analyse : déposez la liasse seule`,
      ),
    );
  }

  const pages: PdfPage[] = [];
  const imageOnlyPages: number[] = [];

  for (let index = 1; index <= readable; index += 1) {
    const page = await document.getPage(index);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const items: PdfTextItem[] = [];

    for (const entry of content.items) {
      // Les marqueurs de structure n'ont ni texte ni position : ils ne décrivent rien à lire.
      if (!("str" in entry) || typeof entry.str !== "string") continue;
      const transform = entry.transform;
      if (!Array.isArray(transform) || transform.length < 6) continue;
      // La matrice de transformation porte l'échelle en [0] et [3], la position en [4] et [5].
      // La taille de police utile est |transform[3]| : c'est elle qui donne l'écart
      // typographique à partir duquel deux fragments cessent d'être le même mot.
      const fontSize = Math.abs(Number(transform[3])) || Math.abs(Number(entry.height)) || 1;
      items.push({
        text: entry.str,
        x: Number(transform[4]),
        y: Number(transform[5]),
        width: Number(entry.width) || 0,
        height: Number(entry.height) || fontSize,
        fontSize,
      });
    }

    const charCount = countChars(items);
    if (charCount < MIN_PAGE_TEXT_CHARS) imageOnlyPages.push(index);

    pages.push({
      pageNumber: index,
      width: viewport.width,
      height: viewport.height,
      items,
    });
  }

  const charCount = pages.reduce((total, page) => total + countChars(page.items), 0);

  const pdfKind: PdfKind =
    pages.length === 0
      ? "UNREADABLE"
      : imageOnlyPages.length === pages.length
        ? "IMAGE_ONLY"
        : imageOnlyPages.length > 0
          ? "MIXED"
          : "NATIVE_TEXT";

  if (pdfKind === "IMAGE_ONLY") {
    issues.push(
      documentIssue(
        "PDF_NO_TEXT_LAYER",
        "ERROR",
        null,
        null,
        null,
        "Aucune page ne porte de couche texte : ce document est un scan. Une reconnaissance de caractères est nécessaire, et aucune valeur n'est déduite en attendant",
      ),
    );
  } else if (pdfKind === "MIXED") {
    issues.push(
      documentIssue(
        "PDF_PARTIAL_TEXT_LAYER",
        "WARNING",
        null,
        null,
        imageOnlyPages.join(", "),
        `Page(s) sans couche texte : ${imageOnlyPages.join(", ")}. Les cases qu'elles portent ne sont pas lues, et leur absence n'est pas un zéro`,
      ),
    );
  }

  return { layer: { pages, charCount }, pdfKind, pageCount, imageOnlyPages, issues };
}

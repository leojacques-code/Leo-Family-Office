/**
 * CONTRÔLE EXÉCUTABLE : `npm run check:conflict-markers`
 *
 * Énumère les fichiers SUIVIS par git et refuse tout marqueur de conflit résiduel. La
 * logique de reconnaissance vit dans `conflict-markers.ts` et y est testée : ce fichier ne
 * fait que l'énumération, la lecture disque et le code de sortie.
 *
 * Périmètre : `git ls-files`, donc ni `node_modules`, ni `.next`, ni un fichier ignoré. Un
 * marqueur dans un artefact de build n'est pas un problème d'intégration, et le faire
 * remonter noierait le vrai.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

import {
  findConflictMarkers,
  formatConflictMarkerReport,
  type ConflictMarkerHit,
} from "./conflict-markers.ts";

/**
 * Un fichier BINAIRE n'est pas balayé. Un octet nul dans les premiers kilo-octets est
 * l'heuristique que git lui-même emploie : décoder une police ou une image en UTF-8
 * produirait des séquences arbitraires, et donc un faux positif possible.
 */
function isBinary(content: Buffer): boolean {
  const window = content.subarray(0, Math.min(content.length, 8_192));
  return window.includes(0);
}

function trackedFiles(): string[] {
  const output = execFileSync("git", ["ls-files", "-z"], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return output.split("\0").filter((entry) => entry.length > 0);
}

function main(): void {
  const hits: ConflictMarkerHit[] = [];
  let scanned = 0;
  let skipped = 0;

  for (const file of trackedFiles()) {
    let content: Buffer;
    try {
      content = readFileSync(file);
    } catch {
      // Fichier suivi mais absent de la copie de travail (suppression non encore committée) :
      // il n'y a rien à balayer, et ce n'est pas un échec du contrôle.
      skipped += 1;
      continue;
    }
    if (isBinary(content)) {
      skipped += 1;
      continue;
    }
    scanned += 1;
    hits.push(...findConflictMarkers(file, content.toString("utf8")));
  }

  console.log(`Marqueurs de conflit : ${scanned} fichier(s) balayé(s), ${skipped} ignoré(s).`);
  if (hits.length > 0) {
    console.error(formatConflictMarkerReport(hits));
    process.exitCode = 1;
    return;
  }
  console.log(formatConflictMarkerReport(hits));
}

main();

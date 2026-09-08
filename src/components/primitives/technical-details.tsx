"use client";

import { useState } from "react";

/**
 * Volet de détail technique.
 *
 * Le constat 5.4 du plan de refonte interdit qu'un code, un UUID, une empreinte, un nom de
 * contrainte ou un identifiant de preuve apparaisse dans la surface principale. Il ne dit PAS
 * de les supprimer : « ils restent disponibles dans "Détail technique" pour support, audit ou
 * utilisateur expert », et la section 10.2 précise « copiable ».
 *
 * Ce composant est cet endroit, et il est le seul. Une empreinte affichée en clair sous un
 * chiffre n'aide personne à décider ; la même empreinte, repliée et copiable, permet à un
 * support de rapprocher deux exécutions. La différence n'est pas cosmétique : la première
 * occupe la place d'une information financière, la seconde attend d'être demandée.
 */
export interface TechnicalEntry {
  /** Libellé français de l'élément technique. */
  readonly label: string;
  /** Valeur brute : empreinte, identifiant, code. Jamais interprétée ni raccourcie. */
  readonly value: string;
}

export interface TechnicalDetailsProps {
  entries: readonly TechnicalEntry[];
  /** Libellé du dépliant. Par défaut « Détail technique ». */
  summary?: string;
}

/**
 * Replié par DÉFAUT, toujours.
 *
 * Un volet technique ouvert d'emblée n'est plus un volet : c'est du contenu, et il reprend la
 * place que la phase 0 vient de lui retirer.
 */
export function TechnicalDetails({ entries, summary = "Détail technique" }: TechnicalDetailsProps) {
  const [copied, setCopied] = useState(false);
  if (entries.length === 0) return null;
  // Le texte copié porte les LIBELLÉS avec les valeurs : une empreinte collée seule dans un
  // ticket de support ne dit pas de quoi elle est l'empreinte.
  const clipboardText = entries.map((entry) => `${entry.label} : ${entry.value}`).join("\n");

  return (
    <details className="fin-technical">
      <summary className="fin-technical-summary">{summary}</summary>
      <dl className="fin-technical-list">
        {entries.map((entry) => (
          <div className="fin-technical-row" key={entry.label}>
            <dt>{entry.label}</dt>
            {/* La valeur est en `code` : elle se lit caractère par caractère, et un `0` ne se
                confond pas avec un `O` quand quelqu'un la recopie. */}
            <dd>
              <code>{entry.value}</code>
            </dd>
          </div>
        ))}
      </dl>
      <button
        className="fin-technical-copy"
        onClick={() => {
          // `navigator.clipboard` n'existe pas partout, notamment hors contexte sécurisé.
          // L'absence de copie n'est pas une erreur à remonter : les valeurs restent lisibles
          // et sélectionnables à l'écran, ce qui était déjà le cas avant le bouton.
          void navigator.clipboard?.writeText(clipboardText).then(
            () => setCopied(true),
            () => setCopied(false),
          );
        }}
        type="button"
      >
        {copied ? "Copié" : "Copier"}
      </button>
    </details>
  );
}

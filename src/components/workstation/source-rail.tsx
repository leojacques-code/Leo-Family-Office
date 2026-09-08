"use client";

import {
  Banknote,
  Building,
  Briefcase,
  Database,
  FileCheck,
  FileText,
  Landmark,
  Plus,
  Receipt,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";

/**
 * Zone B : rail de sources.
 *
 * Section 17 du plan de refonte : il montre les sources PERTINENTES pour le domaine, avec
 * pour chacune son nom compréhensible, sa période couverte, sa fraîcheur, son état et les
 * faits qu'elle alimente. Le §6 de V10 ajoute la contrainte de forme : « a compact
 * persistent rail », pas une seconde série de cartes de contenu, et des catégories CONCRÈTES
 * (Banque, Échéancier, Contrat, Bulletin, Relevé courtier, Liasse, FEC, Acte, Devis, Avis
 * fiscal) plutôt que des libellés abstraits comme « Données » ou « Contexte ».
 *
 * Le §3 de V10 impose son budget de texte : titre de 2 mots au plus, indication de 4 mots au
 * plus, une icône d'état. C'est ce qui distingue un rail d'un tutoriel.
 *
 * UNE SOURCE MANQUANTE N'EST PAS UN AVERTISSEMENT. Le §6 de V10 est explicite : « no warning
 * paragraph, no empty KPI card, small + / upload state in rail ». Le rail propose d'ajouter,
 * il n'alerte pas.
 */

/**
 * Catégories de source, reprises du §6 de V10.
 *
 * La liste est CLOSE : « Data », « Inputs », « Context » et « Truth » y sont refusés parce
 * qu'ils ne disent pas à l'utilisateur quelle pièce aller chercher dans ses dossiers.
 */
export type SourceCategory =
  | "BANQUE"
  | "ECHEANCIER"
  | "CONTRAT"
  | "BULLETIN"
  | "RELEVE_COURTIER"
  | "LIASSE"
  | "FEC"
  | "ACTE"
  | "DEVIS"
  | "AVIS_FISCAL"
  | "SAISIE_MANUELLE";

const CATEGORY_LABELS: Readonly<Record<SourceCategory, string>> = {
  BANQUE: "Banque",
  ECHEANCIER: "Échéancier",
  CONTRAT: "Contrat",
  BULLETIN: "Bulletin",
  RELEVE_COURTIER: "Relevé courtier",
  LIASSE: "Liasse",
  FEC: "FEC",
  ACTE: "Acte",
  DEVIS: "Devis",
  AVIS_FISCAL: "Avis fiscal",
  SAISIE_MANUELLE: "Saisie manuelle",
};

/** Mapping d'icônes du §9 de V10 : instrumentation financière, pas décoration. */
const CATEGORY_ICONS: Readonly<Record<SourceCategory, LucideIcon>> = {
  BANQUE: Banknote,
  ECHEANCIER: Landmark,
  CONTRAT: FileText,
  BULLETIN: Briefcase,
  RELEVE_COURTIER: TrendingUp,
  LIASSE: FileCheck,
  FEC: Database,
  ACTE: Building,
  DEVIS: FileText,
  AVIS_FISCAL: Receipt,
  SAISIE_MANUELLE: Database,
};

/**
 * État d'une source, du point de vue de l'utilisateur.
 *
 * `ABSENTE` n'est pas une erreur : c'est une pièce qu'il n'a pas encore fournie, et le rail
 * lui propose de le faire.
 */
export type SourceStatus = "ACTIVE" | "A_RENOUVELER" | "ABSENTE";

const STATUS_HINTS: Readonly<Record<SourceStatus, string>> = {
  ACTIVE: "À jour",
  A_RENOUVELER: "À actualiser",
  ABSENTE: "À fournir",
};

export interface RailSource {
  id: string;
  category: SourceCategory;
  /** Nom compréhensible. Au plus deux mots, §3 de V10. */
  name: string;
  status: SourceStatus;
  /** Période couverte ou date de mise à jour, en clair. Au plus quatre mots. */
  hint?: string;
}

export interface SourceRailProps {
  sources: readonly RailSource[];
  /** Source sélectionnée : le §4.2 de V10 demande qu'un clic focalise le canvas. */
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  /** Appelé sur le `+` d'une source absente. */
  onProvide?: (id: string) => void;
}

/**
 * Rail de sources, ou rien.
 *
 * Un rail vide n'est pas rendu. La phase 1 installe le CADRE : les sources d'un domaine sont
 * déclarées par la phase de ce domaine, et un rail qui afficherait « aucune source » ferait
 * exactement la carte vide que le §6 de V10 refuse.
 */
export function SourceRail({ sources, selectedId, onSelect, onProvide }: SourceRailProps) {
  if (sources.length === 0) return null;
  return (
    <aside aria-label="Sources du domaine" className="source-rail">
      <h2 className="source-rail-title">Sources</h2>
      <ul className="source-rail-list">
        {sources.map((source) => {
          const Icon = CATEGORY_ICONS[source.category];
          const selected = source.id === selectedId;
          return (
            <li key={source.id}>
              <button
                aria-current={selected ? "true" : undefined}
                className="source-row"
                data-status={source.status}
                onClick={() => onSelect?.(source.id)}
                type="button"
              >
                <span aria-hidden="true" className="source-tile">
                  <Icon size={17} strokeWidth={1.8} />
                </span>
                <span className="source-text">
                  <strong>{source.name}</strong>
                  <small>{source.hint ?? CATEGORY_LABELS[source.category]}</small>
                </span>
                <span className="source-status">{STATUS_HINTS[source.status]}</span>
              </button>
              {source.status === "ABSENTE" && onProvide ? (
                <button
                  aria-label={`Fournir ${source.name}`}
                  className="source-provide"
                  onClick={() => onProvide(source.id)}
                  type="button"
                >
                  <Plus size={15} />
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>
    </aside>
  );
}

export { CATEGORY_LABELS as SOURCE_CATEGORY_LABELS, STATUS_HINTS as SOURCE_STATUS_HINTS };

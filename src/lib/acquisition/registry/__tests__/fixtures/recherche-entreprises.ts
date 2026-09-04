/**
 * Charges de test façonnées d'après le contrat PUBLIÉ de l'API Recherche d'Entreprises.
 *
 * Elles ne contiennent AUCUNE société réelle et AUCUNE donnée personnelle : les SIREN sont
 * synthétiques, à clé de contrôle calculée, et les personnes sont fictives.
 *
 * Ce que ces charges prouvent, et ce qu'elles ne prouvent pas :
 *
 *   ELLES PROUVENT que la lecture extrait les bons champs d'une réponse CONFORME au contrat
 *   publié, et qu'une réponse malformée produit `null` et des anomalies plutôt qu'une valeur.
 *
 *   ELLES NE PROUVENT PAS que le contrat publié est celui que l'API sert réellement
 *   aujourd'hui : cet environnement ne peut pas l'appeler. C'est la limite `BLOCKED_EXTERNAL`
 *   assumée et documentée dans `docs/COMPANY_REGISTRY_ACQUISITION.md`.
 */

export const SIREN_ALPHA = "900000001";
export const SIREN_BETA = "900000019";

/** Réponse complète et conforme. */
export const SEARCH_PAYLOAD = {
  results: [
    {
      siren: SIREN_ALPHA,
      nom_complet: "SOCIÉTÉ FICTIVE ALPHA (ALPHA CONSEIL)",
      nom_raison_sociale: "SOCIÉTÉ FICTIVE ALPHA",
      sigle: "SFA",
      nature_juridique: "5710",
      activite_principale: "70.22Z",
      categorie_entreprise: "PME",
      date_creation: "2019-04-15",
      etat_administratif: "A",
      nombre_etablissements: 2,
      tranche_effectif_salarie: "11",
      annee_tranche_effectif_salarie: 2025,
      siege: {
        siret: `${SIREN_ALPHA}00009`,
        adresse: "12 RUE DE L'EXEMPLE 75002 PARIS",
        code_postal: "75002",
        commune: "75102",
        libelle_commune: "PARIS 2E ARRONDISSEMENT",
      },
      dirigeants: [
        {
          nom: "DUPONT-FICTIF",
          prenoms: "CAMILLE",
          annee_de_naissance: 1978,
          qualite: "Président",
          type_dirigeant: "personne physique",
          nationalite: "Française",
        },
        {
          denomination: "HOLDING FICTIVE BETA",
          siren: SIREN_BETA,
          qualite: "Directeur général",
          type_dirigeant: "personne morale",
        },
      ],
      matching_etablissements: [
        {
          siret: `${SIREN_ALPHA}00009`,
          etat_administratif: "A",
          adresse: "12 RUE DE L'EXEMPLE 75002 PARIS",
          code_postal: "75002",
          commune: "75102",
          libelle_commune: "PARIS 2E ARRONDISSEMENT",
          activite_principale: "70.22Z",
        },
      ],
    },
  ],
  total_results: 1,
  page: 1,
  per_page: 10,
  total_pages: 1,
};

/**
 * Réponse dont plusieurs champs ne respectent PAS le contrat : dénomination objet, date
 * française, capital à virgule, état administratif inconnu, SIRET rattaché à un autre SIREN.
 * Aucun de ces champs ne doit produire une valeur.
 */
export const MALFORMED_PAYLOAD = {
  results: [
    {
      siren: SIREN_ALPHA,
      nom_raison_sociale: { valeur: "SOCIÉTÉ FICTIVE ALPHA" },
      nom_complet: "",
      nature_juridique: "5710",
      activite_principale: "70.22Z",
      date_creation: "15/04/2019",
      etat_administratif: "Z",
      nombre_etablissements: "deux",
      siege: {
        siret: `${SIREN_BETA}00017`,
        code_postal: "75002",
      },
      dirigeants: { nom: "PAS UNE LISTE" },
    },
  ],
  total_results: 1,
  page: 1,
  per_page: 10,
};

/** Réponse pointant une AUTRE société que celle demandée. */
export const OTHER_ENTITY_PAYLOAD = {
  results: [
    {
      siren: SIREN_BETA,
      nom_raison_sociale: "HOLDING FICTIVE BETA",
      etat_administratif: "A",
    },
  ],
  total_results: 1,
  page: 1,
  per_page: 1,
};

export const EMPTY_PAYLOAD = { results: [], total_results: 0, page: 1, per_page: 10 };

# Institutional Reporting V1

## Audit et sources canoniques

| Élément                                                     | Décision            | Raison                                                           |
| ----------------------------------------------------------- | ------------------- | ---------------------------------------------------------------- |
| Bilan canonique, Global Financial Context                   | KEEP / REUSE        | Seule vérité patrimoniale, date, devise et baseline.             |
| Event Engine, Today V2, Goals V2, Decision Lab V2, Beyonder | REUSE               | Reporting restitue leurs résultats sans formule de domaine.      |
| `MonthlyClose`                                              | REUSE               | Seule source ponctuelle effectivement conservée pour les revues. |
| `/api/export` CSV/JSON                                      | KEEP                | Export brut distinct du document institutionnel.                 |
| View model Reporting et PDF                                 | EXTEND              | Couche pure à la demande ; aucune persistance.                   |
| Reconstitution historique depuis l'état courant             | DEPRECATE / REPLACE | Interdite ; une lacune devient `NOT_COMPUTABLE`.                 |
| Migration                                                   | AUCUNE              | Aucun rapport, PDF, résultat ou paramètre dérivé n'est persisté. |

`buildInstitutionalReport` reçoit un `DashboardState` déjà isolé par le repository serveur. Il
compose un manifest et des sections triées, puis calcule un fingerprint stable. L'heure technique
est fournie uniquement au renderer PDF et n'entre jamais dans le fingerprint financier.

## Matrice de calculabilité et honnêteté historique

| Rapport          | Source historique minimale | Comportement sans source             |
| ---------------- | -------------------------- | ------------------------------------ |
| Current Snapshot | contexte canonique actuel  | rapport partiel                      |
| Monthly Review   | une ou deux clôtures       | ponctuel ou non calculable           |
| Annual Review    | clôtures de l'année        | sections historiques non calculables |
| IC Memo          | Decision Case/version      | memo de surveillance incomplet       |

Une clôture ne contient pas de composition détaillée : le rapport ne remplace donc jamais cette
composition par les actifs actuels. Deux clôtures autorisent une variation absolue. La variation
relative exige un dénominateur non nul. Aucun mois n'est annualisé. Les événements annuels sont
limités aux faits `OBSERVED` datés dans la période. Devise incompatible, FX absent, fingerprint ou
méthodologie incompatible doivent bloquer la comparaison dès que ces métadonnées seront conservées
sur toutes les clôtures ; le contrat legacy `MonthlyClose` ne les stocke pas encore et sa devise
est celle du workspace au moment de sa création.

## Structure

- **Current Snapshot** : synthèse, bilan, liquidité, cash-flow, dette, portefeuille, immobilier,
  Business Equity, carrière, fiscalité, Goals, décisions, événements, Beyonder, qualité et preuves.
- **Monthly Review** : deux dernières clôtures réellement disponibles et limites historiques.
- **Annual Review** : première et dernière clôture de l'année explicitement choisie.
- **IC Memo** : question, options enregistrées, résultats Decision Lab disponibles, risques,
  preuves et prochaine décision humaine. Il n'ajoute aucune option et aucune recommandation.

Chaque montant porte date, devise, nature, calculabilité et moteur/source. Les états `ACTUAL`,
`OBSERVED`, `CONTRACTUAL`, `PROJECTED`, `USER_ASSUMPTION` et `MODEL_ASSUMPTION` restent distincts.

## Contrat PDF et sécurité

`GET /api/reports/pdf` exige la session, valide une allow-list de types, borne l'année et
l'identifiant de Decision Case, puis relit seulement le `DashboardState` de l'utilisateur courant.
Le writer Node produit directement les objets PDF et la pagination : aucun HTML utilisateur,
JavaScript, formule, URL, navigateur, police distante ou secret client n'est exécuté. Le texte est
borné, nettoyé des contrôles et échappé pour la syntaxe PDF. La réponse porte `application/pdf`, un
nom fixe sûr, `private, no-store` et `nosniff`. Le document n'est ni journalisé ni conservé.

Aucune dépendance n'a été ajoutée : le writer minimal évite Chromium et son poids Vercel, tout en
produisant un PDF texte déterministe. Limite V1 : Helvetica/WinAnsi couvre le français et remplace
les caractères hors de cette table ; une police Unicode embarquée pourra être ajoutée plus tard.

## Tests, déploiement et rollback

Exécuter les tests Reporting et route PDF, TypeScript, lint, suite complète, build, puis le gate
PostgreSQL local. Vérifier `%PDF`, la taille, les en-têtes, `/login`, la protection de `/reports` et
un téléchargement authentifié sur la preview. Déployer comme tout build Next.js, sans migration.
Rollback : revenir le commit applicatif ; aucune donnée, table, bucket ou artefact n'est à annuler.

Risques résiduels : `MonthlyClose` legacy ne porte pas explicitement devise et version de méthode ;
les revues le déclarent comme provenance legacy et n'inventent jamais une ventilation historique.
La reproductibilité longue durée bénéficiera plus tard de clôtures enrichies, mais cette V1 ne crée
volontairement aucune nouvelle persistance.

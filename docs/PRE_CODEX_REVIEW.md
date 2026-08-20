# Dossier de revue pré-Codex

Léo Family Office. Version 0.2 du 20 août 2026, décisions du Checkpoint GPT-5.6 Sol intégrées. Lane : Léo (Product Truth).
Base : commit `ef5bacf`. Destinataire : Codex / Work, mission du 24 août 2026.

## 0. Avertissement de sincérité

Ce dossier est produit le 20 août, alors que le plan le situe au 23. Il est donc en
avance sur la réalité du projet : les travaux de Paul et de Tom n'ont pas commencé, et
leurs livrables sont absents. Ce dossier décrit ce qui existe, et nomme précisément ce
qui manque. Il devra être remis à jour le 23 août.

Ne pas lire ce document comme une attestation de préparation. Le lire comme un état des
lieux daté.

## 1. Mission attendue de Codex

    AUDITER LA BRANCHE D'INTÉGRATION V1.2 HARDENING AVANT FUSION VERS MAIN.

Ne pas commencer par de nouvelles fonctionnalités.

Points à vérifier, tels que définis par le plan §10 : diff complet, tests, dette,
immobilier, types, frontières de repository, sécurité, Supabase, provenance,
invariants, golden cases, absence de double comptage, absence de secrets, absence de
rupture involontaire.

Décision attendue, en un mot : MERGE READY, FIX REQUIRED, ou REDESIGN REQUIRED.

### État de la branche cible

La topologie complète a été créée le 20 août 2026, dans l'intervalle entre la rédaction
de la première version de ce dossier et sa vérification à 15h07 UTC.
`integration/v1.2-hardening` existe et pointe sur `ef5bacf`, comme `audit/financial-engine`,
`leo/phase0`, `finance/paul-sprint` et `platform/tom-security`. `main` pointe sur
`ee0d16d`. Voir `docs/OPEN_QUESTIONS.md` Q-14, fermée.

Réserve pour Codex : au 20 août, `integration/v1.2-hardening` ne contient aucun travail
de convergence. Elle est identique à la baseline auditée. La branche existe, elle n'a
rien à auditer. La mission du 24 août suppose que Paul et Tom y aient fusionné leurs
sprints d'ici là.

## 2. Documents de référence

| Document | Existe | Statut | Contenu |
|---|---|---|---|
| `docs/ENGINE_AUDIT.md` | oui | de référence | audit statique des moteurs, 16 sections |
| `docs/FINANCIAL_DEFINITIONS.md` | oui, créé le 20/08 | V0.1, non relu | définitions canoniques et écarts |
| `docs/DATA_INVARIANTS.md` | oui, créé le 20/08 | V0.1, non relu | 70 invariants, statut vérifié |
| `docs/GOLDEN_DATASET.md` | oui, créé le 20/08 | V0.1, non relu | 18 cas synthétiques |
| `docs/FINANCIAL_HARDCODES_AUDIT.md` | oui, créé le 20/08 | V0.1 | 34 hardcodes classés |
| `docs/FINARY_GAP_MATRIX.md` | oui, créé le 20/08 | V0.1 | 32 capabilities |
| `docs/UI_STATE_AUDIT.md` | oui, créé le 20/08 | V0.1 | 27 findings d'interface |
| `docs/README_STATUS_AUDIT.md` | oui, créé le 20/08 | V0.1 | 73 affirmations vérifiées |
| `docs/ACCEPTANCE_CRITERIA_V1.md` | oui, créé le 20/08 | V0.1 | barre V1 par module |
| `docs/COMPLETENESS_MODEL_SPEC.md` | oui, créé le 20/08 | V0.1 | modèle de complétude |
| `docs/EXPLAIN_CALCULATION_SPEC.md` | oui, créé le 20/08 | V0.1 | contrat d'explication |
| `docs/COLLAB_START_HERE.md` | oui, créé le 20/08 | V0.1 | onboarding collaborateurs |
| `docs/OPEN_QUESTIONS.md` | oui, créé le 20/08 | V0.1 | 18 questions ouvertes |
| `PAUL_FINANCIAL_REVIEW.md` | non | absent | livrable de Paul, sprint non commencé |
| `SECURITY_ARCHITECTURE_AUDIT.md` | non | absent | livrable de Tom, sprint non commencé |
| `THREAT_MODEL.md` | non | absent | livrable de Tom, sprint non commencé |
| Résultats de CI | non | absent | aucun workflow dans `.github/` |

Sept documents attendus par le plan §9 sont absents. Quatre d'entre eux dépendent de
travaux qui n'ont pas commencé.

## 3. BUILT

Ce qui existe et fonctionne, vérifié par lecture du code et par exécution.

### Fondations
- Next.js 16 App Router, TypeScript strict, build de production vert.
- Abstraction de repository à deux adapters, SQLite en développement, Supabase en
  production, sélection par `DATA_ADAPTER` avec import dynamique. `node:sqlite` n'est
  jamais évalué en production.
- Schéma PostgreSQL de 39 tables couvrant tous les domaines du business plan.
- Validation Zod sur les mutations d'état et de projection.
- Session HttpOnly, `SameSite=Strict`, `Secure` en production, double contrôle par proxy
  et par route.

### Moteurs financiers purs et testables
- `financial.ts` : capitalisation, valeur réelle, amortissement avec mensualité
  contractuelle prioritaire, VAN, TRI par bissection, MOIC, patrimoine net.
- `monte-carlo.ts` : pas mensuel, Student-t à 5 degrés normalisée, stress rares, choc
  daté, seed reproductible, percentiles interpolés.
- `real-estate.ts` : underwriting complet, TRI, VAN, MOIC, LTV, DSCR, cash-on-cash.
- `tax.ts` : barème progressif et pont brut vers net, sur règle datée.
- `decision.ts` : comparaison rembourser contre investir.

### Fonctionnalités opérationnelles
Sept capabilities sur trente-deux : Net Worth, Accounts, Goals, Documents, Exports,
Scenarios, Monte-Carlo. Détail dans `docs/FINARY_GAP_MATRIX.md`.

### Doctrine appliquée
Douze comportements d'honnêteté relevés dans `docs/UI_STATE_AUDIT.md`, dont : MISSING
jamais transformé en zéro, refus d'afficher volatilité et Sharpe sans historique,
« Règles actives vérifiées : 0 » en fiscalité, « Non calculable » assumé pour le FI
ratio, écarts de réconciliation exposés avec la mention « sans créer de position
fictive », formulation des percentiles en « simulations du modèle ».

## 4. VALIDATED

Ce qui a été vérifié par exécution ou par recalcul indépendant, le 20 août 2026.

| Objet | Méthode | Résultat |
|---|---|---|
| Suite de tests | `npx vitest run` | 6 fichiers, 25 tests, 24 verts, 1 rouge |
| Lint | `npx eslint .` | 21 problèmes, 9 erreurs, 12 avertissements, code de sortie 1 |
| Build de production | `npx next build` | vert, TypeScript validé, 10 routes |
| Réconciliation PEA | recalcul | 15 003,13 moins 15 002,57 égale 0,56, exact |
| Écart contractuel du prêt | recalcul | 284,72 fois 60 moins 16 745 égale 338,20, exact |
| Patrimoine net | recalcul | 15 571,49 moins 16 745 égale -1 173,51, exact |
| Second écart PEA | recalcul | 14 300 plus 703,12 égale 15 003,12, soit 0,01 sous le total, exact |
| Couverture RLS | lecture de la migration | 39 tables, toutes porteuses d'un `user_id`, toutes couvertes par une policy propriétaire, `anon` révoqué, bucket privé |
| Non-double-comptage | test existant plus lecture | correct |
| Reproductibilité Monte-Carlo | test existant | correct |

Conséquence de la ligne « Lint » : `pnpm check`, défini comme `lint && test && build`,
échoue dès la première étape et n'atteint jamais les tests. Ce point n'était signalé
nulle part avant ce dossier.

## 5. NOT VALIDATED

Ce qui existe mais n'a pas été vérifié, ou dont la vérification a échoué.

| Objet | Raison |
|---|---|
| Comportement en navigateur | aucune vérification manuelle ni automatisée |
| Adapter Supabase à l'exécution | aucune instance accessible depuis cette session |
| Mutations du repository | aucun test, ni local, ni Supabase |
| Routes API | aucun test |
| Validation Zod | aucun test des rejets |
| Configuration Vercel, secrets de prévisualisation | hors dépôt, point explicitement listé au gate du plan §4, non vérifié |
| Efficacité réelle de RLS | les policies sont correctes, l'application accède par la clé de service qui les contourne |
| Interface | aucun framework de test d'interface installé |
| Formules vivant dans `pages.tsx` | mécaniquement non testables en l'état |

## 6. BLOCKERS

Classés par gravité. « Gravité » signifie ici : un chiffre faux est présenté à
l'utilisateur comme une vérité.

### B-01 · Service de dette faux, définition désormais arrêtée
Le moteur retranche 284,72 € du cash-flow dès la date zéro, alors que la première
échéance tombe le 5 décembre 2026. L'interface libelle le résultat « avant échéance du
prêt », le panneau d'explication annonce 0,00 €, `docs/ASSUMPTIONS.md` annonce +142 € par
mois. Trois sources, deux vérités, sur le premier écran du produit.

La définition canonique est arrêtée depuis le Checkpoint : `DebtService(période)` est la
somme des `LoanScheduleEntry.totalCashOut` contractuellement exigibles dans la période.
La valeur juste au 19 août 2026 est donc 0 €, et le cash-flow libre avant impôt +142 €.
Ce sont `deriveMetrics` et le test `shared.test.ts` qui doivent changer, pas la
documentation. Prérequis : le modèle ne porte pas encore d'échéancier lisible ni de champ
`totalCashOut`.
Référence : `FINANCIAL_DEFINITIONS.md` §4.3, INV-D-02, INV-D-08, `OPEN_QUESTIONS.md` Q-01, fermée.

### B-02 · Performance affichée sans base de calcul
La page Investments affiche « Performance affichée : +77,71 % » pour le CTO. Ce compte
a un cost basis nul et aucun historique de flux. Le pourcentage n'est dérivable d'aucune
donnée. Sur le même écran, le produit refuse d'afficher volatilité et Sharpe faute
d'historique fiable.
Référence : `DATA_INVARIANTS.md` INV-C-02, `UI_STATE_AUDIT.md` UI-003.

### B-03 bis · MOIC faux dans les deux sens
`moic(totalDistributions, investedCapital)` est appelé avec `Σ max(0, flux)` : les flux
négatifs sont écartés du numérateur sans rejoindre le dénominateur, ce qui est la
variante la plus optimiste possible. La formule canonique est
`(Σ distributions + valeur résiduelle) / Σ contributions`, apports complémentaires
inclus au dénominateur. Sur CASE 13, la valeur juste est 2,2222 contre 2,6667 affiché.
L'erreur se cumule avec B-03, dont elle partage le dénominateur.
Référence : `FINANCIAL_DEFINITIONS.md` §5.4, INV-E-02, CASE 13.

### B-03 · Equity investie immobilière fausse
`investedEquity = downPayment + acquisitionCosts + renovation + furniture` compte les
frais deux fois quand ils sont financés par l'emprunt. Sur le jeu par défaut du produit,
l'equity réelle est de 30 000 € et la formule rend 80 000 €, soit un facteur 2,667. TRI,
cash-on-cash et MOIC sont divisés d'autant. La formule est également fausse sans travaux,
d'un facteur 1,444.
Référence : `DATA_INVARIANTS.md` INV-E-01, `GOLDEN_DATASET.md` CASE 12 et CASE 13.

### B-04 · Multi-devises silencieuse
`deriveMetrics` additionne `account.balance` sans lire `account.currency`. Le formulaire
d'ajout accepte n'importe quel code de 3 lettres. `fxConvert` existe, est testé, et
n'est appelé nulle part. `currency_rates` n'est jamais alimentée. Un compte en dollars
serait compté à parité.
Le CTO contient déjà une ligne « Physical Gold USD » selon `docs/DATA_VERIFICATION.md`.
Référence : `DATA_INVARIANTS.md` INV-I-01 à INV-I-03.

### B-05 · Écrasement silencieux d'une clôture mensuelle
`create_monthly_close` fait un upsert. Reclôturer un mois déjà clos détruit la ligne
précédente sans trace. `net_worth_snapshots` reçoit une insertion supplémentaire à
chaque appel.
Référence : `DATA_INVARIANTS.md` INV-J-01 et INV-J-04.

### B-06 · Panneaux d'explication affichant des constantes sous badge ACTUAL
Quatre panneaux sur neuf listent des chaînes figées, portant un badge de provenance
ACTUAL et une date. Un badge ACTUAL sur un littéral certifie une observation qui n'existe
pas. Le panneau du cash-flow affirme un input contraire au calcul qui a produit le
nombre affiché juste au-dessus.
Référence : `EXPLAIN_CALCULATION_SPEC.md` §3, `UI_STATE_AUDIT.md` UI-005.

### B-07 · Suite de tests et lint rouges à la ligne de base
Un test échoue sur une égalité stricte de flottant. Neuf erreurs de lint sur une règle
Next.js. `pnpm check` échoue dès la première étape. Un rouge permanent finit par ne plus
être lu.
Référence : `OPEN_QUESTIONS.md` Q-02.

### B-08 · Écran Settings affirmant une localisation de données fausse
« Adapter actif : SQLite local » est affiché en production, où les données sont dans
PostgreSQL managé. Affirmation fausse sur la localisation de données patrimoniales, sur
la page qui porte le bloc Security.
Référence : `UI_STATE_AUDIT.md` UI-004, `README_STATUS_AUDIT.md` 2.4.

### B-09 · Decision Lab non testé produisant une recommandation
`decision.ts` est le seul moteur sans fichier de test. Trois coefficients non sourcés
déterminent sa conclusion. L'inflation utilisée ignore le scénario actif. Le capital
arbitré est écrit en dur et diffère entre deux écrans.
Référence : `FINANCIAL_HARDCODES_AUDIT.md` HC-07 à HC-12, `OPEN_QUESTIONS.md` Q-11.

## 7. DEFERRED

Différés volontairement, conformément à la stop list. Ne pas les traiter comme des
manques.

Tax Engine réel, Monte-Carlo V2 multi-actifs, Event Engine, intégration Career vers Net
Worth, Open Banking, données de marché en direct, TWR et XIRR en production,
multi-devises en production, Decision Lab V2, refonte visuelle, nouvelles dépendances
majeures.

Différés par absence de fondation, et non par choix : attribution de variation du
patrimoine, frais et dividendes, persistance immobilière, cap table et dilution,
transferts internes.

## 8. SECURITY STATUS

Lane de Tom. Constats de lecture, sans audit de sécurité complet, qui n'a pas été mené.

### Correct
- Secrets exclusivement côté serveur, `supabase-client.ts` porte `import "server-only"`.
- Aucune variable `NEXT_PUBLIC_` sensible.
- Session HttpOnly, `SameSite=Strict`, `Secure` en production, durée de 12 heures.
- Comparaison de jeton en temps constant via `timingSafeEqual`.
- Double contrôle par proxy et par route.
- Validation Zod des mutations d'état et de projection.
- Documents : allow-list MIME et limite de 8 Mo contrôlées côté serveur, répliquées dans
  la définition du bucket, bucket privé, policies de stockage par propriétaire.
- Migration : `revoke all ... from anon`, RLS activée et policy propriétaire sur les 39
  tables, toutes porteuses d'un `user_id`.
- Refus de créer une session en production sans `SESSION_SECRET`.
- Aucun ordre ni écriture vers un établissement financier.
- En-tête `X-Powered-By` désactivé, `robots` en `noindex`.

### À examiner par Tom
- L'application accède à la base par la clé de service, qui contourne RLS par
  construction. Les policies sont écrites et ne contraignent rien tant que l'accès ne
  passe pas par Supabase Auth. Le README le reconnaît, l'écran Settings ne le dit pas.
- Le code d'accès est partagé et non nominatif : aucune traçabilité par utilisateur.
- La valeur de repli du code d'accès de développement, définie dans `auth.ts:localAccessCode()`, est versionnée dans le dépôt. Un déploiement de
  prévisualisation où `NODE_ENV` ne vaudrait pas `production` l'activerait et
  l'afficherait.
- Les secrets de prévisualisation Vercel n'ont pas été vérifiés. Point explicitement
  listé au gate du plan §4.
- `/api/export` appelle `requireAuthenticated()` sans `try`, ce qui produit un 500 au
  lieu d'un 401.
- `/api/documents` valide manuellement, sans Zod, contrairement à l'affirmation du
  README « validation Zod de toutes les mutations ».
- Aucun workflow de CI dans `.github/`. Rien n'empêche aujourd'hui de fusionner du code
  qui ne compile pas.
- Le dépôt contient l'inventaire patrimonial nominatif d'une personne physique, dans
  trois fichiers plus les tests. Voir `OPEN_QUESTIONS.md` Q-12.

VERDICT PROVISOIRE : architecture de sécurité correcte pour un usage privé
mono-utilisateur. Non prête pour une exposition élargie ou multi-utilisateurs tant que
Supabase Auth n'est pas branché. Aucun audit de sécurité formel n'a été mené.

## 9. FINANCIAL STATUS

Lane de Paul. Constats de lecture et de recalcul.

### Correct
- Non-double-comptage des positions, testé.
- Exclusion du cash d'enveloppe du cash bancaire.
- MISSING jamais transformé en zéro dans les agrégats de dépense.
- Amortissement à 0 % sans invention d'intérêt, dernière échéance plafonnée, testé.
- Mensualité contractuelle prioritaire sur la PMT théorique, au niveau de la mensualité.
- Reproductibilité et ordre des percentiles Monte-Carlo, testés.
- Absence de règle fiscale non vérifiée.
- Écarts de réconciliation exposés et non absorbés.

### Défaillant, au regard des définitions arrêtées au Checkpoint
- Service de dette : différé non respecté, maturité non testée, fenêtre littérale.
- Equity investie immobilière : fausse dans tous les cas où l'emprunt ne finance pas
  exactement le prix d'achat.
- MOIC immobilier : ne compte que les flux positifs.
- Service de dette immobilier : constant sur tout l'horizon, même après extinction du prêt.
- Fiscalité immobilière : `(1 - taxRate)` appliqué aux flux négatifs, ce qui crée un
  crédit d'impôt implicite.
- Multi-devises : agrégation silencieuse.
- `liquidNetWorth` : doublon exact de `netWorth`.
- `investmentRate` : doublon de `savingsRate` quand le cash-flow est positif.
- `dataCompleteness` : mesure le budget et porte un nom global.
- Deux moteurs de projection non réconciliés.
- Champs stockés et jamais consommés : `salaryGrowth`, `socialContributionsRate`,
  `annualPrincipal`, `applyScenarioOverrides`, `loan_schedules`, `FinancialAccount.liquidity`.
- Aucun test sur `decision.ts`, ni sur `deterministicProjection`, ni sur les mutations.

VERDICT PROVISOIRE : les primitives sont saines. Les agrégats et les modèles composites
portent six défauts de définition qui produisent des chiffres faux affichés. Aucune revue
financière indépendante n'a été menée : `PAUL_FINANCIAL_REVIEW.md` n'existe pas.

## 10. Ordre de fusion proposé

Une seule PR existe au 20 août : PR #1, `claude/plan-de-leo-qakf68` vers `leo/phase0`,
documentation seule, 13 fichiers, aucun fichier fonctionnel. Les branches de Paul et de
Tom existent et sont vides de tout commit.

Ordre proposé quand elles existeront, du moins risqué au plus risqué :
1. Documentation seule, lane Léo.
2. Correctifs de copie d'interface, zone verte, lane Léo.
3. Plateforme et sécurité, lane Tom, parce qu'ils conditionnent la CI qui protégera le reste.
4. Moteurs financiers, lane Paul, une fois les définitions arbitrées et la CI en place.

Raison de cet ordre : fusionner des corrections de moteur avant d'avoir une CI qui
exécute les golden cases revient à se priver du seul filet disponible.

## 11. Conflits identifiés

Aucun conflit Git à ce jour : les cinq branches de travail partent du même commit
`ef5bacf` et seule `claude/plan-de-leo-qakf68` porte des commits, tous dans `docs/`.

Conflits de périmètre anticipés, à surveiller quand les branches existeront :

| Fichier | Lanes concernées | Nature |
|---|---|---|
| `src/lib/data/shared.ts` | Paul (formules), Tom (partagé par les deux adapters) | la correction du service de dette touche un fichier lu par les deux repositories |
| `src/lib/types.ts` | Paul (métriques), Tom (contrats), Léo (provenance) | ajouter la complétude aux métriques touche un type partagé par trois lanes |
| `src/components/pages.tsx` | Léo (copie), Paul (formules à extraire) | l'extraction des formules vers des moteurs et la correction de la copie touchent le même fichier de 307 lignes très denses |
| `DashboardState` | Tom (`repository.adapter` à remonter), Léo (affichage) | le correctif de UI-004 exige une modification de la couche de données |

Le troisième est le plus probable et le plus coûteux : `pages.tsx` concentre 438
littéraux numériques, toute la copie d'interface et plusieurs formules. Recommandation :
séquencer plutôt que paralléliser sur ce fichier.

## 12. Idées écartées

Décisions prises pendant cette session, conservées pour éviter qu'elles soient
reprises sans discussion.

| Idée | Raison de l'écart |
|---|---|
| Corriger le test rouge en changeant l'assertion | rend la suite verte sans trancher Q-02, et masque le vrai sujet de l'arrondi canonique |
| Corriger la formule d'equity immobilière tout de suite | fichier de la lane de Paul, et Q-10 sur l'assiette de sortie n'est pas tranchée |
| Retirer immédiatement « +77,71 % » de l'interface | correction évidente, mais le plan de cette session interdit toute modification de code fonctionnel. Consigné en UI-003 et HC-24 |
| Créer les branches manquantes | dépassait le mandat de cette session, et engageait la topologie de collaboration. Consigné en Q-14, puis créées par Léo le 20 août |
| Écrire les fixtures du golden dataset | le plan les réserve explicitement à une étape ultérieure, après validation des définitions |
| Produire un score de complétude global | contraire au principe retenu en `COMPLETENESS_MODEL_SPEC.md` §4 |

## 13. NEXT HIGH-VALUE STEPS

Classés par valeur rapportée au risque.

1. Trancher Q-11, seule décision produit encore bloquante : le Decision Lab émet une
   recommandation sans test ni coefficient sourcé. Treize des dix-huit questions ouvertes
   ont été fermées le 20 août, Q-14 par la création de la topologie de branches et les
   douze autres par le Checkpoint GPT-5.6 Sol. Les définitions de Net Worth, service de
   dette, liquidité, taux d'épargne, MOIC, complétude et clôture mensuelle sont
   désormais arrêtées : Paul peut coder contre une cible stable.
2. Appliquer les correctifs de copie de la zone verte : UI-003, UI-004, UI-005, UI-002,
   UI-006, UI-025. Six correctifs, aucun moteur touché, gain de crédibilité immédiat.
3. Mettre en place une CI minimale : lint, tests, build sur chaque PR. Sans elle, aucune
   des corrections suivantes n'est protégée.
4. Rendre la suite verte, après Q-02.
5. Implémenter les golden cases 1 à 11 comme fixtures. Ils verrouillent le comportement
   avant toute correction de moteur.
6. Corriger le service de dette, après Q-01, avec les cases 8 et 11 comme garde-fou.
7. Corriger l'equity investie immobilière, après Q-10, avec les cases 12 et 13.
8. Ajouter un garde-fou multi-devises, même minimal : rejeter toute devise différente de
   la devise de reporting plutôt que l'agréger à parité.
9. Implémenter `status` et `missingCritical` du modèle de complétude sur les six calculs
   du cockpit.

Les étapes 1 à 3 ne demandent aucune modification de moteur financier et représentent
l'essentiel du gain de fiabilité disponible à court terme.

## 14. Recommandation au 20 août 2026

La question posée à Codex le 24 août sera : MERGE READY, FIX REQUIRED, ou REDESIGN
REQUIRED.

Réponse anticipée, sur l'état d'aujourd'hui : FIX REQUIRED, et rien ne suggère
REDESIGN REQUIRED.

Justification. L'architecture est saine : moteurs purs séparés de l'interface, deux
adapters interchangeables, schéma complet, provenance modélisée dès l'origine, RLS
correctement écrite, Monte-Carlo reproductible. Les défauts recensés sont des défauts de
définition et de câblage, pas de conception : une fenêtre de date littérale, une formule
d'equity qui compte deux fois les frais, une conversion de devise absente, des constantes
d'interface qui auraient dû être des dérivations. Aucun d'eux n'exige de repenser le
produit. Tous exigent d'être tranchés avant d'être codés, ce qui est précisément l'objet
de `docs/OPEN_QUESTIONS.md`.

Réserve importante : cette recommandation porte sur ce qui a été lu et mesuré. Elle ne
remplace ni la revue financière de Paul, ni l'audit de sécurité de Tom, ni l'audit
intégré de Codex. Aucun des trois n'a eu lieu.

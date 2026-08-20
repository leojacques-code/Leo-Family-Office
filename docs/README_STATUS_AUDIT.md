# Audit des affirmations de la documentation

Léo Family Office. Version 0.1 du 20 août 2026. Lane : Léo (Product Truth).
Base : commit `ef5bacf`.

## Objet

Le dépôt affirme des choses sur lui-même, dans `README.md`, `START_HERE.md`,
`docs/ARCHITECTURE.md`, `docs/ASSUMPTIONS.md` et `docs/ROADMAP.md`. Ces affirmations
sont ce que liront Paul, Tom et Codex avant de toucher au code. Une affirmation fausse
dans un README coûte plus cher qu'un bug, parce qu'elle oriente des heures de travail
avant d'être détectée.

Ce document confronte chaque affirmation matérielle au code et aux mesures.
Aucun fichier n'a été modifié.

### Barème

| Verdict | Sens |
|---|---|
| VRAI | vérifié dans le code ou par exécution |
| PARTIEL | vrai sur un périmètre plus étroit que ce que la phrase suggère |
| OBSOLÈTE | vrai à l'écriture, faux aujourd'hui |
| FAUX | contredit par le code ou par une mesure |
| NON VÉRIFIABLE | affirmation sur un environnement hors du dépôt |

### Mesures de référence

Toutes réalisées le 20 août 2026 sur le commit `ef5bacf`, sans aucune modification du
dépôt, après `npm ci`.

| Commande | Résultat | Code de sortie |
|---|---|---:|
| `npx vitest run` | 6 fichiers, 25 tests, 24 verts, 1 rouge | 1 |
| `npx eslint .` | 21 problèmes, 9 erreurs, 12 avertissements | 1 |
| `npx next build` | compilé, TypeScript validé, 10 routes générées | 0 |

Conséquence directe : `pnpm check`, défini comme `pnpm lint && pnpm test && pnpm build`,
échoue dès la première étape. Il n'atteint jamais les tests ni le build. Ce point n'est
signalé nulle part dans la documentation existante.

### Synthèse

| Verdict | Nombre |
|---|---:|
| VRAI | 45 |
| PARTIEL | 16 |
| OBSOLÈTE | 6 |
| FAUX | 4 |
| NON VÉRIFIABLE | 2 |
| Total | 73 |

---

## 1. README.md, section « Ce qui fonctionne »

Quinze affirmations, présentées comme une liste de fonctionnalités opérationnelles.

| # | Affirmation | Verdict | Constat |
|---|---|---|---|
| 1.1 | cockpit patrimonial avec provenance et incertitude visibles | PARTIEL | les badges de provenance sont présents sur les entités ; aucun agrégat du cockpit n'en porte, `netWorth` est affiché sans provenance |
| 1.2 | comptes et soldes modifiables avec historique daté | VRAI | `update_account` insère une nouvelle ligne datée, la lecture prend la plus récente |
| 1.3 | ajout de transactions et mise à jour optionnelle du solde | VRAI | mutation `add_transaction` avec `updateBalance`, solde dérivé marqué DERIVED |
| 1.4 | budget mensuel progressif, sans compléter silencieusement les catégories manquantes | VRAI | `monthlyExpenses` filtre sur `monthlyAmount !== null`, aucune substitution |
| 1.5 | PEA / CTO, positions et contrôles de réconciliation | PARTIEL | le contrôle fonctionne et expose l'écart de 0,56 € ; il cible les comptes par identifiant littéral `"acc_pea"` et `"acc_cto"`, ce qui le rend inopérant après recréation d'un compte |
| 1.6 | prêt étudiant, amortissement à 0 % et arbitrage rembourser vs investir | PARTIEL | l'amortissement est correct ; l'arbitrage porte sur 5 000 € écrits en dur alors que le cash disponible est de 354,08 € |
| 1.7 | scénarios versionnés et duplicables | VRAI | `update_scenario` incrémente et archive, `duplicate_scenario` isole |
| 1.8 | projection déterministe et Monte-Carlo à queues épaisses, seed reproductible, P10 à P90 | VRAI | Student-t à 5 degrés normalisée, seed testé, percentiles ordonnés et testés |
| 1.9 | trajectoires de carrière, clairement marquées comme hypothèses | VRAI | badge MODEL_ASSUMPTION et callout « Courbes non sourcées en V1 » |
| 1.10 | underwriting immobilier avec TRI, VAN, MOIC, LTV, DSCR et cash-on-cash | PARTIEL | les six métriques sont produites ; l'equity investie est surestimée d'un facteur 1,44 à 2,67 selon le financement, ce qui fausse TRI, MOIC et cash-on-cash |
| 1.11 | sandbox de valorisation business equity | VRAI | le mot « sandbox » est exact et le callout le dit |
| 1.12 | objectifs, timeline et clôture mensuelle persistante | PARTIEL | la clôture persiste, et une seconde clôture du même mois écrase la première sans trace |
| 1.13 | coffre documentaire local privé avec contrôle de taille et de type | PARTIEL | contrôles corrects, côté serveur ; « local » est faux en production, où le stockage est un bucket Supabase |
| 1.14 | exports CSV et backup JSON | VRAI | `/api/export`, CSV limité aux comptes et dettes, JSON complet |
| 1.15 | bouton « Explain calculation » sur les métriques structurantes | PARTIEL | six panneaux existent ; plusieurs affichent des constantes de code sous badge ACTUAL, voir `UI_STATE_AUDIT.md` UI-005 |

Lecture : aucune affirmation de cette liste n'est fausse au sens strict. Sept sur quinze
décrivent un périmètre plus large que la réalité. Le mot qui manque le plus souvent est
« partiellement ».

---

## 2. README.md, section « Stockage et persistance »

| # | Affirmation | Verdict | Constat |
|---|---|---|---|
| 2.1 | le mode exécutable autonome utilise SQLite via `node:sqlite` et crée `data/family-office.db` | VRAI | `local-repository.ts`, import dynamique, jamais évalué en production |
| 2.2 | le schéma normalisé couvre comptes, soldes, transactions, positions, dettes, revenus, budgets, scénarios, projections, immobilier, business equity, documents, décisions et clôtures | VRAI | 39 tables dans la migration PostgreSQL |
| 2.3 | le schéma de production active RLS sur toutes les tables utilisateur, retire l'accès `anon`, limite le stockage documentaire et isole chaque ligne par `auth.uid()` | VRAI | vérifié : `revoke all ... from anon`, boucle activant RLS et créant une policy propriétaire sur les 39 tables porteuses d'un `user_id`, bucket privé avec allow-list MIME et limite de 8 Mo |
| 2.4 | une instance Supabase n'a pas été créée ni reliée, car aucune organisation, région ou clé de projet n'a été fournie | OBSOLÈTE | contredit par le même README, dont la section « Déploiement Vercel » décrit une séquence de mise en service complète avec `pnpm seed:supabase`, et par le message du commit précédent, « Deploy Family Office v1.1 Supabase » |
| 2.5 | le branchement du repository Supabase est listé dans la roadmap | OBSOLÈTE | `supabase-repository.ts` est implémenté, 370 lignes, et `resolveAdapterName()` le sélectionne par défaut sur Vercel |

Le point 2.4 est le plus coûteux du document : il conduit un nouvel arrivant à croire
que la production tourne sur SQLite. C'est aussi ce que lui dira l'écran Settings, qui
affiche « Adapter actif : SQLite local ». Deux sources concordantes et fausses.

---

## 3. README.md, section « Sécurité »

| # | Affirmation | Verdict | Constat |
|---|---|---|---|
| 3.1 | session HttpOnly, `SameSite=Strict`, `Secure` en production | VRAI | `/api/auth`, cookie posé avec ces trois attributs, durée 12 heures |
| 3.2 | double contrôle : proxy de routes plus autorisation dans chaque API | PARTIEL | le proxy couvre tout hors `/login`, `/api/auth`, `/_next` et assets ; `requireAuthenticated()` est appelé dans les quatre routes protégées, mais `/api/export` ne l'entoure d'aucun `try`, ce qui produit un 500 au lieu d'un 401 en cas d'appel non authentifié |
| 3.3 | validation Zod de toutes les mutations | PARTIEL | vrai pour `/api/state` et `/api/projection` ; `/api/documents` valide manuellement par deux ensembles et un contrôle de taille, sans Zod |
| 3.4 | limites de taille et allow-list MIME pour les documents | VRAI | 8 Mo et cinq types autorisés, contrôlés côté serveur, répliqués dans la définition du bucket |
| 3.5 | aucun identifiant bancaire, aucune clé sensible côté client | VRAI | `supabase-client.ts` porte `import "server-only"`, aucune variable `NEXT_PUBLIC_` sensible |
| 3.6 | aucun ordre ni écriture vers une banque ou un courtier | VRAI | aucun appel sortant vers un établissement dans le dépôt |
| 3.7 | Supabase RLS et bucket privé prêts pour le déploiement | PARTIEL | les policies sont écrites et correctes ; elles ne contraignent rien tant que l'application accède à la base par la clé de service, qui contourne RLS par construction. Le README le reconnaît deux paragraphes plus loin, l'affirmation isolée reste trompeuse |
| 3.8 | le mode local n'est pas destiné à être exposé sur Internet | VRAI | cohérent avec le code d'accès partagé |

---

## 4. README.md, sections « Démarrage » et « Commandes »

| # | Affirmation | Verdict | Constat |
|---|---|---|---|
| 4.1 | prérequis Node.js 22 ou 24 et pnpm | PARTIEL | `engines.node >= 22` est bien déclaré ; le dépôt contient `package-lock.json`, produit par npm, et aucun `pnpm-lock.yaml`. Toute la documentation parle de pnpm |
| 4.2 | `pnpm install --frozen-lockfile` | FAUX | il n'existe aucun lockfile pnpm. La commande échoue. `npm ci` fonctionne, et c'est ce qui a été utilisé pour les mesures de ce document |
| 4.3 | sans `.env.local`, un code de développement par défaut s'applique, et le README en donne la valeur | VRAI | repli de `localAccessCode()` hors production. Réserve : publier cette valeur dans le README l'expose à toute personne ayant accès au dépôt |
| 4.4 | en production, l'application refuse de créer une session si les secrets sont absents | VRAI | `/api/auth` retourne 503 si `sessionSecret()` est nul |
| 4.5 | `pnpm lint`, `pnpm test`, `pnpm build`, `pnpm check` | PARTIEL | les quatre scripts existent. Ce que la section ne dit pas : `lint` et `test` sont rouges à la ligne de base, donc `check` échoue dès la première étape |

Le point 4.2 est le premier obstacle qu'un nouvel arrivant rencontrera, avant même
d'avoir lu le code.

---

## 5. README.md, section « Déploiement Vercel »

| # | Affirmation | Verdict | Constat |
|---|---|---|---|
| 5.1 | tableau des sept variables d'environnement | VRAI | cohérent avec `.env.example`, `supabase-client.ts` et `repository.ts` |
| 5.2 | `SUPABASE_SECRET_KEY` ne doit jamais être préfixée `NEXT_PUBLIC_` | VRAI | et respecté dans le code |
| 5.3 | variables à créer sur les scopes Production et Preview | NON VÉRIFIABLE | configuration Vercel, hors dépôt. Point explicitement listé au gate du plan §4 : « les secrets Vercel Preview ont été vérifiés ». Non vérifié à ce jour |
| 5.4 | séquence de mise en service en quatre étapes | VRAI | cohérente, et en contradiction avec l'affirmation 2.4 du même document |
| 5.5 | `pnpm seed:supabase` | PARTIEL | le script existe et est correct ; il s'invoque par `node --env-file=.env.local --experimental-strip-types`, donc il fonctionne avec npm comme avec pnpm, mais il chargera le patrimoine réel dans la base ciblée |
| 5.6 | sans valeur explicite, l'application choisit `supabase` si `VERCEL` est défini | VRAI | `resolveAdapterName()` |

---

## 6. START_HERE.md

| # | Affirmation | Verdict | Constat |
|---|---|---|---|
| 6.1 | le lockfile n'a pas pu être généré, la politique Windows bloquant `node.exe` | OBSOLÈTE | `package-lock.json` existe, 269 Ko, et `npm ci` s'exécute sans erreur |
| 6.2 | utiliser `pnpm install` au premier démarrage, pnpm créera le lockfile | OBSOLÈTE | produirait un second lockfile concurrent du `package-lock.json` déjà versionné |
| 6.3 | structure et fichiers JSON vérifiés statiquement | VRAI | |
| 6.4 | équations de réconciliation recalculées indépendamment | VRAI | recalculées à nouveau ici : PEA 15 003,13 moins 15 002,57 égale 0,56 ; prêt 284,72 fois 60 moins 16 745 égale 338,20 ; patrimoine net 15 571,49 moins 16 745 égale -1 173,51. Les trois sont exactes |
| 6.5 | tests unitaires écrits mais non exécutés dans cette session | OBSOLÈTE | exécutés le 20 août 2026 : 24 verts sur 25 |
| 6.6 | lint, build et vérification navigateur non exécutés | OBSOLÈTE | lint et build exécutés le 20 août 2026. Lint rouge, 9 erreurs. Build vert. La vérification navigateur reste à faire |
| 6.7 | ne pas considérer le build comme certifié avant `pnpm check` | VRAI | et le conseil reste valable : `pnpm check` échoue aujourd'hui |

Ce fichier décrit l'état d'une session de travail passée, sur une machine Windows dont
la configuration bloquait Node. Il est daté par nature. Cinq de ses sept affirmations
sont maintenant obsolètes. Il devrait être réécrit ou supprimé au profit de
`docs/COLLAB_START_HERE.md`.

---

## 7. docs/ARCHITECTURE.md

| # | Affirmation | Verdict | Constat |
|---|---|---|---|
| 7.1 | chaque valeur importante porte un type, une confiance et si disponible une source et une date | PARTIEL | vrai pour les entités, faux pour les agrégats de `DashboardMetrics` |
| 7.2 | les positions PEA et CTO expliquent les soldes mais ne s'y ajoutent jamais | VRAI | vérifié et testé |
| 7.3 | une mise à jour de solde crée un nouvel `account_balance`, un scénario crée une nouvelle version | VRAI | |
| 7.4 | finance, fiscalité, Monte-Carlo, immobilier et décision sont des fonctions TypeScript pures | VRAI | aucun import React ni base dans les cinq moteurs |
| 7.5 | le repository local peut être remplacé par un repository Supabase | VRAI | les deux existent, sélection par `DATA_ADAPTER` |
| 7.6 | les composants UI n'embarquent pas les formules structurantes | FAUX | contredit par le code et par `ENGINE_AUDIT.md` §16. `pages.tsx` contient l'intégralité des courbes de carrière, l'intégralité de la valorisation business equity, le calcul de l'écart de réconciliation du PEA, l'écart contractuel du prêt, la composition de l'allocation et la projection déterministe |
| 7.7 | le moteur financier ne dépend ni de React ni de la base | VRAI | |
| 7.8 | les scénarios ne modifient jamais les historiques ACTUAL | VRAI | les moteurs sont purs, seules les tables de simulation reçoivent des écritures |
| 7.9 | le moteur Monte-Carlo travaille mensuellement, Student-t à 5 degrés normalisée, stress rare, choc daté, seed reproductible | VRAI | |
| 7.10 | convention des percentiles : P10, environ 90 % des simulations terminent au-dessus | VRAI | et repris fidèlement dans l'interface |
| 7.11 | `src/lib/navigation.ts` n'exporte que des données sérialisables et des fonctions pures | VRAI | et couvert par un test de régression |
| 7.12 | le repository Supabase est implémenté, il reste à remplacer l'accès par code local par Supabase Auth SSR | VRAI | |

L'affirmation 7.6 est la plus problématique du corpus documentaire : c'est un principe
d'architecture énoncé comme un fait acquis, alors qu'il est violé sur au moins six
écrans. Un collaborateur qui la lit supposera que les formules qu'il cherche sont dans
`src/lib/engine/`, et ne les y trouvera pas.

---

## 8. docs/ASSUMPTIONS.md

| # | Affirmation | Verdict | Constat |
|---|---|---|---|
| 8.1 | tableau des huit hypothèses explicites | VRAI | cohérent avec les données seedées dans `economic_assumptions` et les scénarios |
| 8.2 | PEA : total 15 003,13, ETF 8 698,00, cash 6 304,57, somme 15 002,57, écart 0,56 | VRAI | recalculé, exact |
| 8.3 | 14 300 de versements plus 703,12 de plus-value égale 15 003,12, soit 0,01 sous le total | VRAI | recalculé, exact. Second écart ouvert, non exposé dans l'interface |
| 8.4 | prêt : 60 fois 284,72 égale 17 083,20, écart 338,20 | VRAI | recalculé, exact |
| 8.5 | l'échéancier dérivé à 0 % plafonne le dernier remboursement au capital restant | VRAI | et testé |
| 8.6 | CTO : la performance +77,71 % est affichée comme annoncée, sans coût historique reconstruit | PARTIEL | la description du fait est exacte. Le libellé de l'écran est « Performance affichée », qui n'indique pas qu'il s'agit d'une valeur déclarée non vérifiable. Voir `UI_STATE_AUDIT.md` UI-003 |
| 8.7 | seul le loyer de 1 140 par mois est renseigné | VRAI | 1 catégorie sur 20 |
| 8.8 | le cash flow actuel connu est de +142 €/mois | FAUX | `deriveMetrics` produit -142,72 €. Le signe est inversé et l'ordre de grandeur diffère de 284,72 €, soit exactement la mensualité du prêt |
| 8.9 | la mensualité étudiante n'entre dans le cash flow exigible qu'à partir du 5 décembre 2026 | FAUX | le filtre `firstPaymentDate <= "2027-08-19"` capture ce prêt dès la date zéro. La mensualité est retranchée du cash-flow depuis le 19 août 2026 |

Les points 8.8 et 8.9 forment la contradiction centrale du produit. La documentation
décrit le comportement voulu, le code fait l'inverse, l'interface affiche le résultat du
code sous le libellé de la documentation. Trois sources, deux vérités. Le test
`shared.test.ts` verrouille par ailleurs le comportement du code en attendant
explicitement `-142,72`, ce qui signifie que la documentation et la suite de tests sont
en désaccord formel.

---

## 9. docs/ROADMAP.md

| # | Affirmation | Verdict | Constat |
|---|---|---|---|
| 9.1 | repository Supabase et Auth SSR effectifs après création du projet | PARTIEL | le repository est fait, Auth SSR reste à faire. Les deux sont regroupés dans une seule ligne de roadmap alors que l'un est terminé |
| 9.2 | liste des treize fonctions différées volontairement | VRAI | cohérente avec l'état du code |
| 9.3 | six améliorations à plus forte valeur | VRAI | et l'ordre proposé reste pertinent, avec une réserve : la ligne 3, création du projet Supabase, est déjà réalisée |

---

## 10. docs/DATA_VERIFICATION.md

| # | Affirmation | Verdict | Constat |
|---|---|---|---|
| 10.1 | liste de douze documents réels à obtenir | VRAI | et toujours d'actualité : aucun des douze n'a été importé dans le dépôt |
| 10.2 | mention de Corcept Therapeutics, AMD et Physical Gold USD au CTO | VRAI | cohérent avec la note de la position `pos_cto_unallocated` |
| 10.3 | « Physical Gold USD » | NON VÉRIFIABLE mais structurant | si cette ligne est réellement libellée en dollars, le CTO contient déjà une position en devise étrangère comptée à parité dans les 214,28 € du compte. Voir `DATA_INVARIANTS.md` INV-I-01 |

---

## Corrections proposées, par ordre de coût croissant

Toutes sont de la documentation. Aucune ne touche au code.

1. `docs/ASSUMPTIONS.md` 8.8 et 8.9 : aligner sur le comportement réel, ou marquer explicitement « comportement voulu, non implémenté ». C'est la correction la plus urgente : elle protège Paul d'implémenter une définition en croyant corriger un bug.
2. `README.md` 2.4 et 2.5 : retirer l'affirmation que Supabase n'est pas relié.
3. `README.md` 4.1 et 4.2 : choisir npm ou pnpm, et aligner toute la documentation. Le dépôt dit npm, la documentation dit pnpm.
4. `README.md` 4.5 : indiquer l'état réel des commandes de qualité à la ligne de base.
5. `docs/ARCHITECTURE.md` 7.6 : remplacer l'affirmation par la liste des exceptions connues, ou la reformuler en objectif.
6. `START_HERE.md` : réécrire ou supprimer au profit de `docs/COLLAB_START_HERE.md`.
7. `README.md`, section « Ce qui fonctionne » : ajouter le périmètre réel aux sept lignes marquées PARTIEL.
8. `docs/ROADMAP.md` 9.1 et 9.3 : sortir ce qui est fait.

## Points à soumettre à la review

1. npm ou pnpm ? La décision appartient à Tom, qui possède la CI. Elle conditionne la première commande que taperont Paul et Tom.
2. `START_HERE.md` doit-il être conservé comme trace historique ou supprimé ?
3. Faut-il corriger `docs/ASSUMPTIONS.md` avant ou après l'arbitrage sur le service de dette ? Corriger avant fige une définition qui n'est pas tranchée ; ne pas corriger laisse une contradiction visible.

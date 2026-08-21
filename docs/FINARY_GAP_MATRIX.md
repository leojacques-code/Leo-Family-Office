# Matrice d'écart Finary et Finary+

Léo Family Office. Version 0.1 du 20 août 2026. Lane : Léo (Product Truth).
Base : commit `ef5bacf`. Méthode : lecture du code, pas des libellés d'écran.

## Statut et méthode

Ce document ne modifie aucun fichier fonctionnel.

Règle de méthode appliquée : une page qui existe ne prouve rien. Chaque capability a
été évaluée en remontant du composant vers le moteur puis vers la persistance. Une
fonctionnalité n'est déclarée FUNCTIONAL que si le chemin complet écran vers moteur vers
base est réel.

### Échelle de statut

| Statut | Définition opérationnelle |
|---|---|
| ABSENT | ni écran, ni moteur, ni table |
| UI_ONLY | écran présent, aucun calcul ni persistance derrière |
| SANDBOX | calcul réel, mais état local React, rien n'est enregistré, rien ne remonte au patrimoine |
| PARTIAL | chemin complet sur une partie du périmètre seulement, ou formule matériellement incomplète |
| FUNCTIONAL | chemin écran, moteur et base complet, utilisable |
| TESTED | FUNCTIONAL, plus des tests automatisés couvrant la logique métier |
| PRODUCTION_READY | TESTED, plus provenance, explicabilité, complétude signalée et gestion des cas limites |

Aucune capability n'atteint PRODUCTION_READY au commit `ef5bacf`.

### Colonnes

FORMULA DEPTH : NONE, SHALLOW (arithmétique directe), MEDIUM (modèle à plusieurs
composantes), DEEP (modèle contractuel ou probabiliste complet).

TEST COVERAGE : nombre de tests automatisés qui touchent la logique de cette capability.
Le dépôt ne contient aucun framework de test d'interface : toute logique vivant dans
`pages.tsx` est mécaniquement à zéro test.

FINARY PARITY REQUIRED : la capability doit-elle atteindre le niveau de Finary pour que
le produit soit utilisable au quotidien.

## Vue d'ensemble

| Statut | Nombre de capabilities |
|---|---:|
| ABSENT | 8 |
| UI_ONLY | 3 |
| SANDBOX | 2 |
| PARTIAL | 12 |
| FUNCTIONAL | 5 |
| TESTED | 2 |
| PRODUCTION_READY | 0 |
| Total | 32 |

Lecture : 7 capabilities sur 32 sont réellement opérationnelles, dont 2
couvertes par des tests. 12 sont partielles, 8 sont absentes. Le produit est plus avancé qu'un prototype et très
loin d'une parité Finary sur les usages quotidiens, en particulier parce que la
capability qui conditionne toutes les autres, l'agrégation automatique des comptes et
des transactions, est absente.

---

## Bilan et comptes

| # | CAPABILITY | STATUS | FILES / ROUTES | PERSISTED | FORMULA DEPTH | TESTS | DATA DEPENDENCY | PARITÉ FINARY | DIFFÉRENCIATION LFO | BLOCKER | PRIO | OWNER | PHASE |
|---|---|---|---|---|---|---:|---|---|---|---|---|---|---|
| 1 | Cockpit | PARTIAL | `pages.tsx:TodayPage`, `/` | oui, lecture | SHALLOW | 0 | soldes, dettes, budget | oui | decision queue, provenance visible | KPI faux ou trompeurs, voir UI_STATE_AUDIT | P1 | Léo | 1 |
| 2 | Net Worth | FUNCTIONAL | `shared.ts:deriveMetrics`, `financial.ts:calculateNetWorth`, `/net-worth` | oui | SHALLOW | 7 | comptes, passifs | oui | non-double-comptage explicite, réconciliation exposée | périmètre financier seul, pas de FX | P1 | Paul | 1 |
| 3 | Accounts | FUNCTIONAL | `local-repository.ts`, `supabase-repository.ts`, `/api/state` | oui, historisé | SHALLOW | 0 | saisie manuelle | oui | historique daté de chaque solde | aucune agrégation bancaire | P1 | Tom puis Paul | 1 |
| 4 | Transactions | PARTIAL | `pages.tsx:CashFlowPage`, mutation `add_transaction` | oui | NONE | 0 | saisie manuelle | oui | provenance par ligne | pas de transferts, pas d'import, 0 transaction au seed | P1 | Paul | 3 |
| 5 | Budget | PARTIAL | `pages.tsx:CashFlowPage`, mutation `update_expense` | oui | SHALLOW | 2 | saisie manuelle | oui | MISSING jamais transformé en zéro | 1 catégorie sur 20 renseignée | P1 | Paul | 3 |
| 6 | Cash Flow | PARTIAL | `shared.ts:deriveMetrics` | oui, dérivé | SHALLOW | 2 | revenus, budget, dette | oui | séparation revenus actifs et inactifs | service de dette contradictoire, pas de taxes, pas d'historique | P1 | Paul | 3 |

Notes.

Net Worth est la capability la plus solide du produit. Sa propriété centrale, le
non-double-comptage des positions, est correcte et testée. Elle reste FUNCTIONAL et non
TESTED au sens de cette matrice parce que ses cas limites (multi-devises, compte
débiteur, périmètre immobilier) ne sont pas couverts.

Transactions est le point d'entrée de toute la valeur Finary. Sans import, l'utilisateur
saisit à la main, ce qui contredit frontalement le principe « maximum de données,
minimum de saisie ». C'est le premier goulot d'étranglement du produit.

---

## Investissements

| # | CAPABILITY | STATUS | FILES / ROUTES | PERSISTED | FORMULA DEPTH | TESTS | DATA DEPENDENCY | PARITÉ FINARY | DIFFÉRENCIATION LFO | BLOCKER | PRIO | OWNER | PHASE |
|---|---|---|---|---|---|---:|---|---|---|---|---|---|---|
| 7 | Investments, tracking | PARTIAL | `pages.tsx:InvestmentsPage` | oui, positions | SHALLOW | 1 | positions saisies | oui | réconciliation solde contre positions | identifiants de comptes en dur, valeurs en dur | P1 | Léo puis Paul | 5 |
| 8 | P&L de portefeuille | ABSENT | aucun | non | NONE | 0 | cost basis, flux | oui | attribution complète | aucun historique de flux | P2 | Paul | 5 |
| 9 | TWR et XIRR | ABSENT | aucun | non | NONE | 0 | flux datés par compte | oui | les deux, pas l'un des deux | aucun historique de flux | P2 | Paul | 5 |
| 10 | Frais | ABSENT | aucun | non | NONE | 0 | relevés | oui | fees drag explicite | modèle sans frais | P3 | Paul | 5 |
| 11 | Dividendes | ABSENT | aucun | non | NONE | 0 | relevés | oui | séparation coupon et prix | modèle sans flux de revenu | P3 | Paul | 5 |
| 12 | Allocation | UI_ONLY | `pages.tsx:TodayPage` donut | non | SHALLOW | 0 | positions, classes d'actifs | oui | drift contre cible | calcul dans le JSX, somme des tranches différente du centre | P2 | Léo | 5 |

Notes.

L'écart le plus large avec Finary est ici. Finary calcule performance, allocation, frais
et dividendes automatiquement à partir de connexions courtiers. LFO ne calcule aucune
performance et affiche à sa place trois constantes de code, dont un pourcentage
(« +77,71 % ») qu'aucune donnée du système ne permet de dériver.

La différenciation revendiquée, « performance ≠ enrichissement », n'est pas encore un
avantage : elle est une intention. Elle ne le deviendra qu'avec l'historique des flux.

---

## Dette et immobilier

| # | CAPABILITY | STATUS | FILES / ROUTES | PERSISTED | FORMULA DEPTH | TESTS | DATA DEPENDENCY | PARITÉ FINARY | DIFFÉRENCIATION LFO | BLOCKER | PRIO | OWNER | PHASE |
|---|---|---|---|---|---|---:|---|---|---|---|---|---|---|
| 13 | Debt | PARTIAL | `financial.ts:amortizeLoan`, `pages.tsx:DebtPage` | passif oui, échéancier non relu | MEDIUM | 2 | contrat de prêt | partielle | moteur contract-aware, priorité à l'échéancier bancaire | une seule dette traitée, différé faux, pas d'assurance | P1 | Paul | 1 |
| 14 | Real Estate | SANDBOX | `real-estate.ts`, `pages.tsx:RealEstatePage` | non | DEEP | 1 | hypothèses saisies | non | underwriting institutionnel, TRI, VAN, MOIC, DSCR | equity investie fausse, rien n'est enregistré | P1 | Paul | 8 |

Notes.

Debt est la capability où LFO peut dépasser Finary de la façon la plus visible et la
moins coûteuse. Finary traite un crédit comme une ligne de passif. Le business plan
exige un moteur qui comprend un contrat : différé, échéancier réel, assurance, paliers.
Le socle existe (`amortizeLoan` accepte une mensualité contractuelle prioritaire), et
trois défauts le bloquent : le différé n'est pas respecté, la maturité n'est pas testée,
une seule dette est traitée par l'écran.

Real Estate a la profondeur de formule la plus élevée du produit, et le statut le plus
faible : rien n'est persisté, rien ne remonte au patrimoine, et la formule d'equity
investie fausse tous les ratios de rentabilité d'un facteur 1,4 à 2,7 selon la
structure de financement.

---

## Capital humain et business

| # | CAPABILITY | STATUS | FILES / ROUTES | PERSISTED | FORMULA DEPTH | TESTS | DATA DEPENDENCY | PARITÉ FINARY | DIFFÉRENCIATION LFO | BLOCKER | PRIO | OWNER | PHASE |
|---|---|---|---|---|---|---:|---|---|---|---|---|---|---|
| 15 | Career | UI_ONLY | `pages.tsx:CareerPage` | non | SHALLOW | 0 | benchmarks externes | non | capital humain relié au patrimoine | courbes non sourcées, `employmentCompensation` jamais appelé | P2 | Paul | 7 |
| 16 | Business Equity | SANDBOX | `pages.tsx:BusinessPage` | non | SHALLOW | 0 | comptes de société | non | cap table, dilution, exit | tables présentes et inutilisées, libellé « dette nette brute » ambigu | P3 | Paul | 9 |
| 17 | Tax | UI_ONLY | `tax.ts`, `pages.tsx:TaxPage` | règle placeholder | MEDIUM | 2 | barèmes officiels | partielle | règles datées, sourcées, versionnées | aucune règle vérifiée chargée, moteur non appelé | P2 | Paul | 4 |

Notes.

Career et Tax sont le même problème vu deux fois : un moteur correct existe
(`employmentCompensation` dans `tax.ts`) et l'écran qui devrait l'utiliser calcule à sa
place, en ligne, dans le JSX, avec ses propres constantes.

Tax mérite d'être défendu sur un point : ne charger aucune règle non vérifiée et
afficher « Règles actives vérifiées : 0 » est le comportement correct. C'est plus
rigoureux que la plupart des outils grand public. La faiblesse n'est pas la prudence,
c'est que la prudence n'est pas appliquée avec la même constance ailleurs, notamment
sur la performance du CTO.

---

## Scénarios et décision

| # | CAPABILITY | STATUS | FILES / ROUTES | PERSISTED | FORMULA DEPTH | TESTS | DATA DEPENDENCY | PARITÉ FINARY | DIFFÉRENCIATION LFO | BLOCKER | PRIO | OWNER | PHASE |
|---|---|---|---|---|---|---:|---|---|---|---|---|---|---|
| 18 | Scenarios | TESTED | `types.ts`, deux repositories, `pages.tsx:ScenariosPage` | oui, versionné | MEDIUM | 1 | hypothèses | non | versions, duplication, jamais d'écriture sur ACTUAL | `salaryGrowth` stocké et jamais consommé, confiance forcée à HIGH | P2 | Paul | 6 |
| 19 | Monte-Carlo | TESTED | `monte-carlo.ts`, `/api/projection` | oui, runs et résultats | DEEP | 3 | scénario, actifs | non | queues épaisses, seed reproductible, méthodologie stockée | dette absente de la projection, année de base en dur | P2 | Paul | 6 |
| 20 | Decision Lab | PARTIAL | `decision.ts`, `pages.tsx:DecisionLabPage` | non | MEDIUM | 0 | hypothèses | non | comparaison et classement multicritère sans prescription (Q-11) | 1 cas sur 10, aucun test, coefficients à étiqueter `MODEL_HEURISTIC / EXPERIMENTAL`, inflation figée | P1 | Léo affichage, Paul méthode | 10 |
| 21 | Goals | FUNCTIONAL | `pages.tsx:GoalsPage`, mutation `add_goal` | oui | SHALLOW | 0 | patrimoine net | oui | « non calculable » assumé pour FI ratio et Freedom Coverage | aucun moteur d'atteinte, paliers non configurables | P3 | Paul | 11 |

Notes.

Monte-Carlo est la capability la mieux construite du produit : pas mensuel, Student-t à
5 degrés de liberté normalisée, stress rares, seed reproductible, méthodologie
persistée avec le run, formulation honnête des percentiles dans l'interface. Deux
réserves sérieuses : la dette n'est pas décrémentée dans la projection, et l'épargne
projetée (250 € par mois dans le scénario Central) n'a aucun lien avec le cash-flow
réellement constaté.

Decision Lab est le coeur intellectuel revendiqué du produit et la capability la plus
fragile de la matrice : zéro test sur un moteur qui affiche une recommandation, et
trois coefficients arbitraires non sourcés qui déterminent la conclusion.

---

## Clôture, documents et sorties

| # | CAPABILITY | STATUS | FILES / ROUTES | PERSISTED | FORMULA DEPTH | TESTS | DATA DEPENDENCY | PARITÉ FINARY | DIFFÉRENCIATION LFO | BLOCKER | PRIO | OWNER | PHASE |
|---|---|---|---|---|---|---:|---|---|---|---|---|---|---|
| 22 | Monthly Close | PARTIAL | deux repositories, `pages.tsx:TimelinePage` | oui | SHALLOW | 0 | état complet | non | rituel de pilotage, écart au plan | écrasement silencieux, « forecast » qui n'en est pas un, périmètre figé trop étroit | P1 | Paul | 12 |
| 23 | Documents | FUNCTIONAL | `/api/documents`, deux repositories, bucket privé | oui | NONE | 0 | fichiers | oui | coffre privé, allow-list MIME, 8 Mo | aucune extraction, aucun classement | P3 | Tom | 12 |
| 24 | Exports | FUNCTIONAL | `/api/export` | non applicable | NONE | 0 | état | oui | CSV comptes et dettes, backup JSON complet | pas de PDF, pas d'IC memo, CSV limité au bilan | P3 | Léo | 12 |
| 25 | Reporting | ABSENT | boutons « Coming soon » | non | NONE | 0 | tout | partielle | IC memo, rapport patrimonial | rien au-delà des exports | P3 | Léo | 12 |

Notes.

Monthly Close est mécaniquement fonctionnelle et sémantiquement fausse. C'est la
capability qui porte la promesse « comprendre pourquoi mon patrimoine a changé », et
elle ne stocke que trois agrégats, ce qui rend toute attribution ultérieure impossible.

Documents est correctement construite du point de vue sécurité : bucket privé,
allow-list MIME côté serveur, limite de taille, policies de stockage par propriétaire.

---

## Fondations transverses

| # | CAPABILITY | STATUS | FILES / ROUTES | PERSISTED | FORMULA DEPTH | TESTS | DATA DEPENDENCY | PARITÉ FINARY | DIFFÉRENCIATION LFO | BLOCKER | PRIO | OWNER | PHASE |
|---|---|---|---|---|---|---:|---|---|---|---|---|---|---|
| 26 | FX et multi-devises | ABSENT | `financial.ts:fxConvert`, table `currency_rates` | table vide | SHALLOW | 1 | taux datés | oui | conversion datée, attribution de change | primitive jamais appelée, addition silencieuse de devises | P1 | Paul | 2 |
| 27 | Open Banking | ABSENT | aucun | non | NONE | 0 | agrégateur agréé | oui | jamais d'écrasement d'une correction manuelle | statut réglementaire à cadrer | P2 | Tom | 13 |
| 28 | Market Data | ABSENT | aucun | non | NONE | 0 | fournisseur de cours | oui | fallback manuel obligatoire | aucune interface définie | P2 | Tom | 13 |
| 29 | Explain Calculation | PARTIAL | `ui.tsx:ExplanationPanel`, 6 appels dans `pages.tsx` | non | NONE | 0 | inputs réels | non | formule, inputs, dates, provenance | plusieurs panneaux affichent des constantes de code sous badge ACTUAL | P1 | Léo | 1 |
| 30 | Provenance | PARTIAL | `types.ts:Provenance`, `ui.tsx:DataBadge` | oui, par entité | NONE | 0 | toutes | non | six types, confiance, source, date | aucune propagation vers les agrégats, confiance forcée à HIGH après édition | P1 | Paul | 1 |
| 31 | Completeness | PARTIAL | `shared.ts:dataCompleteness` | dérivé | SHALLOW | 1 | budget | non | complétude par calcul, sens du biais | score unique qui ne mesure que le budget | P1 | Léo | 0 |
| 32 | Security | PARTIAL | `auth.ts`, `proxy.ts`, migrations, `/api/*` | non applicable | NONE | 0 | secrets | oui | RLS, bucket privé, aucune écriture bancaire | code d'accès partagé au lieu de Supabase Auth, RLS non contraignante avec la service key | P1 | Tom | 0 |

Notes.

Explain Calculation, Provenance et Completeness sont les trois capabilities qui portent
la différenciation revendiquée face à Finary. Les trois sont PARTIAL, et les trois
souffrent du même défaut : le mécanisme existe au niveau des entités et disparaît au
niveau des agrégats, c'est-à-dire exactement là où l'utilisateur regarde.

Security appelle une précision qui appartient à la lane de Tom et n'est pas arbitrée
ici : l'application utilise la clé de service Supabase côté serveur, ce qui contourne
RLS par construction. Les policies écrites dans la migration sont correctes (39 tables,
toutes porteuses d'un `user_id`, toutes couvertes par une policy `owner_all`, `anon`
révoqué, bucket privé), mais elles ne protègent rien tant que l'accès passe par la clé
de service et un code d'accès partagé plutôt que par Supabase Auth. Le README le dit,
l'écran Settings ne le dit pas.

---

## Les cinq écarts qui comptent

Classés par valeur produit, pas par difficulté.

1. Agrégation automatique des comptes et des transactions. Sans elle, le principe
   fondateur « maximum de données, minimum de saisie » est inversé. C'est le seul
   écart qui rend le produit inutilisable au quotidien, pas seulement incomplet.
2. Performance de portefeuille avec séparation des apports. C'est la promesse
   différenciante la plus concrète et la plus vérifiable face à Finary, et elle est
   aujourd'hui remplacée par une constante.
3. Debt Engine contract-aware. L'écart le plus rentable : le socle existe, il manque
   le différé, la maturité, l'assurance et le traitement de plusieurs dettes.
4. Explicabilité réelle. Le panneau existe, il est bien conçu, et il ment sur plusieurs
   écrans. Le corriger coûte peu et rétablit la crédibilité de toute la promesse.
5. Complétude par calcul. Elle conditionne l'honnêteté de tous les autres chiffres.

## Ce que ce document ne tranche pas

- L'ordre de traitement entre la parité Finary et la profondeur Finary+. La matrice
  donne la matière, l'arbitrage appartient à Léo.
- La faisabilité réglementaire de l'agrégation bancaire, qui relève du cadrage PSIC
  mentionné dans le business plan Beyonder.
- Le coût de chaque chantier, qui appartient à Paul et Tom.

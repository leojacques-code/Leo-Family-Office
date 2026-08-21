# Questions ouvertes

Léo Family Office. Version 0.2 du 20 août 2026, décisions du Checkpoint GPT-5.6 Sol intégrées. Lane : Léo (Product Truth).
Base : commit `ef5bacf`.

## Usage

Une question entre ici quand elle bloque une décision et qu'elle ne se tranche pas par
la lecture du code. Elle en sort quand la réponse est écrite, datée et reportée dans le
document de référence concerné.

Règle de collaboration : n'imposez pas une convention par un commit. Une définition qui
entre dans le code sans être écrite quelque part est une dette invisible.

| Champ | Sens |
|---|---|
| BLOQUE | ce qui ne peut pas avancer tant que la réponse n'est pas donnée |
| DÉCIDEUR | qui tranche |
| ÉCHÉANCE | quand la réponse est nécessaire |
| IMPACT SI NON TRANCHÉ | ce qui se passe si on laisse courir |

### État

Treize questions sur dix-huit ont été fermées le 20 août 2026 : Q-14 par la création de la
topologie de branches, les douze autres par le Checkpoint GPT-5.6 Sol. Cinq restent
ouvertes, dont quatre relèvent d'un arbitrage de Léo et une de Tom.

| ID | Sujet | Décideur | Échéance | Statut |
|---|---|---|---|---|
| Q-01 | Service de dette pendant un différé | Léo | avant toute correction du cash-flow | **fermée le 20/08** |
| Q-02 | Arrondi monétaire canonique | Paul, arbitrage Léo | avant de rendre la suite verte | **fermée le 20/08** |
| Q-03 | Convention actif ou passif d'un compte débiteur | Léo | avant l'import de comptes | **fermée le 20/08** |
| Q-04 | `liquidNetWorth` : implémenter ou retirer | Léo | avant la V1 | **fermée le 20/08** |
| Q-05 | `savingsRate` et `investmentRate` : deux métriques ou une | Léo | avant l'import de transactions | **fermée le 20/08** |
| Q-06 | Sémantique de `forecast_net_worth` | Léo | avant la deuxième clôture | **fermée le 20/08** |
| Q-07 | Confiance forcée à HIGH après édition | Léo | avant la V1 | **fermée le 20/08** |
| Q-08 | Projection déterministe : conserver, aligner ou supprimer | Léo | avant tout travail sur les projections | **fermée le 20/08** |
| Q-09 | `shockYear` : année relative ou civile | Léo | avant la V1 | **fermée le 20/08** |
| Q-10 | Assiette de la valeur de sortie immobilière | Paul, arbitrage Léo | avant de corriger le moteur immobilier | **fermée le 20/08** |
| Q-11 | Decision Lab : recommandation ou comparaison | Léo | immédiat | **fermée le 21/08** |
| Q-12 | Données personnelles réelles dans le dépôt | Léo, mise en oeuvre Tom | avant l'arrivée de Paul et Tom | ouverte |
| Q-13 | npm ou pnpm | Tom | avant l'arrivée de Paul et Tom | ouverte |
| Q-14 | Topologie de branches inexistante | Léo | avant l'arrivée de Paul et Tom | **fermée le 20/08** |
| Q-15 | Périmètre nommé « Patrimoine brut » | Léo | avec les correctifs de copie | **fermée le 20/08** |
| Q-16 | Clôture d'un mois déjà clos : refus ou réouverture | Léo | avant la deuxième clôture | **fermée le 20/08** |
| Q-17 | Barre d'acceptation V1 | Léo | avant le 24 août | ouverte |
| Q-18 | Ordre entre parité Finary et profondeur Finary+ | Léo | avant le 24 août | ouverte |
| Q-19 | Vérification du compte auteur pour Vercel | Léo, règle d'équipe Tom | avant l'arrivée de Paul et Tom | ouverte |

---

## Q-12 · Données personnelles réelles dans le dépôt

CONTEXTE
Le dépôt contient l'inventaire patrimonial complet d'une personne physique identifiée :
soldes de six comptes, contenu du PEA et du CTO, capital et échéancier du prêt, revenu
net, loyer, noms des cinq établissements. Ces données sont dans
`src/lib/data/local-repository.ts`, `scripts/seed-supabase.ts` et
`src/lib/data/__tests__/shared.test.ts`. Le plan prévoit l'arrivée de deux
collaborateurs qui n'ont pas besoin de ces données pour travailler.

OPTIONS
- A. Remplacer le seed de développement par le golden dataset synthétique, et charger
  les données réelles uniquement en production. Effet de bord favorable : les tests
  cessent de dépendre du patrimoine réel.
- B. Restreindre l'accès au dépôt, ce qui contredit l'arrivée des collaborateurs.
- C. Anonymiser en conservant les ordres de grandeur, ce qui casse les réconciliations
  documentées.

BLOQUE : rien techniquement. C'est une décision de confidentialité.
DÉCIDEUR : Léo décide, Tom met en oeuvre.
ÉCHÉANCE : avant l'arrivée de Paul et Tom.
IMPACT SI NON TRANCHÉ : deux collaborateurs auront accès à un inventaire patrimonial
nominatif sans nécessité opérationnelle.

---

## Q-13 · npm ou pnpm

CONTEXTE
Le dépôt contient `package-lock.json`, produit par npm. Toute la documentation parle de
pnpm, et `README.md` recommande `pnpm install --frozen-lockfile`, commande qui échoue
faute de `pnpm-lock.yaml`. C'est le premier obstacle qu'un nouvel arrivant rencontrera.

OPTIONS
- A. npm, aligner la documentation et les scripts.
- B. pnpm, générer et versionner `pnpm-lock.yaml`, supprimer `package-lock.json`.

BLOQUE : la première commande que taperont Paul et Tom. La configuration de CI.
DÉCIDEUR : Tom, qui possède la CI.
ÉCHÉANCE : avant l'arrivée de Paul et Tom.
IMPACT SI NON TRANCHÉ : deux collaborateurs perdent leur première heure, et deux
lockfiles concurrents peuvent apparaître.

---

## Q-17 · Barre d'acceptation V1

CONTEXTE
`docs/ACCEPTANCE_CRITERIA_V1.md` propose cinq conditions pour qu'un module soit
acceptable en V1. Au commit `ef5bacf`, aucun module ne les satisfait toutes.

QUESTION : la barre est-elle la bonne, ou est-elle trop haute pour une V1 ?

BLOQUE : la définition de ce qui reste à faire avant de fusionner vers `main`.
DÉCIDEUR : Léo.
ÉCHÉANCE : avant le 24 août.
IMPACT SI NON TRANCHÉ : Codex auditera sans critère d'acceptation partagé, et rendra un
avis sur une cible implicite.

---

## Q-18 · Ordre entre parité Finary et profondeur Finary+

CONTEXTE
`docs/FINARY_GAP_MATRIX.md` identifie cinq écarts majeurs. Le premier, l'agrégation
automatique des comptes et des transactions, est un écart de parité : sans lui, le
principe « maximum de données, minimum de saisie » est inversé. Le troisième, le Debt
Engine contract-aware, est un écart de différenciation : le socle existe et le retour
sur effort est élevé.

QUESTION : construire d'abord la parité qui rend le produit utilisable au quotidien, ou
d'abord la profondeur qui le rend unique ?

BLOQUE : la roadmap post-24 août.
DÉCIDEUR : Léo.
ÉCHÉANCE : avant le 24 août.
IMPACT SI NON TRANCHÉ : le travail de Paul et Tom s'oriente par défaut vers ce qui est
techniquement le plus proche, pas vers ce qui a le plus de valeur.

---

## Q-19 · Vérification du compte auteur des commits pour Vercel

CONTEXTE
Vercel refuse de déployer une prévisualisation quand il ne peut pas rattacher l'adresse
de commit à un compte GitHub ayant accès à l'équipe. Les commits de la branche
`claude/plan-de-leo-qakf68` portent `lchety@triactis.com`, qui n'est pas reliée. Le
statut `Vercel / Deployment was blocked` est donc rouge sur PR #1, alors que la PR ne
touche que `docs/` et que `next build` sort en 0 sur le même HEAD.

Ce blocage n'est pas un défaut : c'est un contrôle d'accès qui fonctionne. Il ne doit pas
être contourné, ni par réécriture de l'auteur des commits, ni par un commit vide, ni par
une modification du réglage Vercel.

OPTIONS
- A. Relier l'adresse de commit au compte GitHub rattaché à l'équipe Vercel. Remède
  documenté par Vercel lui-même.
- B. Convenir d'une adresse de commit unique pour tous les collaborateurs du projet, et
  la relier une seule fois.
- C. Ne rien faire, et accepter que les prévisualisations restent bloquées sur toute PR
  de documentation. Tenable pour `docs/`, intenable dès qu'une PR touche l'interface.

BLOQUE : les déploiements de prévisualisation sur toute PR dont l'auteur n'est pas
vérifié. Paul et Tom heurteront le même mur à leur première PR.
DÉCIDEUR : Léo pour son propre compte, Tom pour la règle d'équipe.
ÉCHÉANCE : avant l'arrivée de Paul et Tom.
IMPACT SI NON TRANCHÉ : aucune prévisualisation exploitable, donc aucune revue visuelle
possible sur les PR d'interface, qui sont précisément celles où elle sert le plus.

---

## Questions fermées

Une question tranchée descend ici avec sa réponse, sa date et les documents mis à jour.
Elle n'est pas supprimée : la trace de l'arbitrage vaut autant que l'arbitrage.

---

## Q-11 · Decision Lab, recommandation ou comparaison · FERMÉE le 21 août 2026, Checkpoint GPT-5.6 Sol

CONTEXTE INITIAL
`compareDebtVsInvest` affichait un bandeau « Espérance ajustée supérieure » et un
« Avantage ajusté » en euros. Trois coefficients non sourcés déterminaient la
conclusion : décote de risque 0,25, poids de liquidité 0,03, seuil de qualification du
risque 0,15. Le moteur n'avait aucun test. Le business plan §13.1 pose la règle
inverse : ne jamais conclure sur un seul critère, exposer liquidité, risque, downside,
coût d'opportunité et flexibilité.

RÉPONSE, décision canonique

> Decision Lab V1.2 may compare and rank objective outcomes, but must not issue
> prescriptive recommendations based on unvalidated heuristics. `riskHaircut`,
> `liquidityWeight`, and any unsourced weighting must be labelled
> `MODEL_HEURISTIC / EXPERIMENTAL`, with formula and impact auditable. No
> « you should choose X » recommendation until methodology is documented, tested
> and approved.

Ce que la décision autorise :
- comparer des univers et les **classer** sur des critères objectifs et vérifiables
  (patrimoine final, intérêts évités, valeur espérée, liquidité restante, downside) ;
- afficher chaque critère séparément, avec sa formule et ses inputs ;
- afficher un résultat pondéré, à condition que la pondération soit visible, étiquetée
  `MODEL_HEURISTIC / EXPERIMENTAL`, et que son impact sur le classement soit auditable,
  c'est-à-dire que l'utilisateur puisse voir le classement sans elle.

Ce que la décision interdit :
- toute formulation prescriptive du type « vous devriez choisir X », « option
  recommandée », « espérance ajustée supérieure » présentée comme une conclusion ;
- tout coefficient non sourcé qui influence un classement sans être étiqueté et
  auditable ;
- toute mise en avant visuelle d'une option (bandeau, carte « preferred », accentuation)
  qui équivaut à une recommandation sans en porter le nom.

Levée de l'interdiction : lorsque la méthodologie est documentée, testée et approuvée.
Les trois conditions sont cumulatives. Un test qui vérifie qu'un coefficient est
appliqué ne documente ni n'approuve la valeur de ce coefficient.

NOUVELLE ÉTIQUETTE : `MODEL_HEURISTIC / EXPERIMENTAL`
Distincte de `MODEL_ASSUMPTION`. Un `MODEL_ASSUMPTION` est un paramètre de modèle
assumé, dont l'utilisateur peut discuter la valeur (un rendement espéré, une inflation).
Un `MODEL_HEURISTIC / EXPERIMENTAL` est un coefficient de jugement dont la méthode
elle-même n'est pas validée : ce n'est pas seulement sa valeur qui est ouverte, c'est sa
légitimité. Il ne peut jamais porter seul une conclusion.

DOCUMENTS MIS À JOUR : `FINANCIAL_DEFINITIONS.md` §10 (table de provenance et règles),
`DATA_INVARIANTS.md` INV-M-05, `UI_STATE_AUDIT.md` UI-013,
`FINANCIAL_HARDCODES_AUDIT.md` HC-07, HC-08, HC-09,
`ACCEPTANCE_CRITERIA_V1.md` Decision Lab, `EXPLAIN_CALCULATION_SPEC.md` §4.12,
`FINARY_GAP_MATRIX.md` capability 20, `PRE_CODEX_REVIEW.md` B-09 et §13.

CE QUI RESTE OUVERT, et qui n'était pas dans Q-11 :
- la méthodologie de pondération elle-même reste à écrire, à tester et à approuver. La
  décision ne la fournit pas, elle en conditionne l'usage ;
- l'absence de test sur `decision.ts` demeure un manque de couverture, indépendamment de
  la question de la recommandation.

---

## Q-01 · Service de dette pendant un différé · FERMÉE le 20 août 2026, Checkpoint GPT-5.6 Sol

RÉPONSE : `DebtService(période)` est la somme des `LoanScheduleEntry.totalCashOut` contractuellement exigibles dans la période. Avant la première échéance : 0. En différé partiel : les intérêts intercalaires réellement exigibles. Après la maturité : 0. Assurance et frais inclus lorsqu'ils existent. Aucune de ces trois situations n'est un cas particulier : elles découlent du comptage des échéances exigibles.

DOCUMENTS MIS À JOUR : `FINANCIAL_DEFINITIONS.md` §4.3, INV-D-02, INV-D-03, INV-D-08, CASE 8, CASE 11.

NOTE : La valeur juste au 19 août 2026 est donc 0 € de service de dette et +142 € de cash-flow libre avant impôt. Le libellé de l'interface et `docs/ASSUMPTIONS.md` deviennent corrects, et c'est `deriveMetrics` plus le test `shared.test.ts` qui doivent changer. Reste à faire, hors documentation : le modèle ne porte pas encore d'échéancier lisible.

---

## Q-02 · Arrondi monétaire canonique · FERMÉE le 20 août 2026, Checkpoint GPT-5.6 Sol

RÉPONSE : Calculs internes en pleine précision, sans arrondi intermédiaire. Arrondi aux deux seules frontières où un montant devient un engagement ou une information : la restitution (affichage, export, rapport) et le contrat (échéance débitée, montant facturé).

DOCUMENTS MIS À JOUR : `FINANCIAL_DEFINITIONS.md` §2.3, INV-A-02.

NOTE : Conséquence sur INV-A-01 : le calcul est RESPECTED côté implémentation, le test est FAILING. C'est le test qui doit être aligné sur la règle, pas la formule.

---

## Q-03 · Convention d'un compte bancaire débiteur · FERMÉE le 20 août 2026, Checkpoint GPT-5.6 Sol

RÉPONSE : Un solde bancaire débiteur est un passif court terme. Il entre dans `Liabilities`, jamais dans `GrossAssets`, qui devient la somme des soldes positifs.

DOCUMENTS MIS À JOUR : `FINANCIAL_DEFINITIONS.md` §2.4, INV-A-06.

NOTE : `NetWorth` est inchangé par le choix : seule la présentation du bilan diffère. L'enjeu est la visibilité du découvert dans les analyses de passif et de liquidité.

---

## Q-04 · `liquidNetWorth` · FERMÉE le 20 août 2026, Checkpoint GPT-5.6 Sol

RÉPONSE : Remplacée par trois grandeurs distinctes : `LiquidAssets`, `NetLiquidityPosition30d` et `LiquidNetWorth`, chacune avec sa définition et son usage. Aucune n'est un alias de `NetWorth`.

DOCUMENTS MIS À JOUR : `FINANCIAL_DEFINITIONS.md` §3.2, INV-B-06.

NOTE : Prérequis non tranché : la qualification de la liquidité par type d'actif, qui suppose d'exploiter enfin le champ `liquidity` de `FinancialAccount`.

---

## Q-05 · `savingsRate` et `investmentRate` · FERMÉE le 20 août 2026, Checkpoint GPT-5.6 Sol

RÉPONSE : Métriques de flux constatés, lues dans le ledger de flux. Tant que ce ledger n'existe pas, elles sont NOT_COMPUTABLE. Elles ne sont approximées ni par le free cash flow, ni par une capacité théorique, ni par une différence de soldes.

DOCUMENTS MIS À JOUR : `FINANCIAL_DEFINITIONS.md` §4.5, INV-B-07.

NOTE : `shared.test.ts` verrouille aujourd'hui le proxy par le FCF, donc le test devra changer avec la formule.

---

## Q-06 · Sémantique de `forecast_net_worth` · FERMÉE le 20 août 2026, Checkpoint GPT-5.6 Sol

RÉPONSE : Le champ contient une vraie prévision future, produite avant le mois, avec la trace du scénario et de sa version. Jamais la clôture précédente. En l'absence de projection préalable, il reste MISSING plutôt que d'être rempli par défaut.

DOCUMENTS MIS À JOUR : `FINANCIAL_DEFINITIONS.md` §8.2, INV-J-03, CASE 18.

NOTE : La variation entre deux clôtures reste une grandeur utile, mais distincte, et porte son propre nom.

---

## Q-07 · Confiance forcée à HIGH après édition · FERMÉE le 20 août 2026, Checkpoint GPT-5.6 Sol

RÉPONSE : Une donnée éditée devient USER_ASSUMPTION, et cela n'implique aucune confiance HIGH. La confiance qualifie la vérification, pas l'intention. Elle conserve sa valeur antérieure ou est demandée, jamais élevée par effet de bord.

DOCUMENTS MIS À JOUR : `FINANCIAL_DEFINITIONS.md` §10, INV-H-04.

NOTE : Les mutations concernées vivent dans les repositories, donc la mise en oeuvre relève de la lane de Tom, pas de celle de Paul.

---

## Q-08 · Projection déterministe · FERMÉE le 20 août 2026, Checkpoint GPT-5.6 Sol

RÉPONSE : Conservée, pour sa valeur d'explicabilité, et branchée sur le même moteur de bilan mensuel que le Monte-Carlo, exécuté à volatilité nulle et sans stress.

DOCUMENTS MIS À JOUR : `FINANCIAL_DEFINITIONS.md` §9.1, INV-G-07.

NOTE : Propriété vérifiable qui en découle et qui devient un test : à volatilité 0 et stress 0, la trajectoire déterministe et le P50 coïncident année par année.

---

## Q-09 · `shockYear` · FERMÉE le 20 août 2026, Checkpoint GPT-5.6 Sol

RÉPONSE : Remplacé conceptuellement par une date d'effet (`shockDate`) ou une période d'effet (`effectiveFrom`, `effectiveTo`). Un entier relatif à l'année 1 change de sens dès que la date d'observation bouge.

DOCUMENTS MIS À JOUR : `FINANCIAL_DEFINITIONS.md` §8.1, INV-G-08.

NOTE : Impose une migration de la colonne `shock_year`, donc une intervention de la lane de Tom.

---

## Q-10 · Assiette de la valeur de sortie immobilière · FERMÉE le 20 août 2026, Checkpoint GPT-5.6 Sol

RÉPONSE : Le coût des travaux et la valeur qu'ils créent sont deux grandeurs séparées. Le coût est certain, la valeur créée est une hypothèse explicite portée par `postRenovationValue` ou `valueCreationFromWorks`, avec sa propre provenance. Aucune capitalisation 1 pour 1 implicite.

DOCUMENTS MIS À JOUR : INV-E-04, CASE 13.

NOTE : Reste ouvert : la valeur par défaut de `postRenovationValue` quand l'utilisateur ne la renseigne pas. Le golden dataset retient le repli sur le prix d'achat avec drapeau, à confirmer.

---

## Q-15 · Périmètre nommé « Patrimoine brut » · FERMÉE le 20 août 2026, Checkpoint GPT-5.6 Sol

RÉPONSE : Tant que le bilan ne contient que des actifs financiers, le libellé est « Actifs financiers identifiés ». « Patrimoine brut » est réservé au périmètre complet, immobilier et business equity inclus.

DOCUMENTS MIS À JOUR : `FINANCIAL_DEFINITIONS.md` §2.1, INV-A-05.

NOTE : Correctif de copie, zone verte, sans effet sur aucun calcul.

---

## Q-16 · Clôture d'un mois déjà clos · FERMÉE le 20 août 2026, Checkpoint GPT-5.6 Sol

RÉPONSE : Réouverture explicite avec versionnage. Une clôture ne peut pas être remplacée : elle doit d'abord être rouverte par une opération distincte et tracée, la reclôture crée alors une version supplémentaire, et toutes les versions antérieures sont conservées.

DOCUMENTS MIS À JOUR : `FINANCIAL_DEFINITIONS.md` §8.2, INV-J-01, CASE 18, CASE 20.

NOTE : Le refus strict a été écarté : une correction postérieure à une clôture est un cas normal, et l'interdire pousserait à ne pas corriger.

---

## Q-14 · Topologie de branches · FERMÉE le 20 août 2026

CONTEXTE INITIAL
Le plan de développement §3 et le business plan §19.1 décrivent une topologie à six
branches. Au moment de l'audit du 20 août, le dépôt ne contenait que `leo/phase0` et
`claude/plan-de-leo-qakf68`, pointant sur le même commit. Ni `main`, ni branche
d'intégration, ni branches de collaborateurs. La règle « toutes les PR ciblent
`integration/v1.2-hardening` » n'était donc pas applicable, et le plan du 22 août,
revue des PR de Paul et Tom, était inexécutable.

RÉPONSE : option A, topologie complète créée.

État vérifié le 20 août 2026 à 15h07 UTC :

| Branche | Commit | Rôle |
|---|---|---|
| `main` | `ee0d16d` | production, V1.1 Supabase |
| `audit/financial-engine` | `ef5bacf` | baseline auditée, à geler |
| `integration/v1.2-hardening` | `ef5bacf` | zone de convergence |
| `leo/phase0` | `ef5bacf` | lane Léo |
| `finance/paul-sprint` | `ef5bacf` | lane Paul |
| `platform/tom-security` | `ef5bacf` | lane Tom |

La topologie est conforme au plan §3 : `audit/financial-engine` ajoute `ENGINE_AUDIT.md`
à `main`, et les quatre branches suivantes en dérivent sans divergence.

DOCUMENTS MIS À JOUR : `COLLAB_START_HERE.md` §4, `PRE_CODEX_REVIEW.md` §1, §10 et §11.

CE QUI RESTE OUVERT, et qui n'était pas dans Q-14 :
- geler formellement `audit/financial-engine`, prévu par le plan §3, non fait ;
- `integration/v1.2-hardening` ne contient aucun travail de convergence à ce jour ;
- PR #1 cible `leo/phase0`, ce qui est correct : c'est la branche de Léo. La PR
  suivante, `leo/phase0` vers `integration/v1.2-hardening`, reste à ouvrir.

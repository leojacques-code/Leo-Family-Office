# Léo Family Office : constitution technique

Mémoire courte et stable du dépôt. Tout agent la lit avant d'écrire du code. Elle ne
décrit pas un sprint : elle décrit ce qui reste vrai entre les sprints. Un prompt de
mission n'a donc plus à réénoncer ces règles, seulement son objectif, ses frontières et
ses critères d'acceptation.

## 1. Ce que le produit est

Un Personal Capital Operating System : profondeur maximale dans les moteurs, simplicité
maximale dans l'interface. La complexité interne ne doit jamais obliger l'utilisateur à
faire lui-même le travail du moteur.

Le succès ne se mesure pas au nombre d'écrans, mais à la possibilité de confier au
système une décision financière importante. Cinq exigences : fidélité, automatisation,
explicabilité, adaptabilité, intelligence de décision.

## 2. Architecture en couches

```text
SOURCE → NORMALISATION → DONNÉE CANONIQUE → MOTEURS DE DOMAINE
       → CONSÉQUENCES ÉCONOMIQUES CANONIQUES → BILAN / CASH FLOW
       → MODÈLE MENSUEL → ÉVÉNEMENTS → SCÉNARIOS → OBJECTIFS / DÉCISION → REPORTING
```

Règle unique et non négociable : **une couche aval ne recalcule jamais la logique d'une
couche amont**. Un domaine possède sa vérité, les autres la consomment.

- `src/lib/engine/` : fonctions TypeScript pures, sans React ni accès base.
- `src/lib/data/` : `FamilyOfficeRepository`, unique implémentation `supabase-repository.ts`.
- `supabase/migrations/` : source de vérité du schéma PostgreSQL.
- `src/components/` : affichage. Aucune formule financière dans un composant. Si un
  chiffre manque, il vient d'un moteur ou il n'est pas affiché.

Une seule vérité par domaine. `deriveMetrics()` (legacy) coexiste encore avec le bilan
canonique dans `supabase-repository.ts` : c'est une dette connue, à réduire à chaque PR
qui touche un périmètre concerné, jamais à étendre.

## 3. Invariants financiers

Ces distinctions sont la constitution du logiciel. Les violer est un bug, même si les
tests passent.

```text
NULL ≠ ZERO                          ACTUAL ≠ USER_ASSUMPTION ≠ MODEL_ASSUMPTION
OBSERVED ≠ CONTRACTUAL ≠ PROJECTED   ASSET ≠ LIABILITY
CASH FLOW ≠ COÛT ÉCONOMIQUE          PRINCIPAL ≠ CHARGE
TRANSFERT ≠ DÉPENSE                  CONTRIBUTION ≠ PERFORMANCE
PnL RÉALISÉ ≠ PnL LATENT             PnL MARCHÉ ≠ PnL DE CHANGE
DIVIDENDE ≠ CONTRIBUTION             VARIATION DE PRIX ≠ FLUX DE TRÉSORERIE
LIQUIDITÉ ≠ PATRIMOINE NET           COÛT DE REVIENT ≠ VALEUR DE MARCHÉ
VALORISATION ≠ CASH                  FX ABSENT ≠ FX ÉGAL À 1
```

Corollaires appliqués dans le code existant, à préserver :

- un compte bancaire négatif devient un passif de découvert, il ne réduit pas les actifs
  bruts ;
- les positions expliquent la composition d'une enveloppe, elles ne s'y ajoutent pas :
  un PEA observé à 20 000 € composé de 15 000 € d'ETF et 5 000 € de cash reste 20 000 € ;
- le ledger portefeuille explique comment une position s'est constituée ; il ne produit
  aucune ligne de bilan et une observation sans historique déclaré n'en dérive rien ;
- un taux de change n'est jamais postérieur à la date de valorisation ; un taux ancien
  reste utilisable mais signalé ; un taux absent rend le total non calculable ;
- le remboursement de capital est neutre sur le patrimoine net ;
- une première transaction observée ne prouve pas la couverture de l'historique, et une
  absence d'historique n'est pas un mois à zéro ;
- une valorisation immobilière est une observation datée : elle est signalée périmée, jamais
  indexée ni corrigée, et son absence est un montant inconnu, pas un bien sans valeur ;
- une quote-part détenue non déclarée ne vaut pas 100 % : la valeur attribuable au
  patrimoine devient non calculable ;
- la quote-part d'un concours affectée à des biens ne dépasse jamais 1, sans quoi la même
  dette serait comptée deux fois : c'est un invariant de la base, garanti sous concurrence,
  pas un contrôle applicatif ;
- l'absence de dette rattachée à un bien n'est pas une absence de dette : seul un zéro
  DÉCLARÉ autorise à calculer une equity, sans quoi le patrimoine serait surévalué du
  montant entier du crédit non saisi ;
- un capital emprunté est un montant historique : sans date de décaissement connue, sa
  contre-valeur en devise de reporting n'est pas calculable, et la première échéance n'en
  tient pas lieu ;
- une charge d'exploitation déclarée à zéro est une information, une charge non déclarée n'en
  est pas une : le rendement net qui en dépend reste non calculable.

## 4. Provenance, qualité, honnêteté

Toute valeur significative porte : nature de la donnée, provenance, date, confiance et,
si pertinent, réconciliation. Une information inconnue devient `null`, `MISSING`,
`PARTIAL`, `NOT_COMPUTABLE` ou un flag explicite. Jamais une valeur plausible.

Pas de fausse précision : un calcul techniquement possible mais économiquement non fondé
ne doit pas être affiché. Le nombre de simulations n'est pas un indicateur de qualité si
le modèle est trop simplifié.

Un garde-fou se pose au niveau où l'information manque. Une incohérence sur un compte ne
doit pas effacer l'information certaine des autres comptes.

## 5. Supabase et migrations

Supabase PostgreSQL est la persistance unique. PostgreSQL persiste, TypeScript calcule :
aucune formule financière en SQL. Les écritures composées passent par les RPC `lfo_*`,
réservées à `service_role`, qui persistent des résultats déjà calculés.

- migrations additives uniquement, jamais de modification rétroactive d'un fichier
  appliqué ;
- `supabase/migrations/` doit reproduire la base à l'identique : l'historique local et
  l'historique distant sont égaux, ou le gate échoue dans les deux sens ;
- écritures multi-tables importantes atomiques ;
- ne jamais pointer un développement vers la production par défaut, ne jamais placer un
  secret de production dans un environnement d'agent ;
- `supabase/local/shim.sql` double les schémas gérés par la plateforme pour le gate
  local. Ce n'est pas une migration et il ne décrit aucun objet applicatif.

Une divergence de schéma se documente dans le registre de `docs/SUPABASE_SETUP.md`, elle
ne se comble jamais par du SQL reconstitué : le contenu réel s'extrait de
`supabase_migrations.schema_migrations`. La divergence des deux index de
`net_worth_snapshot_items` a été clôturée ainsi le 25 août 2026, dépôt et production
ont ensuite été alignés sur 17 versions : Portfolio Data Foundation puis ses index
couvrant les clés étrangères. Les deux dernières migrations ont été appliquées en
production et contrôlées par assertions SQL transactionnelles et advisors Supabase.

## 6. Tests et gates

```bash
npm run lint
npm run test          # unitaires, moteurs purs, golden cases
npm run build
npm run db:local:up   # PostgreSQL local jetable (une fois par machine ou par session)
npm run gate:local    # reset depuis les migrations + db:verify:local + smokes
```

Le gate local prouve, sans aucun credential, que les migrations du dépôt reconstruisent
un schéma conforme depuis zéro. Il ne prouve pas l'état réel de la production : le push
distant et `npm run db:verify` restent des étapes humaines. Ne jamais déclarer vert un
gate distant non exécuté.

Un moteur financier se livre avec ses cas limites, pas seulement son cas nominal :
valeur manquante, devise étrangère, taux absent, historique insuffisant, division par
zéro, incohérence de réconciliation. Aucune donnée synthétique ne reste persistée : les
smokes écrivent en transaction et annulent.

## 7. Ordre des moteurs

Correctness → données → intégration → calculs → tests → produit → interface.

```text
faits          Debt · Cash Flow · Canonical Balance Sheet · Portfolio (données + analytics)
               Real Estate (faits + scénarios)
en cours       vérité de schéma · vérité des consommateurs
suivant        Business Equity → Career + Tax
puis           Event Engine → Scenarios V2 → Goals → Decision Lab
enfin          imports et connecteurs → expérience globale → orchestration IA
```

Un moteur aval ne démarre pas avant que son amont soit fiable. Real Estate consomme le
Debt Engine et ne recalcule aucun échéancier : depuis Real Estate V2, le domaine immobilier
n'amortit plus rien lui-même, il émet une ligne d'actif au bilan canonique et se rattache à
une dette existante par une quote-part. Aucune ligne de passif immobilier n'est produite par
le domaine : elle viendrait doubler celle de `liabilities`. Un crédit hypothétique passe par
`syntheticLoan` puis par le Debt Engine ; `amortizeLoan` de `financial.ts` est déprécié.

Real Estate n'entre PAS dans le Personal Monthly Financial Model comme actif projeté : sa
valeur y est portée constante et signalée, faute de termes projetables. Une trajectoire
immobilière modélisée reste un chantier distinct.

Ne pas construire une analytique sans la donnée qui l'alimente. Une métrique de
performance sans ledger d'investissement ne produit que du `NOT_COMPUTABLE`. Le ledger
portefeuille porte les faits, jamais les lots ni le coût de revient, qui en sont dérivés.
Portfolio Analytics reste une couche pure distincte : TWR, XIRR et attribution ne démarrent que
sur une enveloppe dont la couverture est déclarée et dont les valorisations nécessaires existent.

## 8. Ce qu'un agent ne doit jamais inventer

- du SQL reconstitué depuis le nom d'une migration ou d'un index ;
- une allocation cible, un rendement, une convention fiscale ou un taux non fournis ;
- un chiffre sans source rattachable ;
- un gate déclaré vert sans avoir été exécuté ;
- une convention existante modifiée silencieusement ;
- une valeur par défaut à la place d'une donnée manquante.

En cas de doute : livrer l'information partielle avec son état explicite, et dire ce qui
manque.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

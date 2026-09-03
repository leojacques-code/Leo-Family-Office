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
SOURCE → RAW → NORMALISATION → VALIDATION → DÉDUPLICATION → PREVIEW
       → DONNÉE CANONIQUE → MOTEURS DE DOMAINE
       → CONSÉQUENCES ÉCONOMIQUES CANONIQUES → BILAN / CASH FLOW
       → MODÈLE MENSUEL → ÉVÉNEMENTS → SCÉNARIOS → OBJECTIFS / DÉCISION → REPORTING
```

Règle unique et non négociable : **une couche aval ne recalcule jamais la logique d'une
couche amont**. Un domaine possède sa vérité, les autres la consomment.

- `src/lib/engine/` : fonctions TypeScript pures, sans React ni accès base.
- `src/lib/acquisition/` : lecture d'une source. Fonctions pures aussi, sans React ni accès
  base. Elle ne calcule AUCUNE finance : elle produit des candidats de faits, avec leurs
  ambiguïtés déclarées, et refuse de transporter ce qu'elle n'a pas compris.
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
SOURCE DATA ≠ CANONICAL DATA         RAW DATA ≠ NORMALIZED DATA
DUPLICATE ≠ NEW EVENT                RESSEMBLANCE ≠ DOUBLON
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
- l'absence d'événement de frais d'acquisition ou de capex ne vaut pas zéro : une déclaration
  explicite, y compris à 0, est requise pour calculer coût de revient, plus-value et rendement sur
  coût ; un événement futur ne modifie jamais une lecture présente ;
- les flux immobiliers observés sont convertis par le FX Engine à la date de chaque transaction ;
  une dette future dans une autre devise reste non calculable sans courbe FX future explicite, le
  dernier spot n'étant jamais prolongé silencieusement.

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
réservées à `service_role`, qui persistent des faits et hypothèses atomiquement.

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
`supabase_migrations.schema_migrations`.

Le DÉPÔT porte **42 migrations**, rejouables depuis une base vide (`npm run db:local:reset` :
42 appliquées, 105 tables publiques). Les neuf dernières sont les cinq verticales
d'acquisition ajoutées par ce chantier et leur réconciliation :

- `20260831101500_company_registry_acquisition` ;
- `20260831154500_document_intelligence_foundation` ;
- `20260831171500_real_estate_public_data` ;
- `20260902093000_portfolio_import_acquisition` ;
- `20260903090000_import_raw_freeze_hardening` ;
- `20260903120000_open_banking_ais` ;
- `20260903120500_open_banking_ais_fk_indexes` ;
- `20260903190000_acquisition_integration_reconciliation` ;
- `20260903200000_portfolio_findings_no_silent_upsert`.

L'ALIGNEMENT AVEC LA PRODUCTION N'EST PAS ÉTABLI PAR CE CHIFFRE, et cette section a dérivé
trois fois de suite pour l'avoir oublié : elle a successivement annoncé « 29 migrations
alignées » quand le dépôt en portait 33, puis « 34 », puis « 35 », chaque verticale mettant à
jour SON chiffre sans voir celui des autres. La dérive ne se corrige pas en écrivant un
nouveau nombre : elle se corrige en disant d'où vient le nombre.

CELUI-CI vient du gate local, exécuté sans aucun credential : il prouve que les migrations du
dépôt reconstruisent un schéma conforme DEPUIS ZÉRO. Il ne dit RIEN de la production. Seul
`npm run db:verify`, exécuté avec des credentials de production hors environnement d'agent,
dit l'état réel, et le contenu de référence s'extrait de
`supabase_migrations.schema_migrations`.

La production portait **33 migrations** au dernier état communiqué par le propriétaire du
schéma. AUCUNE des neuf migrations ci-dessus n'y est appliquée. Leur ordre d'application est
CELUI DE LEURS NOMS et il n'est pas indifférent : la réconciliation et le volet Portfolio
supposent que les cinq verticales sont déjà là.

Business Equity V2.1 a été appliqué en production puis contrôlé par assertions SQL,
smoke transactionnel intégralement rollbacké, test d'isolation sous rôle `authenticated`,
permissions RPC, RLS/policies et advisors Supabase. Les données Business existantes ont été
préservées ; les anciennes valorisations V2 qui stockaient un résultat sous une méthode
dérivée ont été requalifiées en `USER_ESTIMATE`, sans inventer de valeur. Le seul warning
sécurité Supabase restant est le warning Auth historique de protection des mots de passe
compromis désactivée ; aucun nouveau finding Business n'a été introduit.

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
               Real Estate (faits + scénarios) · Business Equity (faits + valorisation dérivée)
               Data Acquisition (staging + provenance + relevé bancaire CSV + FEC
               + données publiques immobilières DVF/DPE)

               + import de portefeuille CSV/XLSX)

               + Open Banking AIS lecture seule)
               Career + Tax (faits datés + règles fiscales déclarées + calculs dérivés)
en cours       vérité de schéma · vérité des consommateurs
suivant        Event Engine → Scenarios V2 → Goals → Decision Lab
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
immobilière modélisée reste un chantier distinct. Business Equity n'y entre pas davantage,
pour la même raison.

Business Equity ne persiste AUCUNE valorisation dérivée : la base ne porte que des faits et
des hypothèses déclarées — un multiple, une base financière, des retraitements d'EBITDA, des
éléments de pont, des paramètres de DCF, les termes d'un tour. Enterprise Value, Equity Value,
fourchette et valeur attribuable sont produites à la lecture par `business-valuation.ts`, et
une contrainte de base interdit de stocker le résultat d'une méthode dérivée. EV ≠ EQUITY
VALUE : une Enterprise Value connue sans dette brute ni trésorerie datées ne produit aucune
Equity Value. Les autres éléments du bridge EV → Equity ne valent zéro que si leur complétude
est explicitement déclarée. DETTE CORPORATE ≠ DETTE PERSONNELLE : la dette d'une société
détenue réduit son Equity Value et n'entre jamais au passif personnel. Une filiale détenue
via une holding entre au patrimoine par la holding et par elle seule.

Les mutations qui modifient la quote-part (acquisition, cession, rachat, tour de table)
écrivent l'événement et la détention résultante atomiquement ; elles ne demandent jamais à
l'utilisateur de maintenir deux vérités indépendantes.

La fondation d'acquisition porte SEPT verticales, et leur ordre est celui de leurs
migrations : relevé bancaire CSV, FEC, registre d'entreprises, Document Intelligence, donnée
publique immobilière, portefeuille, Open Banking. Le rang de chacune est écrit ici et nulle
part ailleurs : quatre paragraphes se sont annoncés « troisième verticale » parce que chaque
verticale s'était numérotée contre une base où les autres n'existaient pas — exactement la
dérive du compte de migrations, au même endroit et pour la même raison. Un rang, comme un
nombre de migrations, se lit à sa source, il ne se déduit pas de ce que l'auteur avait sous
les yeux.

Ce que les verticales PARTAGENT — objets communs, conflits qu'un smoke de verticale unique ne voit
pas, consolidations — est dans `docs/ACQUISITION_INTEGRATION.md`. Chaque verticale garde son propre
document pour ce qui n'appartient qu'à elle.

La couche d'acquisition ALIMENTE les moteurs, elle ne les remplace jamais. Elle ne classe
aucun flux, ne recalcule aucun solde, ne rapproche aucun transfert interne et ne déclare
aucune profondeur d'historique : une transaction importée naît sans catégorie, et le Cash
Flow Engine la compte comme non classée. Une ambiguïté de convention décimale ou d'ordre
jour/mois se résout au niveau de la COLONNE quand une valeur la tranche, et bloque les
lignes concernées sinon : choisir entre 1,234 et 1 234 sur 800 lignes n'est pas une
décision de présentation. Un enregistrement brut est immuable et sa piste
d'audit est en LECTURE SEULE pour le client : corriger une lecture modifie le fait
canonique, jamais ce que la source a écrit, et une transaction importée n'est pas
supprimable en laissant sa provenance orpheline. SESSION ABSENTE ≠ SESSION INVISIBLE : un
garde-fou qui décide à partir d'une lecture filtrée par la RLS de l'appelant conclut
« déjà supprimé » sur une simple absence de droit, et autorise. La question « cet objet
existe-t-il ? » se lit donc indépendamment de la visibilité de l'appelant, et le seul
`SECURITY DEFINER` du schéma applicatif existe pour cela : `search_path` vide, objets
qualifiés, aucune écriture, aucun `execute` pour `public`, `anon` ni `authenticated`, et un
nom hors du contrat `lfo_*`, qui reste sans aucune RPC `SECURITY DEFINER`. UN FAIT ÉCRIT
GÈLE TOUT LE BRUT DE SA SESSION : l'autorisation s'appuie sur la PREUVE qu'un fait existe,
jamais sur le statut affiché, sans quoi un statut remis en arrière rouvrirait la suppression
de sa propre provenance. Et SUPPRIMER LE BRUT D'UNE SESSION VIVANTE N'EST PAS UN ABANDON :
l'abandon se DÉCLARE avant de libérer les lignes, de sorte qu'un retrait de brut laisse une
trace dans la piste d'audit ou se fait refuser.

L'IDENTITÉ SE DÉMONTRE, elle ne se présume pas. Une égalité de tuple — compte, date,
montant, devise, libellé — ne prouve rien entre deux fichiers distincts : un relevé partiel
contenant un troisième café identique ne dit pas qu'il s'agit d'un des deux déjà connus, et
l'écarter d'office supprimerait une dépense réelle. Seules deux preuves autorisent un rejet
automatique : l'empreinte du FICHIER déjà validé, et un identifiant de transaction dont la
stabilité est DÉCLARÉE — cherché dans TOUT l'historique, sans filtre de date, là où la
ressemblance seule se cherche dans une fenêtre. Le nom d'un en-tête n'en est jamais une : « Référence » peut être un
motif répété chaque mois. Tout le reste est une ressemblance signalée, exclue par défaut et
écrite sur décision explicite — un double comptage fausse le patrimoine sans laisser de
trace, là où une opération manquante laisse un trou visible. Aucune contrainte d'unicité ne
s'appuie donc sur une clé de ressemblance.

La date d'observation d'un import n'est pas `AS_OF_DATE` : une opération bookée hier est un
fait, même si le reporting est arrêté le mois précédent. L'acquisition ingère, les moteurs
aval arbitrent à leur date. Détail dans `docs/DATA_ACQUISITION.md`.

L'acquisition comptable (FEC) est la deuxième verticale de cette fondation, et elle l'ÉTEND
sans la dupliquer : mêmes sources, mêmes sessions, même brut immuable, même piste d'audit,
une colonne cible de plus dans `import_record_links`. Un FEC est une SOURCE COMPTABLE, pas
une valorisation : FEC ≠ COMPTES ANNUELS, et CLASSIFICATION COMPTABLE ≠ JUGEMENT ÉCONOMIQUE.
Une ligne de FEC n'est pas une transaction économique indépendante : l'unité est l'écriture,
et Σdébits = Σcrédits est vérifié par écriture, jamais par ligne — contrôle DÉRIVÉ des lignes
persistées, jamais repris d'un décompte fourni par l'appelant. Les valeurs numériques peuvent
être SIGNÉES : le texte l'autorise, aucune contrainte de signe n'existe donc, et une
contrepassation est une donnée valide. Deux formes réglementaires coexistent pour les colonnes
12 et 13, `Debit`/`Credit` et `Montant`/`Sens` : les deux sont lues, un sens inconnu bloque la
ligne. Séparateur conforme ≠ séparateur lisible : le point-virgule est lu et SIGNALÉ. Les états
reconstruits sont des CANDIDATS, chaque montant portant le NOM de sa convention — EBE au sens
du SIG dont la décomposition est respectée (la production de l'exercice exclut les ventes de
marchandises), marge commerciale sur les marchandises seules, participation des salariés (691)
jamais agrégée à l'impôt (695 à 699), jamais un EBITDA normatif, qui appartient au ledger de
Quality of Earnings de Business Equity sur décision humaine. TRÉSORERIE COMPTABLE ≠
TRÉSORERIE PERSONNELLE, DETTE CORPORATE ≠ DETTE PERSONNELLE, DETTE COMPTABLE ≠ CONTRAT DE
PRÊT, D&A ≠ CAPEX CASH. Aucun état reconstruit n'est persisté : `fec_entry_lines` porte les
écritures, les états s'en dérivent à la lecture. La couverture d'un exercice se DÉCLARE :
sans déclaration, aucun fait Business n'est écrit, et une couverture déclarée sans bornes
d'exercice est refusée par la base. Un exercice déclaré complet ne contient AUCUNE écriture
d'une autre période. ÉCART DE CONFORMITÉ RÉGLEMENTAIRE ≠ MONTANT NON CALCULABLE : un champ de
traçabilité blanc est un INFO de fichier, jamais une ligne bloquée. ANALYSER ≠ ARCHIVER : un
échec de conservation après validation ne transforme jamais un fait écrit en échec, le statut
du fait et celui de la copie sont distincts. CONFLIT DE SOURCES ≠ CHOIX SILENCIEUX D'UNE
SOURCE : une période financière déjà renseignée par une autre origine n'est jamais écrasée,
seule une correction FEC → FEC l'est, et la preuve est la provenance, pas un libellé.

Un FEC d'exercice ne traverse PAS la fonction serveur : le fichier va directement du
navigateur au stockage privé, et la route ne reçoit qu'une référence émise par le serveur.
Le chemin de stockage est CALCULÉ en base, jamais reçu du client ; le billet est à usage
unique, expirant et cloisonné ; l'empreinte est calculée sur le contenu réellement déposé.
STAGING ≠ COFFRE DOCUMENTAIRE : deux buckets privés distincts, l'un dimensionné pour ce que
l'application analyse et sans aucune policy, l'autre gardant sa vocation d'archive à 8 Mio.
AUTORISATION DE STOCKAGE ≠ BILLET LFO : les durées diffèrent, et c'est le billet qui décide
de ce qui devient analysable. ÉCHEC DE NETTOYAGE ≠ ÉCHEC DE VALIDATION, mais ÉCHEC DE
NETTOYAGE ≠ SUCCÈS SILENCIEUX non plus : la référence d'un objet non supprimé est CONSERVÉE,
sans quoi une comptabilité entière resterait au stockage sans que rien ne sache où. Détail
dans `docs/FEC_ACQUISITION.md`.

L'acquisition du REGISTRE D'ENTREPRISES est la troisième verticale de cette fondation, et
elle ne réutilise volontairement PAS ses tables : l'unité d'un import est un FICHIER DE
LIGNES, celle d'un registre un INSTANTANÉ D'ENTITÉ. Ce qu'elle réutilise est la chaîne, le
vocabulaire de provenance, les clés composites `(id, user_id)`, la discipline « le client lit,
les RPC écrivent » et `businesses(id, user_id)` comme unique porte du domaine Business. La
table `external_sources`, présente depuis la migration initiale sans usage, est ADOPTÉE comme
registre des connexions externes.

SNAPSHOT ≠ VÉRITÉ CANONIQUE : écrire un instantané ne change rien au patrimoine. CAPACITÉ NON
SERVIE ≠ DONNÉE ABSENTE ≠ ZÉRO : un fournisseur qui ne publie pas le capital social ne dit
rien du capital, et la capacité est DÉCLARÉE par la connexion. ACCEPTER UN VIDE N'EST PAS UN
ENRICHISSEMENT : une décision acceptée sans valeur effacerait une saisie de l'utilisateur au
motif que la source est muette, et la base la refuse. PROVENANCE PAR CHAMP ≠ PROVENANCE DE
LIGNE : `businesses.data_kind` qualifie la ligne, il ne bascule donc pas en `EXTERNAL_DATA`
parce qu'un champ vient du registre — la provenance par champ vit dans
`business_enrichment_decisions`. UN SIREN, UNE SOCIÉTÉ : deux rattachements du même SIREN
compteraient deux fois la même participation, et c'est un invariant de la base. Un ÉCHEC de
fournisseur est un instantané daté, jamais un trou. Une observation PÉRIMÉE reste lisible et
signalée, jamais corrigée : la péremption est DÉRIVÉE à la lecture et n'est jamais persistée,
un état qui dépend de l'heure pourrissant en silence dès qu'il est figé. Un registre publie
une IDENTITÉ, pas une finance : capital social, effectifs et catégorie d'entreprise restent
des observations et n'entrent pas dans `businesses`. Détail dans
`docs/COMPANY_REGISTRY_ACQUISITION.md`.

DOCUMENT INTELLIGENCE est la quatrième verticale, et la liasse fiscale en est la première
application. Elle RÉUTILISE le chemin « navigateur → stockage privé » du FEC, son billet à chemin
calculé en base, et `import_record_links` comme UNIQUE pont de provenance — une troisième forme
s'y ajoute, dont l'unité est un RUN et non une ligne. `lfo_record_business_financials` reste le
chemin d'écriture unique de `business_financials` : cette verticale ne le modifie pas.

DOCUMENT ≠ LECTURE ≠ FAIT CANONIQUE, et VALIDER ≠ RATTACHER : quatre actes, quatre décisions.
CASE VIDE ≠ CASE À ZÉRO : une case de liasse laissée blanche ne déclare rien, et la compter zéro
fausserait tout total construit dessus. CONTRÔLE NON CALCULABLE ≠ CONTRÔLE PASSÉ : un contrôle
dont un opérande est absent, ou ambigu parce que deux cases portent le même code, rend
`NOT_COMPUTABLE` — le compter réussi laisserait valider une liasse dont l'équilibre n'a jamais
été vérifié. L'arithmétique des contrôles est faite EN BASE sur les cases persistées, comme la
partie double du FEC : une charge forgée ne peut pas déclarer un bilan équilibré. VALEUR BRUTE ≠
VALEUR NORMALISÉE ≠ VALEUR CORRIGÉE : corriger n'efface jamais ce que le document imprimait, et
une correction ré-évalue les contrôles dans la MÊME transaction. OCR_REQUIRED ≠ ÉCHEC ≠ VALEUR
SUPPOSÉE : un scan est un fait technique nommé, et aucune valeur n'en est déduite. LIASSE ≠
COMPTE DE RÉSULTAT NORMALISÉ : seuls le chiffre d'affaires et le résultat de l'exercice sont
écrits ; EBITDA, EBIT, capex, BFR et marge sont REFUSÉS par la RPC, parce que leur définition est
une convention qui appartient au ledger de Quality of Earnings.

AUCUN code de case n'est écrit en dur : le code est LU dans le document, à côté de sa valeur. Le
registre de spécifications ne porte que des ancres de détection et des ancres de libellé, et une
ancre qui ne s'apparie pas rend le contrôle non calculable, jamais réussi. La colonne d'une case
n'est déterminée que si les EN-TÊTES sont trouvés : il n'y a pas de colonne par défaut. Détail
dans `docs/DOCUMENT_INTELLIGENCE.md`.

Avant de remplacer une RPC existante, chercher sa DERNIÈRE version dans l'historique, jamais la
première : `lfo_record_business_financials` a été révisée trois fois, et la réécrire depuis sa
version d'origine supprimait son upsert et quatre colonnes. Le gate complet l'a détecté ; le
smoke d'une seule verticale ne l'aurait pas vu.

L'acquisition de DONNÉE PUBLIQUE immobilière (DVF, DPE) est la cinquième verticale de cette
fondation, et elle ne valorise RIEN d'elle-même. DVF PUBLIE LES VENTES D'AUTRUI : un jeu de
comparables n'est pas la valeur d'un bien détenu, et aucune ligne de `real_estate_valuations`
n'en sort sans décision humaine. UNE ADRESSE NE PROUVE PAS UNE IDENTITÉ : un immeuble porte
autant de DPE que de lots, la confiance d'un rapprochement d'adresse est donc plafonnée à
MOYENNE, et accepter exige un motif ÉCRIT — la base le réclame pour toute acceptation de
confiance faible. RÉSULTAT VIDE ≠ ABSENCE DE MARCHÉ : la couverture est DÉCLARÉE par
l'adaptateur, jamais présumée, et un instantané vide, en échec ou hors couverture ne fonde
aucun rapprochement. Une lecture tentée laisse TOUJOURS une trace : l'instantané est écrit
même en échec, avec son code, et son contenu est immuable. AUCUN PRIX AU M² N'EST PERSISTÉ :
il est dérivé à la lecture, et une surface absente le rend non calculable — elle ne vaut pas
zéro. AUCUNE VALIDITÉ DE DPE N'EST CALCULÉE, et ÉTIQUETTE ABSENTE ≠ ÉTIQUETTE G : la
déduire d'une grille ou d'une règle que ce dépôt ne contient pas produirait une donnée sans
source. Une mutation MULTI-LOTS n'a pas de prix unitaire, et sous le seuil d'échantillon
l'estimation est `NOT_COMPUTABLE`, jamais une estimation à confiance basse : un chiffre
accompagné d'un avertissement finit par être lu sans l'avertissement. Une estimation promue
est une `MODEL_ASSUMPTION` sous convention NOMMÉE, avec ses intrants et son instantané —
`COMPARABLE_SALES` ne peut pas emprunter `NOTARY_ESTIMATE`, et la réciproque est interdite.
La médiane est calculée en TypeScript, jamais en SQL ; la base VÉRIFIE sans recalculer, en
encadrant la valeur par l'intervalle des prix unitaires réellement persistés — un encadrement
est un contrôle d'intégrité, pas une valorisation. Détail dans
`docs/REAL_ESTATE_PUBLIC_DATA.md`.

AVANT DE REMPLACER UNE RPC EXISTANTE, CHERCHER SA DERNIÈRE VERSION DANS L'HISTORIQUE, JAMAIS
LA PREMIÈRE. Un `create or replace` rédigé depuis une définition périmée supprime en silence
tout ce que les migrations ultérieures y avaient ajouté, et le gate du domaine concerné ne le
verra pas : c'est le smoke d'un AUTRE domaine qui le détectera, ou personne. Quand une
contrainte de forme exige une valeur au moment de l'INSERTION, étendre la RPC existante d'une
clé de charge optionnelle plutôt que d'ouvrir un second chemin d'écriture : PostgreSQL ne
connaît pas de contrainte `CHECK` différable, et une seconde porte d'écriture sur une table
canonique est une seconde vérité.

L'import de PORTEFEUILLE (CSV, XLSX) est la sixième verticale de cette fondation, et elle
n'ajoute AUCUN ledger : `portfolio_events` et `lfo_record_portfolio_event` existent, elle les
alimente. POSITION OBSERVÉE ≠ TRANSACTION DU LEDGER : un relevé de positions dit ce qui était
détenu à une date, pas quand ni à quel prix ; reconstruire un achat depuis une position
inventerait date, prix et frais, et le coût de revient en paraîtrait calculé tout en étant
faux. Deux domaines cibles distincts, jamais convertis l'un dans l'autre. INSTRUMENT NON
RÉSOLU ≠ INSTRUMENT NOUVEAU : un ISIN inconnu ou ambigu BLOQUE ses lignes, et rien n'est créé
d'office, sans quoi les mêmes titres se répartiraient entre deux entrées du référentiel. La
décision porte sur le TITRE, pas sur la ligne, et une décision humaine n'est pas écrasée par
une réanalyse. `lfo_record_portfolio_event` sait CRÉER un instrument décrit par son nom : ce
chemin est légitime en saisie manuelle et INTERDIT en import, donc seule la forme
`security: { id }` déjà tranchée lui est transmise. AUCUNE FORMULE XLSX N'EST ÉVALUÉE, et
VALEUR EN CACHE ≠ VALEUR SAISIE : la valeur mise en cache par le tableur est lue et la cellule
est NOMMÉE ; une formule sans valeur en cache ne produit rien. Un classeur porteur de macros
est REFUSÉ, pas lu partiellement. Les plafonds (taille, feuilles, lignes, colonnes, temps
d'analyse) refusent au lieu de tronquer. `positions` a désormais une unicité par enveloppe et
instrument, et `position_snapshots` une par date : sans elles, rejouer un fichier scinderait
une détention et l'idempotence serait impossible ; une observation à la même date CORRIGE la
précédente, une nouvelle date s'AJOUTE sans supprimer l'historique. AUCUN ADAPTATEUR DE
COURTIER n'est fourni : sans fixture fiable et non personnelle, l'écrire de mémoire produirait
un faux support. Détail dans `docs/PORTFOLIO_IMPORT.md`.

LE NOM D'UNE CONTRAINTE N'EST PAS UN NUMÉRO DE VERSION LIBRE. Un `if not exists (… conname =
'…_v2_ck')` SAUTE l'extension en silence quand une migration antérieure a déjà pris ce nom, et
le refus se produit alors à la première écriture, très loin de la cause. Avant d'étendre une
contrainte, lire son état RÉEL en base (`pg_get_constraintdef`) et reprendre sa définition en
vigueur, puis nommer le successeur. Corollaire du même principe que pour les RPC : chercher la
DERNIÈRE version, jamais la première, et ne jamais supposer qu'un nom est disponible.

L'OPEN BANKING (AIS) est la septième verticale de cette fondation, et elle l'étend SANS
ÉLARGIR AUCUNE WHITELIST : une synchronisation bancaire alimente le MÊME domaine cible qu'un
relevé CSV, `CASH_FLOW_TRANSACTION`, et `import_sources.kind` prévoyait déjà `'API'`. Aucune
colonne n'est ajoutée à une table du socle. AUCUNE INITIATION DE PAIEMENT n'existe : le
contrat d'adaptateur n'expose que trois lectures, et deux contrôles le vérifient
structurellement — un test sur les actions de la route, une assertion SQL sur les fonctions et
colonnes `bank_*`. OBSERVATION ≠ FAIT CANONIQUE : une opération lue naît observée, et rien
n'entre au Cash Flow sans DÉCISION humaine, qui est DURABLE et jamais redemandée à la
synchronisation suivante. PENDING ≠ BOOKED : un remplacement n'est appliqué que DÉCLARÉ par le
fournisseur et seulement s'il déclare ses identifiants stables, sinon il est signalé ; quand
l'opération remplacée a déjà été écrite, c'est une CORRECTION, pas une nouvelle dépense. Les
trois dates — opération, valeur, comptabilisation — sont conservées SÉPARÉMENT, et seule celle
d'opération date le fait : une date absente BLOQUE au lieu de se replier sur une autre. SOLDE
ABSENT ≠ SOLDE À ZÉRO, et un solde disponible n'est pas un solde comptable. COMPTE FOURNISSEUR
≠ COMPTE CANONIQUE : rien n'est créé d'office, et un compte canonique est alimenté par AU PLUS
UN compte fournisseur — sans cette unicité les mêmes opérations seraient écrites deux fois.
CAPACITÉ NON DÉCLARÉE ≠ CAPACITÉ ABSENTE : un adaptateur qui ne déclare pas ses identifiants
stables n'en a pas, et la déduplication automatique est alors INTERDITE. EXPIRATION NON
DÉCLARÉE ≠ SANS EXPIRATION, RÉVOQUÉ ≠ EXPIRÉ, et la révocation est TERMINALE. PAGE VIDE ≠ FIN
DE PAGINATION et CURSEUR IDENTIQUE ≠ FIN : seul un curseur nul déclare la fin, une boucle est
nommée et interrompue, un plafond REFUSE au lieu de tronquer. Le curseur n'avance qu'APRÈS
écriture réelle, et un échec le CONSERVE avec ses pages. Le BRUT d'une API est la PAGE, pas la
ligne. RÉFÉRENCE DE SECRET ≠ SECRET : aucune table ne porte de colonne capable d'accueillir un
jeton, et c'est l'absence de colonne qui garantit, pas une contrainte. Le rejeu d'une
notification est refusé par la BASE, et un événement non signé ne déclenche rien. AUCUN
ADAPTATEUR D'AGRÉGATEUR RÉEL n'est fourni : sans contrat ni identifiants, l'écrire de mémoire
produirait un faux support ; le fournisseur sandbox couvre la chaîne sans réseau, à partir
d'un catalogue de scénarios CÔTÉ SERVEUR — le navigateur choisit un nom, jamais un contenu.
Détail dans `docs/OPEN_BANKING.md`.

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

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

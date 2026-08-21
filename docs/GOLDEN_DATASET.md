# Golden dataset canonique

Léo Family Office. Version 0.2 du 21 août 2026, décisions du Checkpoint GPT-5.6 Sol intégrées. Lane : Léo (Product Truth).
Base : commit `ef5bacf`. Référence d'invariants : `docs/DATA_INVARIANTS.md` V0.2.

## Statut et portée

STATUT : PROVISOIRE, EN ATTENTE DE REVIEW (Checkpoint 2, GPT-5.6 Sol).

Ce document ne contient aucune fixture exécutable. Il décrit les cas, leurs entrées,
leurs sorties attendues et ce qui ne doit jamais se produire. L'implémentation des
fixtures appartient à Paul, après validation des définitions.

### Règle d'or : données entièrement synthétiques

Aucune valeur de ce dataset ne provient du patrimoine réel. Les montants ont été
choisis ronds et divisibles pour être recalculables à la main ou dans un tableur, et
distincts des valeurs du seed de production (355,48 / 15 003,13 / 16 745 / 284,72 /
1 282 / 1 140) afin qu'une fuite de données réelles dans les tests soit immédiatement
visible.

Persona de référence : GD-01, résident fiscal FR, devise de reporting EUR.
Institutions fictives : « Banque Alpha », « Courtier Beta », « Prêteur Gamma ».
Date d'observation par défaut, sauf mention contraire : `2027-01-31`.

### Convention de tolérance

| Domaine | Tolérance | Justification |
|---|---|---|
| Agrégats de bilan | 0,01 € | arrondi de centime |
| Lignes d'échéancier | 0,01 € par ligne, 0,05 € cumulé sur 240 lignes | accumulation d'arrondis |
| Taux et ratios | 1e-6 en valeur décimale | pas d'arrondi d'affichage dans le moteur |
| TRI | 1e-6 | tolérance de convergence de la bissection |
| Percentiles Monte-Carlo | égalité stricte à seed fixé | INV-G-03 exige le déterminisme |
| Complétude | égalité exacte | c'est un compte, pas une mesure |

Aucune assertion d'égalité stricte sur un flottant monétaire : voir INV-A-02.

### Convention de lecture d'un cas

Chaque cas porte : INPUTS, DATES, CURRENCY, PROVENANCE, EXPECTED OUTPUTS,
EXPECTED FLAGS, INVARIANTS TESTED, TOLERANCE, WHAT MUST NOT HAPPEN.

Les cas marqués ÉCHEC ATTENDU AUJOURD'HUI sont ceux que le code du commit `ef5bacf`
ne passe pas. Ils ne doivent pas être adaptés au code : c'est le code qui doit changer.
Les arbitrages correspondants ont été rendus au Checkpoint et figurent dans
`docs/FINANCIAL_DEFINITIONS.md` §14.

| Cas | Sujet | Statut attendu sur `ef5bacf` |
|---|---|---|
| 1 | Bank cash | passe |
| 2 | PEA cash et ETF | passe |
| 3 | CTO EUR | passe |
| 4 | CTO USD | ÉCHEC ATTENDU (INV-I-01) |
| 5 | Transfert interne | non exécutable (modèle absent) |
| 6 | Salaire | passe |
| 7 | Loyer et dépense essentielle | passe |
| 8 | Prêt à 0 % avec première échéance future | ÉCHEC ATTENDU (INV-D-02) |
| 9 | Prêt amortissable à taux fixe | passe |
| 10 | Échéancier contractuel différent de la PMT | passe partiellement |
| 11 | Différé partiel | non exécutable (modèle absent) |
| 12 | Immobilier simple | ÉCHEC ATTENDU (INV-E-01) |
| 13 | Immobilier avec travaux financés | ÉCHEC ATTENDU (INV-E-01) |
| 14 | Taxe foncière manquante | ÉCHEC ATTENDU (INV-M-01) |
| 15 | Override de scénario | passe |
| 16 | FX externe daté | non exécutable (modèle absent) |
| 17 | Écart de réconciliation | passe |
| 18 | Clôture mensuelle | ÉCHEC ATTENDU (INV-J-01) |
| 19 | Compte clôturé | non exécutable (mutation absente) |
| 20 | Correction rétroactive | non exécutable (versionnage absent) |

---

## CASE 1 · BANK CASH

INPUTS
- Compte `GD-BANK-1`, Banque Alpha, type BANK, liquidité IMMEDIATE, solde 2 500,00.

DATES : solde daté 2027-01-31. Observation 2027-01-31.
CURRENCY : EUR native, EUR reporting.
PROVENANCE : ACTUAL, confiance HIGH, source « relevé synthétique GD-01 ».

EXPECTED OUTPUTS
- `grossAssets` = 2 500,00
- `bankCash` = 2 500,00
- `investedAssets` = 0,00
- `debt` = 0,00
- `netWorth` = 2 500,00

EXPECTED FLAGS : aucun.
INVARIANTS TESTED : INV-A-01, INV-A-03, INV-B-01.
TOLERANCE : 0,01 €.

WHAT MUST NOT HAPPEN
- `investedAssets` ne doit pas valoir 2 500,00 : un compte courant n'est pas un investissement.
- Aucune position ne doit être créée implicitement pour représenter ce cash.

---

## CASE 2 · PEA CASH ET ETF

INPUTS
- Compte `GD-PEA`, Banque Alpha, type PEA, liquidité LIQUID, solde déclaré 20 000,00.
- Position `GD-POS-ETF`, ETF actions monde, `isCash = false`, valeur 14 000,00, cost basis 12 500,00.
- Position `GD-POS-CASHPEA`, cash interne au PEA, `isCash = true`, valeur 6 000,00, cost basis 6 000,00.

DATES : soldes et valorisations au 2027-01-31.
CURRENCY : EUR partout.
PROVENANCE : ACTUAL / HIGH pour les trois lignes.

EXPECTED OUTPUTS
- `grossAssets` = 20 000,00 (le solde du compte, pas la somme des positions)
- `bankCash` = 0,00
- `investedAssets` = 14 000,00
- somme des positions = 20 000,00, écart de réconciliation = 0,00
- plus-value latente de l'ETF = 14 000,00 - 12 500,00 = 1 500,00, soit 12,00 % du coût

EXPECTED FLAGS : aucun. Écart nul.
INVARIANTS TESTED : INV-A-03, INV-A-04, INV-B-01, INV-L-03.
TOLERANCE : 0,01 €.

WHAT MUST NOT HAPPEN
- `grossAssets` ne doit jamais valoir 40 000,00 (solde plus positions).
- `bankCash` ne doit jamais inclure les 6 000,00 de cash PEA.
- La plus-value latente ne doit pas être présentée comme une performance : elle ignore les versements. Voir CASE 3 et INV-C-01.

---

## CASE 3 · CTO EUR

INPUTS
- Compte `GD-CTO-EUR`, Courtier Beta, type CTO, solde déclaré 5 000,00.
- Position `GD-POS-ACT`, action européenne, `isCash = false`, valeur 5 000,00, cost basis 4 000,00, quantité 100, prix unitaire 50,00.
- Historique de flux : un versement unique de 4 000,00 le 2026-07-31.

DATES : acquisition 2026-07-31, valorisation 2027-01-31.
CURRENCY : EUR.
PROVENANCE : ACTUAL / HIGH.

EXPECTED OUTPUTS
- `investedAssets` = 5 000,00
- P&L latent = 1 000,00
- performance sur la période, hors flux = 5 000 / 4 000 - 1 = 25,00 %
- versements de la période = 4 000,00, contribution à la performance = 0,00

EXPECTED FLAGS : aucun.
INVARIANTS TESTED : INV-C-01, INV-C-02, INV-A-03.
TOLERANCE : 0,01 € et 1e-6 en taux.

WHAT MUST NOT HAPPEN
- Aucun pourcentage de performance ne doit être affiché si le cost basis est absent. Ici il est présent, la performance est donc calculable.
- L'enrichissement de 5 000,00 ne doit pas être présenté comme une performance de 5 000,00.

---

## CASE 4 · CTO USD, PRIX ET CHANGE

ÉCHEC ATTENDU AUJOURD'HUI.

INPUTS
- Compte `GD-CTO-USD`, Courtier Beta, type CTO, devise native USD, solde déclaré 10 000,00 USD.
- Position `GD-POS-USD`, valeur 10 000,00 USD, cost basis 8 000,00 USD.
- Taux EXTERNAL_DATA : 0,95 EUR/USD au 2026-06-30 ; 0,90 EUR/USD au 2027-01-31.

DATES : acquisition 2026-06-30, valorisation et observation 2027-01-31.
CURRENCY : USD native, EUR reporting.
PROVENANCE : position ACTUAL / HIGH ; taux EXTERNAL_DATA / HIGH, source nommée et datée.

CONVENTION D'ATTRIBUTION FX, canonique

    PriceEffect = (V1_native - V0_native) × FX0
    FXEffect    = V1_native × (FX1 - FX0)

où `V0_native` et `V1_native` sont les valeurs en devise native aux deux dates, `FX0` le
taux à la date d'acquisition et `FX1` le taux à la date d'observation.

Cette convention est **exacte par construction**, et non approchée :

    PriceEffect + FXEffect = V1×FX0 - V0×FX0 + V1×FX1 - V1×FX0
                           = V1×FX1 - V0×FX0
                           = P&L total en EUR

Le terme croisé `(V1 - V0) × (FX1 - FX0)` est attribué en totalité à l'effet change, par
le choix d'appliquer la variation de taux à la valeur **finale** en devise native. Ce
choix est arbitraire au sens mathématique, il doit donc être déclaré, et il ne doit
jamais varier d'un écran à l'autre. La convention symétrique, qui applique la variation
de taux à la valeur initiale et le prix au taux courant, est également exacte et donne
1 800,00 et -400,00 : elle est écartée, mais elle est mentionnée ici pour que personne ne
la réintroduise en croyant corriger un écart.

EXPECTED OUTPUTS
- valeur en EUR = 10 000,00 × 0,90 = 9 000,00
- cost basis en EUR = 8 000,00 × 0,95 = 7 600,00
- P&L total en EUR = 1 400,00
- effet prix = (10 000 - 8 000) × 0,95 = 1 900,00
- effet change = 10 000 × (0,90 - 0,95) = -500,00
- contrôle exact, pas approché : 1 900,00 + (-500,00) = 1 400,00

EXPECTED FLAGS : aucun si les deux taux existent. Si l'un manque, MISSING sur la conversion et agrégat marqué incomplet.
INVARIANTS TESTED : INV-I-01, INV-I-02, INV-I-03, INV-I-04.
TOLERANCE : 0,01 €.

WHAT MUST NOT HAPPEN
- `grossAssets` ne doit jamais recevoir 10 000,00 comme s'il s'agissait d'euros. C'est le comportement actuel : `deriveMetrics` somme `account.balance` sans lire `account.currency`, ce qui surévalue ce compte de 1 000,00 €, soit 11,1 %.
- Un taux manquant ne doit jamais devenir 1,00.
- L'effet change ne doit pas être fondu dans la performance de marché.
- La somme des deux effets ne doit jamais laisser de résidu. Un écart non nul signale que
  la convention d'attribution a été mélangée entre deux implémentations.

---

## CASE 5 · TRANSFERT INTERNE

NON EXÉCUTABLE AUJOURD'HUI : le modèle `Transaction` ne porte qu'un `accountId`, un
transfert n'est pas représentable comme une entité unique à deux jambes.

INPUTS
- État initial : `GD-BANK-1` à 2 500,00 ; cash PEA à 6 000,00.
- Transfert `GD-TRF-1` : 500,00 de `GD-BANK-1` vers `GD-PEA`, le 2027-02-05.

DATES : transfert 2027-02-05. Observations comparées au 2027-02-04 et 2027-02-06.
CURRENCY : EUR des deux côtés.
PROVENANCE : ACTUAL / HIGH.

EXPECTED OUTPUTS (delta entre les deux observations)
- `bankCash` : 2 500,00 vers 2 000,00, soit -500,00
- cash PEA : 6 000,00 vers 6 500,00, soit +500,00
- `grossAssets` : inchangé
- `netWorth` : inchangé
- `monthlyIncome` : inchangé
- `monthlyExpenses` : inchangé
- `investedAssets` : inchangé, 14 000,00
- performance du PEA : inchangée, 0,00 attribuable au transfert

EXPECTED FLAGS : aucun. Un transfert n'est pas une anomalie.
INVARIANTS TESTED : INV-F-01, INV-F-02, INV-C-01, INV-A-01.
TOLERANCE : 0,01 €.

WHAT MUST NOT HAPPEN
- Le transfert ne doit apparaître ni en dépense de 500,00, ni en revenu de 500,00, ni en versement générateur de performance.
- Le taux d'épargne du mois ne doit pas bouger.
- Le patrimoine net ne doit pas varier de 500,00 dans un sens ou dans l'autre.

---

## CASE 6 · SALAIRE

INPUTS
- Revenu `GD-INC-1`, « salaire net », 3 000,00 par mois, actif, début 2027-01-01.
- Revenu `GD-INC-2`, « activité accessoire », 200,00 par mois, inactif, date de début inconnue.
- Revenu `GD-INC-3`, « allocation », montant MISSING, inactif.

DATES : observation 2027-01-31.
CURRENCY : EUR.
PROVENANCE : `GD-INC-1` ACTUAL / HIGH ; `GD-INC-2` USER_ASSUMPTION / MEDIUM ; `GD-INC-3` MISSING / UNKNOWN.

EXPECTED OUTPUTS
- `monthlyIncome` = 3 000,00

EXPECTED FLAGS
- « 1 source de revenu non activée faute de date de début »
- « 1 source de revenu au montant inconnu »

INVARIANTS TESTED : INV-H-02.
TOLERANCE : 0,01 €.

WHAT MUST NOT HAPPEN
- `monthlyIncome` ne doit pas valoir 3 200,00 : une source sans date de début n'est pas activable.
- `GD-INC-3` ne doit pas contribuer 0,00 comme s'il s'agissait d'un montant connu et nul.

---

## CASE 7 · LOYER ET DÉPENSE ESSENTIELLE

INPUTS
- `GD-EXP-RENT`, loyer charges comprises, 1 200,00 par mois, essentielle.
- `GD-EXP-FOOD`, courses, 400,00 par mois, essentielle.
- `GD-EXP-LEISURE`, loisirs, montant MISSING, non essentielle.

DATES : observation 2027-01-31.
CURRENCY : EUR.
PROVENANCE : les deux premières ACTUAL / HIGH ; la troisième MISSING / UNKNOWN.

EXPECTED OUTPUTS
- `monthlyExpenses` (connues) = 1 600,00
- dépenses essentielles connues = 1 600,00
- complétude du budget = 2 / 3 = 66,67 %
- avec `GD-BANK-1` à 2 500,00 : couverture = 2 500,00 / 1 600,00 = 1,5625 mois
- FCF avant impôt et hors dette = 3 000,00 - 1 600,00 = 1 400,00

EXPECTED FLAGS
- « budget incomplet : 1 catégorie sur 3 non renseignée »
- couverture marquée « borne haute » : ajouter des dépenses ne peut que la faire baisser

INVARIANTS TESTED : INV-H-02, INV-B-03, INV-B-05, INV-M-01, INV-M-02.
TOLERANCE : 0,01 € pour les montants, exacte pour la complétude.

WHAT MUST NOT HAPPEN
- `monthlyExpenses` ne doit pas valoir 1 600,00 en étant présenté comme la dépense mensuelle réelle : c'est une borne inférieure.
- La couverture ne doit pas être rendue avec un formateur monétaire : « 1,56 mois », jamais « 1,56 € ».
- Aucune moyenne ni estimation ne doit remplacer `GD-EXP-LEISURE`.

---

## CASE 8 · PRÊT À 0 % AVEC PREMIÈRE ÉCHÉANCE FUTURE

ÉCHEC ATTENDU AUJOURD'HUI.

INPUTS
- Prêt `GD-LOAN-0`, Prêteur Gamma, capital 12 000,00, taux nominal 0,00 %, 48 mensualités.
- Première échéance 2027-06-01, maturité 2031-05-01.
- Échéancier de 48 `LoanScheduleEntry`, chacune portant
  `interest = 0,00`, `principal = 250,00`, `insurance = 0,00`, `fees = 0,00`,
  donc `totalCashOut = 250,00`.
- Contrôle : 250,00 × 48 = 12 000,00, écart contractuel nul.

DATES : trois observations, 2027-01-31, 2027-06-01 et 2031-06-01.
CURRENCY : EUR.
PROVENANCE : ACTUAL / HIGH.

EXPECTED OUTPUTS

`DebtService(période)` est la somme des `totalCashOut` des échéances exigibles dans la
période. Sur un pas mensuel :

| Observation | Échéances exigibles | `DebtService` | `currentBalance` | Intérêts cumulés |
|---|---:|---:|---:|---:|
| 2027-01-31 (avant première échéance) | 0 | 0,00 | 12 000,00 | 0,00 |
| 2027-06-01 (première échéance) | 1 | 250,00 | 11 750,00 | 0,00 |
| 2028-05-01 (12 échéances payées) | 1 | 250,00 | 9 000,00 | 0,00 |
| 2031-06-01 (après maturité) | 0 | 0,00 | 0,00 | 0,00 |

Aucune de ces quatre lignes ne demande de règle particulière : elles découlent toutes du
comptage des échéances exigibles.

- FCF au 2027-01-31 avec CASE 6 et CASE 7 : 3 000,00 - 1 600,00 - 0,00 = 1 400,00
- FCF au 2027-06-01 : 3 000,00 - 1 600,00 - 250,00 = 1 150,00

EXPECTED FLAGS
- au 2027-01-31 : « prêt en différé, première échéance le 2027-06-01 »

INVARIANTS TESTED : INV-D-01, INV-D-02, INV-D-03, INV-D-04.
TOLERANCE : 0,01 €.

WHAT MUST NOT HAPPEN
- Aucun intérêt ne doit apparaître sur un prêt à 0 %.
- Le service de dette ne doit pas valoir 250,00 au 2027-01-31. C'est le comportement actuel : le filtre `firstPaymentDate <= "2027-08-19"` capture ce prêt et retranche 250,00 du FCF quatre mois trop tôt.
- Le service de dette ne doit pas valoir 250,00 au 2031-06-01 : la maturité n'est jamais testée aujourd'hui.
- Le solde ne doit jamais devenir négatif.

---

## CASE 9 · PRÊT AMORTISSABLE À TAUX FIXE

INPUTS
- Prêt `GD-LOAN-F`, capital 100 000,00, taux nominal 3,00 % par an, 240 mensualités, pas d'assurance, pas de frais.
- Aucune mensualité contractuelle fournie : la PMT théorique fait autorité (source de niveau 2).

DATES : première échéance 2027-02-01, maturité 2047-01-01.
CURRENCY : EUR.
PROVENANCE : contrat ACTUAL / HIGH ; échéancier DERIVED / HIGH.

EXPECTED OUTPUTS
- PMT théorique = 554,597598 …, arrondie à 554,60
- ligne 1 : intérêt 250,00, principal 304,60, solde de clôture 99 695,40
- ligne 12 : intérêt 241,52, principal 313,08, solde de clôture 96 294,15
- ligne 240 : intérêt 1,38, principal 553,21, solde de clôture 0,00
- intérêts totaux = 33 103,42
- total versé = 133 103,42
- contrôle : Σ principal = 100 000,00 à 0,05 € près sur 240 lignes

EXPECTED FLAGS : aucun.
INVARIANTS TESTED : INV-D-01, INV-D-07, INV-A-02.
TOLERANCE : 0,01 € par ligne, 0,05 € en cumul.

WHAT MUST NOT HAPPEN
- Le solde ne doit jamais passer sous zéro.
- Le remboursement de principal doit être **neutre sur le patrimoine net** : à chaque
  échéance, la trésorerie et le capital restant dû diminuent simultanément du même
  montant. Sur la ligne 1, trésorerie -554,60 €, dette -304,60 €, `ΔNetWorth` = -250,00 €,
  soit exactement l'intérêt. Le principal n'est ni une charge, ni un enrichissement.
- Le total versé ne doit pas être présenté comme un coût du crédit : le coût est
  33 103,42, pas 133 103,42.

---

## CASE 10 · ÉCHÉANCIER CONTRACTUEL DIFFÉRENT DE LA PMT THÉORIQUE

INPUTS
- Même prêt que CASE 9, mais la banque fournit une mensualité contractuelle de 560,00.
- Écart mensualité contractuelle moins PMT théorique = 560,00 - 554,60 = 5,40.

DATES : identiques à CASE 9.
CURRENCY : EUR.
PROVENANCE : mensualité contractuelle ACTUAL / HIGH, source « échéancier bancaire ». PMT théorique conservée comme DERIVED de contrôle.

EXPECTED OUTPUTS
- l'échéancier retenu utilise 560,00, pas 554,60
- le prêt s'éteint à la 237e échéance, pas à la 240e
- dernière ligne : intérêt 1,18, principal 470,08, solde 0,00
- intérêts totaux = 32 631,25, soit 472,17 de moins que la PMT théorique
- écart contractuel affiché = 560,00 × 240 - 100 000,00 = 34 400,00, à confronter aux 32 631,25 d'intérêts réellement dus, soit un résidu inexpliqué de 1 768,75

EXPECTED FLAGS
- RECONCILIATION_REQUIRED : « le nombre d'échéances annoncé (240) dépasse le nombre d'échéances nécessaires (237) »
- « résidu contractuel inexpliqué de 1 768,75 : assurance, frais ou nombre d'échéances erroné »

INVARIANTS TESTED : INV-D-05, INV-D-06, INV-D-08, INV-L-01.
TOLERANCE : 0,01 € par ligne.

WHAT MUST NOT HAPPEN
- La mensualité contractuelle de 560,00 ne doit jamais être remplacée par la PMT théorique de 554,60.
- Le résidu de 1 768,75 ne doit pas être absorbé par une ligne d'ajustement : il doit rester ouvert jusqu'à obtention de l'échéancier détaillé.
- Le système ne doit pas conclure que le contrat est faux : il doit conclure qu'il manque une information, typiquement l'assurance.

Note sur le comportement actuel : `amortizeLoan` accepte bien `contractualPayment` et
l'utilise en priorité, ce qui satisfait la première partie. Il ne produit en revanche ni
drapeau de réconciliation, ni détection du nombre d'échéances excédentaire.

---

## CASE 11 · DIFFÉRÉ PARTIEL

NON EXÉCUTABLE AUJOURD'HUI : le modèle `Liability` ne porte ni type ni durée de différé.

INPUTS
- Prêt `GD-LOAN-D`, capital 20 000,00, taux nominal 2,00 % par an.
- Différé partiel de 12 mois : seuls les intérêts sont payés, le capital n'est pas amorti.
- Puis 60 mensualités d'amortissement classique.
- Première échéance 2027-03-01, fin de différé 2028-02-01, maturité 2033-02-01.

DATES : observations au 2027-06-01 (en différé) et au 2028-06-01 (en amortissement).
CURRENCY : EUR.
PROVENANCE : ACTUAL / HIGH.

EXPECTED OUTPUTS
- l'échéancier compte 72 `LoanScheduleEntry` : 12 lignes de différé puis 60 lignes
  d'amortissement
- lignes de différé : `interest = 33,3333`, `principal = 0,00`, `totalCashOut = 33,33`
- solde au 2028-02-01, fin de différé = 20 000,00, inchangé
- intérêts payés pendant le différé = 12 × 33,3333 = 400,00
- lignes d'amortissement : `totalCashOut` = 350,555201 …, arrondi contractuel à 350,56
- intérêts de la phase d'amortissement = 1 033,31
- coût total du crédit = 400,00 + 1 033,31 = 1 433,31
- `DebtService` au 2027-06-01 = 33,33, parce que la ligne exigible ce mois-là porte
  `totalCashOut = 33,33`. Ni 0,00, ni 350,56

EXPECTED FLAGS
- « prêt en différé partiel jusqu'au 2028-02-01 »

INVARIANTS TESTED : INV-D-01, INV-D-02, INV-D-07.
TOLERANCE : 0,01 € par ligne, 0,05 € en cumul.

WHAT MUST NOT HAPPEN
- Le capital ne doit pas s'amortir pendant le différé.
- Le service de dette pendant le différé ne doit pas être nul : des intérêts sont bien
  décaissés. C'est ce cas qui a imposé la formulation retenue pour INV-D-02. « Rien avant
  la première échéance » serait faux ici : la règle canonique est la somme des
  `totalCashOut` contractuellement exigibles, qui vaut 0 en différé total et les intérêts
  intercalaires en différé partiel, sans qu'aucune des deux situations soit un cas
  particulier.

---

## CASE 12 · IMMOBILIER LOCATIF SIMPLE

ÉCHEC ATTENDU AUJOURD'HUI.

INPUTS
- Prix d'achat 200 000,00, frais d'acquisition 16 000,00, travaux 0,00, mobilier 0,00.
- Coût total du projet = 216 000,00.
- Apport 36 000,00, emprunt 180 000,00, taux 3,00 %, 20 ans.
- Loyer 900,00 par mois, vacance 5,00 %, charges annuelles 2 400,00.
- Croissance de la valeur 1,00 % par an, indexation des loyers 1,00 % par an.
- Horizon 10 ans, frais de vente 6,00 %, taux d'imposition effectif 25,00 %.
- Taxe foncière incluse dans les charges annuelles, donc renseignée.

DATES : acquisition 2027-01-01, sortie 2036-12-31.
CURRENCY : EUR.
PROVENANCE : USER_ASSUMPTION / MEDIUM pour toutes les hypothèses, ce qui doit être affiché.

EXPECTED OUTPUTS
- equity investie = coût total moins emprunt = 216 000,00 - 180 000,00 = 36 000,00
- contrôle de cohérence : equity investie = apport, ici 36 000,00. Les deux chemins coïncident parce que l'emprunt ne finance ni frais ni travaux.
- `cashFlows[0]` = -36 000,00
- LTV = 180 000,00 / 200 000,00 = 90,00 %
- loyer effectif annuel = 900,00 × 12 × 0,95 = 10 260,00
- NOI = 10 260,00 - 2 400,00 = 7 860,00
- rendement brut = 10 800,00 / 200 000,00 = 5,40 %

EXPECTED FLAGS : « toutes les hypothèses sont des USER_ASSUMPTION, aucune donnée de marché externe ».
INVARIANTS TESTED : INV-E-01, INV-A-07, INV-M-03.
TOLERANCE : 0,01 € et 1e-6 en taux.

WHAT MUST NOT HAPPEN
- L'equity investie ne doit pas valoir 52 000,00. C'est le résultat de la formule actuelle `downPayment + acquisitionCosts + renovation + furniture` = 36 000 + 16 000, qui compte les frais deux fois : une fois dans l'apport qui les finance, une fois en propre. Facteur d'erreur 1,444, appliqué au dénominateur du cash-on-cash, du TRI et du MOIC.
- Le DSCR ne doit pas être affiché à deux décimales sans mention des hypothèses qui le portent.

---

## CASE 13 · IMMOBILIER AVEC TRAVAUX FINANCÉS

ÉCHEC ATTENDU AUJOURD'HUI. C'est le cas discriminant de INV-E-01.

INPUTS
- Prix d'achat 200 000,00, frais d'acquisition 16 000,00, mobilier 4 000,00.
- Travaux : **coût certain** de 30 000,00, provenance ACTUAL une fois les devis signés.
- `postRenovationValue` : **hypothèse séparée** de 245 000,00, provenance
  USER_ASSUMPTION, confiance MEDIUM. Valeur créée par les travaux = 245 000 - 200 000 =
  45 000,00 pour 30 000,00 dépensés. Aucune équivalence 1 pour 1 n'est supposée.
- Coût total du projet = 250 000,00.
- Emprunt 220 000,00, apport 30 000,00. L'emprunt finance donc le prix, les frais, les
  travaux et le mobilier, moins l'apport.
- Flux d'exploitation annuels négatifs de -3 000,00 aux années 1 et 2, comblés par des
  **apports complémentaires** de l'investisseur.
- Reste des hypothèses identiques à CASE 12, loyer porté à 1 050,00 après travaux.

DATES : acquisition 2027-01-01, travaux livrés 2027-06-30, mise en location 2027-07-01, sortie 2036-12-31.
CURRENCY : EUR.
PROVENANCE : USER_ASSUMPTION / MEDIUM.

EXPECTED OUTPUTS
- equity investie initiale = 250 000,00 - 220 000,00 = 30 000,00
- `cashFlows[0]` = -30 000,00
- LTV sur prix d'achat = 220 000,00 / 200 000,00 = 110,00 %, à signaler comme un
  financement supérieur au prix, pas à masquer
- assiette de la valeur de sortie = `postRenovationValue` = 245 000,00. Si
  `postRenovationValue` est MISSING, l'assiette retombe sur le prix d'achat 200 000,00 et
  le résultat porte le drapeau correspondant. L'assiette n'est jamais
  « prix + travaux » par construction.
- première année d'exploitation partielle : 6 mois de loyer, pas 12
- MOIC, avec les apports complémentaires :

      contributions  = 30 000 + 3 000 + 3 000 = 36 000,00
      distributions  = produit de cession net  = 80 000,00
      valeur résiduelle après cession          = 0,00
      MOIC = 80 000,00 / 36 000,00 = 2,2222

EXPECTED FLAGS
- « LTV supérieure à 100 % du prix d'achat : le financement couvre les frais et les travaux »
- « valeur créée par les travaux : 45 000 € supposés pour 30 000 € dépensés, hypothèse
  USER_ASSUMPTION à confirmer »
- « exploitation partielle la première année »
- « deux apports complémentaires de 3 000 € comptés au dénominateur du MOIC »

INVARIANTS TESTED : INV-E-01, INV-E-02, INV-E-04, INV-A-07.
TOLERANCE : 0,01 €.

WHAT MUST NOT HAPPEN
- L'equity investie ne doit pas valoir 80 000,00. C'est le résultat de la formule
  actuelle : 30 000 + 16 000 + 30 000 + 4 000. Facteur d'erreur 2,667. Cash-on-cash, TRI
  et MOIC sont divisés par 2,667, ce qui peut faire rejeter un projet rentable.
- Le MOIC ne doit valoir ni 2,4667, qui netterait les apports complémentaires au
  numérateur, ni 2,6667, qui les ignorerait. Les deux variantes sont plus favorables que
  la valeur juste de 2,2222, et d'autant plus favorables que le projet consomme de la
  trésorerie, c'est-à-dire précisément sur les projets les plus risqués.
- Les 30 000,00 de travaux ne doivent pas créer 30 000,00 de valeur par construction. La
  valeur créée est une hypothèse séparée, et elle peut être inférieure, supérieure ou
  nulle.
- Le loyer de la première année ne doit pas être compté sur 12 mois alors que le bien est
  en travaux 6 mois.
- La croissance de valeur ne doit pas s'appliquer à une assiette qui n'est pas nommée.

---

## CASE 14 · TAXE FONCIÈRE MANQUANTE

ÉCHEC ATTENDU AUJOURD'HUI.

INPUTS
- Identiques à CASE 12, sauf que les charges annuelles sont décomposées et que la taxe foncière est MISSING :
  - copropriété 1 200,00 ACTUAL
  - assurance propriétaire 200,00 ACTUAL
  - entretien 400,00 USER_ASSUMPTION
  - taxe foncière MISSING
  - CAPEX provisionné MISSING

DATES : identiques à CASE 12.
CURRENCY : EUR.
PROVENANCE : mixte, dont deux MISSING.

EXPECTED OUTPUTS
- charges annuelles connues = 1 800,00
- NOI calculé sur charges connues = 10 260,00 - 1 800,00 = 8 460,00
- complétude du calcul immobilier = 3 inputs de charges renseignés sur 5 = 60,00 %
- sens du biais : connu et déclaré, le NOI réel est inférieur, donc le TRI réel est inférieur
- le TRI est affiché avec une précision dégradée, par exemple « environ 6 % », pas « 6,32 % »

EXPECTED FLAGS
- « données matérielles manquantes : taxe foncière, provision CAPEX »
- « complétude 60 %, résultat indicatif »
- « biais connu : le rendement réel est inférieur au rendement affiché »

INVARIANTS TESTED : INV-M-01, INV-M-02, INV-M-03, INV-M-04, INV-H-02.
TOLERANCE : 0,01 € pour le NOI, exacte pour la complétude.

WHAT MUST NOT HAPPEN
- La taxe foncière ne doit pas être estimée par une règle implicite du type « 1 mois de loyer ».
- Le TRI ne doit pas être affiché à deux décimales de pourcentage sur un modèle où 40 % des charges sont inconnues.
- Le résultat ne doit pas être présenté sans le sens du biais : ici il est connu, il doit être dit.

---

## CASE 15 · OVERRIDE DE SCÉNARIO

INPUTS
- Scénario `GD-SCN-C`, « Central », rendement 5,00 %, volatilité 12,00 %, inflation 2,00 %, épargne 400,00 par mois, version 1.
- État ACTUAL : CASE 1, CASE 2, CASE 6, CASE 7, CASE 9.
- Mutation : rendement porté de 5,00 % à 8,00 %.

DATES : état ACTUAL au 2027-01-31, scénario appliqué à partir de 2027-02-01.
CURRENCY : EUR.
PROVENANCE : scénario MODEL_ASSUMPTION avant édition. Après édition : USER_ASSUMPTION. La confiance ne doit pas passer automatiquement à HIGH.

EXPECTED OUTPUTS
- version du scénario portée de 1 à 2
- une ligne d'archive conservant intégralement la version 1
- `grossAssets`, `bankCash`, `netWorth`, `monthlyIncome`, `monthlyExpenses` au 2027-01-31 : strictement inchangés
- la projection change, l'état ACTUAL ne change pas
- réexécuter la projection avec le scénario en version 1 redonne exactement les percentiles d'origine

EXPECTED FLAGS : aucun.
INVARIANTS TESTED : INV-G-01, INV-G-02, INV-K-03, INV-H-04.
TOLERANCE : égalité stricte sur l'état ACTUAL, égalité stricte sur les percentiles à seed fixé.

WHAT MUST NOT HAPPEN
- Aucune donnée ACTUAL ne doit être réécrite par l'exécution d'un scénario.
- La version 1 ne doit pas être supprimée ni modifiée.
- La confiance ne doit pas passer à HIGH du seul fait de l'édition : c'est le comportement actuel de `update_scenario`, qui force `confidence = 'HIGH'`.

---

## CASE 16 · TAUX DE CHANGE EXTERNE DATÉ

NON EXÉCUTABLE AUJOURD'HUI : `currency_rates` n'est ni alimentée ni lue, et `fxConvert`
ne prend pas de date.

INPUTS
- Deux observations de taux EXTERNAL_DATA pour la paire USD/EUR :
  - 0,95 au 2026-06-30, source « fournisseur X », vérifié le 2026-06-30
  - 0,90 au 2027-01-31, source « fournisseur X », vérifié le 2027-01-31
- Aucune observation pour la paire CHF/EUR.
- Compte `GD-CTO-USD` de CASE 4, plus un compte `GD-CHF` de 1 000,00 CHF.

DATES : bilan reconstruit au 2026-06-30, puis au 2027-01-31.
CURRENCY : USD, CHF, EUR reporting.
PROVENANCE : EXTERNAL_DATA / HIGH, source et date de vérification obligatoires.

EXPECTED OUTPUTS
- bilan au 2026-06-30 : le compte USD contribue au taux du 2026-06-30, pas au taux du 2027-01-31
- bilan au 2027-01-31 : le compte USD contribue à 0,90
- le compte CHF est exclu des deux bilans, avec un drapeau
- `grossAssets` au 2027-01-31 porte la mention « 1 compte non converti, taux CHF/EUR manquant »

EXPECTED FLAGS
- MISSING sur la conversion CHF
- agrégat marqué incomplet, avec le montant non converti connu en devise native

INVARIANTS TESTED : INV-I-01, INV-I-02, INV-I-03, INV-G-02, INV-K-02.
TOLERANCE : 0,01 €.

WHAT MUST NOT HAPPEN
- Le taux du 2027-01-31 ne doit jamais être appliqué rétroactivement au bilan du 2026-06-30 : cela réécrirait l'historique.
- Le compte CHF ne doit pas contribuer 1 000,00 € par défaut de taux.
- Le compte CHF ne doit pas être supprimé silencieusement de l'écran : son existence et son montant natif restent visibles.

---

## CASE 17 · ÉCART DE RÉCONCILIATION VOLONTAIRE

INPUTS
- Compte `GD-PEA-2`, solde déclaré 20 000,00.
- Position ETF 14 000,00, position cash PEA 5 900,00. Somme des positions = 19 900,00.
- Écart volontaire = 100,00.

DATES : toutes les valeurs au 2027-01-31.
CURRENCY : EUR.
PROVENANCE : solde ACTUAL / HIGH ; positions ACTUAL / HIGH. L'écart n'appartient à personne.

EXPECTED OUTPUTS
- `grossAssets` = 20 000,00, le solde déclaré fait autorité
- somme des positions = 19 900,00
- écart = 100,00, exposé, daté, attaché au compte
- nombre de positions après détection = 2, inchangé
- l'allocation affiche l'écart ou l'exclut explicitement, elle ne l'absorbe pas

EXPECTED FLAGS
- RECONCILIATION_REQUIRED sur `GD-PEA-2`, montant 100,00, causes candidates : position non listée, valorisation à une autre date, frais non comptabilisés

INVARIANTS TESTED : INV-L-01, INV-L-02, INV-L-03, INV-L-04, INV-C-05.
TOLERANCE : 0,01 €, seuil de déclenchement du drapeau à 0,01 €.

WHAT MUST NOT HAPPEN
- Aucune position « divers 100,00 » ne doit être créée pour faire tomber l'écart à zéro.
- `grossAssets` ne doit pas passer à 19 900,00 pour faire coïncider les deux chemins.
- L'écart ne doit pas disparaître au prochain import : il reste ouvert jusqu'à explication.

---

## CASE 18 · CLÔTURE MENSUELLE

ÉCHEC ATTENDU AUJOURD'HUI.

INPUTS
- État complet au 2027-01-31 : CASE 1, 2, 6, 7, 9.
- Séquence : clôture du 2027-01-31, puis évolution des soldes, puis clôture du 2027-02-28, puis nouvelle tentative de clôture du 2027-01-31.

DATES : trois opérations datées.
CURRENCY : EUR.
PROVENANCE : la clôture est un snapshot ACTUAL figé.

EXPECTED OUTPUTS
- après la première clôture : 1 clôture de janvier en version 1, 1 snapshot de
  patrimoine, détail figé des 2 comptes, des 2 positions et du passif
- après la deuxième clôture : 1 clôture de janvier version 1, 1 clôture de février
  version 1, 2 snapshots
- troisième opération, reclôture de janvier **sans réouverture préalable** : refusée
- quatrième opération, réouverture explicite de janvier : tracée avec auteur, date et
  motif ; la version 1 reste intacte et consultable
- cinquième opération, reclôture de janvier après réouverture : crée la **version 2**.
  Les deux versions coexistent, la version 2 est courante, la version 1 reste lisible
  avec sa date et le motif de réouverture. Aucune version n'est jamais supprimée.
- `variance` de février : écart entre le patrimoine net constaté de février et le
  patrimoine net **projeté pour février, produit avant février**, avec la trace du
  scénario et de sa version. Jamais l'écart avec janvier.
- si aucune projection n'a été produite avant février, `forecast_net_worth` reste MISSING
  et `variance` n'est pas calculée. Elle ne retombe pas sur la clôture précédente.

EXPECTED FLAGS
- à la troisième opération : « mois déjà clos, réouverture explicite requise »
- à la cinquième : « clôture de janvier 2027 en version 2, version 1 conservée »

INVARIANTS TESTED : INV-J-01, INV-J-02, INV-J-03, INV-J-04, INV-K-01.
TOLERANCE : égalité stricte sur les cardinalités, 0,01 € sur les montants.

WHAT MUST NOT HAPPEN
- La troisième opération ne doit pas écraser silencieusement la clôture de janvier. C'est
  le comportement actuel : `INSERT OR REPLACE` côté SQLite et upsert côté Supabase
  détruisent la ligne précédente sans trace.
- Aucune version antérieure ne doit être supprimée ni modifiée par une réouverture. La
  réouverture ouvre le droit d'écrire une version supplémentaire, elle n'efface rien.
- La deuxième clôture ne doit pas créer deux snapshots pour un seul mois : aujourd'hui
  `net_worth_snapshots` reçoit une insertion à chaque appel, sans contrainte d'unicité
  côté SQLite.
- Le champ `forecast_net_worth` ne doit jamais recevoir le patrimoine net de la clôture
  précédente. En l'absence de prévision, il reste MISSING.

---

## CASE 19 · COMPTE CLÔTURÉ

NON EXÉCUTABLE AUJOURD'HUI : aucune mutation de clôture de compte n'existe, et le champ
`status` de `financial_accounts` n'est jamais passé à autre chose que `ACTIVE`.

INPUTS
- Compte `GD-BANK-2`, Banque Alpha, type BANK, solde 1 200,00 au 2027-03-31.
- Le 2027-04-15, le compte est soldé : virement sortant de 1 200,00 vers `GD-BANK-1`,
  puis clôture du compte.
- État final : `status = CLOSED`, `closedAt = 2027-04-15`, dernier solde 0,00.
- Une clôture mensuelle de mars 2027 existe déjà, produite avant la fermeture.

DATES : trois observations, 2027-03-31, 2027-04-30, et recalcul rétrospectif au
2027-03-31 depuis une date postérieure à la fermeture.
CURRENCY : EUR.
PROVENANCE : soldes ACTUAL / HIGH ; virement ACTUAL / HIGH ; clôture ACTUAL / HIGH.

EXPECTED OUTPUTS

| Observation | Le compte apparaît | `GrossAssets` contribué | Effet sur `NetWorth` |
|---|---|---:|---|
| 2027-03-31, en direct | oui, actif | 1 200,00 | inclus |
| 2027-04-30, en direct | non, hors liste des comptes actifs | 0,00 | aucun |
| 2027-03-31, recalculé depuis mai | oui, avec la mention « clôturé depuis le 2027-04-15 » | 1 200,00 | inclus |

- le virement de 1 200,00 est un transfert interne : il ne crée ni revenu ni dépense, et
  ne modifie pas `NetWorth` (INV-F-01)
- la clôture mensuelle de mars 2027 reste inchangée : elle continue d'afficher le compte
  et son solde de 1 200,00
- `GrossAssets` au 2027-04-30 est inchangé par la fermeture elle-même : les fonds ont
  changé de compte, pas de propriétaire

EXPECTED FLAGS
- aucun sur la fermeture, qui est une opération normale
- si le compte est fermé avec un solde non nul et sans transfert identifié :
  « compte clôturé avec un solde résiduel de X, destination inconnue », drapeau de
  réconciliation ouvert

INVARIANTS TESTED : INV-K-01, INV-K-02, INV-F-01, INV-J-01, INV-A-01.
TOLERANCE : 0,01 € ; égalité stricte sur la clôture de mars.

WHAT MUST NOT HAPPEN
- La fermeture ne doit pas faire disparaître le compte de l'historique. Un compte clôturé
  sort des vues courantes, il ne sort jamais du passé.
- La fermeture ne doit pas modifier rétroactivement la clôture mensuelle de mars.
- `GrossAssets` ne doit pas chuter de 1 200,00 le jour de la fermeture : ce serait
  confondre un transfert avec une disparition d'actif.
- La ligne de compte ne doit pas être supprimée de la base.

---

## CASE 20 · CORRECTION RÉTROACTIVE

NON EXÉCUTABLE AUJOURD'HUI : la réouverture de clôture n'existe pas, et `effective_date`
est écrite à une constante figée plutôt qu'à la date réelle de l'événement.

INPUTS
- Solde de `GD-BANK-1` saisi à 2 500,00 avec `balanceDate = 2027-01-31`, provenance
  ACTUAL / HIGH, source « relevé synthétique ».
- Clôture de janvier 2027 produite le 2027-02-01, version 1, patrimoine net incluant ces
  2 500,00.
- Le 2027-03-10, le relevé bancaire réel arrive : le solde au 2027-01-31 était en réalité
  2 461,20. Écart de -38,80.
- Correction saisie le 2027-03-10, portant `balanceDate = 2027-01-31` et
  `recordedAt = 2027-03-10`.

DATES : deux axes distincts, la **date d'effet** (2027-01-31) et la **date
d'enregistrement** (2027-03-10). Le cas teste précisément leur séparation.
CURRENCY : EUR.
PROVENANCE : ACTUAL / HIGH avant et après ; la correction ne dégrade pas la provenance,
elle remplace une observation par une observation mieux sourcée.

EXPECTED OUTPUTS
- l'observation initiale de 2 500,00 est **conservée**, avec sa date d'enregistrement.
  La correction est une nouvelle observation, pas une mise à jour de l'ancienne.
- une lecture du solde au 2027-01-31, effectuée après le 2027-03-10, rend 2 461,20
- une reconstitution de ce que le système affirmait au 2027-02-01 rend 2 500,00
- la clôture de janvier version 1 reste intacte à sa valeur d'origine
- la clôture de janvier ne se corrige **pas automatiquement** : elle exige une
  réouverture explicite, qui produit alors une version 2 à -38,80 du patrimoine net de
  la version 1
- après réouverture et reclôture, les deux versions coexistent et sont consultables

EXPECTED FLAGS
- « correction rétroactive au 2027-01-31, enregistrée le 2027-03-10, écart -38,80 »
- « 1 clôture postérieure à la date d'effet est concernée : janvier 2027 »

INVARIANTS TESTED : INV-K-01, INV-K-02, INV-J-01, INV-G-02, INV-H-05.
TOLERANCE : 0,01 € ; égalité stricte sur la version 1 de la clôture.

WHAT MUST NOT HAPPEN
- La correction ne doit pas écraser l'observation d'origine. Sans elle, il devient
  impossible d'expliquer pourquoi la clôture de janvier annonçait un autre chiffre.
- La correction ne doit pas modifier silencieusement une clôture déjà produite. Une
  clôture figée qui bouge toute seule ne prouve plus rien.
- La date d'enregistrement ne doit pas se substituer à la date d'effet : le solde a été
  faux au 31 janvier, pas au 10 mars.
- Le système ne doit pas exiger une correction manuelle de chaque clôture postérieure. Il
  doit les **signaler**, et laisser l'utilisateur décider lesquelles rouvrir.

---

## Ce que ce dataset ne couvre pas encore

| Domaine | Raison |
|---|---|
| Bilan incluant l'immobilier et le business equity | aucune persistance ; la convention canonique (valeur brute en actif, dette en passif, equity DERIVED) est écrite en INV-A-07 et attend un cas dès la première persistance |
| Fiscalité des enveloppes (PEA, CTO, assurance-vie) | aucune règle vérifiée n'est chargée, un golden case fiscal serait un golden case d'hypothèses |
| Business equity, cap table, dilution | aucune persistance |
| Career, brut vers net | `employmentCompensation` existe mais n'est appelé par aucun code de production |
| Dividendes, frais, TWR, XIRR | aucun historique de flux par position |
| Événements de vie datés | aucun Event Engine |
| Prêt à taux variable, in fine, relais, PTZ | modèle `Liability` mono-tranche à taux fixe |
| Multi-tranches et remboursement anticipé | même raison |
| Attribution de variation du patrimoine | aucun ledger mensuel |

Ces manques sont volontaires : un golden case sur une fonctionnalité inexistante ne
teste rien et donne l'illusion d'une couverture.

## Décisions rendues au Checkpoint 2

| Point soumis | Décision |
|---|---|
| CASE 11 : formulation de INV-D-02 | confirmée et renforcée. La règle est la somme des `LoanScheduleEntry.totalCashOut` contractuellement exigibles, ce qui rend le différé total et le différé partiel non particuliers |
| CASE 13 : assiette de la valeur de sortie | tranchée. `postRenovationValue` est une hypothèse explicite et séparée du coût des travaux. Aucune capitalisation 1 pour 1 |
| CASE 18 : refus strict ou réouverture | tranchée. Réouverture explicite avec versionnage, toutes versions conservées |
| CASE 19 et CASE 20 | ajoutés au dataset |
| CASE 4 : attribution FX | convention canonique fixée, effet prix au taux d'acquisition, effet change sur la valeur finale en devise native, identité exacte |
| CASE 13 : MOIC | formule corrigée, apports complémentaires au dénominateur, valeur résiduelle au numérateur |

### Points encore ouverts

1. CASE 10 : le résidu contractuel de 1 768,75 doit-il produire une alerte HIGH ou MEDIUM ?
2. CASE 13 : valeur par défaut de `postRenovationValue` quand l'utilisateur ne la renseigne pas. Le dataset retient le repli sur le prix d'achat avec drapeau, à confirmer.
3. CASE 20 : le système doit-il proposer une réouverture en masse quand une correction rétroactive touche plusieurs clôtures, ou une par une ?
4. CASE 19 : que faire d'un compte clôturé avec un solde résiduel non expliqué, au-delà du drapeau ?

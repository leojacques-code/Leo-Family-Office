# Audit de l'état de l'interface

Léo Family Office. Version 0.2 du 20 août 2026, décisions du Checkpoint GPT-5.6 Sol intégrées. Lane : Léo (Product Truth).
Base : commit `ef5bacf`. Périmètre : `src/components/`, `src/app/`.

## Statut et méthode

Aucun fichier n'a été modifié. Aucun correctif n'a été appliqué.

Critère retenu : un élément d'interface est un finding s'il conduit un utilisateur
raisonnable à croire quelque chose de faux sur ses données, sur la fiabilité d'un
calcul ou sur l'état du système. Une fonctionnalité manquante n'est pas un finding, sauf
si l'interface laisse croire qu'elle existe.

### Sévérité

| Niveau | Définition |
|---|---|
| BLOCKER | affirmation fausse sur une donnée patrimoniale, sur un calcul ou sur la localisation des données |
| HIGH | libellé, unité ou cadrage qui induit une conclusion fausse |
| MEDIUM | imprécision, incohérence entre écrans, fausse précision |
| LOW | cosmétique, hygiène de copy |

SAFE TEXT-ONLY FIX indique si le correctif se limite à du texte et à des dérivations
triviales depuis `state`, sans toucher à un moteur ni à un repository. C'est la zone
verte autorisée par le plan §12.

### Synthèse

| Sévérité | Nombre | Dont correctif texte seul |
|---|---:|---:|
| BLOCKER | 5 | 4 |
| HIGH | 9 | 8 |
| MEDIUM | 8 | 8 |
| LOW | 5 | 4, plus 1 sans objet |
| Total | 27 | 24 |

Vingt-quatre findings sur vingt-sept se corrigent, au moins pour leur part visible,
sans toucher au moteur financier ni à la couche de données. Cinq d'entre eux (UI-001,
UI-013, UI-014, UI-020, UI-022) ne sont réglés qu'en surface par ce correctif de texte :
le fond exige un arbitrage produit ou une modification de moteur. C'est le principal enseignement de cet audit : l'essentiel du
déficit de crédibilité de l'interface tient au texte et aux dérivations manquantes,
pas à des bugs de calcul.

---

## BLOCKER

### UI-001 · Le cash-flow libre est libellé « avant échéance du prêt » alors que la mensualité est déjà déduite

- PAGE : Today, Cash Flow
- FILE : `src/components/pages.tsx:77`, `91`, `307`
- CURRENT BEHAVIOUR : la carte « Cash flow mensuel connu » affiche -142,72 € avec le détail « Avant échéance du prêt · dépenses incomplètes ». L'encart de cash-flow affiche une ligne « Dette dès déc. 2026 » puis un total libellé « Disponible avant prêt » qui vaut également -142,72 €. Le panneau Explain calculation annonce en input « Service de dette actuel : 0,00 € avant le 5 décembre 2026 ».
- WHY IT IS MISLEADING : `deriveMetrics` retranche bien 284,72 € pour produire -142,72 €. Les trois libellés affirment le contraire. `docs/ASSUMPTIONS.md` annonce de son côté un cash-flow de +142 € par mois. Le produit affiche donc un nombre, son explication affirme qu'il a été calculé autrement, et la documentation en annonce un troisième, de signe opposé.
- EXPECTED BEHAVIOUR : une seule définition, cohérente entre moteur, libellé, panneau d'explication et documentation. Tant que l'arbitrage n'est pas rendu, le libellé doit dire ce que le moteur fait, pas l'inverse.
- OWNER : Léo pour le libellé ; Paul pour le moteur. L'arbitrage est rendu, voir `FINANCIAL_DEFINITIONS.md` §4.3.
- PHASE : 1
- SAFE TEXT-ONLY FIX : oui pour le libellé et le panneau. Non pour l'alignement de fond.

### UI-002 · Une durée est affichée comme un montant en euros

- PAGE : Today
- FILE : `src/components/pages.tsx:76`
- CURRENT BEHAVIOUR : `<Currency value={state.metrics.emergencyCoverageMonths} /> mois` rend « 0,31 € mois » sous la carte « Cash disponible ».
- WHY IT IS MISLEADING : erreur d'unité. `emergencyCoverageMonths` vaut 0,3106, c'est un nombre de mois. Le formateur monétaire lui ajoute un symbole euro. L'utilisateur lit un montant là où le système parle d'une durée de couverture.
- EXPECTED BEHAVIOUR : « 0,3 mois de dépenses essentielles connues couvertes ». Le formateur monétaire ne doit jamais s'appliquer à une durée.
- OWNER : Léo
- PHASE : 1
- SAFE TEXT-ONLY FIX : oui.

### UI-003 · Une performance de portefeuille est affichée sans base de calcul

- PAGE : Investments
- FILE : `src/components/pages.tsx:157`
- CURRENT BEHAVIOUR : la carte du CTO affiche « Performance affichée : +77,71 % ». La chaîne est écrite en dur.
- WHY IT IS MISLEADING : le CTO a un cost basis nul en base et aucun historique de flux. Ce pourcentage n'est dérivable d'aucune donnée du système. Sur la même page, le produit affiche « Ventilation : Manquante » et un callout expliquant que volatilité, drawdown et Sharpe ne sont pas affichés faute d'historique fiable. Il applique donc une exigence de preuve à ces indicateurs et s'en exonère pour la performance, qui est pourtant le chiffre le plus regardé.
- EXPECTED BEHAVIOUR : « Performance : non calculable, cost basis manquant », sur le modèle de ce que fait déjà correctement la page Goals pour le FI ratio.
- OWNER : Léo
- PHASE : 1
- SAFE TEXT-ONLY FIX : oui.

### UI-004 · L'écran Settings affirme que les données sont dans un fichier SQLite local

- PAGE : Settings
- FILE : `src/components/pages.tsx:298`
- CURRENT BEHAVIOUR : carte « Adapter actif : SQLite local », détail « Supabase prêt à connecter ». Les deux valeurs sont écrites en dur.
- WHY IT IS MISLEADING : en production sur Vercel, `resolveAdapterName()` retourne `supabase`. Les données patrimoniales sont dans PostgreSQL managé. L'écran affirme le contraire, sur la page qui porte également le bloc « Security ». C'est une affirmation fausse sur la localisation de données financières personnelles, faite précisément là où l'utilisateur va chercher cette information.
- EXPECTED BEHAVIOUR : lire `repository.adapter`, déjà exposé par l'interface `FamilyOfficeRepository`, et l'afficher. « Supabase (PostgreSQL managé) » ou « SQLite local » selon le cas.
- OWNER : Léo pour le texte. La remontée du champ jusqu'à `DashboardState` touche les repositories, donc la lane de Tom.
- PHASE : 0
- SAFE TEXT-ONLY FIX : non, la donnée doit d'abord remonter jusqu'à l'interface.

### UI-005 · Les panneaux Explain calculation affichent des constantes de code sous badge ACTUAL

- PAGE : Investments, Debt, Cash Flow
- FILE : `src/components/pages.tsx:158`, `171`, `173`, `307`
- CURRENT BEHAVIOUR : plusieurs panneaux d'explication listent des inputs sous forme de chaînes figées : « 15 003,13 € », « 8 698,00 € », « 6 304,57 € », « 16 745,00 € », « 284,72 € », « 60 », « 0 % ». Chacune porte un badge de provenance ACTUAL et la date d'observation.
- WHY IT IS MISLEADING : le panneau Explain calculation est la promesse différenciante centrale du produit. Un badge ACTUAL sur une constante de code est une affirmation fausse sur la nature de la donnée : il certifie une observation là où il n'y a qu'un littéral. Le cas de `cashFlowExplanation` est le plus grave, il est traité en UI-001.
- EXPECTED BEHAVIOUR : construire chaque input depuis `state`, comme le font déjà `assetsExplanation` et `netWorthExplanation` pour la plupart de leurs champs.
- OWNER : Léo
- PHASE : 1
- SAFE TEXT-ONLY FIX : oui, les données sont toutes disponibles dans `state`.

---

## HIGH

### UI-006 · « Patrimoine brut » désigne les seuls actifs financiers

- PAGE : Today, Net Worth
- FILE : `src/components/pages.tsx:73`, `120`
- CURRENT BEHAVIOUR : les cartes affichent « Actifs bruts » et « Patrimoine brut » pour un agrégat qui ne contient ni immobilier, ni business equity, ni autres actifs.
- WHY IT IS MISLEADING : la page Net Worth porte bien un callout « Périmètre identifié », ce qui atténue le problème. La carte, elle, est lue seule et hors contexte.
- EXPECTED BEHAVIOUR : « Actifs financiers identifiés ».
- OWNER : Léo
- PHASE : 1
- SAFE TEXT-ONLY FIX : oui.

### UI-007 · La plus-value PEA est une constante de code

- PAGE : Investments
- FILE : `src/components/pages.tsx:156`, `157`
- CURRENT BEHAVIOUR : « Plus-value PEA annoncée : +703,12 € », affichée deux fois, écrite en dur.
- WHY IT IS MISLEADING : la valeur est exacte aujourd'hui (8 698,00 - 7 994,88) et le restera après toute mise à jour de la valorisation, y compris quand elle sera devenue fausse. Le mot « annoncée » suggère une donnée déclarée par l'établissement alors qu'elle est dérivable des positions présentes en base.
- EXPECTED BEHAVIOUR : dériver depuis `position.value - position.costBasis`.
- OWNER : Léo
- PHASE : 1
- SAFE TEXT-ONLY FIX : oui.

### UI-008 · La concentration MSCI World a un numérateur figé et un dénominateur vivant

- PAGE : Investments
- FILE : `src/components/pages.tsx:156`
- CURRENT BEHAVIOUR : `<Percent value={8698 / state.metrics.grossAssets} />`.
- WHY IT IS MISLEADING : le pourcentage bougera quand les actifs bruts changeront, ce qui donnera l'impression qu'il est calculé, alors que le numérateur est figé. Un chiffre faux qui bouge est plus trompeur qu'un chiffre faux qui ne bouge pas.
- EXPECTED BEHAVIOUR : dériver le numérateur depuis la position.
- OWNER : Léo
- PHASE : 1
- SAFE TEXT-ONLY FIX : oui.

### UI-009 · Les versements PEA annoncés n'existent nulle part en base

- PAGE : Investments
- FILE : `src/components/pages.tsx:157`
- CURRENT BEHAVIOUR : « Versements annoncés : 14 300,00 € ».
- WHY IT IS MISLEADING : cette donnée n'est stockée dans aucune table. Elle n'est ni vérifiable ni réconciliable depuis le produit. `docs/ASSUMPTIONS.md` note par ailleurs que 14 300 + 703,12 = 15 003,12, soit 0,01 € sous le total du compte : un second écart de réconciliation, invisible sur cet écran.
- EXPECTED BEHAVIOUR : retirer l'affichage tant que l'historique des versements n'est pas modélisé, ou l'afficher avec la provenance USER_ASSUMPTION et l'écart signalé.
- OWNER : Léo
- PHASE : 1
- SAFE TEXT-ONLY FIX : oui.

### UI-010 · Les dates contractuelles du prêt sont du texte, pas des données

- PAGE : Debt, Today, Cash Flow, Timeline
- FILE : `src/components/pages.tsx:103`, `142`, `173`, `286`, `289`
- CURRENT BEHAVIOUR : le panneau « Contrat annoncé, Dates clés » affiche « 5 décembre 2026 », « 5 novembre 2031 », « 60 mensualités », « 0,00 € » en texte statique. Les mêmes dates sont réécrites dans trois autres écrans.
- WHY IT IS MISLEADING : le panneau se présente comme la restitution du contrat. Les champs `firstPaymentDate`, `maturityDate` et `paymentCount` existent dans le modèle et sont peuplés. Le jour où l'échéancier bancaire réel corrigera ces valeurs, quatre écrans continueront d'afficher les anciennes.
- EXPECTED BEHAVIOUR : dériver depuis `state.liabilities`.
- OWNER : Léo
- PHASE : 1
- SAFE TEXT-ONLY FIX : oui.

### UI-011 · La page Dette ne traite que la première dette et plante s'il n'y en a aucune

- PAGE : Debt
- FILE : `src/components/pages.tsx:166`
- CURRENT BEHAVIOUR : `const loan = state.liabilities[0];` puis accès direct à `loan.principal`.
- WHY IT IS MISLEADING : deux problèmes distincts. Avec deux dettes, la seconde est comptée dans le patrimoine net et absente de l'écran qui prétend présenter le passif. Avec zéro dette, l'accès à `loan.principal` lève une exception et la page bascule sur `error.tsx`.
- EXPECTED BEHAVIOUR : itérer sur les passifs, et afficher un état vide plutôt que planter.
- OWNER : Léo
- PHASE : 1
- SAFE TEXT-ONLY FIX : non, c'est une modification de composant.

### UI-012 · L'arbitrage de la page Dette porte sur un capital qui n'existe pas

- PAGE : Debt
- FILE : `src/components/pages.tsx:169`, `174`
- CURRENT BEHAVIOUR : l'encart « Rembourser à 0 % ou investir » propose « Rembourser 5 000 € » et « Investir 5 000 € », avec `availableCash: 5000` écrit en dur.
- WHY IT IS MISLEADING : le cash bancaire réel est de 354,08 €. Le produit propose un arbitrage sur une somme quatorze fois supérieure à ce dont l'utilisateur dispose, sans le signaler. Le Decision Lab, sur le même sujet, propose un curseur de 500 à 16 745 €. Deux écrans présentent le même arbitrage avec des paramètres différents.
- EXPECTED BEHAVIOUR : borner au cash disponible, ou afficher explicitement qu'il s'agit d'une illustration à capital hypothétique.
- OWNER : Léo
- PHASE : 1
- SAFE TEXT-ONLY FIX : oui, en ajoutant une mention et en dérivant la borne depuis `metrics.bankCash`.

### UI-013 · Le Decision Lab conclut sans exposer ses coefficients

- PAGE : Decision Lab, Debt
- FILE : `src/components/pages.tsx:174`, `257`, `decision.ts:19`, `32`
- CURRENT BEHAVIOUR : l'option « Investir » porte un bandeau « Espérance ajustée supérieure » et un « Avantage ajusté » en euros. Le calcul repose sur un coefficient de décote de risque de 0,25, un poids de liquidité de 0,03 et un seuil de qualification à 0,15, tous invisibles.
- WHY IT IS MISLEADING : le produit émet une recommandation d'arbitrage patrimonial dont les trois paramètres décisifs ne sont ni affichés, ni sourcés, ni testés. `decision.ts` n'a aucun test. Le business plan §13.1 pose la règle inverse : le Decision Lab ne doit jamais conclure sur un seul critère et doit exposer liquidité, risque, downside et coût d'opportunité.
- EXPECTED BEHAVIOUR : décision canonique Q-11, fermée le 21 août 2026. Le Decision Lab peut comparer et classer des résultats objectifs, il ne peut pas émettre de recommandation prescriptive fondée sur des heuristiques non validées. Concrètement : retirer le bandeau « Espérance ajustée supérieure » et la carte `preferred` ; conserver la comparaison critère par critère ; étiqueter `riskHaircut`, `liquidityWeight` et le seuil de risque en `MODEL_HEURISTIC / EXPERIMENTAL`, avec formule et impact auditables, le classement devant rester consultable sans eux. Aucune formulation « vous devriez choisir X » avant que la méthodologie ne soit documentée, testée et approuvée.
- OWNER : Léo pour l'affichage et l'étiquetage ; Paul pour les tests et la méthodologie de pondération.
- PHASE : 10
- SAFE TEXT-ONLY FIX : oui pour retirer le bandeau. Non pour exposer les paramètres.

### UI-014 · L'inflation du Decision Lab ignore le scénario sélectionné

- PAGE : Decision Lab, Debt
- FILE : `src/components/pages.tsx:169`, `252`
- CURRENT BEHAVIOUR : `inflation: 0.02` écrit en dur dans les deux appels.
- WHY IT IS MISLEADING : les scénarios portent chacun leur inflation (2,0 % Central, 2,5 % Prudent, 3,5 % Stress). Le Decision Lab les ignore. Un utilisateur qui raisonne sous le scénario Stress obtient des bénéfices réels calculés sous une inflation qui n'est pas celle de son scénario.
- EXPECTED BEHAVIOUR : lire l'inflation du scénario actif.
- OWNER : Léo
- PHASE : 10
- SAFE TEXT-ONLY FIX : oui.

---

## MEDIUM

### UI-015 · Neuf cas du Decision Lab sont cliquables et inactifs

- PAGE : Decision Lab
- FILE : `src/components/pages.tsx:259`
- CURRENT BEHAVIOUR : dix boutons, dont neuf portent la mention « Préparé » et ne font rien au clic.
- WHY IT IS MISLEADING : « Préparé » suggère une disponibilité imminente plutôt qu'une absence. Le produit utilise par ailleurs « Coming soon » pour le même besoin sur la page Settings, ce qui rend l'incohérence de vocabulaire visible.
- EXPECTED BEHAVIOUR : vocabulaire unifié, boutons désactivés visuellement.
- OWNER : Léo
- PHASE : 10
- SAFE TEXT-ONLY FIX : oui.

### UI-016 · Trois boutons d'action n'ont pas de gestionnaire

- PAGE : Investments, Real Estate, Business Equity, Debt
- FILE : `src/components/pages.tsx:149`, `183`, `219`, `165`
- CURRENT BEHAVIOUR : « Import CSV », « Sauvegarder l'étude », « Ajouter une société » portent un badge « V1.1 ». « Importer l'échéancier » porte « À connecter ». Aucun n'a de `onClick`.
- WHY IT IS MISLEADING : les badges sont présents, ce qui est honnête, mais les boutons restent stylés comme des boutons actifs et curseur pointeur. Trois vocabulaires coexistent pour le même état : « V1.1 », « À connecter », « Coming soon ».
- EXPECTED BEHAVIOUR : un seul vocabulaire, attribut `disabled`, curseur adapté.
- OWNER : Léo
- PHASE : 1
- SAFE TEXT-ONLY FIX : oui.

### UI-017 · Le graphique « Historique observé » affiche cinq mois vides

- PAGE : Cash Flow
- FILE : `src/components/pages.tsx:137`, `142`
- CURRENT BEHAVIOUR : un graphique en barres sur mars à août, avec des données au seul mois d'août. Les noms de mois sont écrits en dur.
- WHY IT IS MISLEADING : cinq barres à zéro dans un « historique observé » suggèrent une observation de zéro, pas une absence d'observation. Le texte sous le graphique dit « Les mois sans données sont affichés à zéro, et non estimés », ce qui corrige partiellement, mais le visuel domine le texte.
- EXPECTED BEHAVIOUR : afficher un état vide plutôt qu'un graphique à cinq barres nulles, ou distinguer visuellement « zéro » de « inconnu ».
- OWNER : Léo
- PHASE : 3
- SAFE TEXT-ONLY FIX : oui, en remplaçant par un `EmptyState`.

### UI-018 · La somme des tranches de l'allocation ne fait pas le total affiché au centre

- PAGE : Today
- FILE : `src/components/pages.tsx:62-67`, `86`
- CURRENT BEHAVIOUR : les tranches valent 8 698 + 6 304,57 + 214,28 + 354,08 = 15 570,93 €. Le centre du graphique affiche `grossAssets`, soit 15 571,49 €.
- WHY IT IS MISLEADING : écart de 0,56 €, qui est exactement l'écart de réconciliation du PEA. Cet écart est correctement exposé sur la page Investments et invisible ici. Les pourcentages affichés en légende ne totalisent pas 100 %.
- EXPECTED BEHAVIOUR : soit rapporter les tranches à leur propre somme, soit ajouter une tranche « écart de réconciliation ».
- OWNER : Léo
- PHASE : 5
- SAFE TEXT-ONLY FIX : oui.

### UI-019 · Le compte à rebours ne décompte pas

- PAGE : Today
- FILE : `src/components/pages.tsx:103`
- CURRENT BEHAVIOUR : « Dans 108 jours à la date zéro ».
- WHY IT IS MISLEADING : la valeur est exacte au 19 août 2026 et fausse tous les autres jours. La mention « à la date zéro » nomme la limite, ce qui est une honnêteté partielle.
- EXPECTED BEHAVIOUR : calculer la différence de dates.
- OWNER : Léo
- PHASE : 1
- SAFE TEXT-ONLY FIX : oui.

### UI-020 · Fausse précision sur les résultats de l'underwriting immobilier

- PAGE : Real Estate
- FILE : `src/components/pages.tsx:186`, `187`
- CURRENT BEHAVIOUR : TRI affiché avec une décimale de pourcentage, MOIC à deux décimales, DSCR à deux décimales, rendements à une décimale.
- WHY IT IS MISLEADING : les seize entrées du modèle sont des USER_ASSUMPTION par défaut, dont la croissance de la valeur, l'indexation des loyers, la vacance et le taux d'imposition effectif. Afficher un DSCR à 1,27× sur ce modèle suggère une précision que le modèle n'a pas. S'y ajoute le défaut de fond signalé dans `DATA_INVARIANTS.md` INV-E-01 : l'equity investie étant surestimée, le TRI et le MOIC sont faux, pas seulement imprécis.
- EXPECTED BEHAVIOUR : dégrader la précision affichée en fonction de la complétude, et afficher des sensibilités plutôt qu'un point unique.
- OWNER : Léo pour la précision, Paul pour la formule.
- PHASE : 8
- SAFE TEXT-ONLY FIX : oui pour la précision seule.

### UI-021 · Le panneau « Repères configurables » n'est pas configurable

- PAGE : Goals
- FILE : `src/components/pages.tsx:264`, `266`
- CURRENT BEHAVIOUR : le titre annonce « Repères configurables », la liste de huit paliers est écrite en dur.
- WHY IT IS MISLEADING : le libellé promet une fonctionnalité absente.
- EXPECTED BEHAVIOUR : renommer « Paliers de référence » tant que la configuration n'existe pas.
- OWNER : Léo
- PHASE : 11
- SAFE TEXT-ONLY FIX : oui.

### UI-022 · « Écart réel vs prévu » mesure un écart au mois précédent

- PAGE : Timeline
- FILE : `src/components/pages.tsx:295`
- CURRENT BEHAVIOUR : un callout annonce « À partir de la deuxième clôture, le cockpit conservera l'écart avec la prévision précédente ».
- WHY IT IS MISLEADING : `create_monthly_close` alimente `forecast_net_worth` avec le patrimoine net de la clôture précédente, pas avec une prévision. La variance mesure donc une variation, pas un écart au plan. Le texte promet une capacité de pilotage que le stockage ne permet pas.
- EXPECTED BEHAVIOUR : reformuler en « écart avec la clôture précédente », ou brancher le champ sur la projection.
- OWNER : Léo pour le texte ; Paul pour la source de la prévision ; Tom pour la colonne et son versionnage.
- PHASE : 12
- SAFE TEXT-ONLY FIX : oui pour le texte.

---

## LOW

### UI-023 · La date zéro est réécrite en dur à six endroits

- PAGE : Today, Career, Timeline, Settings, barre supérieure
- FILE : `src/components/pages.tsx:71`, `204`, `285`, `291`, `298`, `src/components/app-shell.tsx:126`
- CURRENT BEHAVIOUR : « Mercredi 19 août 2026 », « Au 19 août 2026 », « Clôturer août 2026 », « 19 août 2026 ».
- WHY IT IS MISLEADING : la date est correcte aujourd'hui. `state.asOfDate` est disponible dans tous ces composants et est ignoré. Le bouton « Clôturer août 2026 » clôturera toujours août dans son libellé, quel que soit le mois réellement clôturé.
- EXPECTED BEHAVIOUR : dériver depuis `state.asOfDate`.
- OWNER : Léo
- PHASE : 1
- SAFE TEXT-ONLY FIX : oui.

### UI-024 · Trois écrans annoncent une capacité multi-devises inexistante

- PAGE : Settings, Investments, barre latérale
- FILE : `src/components/pages.tsx:298`, `157`, `app-shell.tsx:107`
- CURRENT BEHAVIOUR : « Devise reporting : EUR, Multi-devises prêt », « Devise reporting : EUR », « EUR · France ».
- WHY IT IS MISLEADING : « Multi-devises prêt » suggère une capacité disponible. En réalité `fxConvert` n'est appelé nulle part, `currency_rates` n'est jamais alimentée, et `deriveMetrics` additionne les soldes sans lire leur devise. Le formulaire d'ajout de compte accepte pourtant n'importe quel code de 3 lettres : un utilisateur peut créer un compte USD et voir son montant compté à parité.
- EXPECTED BEHAVIOUR : « Devise unique : EUR. Les comptes en devise étrangère ne sont pas encore convertis. » Et, dans l'idéal, restreindre le formulaire à EUR.
- OWNER : Léo pour le texte ; Paul pour le garde-fou de conversion ; Tom pour la table `currency_rates`.
- PHASE : 2
- SAFE TEXT-ONLY FIX : oui pour le texte.

### UI-025 · La barre latérale annonce un espace en lecture seule

- PAGE : toutes
- FILE : `src/components/app-shell.tsx:117`
- CURRENT BEHAVIOUR : « Private workspace, Read-only finance ».
- WHY IT IS MISLEADING : l'utilisateur peut modifier des soldes, ajouter des comptes, saisir des transactions, éditer des scénarios et clôturer un mois. « Read-only » désigne en réalité l'absence d'ordre bancaire ou courtier, ce que le libellé ne dit pas.
- EXPECTED BEHAVIOUR : « Aucun ordre bancaire ni courtier », qui est l'affirmation vraie et rassurante.
- OWNER : Léo
- PHASE : 1
- SAFE TEXT-ONLY FIX : oui.

### UI-026 · Le bloc Security de la page Settings est un texte statique

- PAGE : Settings
- FILE : `src/components/pages.tsx:300`
- CURRENT BEHAVIOUR : six lignes cochées, dont « Routes protégées par session HttpOnly », « Aucun secret dans le frontend », et une ligne en attente « Déployer Supabase Auth + RLS avant exposition internet ».
- WHY IT IS MISLEADING : ces affirmations sont exactes au regard du code, ce qui est à porter au crédit du produit. Elles sont néanmoins figées : elles ne reflètent aucun état vérifié à l'exécution. Le jour où une de ces propriétés cassera, la coche restera verte.
- EXPECTED BEHAVIOUR : distinguer visuellement les engagements d'architecture des contrôles vérifiés, ou lier ces lignes à un contrôle réel.
- OWNER : Tom
- PHASE : 0
- SAFE TEXT-ONLY FIX : oui.

### UI-027 · Le code d'accès de développement est affiché sur la page de connexion

- PAGE : Login
- FILE : `src/components/login-form.tsx:36`
- CURRENT BEHAVIOUR : la valeur de repli du code d'accès de développement s'affiche sous le formulaire quand `NODE_ENV !== "production"`.
- WHY IT IS MISLEADING : le garde est correct, l'affichage n'a pas lieu en production. Le point d'attention est ailleurs : cette même valeur est le repli de `localAccessCode()` hors production, et elle est versionnée dans le dépôt. Un déploiement de prévisualisation mal configuré, où `NODE_ENV` ne vaudrait pas `production`, exposerait à la fois le code et son repli. Le plan §4 demande explicitement de vérifier les secrets des prévisualisations Vercel.
- EXPECTED BEHAVIOUR : point à vérifier par Tom sur la configuration des prévisualisations, pas un correctif d'interface.
- OWNER : Tom
- PHASE : 0
- SAFE TEXT-ONLY FIX : sans objet.

---

## Ce que l'interface fait bien et qu'il faut préserver

Cet audit cherche des défauts. Il serait déséquilibré sans la liste inverse, d'autant
que ces éléments sont exactement ce qui distingue le produit d'un tableau de bord
générique.

- Les badges de provenance sur chaque entité, avec six types distincts, visibles partout.
- Le bandeau d'incertitude en haut du cockpit, qui affiche le taux de complétude du budget.
- « Non calculable » assumé pour le FI ratio et le Freedom Coverage sur la page Goals, avec la donnée manquante nommée.
- Le callout de la page Investments qui refuse d'afficher volatilité, drawdown et Sharpe faute d'historique fiable.
- « Les mois sans données sont affichés à zéro, et non estimés » sur le graphique de cash-flow.
- Le callout de réconciliation du PEA, qui expose l'écart et précise « sans créer de position fictive ».
- Le callout de la page Dette, qui expose l'écart de 338,20 € et dit qu'il n'est pas expliqué.
- « Règles actives vérifiées : 0 » sur la page Tax, plutôt qu'un barème plausible non vérifié.
- Le callout « Courbes non sourcées en V1 » sur la page Career.
- La formulation des percentiles Monte-Carlo, « des simulations du modèle » et non « de probabilité ».
- La description de la page Net Worth : « Les positions expliquent les comptes d'investissement, elles ne s'y ajoutent pas. »
- Les callouts « Cas de travail non patrimonial » et « Aucun actif business actuel », qui isolent clairement les bacs à sable.

Ces douze éléments montrent que la doctrine d'honnêteté du business plan est déjà
appliquée dans une grande partie de l'interface. Les findings BLOCKER de cet audit sont
d'autant plus corrigeables : ils sont des exceptions à une règle que le produit sait
déjà appliquer, pas l'expression d'une culture opposée.

## Ordre de correction proposé, zone verte uniquement

Ces correctifs sont du texte et des dérivations depuis `state`. Ils ne touchent ni
`financial.ts`, ni `real-estate.ts`, ni `decision.ts`, ni `shared.ts`, ni aucun fichier
de la lane de Tom.

1. UI-003, UI-004, UI-005 : trois affirmations fausses, correction immédiate.
2. UI-001, libellés seulement, en attendant l'arbitrage sur le service de dette.
3. UI-002, UI-006, UI-025 : unités et périmètres.
4. UI-007, UI-008, UI-009, UI-010, UI-019, UI-023 : dérivations depuis `state`.
5. UI-015, UI-016, UI-021, UI-024 : vocabulaire des fonctionnalités absentes.
6. Le reste.

UI-011, UI-013, UI-014, UI-020 et UI-022 supposent un arbitrage ou une modification de
moteur : ils ne sont pas dans la zone verte.

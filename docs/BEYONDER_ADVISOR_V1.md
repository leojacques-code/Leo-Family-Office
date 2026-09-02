# Beyonder / AI Advisor V1

## Frontière et audit

Beyonder est une **aide à la décision en lecture seule**, jamais une délégation de décision ou
d'exécution. Audit : **KEEP** des vérités et moteurs canoniques ; **REUSE** de
`GlobalFinancialContext`, Today V2 et Timeline V2 ; **EXTEND** par un paquet de conseil pur ;
aucun élément à **MIGRATE**, **DEPRECATE** ou **REPLACE**.

Le calcul reste la propriété des moteurs. Le Core Advisor classe et relie leurs résultats. La
couche d'explication facultative ne peut que reformuler un paquet déjà vérifié. Elle ne calcule
aucun montant, ne change aucune priorité ou CTA et ne persiste rien.

## Sources, règles et preuves

Le Core consomme le bilan canonique, l'ouverture, la timeline et la baseline de
`GlobalFinancialContext`, le Today Cockpit, la Timeline View, Goals V2, Decision Lab V2, les
scénarios et les clôtures. Il applique huit rangs : (1) fidélité/données, (2) échéance
contractuelle, (3) liquidité/dette/cash-flow calculable, (4) Goal, (5) Decision Case, (6)
scénario périmé, (7) variation patrimoniale observée, (8) surveillance. Identifiant, clé de
déduplication et départage par identifiant rendent le résultat invariant à l'ordre des entrées.

Le rang 3 ne déduit aucun risque de la seule présence d'une dette et n'introduit aucun seuil. Il
signale uniquement un cash-flow ou une liquidité explicitement négatifs. Il compare la liquidité
aux sorties contractuelles des 30 prochains jours seulement si toutes les sorties utiles sont
connues dans la devise de reporting ; montant ou FX manquant produit `NOT_COMPUTABLE`.

Chaque affirmation porte au moins une preuve : identifiant, date, nature, provenance,
calculabilité, montant/devise seulement connus, et lien propriétaire. `NULL ≠ ZERO` : `null`
reste non calculable tandis que zéro reste une valeur connue. Aucune somme multidevise n'est
faite par l'Advisor. Un conflit de date ou de fingerprint produit un unique insight `BLOCKED` ;
aucune réconciliation silencieuse n'est tentée.

## Provider, sécurité et confidentialité

`AdvisorExplanationProvider` est provider-neutral. Son état appartient à la couche d'explication,
jamais au paquet financier ni à son fingerprint. Aucun provider réel, secret, route API ou
dépendance IA n'est ajouté en V1 : l'interface affiche `BLOCKED_EXTERNAL`, mais les cinq questions
guidées restent fonctionnelles. La fixture injectable ne fait aucun réseau. Toute sortie est
bornée par une course avec un timeout, même si le provider ignore l'annulation. Chaque section
référence un insight et uniquement des preuves de cet insight ; nombres, pourcentages, dates et
devises non présents dans ces preuves sont refusés. Cette validation ne prétend pas garantir toute
la sémantique du texte : le Core reste la vérité visuellement prioritaire. Les libellés sources
sont des données non fiables, jamais des instructions. Il n'existe aucune écriture, conversation
persistée ou mutation Supabase, Goal, scénario, Decision Case ou fait canonique.

## Limites, tests et risques résiduels

Beyonder ne fournit aucun conseil d'achat/vente, aucune garantie juridique, fiscale,
patrimoniale ou de performance. Il signale ce que les moteurs savent ; il n'établit pas de
causalité. Risques résiduels : la qualité dépend des faits canoniques chargés ; le rang 3 sera
enrichi lorsque les moteurs exposeront des signaux de risque explicitement calculés ; aucun
provider génératif réel n'est validé.

Tests : `npx vitest run src/lib/advisor/advisor.test.ts`, puis `npm run lint`, `npm run test`,
`npm run build` et `npm run gate:local`. Aucune migration n'est requise ni ajoutée. Rollback :
revenir le commit unique ; aucune donnée ou migration n'est à annuler.

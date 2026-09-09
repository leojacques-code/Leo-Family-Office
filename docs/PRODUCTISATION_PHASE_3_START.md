# Phase 3 Debt — première tranche locale

Référence : §24 et §37 du plan d'audit produit fourni, remarques d'utilisation LFO-3, business plan du 20 août. Base : corrections locales de la revue #48, commit `2587eb8`.

## Contrat livré

L'action primaire « Importer un échéancier » ouvre le formulaire de dette, dont le premier bloc lit un CSV explicite séparé par des points-virgules. L'utilisateur peut importer un fichier ou coller les lignes. Il nomme la source, vérifie un aperçu, puis confirme le remplacement des lignes du formulaire. Cette étape n'écrit rien en base : l'enregistrement existant de la dette reste la seule mutation.

Colonnes obligatoires, dans cet ordre : `date;ouverture;principal;interet;assurance;frais;cloture;total`.

Chaque champ absent provoque un refus, jamais un zéro. Les dates doivent être réelles et croissantes. Les montants sont positifs ou nuls, au centime, représentables sans perte de précision. Ouverture moins principal doit correspondre à clôture ; le total doit correspondre à principal + intérêts + assurance + frais. Les soldes de deux lignes successives doivent se raccorder. Maximum : 1 200 lignes et 250 000 caractères. Aucun solde ni montant n'est corrigé automatiquement.

Le parcours distingue nombre de dates de débit et nombre de remboursements de principal. Il conserve les champs contractuels séparément : importer des lignes ne remplace silencieusement ni le capital initial, ni l'encours observé, ni les termes du contrat. La page vide cesse d'annoncer une dette nulle à partir d'une absence de saisie.

Les cinq valeurs essentielles du mode manuel — capital, encours initial, taux nominal, paiement et nombre d'échéances — utilisent désormais les primitives financières de la phase 0. Un nouveau contrat les présente vides. Effacer un champ le rend incomplet et bloque l'enregistrement ; aucune chaîne vide ne devient zéro. Chaque montant annonce sa devise et le taux est saisi comme pourcentage puis transmis au contrat sous forme décimale.

## Vérification

12 tests ajoutés : lecture de la ligne CIC décrite dans les remarques (273,70 de capital et 11,02 d'assurance pour 284,72 de débit), trois débits sans principal avant décembre, champs manquants, total incohérent, solde incohérent, date inexistante, notation exponentielle, précision excessive, doublons, confirmation UI avant utilisation des lignes, formulaire initial sans zéro et refus d'enregistrer les valeurs essentielles absentes.

Suite complète : 2 141 tests / 124 fichiers. ESLint et build Next.js verts. Aucun changement de moteur financier ni de schéma. La vérification UI est exécutée avec jsdom ; aucune revue visuelle navigateur de cette tranche n'est revendiquée.

## Ce qui reste avant clôture de la phase 3

Cette tranche n'est pas la phase 3 complète. Elle doit rester en brouillon.

- Obtenir les 63 lignes du document CIC et exécuter le golden case complet sur sa source. Les remarques fournissent les totaux et certaines lignes, pas les 63 lignes ; aucune ligne manquante n'a été reconstituée.
- Les documents qui groupent « assurance et frais » nécessitent une ventilation déclarée. Le modèle actuel exige deux montants ; l'import ne transforme pas arbitrairement l'un en zéro.
- Le format CSV est explicite ; reconnaissance PDF, mapping libre des colonnes et conservation du document brut dans l'acquisition restent à réaliser.
- Migrer les champs numériques avancés restants vers les primitives à brouillons vides, puis compléter le contrat de données pour les champs absents (emprunteur, devise éditable, déblocage et origination notamment).
- Construire le modèle de lecture Debt et le canvas dédié ; conserver la séparation entre dates, capital, coût et trésorerie.
- Compléter les objectifs et options du §24, la distinction réel/simulation et les parcours d'édition progressive.
- Faire la revue visuelle desktop/mobile puis la validation du parcours persisté sur preview.

La référence du « master plan » complémentaire a été demandée dans la conversation ; elle n'est pas identifiée avec certitude. Aucun autre plan n'a été inventé pour la remplacer.

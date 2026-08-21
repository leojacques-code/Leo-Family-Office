# Journal des modifications

Ce que change chaque version, en français simple. Le plus récent est en haut.

Les messages de commit sont en anglais et volontairement courts : c'est ici que se trouve
le détail lisible de ce qui change et pourquoi.

---

## Non publié

### Installation simplifiée

L'installation demandait un outil supplémentaire, **pnpm**, qu'il fallait installer soi-même
avant de commencer. Problème : la documentation décrivait pnpm alors que le dépôt ne contenait
que les fichiers de npm. Les commandes du README échouaient donc dès le premier essai.

Tout passe désormais par **npm**, fourni automatiquement avec Node.js. Il n'y a plus qu'une
seule chose à installer : Node.js 22 ou plus récent.

```bash
npm ci
npm run dev
```

Le fichier `START_HERE.md` décrivait aussi un problème d'installation sous Windows qui
n'existe plus. Cette section a été supprimée, et le statut de vérification indique maintenant
des résultats réellement mesurés plutôt que des vérifications annoncées mais jamais faites.

**Aucun changement dans l'application elle-même** : seuls la documentation et la méthode
d'installation sont concernées.

### Montants affichés au centime près

Le patrimoine net s'affichait `-1 173,5100000000002 €` au lieu de `-1 173,51 €`. Les ordinateurs
représentent les nombres à virgule de façon approchée : en additionnant beaucoup de montants, de
minuscules écarts s'accumulaient et devenaient visibles.

Tous les montants en euros sont désormais arrondis au centime : patrimoine net, patrimoine
liquide, patrimoine productif et capacité d'épargne mensuelle.

Les taux et ratios (taux d'épargne, mois de réserve, complétude des données) gardent
volontairement leur précision complète : les arrondir au centième fausserait les pourcentages.

**Les montants n'ont pas changé, seul leur affichage est corrigé.**

### Défauts connus, pas encore corrigés

- **Neuf liens de navigation rechargent toute la page** au lieu de changer seulement la section.
  L'application fonctionne, mais la navigation est plus lente que nécessaire.

Ce point est planifié dans la prochaine phase de nettoyage.

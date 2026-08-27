# Roadmap

## Différé volontairement

- migration ultérieure de l'accès temporaire vers Supabase Auth SSR ;
- imports CSV de courtiers (le relevé bancaire CSV est livré, voir `docs/DATA_ACQUISITION.md`) ;
- XLSX, OFX/QFX, CAMT et FEC : la fondation d'acquisition existe, les adaptateurs restent à écrire ;
- connecteurs Open Banking / PSD2 en lecture seule ;
- market data, FX et inflation externes avec fallback manuel ;
- ventilation réelle du CTO, allocation cible datée et benchmark de marché ;
- règles fiscales françaises 2026 officielles, vérifiées et versionnées à injecter dans le Tax Engine paramétrique ;
- persistance des études immobilières et export Excel détaillé ;
- portefeuille multi-poches et optimiseur d’allocation cible ;
- scoring institutionnel complet et expliqué ;
- PDF patrimonial, rapport mensuel/annuel et Investment Committee Memo ;
- analyse automatique des documents ;
- import de liasses fiscales et de comptes annuels, transactions comparables et benchmarks de multiples ;
- export Excel Business Equity (la structure existe déjà côté moteur, la génération reste à écrire) ;
- garantie personnelle déclenchée sur une dette corporate, seul chemin qui la ferait entrer au passif personnel ;
- fiscalité de cession de titres, tant qu'aucun Tax Engine ne sait la produire ;
- trajectoire Business Equity dans le modèle mensuel personnel : la valeur y serait portée constante, donc trompeuse ;
- comparaison active des autres cas du Decision Lab ;
- AI Advisor, après stabilisation de la couche de données.

## Améliorations à plus forte valeur

1. Importer trois mois de transactions pour rendre cash flow, lifestyle et réserve de sécurité crédibles.
2. Importer le relevé PEA, le détail du CTO et l’échéancier Bpifrance pour fermer les réconciliations.
3. Séparer strictement les projets Supabase development, preview et production, puis auditer RLS.
4. Sourcer les hypothèses de carrière et publier un jeu officiel de règles fiscales 2026 ; sans lui le Tax Engine reste volontairement `NOT_COMPUTABLE`.
5. Persister et comparer jusqu’à quatre études/scénarios immobiliers.
6. Ajouter les exports Excel et PDF institutionnels.

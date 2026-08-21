# Démarrer ici, collaborateurs

Léo Family Office. Version 0.2 du 21 août 2026, décisions du Checkpoint GPT-5.6 Sol intégrées. Lane : Léo (Product Truth).
Destinataires : Paul (Financial Truth), Tom (Technical Trust), et tout futur relecteur.

Ce document ne contient aucun secret, aucune clé, aucune URL de projet, aucun code
d'accès. Il n'en contiendra jamais.

## 1. Ce qu'est le produit, en trois phrases

Léo Family Office est un système d'exploitation du capital personnel : il consolide un
patrimoine, explique pourquoi il change, projette des trajectoires et compare des
décisions. Il n'est ni un tableau de bord, ni un agrégateur, ni une copie de Finary.
La complexité vit dans le moteur, l'interface reste progressive.

Hiérarchie des priorités, dans cet ordre et sans arbitrage possible :
FIDELITY, AUTOMATION, EXPLAINABILITY, ADAPTABILITY, DECISION INTELLIGENCE, UX,
VISUAL EXCELLENCE.

Architecture conceptuelle à défendre :

    SOURCE → EXTRACTION ET NORMALISATION → MODÈLE CANONIQUE → MOTEUR FINANCIER
    → SCÉNARIOS, DÉCISIONS, REPORTING

Une API, un PDF ou un CSV est une source. Ce n'est jamais le modèle financier.

## 2. État réel du dépôt, au 20 août 2026

Cette section décrit ce qui est, pas ce qui est prévu. Elle est vérifiée, pas déclarée.

### Pile technique

| Élément | Valeur |
|---|---|
| Framework | Next.js 16.1.6, App Router, React 19.2.7 |
| Langage | TypeScript 5.9.3 |
| Runtime | Node 22 ou plus |
| Tests | Vitest 4.1.10, environnement node |
| Base de production | Supabase, PostgreSQL 17 |
| Base de développement | SQLite via `node:sqlite`, adapter local |
| Hébergement | Vercel |
| Validation | Zod 4.1.12 sur toutes les mutations |

### Suite de tests

Exécutée le 20 août 2026 sur le commit `ef5bacf`, sans aucune modification du dépôt :

    6 fichiers de test, 25 tests, 24 verts, 1 rouge.

Le test rouge est `src/lib/engine/__tests__/financial.test.ts:40`, « calculates net worth
from accounts rather than positions ». Cause : `15571.49 - 16745` rend
`-1173.5100000000002`, comparé par `toEqual` strict à `-1173.51`. Ce n'est pas un bug
financier, c'est une assertion trop stricte sur un flottant. Conséquence pratique :
`pnpm test` et `pnpm check` sont rouges à la ligne de base. Ne partez pas du principe
qu'un échec de test vient de vous tant que celui-ci n'est pas traité.

### Ce qui est réellement fonctionnel

Sept capabilities sur trente-deux, détail dans `docs/FINARY_GAP_MATRIX.md` :
Net Worth, Accounts, Goals, Documents, Exports (fonctionnelles), Scenarios et
Monte-Carlo (fonctionnelles et testées).

### Ce qui ne l'est pas, malgré l'apparence

- Real Estate et Business Equity sont des bacs à sable : état React local, rien n'est enregistré, rien ne remonte au patrimoine.
- Career et Tax ont un écran mais aucun moteur branché.
- Aucune performance de portefeuille n'est calculée. Ce qui s'affiche est constitué de constantes.
- Aucune conversion de devise n'a lieu. `fxConvert` existe et n'est appelé nulle part.
- Aucun import bancaire, aucune donnée de marché, aucun transfert interne modélisé.

Règle de lecture : ne supposez jamais qu'une fonctionnalité marche parce qu'une page
existe. Remontez du composant au moteur puis à la base.

## 3. Rôles et périmètres

| Personne | Rôle | Possède |
|---|---|---|
| Léo | Product Truth, intégrateur | sémantique produit : vision, priorisation, définitions canoniques, critères d'acceptation, libellés et périmètres, conventions d'affichage, revue de PR, décisions de merge, déploiement |
| Paul | Financial Truth | sémantique financière : primitives, Debt Engine, Real Estate, formules, golden cases, tests financiers |
| Tom | Technical Trust | schéma, repositories, persistance, migrations, sécurité, CI, auth et RLS, Supabase, intégrations techniques, staging |

Ligne de partage à retenir quand deux lanes semblent se toucher : Paul possède la
**formule** qui consomme une donnée, Tom possède la **structure** qui la porte. Un
correctif dont la maison cible est une table, une colonne ou un repository n'a jamais
Paul pour propriétaire unique. Inversement, une migration qui change une valeur affichée
n'est pas fusionnée sans que Paul ait validé la formule et Léo le libellé.

### Fichiers temporairement réservés

Pendant le sprint en cours, ces fichiers ont un propriétaire unique. Ne les modifiez pas
si vous n'êtes pas ce propriétaire, même pour un correctif évident : ouvrez plutôt une
question.

Paul :
`src/lib/engine/financial.ts`, `src/lib/engine/real-estate.ts`,
`src/lib/engine/decision.ts`, `src/lib/data/shared.ts` pour tout ce qui touche à la
dette et à la finance, et les tests financiers correspondants.

Tom :
`src/lib/data/repository.ts`, `src/lib/data/local-repository.ts`,
`src/lib/data/supabase-repository.ts`, `src/lib/data/supabase-client.ts`,
`src/lib/auth.ts`, `src/proxy.ts`, `supabase/`, `.github/`, `.gitignore`.

Léo :
`docs/`, et la copie d'interface non calculatoire dans `src/components/`.

En cas de chevauchement réel entre deux lanes, la règle est : la lane propriétaire du
fichier fait le changement, l'autre lane fournit la spécification et le test.

## 4. Branches

État cible décrit par le plan de développement :

    main
      └── audit/financial-engine        baseline auditée, puis gelée
            └── integration/v1.2-hardening    zone de convergence
                  ├── leo/phase0
                  ├── finance/paul-sprint
                  └── platform/tom-security

État réel, vérifié le 20 août 2026 à 15h07 UTC : la topologie complète existe.

| Branche | Commit | Rôle |
|---|---|---|
| `main` | `ee0d16d` | production, V1.1 Supabase |
| `audit/financial-engine` | `ef5bacf` | baseline auditée, à geler |
| `integration/v1.2-hardening` | `ef5bacf` | zone de convergence |
| `leo/phase0` | `ef5bacf` | lane Léo |
| `finance/paul-sprint` | `ef5bacf` | lane Paul |
| `platform/tom-security` | `ef5bacf` | lane Tom |
| `claude/plan-de-leo-qakf68` | `462f656` | documentation de la phase 0, PR #1 vers `leo/phase0` |

Les cinq branches de travail partent toutes de `ef5bacf`, qui ajoute `ENGINE_AUDIT.md`
à `main`. Aucune divergence entre elles à ce jour : Paul et Tom démarrent d'une base
identique.

Règles applicables dès maintenant :
- aucun développement direct sur `main` ;
- aucun push direct d'un collaborateur sur `integration/v1.2-hardening` ;
- toutes les PR ciblent `integration/v1.2-hardening` ;
- personne ne fusionne sa propre PR ;
- `audit/financial-engine` est gelée après validation. Ce gel n'a pas encore été
  formalisé au 20 août : la branche existe et reste techniquement ouverte à l'écriture.

## 5. Règles de sécurité

Non négociables. Elles précèdent toute considération de vitesse.

1. Aucun secret dans une conversation avec une IA, dans une capture d'écran, dans un ticket, dans un commit.
2. Aucune clé de production dans un environnement de prévisualisation. Une prévisualisation qui peut lire la base de production est un incident, pas une commodité.
3. `SUPABASE_SECRET_KEY` ne doit jamais être préfixée `NEXT_PUBLIC_`. Elle contourne RLS. Elle n'est lue que par `src/lib/data/supabase-client.ts`, qui porte `import "server-only"`.
4. Aucun `.env` partagé, par aucun canal. Chacun crée le sien à partir de `.env.example`.
5. Aucun identifiant bancaire n'est demandé, stocké ou transmis, jamais.
6. Aucune écriture vers une banque ou un courtier. Le produit est en lecture seule vis-à-vis des établissements.
7. La production n'est jamais un environnement de test.
8. Toute mutation passe par une validation Zod côté serveur. Aucune exception.
9. Les documents importés restent dans un bucket privé, avec allow-list MIME et limite de taille appliquées côté serveur.

Point d'attention connu, lane de Tom : l'accès applicatif utilise aujourd'hui un code
partagé et la clé de service Supabase côté serveur, ce qui contourne RLS par
construction. Les policies de la migration sont correctes (39 tables, toutes porteuses
d'un `user_id`, toutes couvertes par une policy propriétaire, `anon` révoqué, bucket
privé), mais elles ne contraignent rien tant que l'accès ne passe pas par Supabase Auth.
Ce point est connu, documenté dans le README, et il n'est pas encore reflété dans
l'écran Settings.

Second point d'attention : le seed de développement contient le patrimoine réel d'une
personne physique identifiée, avec le nom de ses établissements. Voir
`docs/FINANCIAL_HARDCODES_AUDIT.md`, section « Données réelles versionnées dans le
dépôt ». Arbitrage attendu de Léo.

## 6. Démarrer en local

    pnpm install
    pnpm test
    pnpm dev

Puis ouvrir `http://localhost:3000`.

Sans `.env.local`, l'application utilise des valeurs de repli de développement.
En production, elle refuse de créer une session si `SESSION_SECRET` et
`LOCAL_ACCESS_CODE` sont absents, ce qui est le comportement voulu.

Pour une configuration propre :

    cp .env.example .env.local

Puis renseigner `SESSION_SECRET` et `LOCAL_ACCESS_CODE` avec des valeurs longues et
aléatoires, générées localement. Ne les partagez avec personne.

L'adapter local écrit dans `data/family-office.db`, ignoré par Git. Supprimer ce fichier
réinitialise le jeu de données de développement.

## 7. Commandes de qualité

| Commande | Ce qu'elle fait |
|---|---|
| `pnpm lint` | ESLint sur tout le dépôt |
| `pnpm test` | Vitest, une passe |
| `pnpm test:watch` | Vitest en continu |
| `pnpm build` | build Next.js de production |
| `pnpm check` | lint puis test puis build |

Rappel : `pnpm check` est rouge à la ligne de base à cause du test décrit en section 2.

Un build vert n'est pas une preuve financière. Un test vert sur une formule non
spécifiée ne prouve que la stabilité de cette formule, pas sa justesse.

## 8. Audits et documents de référence

À lire avant de toucher au code, dans cet ordre.

| Document | Contenu | Statut |
|---|---|---|
| `docs/ENGINE_AUDIT.md` | audit statique complet des moteurs, 16 sections, findings P0 à P3 | de référence |
| `docs/FINANCIAL_DEFINITIONS.md` | définitions canoniques, écart entre cible et code | V0.2, décisions du Checkpoint 1 intégrées |
| `docs/DATA_INVARIANTS.md` | 74 invariants, implémentation et tests évalués séparément | V0.2, décisions du Checkpoint 2 intégrées |
| `docs/GOLDEN_DATASET.md` | 20 cas synthétiques, sorties attendues | V0.2, décisions du Checkpoint 2 intégrées |
| `docs/FINANCIAL_HARDCODES_AUDIT.md` | 34 hardcodes classés et priorisés | V0.2 |
| `docs/FINARY_GAP_MATRIX.md` | 32 capabilities, statut réel | V0.2 |
| `docs/UI_STATE_AUDIT.md` | 27 findings d'interface | V0.2 |
| `docs/ARCHITECTURE.md` | architecture en couches, modèle Monte-Carlo | existant |
| `docs/ASSUMPTIONS.md` | hypothèses et réconciliations ouvertes | contient une incohérence, voir `README_STATUS_AUDIT.md` |
| `docs/DATA_VERIFICATION.md` | documents réels à obtenir | existant |
| `docs/ROADMAP.md` | fonctions différées volontairement | existant |

Les documents en V0.2 ont intégré les décisions rendues au Checkpoint GPT-5.6 Sol du
20 août 2026. Quatorze conventions y sont désormais arrêtées : convention de bilan brute,
MOIC, service de dette par `totalCashOut`, séparation des trois grandeurs de liquidité,
taux d'épargne non calculables sans ledger, séparation complétude, confiance et
incertitude de modèle, arrondi à la restitution, solde débiteur en passif, prévision
mensuelle réelle, projection déterministe sur moteur mensuel commun, choc daté, libellé
« Actifs financiers identifiés », coût des travaux distinct de la valeur créée,
réouverture et versionnage des clôtures.

Vous pouvez coder contre ces définitions : elles ne bougeront pas sans un nouveau
Checkpoint. Ce qui reste ouvert est listé dans `docs/OPEN_QUESTIONS.md`, six questions.
Signalez toujours ce qui vous paraît faux, c'est l'usage de ces documents.

## 9. Stop list

Ne pas lancer, ne pas commencer, ne pas « juste esquisser » :

- Tax Engine réel avec barème français appliqué
- Monte-Carlo V2 multi-actifs
- Event Engine
- intégration Career vers Net Worth
- Open Banking
- données de marché en direct
- TWR et XIRR en production
- multi-devises en production
- Decision Lab V2
- refonte visuelle
- nouvelles dépendances majeures

Raison : ces chantiers dépendent tous de fondations non stabilisées. Les commencer
maintenant, c'est construire sur des définitions qui vont changer.

## 10. Zone verte

Autorisé sans arbitrage préalable, à condition de rester dans sa lane :

- correction de copie d'interface non calculatoire
- libellés obsolètes
- mentions « à venir » explicites sur les fonctionnalités absentes
- README et documentation
- états vides
- messages d'incertitude et de complétude
- badges de provenance
- affichage non calculatoire

Toute modification qui change un nombre affiché sort de la zone verte.

## 11. Règles de PR

1. Une PR par sujet. Une PR qui corrige un bug et refactore un module est deux PR.
2. La description dit ce qui change, pourquoi, et ce qui ne change pas.
3. Toute modification de formule cite l'invariant concerné de `DATA_INVARIANTS.md` et le cas de `GOLDEN_DATASET.md` qui la couvre.
4. Toute modification de formule ajoute ou met à jour un test. Sans test, la PR n'est pas relue.
5. Aucun fichier hors de votre lane. Si vous devez en toucher un, dites-le en tête de description et attendez l'accord du propriétaire.
6. Aucun secret, aucune donnée personnelle réelle ajoutée.
7. Aucune nouvelle dépendance sans justification écrite.
8. Personne ne fusionne sa propre PR.
9. Conclusion attendue du relecteur, en un mot : MERGE, CHANGES REQUIRED, ou CODEX REVIEW REQUIRED.

## 12. Escalader un conflit

Un conflit ici n'est pas un conflit Git : c'est un désaccord sur une définition, une
convention ou un périmètre.

1. N'imposez pas votre convention dans le code. Une définition qui entre par un commit sans être écrite quelque part est une dette invisible.
2. Écrivez le désaccord dans `docs/OPEN_QUESTIONS.md`, avec : la question, les options, ce que chaque option implique, et ce qui est bloqué tant qu'elle n'est pas tranchée.
3. Continuez sur ce qui ne dépend pas de la réponse.
4. Léo arbitre les questions de définition et de périmètre. Paul arbitre les questions de méthode financière. Tom arbitre les questions de sécurité et de plateforme.
5. Un désaccord entre Paul et Tom sur un fichier partagé remonte à Léo, qui tranche sur le périmètre, pas sur la technique.
6. Si l'arbitrage bloque plus d'une demi-journée de travail, il devient prioritaire sur le travail lui-même.

## 13. Cinq règles à retenir

Reprises du business plan, section A.4, parce qu'elles résument tout le reste.

- Ne jamais inventer une donnée pour faire disparaître un avertissement.
- Ne jamais considérer un build vert comme une preuve financière.
- Ne jamais modifier un ACTUAL depuis un scénario.
- Ne jamais déplacer une formule critique dans l'interface.
- Do less. Prove more. Document uncertainty.

# Installer Claude Code et les 4 outils dans Codespaces

Cette configuration fonctionne entièrement sur GitHub Codespaces. Elle n'installe rien sur ton PC. Elle ne modifie pas la production Supabase. Le tutoriel ci-dessous s'applique à la branche chore/codespaces-claude-toolkit du dépôt leojacques-code/Leo-Family-Office.

## A faire toi-même (une seule fois)

1. Va sur https://github.com/leojacques-code/Leo-Family-Office .
2. Dans le sélecteur de branches, choisis **chore/codespaces-claude-toolkit**. Attention : tant que cette branche n'est pas fusionnée, ouvrir un Codespace sur main n'installe rien de nouveau.
3. Clique sur **Code > Codespaces > Create codespace on chore/codespaces-claude-toolkit**. Pour plus de confort avec quatre outils, 4 cœurs / 8 Go conviennent (coût supérieur à 2 cœurs).
4. Patiente pendant le build de l'environnement, puis ouvre **Terminal > New Terminal**.
5. Vérifie l'installation en lançant :

~~~bash
bash .devcontainer/verify.sh
~~~

6. Connecte Claude Code avec **claude** dans ce terminal, puis suis l'authentification Anthropic dans ton navigateur. Il faut un accès Claude Code éligible (abonnement Claude ou API), indépendant de ChatGPT.

## Ce que le bootstrap installe automatiquement

- Node.js 24 et GitHub CLI via les features Dev Container ;
- Claude Code natif officiel, canal stable ;
- Graphify (package PyPI officiel graphifyy via uv) et sa skill Claude Code de portée utilisateur ;
- Agent Skills : marketplace HTTPS addyosmani/agent-skills et plugin agent-skills@addy-agent-skills ;
- Ponytail : marketplace HTTPS DietrichGebert/ponytail et plugin ponytail@ponytail ;
- OmniRoute : package npm, **sans le lancer et sans rerouter Claude** ;
- les dépendances npm de LFO, sans accès à Supabase.

Les plugins tiers peuvent exécuter des hooks : revois leur code et évite de leur donner des secrets. Ce setup suit les versions amont lors de la création d'un nouveau Codespace : pour une reproductibilité stricte, figer ultérieurement les versions.

## Si une installation a échoué

Relancer dans le terminal Codespaces :

~~~bash
bash .devcontainer/bootstrap.sh
bash .devcontainer/verify.sh
~~~

Si les plugins manquent, tape une commande à la fois dans le terminal :

~~~bash
claude plugin marketplace add https://github.com/addyosmani/agent-skills.git
claude plugin install agent-skills@addy-agent-skills
claude plugin marketplace add https://github.com/DietrichGebert/ponytail.git
claude plugin install ponytail@ponytail
claude plugin list
~~~

Si la marketplace existe déjà, sa commande add peut échouer sans empêcher son installation. Relance Claude Code pour charger les plugins.

### Cas rencontré : erreur SSH GitHub « No ED25519 host key is known »

Quand `claude plugin install` échoue avec `Host key verification failed`, le clone interne utilise SSH. **Ne désactive jamais la vérification des clés SSH.** Dans le terminal Codespaces, utilise :

~~~bash
git config --global url."https://github.com/".insteadOf "git@github.com:"
claude plugin install agent-skills@addy-agent-skills
bash .devcontainer/verify.sh
~~~

Le bootstrap intègre également ce correctif pour les **nouveaux Codespaces**. Dans un Codespace déjà créé, ces trois commandes corrigent la configuration sans avoir besoin de le reconstruire.

## Utiliser les quatre outils

- **Agent Skills** : ouvre Claude Code avec la commande claude ; demande une spécification, un plan, puis une revue. Selon la version, commandes /spec, /plan et /review.
- **Ponytail** : /ponytail-audit ou /ponytail-review dans Claude Code. Ne jamais supprimer de garde-fou financier au nom de la simplicité.
- **Graphify** : /graphify . dans Claude Code ; ou graphify . dans le terminal Codespaces. Ne pas indexer de secrets ni de données réelles ; les fichiers générés dans graphify-out/ sont exclus de Git.
- **OmniRoute** : déjà installé mais volontairement inactif. Si tu souhaites activer ultérieurement le routage, lance omniroute dans le terminal, configure un fournisseur approuvé, conserve le port 20128 en mode **Private** dans Codespaces, puis utilise omniroute launch dans un nouveau terminal. La première utilisation nécessite une décision personnelle sur le fournisseur et le traitement des données.

Pour un usage normal et sécurisé de Claude Code, exécute simplement **claude** ; OmniRoute est facultatif.

## Sécurité des données et Supabase

- Ne colle jamais de tokens/API keys ou mots de passe dans les fichiers suivis par Git, les issues, les prompts ou les PR.
- LFO est un projet patrimonial : utiliser une base **de développement séparée**. Ne jamais brancher ce Codespace par défaut sur la base de production.
- Pour lancer l'app, réutilise START_HERE.md et .env.example avec des credentials de développement uniquement. Les secrets Codespaces peuvent être renseignés depuis GitHub **Settings > Secrets and variables > Codespaces** ; ne les configure que si réellement nécessaires.
- Ne lance ni migrations, ni seed, ni db push, ni suppression de données par simple commodité.
- Le seul test technique sans accès base est npm run check ; il peut prendre du temps.
- Le setup ne démarre aucun service et n'ouvre que le port 3000 pour une éventuelle preview de l'application. Ne rends pas les ports Codespaces publics.

## Coûts et durée de vie

Codespaces consomme un quota de calcul et de stockage indépendant de Claude. Arrête le Codespace en fin de session. Un nouveau Codespace refait l'installation : les plugins installés en scope utilisateur ne sont pas automatiquement persistants entre deux Codespaces, mais le script les réinstalle.

## Premier prompt à donner à Claude Code

> Lis CLAUDE.md, docs/ARCHITECTURE.md et les invariants financiers. Cartographie les dépendances avec Graphify, examine la couverture des tests et signale les risques prioritaires. Utilise Agent Skills pour proposer un plan de remédiation et Ponytail uniquement pour relever les duplications évitables. Fais un audit en lecture seule ; aucune modification, migration ou connexion à la production. Donne les preuves fichier et ligne et attends mon approbation.

## Sources

- https://code.claude.com/docs/en/setup
- https://code.claude.com/docs/en/plugin-marketplaces
- https://docs.github.com/en/codespaces
- https://github.com/Graphify-Labs/graphify
- https://github.com/addyosmani/agent-skills
- https://github.com/DietrichGebert/ponytail
- https://github.com/diegosouzapw/OmniRoute

IMPORTANT : avoir ajouté les scripts à GitHub ne prouve pas que ton Codespace les a déjà exécutés. Consulte les résultats du diagnostic dans le vrai Codespace avant de déclarer l'installation terminée.

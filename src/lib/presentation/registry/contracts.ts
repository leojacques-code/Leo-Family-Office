import type { DataKind } from "@/lib/types";
import type { PresentationState } from "@/lib/presentation/language/states";

/**
 * Contrats de composition de la section 39 du plan de refonte.
 *
 * La section 16 pose la règle qui justifie ce fichier : « aucune composition laissée à
 * l'arbitrage de l'IA ». Une IA ne décide jamais librement quelles sections apparaissent,
 * quels KPI sont prioritaires, quels champs sont obligatoires, quelle donnée absente vaut
 * zéro, quelle source l'emporte, si une donnée est réelle ou simulée, si une hypothèse peut
 * devenir un fait, ou si une anomalie mérite d'alerter.
 *
 * Ce ne sont donc PAS des types de commodité : ce sont les frontières de ce qu'un agent peut
 * produire. Une page qui compose autre chose que son manifeste est un bug, même si l'écran
 * est joli.
 *
 * La phase 0 livre ces contrats, les registres et les refus de CI. Elle ne branche AUCUNE
 * page dessus : un manifeste est une donnée, et son branchement appartient à la phase du
 * domaine concerné, qui revoit son manifeste avant d'implémenter sa page comme la section 39
 * l'exige.
 */

// ─── Zones du contrat universel de page (section 17) ──────────────────────────────────────

/**
 * Les six zones. L'ordre d'un manifeste est un ORDRE DE ZONES, pas une liberté de
 * composition : le canvas ne commence jamais par quatre cartes génériques.
 */
export type PageZone =
  /** A : en-tête opérationnel. Titre, question, date, sélecteur réel/simulation. */
  | "OPERATIONAL_HEADER"
  /** B : rail de sources. Ce qui alimente le domaine, et sa fraîcheur. */
  | "SOURCE_RAIL"
  /** C : canvas financier. La réponse à la question du domaine, en composition dédiée. */
  | "FINANCIAL_CANVAS"
  /** D : analyse disponible. Catalogue « Aller plus loin », orienté bénéfice. */
  | "AVAILABLE_ANALYSIS"
  /** E : inspecteur. Explique, édite, montre la provenance, isole le détail technique. */
  | "INSPECTOR"
  /** F : actions contextuelles. Demandes de données qui débloquent une utilité choisie. */
  | "CONTEXTUAL_ACTIONS";

/** Mode d'un écran : la section 6.4 exige que les deux soient impossibles à confondre. */
export type RealityMode =
  /** Faits observés et contrats. */
  | "REAL"
  /** Hypothèses et décisions envisagées. */
  | "SIMULATION";

/**
 * Comment une page se comporte hors du poste de travail.
 *
 * `DESKTOP_ONLY` est une réponse légitime et non un aveu : un comparateur de décisions côte
 * à côte n'a pas de sens sur un téléphone, et en produire une version tronquée ferait croire
 * à une comparaison complète.
 */
export type ViewportStrategy = "DESKTOP_ONLY" | "DESKTOP_AND_TABLET" | "ALL_VIEWPORTS";

// ─── Zone B : déclaration de source (section 17, §6 de V10) ───────────────────────────────

/**
 * Catégories de source, reprises du §6 de V10.
 *
 * La liste est CLOSE, et elle est ici plutôt que dans le composant de rendu parce qu'un
 * manifeste doit pouvoir la référencer : une catégorie déclarée par une page et inconnue du
 * rail serait une composition que rien ne peut afficher. « Data », « Inputs », « Context » et
 * « Truth » y restent refusés — ils ne disent pas à l'utilisateur quelle pièce aller chercher
 * dans ses dossiers.
 */
export type SourceCategory =
  | "BANQUE"
  | "ECHEANCIER"
  | "CONTRAT"
  | "BULLETIN"
  | "RELEVE_COURTIER"
  | "LIASSE"
  | "FEC"
  | "ACTE"
  | "DEVIS"
  | "AVIS_FISCAL"
  // Les trois suivantes viennent du §17 du PLAN, qui énumère « contrat, échéancier, compte,
  // relevé, fiche de paie, liasse, FEC, acte, BAIL, avis fiscal, VALORISATION, DOCUMENT ou
  // donnée manuelle ». Le §6 de V10 les omet. Le plan tranche, comme pour le plancher
  // typographique : V10 est une aide de conception, le plan est la référence. Les omettre
  // rendrait indéclarables le bail d'un bien loué et la valorisation d'un actif, que le §17
  // nomme explicitement comme des sources.
  | "BAIL"
  | "VALORISATION"
  | "DOCUMENT"
  | "SAISIE_MANUELLE";

/**
 * Famille de faits dont la PRÉSENCE prouve que l'utilisateur détient cette source.
 *
 * C'est le point qui distingue un rail honnête d'un rail décoratif. Le §17 veut que chaque
 * source affiche son état ; or une page ne peut pas le DÉCLARER, puisqu'il dépend de ce que
 * l'utilisateur a réellement fourni. Le manifeste déclare donc la QUESTION — « quels faits
 * prouveraient que cette source existe ? » — et la réponse est lue dans les faits.
 *
 * SOURCE DÉCLARÉE PERTINENTE ≠ SOURCE DÉTENUE. Sans cette indirection, il faudrait écrire un
 * état dans le manifeste, c'est-à-dire affirmer qu'un contrat est fourni sans l'avoir vérifié.
 */
export type SourceEvidence =
  | "BANK_ACCOUNTS"
  | "BANK_TRANSACTIONS"
  | "LIABILITIES"
  | "LIABILITY_PROVIDED_SCHEDULE"
  | "POSITIONS"
  | "PORTFOLIO_EVENTS"
  | "REAL_ESTATE_ASSETS"
  | "REAL_ESTATE_VALUATIONS"
  | "REAL_ESTATE_OPERATING_TERMS"
  | "BUSINESS_ENTITIES"
  | "BUSINESS_FINANCIALS"
  | "CAREER_ROLES"
  | "CAREER_COMPENSATION"
  | "TAX_OBSERVATIONS"
  | "TAX_RULE_SETS"
  | "DOCUMENTS"
  | "GOALS"
  | "SCENARIOS"
  | "DECISION_CASES"
  | "RECURRING_RULES"
  | "MONTHLY_CLOSES";

/**
 * Une ligne du rail de sources, telle que la page la DÉCLARE.
 *
 * La section 16 interdit à un agent de décider quelles sources apparaissent : elles sont donc
 * écrites au registre, avec le passage du plan qui les fonde, et non calculées à la lecture.
 */
export interface PageSourceDeclaration {
  /** Identifiant stable dans la page. Sert de clé de sélection dans le rail. */
  readonly id: string;
  readonly category: SourceCategory;
  /** Nom compréhensible. Au plus DEUX mots : budget de texte du §3 de V10. */
  readonly name: string;
  readonly evidence: SourceEvidence;
  /**
   * Passage du plan ou de V10 qui fonde cette ligne.
   *
   * Non décoratif : une source sans référence serait une composition inventée, et le gate de
   * registre la refuse. C'est la trace qui permet de relire une déclaration sans rouvrir
   * l'historique de la branche.
   */
  readonly planRef: string;
}

// ─── 39.1 PageManifest ────────────────────────────────────────────────────────────────────

export interface PageManifest {
  /** Identifiant stable. Sert de clé de registre et de route. */
  readonly id: string;
  /**
   * Version du manifeste.
   *
   * Une page dont la composition change change de version : c'est ce qui permet de dire
   * qu'un écran observé correspond, ou non, au contrat revu.
   */
  readonly version: number;
  /** Titre français de la page. */
  readonly title: string;
  /**
   * LA question à laquelle la page répond, telle qu'un utilisateur la poserait.
   *
   * Critère de la section 11 : elle doit être compréhensible en cinq secondes. Une page qui
   * n'a pas de question n'a pas de raison d'occuper une entrée de navigation.
   */
  readonly question: string;
  /** Ordre des zones. Toute zone absente est volontairement absente. */
  readonly zones: readonly PageZone[];
  /**
   * Sources du domaine, dans l'ordre du rail.
   *
   * Section 17, zone B : « il montre uniquement les sources PERTINENTES pour le domaine ».
   * Vide quand la page ne déclare pas la zone `SOURCE_RAIL` — Today, par exemple, n'a pas de
   * source propre : il lit les vérités des autres domaines. Le gate de registre refuse les
   * deux incohérences symétriques, une zone déclarée sans source et des sources sans zone.
   */
  readonly sources: readonly PageSourceDeclaration[];
  /**
   * Action primaire, ou `null`.
   *
   * Section 17 : « une action primaire maximum ». Le type l'impose plutôt que de compter sur
   * la discipline d'un auteur de page.
   */
  readonly primaryAction: string | null;
  /**
   * KPI essentiels, dans l'ordre d'affichage.
   *
   * Ils doivent tous exister dans le registre des KPI : c'est le quatrième refus de la
   * section 39, « une page qui référence un KPI hors registre ».
   */
  readonly essentialKpis: readonly string[];
  /** Objectifs que la page autorise à cocher. Tous doivent exister au registre. */
  readonly allowedObjectives: readonly string[];
  /**
   * États que la page sait rendre.
   *
   * Une page qui ne déclare pas `DECLARED_NONE` ne saura pas répondre « je ne suis pas
   * concerné », et le domaine restera visible avec des cartes vides : c'est le défaut que la
   * section 6.3 corrige.
   */
  readonly supportedStates: readonly PresentationState[];
  /** Modes que la page sait rendre. Une page de faits seuls ne porte que `REAL`. */
  readonly realityModes: readonly RealityMode[];
  readonly viewport: ViewportStrategy;
  /**
   * Ce que la page ne montre PAS au premier écran, et pourquoi.
   *
   * Écrit dans le manifeste plutôt que laissé au jugement : la section 8 liste pour chaque
   * espace un « à masquer ou différer », et une exclusion non écrite se perd à la première
   * relecture.
   */
  readonly deferred: readonly string[];
}

// ─── 39.2 ObjectiveManifest ───────────────────────────────────────────────────────────────

/**
 * Un objectif à cocher : ce que l'utilisateur veut OBTENIR, pas une case de configuration.
 *
 * Section 18.1 : avant toute saisie longue, LFO demande « que souhaitez-vous obtenir ? ». Un
 * objectif qui n'ouvre aucun usage est refusé par le CI, troisième refus de la section 39 :
 * il ferait remplir des champs pour rien.
 */
export interface ObjectiveManifest {
  readonly id: string;
  /** Libellé utilisateur, à la première personne de ce qu'il veut faire. */
  readonly label: string;
  /** Pourquoi l'activer, en une phrase concrète. Jamais une reformulation du libellé. */
  readonly reason: string;
  /** Groupes de champs révélés. Vide est légitime si l'objectif ne demande qu'un import. */
  readonly revealsFieldGroups: readonly string[];
  /**
   * KPI que l'objectif rend disponibles.
   *
   * Au moins un KPI OU un groupe de champs : sans l'un des deux, l'objectif n'ouvre rien.
   */
  readonly unlocksKpis: readonly string[];
  /** Documents ou imports qui peuvent remplacer la saisie. */
  readonly recommendedSources: readonly string[];
  /** Autres objectifs nécessaires avant celui-ci. */
  readonly dependsOn: readonly string[];
  /** Ce qui se passe quand l'utilisateur décoche : la donnée n'est jamais perdue en silence. */
  readonly onDeactivate: "KEEP_DATA_HIDE_SECTION" | "ASK_KEEP_OR_DELETE";
  /** Ce qui se passe quand les données existent déjà : l'objectif ne redemande rien. */
  readonly whenDataAlreadyPresent: "ACTIVATE_SILENTLY" | "OFFER_REVIEW";
  /** Un objectif de simulation ne produit jamais de fait. */
  readonly mode: RealityMode;
  /** Ce qui reste un jugement humain, même l'objectif activé. */
  readonly humanJudgementRemains: readonly string[];
}

// ─── 39.3 FieldDefinition ─────────────────────────────────────────────────────────────────

export type FieldType =
  "MONEY" | "RATE" | "QUANTITY" | "AREA" | "DATE" | "TEXT" | "ENUM" | "BOOLEAN" | "REFERENCE";

export interface FieldDefinition {
  readonly id: string;
  readonly label: string;
  /** Ce que le champ signifie économiquement. Pas une paraphrase du libellé. */
  readonly definition: string;
  readonly type: FieldType;
  /** Unité, hors devise : « m² », « parts », « échéances ». `null` si sans unité. */
  readonly unit: string | null;
  /** Un montant porte TOUJOURS sa devise : `"NATIVE"` la fait porter par la donnée. */
  readonly currency: "NATIVE" | "REPORTING" | null;
  /** Décimales significatives. `null` quand la précision n'est pas bornée. */
  readonly precision: number | null;
  /**
   * `true` quand l'absence est une valeur légitime.
   *
   * Ce n'est pas une contrainte de formulaire : c'est la réponse à « l'absence de cette
   * donnée est-elle une information ? ». Un champ non nullable dont on n'a pas la valeur
   * bloque un calcul, il ne prend pas zéro.
   */
  readonly nullable: boolean;
  /** Natures de donnée que ce champ accepte. Un fait n'accepte pas une hypothèse. */
  readonly acceptedKinds: readonly DataKind[];
  /** Le champ porte-t-il sa propre date économique ? */
  readonly carriesEconomicDate: boolean;
  /** Règles de validation, en français, telles qu'elles sont annoncées à l'utilisateur. */
  readonly validation: readonly string[];
  /**
   * Objectifs qui révèlent ce champ. Doit être non vide : c'est le PREMIER refus de la
   * section 39, « un champ sans objectif ni consommateur ».
   */
  readonly consumedByObjectives: readonly string[];
  /** KPI qui utilisent ce champ. Peut être vide si des objectifs le consomment. */
  readonly consumedByKpis: readonly string[];
  /** Donnée sensible : conditionne l'anonymisation et l'export. */
  readonly sensitive: boolean;
  /** Ce qui se passe quand une nouvelle valeur remplace celle-ci. */
  readonly supersession: "REPLACE_WITH_AUDIT" | "APPEND_AS_OBSERVATION" | "IMMUTABLE";
  readonly help: string;
  /**
   * Exemple de format, NON prérempli.
   *
   * Section 18.3 : « les exemples sont des placeholders, jamais des valeurs ». Le nom du
   * champ le rappelle à qui l'implémente.
   */
  readonly placeholderExample: string | null;
}

// ─── 39.4 KpiDefinition ───────────────────────────────────────────────────────────────────

/** Niveau de vérité d'un KPI. La section 16.3 en fait un attribut obligatoire. */
export type KpiProvenance = "OBSERVED" | "CONTRACTUAL" | "DERIVED" | "SIMULATED";

export type KpiVisualisation =
  | "SINGLE_VALUE"
  | "VALUE_WITH_DELTA"
  | "RANGE"
  | "BREAKDOWN"
  | "TIME_SERIES"
  | "WATERFALL"
  | "TABLE";

export interface KpiDefinition {
  readonly id: string;
  /** Libellé français. */
  readonly label: string;
  /** La question à laquelle ce KPI répond. Un KPI sans question n'entre pas au registre. */
  readonly question: string;
  /**
   * Formule NOMMÉE.
   *
   * Quand le plan de refonte l'énonce, elle est transcrite mot pour mot. Sinon, elle nomme
   * la fonction de moteur qui la porte : c'est la formule RÉELLE, vérifiable, là où une
   * paraphrase écrite ici serait une seconde définition qui divergerait au premier
   * changement de moteur.
   */
  readonly formula: string;
  /** Module et fonction du moteur qui produit la valeur. `null` si aucun ne l'implémente. */
  readonly engine: string | null;
  /** Conventions de signe et de dénominateur, quand le KPI en a. */
  readonly conventions: readonly string[];
  /** Période de mesure. */
  readonly period: "POINT_IN_TIME" | "MONTH" | "YEAR" | "TRAILING_12M" | "USER_RANGE";
  /** Devise de restitution. `null` pour un KPI sans dimension monétaire. */
  readonly currency: "NATIVE" | "REPORTING" | null;
  /** Sources minimales acceptables pour que le KPI ait un sens. */
  readonly minimalSources: readonly string[];
  /**
   * Données INDISPENSABLES. Non vide : c'est le deuxième refus de la section 39, « un KPI
   * sans formule ou sans données requises ».
   */
  readonly requiredData: readonly string[];
  /** Données qui améliorent la précision sans conditionner le calcul. */
  readonly optionalData: readonly string[];
  /** Comportement face à un `null`. Jamais « compter zéro ». */
  readonly onNull: "NOT_COMPUTABLE" | "EXCLUDE_AND_FLAG";
  /**
   * Comportement face à un zéro DÉCLARÉ, qui est une information et non une absence.
   *
   * `NOT_APPLICABLE` existe pour les KPI sans dimension numérique, comme une fraîcheur de
   * source : les forcer à choisir entre « calculer » et « non calculable » leur ferait
   * affirmer quelque chose de faux sur un zéro qui n'a pas de sens chez eux.
   */
  readonly onDeclaredZero: "COMPUTE" | "NOT_COMPUTABLE" | "NOT_APPLICABLE";
  /** Comportement face à une devise étrangère. */
  readonly onForeignCurrency: "CONVERT_AT_ECONOMIC_DATE" | "NOT_COMPUTABLE" | "NOT_APPLICABLE";
  /** Comportement face à une période partielle. Jamais d'annualisation implicite. */
  readonly onPartialPeriod: "LABEL_AS_PARTIAL" | "NOT_COMPUTABLE" | "NOT_APPLICABLE";
  readonly provenance: KpiProvenance;
  /** Explication destinée à l'utilisateur, en français, sans code. */
  readonly userExplanation: string;
  /** Détail réservé au volet technique : conventions internes, limites, identifiants. */
  readonly technicalDetail: string;
  readonly visualisation: KpiVisualisation;
  /** Le KPI peut-il être épinglé sur Aujourd'hui ? */
  readonly pinnable: boolean;
  /** Le KPI peut-il être masqué par l'utilisateur ? Un KPI essentiel peut l'être aussi. */
  readonly hideable: boolean;
}

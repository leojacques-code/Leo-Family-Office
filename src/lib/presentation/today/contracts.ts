import type { PresentationState } from "@/lib/presentation/language/states";
import type { IssueFamily } from "@/lib/presentation/language/states";
import type { SourceCategory } from "@/lib/presentation/registry/contracts";

/**
 * Contrats du modèle de lecture d'Aujourd'hui (§20 du plan, §10.2 pour l'emplacement).
 *
 * CE QUI EST ICI EST DÉJÀ PRÊT À AFFICHER. Le §10.2 le dit du modèle de lecture : « chaque
 * modèle contient uniquement les données déjà prêtes à présenter, les actions disponibles et
 * les états de source nécessaires au domaine ». Aucun type de moteur ne traverse cette
 * frontière — ni `CanonicalAggregate`, ni `GlobalFinancialContext`, ni `DashboardState` — et
 * ce n'est pas de la cosmétique d'architecture : tant que le composant reçoit l'état global,
 * il peut recalculer, et la mesure technique du §13 (« aucune page de domaine ne sérialise
 * tout DashboardState ») reste hors d'atteinte.
 *
 * AUCUN CODE TECHNIQUE N'ENTRE ICI. Un code de moteur (`REAL_ESTATE_VALUATION_MISSING`) est
 * traduit AVANT d'arriver dans ce modèle, par le traducteur de la phase 0. Ce que le modèle
 * transporte est une phrase française et un état parmi les huit du §6.3 ; l'identifiant, s'il
 * existe, voyage dans un champ séparé destiné au seul volet technique. C'est le constat 5.4.
 */

// ─── Domaines déclarables (§19.1 item 4) ──────────────────────────────────────────────────

/**
 * Les huit domaines que l'onboarding fait déclarer, transcrits du §19.1 item 4 : « banque,
 * investissement, dette, immobilier, carrière/revenus, entreprise, fiscalité, objectifs ».
 *
 * La liste est CLOSE et identique à celle de la contrainte de base. Un neuvième domaine se
 * déclarerait dans les deux, jamais dans un seul : une valeur que la base accepte et que
 * l'interface ne sait pas nommer produirait une déclaration illisible.
 */
export type DeclarableDomain =
  | "BANQUE"
  | "INVESTISSEMENT"
  | "DETTE"
  | "IMMOBILIER"
  | "CARRIERE"
  | "ENTREPRISE"
  | "FISCALITE"
  | "OBJECTIFS";

/**
 * Réponse à « Êtes-vous concerné ? », §18.1 : « Oui, non, je ne sais pas encore ».
 *
 * ABSENCE ≠ `UNDECIDED` ≠ `DECLARED_NONE`. L'absence de déclaration n'est PAS représentée
 * ici : elle se lit à l'absence d'entrée dans la carte des déclarations. Lui donner une
 * quatrième valeur d'énumération inviterait à la confondre avec `UNDECIDED`, qui est une
 * réponse et non un silence.
 */
export type DomainApplicability = "APPLICABLE" | "DECLARED_NONE" | "UNDECIDED";

/** Une déclaration courante, telle que le modèle de lecture la reçoit. */
export interface DomainDeclaration {
  readonly domain: DeclarableDomain;
  readonly applicability: DomainApplicability;
  /** Date économique de la déclaration. */
  readonly declaredOn: string;
  readonly note: string | null;
}

/**
 * État d'un domaine sur Aujourd'hui : ce que l'utilisateur a dit, et ce que les faits disent.
 *
 * DÉCLARÉ ≠ ALIMENTÉ, et les quatre combinaisons ont un sens différent. Un domaine déclaré
 * applicable et vide est une invitation ; déclaré non concerné et vide est un domaine clos ;
 * déclaré non concerné mais PORTANT des faits est une contradiction qu'il faut montrer sans
 * la trancher — le §16 interdit de choisir entre la déclaration et le fait.
 */
export interface DomainStatusView {
  readonly domain: DeclarableDomain;
  readonly label: string;
  readonly applicability: DomainApplicability | "UNDECLARED";
  readonly declaredOn: string | null;
  readonly note: string | null;
  /** Des faits existent-ils dans ce domaine ? Lu dans les faits, jamais déclaré. */
  readonly hasFacts: boolean;
  /** Où connecter ou importer la source de ce domaine (§19.2 items 1, 2 et 4). */
  readonly sourceHref: string;
  /** Où ajouter le fait à la main (§19.2 item 3). */
  readonly manualHref: string;
  /** Catégorie de source du rail, pour la ligne correspondante (§17 zone B). */
  readonly sourceCategory: SourceCategory;
}

// ─── Les six réponses (§3 et §11 : « cockpit répondant aux six questions produit ») ───────

/**
 * Une des six questions produit du §3, et son état de réponse.
 *
 * `value` est `null` dès que la réponse n'est pas calculable, JAMAIS zéro : c'est le premier
 * invariant de la constitution du dépôt, et le §20 le redit pour cette page (« aucun montant
 * manquant remplacé par zéro »).
 *
 * `kpiId` est là pour que la réponse soit rattachable au registre du §16.3. Une réponse
 * affichée sans KPI de registre serait exactement la composition libre que le §16 interdit,
 * et le CI refuse « une page qui référence un KPI hors registre ».
 */
export interface AnswerView {
  /** Rang de la question dans le §3, de 1 à 6. Sert l'ordre, qui n'est pas décoratif. */
  readonly rank: 1 | 2 | 3 | 4 | 5 | 6;
  /** La question du §3, mot pour mot. */
  readonly question: string;
  /** Identifiants de registre des KPI qui répondent. Au moins un. */
  readonly kpiIds: readonly string[];
  /** Libellé court de la valeur dominante. */
  readonly label: string;
  readonly value: number | null;
  readonly unit: "REPORTING_CURRENCY" | "COUNT" | "NONE";
  readonly state: PresentationState;
  /**
   * Réserve locale, en français et déjà traduite. Au plus UNE par réponse : le §17 borne la
   * zone C à « au plus une réserve de qualité locale », et empiler les réserves d'un moteur
   * reproduit la liste de codes du constat 5.4.
   */
  readonly reserve: string | null;
  /** Signe attendu, pour la géométrie. Une variation se lit à son sens, pas à sa couleur. */
  readonly signed: boolean;
}

// ─── Flux du mois (§20 item 3) ────────────────────────────────────────────────────────────

/**
 * Le mois observé : revenu, dépenses essentielles, service de dette, épargne libre.
 *
 * Les quatre postes sont ceux du §20 item 3, dans son ordre. Ils ne sont PAS recalculés :
 * ils viennent tels quels de `computeObservedCashFlow`, et le §2 de la constitution interdit
 * à une couche aval de refaire la logique d'une couche amont.
 */
export interface MonthFlowView {
  readonly periodStart: string;
  readonly periodEnd: string;
  /** Le mois est-il intégralement couvert ? `LABEL_AS_PARTIAL` du registre des KPI. */
  readonly partial: boolean;
  readonly income: number;
  readonly essentialExpenses: number;
  readonly debtService: number;
  /** Solde après tout, y compris le service de dette. */
  readonly freeCashFlow: number;
  /**
   * Flux non classés de la période.
   *
   * Rendus explicitement parce qu'ils changent la LECTURE des quatre postes : un solde libre
   * calculé avec 3 000 € non classés n'est pas le même chiffre qu'un solde libre sur un mois
   * intégralement classé, et ne pas le dire serait une fausse précision.
   */
  readonly unclassifiedFlows: number;
  readonly reserve: string | null;
}

// ─── Évolution depuis la clôture (§20 item 2) ─────────────────────────────────────────────

export interface CloseChangeView {
  readonly fromDate: string;
  readonly toDate: string;
  readonly amount: number;
  /**
   * Causes principales de la variation.
   *
   * Vide est une réponse honnête : le §20 demande « avec causes principales », et une cause
   * est une DIFFÉRENCE entre deux clôtures comparables. Quand les deux clôtures ne portent pas
   * les mêmes postes, aucune cause n'est attribuable, et en fabriquer une serait un jugement.
   */
  readonly causes: readonly { readonly label: string; readonly amount: number }[];
}

// ─── Trajectoire courte (§20 item 4) ──────────────────────────────────────────────────────

export interface GoalTrajectoryView {
  readonly goalId: string;
  readonly name: string;
  readonly targetDate: string | null;
  /** Progression de 0 à 1, ou `null` si non calculable. Jamais 0 par défaut. */
  readonly progress: number | null;
  readonly reserve: string | null;
}

// ─── Actions prioritaires (§20 item 5) ────────────────────────────────────────────────────

/**
 * Une action, avec ce que le §17 zone F exige de toute demande de donnée : ce qui s'est
 * passé, pourquoi cela compte, la preuve, et ce qui changera après validation.
 */
export interface PriorityAction {
  readonly id: string;
  readonly label: string;
  readonly href: string;
  /** Ce qui s'est passé. */
  readonly fact: string;
  /** Pourquoi cela compte. */
  readonly importance: string;
  /** La preuve : où le constat se lit. */
  readonly evidence: string;
  /** Ce qui changera après validation. */
  readonly effect: string;
  readonly state: PresentationState;
}

// ─── Échéances J+30 (§20 item 6) ──────────────────────────────────────────────────────────

export interface ObligationView {
  readonly id: string;
  readonly date: string;
  /** Libellé français de l'échéance. Jamais un code d'union avec ses soulignés retirés. */
  readonly label: string;
  readonly domainLabel: string;
  /** Montant attendu, `null` quand il n'est pas connu. Une échéance sans montant existe. */
  readonly amount: number | null;
  /** OBSERVÉ ≠ CONTRACTUEL ≠ PROJETÉ : l'étiquette est celle du niveau de preuve. */
  readonly evidenceLabel: string;
}

// ─── Boîte de réception (§32 : six vues) ──────────────────────────────────────────────────

/**
 * Les six vues du §32, transcrites : « À vérifier, Conflits, Données manquantes, Données
 * anciennes, À venir et Résolus automatiquement ».
 *
 * Elles ne sont PAS les quatre familles de la taxonomie du §11 (`IssueFamily`), et les
 * confondre était le premier piège : la taxonomie dit de quelle NATURE est une réserve, les
 * vues disent dans quel ONGLET elle se range. Trois vues ne dérivent d'aucune famille — une
 * échéance à venir n'est pas une anomalie, et une résolution automatique n'est pas un
 * problème.
 */
export type InboxViewId =
  "TO_VERIFY" | "CONFLICTS" | "MISSING" | "STALE" | "UPCOMING" | "AUTO_RESOLVED";

/** Une tâche, avec les quatre explications que le §11 exige de CHAQUE tâche. */
export interface InboxTask {
  readonly id: string;
  readonly view: InboxViewId;
  readonly title: string;
  /** Ce qui s'est passé. */
  readonly fact: string;
  /** Pourquoi cela compte. */
  readonly importance: string;
  /** La preuve. */
  readonly evidence: string;
  /** Ce que l'acceptation change. */
  readonly effect: string;
  readonly state: PresentationState;
  readonly family: IssueFamily | null;
  /** Où aller pour traiter. `null` quand la tâche n'a pas de destination utile. */
  readonly href: string | null;
  /**
   * Identifiant technique porté par le code d'origine, pour le SEUL volet technique.
   *
   * Il ne s'affiche jamais dans le corps de la tâche : c'est le constat 5.4, où un UUID entier
   * apparaissait dans du texte visible.
   */
  readonly technicalId: string | null;
}

export interface InboxSection {
  readonly id: InboxViewId;
  readonly label: string;
  readonly tasks: readonly InboxTask[];
  /**
   * Pourquoi la vue est vide, quand elle l'est POUR UNE RAISON et non par absence de tâche.
   *
   * « Données anciennes » est le cas que le plan crée lui-même : la vue suppose un seuil de
   * fraîcheur, et le §16 interdit à un agent d'en choisir un. Dire « aucune donnée ancienne »
   * affirmerait une fraîcheur qui n'a pas été mesurée ; la vue dit donc qu'aucun seuil n'est
   * déclaré.
   */
  readonly emptyBecause: string | null;
}

export interface InboxView {
  readonly sections: readonly InboxSection[];
  /** Total des tâches réellement en attente, `pending_review_count` du registre. */
  readonly pendingCount: number;
}

// ─── Rail de sources (§17 zone B) ─────────────────────────────────────────────────────────

export interface RailSourceView {
  readonly id: string;
  readonly category: SourceCategory;
  readonly name: string;
  readonly status: "ACTIVE" | "ABSENTE";
  readonly hint: string | null;
}

// ─── Parcours d'installation (§19.2) ──────────────────────────────────────────────────────

/**
 * Une étape du chemin initial court du §19.2, dans son ordre.
 *
 * Une étape est FAITE quand les faits le prouvent, jamais quand l'utilisateur a cliqué :
 * cliquer « importer » et abandonner l'import ne remplit rien, et cocher l'étape ferait
 * croire à une banque connectée.
 */
export interface InstallationStep {
  readonly id: string;
  readonly rank: number;
  readonly label: string;
  /** Pourquoi cette étape, en une phrase. §19.2 ne demande pas de paragraphe. */
  readonly reason: string;
  readonly status: "DONE" | "TODO" | "DECLARED_NONE" | "UNDECIDED";
  readonly href: string;
  /** Domaines couverts par l'étape, pour rattacher une déclaration à son étape. */
  readonly domains: readonly DeclarableDomain[];
}

export interface InstallationPath {
  readonly steps: readonly InstallationStep[];
  /** Étapes terminées sur étapes applicables. */
  readonly done: number;
  readonly applicable: number;
  /**
   * Au plus CINQ éléments à préciser, §19.2 item 5 : « afficher ensuite au maximum cinq
   * éléments à préciser ».
   */
  readonly toClarify: readonly InboxTask[];
}

// ─── Modèle complet ──────────────────────────────────────────────────────────────────────

/**
 * Étape du profil.
 *
 * `EMPTY` déclenche le parcours d'installation du §19 plutôt que le cockpit : le critère
 * d'acceptation du §11 est qu'« un profil vide obtient un parcours d'installation, pas une
 * succession d'erreurs ».
 */
export type ProfileStage = "EMPTY" | "INSTALLING" | "OPERATING";

export interface TodayReadModel {
  /** Version du manifeste servi. Permet de dire qu'un écran observé suit le contrat revu. */
  readonly manifestVersion: number;
  readonly asOfDate: string;
  readonly reportingCurrency: string;
  readonly profileStage: ProfileStage;
  /** `null` quand le profil est en exploitation : le parcours ne s'affiche plus. */
  readonly installation: InstallationPath | null;
  readonly answers: readonly AnswerView[];
  readonly monthFlow: MonthFlowView | null;
  readonly closeChange: CloseChangeView | null;
  readonly closeChangeReserve: string | null;
  readonly goalTrajectory: GoalTrajectoryView | null;
  /** Au plus TROIS, imposé par le constructeur et vérifié par un test. */
  readonly actions: readonly PriorityAction[];
  readonly obligations: readonly ObligationView[];
  readonly inbox: InboxView;
  readonly railSources: readonly RailSourceView[];
  readonly domains: readonly DomainStatusView[];
  /** Lecture de démonstration : la surface le dit, et aucune écriture n'est proposée. */
  readonly readOnlyDemo: boolean;
}

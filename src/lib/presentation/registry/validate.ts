import { CODE_TRANSLATIONS } from "@/lib/presentation/language/codes";
import type { FieldDefinition } from "./contracts";
import { KPI_REGISTRY } from "./kpis";
import { OBJECTIVE_REGISTRY } from "./objectives";
import { PAGE_REGISTRY } from "./pages";

/**
 * Les six refus de CI de la section 39.
 *
 * « Le CI doit refuser : un champ sans objectif ni consommateur ; un KPI sans formule ou sans
 * données requises ; un objectif qui n'ouvre aucun usage ; une page qui référence un KPI hors
 * registre ; un code interne sans traduction ; une section générée dynamiquement hors
 * manifeste. »
 *
 * Ces refus sont la contrepartie exécutable de la section 16. Sans eux, les registres seraient
 * une intention : un manifeste peut référencer un KPI qui n'existe pas, un objectif peut ne
 * rien débloquer, et personne ne s'en apercevrait avant que l'écran ne soit vide.
 *
 * La sixième règle, « une section générée dynamiquement hors manifeste », ne peut pas se
 * vérifier ici : elle porte sur du code de rendu qui n'existe pas encore, aucune page n'étant
 * branchée sur son manifeste en phase 0. Elle est déclarée comme non vérifiable À CETTE PHASE
 * plutôt qu'omise, et `unverifiableRules()` la nomme pour que son absence soit visible.
 */

export interface RegistryViolation {
  /** Numéro de la règle dans l'ordre de la section 39. */
  readonly rule: 1 | 2 | 3 | 4 | 5;
  readonly message: string;
}

/** Registre des champs. Vide en phase 0 : voir `unverifiableRules`. */
export type FieldRegistry = Readonly<Record<string, FieldDefinition>>;

export interface RegistryInput {
  readonly pages?: typeof PAGE_REGISTRY;
  readonly kpis?: typeof KPI_REGISTRY;
  readonly objectives?: typeof OBJECTIVE_REGISTRY;
  readonly fields?: FieldRegistry;
  readonly codeTranslations?: Readonly<Record<string, unknown>>;
}

/**
 * Applique les cinq refus vérifiables et rend la liste des violations.
 *
 * Rendre une LISTE plutôt que lever à la première erreur est délibéré : un auteur de
 * manifeste doit voir tout ce qui manque en une passe, pas le découvrir une correction à la
 * fois.
 */
export function validateRegistries(input: RegistryInput = {}): RegistryViolation[] {
  const pages = input.pages ?? PAGE_REGISTRY;
  const kpis = input.kpis ?? KPI_REGISTRY;
  const objectives = input.objectives ?? OBJECTIVE_REGISTRY;
  const fields = input.fields ?? {};
  const codes = input.codeTranslations ?? CODE_TRANSLATIONS;
  const violations: RegistryViolation[] = [];

  // ── Règle 1 : un champ sans objectif ni consommateur ────────────────────────────────
  for (const [id, field] of Object.entries(fields)) {
    if (field.consumedByObjectives.length === 0 && field.consumedByKpis.length === 0) {
      violations.push({
        rule: 1,
        message: `Champ « ${id} » : aucun objectif ni KPI ne le consomme. Un champ que rien n’utilise fait remplir un formulaire pour rien.`,
      });
    }
    for (const objectiveId of field.consumedByObjectives) {
      if (!(objectiveId in objectives)) {
        violations.push({
          rule: 1,
          message: `Champ « ${id} » : objectif consommateur « ${objectiveId} » hors registre.`,
        });
      }
    }
    for (const kpiId of field.consumedByKpis) {
      if (!(kpiId in kpis)) {
        violations.push({
          rule: 1,
          message: `Champ « ${id} » : KPI consommateur « ${kpiId} » hors registre.`,
        });
      }
    }
  }

  // ── Règle 2 : un KPI sans formule ou sans données requises ──────────────────────────
  for (const [id, kpi] of Object.entries(kpis)) {
    if (kpi.formula.trim().length === 0) {
      violations.push({ rule: 2, message: `KPI « ${id} » : aucune formule.` });
    }
    if (kpi.requiredData.length === 0) {
      violations.push({
        rule: 2,
        message: `KPI « ${id} » : aucune donnée requise. Un KPI qui n’exige rien se calcule sur du vide.`,
      });
    }
    if (kpi.question.trim().length === 0) {
      violations.push({
        rule: 2,
        message: `KPI « ${id} » : aucune question. La section 16.3 refuse un KPI sans utilité explicite.`,
      });
    }
    if (kpi.minimalSources.length === 0) {
      violations.push({
        rule: 2,
        message: `KPI « ${id} » : aucune source minimale acceptable déclarée.`,
      });
    }
  }

  // ── Règle 3 : un objectif qui n'ouvre aucun usage ───────────────────────────────────
  for (const [id, objective] of Object.entries(objectives)) {
    if (objective.unlocksKpis.length === 0 && objective.revealsFieldGroups.length === 0) {
      violations.push({
        rule: 3,
        message: `Objectif « ${id} » : il ne débloque aucun KPI et ne révèle aucun champ. Le cocher ne change rien.`,
      });
    }
    for (const kpiId of objective.unlocksKpis) {
      if (!(kpiId in kpis)) {
        violations.push({
          rule: 3,
          message: `Objectif « ${id} » : KPI « ${kpiId} » hors registre.`,
        });
      }
    }
    for (const dependencyId of objective.dependsOn) {
      if (!(dependencyId in objectives)) {
        violations.push({
          rule: 3,
          message: `Objectif « ${id} » : dépendance « ${dependencyId} » hors registre.`,
        });
      }
    }
    if (objective.reason.trim().length === 0) {
      violations.push({
        rule: 3,
        message: `Objectif « ${id} » : aucune raison concrète de l’activer.`,
      });
    }
  }

  // ── Règle 4 : une page qui référence un KPI hors registre ───────────────────────────
  for (const [id, page] of Object.entries(pages)) {
    for (const kpiId of page.essentialKpis) {
      if (!(kpiId in kpis)) {
        violations.push({ rule: 4, message: `Page « ${id} » : KPI « ${kpiId} » hors registre.` });
      }
    }
    for (const objectiveId of page.allowedObjectives) {
      if (!(objectiveId in objectives)) {
        violations.push({
          rule: 4,
          message: `Page « ${id} » : objectif « ${objectiveId} » hors registre.`,
        });
      }
    }
    if (page.essentialKpis.length === 0) {
      violations.push({
        rule: 4,
        message: `Page « ${id} » : aucun KPI essentiel. Une page sans indicateur ne répond à aucune question.`,
      });
    }
    if (page.question.trim().length === 0) {
      violations.push({ rule: 4, message: `Page « ${id} » : aucune question dominante.` });
    }
    if (page.zones.length === 0) {
      violations.push({ rule: 4, message: `Page « ${id} » : aucun ordre de zones.` });
    }
    // L'en-tête opérationnel porte le titre, la question, la date et le sélecteur
    // réel/simulation : la section 17 le déclare « toujours présent ».
    if (!page.zones.includes("OPERATIONAL_HEADER")) {
      violations.push({
        rule: 4,
        message: `Page « ${id} » : l’en-tête opérationnel est toujours présent (section 17).`,
      });
    }
    if (new Set(page.zones).size !== page.zones.length) {
      violations.push({ rule: 4, message: `Page « ${id} » : une zone est déclarée deux fois.` });
    }
    if (page.realityModes.length === 0) {
      violations.push({
        rule: 4,
        message: `Page « ${id} » : aucun mode. Une page qui ne dit pas si elle montre le réel ou une simulation les confond.`,
      });
    }
    // Une page qui accepte la simulation doit savoir rendre le réel : sans référence, une
    // trajectoire simulée ne se compare à rien.
    if (page.realityModes.includes("SIMULATION") && !page.realityModes.includes("REAL")) {
      const isDecisionLab = id === "decision-lab";
      if (!isDecisionLab) {
        violations.push({
          rule: 4,
          message: `Page « ${id} » : elle simule sans pouvoir montrer le réel, donc sans point de comparaison.`,
        });
      }
    }
    if (page.supportedStates.length === 0) {
      violations.push({ rule: 4, message: `Page « ${id} » : aucun état supporté.` });
    }
    // Une page qui ne sait pas rendre un incident présentera une panne comme une information
    // financière, ce que la section 6.3 interdit.
    if (!page.supportedStates.includes("SYSTEM_ERROR")) {
      violations.push({
        rule: 4,
        message: `Page « ${id} » : elle ne sait pas rendre un incident technique, et le présenterait comme une information financière.`,
      });
    }

    // ── Zone B : les deux incohérences symétriques ────────────────────────────────────
    // Une zone déclarée sans source rendrait un rail vide, c'est-à-dire la carte vide que le
    // §6 de V10 refuse. Des sources sans la zone seraient une composition que le cadre
    // n'affiche jamais : la déclaration mentirait sur ce que la page montre.
    const declaresRail = page.zones.includes("SOURCE_RAIL");
    if (declaresRail && page.sources.length === 0) {
      violations.push({
        rule: 4,
        message: `Page « ${id} » : elle déclare la zone SOURCE_RAIL sans aucune source. Un rail vide n’est pas un rail.`,
      });
    }
    if (!declaresRail && page.sources.length > 0) {
      violations.push({
        rule: 4,
        message: `Page « ${id} » : elle déclare des sources sans la zone SOURCE_RAIL, qui ne les affichera jamais.`,
      });
    }

    const sourceIds = new Set<string>();
    const sourceEvidence = new Set<string>();
    for (const source of page.sources) {
      if (sourceIds.has(source.id)) {
        violations.push({
          rule: 4,
          message: `Page « ${id} » : deux sources portent l’identifiant « ${source.id} », donc la sélection du rail en désignerait deux à la fois.`,
        });
      }
      sourceIds.add(source.id);

      // Deux lignes sur la même famille de faits porteraient TOUJOURS le même état : l'une
      // des deux n'apprend rien, et l'utilisateur croirait avoir deux pièces à fournir là
      // où il n'en manque qu'une.
      if (sourceEvidence.has(source.evidence)) {
        violations.push({
          rule: 4,
          message: `Page « ${id} » : deux sources s’appuient sur la preuve « ${source.evidence} », elles afficheraient toujours le même état.`,
        });
      }
      sourceEvidence.add(source.evidence);

      // Budget de texte du §3 de V10 : titre de source à deux mots au plus. Ce n'est pas une
      // coquetterie : le rail est large de 2,5 à 3 colonnes sur 16, un titre plus long s'y
      // replie et détruit le rythme vertical.
      const words = source.name.trim().split(/\s+/).filter(Boolean);
      if (words.length === 0) {
        violations.push({
          rule: 4,
          message: `Page « ${id} » : la source « ${source.id} » n’a pas de nom.`,
        });
      } else if (words.length > 2) {
        violations.push({
          rule: 4,
          message: `Page « ${id} » : le nom de source « ${source.name} » fait ${words.length} mots, le §3 de V10 en autorise deux.`,
        });
      }

      // Une source sans référence au plan est une composition inventée, ce que la section 16
      // interdit. La référence n'est pas vérifiable automatiquement, mais son ABSENCE l'est.
      if (source.planRef.trim().length === 0) {
        violations.push({
          rule: 4,
          message: `Page « ${id} » : la source « ${source.id} » ne cite aucun passage du plan. Une source non fondée est une composition inventée (section 16).`,
        });
      }
    }
  }

  // ── Règle 5 : un code interne sans traduction ───────────────────────────────────────
  // Le gate complet vit dans `presentation/language` : il compare le registre de traduction
  // à l'inventaire des unions de réserve déclarées par les moteurs. Ici, on vérifie que le
  // registre existe et n'est pas vide, pour qu'une suppression accidentelle ne rende pas
  // l'autre gate silencieusement inutile.
  if (Object.keys(codes).length === 0) {
    violations.push({
      rule: 5,
      message: "Registre de traduction vide : aucun code technique ne serait traduit.",
    });
  }

  return violations;
}

/**
 * Règles de la section 39 que cette phase ne peut PAS vérifier, et pourquoi.
 *
 * Les nommer vaut mieux que les taire : un gate silencieux sur une règle donne l'illusion
 * qu'elle est tenue.
 */
export function unverifiableRules(): readonly { rule: 6; message: string }[] {
  return [
    {
      rule: 6,
      message:
        "« Une section générée dynamiquement hors manifeste » : non vérifiable en phase 0, aucune page n’étant encore branchée sur son manifeste. La vérification appartient à la phase 1, qui installe le shell et la composition par zones.",
    },
  ];
}

"use client";

import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import {
  ArrowRight, Banknote, BriefcaseBusiness, Building2, Check, ChevronDown, CircleDollarSign,
  Database, Eye, EyeOff, FileCheck2, FileText, FlaskConical, Landmark, Network, Pencil,
  Plus, ReceiptText, Settings2, ShieldCheck, SlidersHorizontal, Sparkles, Target, TrendingUp,
  Upload, WalletCards, WandSparkles, type LucideIcon,
} from "lucide-react";
import type { DashboardState } from "@/lib/types";

export type DomainSource = {
  label: string;
  detail: string;
  keys: readonly string[];
  action: string;
  href?: string;
};

type DomainConfig = {
  icon: LucideIcon;
  title: string;
  question: string;
  intro: string;
  accent: string;
  sources: readonly DomainSource[];
  firstResults: readonly { label: string; detail: string }[];
  unlocks: readonly { label: string; detail: string; needs: string }[];
  connections: readonly string[];
};

const DOMAIN_CONFIG: Record<string, DomainConfig> = {
  "net-worth": {
    icon: WalletCards,
    title: "Patrimoine",
    question: "Qu'est-ce que je possède réellement, qu'est-ce que je dois et qu'est-ce qui est mobilisable ?",
    intro: "LFO consolide d'abord les faits observables. Les analyses de concentration, liquidité ou solvabilité n'apparaissent qu'à partir des données réellement disponibles.",
    accent: "blue",
    sources: [
      { label: "Comptes & épargne", detail: "Banque, livrets, PEA, CTO", keys: ["accounts"], action: "Connecter ou importer", href: "/imports" },
      { label: "Actifs", detail: "Titres, immobilier, participations", keys: ["positions", "properties", "businessInterests"], action: "Ajouter un actif" },
      { label: "Dettes", detail: "Crédits et autres engagements", keys: ["liabilities"], action: "Ajouter une dette" },
    ],
    firstResults: [
      { label: "Patrimoine net", detail: "Actifs observés − dettes observées" },
      { label: "Liquidité disponible", detail: "Ce qui peut réellement être mobilisé rapidement" },
      { label: "Répartition du patrimoine", detail: "Où se trouve la valeur et où elle est concentrée" },
    ],
    unlocks: [
      { label: "Concentration économique", detail: "Identifier les expositions réellement communes", needs: "Classes d'actifs, zones, entreprises et sous-jacents" },
      { label: "Patrimoine réel après inflation", detail: "Comparer valeur nominale et pouvoir d'achat futur", needs: "Horizon et hypothèse d'inflation" },
      { label: "Liquidité sous contrainte", detail: "Tester le patrimoine mobilisable en cas de besoin urgent", needs: "Délais de vente et décotes de liquidité" },
    ],
    connections: ["Cash Flow", "Dette", "Investissements", "Immobilier", "Entreprise"],
  },
  "cash-flow": {
    icon: CircleDollarSign,
    title: "Cash Flow",
    question: "Combien de liberté financière reste-t-il réellement chaque mois ?",
    intro: "Les revenus et dépenses ne doivent pas être une longue liste. LFO distingue ce qui est récurrent, incompressible, flexible, exceptionnel ou simplement un transfert entre vos propres comptes.",
    accent: "green",
    sources: [
      { label: "Transactions bancaires", detail: "Source principale pour automatiser les flux", keys: ["transactions"], action: "Connecter une banque", href: "/imports" },
      { label: "Revenus récurrents", detail: "Salaire, loyers, aides, revenus professionnels", keys: ["recurringRules", "careerEvents"], action: "Déclarer un revenu" },
      { label: "Engagements récurrents", detail: "Loyer, dette, abonnements, charges fixes", keys: ["recurringRules", "liabilities"], action: "Ajouter un récurrent" },
    ],
    firstResults: [
      { label: "Marge de manœuvre", detail: "Revenus − charges incompressibles avant discrétionnaire" },
      { label: "Taux d'épargne", detail: "Ce que votre niveau de vie laisse réellement au futur" },
      { label: "Fonds de sécurité", detail: "Nombre de mois absorbables avec la liquidité disponible" },
    ],
    unlocks: [
      { label: "Flexibilité financière", detail: "Mesurer ce qui peut réellement être réduit à court terme", needs: "Qualifier les dépenses : fixe, variable, discrétionnaire, incompressible" },
      { label: "Épargne cible", detail: "Tester plusieurs taux d'épargne selon vos projets", needs: "Objectifs, horizon et minimum de sécurité" },
      { label: "Détection des récurrents", detail: "Repérer doublons, abonnements et nouveaux flux", needs: "Historique bancaire suffisamment profond" },
    ],
    connections: ["Carrière", "Dette", "Objectifs", "Immobilier", "Investissements"],
  },
  investments: {
    icon: TrendingUp,
    title: "Investissements",
    question: "Mon portefeuille est-il cohérent avec mes projets, mon risque et ma liquidité ?",
    intro: "LFO sépare performance, contribution, risque, fiscalité et liquidité. Le nombre de lignes ne suffit jamais pour conclure qu'un portefeuille est diversifié.",
    accent: "violet",
    sources: [
      { label: "Comptes d'investissement", detail: "PEA, CTO, assurance-vie, épargne", keys: ["accounts", "positions"], action: "Importer un relevé", href: "/imports" },
      { label: "Transactions", detail: "Achats, ventes, versements et retraits", keys: ["transactions", "portfolioEvents"], action: "Importer l'historique", href: "/imports" },
      { label: "Profil & horizon", detail: "Besoin de cash, projets et capacité d'absorption", keys: ["goals", "scenarios"], action: "Préciser le contexte" },
    ],
    firstResults: [
      { label: "Allocation", detail: "Répartition économique réelle du portefeuille" },
      { label: "Performance", detail: "Séparer rendement de marché et apports personnels" },
      { label: "Liquidité", detail: "Ce qui peut être vendu sans compromettre le projet" },
    ],
    unlocks: [
      { label: "Risque & corrélations", detail: "Comprendre ce qui pourrait baisser simultanément", needs: "Historique de marché ou facteurs de risque" },
      { label: "Performance réelle", detail: "Rendement après inflation, frais et fiscalité", needs: "Frais, enveloppe fiscale et horizon" },
      { label: "Capacité de risque", detail: "Relier le portefeuille aux projets et au fonds de sécurité", needs: "Cash Flow, objectifs et liquidité minimale" },
    ],
    connections: ["Patrimoine", "Fiscalité", "Cash Flow", "Objectifs", "Décisions"],
  },
  debt: {
    icon: Landmark,
    title: "Dette",
    question: "Que dit réellement mon contrat et quelle marge de négociation me reste-t-il ?",
    intro: "Un crédit commence par ses documents : offre, échéancier, prélèvements et assurance. LFO ne demande ensuite que les informations manquantes nécessaires au calcul ou à la simulation.",
    accent: "coral",
    sources: [
      { label: "Échéancier bancaire", detail: "Capital, intérêts, assurance, frais et dates", keys: ["liabilities"], action: "Importer l'échéancier", href: "/imports" },
      { label: "Contrat / offre de prêt", detail: "Taux, durée, différé, clauses et remboursement anticipé", keys: ["documents", "liabilities"], action: "Importer le contrat", href: "/imports" },
      { label: "Prélèvements réels", detail: "Vérifier ce qui sort effectivement du compte", keys: ["transactions"], action: "Rapprocher la banque", href: "/imports" },
    ],
    firstResults: [
      { label: "Capital restant dû", detail: "Encours réel ou contractuel à la date observée" },
      { label: "Coût de la dette", detail: "Intérêts + assurance + frais identifiés" },
      { label: "Calendrier des obligations", detail: "Échéances, maturité et sorties futures" },
    ],
    unlocks: [
      { label: "Rembourser ou investir", detail: "Comparer économie d'intérêts et rendement alternatif", needs: "Pénalité, horizon et rendement de comparaison" },
      { label: "Renégociation bancaire", detail: "Tester taux, durée, mensualité et assurance", needs: "Conditions actuelles + alternatives de financement" },
      { label: "Capacité d'endettement projet", detail: "Simuler un nouveau prêt sans fragiliser la liquidité", needs: "Cash Flow, apport, horizon et contraintes" },
    ],
    connections: ["Cash Flow", "Immobilier", "Patrimoine", "Décisions"],
  },
  "real-estate": {
    icon: Building2,
    title: "Immobilier",
    question: "Le projet crée-t-il réellement de la valeur après coût complet, vacance, financement et fiscalité ?",
    intro: "L'immobilier est traité comme un dossier d'investissement. Le prix d'achat n'est que le début : demande locative, copropriété, travaux, dette, vacance et fiscalité changent l'économie du projet.",
    accent: "teal",
    sources: [
      { label: "Bien & marché local", detail: "Surface, prix/m², zone, typologie et demande locative", keys: ["properties", "realEstateAssets"], action: "Décrire le bien" },
      { label: "Financement", detail: "Apport, prêt, assurance, durée et taux", keys: ["liabilities"], action: "Associer un crédit" },
      { label: "Travaux & copropriété", detail: "Devis détaillés, imprévus, PV d'AG et charges", keys: ["documents", "propertyProjects"], action: "Importer les documents", href: "/imports" },
    ],
    firstResults: [
      { label: "Coût complet", detail: "Achat + frais + travaux + financement identifiable" },
      { label: "Rendement brut", detail: "Premier filtre, jamais le verdict final" },
      { label: "Cash après dette", detail: "Exploitation réelle après charges et financement" },
    ],
    unlocks: [
      { label: "Rendement économique", detail: "Vacance, charges, entretien et capex récurrent", needs: "Loyer, vacance, copropriété, taxe foncière et entretien" },
      { label: "Rendement après impôt", detail: "Séparer résultat économique, fiscal et cash disponible", needs: "Régime fiscal, déductibilité et situation du contribuable" },
      { label: "Création de valeur", detail: "Valeur finale − coût complet, jamais valeur − prix d'achat", needs: "Travaux détaillés, prix de sortie et coûts de revente" },
    ],
    connections: ["Dette", "Cash Flow", "Fiscalité", "Patrimoine", "Décisions"],
  },
  career: {
    icon: BriefcaseBusiness,
    title: "Carrière",
    question: "Quelle part de ma capacité financière vient réellement de mon travail et comment peut-elle évoluer ?",
    intro: "Contrat, bulletins de paie et virements bancaires doivent raconter la même histoire. LFO relie ensuite rémunération, fiscalité, Cash Flow et scénarios professionnels.",
    accent: "indigo",
    sources: [
      { label: "Contrat de travail", detail: "Fixe, variable, avantages, date et statut", keys: ["careerEvents", "documents"], action: "Importer le contrat", href: "/imports" },
      { label: "Bulletins de paie", detail: "Brut, cotisations, net imposable et net payé", keys: ["documents"], action: "Importer les bulletins", href: "/imports" },
      { label: "Virements bancaires", detail: "Confirmer le revenu réellement encaissé", keys: ["transactions"], action: "Rapprocher la banque", href: "/imports" },
    ],
    firstResults: [
      { label: "Revenu net confirmé", detail: "Montant réellement encaissé, relié aux sources" },
      { label: "Pont brut → net", detail: "Comprendre rémunération, cotisations et net imposable" },
      { label: "Trajectoire de rémunération", detail: "Évolution historique sans supposer le futur" },
    ],
    unlocks: [
      { label: "Scénario de changement de poste", detail: "Comparer salaire, variable, fiscalité et coût de vie", needs: "Nouvelle offre, localisation et avantages" },
      { label: "Valeur du variable", detail: "Mesurer le risque d'un package plus exposé au bonus", needs: "Règles de bonus et historique de réalisation" },
      { label: "Capacité d'investissement future", detail: "Relier progression de carrière et objectifs patrimoniaux", needs: "Cash Flow et objectifs" },
    ],
    connections: ["Cash Flow", "Fiscalité", "Objectifs", "Décisions"],
  },
  "business-equity": {
    icon: Network,
    title: "Entreprise & participation",
    question: "Que vaut économiquement ma participation et combien de cash l'entreprise transforme-t-elle réellement ?",
    intro: "LFO part des documents qu'un dirigeant ou associé possède déjà : liasse fiscale, compte de résultat, bilan, FEC et cap table. Les analyses avancées viennent ensuite, sans réinventer les comptes à la main.",
    accent: "pink",
    sources: [
      { label: "Liasse fiscale & comptes", detail: "Compte de résultat, bilan et annexes", keys: ["documents", "businessStatements"], action: "Importer la liasse", href: "/imports" },
      { label: "FEC / grand livre", detail: "Approfondir BFR, charges et qualité du résultat", keys: ["fecEntries", "documents"], action: "Importer le FEC", href: "/imports" },
      { label: "Détention", detail: "Parts, capital social, dilution et droits économiques", keys: ["businessInterests", "businessEntities"], action: "Décrire la participation" },
    ],
    firstResults: [
      { label: "Lecture économique", detail: "CA → EBITDA → EBIT → résultat net" },
      { label: "EBITDA → cash", detail: "BFR, capex et autres absorptions de trésorerie" },
      { label: "Valeur de participation", detail: "Valeur d'entreprise → dette/cash → equity → quote-part" },
    ],
    unlocks: [
      { label: "Capex maintenance vs croissance", detail: "Comprendre ce qui protège l'EBITDA et ce qui prépare la croissance", needs: "Historique capex + nature économique des investissements" },
      { label: "Normalisation du BFR", detail: "Mesurer le cash immobilisé par l'exploitation", needs: "Stocks, clients, fournisseurs et saisonnalité" },
      { label: "Qualité des earnings", detail: "Séparer récurrent, exceptionnel et éléments de normalisation", needs: "Détail comptable, historique et éléments non récurrents" },
    ],
    connections: ["Patrimoine", "Fiscalité", "Cash Flow", "Décisions"],
  },
  tax: {
    icon: ReceiptText,
    title: "Fiscalité",
    question: "Quel est le résultat avant impôt, après impôt et avec quel niveau d'incertitude ?",
    intro: "LFO ne doit pas prétendre connaître une fiscalité qu'il ne peut pas prouver. Il montre la règle utilisée, la date, les hypothèses et une marge d'incertitude lorsque le résultat n'est pas déterministe.",
    accent: "amber",
    sources: [
      { label: "Avis & déclarations", detail: "Impôt sur le revenu, IFI et historique fiscal", keys: ["documents", "taxRecords"], action: "Importer un avis", href: "/imports" },
      { label: "Enveloppes financières", detail: "PEA, CTO, assurance-vie et autres régimes", keys: ["accounts", "positions"], action: "Qualifier les enveloppes" },
      { label: "Événements taxables", detail: "Vente, plus-value, dividende, immobilier, entreprise", keys: ["transactions", "portfolioEvents", "timelineEvents"], action: "Ajouter un événement" },
    ],
    firstResults: [
      { label: "Avant / après impôt", detail: "Comparer la performance économique et le cash net" },
      { label: "Calendrier fiscal", detail: "Échéances connues et périodes de mise à jour" },
      { label: "Niveau de confiance", detail: "Ce qui est certain, estimé ou encore à confirmer" },
    ],
    unlocks: [
      { label: "Fiscalité portefeuille", detail: "Comparer PEA, CTO, assurance-vie et plus-values", needs: "Enveloppe, date d'ouverture, historique de transactions" },
      { label: "Fiscalité immobilière", detail: "Gestion, cession, plus-value et régime locatif", needs: "Régime, détention, prix de revient et exploitation" },
      { label: "Fiscalité entreprise", detail: "Dividende, rémunération, cession et structure", needs: "Forme juridique, détention et opération envisagée" },
    ],
    connections: ["Investissements", "Immobilier", "Entreprise", "Carrière", "Décisions"],
  },
  goals: {
    icon: Target,
    title: "Objectifs",
    question: "Quel capital, quel horizon et quelles contraintes se cachent derrière mon objectif ?",
    intro: "Un objectif n'est pas une jauge abstraite. LFO le relie à votre liquidité, votre capacité d'épargne, vos actifs, vos dettes et vos scénarios.",
    accent: "magenta",
    sources: [
      { label: "Objectif", detail: "Montant, date, priorité et flexibilité", keys: ["goals"], action: "Créer un objectif" },
      { label: "Capacité de financement", detail: "Épargne, actifs mobilisables et dettes", keys: ["transactions", "accounts", "liabilities"], action: "Compléter les finances" },
      { label: "Scénarios", detail: "Variantes de revenu, rendement ou projet", keys: ["scenarios"], action: "Tester un scénario" },
    ],
    firstResults: [
      { label: "Écart à financer", detail: "Capital manquant à la date visée" },
      { label: "Effort mensuel", detail: "Contribution nécessaire sous hypothèses explicites" },
      { label: "Compatibilité", detail: "Impact sur liquidité, dette et autres objectifs" },
    ],
    unlocks: [
      { label: "Trajectoire probabilisée", detail: "Explorer une dispersion plutôt qu'un seul futur", needs: "Hypothèses de rendement et volatilité" },
      { label: "Priorisation multi-objectifs", detail: "Comparer objectifs concurrents", needs: "Priorité, flexibilité et dates" },
      { label: "Plan de financement", detail: "Choisir entre épargne, vente d'actif et dette", needs: "Actifs mobilisables et contraintes de financement" },
    ],
    connections: ["Cash Flow", "Investissements", "Dette", "Décisions"],
  },
  scenarios: {
    icon: FlaskConical,
    title: "Scénarios",
    question: "Que se passe-t-il si une hypothèse change, sans modifier l'historique réel ?",
    intro: "Toute simulation est isolée des faits. Les hypothèses sont visibles, modifiables et datées ; le résultat doit montrer ce qui change par rapport à la situation de référence.",
    accent: "violet",
    sources: [
      { label: "Situation de référence", detail: "Faits observés consolidés", keys: ["accounts", "transactions", "liabilities"], action: "Vérifier les sources" },
      { label: "Hypothèses", detail: "Revenu, inflation, rendement, dette ou projet", keys: ["scenarios"], action: "Créer une hypothèse" },
      { label: "Horizon", detail: "Durée pertinente selon le sujet", keys: ["goals"], action: "Choisir l'horizon" },
    ],
    firstResults: [
      { label: "Scénario central", detail: "Trajectoire construite à partir des hypothèses visibles" },
      { label: "Écart au réel", detail: "Ce que la simulation modifie par rapport aux faits" },
      { label: "Sensibilités", detail: "Hypothèses qui changent le plus le résultat" },
    ],
    unlocks: [
      { label: "Stress test", detail: "Baisse de revenu, hausse de taux ou choc de marché", needs: "Amplitude et durée du choc" },
      { label: "Inflation différenciée", detail: "Ne pas projeter toutes les dépenses avec la même inflation", needs: "Catégories de flux et horizons" },
      { label: "Comparaison multi-projets", detail: "Arbitrer plusieurs décisions au même horizon", needs: "Options et contraintes communes" },
    ],
    connections: ["Décisions", "Objectifs", "Patrimoine", "Cash Flow"],
  },
  "decision-lab": {
    icon: WandSparkles,
    title: "Décisions",
    question: "Quelle option améliore réellement ma situation sans déplacer le risque ailleurs ?",
    intro: "La décision compare plusieurs futurs sur patrimoine, liquidité, fiscalité, risque et objectifs. Elle ne doit jamais se réduire à un seul rendement ou à un score opaque.",
    accent: "violet",
    sources: [
      { label: "Situation actuelle", detail: "Faits consolidés de tous les domaines", keys: ["accounts", "transactions", "liabilities"], action: "Vérifier la situation" },
      { label: "Options", detail: "Acheter, attendre, rembourser, investir, vendre…", keys: ["decisionCases", "scenarios"], action: "Créer une option" },
      { label: "Contraintes", detail: "Liquidité minimale, horizon et objectifs", keys: ["goals"], action: "Préciser les contraintes" },
    ],
    firstResults: [
      { label: "Avant / après", detail: "Conséquences visibles de chaque option" },
      { label: "Trade-offs", detail: "Ce qui est gagné et ce qui est sacrifié" },
      { label: "Points de rupture", detail: "Hypothèses qui inversent la décision" },
    ],
    unlocks: [
      { label: "Analyse de sensibilité", detail: "Identifier les variables déterminantes", needs: "Bornes de simulation" },
      { label: "Décision multi-critères", detail: "Patrimoine, liquidité, risque, fiscalité et objectifs", needs: "Priorités utilisateur explicites" },
      { label: "Mémo de décision", detail: "Conserver hypothèses, résultats et raisonnement", needs: "Option sélectionnée" },
    ],
    connections: ["Scénarios", "Objectifs", "Tous les domaines"],
  },
};

const HOME_ACTIONS = [
  { icon: Upload, title: "Compléter mes sources", detail: "Banque, documents, relevés ou saisie manuelle", href: "/imports" },
  { icon: Sparkles, title: "Parcours guidé", detail: "Configurer LFO selon votre situation et vos objectifs", href: "/settings" },
  { icon: FileText, title: "Rapport mensuel", detail: "Synthèse patrimoniale, variations et points d'attention", href: "/documents" },
] as const;

function recordCount(state: DashboardState, keys: readonly string[]) {
  const bag = state as unknown as Record<string, unknown>;
  return keys.reduce((total, key) => {
    const value = bag[key];
    return total + (Array.isArray(value) ? value.length : value ? 1 : 0);
  }, 0);
}

function SourceCard({ source, state }: { source: DomainSource; state: DashboardState }) {
  const count = recordCount(state, source.keys);
  const content = (
    <>
      <div className="v9-source-icon"><Database size={18} /></div>
      <div className="v9-source-copy">
        <div className="v9-source-title"><strong>{source.label}</strong>{count > 0 ? <span className="ready"><Check size={11} /> détecté</span> : <span>à compléter</span>}</div>
        <p>{source.detail}</p>
        <small>{count > 0 ? `${count} élément${count > 1 ? "s" : ""} disponible${count > 1 ? "s" : ""}` : source.action}</small>
      </div>
      <ArrowRight size={15} />
    </>
  );
  return source.href ? <Link className="v9-source-card" href={source.href}>{content}</Link> : <button type="button" className="v9-source-card">{content}</button>;
}

export function CockpitHomeV9({ children, state }: { children: ReactNode; state: DashboardState }) {
  const connected = recordCount(state, ["accounts", "transactions", "positions", "liabilities"]);
  return (
    <div className="v9-home-frame">
      <section className="v9-home-controlbar">
        <div>
          <span className="v9-kicker"><ShieldCheck size={13} /> Espace personnel</span>
          <strong>{connected > 0 ? "Votre cockpit s'enrichit à mesure que les sources arrivent." : "Commencez par les sources que vous avez déjà."}</strong>
          <p>LFO peut fonctionner avec peu de données, puis approfondir l'analyse sans vous obliger à tout renseigner dès le départ.</p>
        </div>
        <div className="v9-home-actions">
          {HOME_ACTIONS.map(({ icon: Icon, title, detail, href }) => <Link href={href} key={title}><Icon size={17} /><span><strong>{title}</strong><small>{detail}</small></span><ArrowRight size={14} /></Link>)}
        </div>
      </section>
      {children}
    </div>
  );
}

export function ProgressiveDomainExperience({ section, state, children }: { section: string; state: DashboardState; children: ReactNode }) {
  const config = DOMAIN_CONFIG[section];
  const [mode, setMode] = useState<"real" | "simulation">("real");
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const [visibleResults, setVisibleResults] = useState(() => new Set([0, 1, 2]));
  const [openUnlock, setOpenUnlock] = useState<number | null>(null);

  const sourceScore = useMemo(() => {
    if (!config) return 0;
    const available = config.sources.filter((source) => recordCount(state, source.keys) > 0).length;
    return Math.round((available / config.sources.length) * 100);
  }, [config, state]);

  if (!config) return <>{children}</>;
  const Icon = config.icon;

  function toggleResult(index: number) {
    setVisibleResults((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index); else next.add(index);
      return next;
    });
  }

  return (
    <div className="v9-progressive-domain" data-v9-domain={section} data-accent={config.accent}>
      <section className="v9-domain-hero">
        <div className="v9-domain-title-block">
          <span className="v9-domain-icon"><Icon size={21} /></span>
          <div>
            <span className="v9-kicker">Lecture guidée</span>
            <h1>{config.title}</h1>
          </div>
        </div>
        <div className="v9-domain-question">
          <strong>{config.question}</strong>
          <p>{config.intro}</p>
        </div>
        <div className="v9-domain-tools">
          <div className="v9-mode-switch" aria-label="Type d'analyse">
            <button type="button" className={mode === "real" ? "active" : ""} onClick={() => setMode("real")}><FileCheck2 size={14} /> Situation réelle</button>
            <button type="button" className={mode === "simulation" ? "active" : ""} onClick={() => setMode("simulation")}><FlaskConical size={14} /> Simulation</button>
          </div>
          <button type="button" className="v9-customize" onClick={() => setCustomizeOpen((value) => !value)}><SlidersHorizontal size={15} /> Personnaliser la vue</button>
        </div>
      </section>

      {mode === "simulation" ? (
        <section className="v9-simulation-banner"><FlaskConical size={20} /><div><strong>Mode simulation isolé des faits</strong><p>Les hypothèses saisies ici doivent rester visibles, datées et séparées de la situation réelle. Elles ne modifient jamais silencieusement les données observées.</p></div><button type="button">Créer un scénario <ArrowRight size={14} /></button></section>
      ) : null}

      {customizeOpen ? (
        <section className="v9-customizer">
          <div><Settings2 size={17} /><span><strong>Votre vue, pas un dashboard figé</strong><small>Masquez les KPI secondaires et gardez uniquement ce qui vous sert.</small></span></div>
          <div className="v9-visibility-list">
            {config.firstResults.map((result, index) => <button type="button" key={result.label} onClick={() => toggleResult(index)} className={visibleResults.has(index) ? "active" : ""}>{visibleResults.has(index) ? <Eye size={14} /> : <EyeOff size={14} />} {result.label}</button>)}
          </div>
        </section>
      ) : null}

      <section className="v9-data-stage">
        <div className="v9-stage-head">
          <div><span>01 · Ce que LFO peut utiliser maintenant</span><h2>Partir de vos documents et de vos comptes, pas d'un formulaire générique.</h2></div>
          <div className="v9-source-meter"><strong>{sourceScore}%</strong><span>couverture de départ</span><i><b style={{ width: `${sourceScore}%` }} /></i></div>
        </div>
        <div className="v9-source-grid">{config.sources.map((source) => <SourceCard source={source} state={state} key={source.label} />)}</div>
        <div className="v9-source-actions"><Link href="/imports" className="button primary"><Upload size={15} /> Importer ou connecter</Link><button type="button" className="button secondary"><Plus size={15} /> Ajouter manuellement</button><span><Pencil size={13} /> Toute donnée importée reste modifiable ou complétable.</span></div>
      </section>

      <section className="v9-results-stage">
        <div className="v9-stage-head simple"><div><span>02 · Premiers résultats</span><h2>Afficher uniquement ce que les données permettent réellement de lire.</h2><p>Pas de carte « non calculable » : un résultat insuffisamment alimenté devient une invitation claire à fournir l'information manquante.</p></div></div>
        <div className="v9-first-results">
          {config.firstResults.map((result, index) => visibleResults.has(index) ? <article key={result.label}><span>{String(index + 1).padStart(2, "0")}</span><div><strong>{result.label}</strong><p>{result.detail}</p></div><em>{sourceScore >= 34 ? "Prêt à analyser" : "À débloquer"}</em></article> : null)}
        </div>
      </section>

      <section className="v9-depth-stage">
        <div className="v9-stage-head simple"><div><span>03 · Aller plus loin si vous le souhaitez</span><h2>Qui peut faire plus peut faire moins.</h2><p>Chaque niveau d'analyse supplémentaire explique d'abord ce qu'il apporte, puis demande uniquement les informations nécessaires à ce nouveau résultat.</p></div></div>
        <div className="v9-unlock-list">
          {config.unlocks.map((item, index) => (
            <article className={openUnlock === index ? "open" : ""} key={item.label}>
              <button type="button" onClick={() => setOpenUnlock(openUnlock === index ? null : index)}><span>{String(index + 1).padStart(2, "0")}</span><div><strong>{item.label}</strong><p>{item.detail}</p></div><ChevronDown size={17} /></button>
              {openUnlock === index ? <div className="v9-unlock-detail"><div><small>Informations supplémentaires nécessaires</small><strong>{item.needs}</strong></div><button type="button">Compléter ces informations <ArrowRight size={14} /></button></div> : null}
            </article>
          ))}
        </div>
      </section>

      <section className="v9-connections"><div><Network size={16} /><span><strong>Ce domaine n'est jamais isolé.</strong><small>Les résultats peuvent alimenter automatiquement les espaces reliés.</small></span></div><div>{config.connections.map((item) => <span key={item}>{item}</span>)}</div></section>

      <section className="v9-complete-analysis">
        <div><span>04 · Analyse complète</span><h2>Ouvrir les moteurs et détails existants lorsque vous en avez besoin.</h2><p>La profondeur historique du produit reste disponible, mais elle n'est plus imposée comme premier écran.</p></div>
        <button type="button" className="button primary" onClick={() => setDetailsOpen((value) => !value)}>{detailsOpen ? "Masquer l'analyse détaillée" : "Afficher l'analyse détaillée"} <ChevronDown size={15} /></button>
      </section>

      {detailsOpen ? <div className="v9-existing-analysis">{children}</div> : null}
    </div>
  );
}

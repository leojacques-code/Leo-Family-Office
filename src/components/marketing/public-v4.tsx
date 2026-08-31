import Link from "next/link";
import {
  Activity,
  ArrowRight,
  BadgeEuro,
  Banknote,
  BarChart3,
  Blocks,
  BrainCircuit,
  BriefcaseBusiness,
  Building2,
  Check,
  CircleDollarSign,
  Database,
  FileCheck2,
  FileText,
  Gauge,
  GitBranch,
  Globe2,
  Goal,
  Landmark,
  Network,
  Orbit,
  PieChart,
  ShieldCheck,
  Sparkles,
  Target,
  TrendingUp,
  WalletCards,
  WandSparkles,
  type LucideIcon,
} from "lucide-react";

type PublicKind = "home" | "about" | "purpose" | "method" | "possibilities" | "pricing";

const PUBLIC_NAV = [
  ["Product", "/"],
  ["Pourquoi LFO", "/purpose"],
  ["Méthode", "/method"],
  ["Possibilités", "/possibilities"],
  ["À propos", "/about"],
  ["Pricing", "/pricing"],
] as const;

const CAPABILITIES = [
  { icon: WalletCards, title: "Comprendre", text: "Patrimoine, liquidité, dette, cash et expositions réunis dans une même vérité." },
  { icon: Activity, title: "Expliquer", text: "Chaque chiffre important peut remonter vers sa source, son calcul et son niveau de confiance." },
  { icon: BrainCircuit, title: "Décider", text: "Scénarios, sensibilités et objectifs transforment les données en choix explicables." },
  { icon: Database, title: "Automatiser", text: "Documents, comptes et APIs alimentent progressivement les moteurs sans transformer l'utilisateur en analyste." },
] as const;

const TECHNIQUES = [
  { icon: WalletCards, label: "Balance Sheet", title: "Patrimoine & liquidité", text: "Distinguer valeur, solvabilité et cash mobilisable." },
  { icon: CircleDollarSign, label: "Cash Flow", title: "Capacité financière", text: "Relier revenus, charges, dette et capacité d'épargne." },
  { icon: PieChart, label: "Portfolio", title: "Allocation & risque", text: "Concentration, horizon, fiscalité, volatilité et rôle de chaque actif." },
  { icon: Landmark, label: "Debt", title: "Structure de dette", text: "Principal, intérêts, assurance, calendrier et scénarios de remboursement." },
  { icon: Building2, label: "Real Estate", title: "Économie complète", text: "Acquisition, financement, exploitation, fiscalité, valeur et création d'equity." },
  { icon: BriefcaseBusiness, label: "Business", title: "Cash & valorisation", text: "EBITDA normalisé, BFR, capex, cash conversion et EV → Equity." },
  { icon: BadgeEuro, label: "Tax", title: "Avant / après impôt", text: "Comparer les décisions sur une base économique cohérente et explicite." },
  { icon: WandSparkles, label: "Scenario", title: "Décision sous incertitude", text: "Comparer trajectoires, hypothèses, sensibilités et conséquences." },
] as const;

const POSSIBILITIES = [
  { group: "Understand", icon: Gauge, items: ["Où est mon patrimoine ?", "Qu'est-ce qui est réellement liquide ?", "Pourquoi ma situation a changé ?", "Quels risques sont concentrés ?"] },
  { group: "Improve", icon: TrendingUp, items: ["Améliorer mon taux d'épargne", "Construire un fonds de sécurité", "Réduire une dette", "Rééquilibrer mes expositions"] },
  { group: "Build", icon: Blocks, items: ["Préparer un achat immobilier", "Analyser une entreprise", "Structurer un projet", "Suivre plusieurs entités"] },
  { group: "Decide", icon: GitBranch, items: ["Acheter ou attendre", "Rembourser ou investir", "Changer de carrière", "Vendre, conserver ou refinancer"] },
] as const;

function Brand() {
  return <Link className="public-brand" href="/"><span>LF</span><div><strong>Léo</strong><small>Family Office</small></div></Link>;
}

function PublicShell({ children, active }: { children: React.ReactNode; active: PublicKind }) {
  return (
    <main className={`public-v4 public-${active}`}>
      <div className="public-noise" />
      <header className="public-header">
        <Brand />
        <nav>{PUBLIC_NAV.map(([label, href]) => <Link key={href} className={(active === "home" && href === "/") || href.includes(active) ? "active" : ""} href={href}>{label}</Link>)}</nav>
        <div className="public-header-actions"><Link className="public-text-link" href="/login">Connexion</Link><Link className="public-cta" href="/login?next=/today">Entrer dans LFO <ArrowRight size={14}/></Link></div>
      </header>
      {children}
      <footer className="public-footer">
        <Brand />
        <div><Link href="/purpose">Pourquoi</Link><Link href="/method">Méthode</Link><Link href="/possibilities">Possibilités</Link><Link href="/pricing">Pricing</Link></div>
        <span>Prototype expérimental · données & pricing illustratifs</span>
      </footer>
    </main>
  );
}

function GlobeIllustration() {
  const nodes = [
    ["Bank", "node-bank", Banknote], ["Career", "node-career", BriefcaseBusiness], ["Broker", "node-broker", TrendingUp],
    ["Property", "node-property", Building2], ["Company", "node-company", Network], ["Tax", "node-tax", BadgeEuro],
  ] as const;
  return (
    <div className="public-globe-stage">
      <div className="public-orbit orbit-one"/><div className="public-orbit orbit-two"/>
      <div className="public-globe">
        <span className="mesh mesh-a"/><span className="mesh mesh-b"/><span className="mesh mesh-c"/>
        <div className="public-globe-core"><Orbit size={18}/><strong>LFO</strong><small>financial truth</small></div>
      </div>
      <svg className="public-globe-arcs" viewBox="0 0 700 560" aria-hidden="true">
        <path d="M350 280 C220 140 150 160 90 120"/><path d="M350 280 C470 120 540 130 610 100"/><path d="M350 280 C560 230 600 260 660 280"/><path d="M350 280 C500 410 560 400 620 450"/><path d="M350 280 C220 430 160 405 100 460"/><path d="M350 280 C190 280 130 290 55 285"/>
      </svg>
      {nodes.map(([label, klass, Icon]) => <div className={`public-globe-node ${klass}`} key={label}><span><Icon size={14}/></span><strong>{label}</strong></div>)}
      <div className="public-floating-card card-a"><span>Sources connected</span><strong>8</strong><i>+2 this month</i></div>
      <div className="public-floating-card card-b"><span>Decision ready</span><strong>3 paths</strong><i>facts separated from assumptions</i></div>
    </div>
  );
}

function PipelineIllustration() {
  const steps = [
    { icon: Database, label: "Sources", detail: "Accounts · docs · APIs" },
    { icon: FileCheck2, label: "Reconcile", detail: "Match · verify · flag" },
    { icon: Activity, label: "Engines", detail: "Cash · debt · tax · value" },
    { icon: WalletCards, label: "Truth", detail: "Consolidated wealth" },
    { icon: BrainCircuit, label: "Decide", detail: "Goals · scenarios · actions" },
  ];
  return <div className="public-pipeline">{steps.map(({ icon: Icon, label, detail }, index) => <div className="pipeline-piece" key={label}><div className={`pipeline-node ${index === 3 ? "featured" : ""}`}><span><Icon size={17}/></span><strong>{label}</strong><small>{detail}</small></div>{index < steps.length - 1 ? <div className="pipeline-edge"><i/><i/><i/></div> : null}</div>)}</div>;
}

function ProductHome() {
  return (
    <PublicShell active="home">
      <section className="public-hero">
        <div className="public-hero-copy">
          <span className="public-pill"><Sparkles size={12}/> Private financial operating system</span>
          <h1>Votre vie financière,<br/><span>enfin connectée.</span></h1>
          <p>LFO rassemble comptes, documents, investissements, dettes, immobilier, carrière et entreprises pour construire une vérité financière unique — puis vous guider vers les décisions qui comptent.</p>
          <div className="public-hero-actions"><Link className="public-cta large" href="/login?next=/today">Explorer le cockpit <ArrowRight size={15}/></Link><Link className="public-outline" href="/method">Voir comment LFO pense</Link></div>
          <div className="public-proof"><span><ShieldCheck size={13}/> Sources traçables</span><span><Network size={13}/> Domaines interconnectés</span><span><BrainCircuit size={13}/> Décisions explicables</span></div>
        </div>
        <GlobeIllustration />
      </section>

      <section className="public-section public-story-section">
        <div className="public-section-head"><span>01 · The system</span><h2>Des données dispersées à une vérité financière.</h2><p>La valeur de LFO n'est pas d'afficher davantage de graphiques. Elle vient de la façon dont les sources se confirment, alimentent des moteurs spécialisés et deviennent une vue consolidée.</p></div>
        <PipelineIllustration />
      </section>

      <section className="public-section public-network-section">
        <div className="public-section-head"><span>02 · Connections</span><h2>Les bonnes décisions vivent entre les onglets.</h2></div>
        <div className="connection-canvas">
          <div className="connection-center"><span>YOU</span><strong>Family Office</strong><small>one financial truth</small></div>
          <div className="connection-column left"><div><BriefcaseBusiness size={15}/><strong>Career</strong><small>salary</small></div><div><Building2 size={15}/><strong>Property</strong><small>asset + debt</small></div><div><Network size={15}/><strong>Business</strong><small>ownership</small></div></div>
          <div className="connection-column right"><div><Banknote size={15}/><strong>Cash Flow</strong><small>liquidity</small></div><div><TrendingUp size={15}/><strong>Portfolio</strong><small>risk + return</small></div><div><Goal size={15}/><strong>Goals</strong><small>future choices</small></div></div>
          <svg viewBox="0 0 900 420"><path d="M200 70 C360 80 365 180 450 210"/><path d="M200 210 C330 210 350 210 450 210"/><path d="M200 350 C360 340 365 245 450 210"/><path d="M700 70 C550 80 535 180 450 210"/><path d="M700 210 C570 210 550 210 450 210"/><path d="M700 350 C550 340 535 245 450 210"/></svg>
        </div>
      </section>

      <section className="public-section">
        <div className="public-section-head"><span>03 · Capabilities</span><h2>Une interface simple. Une profondeur qui reste disponible.</h2></div>
        <div className="public-capability-grid">{CAPABILITIES.map(({icon: Icon,title,text}) => <article key={title}><span><Icon size={18}/></span><h3>{title}</h3><p>{text}</p><i>Explore <ArrowRight size={11}/></i></article>)}</div>
      </section>

      <section className="public-section public-tech-preview">
        <div className="public-section-head"><span>04 · Financial techniques</span><h2>Du bilan patrimonial à la décision.</h2><p>Les mêmes briques visuelles servent à comprendre un patrimoine personnel, une dette, un actif immobilier ou une participation privée.</p></div>
        <div className="tech-ribbon">{TECHNIQUES.slice(0,6).map(({ icon: Icon, label, title }) => <Link href="/method" key={label}><span><Icon size={16}/></span><small>{label}</small><strong>{title}</strong><div className="tech-mini-chart"><i/><i/><i/><i/><i/></div></Link>)}</div>
      </section>

      <section className="public-final-cta"><span className="public-pill"><Globe2 size={12}/> One system. Many financial lives.</span><h2>Commencez par votre réalité.<br/>LFO construit le reste autour.</h2><p>Le prototype explore une expérience guidée où la complexité financière existe dans le moteur, pas dans la charge mentale de l'utilisateur.</p><Link className="public-cta large" href="/login?next=/today">Entrer dans la preview <ArrowRight size={15}/></Link></section>
    </PublicShell>
  );
}

function PurposePage() {
  return <PublicShell active="purpose"><section className="public-inner-hero"><span className="public-pill"><Target size={12}/> Why LFO</span><h1>La finance personnelle est fragmentée.<br/><span>Votre réalité ne devrait pas l'être.</span></h1><p>Une banque connaît votre compte. Un courtier connaît vos titres. Un simulateur connaît une hypothèse. Un Family Office relie les pièces et conserve le contexte.</p><div className="fragment-illustration"><div className="fragment f1">Bank<span>cash</span></div><div className="fragment f2">Broker<span>portfolio</span></div><div className="fragment f3">Property<span>equity</span></div><div className="fragment f4">Tax<span>after-tax</span></div><div className="fragment-center"><Orbit size={18}/><strong>LFO</strong><span>connected truth</span></div></div></section><section className="public-section"><div className="public-section-head"><span>The thesis</span><h2>Un outil de patrimoine ne devrait pas vous obliger à être son intégrateur.</h2></div><div className="manifesto-grid"><article><strong>01</strong><h3>Les sources avant les formulaires</h3><p>Commencer par ce que vous possédez réellement : compte, document, contrat, échéancier, relevé.</p></article><article><strong>02</strong><h3>La vérité avant l'optimisation</h3><p>Une décision sophistiquée construite sur des données mal traduites reste une mauvaise décision.</p></article><article><strong>03</strong><h3>La profondeur sans friction</h3><p>Le moteur peut être institutionnel sans faire subir son vocabulaire à l'utilisateur.</p></article><article><strong>04</strong><h3>L'explication avant la confiance</h3><p>Chaque résultat important doit pouvoir répondre à « d'où vient ce chiffre ? ».</p></article></div></section></PublicShell>;
}

function MethodPage() {
  const ladder = ["Facts","Historical reality","Economic model","Financing","Tax","Valuation","Cash flows","Performance","Risk","Scenarios","Decision","Explainability"];
  return <PublicShell active="method"><section className="public-inner-hero method-hero"><span className="public-pill"><BrainCircuit size={12}/> Financial method</span><h1>Une méthode d'analyse,<br/><span>pas une collection de calculateurs.</span></h1><p>LFO applique une même discipline à des domaines très différents : partir des faits, reconstruire l'économie réelle, modéliser ce qui manque, puis distinguer clairement résultat, risque et décision.</p><div className="method-ladder">{ladder.map((item,index)=><div key={item} className={index===0||index===11?"edge-item":""}><span>{String(index+1).padStart(2,"0")}</span><strong>{item}</strong>{index<ladder.length-1?<i/>:null}</div>)}</div></section><section className="public-section"><div className="public-section-head"><span>Techniques</span><h2>Les briques financières deviennent visuelles.</h2></div><div className="technique-grid">{TECHNIQUES.map(({icon: Icon,label,title,text})=><article key={label}><div><span><Icon size={17}/></span><small>{label}</small></div><h3>{title}</h3><p>{text}</p><div className="technique-visual"><i/><i/><i/><i/></div></article>)}</div></section></PublicShell>;
}

function PossibilitiesPage() {
  return <PublicShell active="possibilities"><section className="public-inner-hero"><span className="public-pill"><WandSparkles size={12}/> Possibilities</span><h1>Commencez par une question.<br/><span>LFO construit le chemin.</span></h1><p>Le produit est organisé autour de l'intention de l'utilisateur, puis révèle les domaines financiers nécessaires au fur et à mesure.</p><div className="question-orbit"><div className="question-core"><strong>What do you want to do?</strong><span>guided intent layer</span></div>{["Understand","Improve","Invest","Build","Decide","Protect"].map((q,index)=><span key={q} className={`q${index+1}`}>{q}</span>)}</div></section><section className="public-section"><div className="possibility-grid">{POSSIBILITIES.map(({group,icon:Icon,items})=><article key={group}><header><span><Icon size={18}/></span><h2>{group}</h2></header>{items.map(item=><div key={item}><span>{item}</span><ArrowRight size={12}/></div>)}</article>)}</div></section></PublicShell>;
}

function AboutPage() {
  return <PublicShell active="about"><section className="public-inner-hero about-hero"><span className="public-pill"><Orbit size={12}/> About the project</span><h1>Construire un Family Office<br/><span>accessible sans l'appauvrir.</span></h1><p>LFO est un projet de système patrimonial privé : ambitieux sur la profondeur financière, obsessionnel sur la provenance des données, et volontairement simple à utiliser en surface.</p><div className="about-manifesto"><div><span>01</span><strong>Fidelity</strong><small>Respecter la réalité avant de la simplifier.</small></div><div><span>02</span><strong>Automation</strong><small>Supprimer la saisie qui peut être reconstruite.</small></div><div><span>03</span><strong>Explainability</strong><small>Rendre chaque résultat traçable.</small></div><div><span>04</span><strong>Adaptability</strong><small>S'adapter à des vies financières différentes.</small></div></div></section><section className="public-section about-copy"><div><span className="public-section-index">A private operating thesis</span><h2>Le Family Office n'est pas un niveau de richesse. C'est une manière de relier les décisions.</h2></div><p>Une même personne peut être salariée, investisseur, emprunteur, propriétaire, entrepreneur et contribuable. Le projet LFO cherche à faire circuler l'information entre ces rôles plutôt qu'à les enfermer dans des outils distincts.</p></section></PublicShell>;
}

function PricingPage() {
  const plans = [
    { name:"Foundation", tag:"Build the truth", price:"0 €", note:"prototype", accent:"cyan", features:["Consolidated wealth","Core sources","Cash Flow","Basic investments","Guided home"] },
    { name:"Intelligence", tag:"Understand & decide", price:"19 €", note:"illustrative / month", accent:"blue", popular:true, features:["Everything in Foundation","Advanced analytics","Decision Lab","Deep scenarios","Automation inbox","Explainability"] },
    { name:"Private Office", tag:"Complex wealth", price:"49 €", note:"illustrative / month", accent:"violet", features:["Everything in Intelligence","Multi-entity","Business analytics","Advanced real estate","Institutional exports","Priority modelling"] },
  ];
  return <PublicShell active="pricing"><section className="public-inner-hero pricing-hero"><span className="public-pill"><BadgeEuro size={12}/> Pricing concept</span><h1>La profondeur augmente avec vos besoins.<br/><span>Pas avec la complexité de l'interface.</span></h1><p>Cette page est un prototype de packaging visuel. Les prix et périmètres ne constituent pas une offre commerciale finalisée.</p></section><section className="public-section pricing-section"><div className="pricing-grid">{plans.map(plan=><article key={plan.name} className={`pricing-card pricing-${plan.accent} ${plan.popular?"popular":""}`}>{plan.popular?<span className="popular-badge">Most complete preview</span>:null}<span className="plan-tag">{plan.tag}</span><h2>{plan.name}</h2><div className="plan-price"><strong>{plan.price}</strong><small>{plan.note}</small></div><div className="plan-capability-map"><i/><i/><i/><i/><i/></div>{plan.features.map(feature=><div className="plan-feature" key={feature}><Check size={13}/><span>{feature}</span></div>)}<button>Visual concept <ArrowRight size={12}/></button></article>)}</div><div className="pricing-compare"><span>Capability map</span><div><small>Sources</small><i className="full"/><i className="full"/><i className="full"/></div><div><small>Automation</small><i/><i className="full"/><i className="full"/></div><div><small>Modelling</small><i/><i className="full"/><i className="full"/></div><div><small>Entities</small><i/><i/><i className="full"/></div></div></section></PublicShell>;
}

export function PublicV4Page({ kind }: { kind: PublicKind }) {
  if (kind === "purpose") return <PurposePage/>;
  if (kind === "method") return <MethodPage/>;
  if (kind === "possibilities") return <PossibilitiesPage/>;
  if (kind === "about") return <AboutPage/>;
  if (kind === "pricing") return <PricingPage/>;
  return <ProductHome/>;
}

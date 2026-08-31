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
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Target,
  TrendingUp,
  WalletCards,
  WandSparkles,
  Zap,
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
  { icon: WalletCards, title: "Comprendre", text: "Patrimoine, liquidité, dette, cash et expositions réunis dans une même lecture économique." },
  { icon: FileCheck2, title: "Réconcilier", text: "Les sources se confirment entre elles avant qu’un chiffre devienne une vérité exploitable." },
  { icon: Activity, title: "Expliquer", text: "Chaque résultat important peut remonter vers sa source, sa transformation et son niveau de confiance." },
  { icon: BrainCircuit, title: "Décider", text: "Scénarios, sensibilités et objectifs transforment la donnée en arbitrages compréhensibles." },
] as const;

const TECHNIQUES = [
  { icon: WalletCards, label: "Balance Sheet", title: "Patrimoine & liquidité", text: "Distinguer valeur, solvabilité, concentration et cash mobilisable.", visual: "bridge" },
  { icon: CircleDollarSign, label: "Cash Flow", title: "Liberté financière", text: "Relier revenus, charges fixes, flexibilité, dette et capacité d’épargne.", visual: "bars" },
  { icon: PieChart, label: "Portfolio", title: "Allocation & risque", text: "Lire rendement, volatilité, corrélation, liquidité, enveloppe et horizon.", visual: "donut" },
  { icon: Landmark, label: "Debt", title: "Structure de dette", text: "Séparer principal, intérêts, assurance, maturité et sorties de cash.", visual: "schedule" },
  { icon: Building2, label: "Real Estate", title: "Économie complète", text: "Coût complet, financement, NOI, equity, fiscalité, création de valeur et sortie.", visual: "waterfall" },
  { icon: BriefcaseBusiness, label: "Business", title: "Cash & valorisation", text: "EBITDA normalisé, BFR, capex, cash conversion et EV → Equity.", visual: "bridge" },
  { icon: BadgeEuro, label: "Tax", title: "Avant / après impôt", text: "Séparer résultat économique, assiette fiscale, règle applicable et cash net.", visual: "bars" },
  { icon: WandSparkles, label: "Scenario", title: "Décision sous incertitude", text: "Comparer trajectoires, hypothèses, sensibilités et conséquences.", visual: "fan" },
] as const;

const POSSIBILITIES = [
  { group: "Understand", icon: Gauge, summary: "Construire une vue fiable avant d’optimiser.", items: ["Où est mon patrimoine ?", "Qu’est-ce qui est réellement liquide ?", "Pourquoi ma situation a changé ?", "Quels risques sont concentrés ?"] },
  { group: "Improve", icon: TrendingUp, summary: "Identifier les leviers réellement actionnables.", items: ["Améliorer mon taux d’épargne", "Construire un fonds de sécurité", "Réduire une dette", "Rééquilibrer mes expositions"] },
  { group: "Build", icon: Blocks, summary: "Modéliser un projet comme un dossier financier.", items: ["Préparer un achat immobilier", "Analyser une entreprise", "Structurer un projet", "Suivre plusieurs entités"] },
  { group: "Decide", icon: GitBranch, summary: "Comparer les conséquences, pas seulement les rendements.", items: ["Acheter ou attendre", "Rembourser ou investir", "Changer de carrière", "Vendre, conserver ou refinancer"] },
] as const;

const PERSONAS = [
  { icon: BriefcaseBusiness, title: "Early career", text: "Salaire, épargne, dette étudiante, premiers investissements." },
  { icon: TrendingUp, title: "Investor", text: "PEA, CTO, assurance-vie, risque, fiscalité et objectifs." },
  { icon: Building2, title: "Property owner", text: "Acquisition, dette, travaux, exploitation, equity et sortie." },
  { icon: Network, title: "Entrepreneur", text: "Société, rémunération, dividendes, valeur et projets." },
  { icon: WalletCards, title: "Multi-asset", text: "Cash, marchés, immobilier, privé et plusieurs horizons." },
  { icon: Goal, title: "Family planning", text: "Objectifs, protection, transmission et décisions de long terme." },
] as const;

function Brand() {
  return <Link className="public-brand" href="/"><span>LF</span><div><strong>Léo</strong><small>Family Office</small></div></Link>;
}

function PublicShell({ children, active }: { children: React.ReactNode; active: PublicKind }) {
  return (
    <main className={`public-v4 public-v6 public-${active}`}>
      <div className="public-noise" />
      <div className="v6-public-grid" aria-hidden="true" />
      <header className="public-header v6-public-header">
        <Brand />
        <nav>{PUBLIC_NAV.map(([label, href]) => <Link key={href} className={(active === "home" && href === "/") || href.includes(active) ? "active" : ""} href={href}>{label}</Link>)}</nav>
        <div className="public-header-actions"><span className="v6-public-status"><ShieldCheck size={11}/> Private by design</span><Link className="public-text-link" href="/login">Connexion</Link><Link className="public-cta" href="/login?next=/today">Entrer dans LFO <ArrowRight size={14}/></Link></div>
      </header>
      {children}
      <footer className="public-footer v6-public-footer">
        <Brand />
        <div><Link href="/purpose">Pourquoi</Link><Link href="/method">Méthode</Link><Link href="/possibilities">Possibilités</Link><Link href="/pricing">Pricing</Link></div>
        <span>Prototype expérimental · contenu, données et pricing illustratifs</span>
      </footer>
    </main>
  );
}

function GlobeIllustration() {
  const nodes = [
    ["Bank", "node-bank", Banknote, "cash & transactions"],
    ["Career", "node-career", BriefcaseBusiness, "income & contract"],
    ["Broker", "node-broker", TrendingUp, "portfolio & cash"],
    ["Property", "node-property", Building2, "asset & financing"],
    ["Company", "node-company", Network, "ownership & value"],
    ["Tax", "node-tax", BadgeEuro, "rules & after-tax"],
  ] as const;
  return (
    <div className="public-globe-stage v6-globe-stage">
      <div className="v6-globe-stars" />
      <div className="public-orbit orbit-one"/><div className="public-orbit orbit-two"/><div className="v6-public-orbit orbit-three"/>
      <div className="public-globe v6-public-globe">
        <span className="mesh mesh-a"/><span className="mesh mesh-b"/><span className="mesh mesh-c"/>
        <span className="v6-globe-land land-a"/><span className="v6-globe-land land-b"/>
        <div className="public-globe-core"><Orbit size={18}/><strong>LFO</strong><small>financial truth</small></div>
      </div>
      <svg className="public-globe-arcs v6-globe-arcs" viewBox="0 0 700 560" aria-hidden="true">
        <defs><linearGradient id="v6Arc" x1="0" x2="1"><stop offset="0" stopColor="#55dcff" stopOpacity=".12"/><stop offset=".5" stopColor="#6d8cff" stopOpacity=".88"/><stop offset="1" stopColor="#f27bc7" stopOpacity=".1"/></linearGradient></defs>
        <path d="M350 280 C220 140 150 160 90 120"/><path d="M350 280 C470 120 540 130 610 100"/><path d="M350 280 C560 230 600 260 660 280"/><path d="M350 280 C500 410 560 400 620 450"/><path d="M350 280 C220 430 160 405 100 460"/><path d="M350 280 C190 280 130 290 55 285"/>
      </svg>
      {nodes.map(([label, klass, Icon, detail]) => <div className={`public-globe-node v6-globe-node ${klass}`} key={label}><span><Icon size={14}/></span><div><strong>{label}</strong><small>{detail}</small></div></div>)}
      <div className="public-floating-card card-a v6-floating-card"><span>Source coverage</span><strong>8 connected</strong><i>3 authoritative · 2 to review</i></div>
      <div className="public-floating-card card-b v6-floating-card"><span>Decision layer</span><strong>3 paths ready</strong><i>facts separated from assumptions</i></div>
      <div className="v6-globe-caption"><span className="v6-pulse"/> Sources → engines → decisions</div>
    </div>
  );
}

function PipelineIllustration() {
  const steps = [
    { icon: Database, label: "Sources", detail: "Accounts · docs · APIs", meta: "Observed inputs" },
    { icon: FileCheck2, label: "Reconcile", detail: "Match · verify · flag", meta: "Confidence" },
    { icon: Activity, label: "Engines", detail: "Cash · debt · tax · value", meta: "Canonical logic" },
    { icon: WalletCards, label: "Truth", detail: "Consolidated wealth", meta: "One balance sheet" },
    { icon: BrainCircuit, label: "Decide", detail: "Goals · scenarios · actions", meta: "Explainable trade-offs" },
  ];
  return <div className="public-pipeline v6-public-pipeline">{steps.map(({ icon: Icon, label, detail, meta }, index) => <div className="pipeline-piece" key={label}><div className={`pipeline-node ${index === 3 ? "featured" : ""}`}><span className="v6-step-index">0{index + 1}</span><span className="v6-pipeline-icon"><Icon size={17}/></span><strong>{label}</strong><small>{detail}</small><em>{meta}</em></div>{index < steps.length - 1 ? <div className="pipeline-edge"><i/><i/><i/></div> : null}</div>)}</div>;
}

function OperatingSystemDemo() {
  return (
    <div className="v6-os-demo">
      <div className="v6-os-sidebar">
        <div className="v6-os-brand">LF</div>
        {[WalletCards, CircleDollarSign, TrendingUp, Building2, GitBranch].map((Icon, index) => <span key={index} className={index === 0 ? "active" : ""}><Icon size={14}/></span>)}
      </div>
      <div className="v6-os-main">
        <header><div><small>Family Office command center</small><strong>Financial truth</strong></div><span><RefreshCw size={11}/> updated now</span></header>
        <div className="v6-os-kpis">
          <article><small>Net worth</small><strong>€286.4k</strong><em>+8.4% YTD</em></article>
          <article><small>Liquidity</small><strong>€31.2k</strong><em>8.1 months</em></article>
          <article><small>Monthly freedom</small><strong>€1.4k</strong><em>after fixed costs</em></article>
          <article><small>Debt</small><strong>€162.7k</strong><em>3 contracts</em></article>
        </div>
        <div className="v6-os-grid">
          <article className="v6-os-chart-card">
            <div className="v6-os-card-head"><div><small>Wealth trajectory</small><strong>Observed + projected</strong></div><span>1Y&nbsp;&nbsp;5Y&nbsp;&nbsp;<b>MAX</b></span></div>
            <svg viewBox="0 0 680 220" preserveAspectRatio="none" aria-label="Illustrative wealth trajectory">
              <defs><linearGradient id="v6Area" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#55dcff" stopOpacity=".32"/><stop offset="1" stopColor="#55dcff" stopOpacity="0"/></linearGradient></defs>
              <path className="grid" d="M0 50H680M0 100H680M0 150H680M0 200H680"/>
              <path className="area" d="M0 190 C80 180 105 168 150 172 S240 145 290 150 S370 115 420 126 S520 92 560 78 S630 60 680 42 L680 220 L0 220Z"/>
              <path className="actual" d="M0 190 C80 180 105 168 150 172 S240 145 290 150 S370 115 420 126 S520 92 560 78 S630 60 680 42"/>
              <path className="projected" d="M420 126 C500 112 575 75 680 42"/>
              <circle cx="420" cy="126" r="5"/><line x1="420" y1="20" x2="420" y2="210"/>
            </svg>
            <div className="v6-os-legend"><span><i className="actual"/>Observed</span><span><i className="projected"/>Projected</span><span><i className="event"/>Major event</span></div>
          </article>
          <article className="v6-os-flow-card">
            <div className="v6-os-card-head"><div><small>Monthly freedom</small><strong>Cash allocation</strong></div><span>€5.1k inflow</span></div>
            <div className="v6-flow-bars">
              <div><span>Income</span><i style={{width:"100%"}}/><strong>€5.1k</strong></div>
              <div><span>Fixed costs</span><i style={{width:"54%"}}/><strong>€2.7k</strong></div>
              <div><span>Debt</span><i style={{width:"19%"}}/><strong>€1.0k</strong></div>
              <div><span>Free</span><i style={{width:"27%"}}/><strong>€1.4k</strong></div>
            </div>
            <div className="v6-flow-foot"><span>Income</span><ArrowRight size={10}/><span>Costs</span><ArrowRight size={10}/><span>Debt</span><ArrowRight size={10}/><b>Savings</b></div>
          </article>
        </div>
      </div>
    </div>
  );
}

function ConnectionCanvas() {
  const left = [[BriefcaseBusiness,"Career","salary → bank"],[Building2,"Property","asset ↔ debt"],[Network,"Business","value → equity"]] as const;
  const right = [[Banknote,"Cash Flow","liquidity"],[TrendingUp,"Portfolio","risk + return"],[Goal,"Goals","future choices"]] as const;
  return (
    <div className="connection-canvas v6-connection-canvas">
      <div className="v6-connection-label top">Cross-domain reconciliation</div>
      <div className="connection-center"><span>YOU</span><strong>Family Office</strong><small>one financial truth</small><i/></div>
      <div className="connection-column left">{left.map(([Icon,title,detail])=><div key={title}><Icon size={15}/><span><strong>{title}</strong><small>{detail}</small></span></div>)}</div>
      <div className="connection-column right">{right.map(([Icon,title,detail])=><div key={title}><Icon size={15}/><span><strong>{title}</strong><small>{detail}</small></span></div>)}</div>
      <svg viewBox="0 0 900 420" aria-hidden="true"><defs><linearGradient id="v6Network" x1="0" x2="1"><stop offset="0" stopColor="#55dcff"/><stop offset=".5" stopColor="#5d8cff"/><stop offset="1" stopColor="#a879ff"/></linearGradient></defs><path d="M200 70 C360 80 365 180 450 210"/><path d="M200 210 C330 210 350 210 450 210"/><path d="M200 350 C360 340 365 245 450 210"/><path d="M700 70 C550 80 535 180 450 210"/><path d="M700 210 C570 210 550 210 450 210"/><path d="M700 350 C550 340 535 245 450 210"/></svg>
      <div className="v6-connection-note n1"><small>Salary July</small><strong>matched</strong></div>
      <div className="v6-connection-note n2"><small>Loan payment</small><strong>contractual</strong></div>
      <div className="v6-connection-note n3"><small>Portfolio event</small><strong>tax-linked</strong></div>
    </div>
  );
}

function TechniqueVisual({ type }: { type: string }) {
  if (type === "donut") return <div className="v6-tech-donut"><i/><i/><i/><span/></div>;
  if (type === "schedule") return <div className="v6-tech-schedule"><span/><span/><span/><span/><span/></div>;
  if (type === "fan") return <div className="v6-tech-fan"><i/><i/><i/></div>;
  if (type === "waterfall") return <div className="v6-tech-waterfall"><i/><i/><i/><i/><i/></div>;
  if (type === "bars") return <div className="v6-tech-bars"><i/><i/><i/><i/><i/></div>;
  return <div className="v6-tech-bridge"><span/><i/><span/><i/><span/></div>;
}

function TrustStack() {
  return (
    <div className="v6-trust-stack">
      <article><span className="actual">ACTUAL</span><strong>Observed fact</strong><p>Bank transaction, broker event, contract or verified document.</p><small>May feed canonical truth</small></article>
      <article><span className="assumption">ASSUMPTION</span><strong>User or model hypothesis</strong><p>Useful for scenarios, never silently promoted to observed reality.</p><small>Kept separate</small></article>
      <article><span className="projected">PROJECTED</span><strong>Future trajectory</strong><p>Derived from explicit assumptions and a known starting position.</p><small>Explainable lineage</small></article>
    </div>
  );
}

function ProductHome() {
  return (
    <PublicShell active="home">
      <section className="public-hero v6-public-hero">
        <div className="public-hero-copy">
          <span className="public-pill"><Sparkles size={12}/> Private financial operating system</span>
          <h1>Votre vie financière,<br/><span>enfin connectée.</span></h1>
          <p>LFO vise à reconstruire une réalité financière unique à partir de comptes, documents et événements, puis à relier patrimoine, liquidité, investissements, dette, immobilier, carrière, entreprise, fiscalité et objectifs.</p>
          <div className="public-hero-actions"><Link className="public-cta large" href="/login?next=/today">Explorer le cockpit <ArrowRight size={15}/></Link><Link className="public-outline" href="/method">Voir la méthode</Link></div>
          <div className="public-proof"><span><ShieldCheck size={13}/> Sources traçables</span><span><Network size={13}/> Domaines interconnectés</span><span><BrainCircuit size={13}/> Décisions explicables</span></div>
          <div className="v6-hero-metrics"><div><strong>01</strong><span>Truth first</span></div><div><strong>02</strong><span>Automation second</span></div><div><strong>03</strong><span>Decision last</span></div></div>
        </div>
        <GlobeIllustration />
      </section>

      <section className="public-section public-story-section v6-story-section">
        <div className="public-section-head v6-public-section-head"><span>01 · Operating architecture</span><h2>Un système financier, pas un agrégateur de cartes.</h2><p>LFO sépare acquisition des données, réconciliation, moteurs canoniques, consolidation et décision. Cela permet d’aller très loin dans l’analyse sans demander à l’utilisateur de traduire lui-même ses documents en paramètres techniques.</p></div>
        <PipelineIllustration />
      </section>

      <section className="public-section v6-demo-section">
        <div className="public-section-head v6-public-section-head"><span>02 · Product experience</span><h2>Voir l’ensemble. Puis descendre jusqu’au calcul.</h2><p>Le cockpit privilégie une lecture exécutive au premier niveau, puis laisse ouvrir les sources, formules, hypothèses, échéanciers et détails quand ils deviennent utiles.</p></div>
        <OperatingSystemDemo />
      </section>

      <section className="public-section public-network-section v6-network-section">
        <div className="public-section-head v6-public-section-head"><span>03 · Cross-domain intelligence</span><h2>Les décisions importantes vivent entre les moteurs.</h2><p>Un salaire devient du cash, une dette devient une obligation de cash-flow, un actif immobilier porte une dette et une fiscalité, une participation privée crée une valeur patrimoniale sans doubler ses actifs sous-jacents.</p></div>
        <ConnectionCanvas />
      </section>

      <section className="public-section v6-tech-section">
        <div className="public-section-head v6-public-section-head"><span>04 · Financial instruments</span><h2>Les techniques financières deviennent lisibles.</h2><p>Chaque moteur dispose de son propre langage visuel. L’objectif est de pouvoir comprendre en quelques secondes, puis d’ouvrir la profondeur institutionnelle si nécessaire.</p></div>
        <div className="v6-technique-showcase">{TECHNIQUES.map(({ icon: Icon, label, title, text, visual }) => <article key={label}><header><span><Icon size={17}/></span><div><small>{label}</small><strong>{title}</strong></div></header><TechniqueVisual type={visual}/><p>{text}</p><Link href="/method">Voir la méthode <ArrowRight size={11}/></Link></article>)}</div>
      </section>

      <section className="public-section v6-adapt-section">
        <div className="public-section-head v6-public-section-head"><span>05 · Adaptability</span><h2>Une architecture capable de suivre des vies financières très différentes.</h2><p>Le produit ne doit pas être construit autour d’un profil unique. Les domaines apparaissent, se connectent et se densifient selon la réalité de chaque utilisateur.</p></div>
        <div className="v6-persona-grid">{PERSONAS.map(({icon:Icon,title,text},index)=><article key={title}><span className="v6-persona-index">0{index+1}</span><Icon size={18}/><strong>{title}</strong><p>{text}</p><div><i/><i/><i/></div></article>)}</div>
      </section>

      <section className="public-section v6-trust-section">
        <div className="public-section-head v6-public-section-head"><span>06 · Financial trust</span><h2>Ce que LFO sait ne doit jamais se confondre avec ce qu’il suppose.</h2><p>La confiance vient de la provenance. Un système sérieux doit rendre évidente la différence entre observation, hypothèse, estimation et projection.</p></div>
        <TrustStack />
      </section>

      <section className="public-final-cta v6-final-cta"><span className="public-pill"><Globe2 size={12}/> One system. Many financial lives.</span><h2>Commencez par votre réalité.<br/>LFO construit le contexte autour.</h2><p>Cette preview explore une expérience où la profondeur financière existe dans l’architecture et les moteurs, pas dans la charge mentale de l’utilisateur.</p><div><Link className="public-cta large" href="/login?next=/today">Entrer dans la preview <ArrowRight size={15}/></Link><Link className="public-outline" href="/possibilities">Explorer les possibilités</Link></div></section>
    </PublicShell>
  );
}

function PurposePage() {
  return (
    <PublicShell active="purpose">
      <section className="public-inner-hero v6-inner-hero">
        <span className="public-pill"><Target size={12}/> Why LFO</span>
        <h1>La finance personnelle est fragmentée.<br/><span>Votre réalité ne devrait pas l’être.</span></h1>
        <p>Une banque voit un compte. Un courtier voit un portefeuille. Un assureur voit un contrat. Un outil immobilier voit un bien. Une déclaration fiscale voit une assiette. Le Family Office relie les pièces et conserve le contexte.</p>
        <div className="fragment-illustration v6-fragment-illustration"><div className="fragment f1">Bank<span>cash</span></div><div className="fragment f2">Broker<span>portfolio</span></div><div className="fragment f3">Property<span>equity</span></div><div className="fragment f4">Tax<span>after-tax</span></div><div className="fragment-center"><Orbit size={18}/><strong>LFO</strong><span>connected truth</span></div><svg viewBox="0 0 720 400"><path d="M120 70C260 90 280 180 360 200"/><path d="M600 70C470 90 450 180 360 200"/><path d="M120 330C260 310 280 225 360 200"/><path d="M600 330C470 310 450 225 360 200"/></svg></div>
      </section>
      <section className="public-section">
        <div className="public-section-head v6-public-section-head"><span>Product thesis</span><h2>Le rôle du logiciel n’est pas de vous transformer en analyste.</h2><p>Il doit reconstruire ce qui peut l’être, signaler ce qui ne peut pas l’être, puis vous guider vers le minimum de jugement humain réellement nécessaire.</p></div>
        <div className="manifesto-grid v6-manifesto-grid"><article><strong>01</strong><h3>Sources avant formulaires</h3><p>Commencer par les documents, comptes et contrats que les particuliers possèdent réellement.</p></article><article><strong>02</strong><h3>Truth before optimization</h3><p>Une décision sophistiquée construite sur une mauvaise traduction des données reste une mauvaise décision.</p></article><article><strong>03</strong><h3>Progressive disclosure</h3><p>Le niveau exécutif reste simple ; les calculs, hypothèses et détails apparaissent à la demande.</p></article><article><strong>04</strong><h3>Explainability by design</h3><p>Un chiffre important doit pouvoir répondre à « d’où vient-il ? », « qu’est-ce qui l’a changé ? » et « que manque-t-il ? ».</p></article></div>
      </section>
      <section className="public-section v6-before-after-section"><div className="public-section-head v6-public-section-head"><span>From dashboard to operating system</span><h2>Changer le chemin de l’utilisateur.</h2></div><div className="v6-before-after"><article><span>Legacy financial app</span><strong>Form → KPI → another form</strong><div><i/>Manual translation</div><div><i/>Disconnected modules</div><div><i/>Opaque assumptions</div></article><ArrowRight size={24}/><article className="target"><span>LFO target</span><strong>Source → truth → decision</strong><div><i/>Reconciliation first</div><div><i/>Cross-domain context</div><div><i/>Traceable assumptions</div></article></div></section>
      <section className="public-section v6-trust-section"><div className="public-section-head v6-public-section-head"><span>Trust architecture</span><h2>La rigueur est une fonctionnalité produit.</h2></div><TrustStack /></section>
    </PublicShell>
  );
}

function MethodPage() {
  const ladder = ["Facts","Historical reality","Economic model","Financing","Tax","Valuation","Cash flows","Performance","Risk","Scenarios","Decision","Explainability"];
  return (
    <PublicShell active="method">
      <section className="public-inner-hero method-hero v6-inner-hero"><span className="public-pill"><BrainCircuit size={12}/> Financial method</span><h1>Une méthode d’analyse,<br/><span>pas une collection de calculateurs.</span></h1><p>LFO applique une même discipline à des domaines très différents : partir des faits, reconstruire l’économie réelle, modéliser ce qui manque, mesurer les risques, puis comparer les décisions.</p><div className="method-ladder v6-method-ladder">{ladder.map((item,index)=><div key={item} className={index===0||index===11?"edge-item":""}><span>{String(index+1).padStart(2,"0")}</span><strong>{item}</strong>{index<ladder.length-1?<i/>:null}</div>)}</div></section>
      <section className="public-section"><div className="public-section-head v6-public-section-head"><span>Analytical instruments</span><h2>Chaque question financière appelle une visualisation différente.</h2><p>La cohérence du système vient des mêmes règles de provenance et de navigation — pas d’un template de dashboard répété sur tous les moteurs.</p></div><div className="v6-technique-showcase large">{TECHNIQUES.map(({icon:Icon,label,title,text,visual})=><article key={label}><header><span><Icon size={17}/></span><div><small>{label}</small><strong>{title}</strong></div></header><TechniqueVisual type={visual}/><p>{text}</p><div className="v6-tech-meta"><span>Facts</span><ArrowRight size={9}/><span>Model</span><ArrowRight size={9}/><span>Decision</span></div></article>)}</div></section>
      <section className="public-section v6-method-principles"><div className="public-section-head v6-public-section-head"><span>Operating rules</span><h2>La même rigueur doit survivre à tous les moteurs.</h2></div><div className="v6-rule-grid"><article><strong>NULL ≠ ZERO</strong><p>Une donnée inconnue ne devient jamais silencieusement nulle.</p></article><article><strong>ACTUAL ≠ ASSUMPTION</strong><p>Observation, hypothèse et projection vivent dans des états différents.</p></article><article><strong>CASH FLOW ≠ ECONOMIC COST</strong><p>Un paiement, une charge et un remboursement de principal ne racontent pas la même chose.</p></article><article><strong>VALUATION ≠ CASH</strong><p>La richesse sur le papier n’est ni la liquidité ni une preuve de valeur réalisable.</p></article></div></section>
    </PublicShell>
  );
}

function PossibilitiesPage() {
  return (
    <PublicShell active="possibilities">
      <section className="public-inner-hero v6-inner-hero"><span className="public-pill"><WandSparkles size={12}/> Possibilities</span><h1>Commencez par une question.<br/><span>LFO construit le chemin.</span></h1><p>Le produit doit organiser la navigation autour de l’intention, puis révéler les domaines financiers nécessaires au fur et à mesure — plutôt que demander à l’utilisateur de connaître l’architecture interne.</p><div className="question-orbit v6-question-orbit"><div className="question-core"><strong>What do you want to do?</strong><span>guided intent layer</span></div>{["Understand","Improve","Invest","Build","Decide","Protect"].map((q,index)=><span key={q} className={`q${index+1}`}>{q}</span>)}</div></section>
      <section className="public-section"><div className="public-section-head v6-public-section-head"><span>Intent map</span><h2>Des parcours qui traversent les moteurs.</h2></div><div className="possibility-grid v6-possibility-grid">{POSSIBILITIES.map(({group,icon:Icon,summary,items})=><article key={group}><header><span><Icon size={18}/></span><div><h2>{group}</h2><p>{summary}</p></div></header>{items.map((item,index)=><div key={item}><small>0{index+1}</small><span>{item}</span><ArrowRight size={12}/></div>)}</article>)}</div></section>
      <section className="public-section v6-journey-section"><div className="public-section-head v6-public-section-head"><span>Example journey</span><h2>Préparer un achat immobilier sans ouvrir six outils.</h2></div><div className="v6-journey"><div><Banknote size={17}/><strong>Cash</strong><small>apport + sécurité</small></div><ArrowRight size={13}/><div><Landmark size={17}/><strong>Debt</strong><small>capacité + coût</small></div><ArrowRight size={13}/><div><Building2 size={17}/><strong>Property</strong><small>coût + exploitation</small></div><ArrowRight size={13}/><div><BadgeEuro size={17}/><strong>Tax</strong><small>après impôt</small></div><ArrowRight size={13}/><div className="active"><GitBranch size={17}/><strong>Decision</strong><small>buy / wait / change</small></div></div></section>
    </PublicShell>
  );
}

function AboutPage() {
  return (
    <PublicShell active="about">
      <section className="public-inner-hero about-hero v6-inner-hero"><span className="public-pill"><Orbit size={12}/> About the project</span><h1>Construire un Family Office<br/><span>accessible sans l’appauvrir.</span></h1><p>LFO est un projet expérimental de système patrimonial privé : ambitieux sur la profondeur financière, rigoureux sur la provenance des données et volontairement simple à utiliser en surface.</p><div className="about-manifesto v6-about-manifesto"><div><span>01</span><strong>Fidelity</strong><small>Respecter la réalité avant de la simplifier.</small></div><div><span>02</span><strong>Automation</strong><small>Supprimer la saisie qui peut être reconstruite.</small></div><div><span>03</span><strong>Explainability</strong><small>Rendre chaque résultat traçable.</small></div><div><span>04</span><strong>Adaptability</strong><small>S’adapter à des vies financières différentes.</small></div></div></section>
      <section className="public-section about-copy v6-about-copy"><div><span className="public-section-index">A private operating thesis</span><h2>Le Family Office n’est pas un niveau de richesse. C’est une discipline de connexion.</h2></div><p>Une même personne peut être salariée, investisseur, emprunteur, propriétaire, entrepreneur et contribuable. LFO cherche à faire circuler l’information entre ces rôles au lieu de les enfermer dans des outils distincts.</p></section>
      <section className="public-section v6-architecture-section"><div className="public-section-head v6-public-section-head"><span>Architecture promise</span><h2>Une seule vérité, plusieurs vues.</h2><p>Balance Sheet, Cash Flow, Debt, Portfolio, Real Estate, Business Equity et Tax restent des moteurs spécialisés, mais partagent provenance, dates, devises, entités et événements.</p></div><div className="v6-architecture-map"><div className="center"><Orbit size={20}/><strong>Canonical financial truth</strong><small>facts · provenance · time</small></div>{[[WalletCards,"Balance Sheet"],[CircleDollarSign,"Cash Flow"],[Landmark,"Debt"],[TrendingUp,"Portfolio"],[Building2,"Real Estate"],[Network,"Business"],[BadgeEuro,"Tax"]].map(([Icon,label],index)=><div className={`a${index+1}`} key={label as string}><Icon size={15}/><span>{label as string}</span></div>)}</div></section>
    </PublicShell>
  );
}

function PricingPage() {
  const plans = [
    { name:"Foundation", tag:"Build the truth", price:"0 €", note:"prototype", accent:"cyan", features:["Consolidated wealth","Core sources","Cash Flow","Basic investments","Guided home"] },
    { name:"Intelligence", tag:"Understand & decide", price:"19 €", note:"illustrative / month", accent:"blue", popular:true, features:["Everything in Foundation","Advanced analytics","Decision Lab","Deep scenarios","Automation inbox","Explainability"] },
    { name:"Private Office", tag:"Complex wealth", price:"49 €", note:"illustrative / month", accent:"violet", features:["Everything in Intelligence","Multi-entity","Business analytics","Advanced real estate","Institutional exports","Priority modelling"] },
  ];
  const rows = [
    ["Source connections", "Core", "Extended", "Extended"],
    ["Automation & reconciliation", "Basic", "Advanced", "Advanced"],
    ["Scenario modelling", "—", "Full", "Full"],
    ["Business & complex entities", "—", "Limited", "Advanced"],
    ["Institutional exports", "—", "Standard", "Advanced"],
  ];
  return (
    <PublicShell active="pricing">
      <section className="public-inner-hero pricing-hero v6-inner-hero"><span className="public-pill"><BadgeEuro size={12}/> Pricing concept</span><h1>La profondeur augmente avec vos besoins.<br/><span>Pas avec la complexité de l’interface.</span></h1><p>Cette page est un prototype de packaging visuel. Les prix et périmètres ci-dessous ne constituent pas une offre commerciale finalisée.</p></section>
      <section className="public-section pricing-section v6-pricing-section"><div className="pricing-grid v6-pricing-grid">{plans.map(plan=><article key={plan.name} className={`pricing-card pricing-${plan.accent} ${plan.popular?"popular":""}`}>{plan.popular?<span className="popular-badge">Most complete preview</span>:null}<span className="plan-tag">{plan.tag}</span><h2>{plan.name}</h2><div className="plan-price"><strong>{plan.price}</strong><small>{plan.note}</small></div><div className="plan-capability-map"><i/><i/><i/><i/><i/></div>{plan.features.map(feature=><div className="plan-feature" key={feature}><Check size={13}/><span>{feature}</span></div>)}<button>Visual concept <ArrowRight size={12}/></button></article>)}</div>
        <div className="v6-pricing-matrix"><header><span>Capability</span><strong>Foundation</strong><strong>Intelligence</strong><strong>Private Office</strong></header>{rows.map(([name,a,b,c])=><div key={name}><span>{name}</span><em>{a}</em><em>{b}</em><em>{c}</em></div>)}</div>
        <div className="v6-pricing-note"><ShieldCheck size={14}/><div><strong>Packaging principle</strong><p>Les niveaux doivent différencier la profondeur, l’automatisation et la complexité des patrimoines — jamais rendre l’interface artificiellement difficile pour pousser un plan supérieur.</p></div></div>
      </section>
    </PublicShell>
  );
}

export function PublicV4Page({ kind }: { kind: PublicKind }) {
  if (kind === "purpose") return <PurposePage/>;
  if (kind === "method") return <MethodPage/>;
  if (kind === "possibilities") return <PossibilitiesPage/>;
  if (kind === "about") return <AboutPage/>;
  if (kind === "pricing") return <PricingPage/>;
  return <ProductHome/>;
}

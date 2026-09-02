"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowRight,
  Banknote,
  BadgeEuro,
  BriefcaseBusiness,
  Building2,
  Check,
  ChevronRight,
  CircleDollarSign,
  Database,
  FileCheck2,
  FileText,
  Landmark,
  Moon,
  Network,
  Orbit,
  ReceiptText,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Sun,
  Target,
  TrendingUp,
  WalletCards,
  WandSparkles,
  type LucideIcon,
} from "lucide-react";

export type PublicV8Kind = "home" | "purpose" | "method" | "possibilities" | "about" | "pricing";

type Theme = "dark" | "light";

type UniverseNode = {
  id: string;
  label: string;
  value: string;
  detail: string;
  status: string;
  icon: LucideIcon;
  x: string;
  y: string;
  tone: string;
  links: string[];
};

const NAV: Array<{ href: string; label: string; kind: PublicV8Kind }> = [
  { href: "/", label: "Produit", kind: "home" },
  { href: "/purpose", label: "Pourquoi LFO", kind: "purpose" },
  { href: "/method", label: "Méthode", kind: "method" },
  { href: "/possibilities", label: "Possibilités", kind: "possibilities" },
  { href: "/about", label: "À propos", kind: "about" },
  { href: "/pricing", label: "Tarifs", kind: "pricing" },
];

const UNIVERSE_NODES: UniverseNode[] = [
  { id: "bank", label: "Banque", value: "31 240 €", detail: "Liquidités consolidées", status: "Synchronisé aujourd’hui", icon: Banknote, x: "5%", y: "18%", tone: "cyan", links: ["Cash Flow", "Patrimoine", "Objectifs"] },
  { id: "career", label: "Carrière", value: "5 100 €/mois", detail: "Revenu net observé", status: "2 sources rapprochées", icon: BriefcaseBusiness, x: "74%", y: "10%", tone: "blue", links: ["Banque", "Fiscalité", "Cash Flow"] },
  { id: "portfolio", label: "Investissements", value: "118 400 €", detail: "PEA, CTO et assurance-vie", status: "+8,4 % sur 12 mois", icon: TrendingUp, x: "82%", y: "45%", tone: "violet", links: ["Fiscalité", "Patrimoine", "Objectifs"] },
  { id: "property", label: "Immobilier", value: "312 000 €", detail: "Valeur estimée du bien", status: "162 700 € de dette liée", icon: Building2, x: "70%", y: "81%", tone: "teal", links: ["Dette", "Cash Flow", "Fiscalité"] },
  { id: "debt", label: "Dette", value: "162 700 €", detail: "3 contrats identifiés", status: "1 020 €/mois", icon: Landmark, x: "12%", y: "78%", tone: "coral", links: ["Immobilier", "Cash Flow", "Patrimoine"] },
  { id: "business", label: "Entreprise", value: "18 000 €", detail: "Participation privée estimée", status: "Valorisation à revoir", icon: Network, x: "2%", y: "47%", tone: "pink", links: ["Patrimoine", "Fiscalité", "Décisions"] },
];

const METHOD_STEPS = [
  { key: "facts", index: "01", title: "Faits", text: "LFO commence par ce qui existe réellement : relevés, contrats, transactions, documents et événements." },
  { key: "history", index: "02", title: "Réalité historique", text: "Les événements sont datés et replacés dans une chronologie : salaire reçu, remboursement, apport, achat, cession." },
  { key: "model", index: "03", title: "Modèle économique", text: "Les moteurs reconstruisent les flux utiles sans demander à l’utilisateur de ressaisir la réalité en paramètres techniques." },
  { key: "financing", index: "04", title: "Financement", text: "Le crédit devient un calendrier d’obligations : principal, intérêts, assurance, maturité et cash à sortir." },
  { key: "tax", index: "05", title: "Fiscalité", text: "Résultat économique, assiette fiscale, règle applicable et cash net restent distincts et explicables." },
  { key: "valuation", index: "06", title: "Valorisation", text: "Immobilier et participations privées disposent de leurs propres méthodes et hypothèses, sans doubler la valeur patrimoniale." },
  { key: "cash", index: "07", title: "Cash flows", text: "Revenus, dépenses, dette, capex et investissements se rejoignent dans une lecture de liquidité et de liberté mensuelle." },
  { key: "risk", index: "08", title: "Risque", text: "Concentration, échéances, liquidité, sensibilité et exposition sont reliées aux vrais actifs et engagements." },
  { key: "scenario", index: "09", title: "Scénarios", text: "Les hypothèses futures sont isolées des faits, puis comparées sans contaminer la vérité financière actuelle." },
  { key: "decision", index: "10", title: "Décision", text: "La conclusion affiche les conséquences, les compromis et la provenance des chiffres qui ont conduit au choix." },
];

const PATHS = [
  {
    id: "understand",
    label: "Comprendre",
    question: "Pourquoi mon patrimoine a-t-il changé ce mois-ci ?",
    answer: "+3 820 €",
    sub: "Variation nette expliquée",
    engines: ["Banque", "Investissements", "Dette"],
    icon: WalletCards,
  },
  {
    id: "improve",
    label: "Améliorer",
    question: "Comment dégager 500 € de capacité d’épargne supplémentaire ?",
    answer: "+540 €/mois",
    sub: "Après trois leviers réalistes",
    engines: ["Cash Flow", "Dette", "Objectifs"],
    icon: CircleDollarSign,
  },
  {
    id: "build",
    label: "Construire",
    question: "Puis-je acheter un appartement à 450 k€ sans fragiliser ma liquidité ?",
    answer: "Oui, sous conditions",
    sub: "Matelas de sécurité conservé : 18,6 k€",
    engines: ["Immobilier", "Dette", "Fiscalité"],
    icon: Building2,
  },
  {
    id: "decide",
    label: "Décider",
    question: "Investir 50 k€ ou réduire ma dette ?",
    answer: "Écart à 10 ans : 21 k€",
    sub: "Scénario central, fiscalité incluse",
    engines: ["Investissements", "Dette", "Scénarios"],
    icon: WandSparkles,
  },
] as const;

function Shell({ kind, theme, setTheme, children }: { kind: PublicV8Kind; theme: Theme; setTheme: (value: Theme) => void; children: ReactNode }) {
  return (
    <main className="public-v8" data-v8-theme={theme}>
      <div className="v8-grid" aria-hidden="true" />
      <header className="v8-header">
        <Link href="/" className="v8-brand"><span>LF</span><div><strong>Léo</strong><small>Family Office</small></div></Link>
        <nav>{NAV.map((item) => <Link key={item.href} className={item.kind === kind ? "active" : ""} href={item.href}>{item.label}</Link>)}</nav>
        <div className="v8-header-actions">
          <button className="v8-theme-toggle" onClick={() => setTheme(theme === "dark" ? "light" : "dark")} aria-label="Changer de thème">
            {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
          </button>
          <Link className="v8-login" href="/login">Connexion</Link>
          <Link className="v8-primary-button compact" href="/login?next=/today">Explorer LFO <ArrowRight size={15} /></Link>
        </div>
      </header>
      {children}
      <footer className="v8-footer">
        <Link href="/" className="v8-brand"><span>LF</span><div><strong>Léo</strong><small>Family Office</small></div></Link>
        <p>Prototype expérimental · exemples et tarifs illustratifs</p>
        <div><Link href="/method">Méthode</Link><Link href="/about">À propos</Link><Link href="/pricing">Tarifs</Link></div>
      </footer>
    </main>
  );
}

function SectionIntro({ index, eyebrow, title, body }: { index: string; eyebrow: string; title: string; body: string }) {
  return <div className="v8-section-intro"><span>{index} · {eyebrow}</span><h2>{title}</h2><p>{body}</p></div>;
}

function Universe() {
  const [active, setActive] = useState("property");
  const selected = UNIVERSE_NODES.find((node) => node.id === active) ?? UNIVERSE_NODES[0];
  const Icon = selected.icon;
  return (
    <div className="v8-universe-shell">
      <div className="v8-universe-canvas">
        <div className="v8-universe-stars" />
        <div className="v8-universe-ring ring-a" /><div className="v8-universe-ring ring-b" />
        <svg className="v8-universe-links" viewBox="0 0 900 560" preserveAspectRatio="none" aria-hidden="true">
          <path d="M450 280 C320 180 240 130 145 115"/><path d="M450 280 C575 165 650 120 760 105"/><path d="M450 280 C620 250 700 255 810 255"/><path d="M450 280 C610 390 670 430 760 465"/><path d="M450 280 C320 420 250 445 155 450"/><path d="M450 280 C300 280 205 280 90 280"/>
        </svg>
        <div className="v8-universe-core"><Orbit size={22}/><strong>LFO</strong><span>286 400 €</span><small>Patrimoine net consolidé</small></div>
        {UNIVERSE_NODES.map((node) => {
          const NodeIcon = node.icon;
          return <button key={node.id} type="button" onClick={() => setActive(node.id)} className={`v8-universe-node ${active === node.id ? "active" : ""}`} data-tone={node.tone} style={{ left: node.x, top: node.y }}>
            <span><NodeIcon size={17}/></span><div><strong>{node.label}</strong><b>{node.value}</b><small>{node.status}</small></div>
          </button>;
        })}
        <div className="v8-reconciliation-chip"><FileCheck2 size={14}/><span><b>Salaire août</b> rapproché avec le virement bancaire</span><em>confirmé</em></div>
      </div>
      <aside className="v8-universe-inspector" data-tone={selected.tone}>
        <div className="v8-inspector-icon"><Icon size={22}/></div>
        <span>Vue sélectionnée</span>
        <h3>{selected.label}</h3>
        <strong>{selected.value}</strong>
        <p>{selected.detail}</p>
        <div className="v8-inspector-status"><ShieldCheck size={15}/>{selected.status}</div>
        <div className="v8-inspector-links"><small>Relié à</small>{selected.links.map((link) => <span key={link}>{link}<ChevronRight size={12}/></span>)}</div>
        <button type="button">Ouvrir dans le cockpit <ArrowRight size={14}/></button>
      </aside>
    </div>
  );
}

function WealthCockpit() {
  return (
    <div className="v8-product-scene v8-wealth-scene">
      <aside className="v8-demo-sidebar"><b>LF</b><span className="active"><WalletCards size={17}/></span><span><CircleDollarSign size={17}/></span><span><TrendingUp size={17}/></span><span><Building2 size={17}/></span><span><WandSparkles size={17}/></span></aside>
      <div className="v8-demo-main">
        <header><div><small>Vue exécutive</small><h3>Votre situation aujourd’hui</h3></div><span><RefreshCw size={13}/> Mis à jour il y a 3 min</span></header>
        <div className="v8-demo-kpis">
          <article><small>Patrimoine net</small><strong>286 400 €</strong><em>+8,4 % sur 12 mois</em></article>
          <article><small>Liquidités</small><strong>31 240 €</strong><em>8,1 mois de sécurité</em></article>
          <article><small>Liberté mensuelle</small><strong>1 420 €</strong><em>après charges et dette</em></article>
          <article><small>Dette</small><strong>162 700 €</strong><em>3 contrats actifs</em></article>
        </div>
        <div className="v8-demo-grid">
          <article className="v8-demo-chart">
            <div className="v8-card-head"><div><small>Trajectoire patrimoniale</small><strong>Observé et projeté</strong></div><div><span>1 an</span><span className="active">5 ans</span><span>Max</span></div></div>
            <svg viewBox="0 0 700 280" preserveAspectRatio="none" aria-label="Trajectoire patrimoniale illustrative">
              <defs><linearGradient id="v8area" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#55dcff" stopOpacity=".28"/><stop offset="1" stopColor="#55dcff" stopOpacity="0"/></linearGradient></defs>
              <path className="grid" d="M0 55H700M0 110H700M0 165H700M0 220H700"/>
              <path className="area" d="M0 235 C70 224 110 206 150 208 S245 182 300 186 S385 150 430 158 S520 125 565 108 S645 74 700 54 L700 270 L0 270Z"/>
              <path className="actual" d="M0 235 C70 224 110 206 150 208 S245 182 300 186 S385 150 430 158"/>
              <path className="projected" d="M430 158 C520 125 565 108 700 54"/>
              <line className="today" x1="430" x2="430" y1="30" y2="252"/><circle cx="430" cy="158" r="6"/>
            </svg>
            <div className="v8-chart-legend"><span><i className="actual"/>Observé</span><span><i className="projected"/>Scénario central</span><span><i className="event"/>Aujourd’hui</span></div>
          </article>
          <article className="v8-demo-flow">
            <div className="v8-card-head"><div><small>Répartition mensuelle</small><strong>5 100 € de revenus nets</strong></div></div>
            <div className="v8-flow-row"><span>Charges fixes</span><div><i style={{width:"53%"}}/></div><strong>2 700 €</strong></div>
            <div className="v8-flow-row debt"><span>Dette</span><div><i style={{width:"20%"}}/></div><strong>1 020 €</strong></div>
            <div className="v8-flow-row free"><span>Disponible</span><div><i style={{width:"27%"}}/></div><strong>1 380 €</strong></div>
            <div className="v8-flow-note"><ShieldCheck size={14}/><span>Matelas de sécurité supérieur à 8 mois</span></div>
          </article>
        </div>
      </div>
      <span className="v8-example-badge">Exemple illustratif</span>
    </div>
  );
}

function PropertyScene() {
  return <div className="v8-product-scene compact-scene v8-property-scene">
    <div className="v8-property-summary"><span>Projet immobilier</span><h3>Appartement · Paris 19e</h3><strong>450 000 €</strong><p>Simulation d’acquisition avec travaux et conservation d’un matelas de sécurité.</p><div><b>Apport 92 k€</b><b>Dette 385 k€</b><b>Travaux 35 k€</b></div></div>
    <div className="v8-property-stack"><small>Coût complet</small><div><i className="purchase" style={{width:"74%"}}/><span>Achat · 450 k€</span></div><div><i className="fees" style={{width:"11%"}}/><span>Frais · 34 k€</span></div><div><i className="works" style={{width:"6%"}}/><span>Travaux · 35 k€</span></div><div><i className="cash" style={{width:"15%"}}/><span>Cash mobilisé · 92 k€</span></div></div>
    <div className="v8-property-outcome"><small>Après acquisition</small><strong>18 600 €</strong><span>Liquidités restantes</span><hr/><strong>1 780 €</strong><span>Mensualité estimée</span><hr/><em>Projet compatible sous scénario central</em></div>
  </div>;
}

function PortfolioScene() {
  return <div className="v8-product-scene compact-scene v8-portfolio-scene">
    <div className="v8-portfolio-chart"><div className="v8-card-head"><div><small>Portefeuille</small><strong>118 400 €</strong></div><span className="positive">+8,4 %</span></div><svg viewBox="0 0 520 220" preserveAspectRatio="none"><path className="grid" d="M0 50H520M0 100H520M0 150H520M0 200H520"/><path className="benchmark" d="M0 188 C100 170 180 160 255 145 S390 120 520 92"/><path className="portfolio" d="M0 192 C85 182 150 154 220 162 S340 128 390 116 S460 88 520 68"/></svg><div className="v8-chart-legend"><span><i className="actual"/>Portefeuille</span><span><i className="benchmark"/>Indice Monde</span></div></div>
    <div className="v8-allocation"><small>Allocation</small><div className="v8-donut"><span>63 %<small>Actions Monde</small></span></div><ul><li><i className="world"/>Actions Monde <b>63 %</b></li><li><i className="em"/>Émergents <b>12 %</b></li><li><i className="cash"/>Cash <b>15 %</b></li><li><i className="other"/>Autres <b>10 %</b></li></ul></div>
    <aside><span>Point d’attention</span><strong>Concentration géographique</strong><p>78 % de l’exposition actions dépend actuellement des États-Unis.</p><button type="button">Voir l’exposition <ArrowRight size={13}/></button></aside>
  </div>;
}

function LineageScene() {
  return <div className="v8-lineage-scene">
    <div className="v8-lineage-output"><small>Chiffre affiché dans LFO</small><strong>3 482 €</strong><span>Revenu net mensuel confirmé</span><em><ShieldCheck size={13}/> Confirmé par 2 sources</em></div>
    <div className="v8-lineage-track">
      <article><FileText size={18}/><div><small>Source 1</small><strong>Bulletin de paie · août</strong><span>Net à payer · 3 482 €</span></div><b>observé</b></article>
      <i><ArrowRight size={15}/></i>
      <article><Banknote size={18}/><div><small>Source 2</small><strong>Virement · 30/08</strong><span>3 482 € · employeur reconnu</span></div><b>observé</b></article>
      <i><ArrowRight size={15}/></i>
      <article className="resolved"><FileCheck2 size={18}/><div><small>Rapprochement</small><strong>Une même réalité</strong><span>Montant + période + employeur</span></div><b>confirmé</b></article>
    </div>
    <div className="v8-lineage-branch"><span>Hypothèse scénario</span><strong>+5 % de salaire en janvier 2027</strong><em>Projeté uniquement · ne modifie jamais la donnée observée</em></div>
  </div>;
}

function HomePage() {
  return <>
    <section className="v8-hero">
      <div className="v8-hero-copy"><span className="v8-kicker"><Sparkles size={14}/> Family Office personnel</span><h1>Toute votre vie financière.<br/><span>Une seule lecture.</span></h1><p>Vos comptes, vos contrats et vos projets racontent la même histoire. LFO rapproche les faits avant de calculer, puis montre ce qui mérite réellement votre attention.</p><div className="v8-hero-actions"><Link className="v8-primary-button" href="/login?next=/today">Explorer LFO <ArrowRight size={16}/></Link><Link className="v8-secondary-button" href="/method">Voir comment ça fonctionne</Link></div><div className="v8-hero-facts"><span><ShieldCheck size={15}/> Sources traçables</span><span><Network size={15}/> Domaines reliés</span><span><FileCheck2 size={15}/> Hypothèses séparées des faits</span></div></div>
      <Universe />
    </section>

    <section className="v8-section">
      <SectionIntro index="01" eyebrow="La vue exécutive" title="Voir l’ensemble sans perdre la profondeur." body="Le premier niveau répond à quatre questions : combien je vaux, combien est liquide, ce que je dois et ce que je peux réellement investir. Chaque chiffre peut ensuite être ouvert jusqu’à sa source." />
      <WealthCockpit />
    </section>

    <section className="v8-section v8-dual-showcase">
      <SectionIntro index="02" eyebrow="Deux décisions concrètes" title="Le même système change de forme selon la question." body="LFO ne réutilise pas le même tableau de bord partout. Un projet immobilier ressemble à un dossier d’investissement ; un portefeuille ressemble à un terminal d’analyse." />
      <div className="v8-showcase-stack"><PropertyScene/><PortfolioScene/></div>
    </section>

    <section className="v8-section">
      <SectionIntro index="03" eyebrow="Confiance & provenance" title="Un chiffre important doit toujours pouvoir être expliqué." body="La confiance ne vient pas d’un score opaque. Elle vient de la possibilité de remonter du résultat jusqu’aux documents et événements qui l’ont produit." />
      <LineageScene />
    </section>

    <section className="v8-final-cta"><span>Prototype V8</span><h2>Moins de formulaires.<br/>Plus de contexte financier.</h2><p>Cette preview explore une expérience où la profondeur appartient aux moteurs et aux sources, pas à la charge mentale de l’utilisateur.</p><Link className="v8-primary-button" href="/login?next=/today">Entrer dans le cockpit <ArrowRight size={16}/></Link></section>
  </>;
}

function PurposePage() {
  return <>
    <section className="v8-page-hero"><span>Pourquoi LFO</span><h1>Votre patrimoine ne s’arrête pas à vos comptes bancaires.</h1><p>Une même personne peut être salariée, investisseur, propriétaire, entrepreneur et contribuable. Le problème n’est pas le manque de données : c’est qu’elles vivent dans des systèmes qui ne se parlent pas.</p></section>
    <section className="v8-section"><SectionIntro index="01" eyebrow="Aujourd’hui" title="Une vie financière fragmentée." body="Chaque fournisseur connaît une pièce du puzzle, mais personne ne voit automatiquement la conséquence d’un événement sur l’ensemble de votre situation." />
      <div className="v8-fragmented-life"><article><Banknote/><strong>Banque</strong><span>31 240 €</span></article><article><TrendingUp/><strong>Courtier</strong><span>118 400 €</span></article><article><Building2/><strong>Immobilier</strong><span>312 000 €</span></article><article><Landmark/><strong>Crédit</strong><span>162 700 €</span></article><article><BriefcaseBusiness/><strong>Carrière</strong><span>5 100 €/mois</span></article><article><ReceiptText/><strong>Fiscalité</strong><span>Règles distinctes</span></article></div>
    </section>
    <section className="v8-section"><SectionIntro index="02" eyebrow="La cible" title="La même vie, rapprochée avant d’être analysée." body="LFO cherche d’abord les correspondances entre les faits. Les moteurs financiers ne travaillent qu’ensuite, sur une réalité consolidée et traçable."/><LineageScene/></section>
    <section className="v8-section"><SectionIntro index="03" eyebrow="Le résultat" title="Une architecture qui coordonne sans simplifier à tort." body="Dette, immobilier, portefeuille, fiscalité et carrière gardent leurs logiques propres. Le bilan consolidé évite les doubles comptes et les scénarios restent séparés de l’observé."/><WealthCockpit/></section>
  </>;
}

function MethodCanvas({ active }: { active: number }) {
  const step = METHOD_STEPS[active] ?? METHOD_STEPS[0];
  return <div className="v8-method-canvas" data-step={step.key}>
    <header><span>{step.index}</span><div><small>Méthode LFO</small><strong>{step.title}</strong></div><em>Exemple illustratif</em></header>
    <div className="v8-method-visual">
      {active <= 1 && <><article className="v8-source-doc"><FileText size={22}/><small>Bulletin de paie</small><strong>3 482 €</strong><span>Août 2026</span></article><article className="v8-source-bank"><Banknote size={22}/><small>Virement bancaire</small><strong>3 482 €</strong><span>30/08/2026</span></article><div className="v8-match-line"><i/><span>montant + période + employeur</span></div></>}
      {active === 2 && <div className="v8-cash-model"><span>Revenu net<strong>3 482 €</strong></span><i/><span>Charges récurrentes<strong>1 920 €</strong></span><i/><span>Capacité avant dette<strong>1 562 €</strong></span></div>}
      {active === 3 && <div className="v8-debt-schedule"><div><small>Capital restant</small><strong>162 700 €</strong></div><svg viewBox="0 0 600 220" preserveAspectRatio="none"><path className="grid" d="M0 55H600M0 110H600M0 165H600"/><path className="balance" d="M0 40 C120 55 250 90 360 120 S500 160 600 198"/><path className="interest" d="M0 190 C130 175 260 160 360 150 S500 140 600 135"/></svg><footer><span>Principal</span><span>Intérêts</span><span>Assurance</span></footer></div>}
      {active === 4 && <div className="v8-tax-bridge"><span><small>Résultat économique</small><strong>12 800 €</strong></span><i>−</i><span><small>Base taxable</small><strong>9 600 €</strong></span><i>−</i><span><small>Impôt estimé</small><strong>2 880 €</strong></span><i>=</i><span className="final"><small>Cash net</small><strong>9 920 €</strong></span></div>}
      {active === 5 && <div className="v8-valuation-range"><small>Valeur d’entreprise estimée</small><strong>1,8 M€ – 2,2 M€</strong><div><span style={{left:"18%"}}>1,8</span><i/><b style={{left:"54%"}}>2,0</b><span style={{left:"82%"}}>2,2</span></div><p>Méthode et hypothèses visibles dans l’inspecteur.</p></div>}
      {active === 6 && <div className="v8-flow-engine"><span>Revenus<b>5 100 €</b></span><ArrowRight/><span>Charges<b>2 700 €</b></span><ArrowRight/><span>Dette<b>1 020 €</b></span><ArrowRight/><span className="final">Libre<b>1 380 €</b></span></div>}
      {active === 7 && <div className="v8-risk-grid"><article><small>Concentration</small><strong>Élevée</strong><span>78 % actions US</span></article><article><small>Liquidité</small><strong>8,1 mois</strong><span>Confortable</span></article><article><small>Échéance dette</small><strong>2038</strong><span>Durée longue</span></article><article><small>Sensibilité</small><strong>+2 pts taux</strong><span>−480 €/mois</span></article></div>}
      {active === 8 && <div className="v8-scenario-fan"><svg viewBox="0 0 620 230" preserveAspectRatio="none"><path className="fan low" d="M0 190 C130 176 260 170 360 145 S500 118 620 108"/><path className="fan high" d="M0 190 C130 160 260 132 360 100 S500 55 620 32"/><path className="center" d="M0 190 C130 168 260 150 360 123 S500 86 620 66"/></svg><span>Scénario prudent</span><strong>Scénario central</strong><em>Scénario haut</em></div>}
      {active >= 9 && <div className="v8-decision-compare"><article><small>Option A</small><strong>Investir 50 k€</strong><span>Patrimoine à 10 ans · 512 k€</span></article><b>vs</b><article className="selected"><small>Option B</small><strong>Réduire la dette</strong><span>Patrimoine à 10 ans · 491 k€</span></article><footer><ShieldCheck size={14}/> Écart expliqué par rendement attendu, coût de dette et fiscalité</footer></div>}
    </div>
    <p>{step.text}</p>
  </div>;
}

function MethodPage() {
  const [active, setActive] = useState(0);
  const refs = useRef<Array<HTMLElement | null>>([]);
  useEffect(() => {
    const observers = refs.current.map((node, index) => {
      if (!node) return null;
      const observer = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) setActive(index); }, { threshold: 0.55 });
      observer.observe(node);
      return observer;
    });
    return () => observers.forEach((observer) => observer?.disconnect());
  }, []);
  return <>
    <section className="v8-page-hero"><span>Méthode</span><h1>Comprendre comment un fait devient une décision.</h1><p>Le moteur peut être profond sans rendre l’interface complexe. Faites défiler : la même situation financière évolue à mesure que LFO passe de la source à l’analyse puis au scénario.</p></section>
    <section className="v8-method-story">
      <div className="v8-method-steps">{METHOD_STEPS.map((step, index) => <article key={step.key} ref={(node) => { refs.current[index] = node; }} className={active === index ? "active" : ""}><span>{step.index}</span><h2>{step.title}</h2><p>{step.text}</p></article>)}</div>
      <div className="v8-method-sticky"><MethodCanvas active={active}/></div>
    </section>
  </>;
}

function PossibilitiesPage() {
  const [active, setActive] = useState<(typeof PATHS)[number]["id"]>("build");
  const path = PATHS.find((item) => item.id === active) ?? PATHS[0];
  const Icon = path.icon;
  return <>
    <section className="v8-page-hero"><span>Possibilités</span><h1>Partir d’une vraie question, pas d’un menu de moteurs.</h1><p>LFO doit pouvoir guider une personne qui ne connaît ni le bon ratio, ni la bonne formule, ni même l’onglet à ouvrir. La question humaine vient en premier.</p></section>
    <section className="v8-path-experience">
      <aside>{PATHS.map((item) => { const I = item.icon; return <button key={item.id} className={active === item.id ? "active" : ""} onClick={() => setActive(item.id)}><I size={18}/><span><small>{item.label}</small><strong>{item.question}</strong></span><ChevronRight size={16}/></button>; })}</aside>
      <div className="v8-path-main">
        <header><span><Icon size={20}/></span><div><small>{path.label}</small><h2>{path.question}</h2></div></header>
        <div className="v8-path-result"><small>Résultat du scénario</small><strong>{path.answer}</strong><span>{path.sub}</span></div>
        {active === "build" && <PropertyScene/>}
        {active === "decide" && <div className="v8-decision-large"><article><small>Investir 50 k€</small><strong>512 k€</strong><span>Patrimoine projeté à 10 ans</span><i className="higher">+21 k€</i></article><div>VS</div><article><small>Réduire la dette</small><strong>491 k€</strong><span>Patrimoine projeté à 10 ans</span><i>Risque plus faible</i></article></div>}
        {active === "understand" && <div className="v8-change-bridge"><span><small>Investissements</small><b>+2 460 €</b></span><i>+</i><span><small>Épargne mensuelle</small><b>+1 420 €</b></span><i>−</i><span><small>Dette amortie</small><b>+720 €</b></span><i>=</i><span className="final"><small>Variation nette</small><b>+3 820 €</b></span></div>}
        {active === "improve" && <div className="v8-improvement-list"><article><span>01</span><div><strong>Renégocier deux dépenses récurrentes</strong><small>Impact estimé</small></div><b>+180 €</b></article><article><span>02</span><div><strong>Réduire temporairement l’épargne non prioritaire</strong><small>Impact estimé</small></div><b>+210 €</b></article><article><span>03</span><div><strong>Refinancer une échéance coûteuse</strong><small>Impact estimé</small></div><b>+150 €</b></article></div>}
        <footer><span>Moteurs mobilisés</span>{path.engines.map((engine) => <b key={engine}>{engine}</b>)}</footer>
      </div>
    </section>
  </>;
}

function AboutPage() {
  return <>
    <section className="v8-page-hero about"><span>À propos</span><h1>Un Family Office est une discipline de connexion.</h1><p>LFO est une exploration produit : comment appliquer la rigueur d’un suivi patrimonial professionnel à une expérience suffisamment simple pour être utilisée au quotidien.</p></section>
    <section className="v8-section"><SectionIntro index="01" eyebrow="Le problème" title="Les données existent déjà. Elles sont seulement dispersées." body="Banque, courtier, bulletin de salaire, crédit, acte notarié, documents fiscaux et comptes d’entreprise décrivent la même situation financière sous des angles différents."/><div className="v8-fragmented-life compact"><article><Banknote/><strong>Banque</strong></article><article><TrendingUp/><strong>Courtier</strong></article><article><FileText/><strong>Documents</strong></article><article><Landmark/><strong>Dette</strong></article><article><Building2/><strong>Immobilier</strong></article><article><ReceiptText/><strong>Fiscalité</strong></article></div></section>
    <section className="v8-section"><SectionIntro index="02" eyebrow="L’approche" title="Rapprocher avant de calculer." body="La priorité n’est pas d’afficher plus de KPI. Elle est de reconstruire une vérité financière fiable, puis de permettre à chaque moteur de l’enrichir sans créer une seconde vérité."/><LineageScene/></section>
    <section className="v8-section"><SectionIntro index="03" eyebrow="Principes" title="Quatre règles qui ne bougent pas." body="Elles servent à trancher les choix de produit, de données et de design."/><div className="v8-principles"><article><span>01</span><strong>Fidélité aux faits</strong><p>Une information observée, calculée, estimée ou projetée doit rester identifiable.</p></article><article><span>02</span><strong>Automatisation</strong><p>La machine reconstruit ce qu’elle peut déduire ; l’utilisateur intervient là où le jugement humain est nécessaire.</p></article><article><span>03</span><strong>Explicabilité</strong><p>Un nombre important doit pouvoir être remonté jusqu’à sa source et sa méthode.</p></article><article><span>04</span><strong>Adaptabilité</strong><p>La structure suit la vie financière réelle : salarié, investisseur, propriétaire, entrepreneur ou plusieurs à la fois.</p></article></div></section>
    <section className="v8-experimental"><div><span>État du projet</span><h2>Cette interface reste volontairement expérimentale.</h2></div><p>Les scènes de la vitrine utilisent des données illustratives. Elles servent à valider l’expérience, la hiérarchie et le langage visuel avant d’être reliées à tous les moteurs canoniques.</p></section>
  </>;
}

const PLAN_FEATURES = [
  ["Sources connectées", "4", "Illimitées", "Illimitées"],
  ["Rapprochement automatique", "Essentiel", "Avancé", "Avancé + revue"],
  ["Patrimoine & Cash Flow", "Oui", "Oui", "Oui"],
  ["Investissements & dette", "Lecture", "Analyse", "Analyse complète"],
  ["Immobilier", "1 projet", "Illimité", "Illimité"],
  ["Business Equity", "—", "1 société", "Multi-entités"],
  ["Fiscalité & scénarios", "Simple", "Avancé", "Avancé"],
  ["Exports & mémos", "PDF", "PDF / Excel", "Comité d’investissement"],
];

function PricingPage() {
  return <>
    <section className="v8-page-hero"><span>Tarifs · prototype</span><h1>Une profondeur qui augmente avec votre complexité financière.</h1><p>Ces tarifs sont illustratifs. La logique testée ici est la progression des capacités : connecter, comprendre, modéliser puis coordonner plusieurs domaines et entités.</p></section>
    <section className="v8-pricing-plans"><article><span>Fondation</span><strong>0 €<small>/mois</small></strong><p>Pour consolider les fondamentaux et comprendre sa position.</p><ul><li><Check/>Patrimoine</li><li><Check/>Cash Flow</li><li><Check/>Sources essentielles</li></ul></article><article className="featured"><em>Le plus équilibré</em><span>Intelligence</span><strong>19 €<small>/mois</small></strong><p>Pour investir, préparer des projets et comparer des décisions.</p><ul><li><Check/>Tout Fondation</li><li><Check/>Investissements & dette</li><li><Check/>Scénarios avancés</li></ul></article><article><span>Private Office</span><strong>49 €<small>/mois</small></strong><p>Pour coordonner immobilier, société, fiscalité et décisions complexes.</p><ul><li><Check/>Tout Intelligence</li><li><Check/>Multi-entités</li><li><Check/>Mémos de décision</li></ul></article></section>
    <section className="v8-section"><SectionIntro index="01" eyebrow="Comparatif" title="Comparer les capacités, pas seulement les slogans." body="La matrice rend visible ce qui change réellement entre les niveaux de service."/><div className="v8-capability-table"><header><span>Capacité</span><b>Fondation</b><b>Intelligence</b><b>Private Office</b></header>{PLAN_FEATURES.map((row) => <div key={row[0]}><span>{row[0]}</span><b>{row[1]}</b><b>{row[2]}</b><b>{row[3]}</b></div>)}</div></section>
    <section className="v8-section"><SectionIntro index="02" eyebrow="Progression" title="Le bon niveau dépend de la structure de votre vie financière." body="Le produit ne devrait pas faire payer de la complexité inexistante. Les moteurs deviennent utiles quand les situations apparaissent réellement."/><div className="v8-complexity-path"><article><BriefcaseBusiness/><strong>Salarié + épargne</strong><span>Fondation</span></article><i><ArrowRight/></i><article><TrendingUp/><strong>Investisseur + crédit</strong><span>Intelligence</span></article><i><ArrowRight/></i><article><Building2/><strong>Immobilier + société</strong><span>Private Office</span></article></div></section>
  </>;
}

export function PublicV8Page({ kind }: { kind: PublicV8Kind }) {
  const [theme, setTheme] = useState<Theme>("dark");
  let content: ReactNode;
  if (kind === "purpose") content = <PurposePage/>;
  else if (kind === "method") content = <MethodPage/>;
  else if (kind === "possibilities") content = <PossibilitiesPage/>;
  else if (kind === "about") content = <AboutPage/>;
  else if (kind === "pricing") content = <PricingPage/>;
  else content = <HomePage/>;
  return <Shell kind={kind} theme={theme} setTheme={setTheme}>{content}</Shell>;
}

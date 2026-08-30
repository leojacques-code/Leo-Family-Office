import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  BrainCircuit,
  Building2,
  FileLock2,
  Goal,
  Landmark,
  ShieldCheck,
  Sparkles,
  WalletCards,
} from "lucide-react";

const features = [
  {
    icon: WalletCards,
    title: "Patrimoine à 360°",
    text: "Actifs, dettes, cash-flow, immobilier et participations réunis dans une lecture cohérente et immédiatement exploitable.",
    tag: "Net worth · Cash flow",
  },
  {
    icon: BarChart3,
    title: "Investissements lisibles",
    text: "Allocation, performances, enveloppes et exposition au risque présentées avec le niveau de détail d'un cockpit professionnel.",
    tag: "Investments · Allocation",
  },
  {
    icon: BrainCircuit,
    title: "Decision Lab",
    text: "Tester des décisions avant de les prendre : achat immobilier, changement de carrière, arbitrage d'allocation ou nouveau projet.",
    tag: "Scenarios · Simulation",
  },
  {
    icon: Building2,
    title: "Immobilier piloté",
    text: "Valeur, dette, rendement, travaux et trajectoire patrimoniale dans une seule vue, sans perdre le contexte global.",
    tag: "Real estate",
  },
  {
    icon: Goal,
    title: "Objectifs reliés au réel",
    text: "Transformer des ambitions de vie en objectifs chiffrés, datés et reliés aux flux, au capital et aux hypothèses du modèle.",
    tag: "Goals",
  },
  {
    icon: FileLock2,
    title: "Mémoire patrimoniale",
    text: "Documents, hypothèses, événements et décisions restent structurés pour comprendre pourquoi le patrimoine évolue.",
    tag: "Documents · Timeline",
  },
] as const;

export default function HomePage() {
  return (
    <main className="marketing-home">
      <div className="marketing-grid" />
      <div className="marketing-glow one" />
      <div className="marketing-glow two" />

      <nav className="marketing-nav" aria-label="Navigation de présentation">
        <Link href="/" className="brand-lockup" aria-label="Léo Family Office — accueil">
          <span className="brand-mark">LF</span>
          <span><strong>Léo</strong><small>Family Office</small></span>
        </Link>
        <div className="marketing-links">
          <a href="#cockpit">Le cockpit</a>
          <a href="#method">La méthode</a>
          <a href="#security">Confidentialité</a>
        </div>
        <div className="marketing-nav-actions">
          <Link className="button secondary" href="/login">Connexion</Link>
          <Link className="button primary" href="/login?next=/today">Ouvrir le cockpit <ArrowRight size={14} /></Link>
        </div>
      </nav>

      <section className="marketing-hero">
        <div className="marketing-hero-copy">
          <div className="marketing-badge"><i /> Private wealth operating system</div>
          <h1>Pilotez votre patrimoine comme un <span>Family Office.</span></h1>
          <p>
            Une interface privée pour centraliser votre situation financière, comprendre vos arbitrages
            et projeter les décisions qui comptent — avec des hypothèses explicites plutôt qu'une simple collection de graphiques.
          </p>
          <div className="marketing-hero-actions">
            <Link className="button primary" href="/login?next=/today">Explorer l'espace privé <ArrowRight size={15} /></Link>
            <a className="button secondary" href="#cockpit">Découvrir le produit</a>
          </div>
          <div className="marketing-hero-note">
            <span>Données privées</span>
            <span>Hypothèses traçables</span>
            <span>Décisions simulables</span>
          </div>
        </div>

        <div className="product-stage" aria-label="Aperçu visuel du cockpit">
          <div className="product-window">
            <div className="product-window-bar">
              <div className="window-dots"><i /><i /><i /></div>
              <span>leo-family-office / private workspace</span>
              <span>Live</span>
            </div>
            <div className="product-window-body">
              <aside className="product-mini-sidebar">
                <div className="product-mini-brand">LF</div>
                <div className="product-mini-nav">
                  <span className="active">Today</span>
                  <span>Net Worth</span>
                  <span>Cash Flow</span>
                  <span>Investments</span>
                  <span>Real Estate</span>
                  <span>Scenarios</span>
                  <span>Goals</span>
                </div>
              </aside>
              <div className="product-mini-content">
                <span className="product-mini-kicker">Executive overview</span>
                <h3>Today</h3>
                <div className="product-kpis">
                  <div className="product-kpi"><span>Net worth</span><strong>€184.6k</strong><small>+8.4% YTD</small></div>
                  <div className="product-kpi"><span>Invested assets</span><strong>€97.2k</strong><small>62% du capital</small></div>
                  <div className="product-kpi"><span>Free cash flow</span><strong>€1.48k</strong><small>mensuel estimé</small></div>
                </div>
                <div className="product-chart">
                  <svg viewBox="0 0 500 120" preserveAspectRatio="none" aria-hidden="true">
                    <defs>
                      <linearGradient id="heroChartFill" x1="0" x2="0" y1="0" y2="1">
                        <stop offset="0%" stopColor="#3080ff" stopOpacity="0.28" />
                        <stop offset="100%" stopColor="#3080ff" stopOpacity="0" />
                      </linearGradient>
                    </defs>
                    <path d="M0,98 C48,92 72,82 105,83 C155,85 169,60 214,64 C260,69 288,49 322,53 C368,58 395,34 428,37 C462,40 475,20 500,16 L500,120 L0,120 Z" fill="url(#heroChartFill)" />
                    <path d="M0,98 C48,92 72,82 105,83 C155,85 169,60 214,64 C260,69 288,49 322,53 C368,58 395,34 428,37 C462,40 475,20 500,16" fill="none" stroke="#54a2ff" strokeWidth="2.3" />
                  </svg>
                </div>
                <div className="product-bottom-row">
                  <div className="product-small-card"><span>Allocation momentum</span><div className="product-bars"><i /><i /><i /><i /><i /><i /></div></div>
                  <div className="product-small-card"><span>Goal confidence</span><strong style={{display:"block",marginTop:10,fontSize:18}}>82%</strong></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="marketing-section" id="cockpit">
        <div className="marketing-section-head">
          <span className="eyebrow">Un seul système de lecture</span>
          <h2>Chaque onglet répond à une décision, pas à un effet de dashboard.</h2>
          <p>Le prototype reprend les briques existantes du produit mais leur donne une hiérarchie visuelle plus nette, plus premium et plus cohérente entre les domaines.</p>
        </div>
        <div className="feature-grid">
          {features.map(({ icon: Icon, title, text, tag }) => (
            <article className="feature-card" key={title}>
              <div className="feature-icon"><Icon size={18} strokeWidth={1.8} /></div>
              <h3>{title}</h3>
              <p>{text}</p>
              <small>{tag}</small>
            </article>
          ))}
        </div>
      </section>

      <section className="marketing-section" id="method">
        <div className="marketing-process">
          <div className="marketing-section-head">
            <span className="eyebrow">Une logique Family Office</span>
            <h2>Voir. Comprendre. Décider.</h2>
            <p>Le produit n'est pas pensé comme un agrégateur bancaire. Il conserve le contexte, distingue le réel des hypothèses et permet d'explorer les conséquences d'une décision.</p>
          </div>
          <div className="process-steps">
            <article className="process-step"><span>01</span><div><h3>Centraliser la situation</h3><p>Actifs, passifs, flux, carrière, immobilier et sociétés sont reliés à la même photographie patrimoniale.</p></div></article>
            <article className="process-step"><span>02</span><div><h3>Rendre les hypothèses visibles</h3><p>Chaque chiffre important peut rester explicable : donnée réelle, hypothèse utilisateur, modèle ou donnée externe.</p></div></article>
            <article className="process-step"><span>03</span><div><h3>Tester les décisions</h3><p>Les scénarios permettent de comparer des trajectoires avant de transformer une intuition en engagement financier.</p></div></article>
            <article className="process-step"><span>04</span><div><h3>Conserver la mémoire</h3><p>Objectifs, documents et timeline créent une continuité dans la gestion du patrimoine au fil des années.</p></div></article>
          </div>
        </div>
      </section>

      <section className="marketing-section" id="security">
        <div className="marketing-cta">
          <div className="marketing-badge"><ShieldCheck size={12} /> Espace personnel & confidentiel</div>
          <h2>Votre patrimoine mérite mieux qu'un tableur dispersé.</h2>
          <p>Accédez à une vision structurée de vos finances et utilisez le cockpit comme support de décision personnel — du quotidien aux décisions patrimoniales majeures.</p>
          <Link className="button primary" href="/login?next=/today"><Sparkles size={14} /> Entrer dans la preview</Link>
        </div>
      </section>

      <footer className="marketing-footer">
        <div className="brand-lockup"><span className="brand-mark">LF</span><span><strong>Léo</strong><small>Family Office</small></span></div>
        <span>Prototype visuel privé · Interface expérimentale</span>
        <span><Landmark size={12} style={{verticalAlign:"middle",marginRight:6}} /> Paris · EUR</span>
      </footer>
    </main>
  );
}

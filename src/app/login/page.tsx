import Link from "next/link";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { LoginForm } from "@/components/login-form";

export default function LoginPage() {
  return (
    <main className="login-page">
      <section className="login-panel">
        <Link href="/" className="login-home-link brand-lockup" aria-label="Retour à l'accueil">
          <span className="brand-mark">LF</span>
          <span><strong>Léo</strong><small>Family Office</small></span>
        </Link>

        <div className="login-copy">
          <span className="eyebrow">Private wealth workspace</span>
          <h1>Votre patrimoine,<br /><span>sans angle mort.</span></h1>
          <p>Un cockpit personnel pour suivre, projeter et décider avec des hypothèses explicites, une lecture consolidée et une vraie continuité patrimoniale.</p>
          <div className="login-preview-stack" aria-hidden="true">
            <div className="login-preview-chip"><span>Vision</span><strong>Net worth 360°</strong></div>
            <div className="login-preview-chip"><span>Projection</span><strong>Scénarios comparables</strong></div>
            <div className="login-preview-chip"><span>Décision</span><strong>Goals & Decision Lab</strong></div>
          </div>
        </div>

        <div className="privacy-note"><span className="privacy-dot" /><ShieldCheck size={12} /> Données privées, centralisées et protégées</div>
      </section>

      <section className="login-form-wrap">
        <div style={{width:"100%",maxWidth:420}}>
          <Link href="/" className="login-back"><ArrowLeft size={12} /> Retour à la présentation</Link>
          <LoginForm />
        </div>
      </section>
    </main>
  );
}

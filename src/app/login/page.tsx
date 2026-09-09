import Link from "next/link";
import { LoginForm } from "@/components/login-form";

export default function LoginPage() {
  return (
    <main className="login-page">
      <section className="login-panel">
        <div className="brand-lockup login-brand">
          <span className="brand-mark">LF</span>
          <span>
            <strong>Léo</strong>
            <small>Family Office</small>
          </span>
        </div>
        <div className="login-copy">
          <span className="eyebrow">Espace privé</span>
          <h1>
            Votre patrimoine,
            <br />
            sans angle mort.
          </h1>
          <p>
            Un cockpit personnel pour suivre, projeter et décider avec des hypothèses explicites.
          </p>
        </div>
        <div className="privacy-note">
          <span className="privacy-dot" />
          Données privées, centralisées et protégées
        </div>
        {/*
         * §19.3 : « le login doit proposer un espace de démonstration en lecture seule ».
         * L'accès est ici et non ailleurs parce que c'est là que quelqu'un sans compte arrive.
         * Le périmètre annoncé est celui qui est réellement servi — Aujourd'hui — plutôt qu'un
         * « découvrir le produit » qui promettrait les treize autres pages.
         */}
        <Link className="login-demo" href="/demo">
          Voir une démonstration en lecture seule
        </Link>
      </section>
      <section className="login-form-wrap">
        <LoginForm />
      </section>
    </main>
  );
}

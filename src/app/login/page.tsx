import { usesLocalFixtureAuth } from "@/lib/auth-config";
import Link from "next/link";
import { LoginForm } from "@/components/login-form";

const CONFIRMATION_MESSAGES: Record<string, string> = {
  "sign-in": "Si votre adresse est confirmée, connectez-vous avec votre mot de passe.",
  expired:
    "Ce lien de confirmation a expiré ou a déjà servi. Si votre adresse est confirmée, connectez-vous avec votre mot de passe.",
  invalid: "Ce lien de confirmation est incomplet.",
  unavailable:
    "Confirmation momentanément indisponible. Connectez-vous avec votre mot de passe ; si l’erreur persiste, réessayez plus tard.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const confirmation = (await searchParams).confirmation;
  const notice =
    typeof confirmation === "string" ? (CONFIRMATION_MESSAGES[confirmation] ?? null) : null;
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
        <LoginForm localFixture={usesLocalFixtureAuth()} notice={notice} />
      </section>
    </main>
  );
}

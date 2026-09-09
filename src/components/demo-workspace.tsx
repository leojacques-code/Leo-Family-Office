"use client";

import Link from "next/link";
import { useState } from "react";
import { ShieldCheck } from "lucide-react";
import { formatDate } from "@/components/pages/shared";
import TodayPage from "@/components/pages/today/page";
import { SourceRail, type RailSource } from "@/components/workstation/source-rail";
import { WorkspaceShell } from "@/components/workstation/workspace-shell";
import { PAGE_REGISTRY } from "@/lib/presentation/registry/pages";
import type { TodayReadModel } from "@/lib/presentation/today/contracts";

/**
 * Espace de démonstration : le poste de travail d'Aujourd'hui, sans le chrome applicatif.
 *
 * IL N'Y A NI BARRE LATÉRALE NI BOUTON DE DÉCONNEXION, et c'est un choix plutôt qu'un oubli.
 * La démonstration est CADRÉE sur Aujourd'hui (voir `today-demo.ts` pour l'écart assumé au
 * §19.3) : afficher les six entrées de navigation du §7 conduirait un visiteur non
 * authentifié vers treize pages qui le renverraient à l'écran de connexion. Un chemin qui
 * mène à une porte fermée coûte plus qu'un chemin absent — c'est l'argument que la phase 1 a
 * retenu pour son action primaire non servie.
 *
 * LES TROIS ZONES SONT CELLES DU PRODUIT. `WorkspaceShell`, `SourceRail`, `FinancialCanvas`
 * et le canvas d'Aujourd'hui sont les mêmes composants qu'en session : la démonstration montre
 * l'écran réel, pas une maquette. C'est aussi une preuve que les zones du §17 sont montables
 * hors du shell applicatif.
 */

export function DemoWorkspace({ model }: { model: TodayReadModel }) {
  const [selectedSource, setSelectedSource] = useState<string | null>(null);
  const manifest = PAGE_REGISTRY.today ?? null;
  const railSources: RailSource[] = model.railSources.map((source) => ({
    id: source.id,
    category: source.category,
    name: source.name,
    status: source.status,
    hint: source.hint
      ? `Au ${formatDate(source.hint, { day: "numeric", month: "short", year: "numeric" })}`
      : undefined,
  }));

  return (
    <div className="demo-page">
      <header className="demo-header">
        <span className="brand-lockup">
          <span className="brand-mark">LF</span>
          <span>
            <strong>Léo</strong>
            <small>Family Office</small>
          </span>
        </span>
        <span className="demo-badge">
          <ShieldCheck size={15} />
          Démonstration en lecture seule
        </span>
        <Link className="button secondary" href="/login">
          Accéder à mon espace
        </Link>
      </header>

      <div className="content-area">
        <WorkspaceShell
          dateLabel={
            <>
              <span className="status-dot" />
              Au {formatDate(model.asOfDate)}
            </>
          }
          fallbackTitle="Aujourd’hui"
          manifest={manifest}
          mode="REAL"
          // Le sélecteur Réel/Simulation reste rendu par le shell, et Aujourd'hui ne déclare
          // que `REAL` : le changer n'a donc rien à faire, ce que ce gestionnaire vide dit.
          onModeChange={() => undefined}
          sourceRail={
            railSources.length > 0 ? (
              <SourceRail
                onSelect={setSelectedSource}
                selectedId={selectedSource}
                sources={railSources}
              />
            ) : undefined
          }
        >
          {/*
           * `onModelChange` ne peut RIEN changer ici, et le modèle porte déjà
           * `readOnlyDemo: true`, qui masque les contrôles d'écriture du parcours
           * d'installation. Le gestionnaire est donc inerte par construction, non par
           * convention : il n'existe aucun chemin depuis cette page vers une écriture.
           */}
          <TodayPage model={model} onModelChange={() => undefined} />
        </WorkspaceShell>
      </div>
    </div>
  );
}

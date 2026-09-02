"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { ArrowRight, CalendarRange, Database, FileCheck2, FolderLock, Settings2, ShieldCheck, SlidersHorizontal } from "lucide-react";

const OPS = {
  imports: {
    icon: Database,
    title: "Sources",
    question: "Comment faire entrer une donnée sans transformer une supposition en vérité ?",
    description: "Chaque source suit le même chemin : connecter ou importer, prévisualiser, rapprocher, revoir les conflits, puis confirmer.",
    steps: ["Connecter ou importer", "Prévisualiser", "Rapprocher", "Confirmer"],
    actions: ["Banque & transactions", "Documents financiers", "Relevés d'investissement", "Liasses & FEC"],
  },
  documents: {
    icon: FolderLock,
    title: "Documents",
    question: "Quels documents expliquent réellement les chiffres du cockpit ?",
    description: "Un document n'est utile que s'il devient une source traçable, liée à un fait, un domaine et une date de validité.",
    steps: ["Déposer", "Extraire", "Relier", "Revoir"],
    actions: ["Bulletins de paie", "Échéanciers", "Actes & baux", "Avis fiscaux"],
  },
  timeline: {
    icon: CalendarRange,
    title: "Chronologie",
    question: "Qu'est-ce qui a réellement changé, quand et pourquoi ?",
    description: "La chronologie rassemble événements observés, engagements contractuels et scénarios sans les confondre.",
    steps: ["Observé", "Contractuel", "À venir", "Projeté"],
    actions: ["Revenu", "Dette", "Investissement", "Fiscalité"],
  },
  settings: {
    icon: Settings2,
    title: "Préférences",
    question: "Comment personnaliser l'expérience sans modifier la vérité financière ?",
    description: "Les préférences modifient l'affichage, les KPI visibles, la densité, les rapports et les notifications — jamais les moteurs canoniques.",
    steps: ["Affichage", "KPI visibles", "Rapports", "Confidentialité"],
    actions: ["Vue essentielle / complète", "Thème clair / sombre", "Rapport mensuel", "Alertes de mise à jour"],
  },
} as const;

export function OperationalDomainV9({ section, children }: { section: string; children: ReactNode }) {
  const config = OPS[section as keyof typeof OPS];
  const [open, setOpen] = useState(false);
  if (!config) return <>{children}</>;
  const Icon = config.icon;
  return (
    <div className="v9-ops-page">
      <section className="v9-ops-hero">
        <div className="v9-domain-title-block"><span className="v9-domain-icon"><Icon size={21} /></span><div><span className="v9-kicker">Espace opérationnel</span><h1>{config.title}</h1></div></div>
        <div><strong>{config.question}</strong><p>{config.description}</p></div>
        <button type="button" className="v9-customize"><SlidersHorizontal size={15} /> Personnaliser</button>
      </section>
      <section className="v9-ops-flow">
        {config.steps.map((step, index) => <div key={step}><span>{String(index + 1).padStart(2,"0")}</span><strong>{step}</strong>{index < config.steps.length - 1 ? <ArrowRight size={14} /> : <FileCheck2 size={14} />}</div>)}
      </section>
      <section className="v9-ops-actions"><div><span>Accès rapides</span><h2>Aller directement à la source ou au réglage concerné.</h2></div><div>{config.actions.map((action) => <button type="button" key={action}>{action}<ArrowRight size={13} /></button>)}</div></section>
      <section className="v9-connections"><div><ShieldCheck size={16}/><span><strong>Couche de contrôle uniquement.</strong><small>Les réglages et imports ne doivent jamais créer une seconde vérité financière locale.</small></span></div><Link href="/today">Retour au cockpit <ArrowRight size={12}/></Link></section>
      <section className="v9-complete-analysis"><div><span>Vue complète</span><h2>Ouvrir les outils existants.</h2><p>La couche V9 organise le parcours ; les fonctions détaillées restent accessibles à la demande.</p></div><button type="button" className="button primary" onClick={() => setOpen((value)=>!value)}>{open ? "Masquer" : "Afficher les outils"}</button></section>
      {open ? <div className="v9-existing-analysis">{children}</div> : null}
    </div>
  );
}

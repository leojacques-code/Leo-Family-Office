"use client";

import { useCallback, useState } from "react";
import { Inbox } from "lucide-react";
import { FinancialDrawer } from "@/components/workstation/financial-drawer";
import { TaskInbox } from "@/components/workstation/task-inbox";
import type {
  DeclarableDomain,
  DomainApplicability,
  InboxTask,
  TodayReadModel,
} from "@/lib/presentation/today/contracts";
import { TodayCanvas } from "./canvas";
import { Installation } from "./installation";

/**
 * Page Aujourd'hui (§20 du plan de refonte).
 *
 * ELLE NE REÇOIT PLUS `DashboardState`, et c'est le changement structurant. Le §10.2 demande
 * de remplacer `getDashboardState()` par des modèles de lecture ciblés, et cette page est la
 * première servie par `getTodayReadModel()`. Ce qu'elle reçoit est un objet dont chaque champ
 * est déjà une décision d'affichage : elle n'appelle aucun moteur, ne connaît aucun agrégat et
 * ne peut donc pas recomposer une finance parallèle. Le §2 de la constitution du dépôt est
 * tenu par le TYPE, plus par la discipline.
 *
 * LES TREIZE AUTRES PAGES GARDENT L'ÉTAT GLOBAL. Le §14 interdit de « refaire toutes les pages
 * dans une seule PR », et chacune obtiendra son modèle dans sa phase.
 *
 * TAILLE : cette page ORCHESTRE, elle ne compose pas. Le canvas, le parcours d'installation et
 * l'inbox vivent dans leurs modules. La mesure technique du §13 recommande 400 lignes par
 * composant de page ; une page qui dessinerait elle-même les six réponses les dépasserait, et
 * surtout elle rendrait le canvas intestable sans monter la page entière.
 */

export interface TodayPageProps {
  model: TodayReadModel;
  /** Remplace le modèle après une écriture. La page ne parle jamais au dépôt directement. */
  onModelChange: (model: TodayReadModel) => void;
}

export default function TodayPage({ model, onModelChange }: TodayPageProps) {
  const [inboxOpen, setInboxOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const declare = useCallback(
    async (domain: DeclarableDomain, applicability: DomainApplicability) => {
      setBusy(true);
      setError("");
      try {
        const response = await fetch("/api/today", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ domain, applicability }),
        });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? "Déclaration impossible");
        // La route rend le MODÈLE LOCAL, pas l'état global : le §10.2 l'exige de toute
        // mutation, et c'est ce qui permet à cette page de se rafraîchir sans que le reste du
        // produit ne recharge.
        onModelChange(body as TodayReadModel);
      } catch (declarationError) {
        setError(
          declarationError instanceof Error ? declarationError.message : "Déclaration impossible",
        );
      } finally {
        setBusy(false);
      }
    },
    [onModelChange],
  );

  return (
    <div className="today-page" data-stage={model.profileStage}>
      {model.readOnlyDemo ? (
        <p className="today-demo-banner" role="status">
          Espace de démonstration, en lecture seule. Les données sont synthétiques et aucune
          modification n’est enregistrée.
        </p>
      ) : null}

      {error ? (
        <p className="today-error" role="alert">
          {error}
        </p>
      ) : null}

      {/*
       * L'ORDRE EST CELUI DU §11 : « un profil vide obtient un parcours d'installation ». Sur
       * un profil vide, le parcours vient AVANT le canvas — un cockpit dont les six réponses
       * sont non calculables n'aide personne, et l'afficher en premier est exactement la
       * « succession d'erreurs » que le critère refuse. Dès l'installation commencée, les deux
       * coexistent, et le parcours disparaît une fois toutes ses étapes faites ou closes.
       */}
      {model.installation && model.profileStage === "EMPTY" ? (
        <Installation
          busy={busy}
          domains={model.domains}
          onDeclare={declare}
          path={model.installation}
          readOnly={model.readOnlyDemo}
        />
      ) : null}

      <TodayCanvas model={model} onOpenInbox={() => setInboxOpen(true)} />

      {/* Les actions prioritaires : au plus TROIS, plafond appliqué par le modèle de lecture
          et vérifié par un test. Le §17 zone F veut que chaque demande explique ce qui s'est
          passé, pourquoi cela compte, la preuve et l'effet — d'où le `title` porteur, et le
          détail complet dans l'inbox. */}
      {model.actions.length > 0 ? (
        <section aria-label="Actions prioritaires" className="today-actions">
          <p className="today-question">Trois actions au plus</p>
          <ul>
            {model.actions.map((action) => (
              <li key={action.id}>
                <a className="button primary" href={action.href}>
                  {action.label}
                </a>
                <span className="today-action-why">{action.importance}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {model.installation && model.profileStage !== "EMPTY" ? (
        <Installation
          busy={busy}
          domains={model.domains}
          onDeclare={declare}
          path={model.installation}
          readOnly={model.readOnlyDemo}
        />
      ) : null}

      <button className="today-inbox-open" onClick={() => setInboxOpen(true)} type="button">
        <Inbox size={16} />
        Boîte de réception
      </button>

      {/*
       * L'INBOX EST UN TIROIR, pas une septième section de la page.
       *
       * Le §11 de V10 la veut en « compact drawer / side tray », et le §7 : « forms do not
       * occupy the main canvas ». C'est aussi ce qui monte enfin `FinancialDrawer`, écrit et
       * testé en phase 1 mais importé par aucune page — le point E5 de ses limites connues.
       */}
      <FinancialDrawer
        onClose={() => setInboxOpen(false)}
        open={inboxOpen}
        subtitle="Ce qui demande une décision, un arbitrage ou rien du tout"
        title="Boîte de réception"
      >
        <TaskInbox
          inbox={model.inbox}
          renderAction={(task: InboxTask) =>
            task.href ? (
              <a className="button secondary" href={task.href}>
                Traiter
              </a>
            ) : null
          }
        />
      </FinancialDrawer>
    </div>
  );
}

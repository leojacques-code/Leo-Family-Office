"use client";

import { useId, useState } from "react";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  CircleDashed,
  Clock,
  ShieldAlert,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { InboxTask, InboxView, InboxViewId } from "@/lib/presentation/today/contracts";
import { STATE_CONTRACTS } from "@/lib/presentation/language/states";
import { TechnicalDetails } from "@/components/primitives/technical-details";

/**
 * Boîte de réception, `task-inbox.tsx` du §10.2.
 *
 * Elle rend les SIX vues du §32 et, pour chaque tâche, les quatre explications que le §11
 * exige : « chaque tâche explique fait, importance, preuve et effet de l'acceptation ». Le §17
 * zone F les nomme dans les mêmes termes.
 *
 * CE N'EST PAS UNE PAGE DE LOGS. Le §35 le dit de Beyonder : ses capacités apparaissent « dans
 * Inbox pour expliquer un conflit », et non comme un inventaire. Une inbox qui déroule
 * quarante lignes sans les expliquer est le même défaut sous un autre nom, et le §20 l'interdit
 * en toutes lettres : « aucune liste de cinquante alertes ».
 *
 * LES ONGLETS SONT DES VUES, PAS DES SECTIONS EMPILÉES. Le §11 de V10 veut une « automation
 * inbox » en « compact drawer / side tray » et le §13 « the same shell changes the canvas
 * instead of stacking five panels vertically ». Six sections dépliées l'une sous l'autre
 * seraient la pile verticale que V10 rejette.
 *
 * UNE TÂCHE OUVERTE MONTRE SES QUATRE EXPLICATIONS, PAS UN RÉSUMÉ. Elles sont replliées par
 * défaut — le §3 de V10 borne le texte permanent — et l'explication « appears on interaction,
 * not permanently ».
 */

const VIEW_ICONS: Readonly<Record<InboxViewId, LucideIcon>> = {
  TO_VERIFY: ShieldAlert,
  CONFLICTS: AlertTriangle,
  MISSING: CircleDashed,
  STALE: Clock,
  UPCOMING: CalendarClock,
  AUTO_RESOLVED: CheckCircle2,
};

export interface TaskInboxProps {
  inbox: InboxView;
  /**
   * Vue ouverte. Non contrôlée par défaut : l'inbox choisit la première vue NON VIDE, ce qui
   * évite d'ouvrir sur « À vérifier » vide alors que trois conflits attendent en dessous.
   */
  initialView?: InboxViewId;
  /** Rendu d'une action de tâche, fourni par la page. L'inbox n'écrit rien elle-même. */
  renderAction?: (task: InboxTask) => React.ReactNode;
}

function firstPopulated(inbox: InboxView): InboxViewId {
  return inbox.sections.find((section) => section.tasks.length > 0)?.id ?? inbox.sections[0]!.id;
}

export function TaskInbox({ inbox, initialView, renderAction }: TaskInboxProps) {
  const [active, setActive] = useState<InboxViewId>(initialView ?? firstPopulated(inbox));
  const [openTask, setOpenTask] = useState<string | null>(null);
  const panelId = useId();
  const section = inbox.sections.find((entry) => entry.id === active) ?? inbox.sections[0]!;

  return (
    <div className="task-inbox">
      {/* `tablist` et non une liste de liens : les six vues sont des états d'un même panneau,
          et un lecteur d'écran doit l'entendre comme tel. */}
      <div aria-label="Vues de la boîte de réception" className="inbox-tabs" role="tablist">
        {inbox.sections.map((entry) => {
          const Icon = VIEW_ICONS[entry.id];
          return (
            <button
              aria-controls={panelId}
              aria-selected={entry.id === active}
              className="inbox-tab"
              key={entry.id}
              onClick={() => {
                setActive(entry.id);
                setOpenTask(null);
              }}
              role="tab"
              type="button"
            >
              <Icon aria-hidden="true" size={15} strokeWidth={1.8} />
              <span>{entry.label}</span>
              {/* Un compteur à zéro n'est PAS rendu : une pastille « 0 » attire l'œil sur ce
                  qui n'attend rien. Le §6 de V10 refuse l'« empty KPI card » pour la même
                  raison, à une autre échelle. */}
              {entry.tasks.length > 0 ? (
                <span className="inbox-tab-count">{entry.tasks.length}</span>
              ) : null}
            </button>
          );
        })}
      </div>

      <div className="inbox-panel" id={panelId} role="tabpanel">
        {section.tasks.length === 0 ? (
          <p className="inbox-empty">
            {/* Une vue vide POUR UNE RAISON le dit. « Données anciennes » est le cas que le
                plan crée lui-même : sans seuil de fraîcheur déclaré, annoncer « aucune donnée
                ancienne » affirmerait une fraîcheur jamais mesurée. */}
            {section.emptyBecause ?? "Rien n’attend votre décision dans cette vue."}
          </p>
        ) : (
          <ul className="inbox-list">
            {section.tasks.map((task) => {
              const open = openTask === task.id;
              return (
                <li className="inbox-item" data-state={task.state} key={task.id}>
                  <button
                    aria-expanded={open}
                    className="inbox-item-head"
                    onClick={() => setOpenTask(open ? null : task.id)}
                    type="button"
                  >
                    <span className="inbox-item-title">{task.title}</span>
                    <span className="inbox-item-state">{STATE_CONTRACTS[task.state].label}</span>
                  </button>
                  {open ? (
                    <div className="inbox-item-body">
                      {/* Les quatre explications du §11, dans son ordre et avec ses mots. */}
                      <dl className="inbox-explanation">
                        <dt>Ce qui s’est passé</dt>
                        <dd>{task.fact}</dd>
                        <dt>Pourquoi cela compte</dt>
                        <dd>{task.importance}</dd>
                        <dt>La preuve</dt>
                        <dd>{task.evidence}</dd>
                        <dt>Ce que change l’acceptation</dt>
                        <dd>{task.effect}</dd>
                      </dl>
                      {renderAction ? (
                        <div className="inbox-item-actions">{renderAction(task)}</div>
                      ) : null}
                      {/* L'identifiant technique existe, et il n'est PAS dans le corps de la
                          tâche : le constat 5.4 l'envoie au volet prévu pour lui. */}
                      {task.technicalId ? (
                        <TechnicalDetails
                          entries={[{ label: "Code de réserve", value: task.technicalId }]}
                        />
                      ) : null}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

"use client";

import type {
  AnswerView,
  CloseChangeView,
  GoalTrajectoryView,
  MonthFlowView,
  ObligationView,
  TodayReadModel,
} from "@/lib/presentation/today/contracts";
import { formatDate } from "@/components/pages/shared";
import { Amount, Unavailable, share } from "./figures";

/**
 * Canvas d'Aujourd'hui : les six questions du §3, répondues par une GÉOMÉTRIE.
 *
 * CE N'EST PAS UNE GRILLE DE KPI, et c'est la condition de recevabilité de l'écran. Le gate
 * visuel du §12.3 fait échouer une page où « une grille générique de KPI constitue la
 * composition par défaut » (règle 2) ou dont « le visuel principal pourrait appartenir à
 * n'importe quel domaine » (règle 6). L'ancienne page d'Aujourd'hui échouait aux deux : quatre
 * `MetricCard` en ligne, puis quatre panneaux, puis une bande de boutons.
 *
 * CE QUI REMPLACE LES CARTES, poste par poste, et pourquoi cette forme-là :
 *
 *   * Q1 et Q2 affichent le patrimoine net et la trésorerie séparément : une dette peut
 *     rendre le patrimoine net inférieur au cash, qui n'en constitue donc pas une part.
 *   * Q3 est une barre d'écart entre deux clôtures, décomposée en ses CAUSES, dont les largeurs
 *     sont proportionnelles à leur valeur absolue. Un nombre signé seul ne dit pas d'où il
 *     vient, et le §20 item 2 demande la variation « avec causes principales ».
 *   * Q4 est un RUBAN : revenu, dépenses essentielles, service de dette, solde libre, dans
 *     l'ordre du §20 item 3, chaque segment large à proportion du revenu. C'est le flux du
 *     mois, pas le Sankey complet de Cash Flow — le §11 de V10 réserve celui-là à son domaine.
 *   * Q5 est une piste de trajectoire vers l'échéance de l'objectif, et non un anneau de
 *     progression : le §20 de V10 veut « timeline / trajectory as primary analytic visual » et
 *     l'anneau « only as secondary summary ».
 *   * Q6 est le compte de ce qui attend une décision, rendu comme entrée vers l'inbox.
 *
 * AUCUNE VALEUR ABSENTE N'EST DESSINÉE. Une barre à largeur nulle affirmerait un zéro : les
 * blocs dont la valeur est `null` rendent leur ÉTAT, pas une géométrie vide. C'est
 * `NULL ≠ ZERO` appliqué au dessin, et le §22 de V10 le dit : « missing data changes geometry,
 * not just text ».
 */

function Stock({
  netWorth,
  cash,
  currency,
}: {
  netWorth: AnswerView;
  cash: AnswerView;
  currency: string;
}) {
  return (
    <section aria-label={netWorth.question} className="today-stock">
      <p className="today-question">{netWorth.question}</p>
      <p className="today-figure">
        {netWorth.value === null ? (
          <Unavailable answer={netWorth} />
        ) : (
          <Amount currency={currency} value={netWorth.value} />
        )}
      </p>
      <p className="today-subline">
        <span className="today-label">{cash.question}</span>
        {cash.value === null ? (
          <Unavailable answer={cash} />
        ) : (
          <Amount currency={currency} value={cash.value} />
        )}
      </p>
      {netWorth.reserve ? <p className="today-reserve">{netWorth.reserve}</p> : null}
    </section>
  );
}

function Delta({
  answer,
  change,
  reserve,
  currency,
}: {
  answer: AnswerView;
  change: CloseChangeView | null;
  reserve: string | null;
  currency: string;
}) {
  const total = change ? change.causes.reduce((sum, cause) => sum + Math.abs(cause.amount), 0) : 0;
  return (
    <section aria-label={answer.question} className="today-delta">
      <p className="today-question">{answer.question}</p>
      {change === null ? (
        <>
          <p className="today-figure small">
            <Unavailable answer={answer} />
          </p>
          {/* Le §20 refuse toute variation dont les deux clôtures ne sont pas comparables. Ce
              refus est MOTIVÉ à l'écran, sinon il se lit comme une panne. */}
          <p className="today-reserve">
            {reserve ?? "Deux clôtures comparables sont nécessaires pour mesurer une évolution."}
          </p>
        </>
      ) : (
        <>
          <p className="today-figure small" data-sign={change.amount >= 0 ? "up" : "down"}>
            <Amount currency={currency} signed value={change.amount} />
          </p>
          <p className="today-subline">
            <span className="today-label">
              Du {formatDate(change.fromDate)} au {formatDate(change.toDate)}
            </span>
          </p>
          {change.causes.length === 0 ? (
            // Deux clôtures comparables dont aucun poste ne bouge : le total a changé sans
            // qu'un poste persisté l'explique. C'est une information, pas une cause à inventer.
            <p className="today-reserve">
              Aucun poste de la composition persistée n’explique cet écart.
            </p>
          ) : (
            <ul className="today-causes">
              {change.causes.map((cause) => (
                <li key={cause.label}>
                  <span
                    aria-hidden="true"
                    className="today-cause-bar"
                    data-sign={cause.amount >= 0 ? "up" : "down"}
                    style={{
                      ["--cause-share" as string]:
                        total > 0
                          ? `${((Math.abs(cause.amount) / total) * 100).toFixed(2)}%`
                          : "0%",
                    }}
                  />
                  <span className="today-cause-label">{cause.label}</span>
                  <Amount currency={currency} signed value={cause.amount} />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

/** Les quatre postes du §20 item 3, dans son ordre. Les libellés sont les siens. */
const FLOW_SEGMENTS = [
  { key: "income", label: "Revenu" },
  { key: "essentialExpenses", label: "Dépenses essentielles" },
  { key: "debtService", label: "Service de dette" },
  { key: "freeCashFlow", label: "Solde libre" },
] as const;

function Ribbon({
  answer,
  flow,
  currency,
}: {
  answer: AnswerView;
  flow: MonthFlowView | null;
  currency: string;
}) {
  return (
    <section aria-label={answer.question} className="today-ribbon">
      <p className="today-question">{answer.question}</p>
      {flow === null ? (
        <>
          <p className="today-figure small">
            <Unavailable answer={answer} />
          </p>
          {/* Un mois sans opération lue n'est pas un mois à zéro : c'est un mois dont on ne
              sait rien, et l'invariant de la constitution le dit explicitement. */}
          <p className="today-reserve">
            Aucune opération lue sur le mois. Un mois sans opération n’est pas un mois à zéro.
          </p>
        </>
      ) : (
        <>
          <ul className="today-flow">
            {FLOW_SEGMENTS.map((segment) => {
              const value = flow[segment.key];
              // Les largeurs sont proportionnelles au REVENU, qui est la seule référence
              // commune des quatre postes. Un solde libre négatif rend une largeur nulle : une
              // barre ne représente pas un manque, elle le laisse voir par son absence.
              const width = share(Math.max(0, value), Math.max(1, flow.income));
              return (
                <li className="today-flow-segment" data-kind={segment.key} key={segment.key}>
                  <span
                    aria-hidden="true"
                    className="today-flow-bar"
                    style={{
                      ["--flow-share" as string]: `${((width ?? 0) * 100).toFixed(2)}%`,
                    }}
                  />
                  <span className="today-flow-label">{segment.label}</span>
                  <Amount
                    currency={currency}
                    signed={segment.key === "freeCashFlow"}
                    value={value}
                  />
                </li>
              );
            })}
          </ul>
          <p className="today-subline">
            <span className="today-label">
              Du {formatDate(flow.periodStart)} au {formatDate(flow.periodEnd)}
            </span>
          </p>
          {flow.reserve ? <p className="today-reserve">{flow.reserve}</p> : null}
        </>
      )}
    </section>
  );
}

function Trajectory({ answer, goal }: { answer: AnswerView; goal: GoalTrajectoryView | null }) {
  return (
    <section aria-label={answer.question} className="today-trajectory">
      <p className="today-question">{answer.question}</p>
      {goal === null ? (
        <>
          <p className="today-figure small">
            <Unavailable answer={answer} />
          </p>
          <p className="today-reserve">
            Aucun objectif actif : une trajectoire suppose une cible datée.
          </p>
        </>
      ) : (
        <>
          <p className="today-goal-name">{goal.name}</p>
          {goal.progress === null ? (
            <p className="today-reserve">
              {goal.reserve ?? "La progression vers cet objectif n’est pas calculable."}
            </p>
          ) : (
            <div
              className="today-track"
              // `progressbar` et non une barre décorative : la progression est une valeur, et
              // un lecteur d'écran doit l'entendre.
              role="progressbar"
              aria-valuemax={100}
              aria-valuemin={0}
              aria-valuenow={Math.round(goal.progress * 100)}
              aria-valuetext={`${Math.round(goal.progress * 100)} % de l’objectif`}
              style={{ ["--goal-share" as string]: `${(goal.progress * 100).toFixed(2)}%` }}
            >
              <span className="today-track-fill" />
              <span className="today-track-value">{Math.round(goal.progress * 100)} %</span>
            </div>
          )}
          <p className="today-subline">
            <span className="today-label">
              {goal.targetDate
                ? `Échéance au ${formatDate(goal.targetDate)}`
                : "Sans échéance déclarée"}
            </span>
          </p>
        </>
      )}
    </section>
  );
}

function Obligations({
  obligations,
  currency,
}: {
  obligations: readonly ObligationView[];
  currency: string;
}) {
  return (
    <section aria-label="Échéances à trente jours" className="today-obligations">
      <p className="today-question">Qu’est-ce qui tombe dans les trente jours ?</p>
      {obligations.length === 0 ? (
        <p className="today-reserve">
          Aucune échéance contractuelle datée dans les trente jours. Une récurrence non confirmée
          n’en est pas une.
        </p>
      ) : (
        <ul className="today-obligation-list">
          {obligations.map((obligation) => (
            <li key={obligation.id}>
              <span className="today-obligation-date">
                {formatDate(obligation.date, { day: "numeric", month: "short" })}
              </span>
              <span className="today-obligation-label">
                <strong>{obligation.label}</strong>
                <small>
                  {obligation.domainLabel} · {obligation.evidenceLabel}
                </small>
              </span>
              {/* Une échéance sans montant connu existe : une fin de bail, une expiration
                  d'assurance. Le §20 interdit de la compter zéro. */}
              {obligation.amount === null ? (
                <span className="today-unavailable" data-state="UNKNOWN_ACTIVATABLE">
                  Montant inconnu
                </span>
              ) : (
                <Amount currency={currency} signed value={-obligation.amount} />
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export interface TodayCanvasProps {
  model: TodayReadModel;
  /** Ouvre la boîte de réception. La zone F du §17 y renvoie, elle ne l'inclut pas. */
  onOpenInbox: () => void;
}

export function TodayCanvas({ model, onOpenInbox }: TodayCanvasProps) {
  const [netWorth, cash, delta, flow, trajectory, decision] = model.answers;
  const currency = model.reportingCurrency;
  return (
    <div className="today-canvas">
      <Stock cash={cash!} currency={currency} netWorth={netWorth!} />
      <Delta
        answer={delta!}
        change={model.closeChange}
        currency={currency}
        reserve={model.closeChangeReserve}
      />
      <Ribbon answer={flow!} currency={currency} flow={model.monthFlow} />
      <Trajectory answer={trajectory!} goal={model.goalTrajectory} />
      <Obligations currency={currency} obligations={model.obligations} />
      <section aria-label={decision!.question} className="today-decision">
        <p className="today-question">{decision!.question}</p>
        <button className="today-inbox-entry" onClick={onOpenInbox} type="button">
          <span className="today-inbox-count">{model.inbox.pendingCount}</span>
          <span>
            {model.inbox.pendingCount === 0
              ? "Rien n’attend votre décision"
              : model.inbox.pendingCount === 1
                ? "élément attend votre décision"
                : "éléments attendent votre décision"}
          </span>
        </button>
      </section>
    </div>
  );
}

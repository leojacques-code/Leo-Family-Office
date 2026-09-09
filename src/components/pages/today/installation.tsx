"use client";

import { useState } from "react";
import { Check, CircleDashed, CircleSlash, HelpCircle } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type {
  DeclarableDomain,
  DomainApplicability,
  DomainStatusView,
  InstallationPath,
  InstallationStep,
} from "@/lib/presentation/today/contracts";
import { applicabilityLabel } from "@/lib/presentation/today/onboarding";
import { formatDate } from "@/components/pages/shared";

/**
 * Parcours d'installation (§19.2) et écran de cadrage des domaines (§18.1).
 *
 * LE CRITÈRE D'ACCEPTATION DU §11 EST CE COMPOSANT. « Un profil vide obtient un parcours
 * d'installation, pas une succession d'erreurs. » Avant, un profil vide arrivait sur quatre
 * cartes « Non calculable », une bande de badges de provenance et un panneau « Risque
 * principal » affichant un code de moteur. Rien n'y disait quoi faire.
 *
 * « JE N'AI PAS DE BIEN / SOCIÉTÉ / DETTE » EST UN BOUTON, pas une absence de clic. Le §18.1 :
 * « la réponse `Non concerné` devient `DECLARED_NONE`. Elle n'est jamais traitée comme une
 * donnée inconnue ou une erreur. » La réponse est PERSISTÉE — table append-only, RPC dédiée —
 * de sorte qu'elle survit au rechargement. Une réponse oubliée à chaque visite n'est pas une
 * réponse, c'est une question reposée.
 *
 * TROIS RÉPONSES ET NON DEUX. Le §18.1 en énumère trois : « Oui, non, je ne sais pas encore ».
 * La troisième n'est pas un doublon de l'absence : elle dit que la question a été VUE, ce qui
 * la retire du parcours bloquant sans la faire disparaître.
 */

const STATUS_ICONS: Readonly<Record<InstallationStep["status"], LucideIcon>> = {
  DONE: Check,
  TODO: CircleDashed,
  DECLARED_NONE: CircleSlash,
  UNDECIDED: HelpCircle,
};

const STATUS_LABELS: Readonly<Record<InstallationStep["status"], string>> = {
  DONE: "Fait",
  TODO: "À faire",
  // « Sans objet » et non « ignoré » : l'utilisateur n'a pas sauté l'étape, il a répondu.
  DECLARED_NONE: "Sans objet",
  UNDECIDED: "En attente",
};

/** Les trois réponses du §18.1, dans son ordre. */
const ANSWERS: readonly { value: DomainApplicability; label: string }[] = [
  { value: "APPLICABLE", label: "Oui" },
  { value: "DECLARED_NONE", label: "Non" },
  { value: "UNDECIDED", label: "Je ne sais pas encore" },
];

export interface InstallationProps {
  path: InstallationPath;
  domains: readonly DomainStatusView[];
  /** Écrit une déclaration. La page la porte : ce composant ne parle pas au réseau. */
  onDeclare: (domain: DeclarableDomain, applicability: DomainApplicability) => void;
  busy: boolean;
  /** En démonstration, aucune écriture n'est proposée : la lecture est le contrat. */
  readOnly: boolean;
}

export function Installation({ path, domains, onDeclare, busy, readOnly }: InstallationProps) {
  const [openDomain, setOpenDomain] = useState<DeclarableDomain | null>(null);
  // Les domaines à qualifier sont ceux qui n'ont NI fait NI réponse. Un domaine qui porte
  // déjà des faits n'a pas besoin d'être déclaré applicable : les faits le disent mieux
  // qu'une case, et le redemander serait le formulaire redondant que le §18 reproche.
  const toQualify = domains.filter(
    (domain) => !domain.hasFacts && domain.applicability === "UNDECLARED",
  );

  return (
    <section aria-label="Installation" className="today-installation">
      <header className="installation-head">
        <h2>Installation</h2>
        <p className="installation-progress">
          {path.done} sur {path.applicable}
          {/* Une étape close par « je ne suis pas concerné » ne compte pas comme applicable :
              un profil sans bien, sans société et sans dette afficherait sinon « 2 sur 4 »
              alors qu'il a terminé. */}
          {path.applicable < path.steps.length
            ? ` · ${path.steps.length - path.applicable} sans objet`
            : ""}
        </p>
      </header>

      <ol className="installation-steps">
        {path.steps.map((step) => {
          const Icon = STATUS_ICONS[step.status];
          return (
            <li className="installation-step" data-status={step.status} key={step.id}>
              <span aria-hidden="true" className="installation-step-icon">
                <Icon size={16} strokeWidth={2} />
              </span>
              <span className="installation-step-text">
                <strong>{step.label}</strong>
                <small>{step.reason}</small>
              </span>
              <span className="installation-step-status">{STATUS_LABELS[step.status]}</span>
              {step.status === "TODO" || step.status === "UNDECIDED" ? (
                <a className="button secondary" href={step.href}>
                  Ouvrir
                </a>
              ) : null}
            </li>
          );
        })}
      </ol>

      {toQualify.length > 0 && !readOnly ? (
        <div className="installation-qualify">
          <h3>Êtes-vous concerné ?</h3>
          {/* Une seule phrase, §3 de V10 : « one sentence, maximum three actions » pour un
              état vide. Les trois actions sont les trois réponses. */}
          <p className="installation-hint">
            Répondre « non » clôt le domaine : il cesse d’apparaître et de demander quoi que ce
            soit, et vous pourrez le rouvrir à tout moment.
          </p>
          <ul className="installation-domains">
            {toQualify.map((domain) => (
              <li key={domain.domain}>
                <span className="installation-domain-label">{domain.label}</span>
                <span className="installation-answers">
                  {ANSWERS.map((answer) => (
                    <button
                      className="installation-answer"
                      disabled={busy}
                      key={answer.value}
                      onClick={() => onDeclare(domain.domain, answer.value)}
                      type="button"
                    >
                      {answer.label}
                    </button>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* Les domaines DÉJÀ déclarés restent visibles et réversibles. Un « non » définitif et
          invisible serait une porte fermée : le §18.3 exige qu'« une section conditionnelle
          redevienne masquée sans perdre silencieusement ses données ». */}
      {domains.some((domain) => domain.applicability !== "UNDECLARED") ? (
        <details className="installation-declared">
          <summary>Vos réponses</summary>
          <ul>
            {domains
              .filter((domain) => domain.applicability !== "UNDECLARED")
              .map((domain) => (
                <li key={domain.domain}>
                  <span className="installation-domain-label">{domain.label}</span>
                  <span className="installation-domain-answer">
                    {applicabilityLabel(domain.applicability)}
                    {domain.declaredOn ? ` · le ${formatDate(domain.declaredOn)}` : ""}
                  </span>
                  {readOnly ? null : openDomain === domain.domain ? (
                    <span className="installation-answers">
                      {ANSWERS.map((answer) => (
                        <button
                          className="installation-answer"
                          disabled={busy}
                          key={answer.value}
                          onClick={() => {
                            onDeclare(domain.domain, answer.value);
                            setOpenDomain(null);
                          }}
                          type="button"
                        >
                          {answer.label}
                        </button>
                      ))}
                    </span>
                  ) : (
                    <button
                      className="button tertiary"
                      onClick={() => setOpenDomain(domain.domain)}
                      type="button"
                    >
                      Changer
                    </button>
                  )}
                </li>
              ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}

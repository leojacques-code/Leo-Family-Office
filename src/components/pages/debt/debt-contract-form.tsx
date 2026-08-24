"use client";

import { useState, type FormEvent } from "react";
import { Plus, Save, Trash2 } from "lucide-react";

import type { DebtContractInput } from "@/lib/data/contracts";
import type { Liability } from "@/lib/types";

function nextYear(date: string): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  parsed.setUTCFullYear(parsed.getUTCFullYear() + 1);
  return parsed.toISOString().slice(0, 10);
}

function blankContract(asOfDate: string): DebtContractInput {
  return {
    liabilityId: null,
    name: "",
    lender: "",
    principal: 0,
    initialBalance: 0,
    balanceDate: asOfDate,
    annualRate: 0,
    paymentAmount: 0,
    paymentCount: 12,
    firstPaymentDate: asOfDate,
    maturityDate: nextYear(asOfDate),
    amortisationProfile: "AMORTIZING",
    balloonAmount: null,
    paymentFrequency: "MONTHLY",
    interestConvention: "PROPORTIONAL",
    rateType: "FIXED",
    insuranceAmount: null,
    recurringFees: null,
    paymentIncludesInsurance: null,
    deferral: null,
    facilityId: null,
    notes: null,
    rateSchedule: [],
    paymentSchedule: [],
    earlyRepayments: [],
    charges: [],
    providedSchedule: [],
  };
}

function fromLiability(loan: Liability): DebtContractInput {
  return {
    liabilityId: loan.id,
    name: loan.name,
    lender: loan.lender,
    principal: loan.principal,
    initialBalance: null,
    balanceDate: null,
    annualRate: loan.annualRate,
    paymentAmount: loan.monthlyPayment,
    paymentCount: loan.paymentCount,
    firstPaymentDate: loan.firstPaymentDate,
    maturityDate: loan.maturityDate,
    amortisationProfile: loan.amortisationProfile,
    balloonAmount: loan.balloonAmount,
    paymentFrequency: loan.paymentFrequency,
    interestConvention: loan.interestConvention,
    rateType: loan.rateType,
    insuranceAmount: loan.monthlyInsurance,
    recurringFees: loan.recurringFees,
    paymentIncludesInsurance: loan.paymentIncludesInsurance,
    deferral: loan.deferral
      ? {
          kind: loan.deferral.kind === "NONE" ? "PRINCIPAL_ONLY" : loan.deferral.kind,
          months: loan.deferral.months,
          interestTreatment: loan.deferral.interestTreatment,
        }
      : null,
    facilityId: loan.facilityId,
    notes: loan.provenance.notes ?? null,
    rateSchedule: loan.rateSchedule.map((change) => ({ ...change })),
    paymentSchedule: loan.paymentSchedule.map((change) => ({ ...change })),
    earlyRepayments: loan.earlyRepayments.map((repayment) => ({
      id: repayment.id,
      date: repayment.date,
      amount: repayment.amount,
      penalty: repayment.penalty,
      outcome: repayment.outcome,
    })),
    charges: loan.oneOffCharges.map((charge) => ({
      id: charge.id,
      date: charge.date,
      amount: charge.amount,
      label: charge.label,
      financed: charge.financed,
    })),
    providedSchedule: loan.providedSchedule.map((row) => ({ ...row })),
  };
}

const number = (value: string) => Number(value.replace(",", "."));
const nullableNumber = (value: string) => (value === "" ? null : number(value));

export function DebtContractForm({
  loan,
  asOfDate,
  busy,
  onSave,
  onCancel,
}: {
  loan: Liability | null;
  asOfDate: string;
  busy: boolean;
  onSave: (contract: DebtContractInput) => Promise<boolean>;
  onCancel: () => void;
}) {
  const [contract, setContract] = useState<DebtContractInput>(() =>
    loan ? fromLiability(loan) : blankContract(asOfDate),
  );

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (await onSave(contract)) onCancel();
  }

  return (
    <form className="form-grid debt-contract-form" onSubmit={submit}>
      <label>
        Nom de la dette
        <input
          className="text-input"
          value={contract.name}
          onChange={(event) => setContract({ ...contract, name: event.target.value })}
          required
        />
      </label>
      <label>
        Prêteur
        <input
          className="text-input"
          value={contract.lender}
          onChange={(event) => setContract({ ...contract, lender: event.target.value })}
          required
        />
      </label>
      <label>
        Capital contractuel
        <input
          className="text-input"
          type="number"
          min="0"
          step="0.01"
          value={contract.principal}
          onChange={(event) => setContract({ ...contract, principal: number(event.target.value) })}
          required
        />
      </label>
      {!loan ? (
        <label>
          Encours observé initial
          <input
            className="text-input"
            type="number"
            min="0"
            step="0.01"
            value={contract.initialBalance ?? ""}
            onChange={(event) =>
              setContract({ ...contract, initialBalance: nullableNumber(event.target.value) })
            }
            required
          />
        </label>
      ) : null}
      {!loan ? (
        <label>
          Date de l’encours initial
          <input
            className="text-input"
            type="date"
            value={contract.balanceDate ?? ""}
            onChange={(event) => setContract({ ...contract, balanceDate: event.target.value })}
            required
          />
        </label>
      ) : null}
      <label>
        Taux annuel
        <div className="suffix-input">
          <input
            type="number"
            min="0"
            step="0.001"
            value={contract.annualRate * 100}
            onChange={(event) =>
              setContract({ ...contract, annualRate: number(event.target.value) / 100 })
            }
            required
          />
          <span>%</span>
        </div>
      </label>
      <label>
        Paiement par échéance
        <input
          className="text-input"
          type="number"
          min="0"
          step="0.01"
          value={contract.paymentAmount}
          onChange={(event) =>
            setContract({ ...contract, paymentAmount: number(event.target.value) })
          }
          required
        />
      </label>
      <label>
        Nombre d’échéances
        <input
          className="text-input"
          type="number"
          min="1"
          step="1"
          value={contract.paymentCount}
          onChange={(event) =>
            setContract({ ...contract, paymentCount: number(event.target.value) })
          }
          required
        />
      </label>
      <label>
        Première échéance
        <input
          className="text-input"
          type="date"
          value={contract.firstPaymentDate}
          onChange={(event) => setContract({ ...contract, firstPaymentDate: event.target.value })}
          required
        />
      </label>
      <label>
        Maturité contractuelle
        <input
          className="text-input"
          type="date"
          value={contract.maturityDate}
          onChange={(event) => setContract({ ...contract, maturityDate: event.target.value })}
          required
        />
      </label>

      <details className="debt-advanced full">
        <summary>Conditions avancées et événements</summary>
        <div className="form-grid">
          <label>
            Profil d’amortissement
            <select
              className="text-input"
              value={contract.amortisationProfile}
              onChange={(event) =>
                setContract({
                  ...contract,
                  amortisationProfile: event.target
                    .value as DebtContractInput["amortisationProfile"],
                })
              }
            >
              <option value="AMORTIZING">Amortissable</option>
              <option value="INTEREST_ONLY">Intérêts seuls</option>
              <option value="BULLET">In fine</option>
              <option value="BALLOON">Balloon</option>
            </select>
          </label>
          <label>
            Périodicité
            <select
              className="text-input"
              value={contract.paymentFrequency}
              onChange={(event) =>
                setContract({
                  ...contract,
                  paymentFrequency: event.target.value as DebtContractInput["paymentFrequency"],
                })
              }
            >
              <option value="MONTHLY">Mensuelle</option>
              <option value="QUARTERLY">Trimestrielle</option>
              <option value="SEMIANNUAL">Semestrielle</option>
              <option value="ANNUAL">Annuelle</option>
            </select>
          </label>
          <label>
            Convention d’intérêt
            <select
              className="text-input"
              value={contract.interestConvention}
              onChange={(event) =>
                setContract({
                  ...contract,
                  interestConvention: event.target.value as DebtContractInput["interestConvention"],
                })
              }
            >
              <option value="PROPORTIONAL">Proportionnelle à la période</option>
              <option value="ACTUAL_365">Jours réels / 365</option>
            </select>
          </label>
          <label>
            Type de taux
            <select
              className="text-input"
              value={contract.rateType}
              onChange={(event) =>
                setContract({ ...contract, rateType: event.target.value as "FIXED" | "VARIABLE" })
              }
            >
              <option value="FIXED">Fixe</option>
              <option value="VARIABLE">Révisable</option>
            </select>
          </label>
          {contract.amortisationProfile === "BALLOON" ? (
            <label>
              Solde balloon
              <input
                className="text-input"
                type="number"
                min="0"
                step="0.01"
                value={contract.balloonAmount ?? ""}
                onChange={(event) =>
                  setContract({ ...contract, balloonAmount: nullableNumber(event.target.value) })
                }
                required
              />
            </label>
          ) : null}
          <label>
            Assurance par échéance (vide = inconnue)
            <input
              className="text-input"
              type="number"
              min="0"
              step="0.01"
              value={contract.insuranceAmount ?? ""}
              onChange={(event) =>
                setContract({ ...contract, insuranceAmount: nullableNumber(event.target.value) })
              }
            />
          </label>
          <label>
            Frais récurrents (vide = inconnus)
            <input
              className="text-input"
              type="number"
              min="0"
              step="0.01"
              value={contract.recurringFees ?? ""}
              onChange={(event) =>
                setContract({ ...contract, recurringFees: nullableNumber(event.target.value) })
              }
            />
          </label>
          <label>
            Assurance dans le paiement
            <select
              className="text-input"
              value={
                contract.paymentIncludesInsurance === null
                  ? "UNKNOWN"
                  : contract.paymentIncludesInsurance
                    ? "YES"
                    : "NO"
              }
              onChange={(event) =>
                setContract({
                  ...contract,
                  paymentIncludesInsurance:
                    event.target.value === "UNKNOWN" ? null : event.target.value === "YES",
                })
              }
            >
              <option value="UNKNOWN">Non renseigné</option>
              <option value="YES">Incluse</option>
              <option value="NO">En sus</option>
            </select>
          </label>
          <label>
            Différé
            <select
              className="text-input"
              value={contract.deferral?.kind ?? "NONE"}
              onChange={(event) =>
                setContract({
                  ...contract,
                  deferral:
                    event.target.value === "NONE"
                      ? null
                      : {
                          kind: event.target.value as "PRINCIPAL_ONLY" | "TOTAL",
                          months: contract.deferral?.months ?? 1,
                          interestTreatment: contract.deferral?.interestTreatment ?? "UNKNOWN",
                        },
                })
              }
            >
              <option value="NONE">Aucun</option>
              <option value="PRINCIPAL_ONLY">Capital seulement</option>
              <option value="TOTAL">Total</option>
            </select>
          </label>
          {contract.deferral ? (
            <>
              <label>
                Échéances différées
                <input
                  className="text-input"
                  type="number"
                  min="1"
                  value={contract.deferral.months}
                  onChange={(event) =>
                    setContract({
                      ...contract,
                      deferral: { ...contract.deferral!, months: number(event.target.value) },
                    })
                  }
                />
              </label>
              <label>
                Traitement des intérêts
                <select
                  className="text-input"
                  value={contract.deferral.interestTreatment}
                  onChange={(event) =>
                    setContract({
                      ...contract,
                      deferral: {
                        ...contract.deferral!,
                        interestTreatment: event.target.value as "PAID" | "CAPITALISED" | "UNKNOWN",
                      },
                    })
                  }
                >
                  <option value="UNKNOWN">Inconnu</option>
                  <option value="PAID">Payés</option>
                  <option value="CAPITALISED">Capitalisés</option>
                </select>
              </label>
            </>
          ) : null}
          <label>
            Identifiant de facilité (optionnel)
            <input
              className="text-input"
              value={contract.facilityId ?? ""}
              onChange={(event) =>
                setContract({ ...contract, facilityId: event.target.value || null })
              }
            />
          </label>
          <label className="full">
            Notes contractuelles
            <textarea
              className="text-input debt-textarea"
              value={contract.notes ?? ""}
              onChange={(event) => setContract({ ...contract, notes: event.target.value || null })}
            />
          </label>
        </div>

        <NestedSection
          title="Révisions de taux"
          onAdd={() =>
            setContract({
              ...contract,
              rateSchedule: [
                ...contract.rateSchedule,
                { effectiveFrom: asOfDate, annualRate: contract.annualRate, kind: "CONTRACTUAL" },
              ],
            })
          }
        >
          {contract.rateSchedule.map((change, index) => (
            <div className="debt-editor-row" key={`${change.effectiveFrom}-${index}`}>
              <input
                className="text-input"
                type="date"
                value={change.effectiveFrom}
                onChange={(event) => {
                  const rows = [...contract.rateSchedule];
                  rows[index] = { ...change, effectiveFrom: event.target.value };
                  setContract({ ...contract, rateSchedule: rows });
                }}
              />
              <input
                className="text-input"
                type="number"
                min="0"
                step="0.001"
                value={change.annualRate * 100}
                onChange={(event) => {
                  const rows = [...contract.rateSchedule];
                  rows[index] = { ...change, annualRate: number(event.target.value) / 100 };
                  setContract({ ...contract, rateSchedule: rows });
                }}
              />
              <select
                className="text-input"
                value={change.kind}
                onChange={(event) => {
                  const rows = [...contract.rateSchedule];
                  rows[index] = {
                    ...change,
                    kind: event.target.value as "CONTRACTUAL" | "ASSUMPTION",
                  };
                  setContract({ ...contract, rateSchedule: rows });
                }}
              >
                <option value="CONTRACTUAL">Contractuel</option>
                <option value="ASSUMPTION">Hypothèse</option>
              </select>
              <RemoveButton
                onClick={() =>
                  setContract({
                    ...contract,
                    rateSchedule: contract.rateSchedule.filter((_, row) => row !== index),
                  })
                }
              />
            </div>
          ))}
        </NestedSection>

        <NestedSection
          title="Paliers de paiement"
          onAdd={() =>
            setContract({
              ...contract,
              paymentSchedule: [
                ...contract.paymentSchedule,
                { effectiveFrom: asOfDate, amount: contract.paymentAmount, kind: "CONTRACTUAL" },
              ],
            })
          }
        >
          {contract.paymentSchedule.map((change, index) => (
            <div className="debt-editor-row" key={`${change.effectiveFrom}-${index}`}>
              <input
                className="text-input"
                type="date"
                value={change.effectiveFrom}
                onChange={(event) => {
                  const rows = [...contract.paymentSchedule];
                  rows[index] = { ...change, effectiveFrom: event.target.value };
                  setContract({ ...contract, paymentSchedule: rows });
                }}
              />
              <input
                className="text-input"
                type="number"
                min="0"
                step="0.01"
                value={change.amount}
                onChange={(event) => {
                  const rows = [...contract.paymentSchedule];
                  rows[index] = { ...change, amount: number(event.target.value) };
                  setContract({ ...contract, paymentSchedule: rows });
                }}
              />
              <select
                className="text-input"
                value={change.kind}
                onChange={(event) => {
                  const rows = [...contract.paymentSchedule];
                  rows[index] = {
                    ...change,
                    kind: event.target.value as "CONTRACTUAL" | "ASSUMPTION",
                  };
                  setContract({ ...contract, paymentSchedule: rows });
                }}
              >
                <option value="CONTRACTUAL">Contractuel</option>
                <option value="ASSUMPTION">Hypothèse</option>
              </select>
              <RemoveButton
                onClick={() =>
                  setContract({
                    ...contract,
                    paymentSchedule: contract.paymentSchedule.filter((_, row) => row !== index),
                  })
                }
              />
            </div>
          ))}
        </NestedSection>

        <NestedSection
          title="Remboursements anticipés"
          onAdd={() =>
            setContract({
              ...contract,
              earlyRepayments: [
                ...contract.earlyRepayments,
                {
                  id: crypto.randomUUID(),
                  date: asOfDate,
                  amount: 0,
                  penalty: null,
                  outcome: "UNKNOWN",
                },
              ],
            })
          }
        >
          {contract.earlyRepayments.map((repayment, index) => (
            <div className="debt-editor-row five" key={repayment.id}>
              <input
                className="text-input"
                type="date"
                value={repayment.date}
                onChange={(event) => {
                  const rows = [...contract.earlyRepayments];
                  rows[index] = { ...repayment, date: event.target.value };
                  setContract({ ...contract, earlyRepayments: rows });
                }}
              />
              <input
                className="text-input"
                type="number"
                min="0.01"
                step="0.01"
                placeholder="Capital"
                value={repayment.amount}
                onChange={(event) => {
                  const rows = [...contract.earlyRepayments];
                  rows[index] = { ...repayment, amount: number(event.target.value) };
                  setContract({ ...contract, earlyRepayments: rows });
                }}
              />
              <input
                className="text-input"
                type="number"
                min="0"
                step="0.01"
                placeholder="Indemnité inconnue"
                value={repayment.penalty ?? ""}
                onChange={(event) => {
                  const rows = [...contract.earlyRepayments];
                  rows[index] = { ...repayment, penalty: nullableNumber(event.target.value) };
                  setContract({ ...contract, earlyRepayments: rows });
                }}
              />
              <select
                className="text-input"
                value={repayment.outcome}
                onChange={(event) => {
                  const rows = [...contract.earlyRepayments];
                  rows[index] = {
                    ...repayment,
                    outcome: event.target
                      .value as DebtContractInput["earlyRepayments"][number]["outcome"],
                  };
                  setContract({ ...contract, earlyRepayments: rows });
                }}
              >
                <option value="UNKNOWN">Convention inconnue</option>
                <option value="SHORTEN_TERM">Durée réduite</option>
                <option value="REDUCE_PAYMENT">Paiement réduit</option>
              </select>
              <RemoveButton
                onClick={() =>
                  setContract({
                    ...contract,
                    earlyRepayments: contract.earlyRepayments.filter((_, row) => row !== index),
                  })
                }
              />
            </div>
          ))}
        </NestedSection>

        <NestedSection
          title="Frais ponctuels"
          onAdd={() =>
            setContract({
              ...contract,
              charges: [
                ...contract.charges,
                { id: crypto.randomUUID(), date: asOfDate, amount: 0, label: "", financed: false },
              ],
            })
          }
        >
          {contract.charges.map((charge, index) => (
            <div className="debt-editor-row five" key={charge.id}>
              <input
                className="text-input"
                type="date"
                value={charge.date}
                onChange={(event) => {
                  const rows = [...contract.charges];
                  rows[index] = { ...charge, date: event.target.value };
                  setContract({ ...contract, charges: rows });
                }}
              />
              <input
                className="text-input"
                value={charge.label}
                placeholder="Libellé"
                onChange={(event) => {
                  const rows = [...contract.charges];
                  rows[index] = { ...charge, label: event.target.value };
                  setContract({ ...contract, charges: rows });
                }}
              />
              <input
                className="text-input"
                type="number"
                min="0.01"
                step="0.01"
                value={charge.amount}
                onChange={(event) => {
                  const rows = [...contract.charges];
                  rows[index] = { ...charge, amount: number(event.target.value) };
                  setContract({ ...contract, charges: rows });
                }}
              />
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={charge.financed}
                  onChange={(event) => {
                    const rows = [...contract.charges];
                    rows[index] = { ...charge, financed: event.target.checked };
                    setContract({ ...contract, charges: rows });
                  }}
                />
                Financé
              </label>
              <RemoveButton
                onClick={() =>
                  setContract({
                    ...contract,
                    charges: contract.charges.filter((_, row) => row !== index),
                  })
                }
              />
            </div>
          ))}
        </NestedSection>

        <NestedSection
          title="Échéancier bancaire fourni (source ACTUAL)"
          onAdd={() =>
            setContract({
              ...contract,
              providedSchedule: [
                ...contract.providedSchedule,
                {
                  paymentNumber: contract.providedSchedule.length + 1,
                  dueDate: asOfDate,
                  openingBalance: 0,
                  interest: 0,
                  principal: 0,
                  insurance: 0,
                  fees: 0,
                  closingBalance: 0,
                },
              ],
            })
          }
        >
          {contract.providedSchedule.map((row, index) => (
            <div className="provided-schedule-row" key={`${row.paymentNumber}-${index}`}>
              {(
                [
                  ["paymentNumber", "N°", "1"],
                  ["openingBalance", "Ouverture", "0.01"],
                  ["interest", "Intérêt", "0.01"],
                  ["principal", "Principal", "0.01"],
                  ["insurance", "Assurance", "0.01"],
                  ["fees", "Frais", "0.01"],
                  ["closingBalance", "Clôture", "0.01"],
                ] as const
              ).map(([key, placeholder, step]) => (
                <input
                  className="text-input"
                  key={key}
                  type="number"
                  min="0"
                  step={step}
                  aria-label={placeholder}
                  placeholder={placeholder}
                  value={row[key]}
                  onChange={(event) => {
                    const rows = [...contract.providedSchedule];
                    rows[index] = { ...row, [key]: number(event.target.value) };
                    setContract({ ...contract, providedSchedule: rows });
                  }}
                />
              ))}
              <input
                className="text-input"
                type="date"
                value={row.dueDate}
                onChange={(event) => {
                  const rows = [...contract.providedSchedule];
                  rows[index] = { ...row, dueDate: event.target.value };
                  setContract({ ...contract, providedSchedule: rows });
                }}
              />
              <RemoveButton
                onClick={() =>
                  setContract({
                    ...contract,
                    providedSchedule: contract.providedSchedule.filter(
                      (_, rowIndex) => rowIndex !== index,
                    ),
                  })
                }
              />
            </div>
          ))}
        </NestedSection>
      </details>

      <div className="form-actions">
        <button type="button" className="button secondary" onClick={onCancel}>
          Annuler
        </button>
        <button className="button primary" disabled={busy}>
          <Save size={15} />
          Enregistrer atomiquement
        </button>
      </div>
    </form>
  );
}

function NestedSection({
  title,
  onAdd,
  children,
}: {
  title: string;
  onAdd: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className="debt-nested-editor">
      <header>
        <strong>{title}</strong>
        <button type="button" className="button secondary compact" onClick={onAdd}>
          <Plus size={13} /> Ajouter
        </button>
      </header>
      {children || <small>Aucune ligne déclarée.</small>}
    </section>
  );
}

function RemoveButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="icon-button" onClick={onClick} aria-label="Supprimer la ligne">
      <Trash2 size={14} />
    </button>
  );
}

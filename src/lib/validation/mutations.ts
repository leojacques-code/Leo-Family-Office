import { z } from "zod";

import { AS_OF_DATE } from "@/lib/data/shared";
import {
  LEDGER_COVERAGE_SOURCES,
  LOT_MATCHING_METHODS,
  PORTFOLIO_EVENT_TYPES,
  REAL_ESTATE_CAPITAL_EVENT_TYPES,
  REAL_ESTATE_USAGES,
  REAL_ESTATE_VALUATION_METHODS,
} from "@/lib/types";

const finite = z.number().finite();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
/**
 * `date` ne vérifie que la forme. Un 2026-02-31 la satisfait sans exister : la profondeur
 * d'historique est comparée à des bornes de mois, une date fantôme y produirait des
 * dénominateurs faux plutôt qu'une erreur visible.
 */
function isRealCalendarDate(value: string): boolean {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

const cashFlowKind = z.enum([
  "INCOME",
  "EXPENSE",
  "INTERNAL_TRANSFER",
  "INVESTMENT",
  "SAVING",
  "DEBT_SERVICE",
  "TAX",
  "REFUND",
  "OTHER_INFLOW",
  "OTHER_OUTFLOW",
  "UNCLASSIFIED",
]);
const essentiality = z.enum(["ESSENTIAL", "NON_ESSENTIAL", "UNKNOWN"]);
const expenseBehavior = z.enum(["FIXED", "VARIABLE", "DISCRETIONARY", "UNKNOWN"]);

const realDate = date.refine(isRealCalendarDate, "Date inexistante au calendrier");
const nullableMoney = finite.nonnegative().nullable();
const datedTermKind = z.enum(["CONTRACTUAL", "ASSUMPTION"]);
const debtContractSchema = z
  .object({
    liabilityId: z.uuid().nullable(),
    name: z.string().trim().min(1).max(160),
    lender: z.string().trim().min(1).max(160),
    principal: finite.nonnegative(),
    initialBalance: nullableMoney,
    balanceDate: realDate.nullable(),
    annualRate: finite.min(0).max(10),
    paymentAmount: finite.nonnegative(),
    paymentCount: z.number().int().positive().max(1200),
    firstPaymentDate: realDate,
    maturityDate: realDate,
    amortisationProfile: z.enum(["AMORTIZING", "INTEREST_ONLY", "BULLET", "BALLOON"]),
    balloonAmount: nullableMoney,
    paymentFrequency: z.enum(["MONTHLY", "QUARTERLY", "SEMIANNUAL", "ANNUAL"]),
    interestConvention: z.enum(["PROPORTIONAL", "ACTUAL_365"]),
    rateType: z.enum(["FIXED", "VARIABLE"]),
    insuranceAmount: nullableMoney,
    recurringFees: nullableMoney,
    paymentIncludesInsurance: z.boolean().nullable(),
    deferral: z
      .object({
        kind: z.enum(["PRINCIPAL_ONLY", "TOTAL"]),
        months: z.number().int().positive().max(1200),
        interestTreatment: z.enum(["PAID", "CAPITALISED", "UNKNOWN"]),
      })
      .strict()
      .nullable(),
    facilityId: z.string().trim().min(1).max(120).nullable(),
    notes: z.string().trim().max(1000).nullable(),
    rateSchedule: z.array(
      z
        .object({ effectiveFrom: realDate, annualRate: finite.min(0).max(10), kind: datedTermKind })
        .strict(),
    ),
    paymentSchedule: z.array(
      z
        .object({ effectiveFrom: realDate, amount: finite.nonnegative(), kind: datedTermKind })
        .strict(),
    ),
    earlyRepayments: z.array(
      z
        .object({
          id: z.uuid(),
          date: realDate,
          amount: finite.positive(),
          penalty: nullableMoney,
          outcome: z.enum(["SHORTEN_TERM", "REDUCE_PAYMENT", "UNKNOWN"]),
        })
        .strict(),
    ),
    charges: z.array(
      z
        .object({
          id: z.uuid(),
          date: realDate,
          amount: finite.positive(),
          label: z.string().trim().min(1).max(160),
          financed: z.boolean(),
        })
        .strict(),
    ),
    providedSchedule: z.array(
      z
        .object({
          paymentNumber: z.number().int().positive(),
          dueDate: realDate,
          openingBalance: finite.nonnegative(),
          interest: finite.nonnegative(),
          principal: finite.nonnegative(),
          insurance: finite.nonnegative(),
          fees: finite.nonnegative(),
          closingBalance: finite.nonnegative(),
        })
        .strict(),
    ),
  })
  .strict()
  .superRefine((contract, context) => {
    if (
      contract.liabilityId === null &&
      (contract.initialBalance === null || contract.balanceDate === null)
    ) {
      context.addIssue({
        code: "custom",
        message: "L’encours initial et sa date sont requis à la création",
        path: ["initialBalance"],
      });
    }
    if (contract.amortisationProfile === "BALLOON" && contract.balloonAmount === null) {
      context.addIssue({
        code: "custom",
        message: "Le solde balloon est requis pour ce profil",
        path: ["balloonAmount"],
      });
    }
    if (contract.maturityDate < contract.firstPaymentDate) {
      context.addIssue({
        code: "custom",
        message: "La maturité doit être postérieure à la première échéance",
        path: ["maturityDate"],
      });
    }
  });

/**
 * Saisie d'un événement de ledger portefeuille.
 *
 * Aucun montant ne reçoit de valeur par défaut : `null` traverse la validation tel quel
 * et signifie « inconnu ». Les cohérences économiques (un achat sans titre, une cession
 * sans quantité) sont contrôlées ici ET par la base : ce sont des non-sens, pas des
 * approximations à corriger silencieusement.
 */
const portfolioEventSchema = z
  .object({
    accountId: z.uuid(),
    type: z.enum(PORTFOLIO_EVENT_TYPES),
    eventDate: realDate,
    settlementDate: realDate.nullable(),
    securityId: z.uuid().nullable(),
    security: z
      .object({
        name: z.string().trim().min(1).max(160),
        ticker: z.string().trim().min(1).max(24).nullable(),
        isin: z.string().trim().length(12).nullable(),
        currency: z.string().length(3).nullable(),
        assetClass: z.string().trim().min(1).max(80).nullable(),
      })
      .strict()
      .nullable(),
    quantity: finite.positive().nullable(),
    unitPrice: finite.nonnegative().nullable(),
    grossAmount: finite.nonnegative().nullable(),
    feeAmount: finite.nonnegative().nullable(),
    taxAmount: finite.nonnegative().nullable(),
    envelopeCashAmount: finite.nullable(),
    currency: z.string().length(3),
    counterpartyAccountId: z.uuid().nullable(),
    transactionId: z.uuid().nullable(),
    matchedAcquisitionEventId: z.uuid().nullable(),
    externalReference: z.string().trim().min(1).max(160).nullable(),
    notes: z.string().trim().max(1000).nullable(),
  })
  .strict()
  .superRefine((event, context) => {
    const instrumentBound = ["OPENING_POSITION", "BUY", "SELL"].includes(event.type);
    const cashOnly = ["OPENING_CASH", "CONTRIBUTION", "WITHDRAWAL"].includes(event.type);
    const hasInstrument = event.securityId !== null || event.security !== null;
    if (instrumentBound && !hasInstrument) {
      context.addIssue({
        code: "custom",
        message: "Cet événement porte sur un instrument : il doit en désigner un",
        path: ["security"],
      });
    }
    if (cashOnly && hasInstrument) {
      context.addIssue({
        code: "custom",
        message: "Un mouvement de cash d’enveloppe ne porte aucun instrument",
        path: ["security"],
      });
    }
    if (
      (instrumentBound || (hasInstrument && event.type.startsWith("TRANSFER"))) &&
      event.quantity === null
    ) {
      context.addIssue({
        code: "custom",
        message: "La quantité est obligatoire sur un mouvement d’instrument",
        path: ["quantity"],
      });
    }
    if (
      event.matchedAcquisitionEventId !== null &&
      !["SELL", "TRANSFER_OUT"].includes(event.type)
    ) {
      context.addIssue({
        code: "custom",
        message: "Un lot ne se désigne qu’à la cession",
        path: ["matchedAcquisitionEventId"],
      });
    }
    if (
      event.counterpartyAccountId !== null &&
      !["CONTRIBUTION", "WITHDRAWAL", "TRANSFER_IN", "TRANSFER_OUT"].includes(event.type)
    ) {
      context.addIssue({
        code: "custom",
        message: "Une contrepartie bancaire n’a de sens que sur un flux externe",
        path: ["counterpartyAccountId"],
      });
    }
    // Un arbitrage interne ne traverse aucun compte bancaire : le rattacher à une
    // transaction ferait compter le même euro deux fois dans le Cash Flow.
    if (
      event.transactionId !== null &&
      !["CONTRIBUTION", "WITHDRAWAL", "TRANSFER_IN", "TRANSFER_OUT"].includes(event.type)
    ) {
      context.addIssue({
        code: "custom",
        message: "Seul un flux externe à l’enveloppe se rattache à une transaction bancaire",
        path: ["transactionId"],
      });
    }
    if (event.settlementDate !== null && event.settlementDate < event.eventDate) {
      context.addIssue({
        code: "custom",
        message: "Le règlement ne peut pas précéder l’opération",
        path: ["settlementDate"],
      });
    }
  });

const portfolioPolicySchema = z
  .object({
    accountId: z.uuid(),
    lotMatchingMethod: z.enum(LOT_MATCHING_METHODS).nullable(),
    ledgerCoverageStart: realDate.nullable(),
    ledgerCoverageSource: z.enum(LEDGER_COVERAGE_SOURCES).nullable(),
    notes: z.string().trim().max(1000).nullable(),
  })
  .strict()
  .superRefine((policy, context) => {
    // Une profondeur sans origine n'est pas traçable ; une origine sans profondeur ne
    // déclare rien. Les deux vont ensemble ou aucune des deux n'existe.
    if ((policy.ledgerCoverageStart === null) !== (policy.ledgerCoverageSource === null)) {
      context.addIssue({
        code: "custom",
        message: "La profondeur d’historique et son origine se déclarent ensemble",
        path: ["ledgerCoverageSource"],
      });
    }
  });

/**
 * SCHÉMAS DU DOMAINE IMMOBILIER
 *
 * Règle unique : un `null` transmis est une VALEUR, il traverse la validation intact.
 * Refuser le `null` forcerait l'interface à envoyer zéro, et « je ne sais pas » deviendrait
 * « la charge est nulle » : le rendement net calculé ensuite serait faux et flatteur.
 */
const realEstateAssetSchema = z
  .object({
    propertyId: z.uuid().nullable(),
    name: z.string().trim().min(1).max(160),
    location: z.string().trim().max(240).nullable(),
    surfaceSqm: finite.positive().nullable(),
    usage: z.enum(REAL_ESTATE_USAGES).nullable(),
    // Une quote-part nulle n'existe pas : détenir 0 % d'un bien, c'est ne pas le détenir.
    ownershipShare: finite.gt(0).max(1).nullable(),
    acquisitionDate: realDate.nullable(),
    disposalDate: realDate.nullable(),
    notes: z.string().trim().max(1000).nullable(),
  })
  .strict()
  .superRefine((asset, context) => {
    if (
      asset.acquisitionDate !== null &&
      asset.disposalDate !== null &&
      asset.disposalDate < asset.acquisitionDate
    ) {
      context.addIssue({
        code: "custom",
        message: "La cession ne peut pas précéder l’acquisition",
        path: ["disposalDate"],
      });
    }
  });

const realEstateValuationSchema = z
  .object({
    propertyId: z.uuid(),
    valuedAt: realDate,
    // Valeur du bien ENTIER : la quote-part est appliquée par le moteur, pas par la saisie.
    value: finite.nonnegative(),
    currency: z.string().trim().length(3),
    method: z.enum(REAL_ESTATE_VALUATION_METHODS),
    notes: z.string().trim().max(1000).nullable(),
  })
  .strict();

const realEstateCapitalEventSchema = z
  .object({
    propertyId: z.uuid(),
    type: z.enum(REAL_ESTATE_CAPITAL_EVENT_TYPES),
    eventDate: realDate,
    // Toujours positif : la direction économique vient du type, jamais du signe.
    amount: finite.nonnegative(),
    currency: z.string().trim().length(3),
    label: z.string().trim().max(160).nullable(),
    transactionId: z.uuid().nullable(),
    notes: z.string().trim().max(1000).nullable(),
  })
  .strict();

const realEstateOperatingTermsSchema = z
  .object({
    propertyId: z.uuid(),
    effectiveFrom: realDate,
    currency: z.string().trim().length(3),
    annualGrossRent: nullableMoney,
    vacancyRate: finite.min(0).max(1).nullable(),
    annualOperatingCharges: nullableMoney,
    annualPropertyTax: nullableMoney,
    annualInsurance: nullableMoney,
    annualMaintenance: nullableMoney,
    annualManagementFees: nullableMoney,
    managementFeeRate: finite.min(0).max(1).nullable(),
    annualOtherCosts: nullableMoney,
    effectiveIncomeTaxRate: finite.min(0).max(1).nullable(),
    notes: z.string().trim().max(1000).nullable(),
  })
  .strict()
  .superRefine((terms, context) => {
    // Les deux formes de frais de gestion s'excluent : ensemble, elles compteraient deux
    // fois la même charge. La base le refuse aussi.
    if (terms.annualManagementFees !== null && terms.managementFeeRate !== null) {
      context.addIssue({
        code: "custom",
        message:
          "Frais de gestion déclarés deux fois : un montant OU une part du loyer, jamais les deux",
        path: ["managementFeeRate"],
      });
    }
  });

const realEstateFinancingLinkSchema = z
  .object({
    propertyId: z.uuid(),
    liabilityId: z.uuid(),
    // Une part nulle n'affecte rien : c'est l'absence de rattachement, pas un rattachement.
    allocationShare: finite.gt(0).max(1),
    notes: z.string().trim().max(1000).nullable(),
  })
  .strict();

export const mutationSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("save_debt_contract"), contract: debtContractSchema }),
  z.object({
    action: z.literal("record_debt_balance"),
    liabilityId: z.uuid(),
    observedAt: realDate,
    balance: finite.nonnegative(),
    notes: z.string().trim().max(500).nullable(),
  }),
  z.object({ action: z.literal("archive_debt"), liabilityId: z.uuid() }),
  z.object({
    action: z.literal("update_account"),
    accountId: z.string().min(1),
    balance: finite,
    balanceDate: date,
  }),
  z.object({
    action: z.literal("add_account"),
    institution: z.string().min(1).max(120),
    name: z.string().min(1).max(120),
    accountType: z.enum(["BANK", "PEA", "CTO", "SAVINGS", "OTHER"]),
    balance: finite,
    currency: z.string().length(3),
  }),
  z.object({
    action: z.literal("add_transaction"),
    accountId: z.string().min(1),
    categoryId: z.string().min(1),
    date,
    label: z.string().min(1).max(180),
    amount: finite,
    updateBalance: z.boolean(),
  }),
  z.object({
    action: z.literal("update_expense"),
    categoryId: z.string().min(1),
    monthlyAmount: finite.nonnegative().nullable(),
  }),
  z.object({
    action: z.literal("update_scenario"),
    scenarioId: z.string().min(1),
    patch: z
      .object({
        annualReturn: finite.min(-0.99).max(1).optional(),
        annualVolatility: finite.min(0).max(2).optional(),
        annualInflation: finite.min(-0.1).max(1).optional(),
        monthlySavings: finite.min(-100000).max(100000).optional(),
        investmentAllocationRate: finite.min(0).max(1).optional(),
        salaryGrowth: finite.min(-0.5).max(1).optional(),
        stressProbability: finite.min(0).max(1).optional(),
        shockYear: z.number().int().min(1).max(80).nullable().optional(),
        shockMagnitude: finite.min(-0.99).max(5).nullable().optional(),
      })
      .strict(),
  }),
  z.object({ action: z.literal("duplicate_scenario"), scenarioId: z.string().min(1) }),
  z.object({ action: z.literal("create_monthly_close"), closeDate: date }),
  z.object({
    action: z.literal("add_goal"),
    name: z.string().min(1).max(160),
    targetAmount: finite.positive(),
    targetDate: date.nullable(),
  }),
  z.object({
    action: z.literal("update_category"),
    categoryId: z.string().min(1),
    patch: z
      .object({
        name: z.string().min(1).max(120).optional(),
        groupName: z.string().min(1).max(120).optional(),
        cashFlowKind: cashFlowKind.optional(),
        essentiality: essentiality.optional(),
        behavior: expenseBehavior.optional(),
        archived: z.boolean().optional(),
      })
      .strict(),
  }),
  z.object({
    action: z.literal("add_category"),
    name: z.string().min(1).max(120),
    groupName: z.string().min(1).max(120),
    cashFlowKind,
    essentiality,
    behavior: expenseBehavior,
  }),
  z.object({
    action: z.literal("classify_transaction"),
    transactionId: z.string().min(1),
    categoryId: z.string().min(1).optional(),
    kindOverride: cashFlowKind.nullable().optional(),
    transferGroupId: z.string().min(1).max(64).nullable().optional(),
    notes: z.string().max(500).nullable().optional(),
  }),
  z.object({
    action: z.literal("add_recurring_rule"),
    name: z.string().min(1).max(160),
    cashFlowKind,
    categoryId: z.string().min(1),
    accountId: z.string().min(1).nullable(),
    amount: finite.refine((value) => value !== 0, "Le montant ne peut pas être nul"),
    frequency: z.enum(["MONTHLY", "QUARTERLY", "ANNUAL"]),
    startDate: date,
    endDate: date.nullable(),
    dayOfMonth: z.number().int().min(1).max(31).nullable(),
  }),
  z.object({
    action: z.literal("update_recurring_rule"),
    ruleId: z.string().min(1),
    patch: z
      .object({
        amount: finite.optional(),
        active: z.boolean().optional(),
        endDate: date.nullable().optional(),
      })
      .strict(),
  }),
  z.object({ action: z.literal("delete_recurring_rule"), ruleId: z.string().min(1) }),
  z.object({ action: z.literal("record_portfolio_event"), event: portfolioEventSchema }),
  z.object({ action: z.literal("delete_portfolio_event"), eventId: z.uuid() }),
  z.object({ action: z.literal("set_portfolio_envelope_policy"), policy: portfolioPolicySchema }),
  z.object({
    action: z.literal("close_cash_flow_month"),
    month: z.string().regex(/^\d{4}-\d{2}$/, "Mois attendu au format AAAA-MM"),
  }),
  z.object({
    action: z.literal("set_ledger_coverage"),
    // `null` est une valeur légitime : elle remet la profondeur à « non déclarée ».
    // Une date postérieure à la date d'observation est refusée : on ne peut pas certifier
    // exhaustif un historique qui n'a pas encore eu lieu.
    startDate: date
      .refine(isRealCalendarDate, "Date inexistante au calendrier")
      .refine(
        (value) => value <= AS_OF_DATE,
        "La couverture ne peut pas être postérieure à la date d'observation",
      )
      .nullable(),
    source: z.enum(["MANUAL", "IMPORT", "API"]),
  }),
  // Les mutations immobilières sont STRICTES de bout en bout : un champ inattendu est
  // refusé plutôt que silencieusement écarté. C'est ce qui garantit qu'une attribution de
  // flux ne pourra jamais transporter un montant ou une catégorie.
  z.object({ action: z.literal("save_real_estate_asset"), asset: realEstateAssetSchema }).strict(),
  z.object({ action: z.literal("archive_real_estate_asset"), propertyId: z.uuid() }).strict(),
  z
    .object({
      action: z.literal("record_real_estate_valuation"),
      valuation: realEstateValuationSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("record_real_estate_capital_event"),
      event: realEstateCapitalEventSchema,
    })
    .strict(),
  z.object({ action: z.literal("delete_real_estate_capital_event"), eventId: z.uuid() }).strict(),
  z
    .object({
      action: z.literal("set_real_estate_operating_terms"),
      terms: realEstateOperatingTermsSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("set_real_estate_financing_link"),
      link: realEstateFinancingLinkSchema,
    })
    .strict(),
  z.object({ action: z.literal("delete_real_estate_financing_link"), linkId: z.uuid() }).strict(),
  z
    .object({
      action: z.literal("attribute_transaction_to_property"),
      transactionId: z.uuid(),
      // `null` détache le flux : c'est une valeur, jamais un oubli.
      propertyId: z.uuid().nullable(),
    })
    .strict(),
]);

from pathlib import Path


def replace_once(path: str, needle: str, replacement: str) -> None:
    p = Path(path)
    text = p.read_text()
    if needle not in text:
        raise RuntimeError(f"anchor missing in {path}: {needle[:120]!r}")
    p.write_text(text.replace(needle, replacement, 1))

# DashboardState: keep compatibility with historical fixtures while repository always fills these in production.
path = 'src/lib/types.ts'
text = Path(path).read_text()
for field in ['businesses', 'businessOwnership', 'businessFinancials', 'businessValuations', 'businessCapitalEvents', 'businessHoldings']:
    text = text.replace(f'  {field}: import(', f'  {field}?: import(', 1)
Path(path).write_text(text)

# Business page: optional only for legacy fixtures; production repository supplies the arrays.
path = 'src/components/pages/business-equity/page.tsx'
text = Path(path).read_text()
text = text.replace('  const portfolio=state.businessEquity;\n', '  const portfolio=state.businessEquity;\n  const businesses=state.businesses ?? [];\n', 1)
text = text.replace('state.businesses.length===0', 'businesses.length===0')
text = text.replace('businesses={state.businesses}', 'businesses={businesses}')
Path(path).write_text(text)

# Validation contracts.
path = 'src/lib/validation/mutations.ts'
text = Path(path).read_text()
if 'BUSINESS_CAPITAL_EVENT_TYPES' not in text:
    text = text.replace(
        'import { z } from "zod";\n',
        'import { z } from "zod";\n\nimport { BUSINESS_CAPITAL_EVENT_TYPES, BUSINESS_TYPES, BUSINESS_VALUATION_METHODS } from "@/lib/engine/business-equity";\n',
        1,
    )
    schemas = '''\n/** Business Equity V2 — null means unknown, never zero. */\nconst businessSchema = z.object({\n  businessId: z.uuid().nullable(),\n  name: z.string().trim().min(1).max(160),\n  legalForm: z.string().trim().max(80).nullable(),\n  type: z.enum(BUSINESS_TYPES).nullable(),\n  functionalCurrency: z.string().trim().length(3).nullable(),\n  notes: z.string().trim().max(1000).nullable(),\n}).strict();\n\nconst businessOwnershipSchema = z.object({\n  businessId: z.uuid(),\n  effectiveDate: realDate,\n  legalRate: finite.gt(0).max(1),\n  economicRate: finite.gt(0).max(1).nullable(),\n  votingRate: finite.min(0).max(1).nullable(),\n  fullyDilutedRate: finite.gt(0).max(1).nullable(),\n  notes: z.string().trim().max(1000).nullable(),\n}).strict();\n\nconst businessFinancialSchema = z.object({\n  businessId: z.uuid(), periodEnd: realDate, currency: z.string().trim().length(3).nullable(),\n  revenue: finite.nullable(), grossMargin: finite.nullable(), ebitda: finite.nullable(),\n  ebit: finite.nullable(), netIncome: finite.nullable(), cash: finite.nonnegative().nullable(),\n  grossDebt: finite.nonnegative().nullable(), workingCapital: finite.nullable(),\n  capex: finite.nonnegative().nullable(), freeCashFlow: finite.nullable(),\n  notes: z.string().trim().max(1000).nullable(),\n}).strict();\n\nconst businessValuationSchema = z.object({\n  businessId: z.uuid(), valuationDate: realDate, currency: z.string().trim().length(3).nullable(),\n  method: z.enum(BUSINESS_VALUATION_METHODS), enterpriseValue: finite.nullable(),\n  equityValue: finite.nullable(), valuationMultiple: finite.nullable(),\n  notes: z.string().trim().max(1000).nullable(),\n}).strict().superRefine((value, context) => {\n  if (value.enterpriseValue === null && value.equityValue === null) {\n    context.addIssue({ code: "custom", message: "Enterprise Value ou Equity Value requise", path: ["equityValue"] });\n  }\n});\n\nconst businessCapitalEventSchema = z.object({\n  businessId: z.uuid(), type: z.enum(BUSINESS_CAPITAL_EVENT_TYPES), eventDate: realDate,\n  amount: finite.nonnegative(), currency: z.string().trim().length(3),\n  ownershipDelta: finite.min(-1).max(1).nullable(), transactionId: z.uuid().nullable(),\n  notes: z.string().trim().max(1000).nullable(),\n}).strict();\n\nconst businessHoldingSchema = z.object({\n  parentBusinessId: z.uuid(), childBusinessId: z.uuid(), effectiveDate: realDate,\n  ownershipRate: finite.gt(0).max(1), notes: z.string().trim().max(1000).nullable(),\n}).strict().superRefine((value, context) => {\n  if (value.parentBusinessId === value.childBusinessId) {\n    context.addIssue({ code: "custom", message: "Une société ne peut pas se détenir elle-même", path: ["childBusinessId"] });\n  }\n});\n\n'''
    text = text.replace('export const mutationSchema = z.discriminatedUnion("action", [\n', schemas + 'export const mutationSchema = z.discriminatedUnion("action", [\n', 1)
    union = '''  z.object({ action: z.literal("save_business"), business: businessSchema }).strict(),\n  z.object({ action: z.literal("archive_business"), businessId: z.uuid() }).strict(),\n  z.object({ action: z.literal("record_business_ownership"), ownership: businessOwnershipSchema }).strict(),\n  z.object({ action: z.literal("record_business_financials"), financials: businessFinancialSchema }).strict(),\n  z.object({ action: z.literal("record_business_valuation"), valuation: businessValuationSchema }).strict(),\n  z.object({ action: z.literal("record_business_capital_event"), event: businessCapitalEventSchema }).strict(),\n  z.object({ action: z.literal("set_business_holding"), holding: businessHoldingSchema }).strict(),\n'''
    text = text.replace('  z.object({ action: z.literal("save_debt_contract"), contract: debtContractSchema }),\n', union + '  z.object({ action: z.literal("save_debt_contract"), contract: debtContractSchema }),\n', 1)
Path(path).write_text(text)

# Supabase repository imports.
path = 'src/lib/data/supabase-repository.ts'
text = Path(path).read_text()
if 'buildBusinessEquityPortfolio' not in text:
    text = text.replace(
        'import { buildCanonicalBalanceSheet } from "@/lib/engine/balance-sheet";\n',
        'import { buildCanonicalBalanceSheet } from "@/lib/engine/balance-sheet";\nimport {\n  BUSINESS_CAPITAL_EVENT_TYPES,\n  BUSINESS_TYPES,\n  BUSINESS_VALUATION_METHODS,\n  buildBusinessEquityPortfolio,\n  businessEquityBalanceSheetContributions,\n  type BusinessCapitalEvent,\n  type BusinessEntity,\n  type BusinessFinancialSnapshot,\n  type BusinessHoldingLink,\n  type BusinessOwnership,\n  type BusinessValuation,\n} from "@/lib/engine/business-equity";\n',
        1,
    )

    text = text.replace(
        '      realEstateFinancingLinkRows,\n    ] = await Promise.all([',
        '      realEstateFinancingLinkRows,\n      businessRows,\n      businessOwnershipRows,\n      businessFinancialRows,\n      businessValuationRows,\n      businessCapitalEventRows,\n      businessHoldingRows,\n    ] = await Promise.all([',
        1,
    )
    text = text.replace(
        '      mine("real_estate_financing_links"),\n    ]).then',
        '      mine("real_estate_financing_links"),\n      mine("businesses"),\n      fetchAllPages("business_ownership", "effective_date"),\n      fetchAllPages("business_financials", "period_end"),\n      fetchAllPages("business_valuations", "valuation_date"),\n      fetchAllPages("business_capital_events", "event_date"),\n      fetchAllPages("business_holdings", "effective_date"),\n    ]).then',
        1,
    )

    mapping = '''\n    const businesses: BusinessEntity[] = businessRows\n      .filter((row) => row.archived !== true)\n      .map((row) => ({\n        id: str(row.id), name: str(row.name), legalForm: row.legal_form ? str(row.legal_form) : null,\n        type: row.business_type ? enumValue(str(row.business_type), BUSINESS_TYPES, `businesses[id=${str(row.id)}].business_type`) : null,\n        functionalCurrency: row.functional_currency ? str(row.functional_currency).toUpperCase() : null,\n        archived: bool(row.archived), notes: row.notes ? str(row.notes) : null, provenance: provenance(row),\n      }))\n      .sort((a, b) => a.name.localeCompare(b.name));\n    const businessIds = new Set(businesses.map((business) => business.id));\n    const businessOwnership: BusinessOwnership[] = businessOwnershipRows\n      .filter((row) => businessIds.has(str(row.business_id)))\n      .map((row) => ({\n        id: str(row.id), businessId: str(row.business_id), effectiveDate: str(row.effective_date),\n        legalRate: finiteNumber(row.ownership_rate, `business_ownership[id=${str(row.id)}].ownership_rate`),\n        economicRate: nullableFiniteNumber(row.economic_rate, `business_ownership[id=${str(row.id)}].economic_rate`),\n        votingRate: nullableFiniteNumber(row.voting_rate, `business_ownership[id=${str(row.id)}].voting_rate`),\n        fullyDilutedRate: nullableFiniteNumber(row.fully_diluted_rate, `business_ownership[id=${str(row.id)}].fully_diluted_rate`),\n        notes: row.notes ? str(row.notes) : null, provenance: provenance(row),\n      }));\n    const businessFinancials: BusinessFinancialSnapshot[] = businessFinancialRows\n      .filter((row) => businessIds.has(str(row.business_id)))\n      .map((row) => ({\n        id: str(row.id), businessId: str(row.business_id), periodEnd: str(row.period_end),\n        currency: row.currency ? str(row.currency).toUpperCase() : null,\n        revenue: nullableFiniteNumber(row.revenue, `business_financials[id=${str(row.id)}].revenue`),\n        grossMargin: nullableFiniteNumber(row.gross_margin, `business_financials[id=${str(row.id)}].gross_margin`),\n        ebitda: nullableFiniteNumber(row.ebitda, `business_financials[id=${str(row.id)}].ebitda`),\n        ebit: nullableFiniteNumber(row.ebit, `business_financials[id=${str(row.id)}].ebit`),\n        netIncome: nullableFiniteNumber(row.net_income, `business_financials[id=${str(row.id)}].net_income`),\n        cash: nullableFiniteNumber(row.cash, `business_financials[id=${str(row.id)}].cash`),\n        grossDebt: nullableFiniteNumber(row.debt, `business_financials[id=${str(row.id)}].debt`),\n        workingCapital: nullableFiniteNumber(row.working_capital, `business_financials[id=${str(row.id)}].working_capital`),\n        capex: nullableFiniteNumber(row.capex, `business_financials[id=${str(row.id)}].capex`),\n        freeCashFlow: nullableFiniteNumber(row.free_cash_flow, `business_financials[id=${str(row.id)}].free_cash_flow`),\n        notes: row.notes ? str(row.notes) : null, provenance: provenance(row),\n      }));\n    const businessValuations: BusinessValuation[] = businessValuationRows\n      .filter((row) => businessIds.has(str(row.business_id)))\n      .map((row) => ({\n        id: str(row.id), businessId: str(row.business_id), valuationDate: str(row.valuation_date),\n        currency: row.currency ? str(row.currency).toUpperCase() : null,\n        method: enumValue(str(row.method), BUSINESS_VALUATION_METHODS, `business_valuations[id=${str(row.id)}].method`),\n        enterpriseValue: nullableFiniteNumber(row.enterprise_value, `business_valuations[id=${str(row.id)}].enterprise_value`),\n        equityValue: nullableFiniteNumber(row.equity_value, `business_valuations[id=${str(row.id)}].equity_value`),\n        valuationMultiple: nullableFiniteNumber(row.valuation_multiple, `business_valuations[id=${str(row.id)}].valuation_multiple`),\n        notes: row.notes ? str(row.notes) : null, provenance: provenance(row),\n      }));\n    const businessCapitalEvents: BusinessCapitalEvent[] = businessCapitalEventRows\n      .filter((row) => businessIds.has(str(row.business_id)))\n      .map((row) => ({\n        id: str(row.id), businessId: str(row.business_id),\n        type: enumValue(str(row.event_type), BUSINESS_CAPITAL_EVENT_TYPES, `business_capital_events[id=${str(row.id)}].event_type`),\n        eventDate: str(row.event_date), amount: finiteNumber(row.amount, `business_capital_events[id=${str(row.id)}].amount`),\n        currency: str(row.currency).toUpperCase(),\n        ownershipDelta: nullableFiniteNumber(row.ownership_delta, `business_capital_events[id=${str(row.id)}].ownership_delta`),\n        transactionId: row.transaction_id ? str(row.transaction_id) : null,\n        notes: row.notes ? str(row.notes) : null, provenance: provenance(row),\n      }));\n    const businessHoldings: BusinessHoldingLink[] = businessHoldingRows\n      .filter((row) => businessIds.has(str(row.parent_business_id)) && businessIds.has(str(row.child_business_id)))\n      .map((row) => ({\n        id: str(row.id), parentBusinessId: str(row.parent_business_id), childBusinessId: str(row.child_business_id),\n        effectiveDate: str(row.effective_date), ownershipRate: finiteNumber(row.ownership_rate, `business_holdings[id=${str(row.id)}].ownership_rate`),\n        notes: row.notes ? str(row.notes) : null, provenance: provenance(row),\n      }));\n'''
    text = text.replace('    const coverage = readLedgerCoverage(profileRows[0]);\n', mapping + '\n    const coverage = readLedgerCoverage(profileRows[0]);\n', 1)

    text = text.replace(
        '    const balanceSheet = buildCanonicalBalanceSheet({\n',
        '    const businessEquity = buildBusinessEquityPortfolio({\n      asOfDate: AS_OF_DATE, reportingCurrency, businesses, ownership: businessOwnership,\n      financials: businessFinancials, valuations: businessValuations, capitalEvents: businessCapitalEvents,\n      holdings: businessHoldings, currencyRates,\n    });\n    const balanceSheet = buildCanonicalBalanceSheet({\n',
        1,
    )
    text = text.replace(
        '      contributions: realEstateBalanceSheetContributions(realEstate),\n',
        '      contributions: [\n        ...realEstateBalanceSheetContributions(realEstate),\n        ...businessEquityBalanceSheetContributions(businessEquity),\n      ],\n',
        1,
    )
    text = text.replace(
        '      realEstateFinancingLinks,\n      liabilities,\n',
        '      realEstateFinancingLinks,\n      businesses,\n      businessOwnership,\n      businessFinancials,\n      businessValuations,\n      businessCapitalEvents,\n      businessHoldings,\n      liabilities,\n',
        1,
    )
    text = text.replace(
        '      realEstate,\n      metrics: composeDashboardMetrics',
        '      realEstate,\n      businessEquity,\n      metrics: composeDashboardMetrics',
        1,
    )

    business_mutations = '''      case "save_business": {\n        const business = mutation.business;\n        unwrap(await db.rpc("lfo_save_business", { p_user_id: user, p_payload: { business_id: business.businessId, name: business.name, legal_form: business.legalForm, business_type: business.type, functional_currency: business.functionalCurrency, notes: business.notes, source: "Saisie Business Equity" } }), "enregistrement société");\n        break;\n      }\n      case "archive_business": {\n        unwrap(await db.rpc("lfo_archive_business", { p_user_id: user, p_business_id: mutation.businessId }), "archivage société");\n        break;\n      }\n      case "record_business_ownership": {\n        const value = mutation.ownership;\n        unwrap(await db.rpc("lfo_record_business_ownership", { p_user_id: user, p_payload: { business_id: value.businessId, effective_date: value.effectiveDate, legal_rate: value.legalRate, economic_rate: value.economicRate, voting_rate: value.votingRate, fully_diluted_rate: value.fullyDilutedRate, notes: value.notes, source: "Saisie Business Equity" } }), "enregistrement détention");\n        break;\n      }\n      case "record_business_financials": {\n        const value = mutation.financials;\n        unwrap(await db.rpc("lfo_record_business_financials", { p_user_id: user, p_payload: { business_id: value.businessId, period_end: value.periodEnd, currency: value.currency, revenue: value.revenue, gross_margin: value.grossMargin, ebitda: value.ebitda, ebit: value.ebit, net_income: value.netIncome, cash: value.cash, gross_debt: value.grossDebt, working_capital: value.workingCapital, capex: value.capex, free_cash_flow: value.freeCashFlow, notes: value.notes, data_kind: "ACTUAL", confidence: "HIGH", source: "Saisie Business Equity" } }), "enregistrement financiers business");\n        break;\n      }\n      case "record_business_valuation": {\n        const value = mutation.valuation;\n        unwrap(await db.rpc("lfo_record_business_valuation", { p_user_id: user, p_payload: { business_id: value.businessId, valuation_date: value.valuationDate, currency: value.currency, method: value.method, enterprise_value: value.enterpriseValue, equity_value: value.equityValue, valuation_multiple: value.valuationMultiple, notes: value.notes, assumptions: {}, data_kind: value.method === "USER_ESTIMATE" ? "USER_ASSUMPTION" : "EXTERNAL_DATA", confidence: value.method === "USER_ESTIMATE" ? "LOW" : "MEDIUM", source: "Saisie Business Equity" } }), "enregistrement valorisation business");\n        break;\n      }\n      case "record_business_capital_event": {\n        const value = mutation.event;\n        unwrap(await db.rpc("lfo_record_business_capital_event", { p_user_id: user, p_payload: { business_id: value.businessId, event_type: value.type, event_date: value.eventDate, amount: value.amount, currency: value.currency, ownership_delta: value.ownershipDelta, transaction_id: value.transactionId, notes: value.notes, data_kind: "ACTUAL", confidence: "HIGH", source: "Saisie Business Equity" } }), "enregistrement événement business");\n        break;\n      }\n      case "set_business_holding": {\n        const value = mutation.holding;\n        unwrap(await db.rpc("lfo_set_business_holding", { p_user_id: user, p_payload: { parent_business_id: value.parentBusinessId, child_business_id: value.childBusinessId, effective_date: value.effectiveDate, ownership_rate: value.ownershipRate, notes: value.notes, source: "Saisie Business Equity" } }), "rattachement holding");\n        break;\n      }\n'''
    text = text.replace('      case "save_debt_contract": {\n', business_mutations + '      case "save_debt_contract": {\n', 1)
Path(path).write_text(text)

print('Business Equity V2 completion patches applied')

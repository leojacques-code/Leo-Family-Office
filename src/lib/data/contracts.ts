// Contrats de la couche données. Aucun import serveur : ce module est importable
// depuis un composant client (import type) sans tirer "server-only" dans le bundle.
import type { BusinessCapitalEventType, BusinessType, BusinessValuationMethod } from "@/lib/engine/business-equity";
import type {
  CashFlowKind,
  DocumentRecord,
  LotMatchingMethod,
  PortfolioEventType,
  Essentiality,
  ExpenseBehavior,
  FinancialAccount,
  AmortisationProfile,
  DatedTermKind,
  DeferredInterestTreatment,
  DeferralKind,
  EarlyRepaymentOutcome,
  InterestConvention,
  LedgerCoverageSource,
  PaymentFrequency,
  RateType,
  RealEstateCapitalEventType,
  RealEstateUsage,
  RealEstateValuationMethod,
  RecurrenceFrequency,
  Scenario,
} from "@/lib/types";

export interface DebtContractInput {
  liabilityId: string | null;
  name: string;
  lender: string;
  principal: number;
  /** Requis uniquement à la création. Une édition de contrat l'ignore toujours. */
  initialBalance: number | null;
  balanceDate: string | null;
  annualRate: number;
  paymentAmount: number;
  paymentCount: number;
  firstPaymentDate: string;
  maturityDate: string;
  amortisationProfile: AmortisationProfile;
  balloonAmount: number | null;
  paymentFrequency: PaymentFrequency;
  interestConvention: InterestConvention;
  rateType: RateType;
  insuranceAmount: number | null;
  recurringFees: number | null;
  paymentIncludesInsurance: boolean | null;
  deferral: {
    kind: Exclude<DeferralKind, "NONE">;
    months: number;
    interestTreatment: DeferredInterestTreatment;
  } | null;
  facilityId: string | null;
  notes: string | null;
  rateSchedule: Array<{ effectiveFrom: string; annualRate: number; kind: DatedTermKind }>;
  paymentSchedule: Array<{ effectiveFrom: string; amount: number; kind: DatedTermKind }>;
  earlyRepayments: Array<{
    id: string;
    date: string;
    amount: number;
    penalty: number | null;
    outcome: EarlyRepaymentOutcome;
  }>;
  charges: Array<{ id: string; date: string; amount: number; label: string; financed: boolean }>;
  providedSchedule: Array<{
    paymentNumber: number;
    dueDate: string;
    openingBalance: number;
    interest: number;
    principal: number;
    insurance: number;
    fees: number;
    closingBalance: number;
  }>;
}

/**
 * Saisie d'un événement de ledger portefeuille.
 *
 * `securityId` désigne un instrument déjà connu ; à défaut, `security` en décrit un que
 * la RPC résout par identifiant réel (ISIN, ticker, nom) avant d'en créer un. Aucun
 * champ monétaire ne porte de valeur par défaut : `null` signifie inconnu, et le moteur
 * refusera d'en dériver un coût de revient plutôt que de le supposer nul.
 */
export interface PortfolioEventInput {
  accountId: string;
  type: PortfolioEventType;
  eventDate: string;
  settlementDate: string | null;
  securityId: string | null;
  security: {
    name: string;
    ticker: string | null;
    isin: string | null;
    currency: string | null;
    /** Rattachée seulement si une classe du même nom existe déjà. Jamais créée. */
    assetClass: string | null;
  } | null;
  quantity: number | null;
  unitPrice: number | null;
  grossAmount: number | null;
  feeAmount: number | null;
  taxAmount: number | null;
  /** Effet signé sur le cash d'enveloppe ; niveau d'ancrage sur les types d'ouverture. */
  envelopeCashAmount: number | null;
  currency: string;
  counterpartyAccountId: string | null;
  transactionId: string | null;
  matchedAcquisitionEventId: string | null;
  externalReference: string | null;
  notes: string | null;
}

export interface PortfolioEnvelopePolicyInput {
  accountId: string;
  lotMatchingMethod: LotMatchingMethod | null;
  ledgerCoverageStart: string | null;
  ledgerCoverageSource: LedgerCoverageSource | null;
  notes: string | null;
}

/**
 * Identité d'un bien. Ne porte AUCUN montant : prix, valeur et loyers sont des faits
 * datés, saisis par leurs propres mutations. `propertyId` absent = création.
 */
export interface RealEstateAssetInput {
  propertyId: string | null;
  name: string;
  location: string | null;
  surfaceSqm: number | null;
  /** `null` = usage non déclaré. Jamais « OTHER » par défaut. */
  usage: RealEstateUsage | null;
  /** Dans ]0,1]. `null` = non déclarée : la valeur attribuable devient non calculable. */
  ownershipShare: number | null;
  /**
   * Le bien est-il financé par une dette ? `false` = déclaré sans dette, `true` = financé,
   * `null` = non déclaré. Absence de rattachement n'est PAS absence de dette : sans
   * déclaration, aucune métrique dépendant du financement n'est calculable.
   */
  isDebtFinanced: boolean | null;
  acquisitionDate: string | null;
  disposalDate: string | null;
  notes: string | null;
}

export interface RealEstateValuationInput {
  propertyId: string;
  valuedAt: string;
  /** Valeur du bien ENTIER, en devise native. La quote-part est appliquée par le moteur. */
  value: number;
  currency: string;
  method: RealEstateValuationMethod;
  notes: string | null;
}

export interface RealEstateCapitalEventInput {
  propertyId: string;
  type: RealEstateCapitalEventType;
  eventDate: string;
  /** Toujours positif : la direction économique vient du type. */
  amount: number;
  currency: string;
  label: string | null;
  /** Jambe de trésorerie déjà existante. Aucun flux n'est créé. */
  transactionId: string | null;
  notes: string | null;
}

/**
 * Termes d'exploitation à une date d'effet. Chaque `null` est écrit tel quel : « non
 * déclaré » est une information que la persistance ne doit pas convertir en zéro.
 */
export interface RealEstateOperatingTermsInput {
  propertyId: string;
  effectiveFrom: string;
  currency: string;
  annualGrossRent: number | null;
  vacancyRate: number | null;
  annualOperatingCharges: number | null;
  annualPropertyTax: number | null;
  annualInsurance: number | null;
  annualMaintenance: number | null;
  annualManagementFees: number | null;
  managementFeeRate: number | null;
  annualOtherCosts: number | null;
  /** Taux effectif DÉCLARÉ. `null` = aucun résultat après impôt ne sera produit. */
  effectiveIncomeTaxRate: number | null;
  notes: string | null;
}

/** Rattachement à une dette EXISTANTE. Ne crée aucun passif. */
export interface RealEstateFinancingLinkInput {
  propertyId: string;
  liabilityId: string;
  /** Dans ]0,1]. La somme des parts d'un même concours ne dépasse jamais 1. */
  allocationShare: number;
  notes: string | null;
}

export interface BusinessInput { businessId: string | null; name: string; legalForm: string | null; type: BusinessType | null; functionalCurrency: string | null; notes: string | null; }
export interface BusinessOwnershipInput { businessId: string; effectiveDate: string; legalRate: number; economicRate: number | null; votingRate: number | null; fullyDilutedRate: number | null; notes: string | null; }
export interface BusinessFinancialInput { businessId: string; periodEnd: string; currency: string | null; revenue: number | null; grossMargin: number | null; ebitda: number | null; ebit: number | null; netIncome: number | null; cash: number | null; grossDebt: number | null; workingCapital: number | null; capex: number | null; freeCashFlow: number | null; notes: string | null; }
export interface BusinessValuationInput { businessId: string; valuationDate: string; currency: string | null; method: BusinessValuationMethod; enterpriseValue: number | null; equityValue: number | null; valuationMultiple: number | null; notes: string | null; }
export interface BusinessCapitalEventInput { businessId: string; type: BusinessCapitalEventType; eventDate: string; amount: number; currency: string; ownershipDelta: number | null; transactionId: string | null; notes: string | null; }
export interface BusinessHoldingInput { parentBusinessId: string; childBusinessId: string; effectiveDate: string; ownershipRate: number; notes: string | null; }

export type Mutation =`);
patch('src/lib/data/contracts.ts',
`  | { action: "save_real_estate_asset"; asset: RealEstateAssetInput }`,
`  | { action: "save_business"; business: BusinessInput }
  | { action: "archive_business"; businessId: string }
  | { action: "record_business_ownership"; ownership: BusinessOwnershipInput }
  | { action: "record_business_financials"; financials: BusinessFinancialInput }
  | { action: "record_business_valuation"; valuation: BusinessValuationInput }
  | { action: "record_business_capital_event"; event: BusinessCapitalEventInput }
  | { action: "set_business_holding"; holding: BusinessHoldingInput }
  | { action: "save_real_estate_asset"; asset: RealEstateAssetInput }`);

patch('src/lib/validation/mutations.ts',
`import { z } from "zod";`,
`import { z } from "zod";
import { BUSINESS_CAPITAL_EVENT_TYPES, BUSINESS_TYPES, BUSINESS_VALUATION_METHODS } from "@/lib/engine/business-equity";`);
patch('src/lib/validation/mutations.ts',
`export const mutationSchema = z.discriminatedUnion("action", [`,
String.raw`const businessSchema = z.object({ businessId:z.uuid().nullable(), name:z.string().trim().min(1).max(160), legalForm:z.string().trim().max(80).nullable(), type:z.enum(BUSINESS_TYPES).nullable(), functionalCurrency:z.string().trim().length(3).nullable(), notes:z.string().trim().max(1000).nullable() }).strict();
const businessOwnershipSchema = z.object({ businessId:z.uuid(), effectiveDate:realDate, legalRate:finite.gt(0).max(1), economicRate:finite.gt(0).max(1).nullable(), votingRate:finite.min(0).max(1).nullable(), fullyDilutedRate:finite.gt(0).max(1).nullable(), notes:z.string().trim().max(1000).nullable() }).strict();
const businessFinancialSchema = z.object({ businessId:z.uuid(), periodEnd:realDate, currency:z.string().trim().length(3).nullable(), revenue:finite.nullable(), grossMargin:finite.nullable(), ebitda:finite.nullable(), ebit:finite.nullable(), netIncome:finite.nullable(), cash:finite.nonnegative().nullable(), grossDebt:finite.nonnegative().nullable(), workingCapital:finite.nullable(), capex:finite.nonnegative().nullable(), freeCashFlow:finite.nullable(), notes:z.string().trim().max(1000).nullable() }).strict();
const businessValuationSchema = z.object({ businessId:z.uuid(), valuationDate:realDate, currency:z.string().trim().length(3).nullable(), method:z.enum(BUSINESS_VALUATION_METHODS), enterpriseValue:finite.nullable(), equityValue:finite.nullable(), valuationMultiple:finite.nullable(), notes:z.string().trim().max(1000).nullable() }).strict().superRefine((v,ctx)=>{ if(v.enterpriseValue===null && v.equityValue===null) ctx.addIssue({code:'custom',message:'EV ou Equity Value requise',path:['equityValue']}); });
const businessCapitalEventSchema = z.object({ businessId:z.uuid(), type:z.enum(BUSINESS_CAPITAL_EVENT_TYPES), eventDate:realDate, amount:finite.nonnegative(), currency:z.string().trim().length(3), ownershipDelta:finite.min(-1).max(1).nullable(), transactionId:z.uuid().nullable(), notes:z.string().trim().max(1000).nullable() }).strict();
const businessHoldingSchema = z.object({ parentBusinessId:z.uuid(), childBusinessId:z.uuid(), effectiveDate:realDate, ownershipRate:finite.gt(0).max(1), notes:z.string().trim().max(1000).nullable() }).strict().superRefine((v,ctx)=>{ if(v.parentBusinessId===v.childBusinessId) ctx.addIssue({code:'custom',message:'Une société ne peut pas se détenir elle-même',path:['childBusinessId']}); });

export const mutationSchema = z.discriminatedUnion("action", [`);
patch('src/lib/validation/mutations.ts',
`  // Les mutations immobilières sont STRICTES de bout en bout`,
`  z.object({ action:z.literal("save_business"), business:businessSchema }).strict(),
  z.object({ action:z.literal("archive_business"), businessId:z.uuid() }).strict(),
  z.object({ action:z.literal("record_business_ownership"), ownership:businessOwnershipSchema }).strict(),
  z.object({ action:z.literal("record_business_financials"), financials:businessFinancialSchema }).strict(),
  z.object({ action:z.literal("record_business_valuation"), valuation:businessValuationSchema }).strict(),
  z.object({ action:z.literal("record_business_capital_event"), event:businessCapitalEventSchema }).strict(),
  z.object({ action:z.literal("set_business_holding"), holding:businessHoldingSchema }).strict(),
  // Les mutations immobilières sont STRICTES de bout en bout`);

patch('src/lib/data/supabase-repository.ts',
`import { buildCanonicalBalanceSheet } from "@/lib/engine/balance-sheet";`,
`import { buildCanonicalBalanceSheet } from "@/lib/engine/balance-sheet";
import { buildBusinessEquityPortfolio, businessEquityBalanceSheetContributions, BUSINESS_CAPITAL_EVENT_TYPES, BUSINESS_TYPES, BUSINESS_VALUATION_METHODS, type BusinessEntity, type BusinessOwnership, type BusinessFinancialSnapshot, type BusinessValuation, type BusinessCapitalEvent, type BusinessHoldingLink } from "@/lib/engine/business-equity";`);
patch('src/lib/data/supabase-repository.ts',
`      realEstateFinancingLinkRows,
    ] = await Promise.all([`,
`      realEstateFinancingLinkRows,
      businessRows,
      businessOwnershipRows,
      businessFinancialRows,
      businessValuationRows,
      businessCapitalEventRows,
      businessHoldingRows,
    ] = await Promise.all([`);
patch('src/lib/data/supabase-repository.ts',
`      mine("real_estate_financing_links"),
    ]).then`,
`      mine("real_estate_financing_links"),
      mine("businesses"),
      fetchAllPages("business_ownership", "effective_date"),
      fetchAllPages("business_financials", "period_end"),
      fetchAllPages("business_valuations", "valuation_date"),
      fetchAllPages("business_capital_events", "event_date"),
      fetchAllPages("business_holdings", "effective_date"),
    ]).then`);

patch('src/lib/data/supabase-repository.ts',
`    const latestLiabilityObservations = latestBy(`,
String.raw`    // ── Business Equity V2 ───────────────────────────────────────────────────────────
    const businesses: BusinessEntity[] = businessRows.filter((r)=>r.archived!==true).map((row)=>({ id:str(row.id), name:str(row.name), legalForm:row.legal_form?str(row.legal_form):null, type:row.business_type ? enumValue(str(row.business_type), BUSINESS_TYPES, `businesses[id=${str(row.id)}].business_type`) : null, functionalCurrency:row.functional_currency?str(row.functional_currency).toUpperCase():null, archived:bool(row.archived), notes:row.notes?str(row.notes):null, provenance:provenance(row) })).sort((a,b)=>a.name.localeCompare(b.name));
    const liveBusinessIds = new Set(businesses.map((b)=>b.id));
    const businessOwnership: BusinessOwnership[] = businessOwnershipRows.filter((r)=>liveBusinessIds.has(str(r.business_id))).map((row)=>({ id:str(row.id), businessId:str(row.business_id), effectiveDate:str(row.effective_date), legalRate:finiteNumber(row.ownership_rate,`business_ownership[id=${str(row.id)}].ownership_rate`), economicRate:nullableFiniteNumber(row.economic_rate,`business_ownership[id=${str(row.id)}].economic_rate`), votingRate:nullableFiniteNumber(row.voting_rate,`business_ownership[id=${str(row.id)}].voting_rate`), fullyDilutedRate:nullableFiniteNumber(row.fully_diluted_rate,`business_ownership[id=${str(row.id)}].fully_diluted_rate`), notes:row.notes?str(row.notes):null, provenance:provenance(row) }));
    const businessFinancials: BusinessFinancialSnapshot[] = businessFinancialRows.filter((r)=>liveBusinessIds.has(str(r.business_id))).map((row)=>({ id:str(row.id), businessId:str(row.business_id), periodEnd:str(row.period_end), currency:row.currency?str(row.currency).toUpperCase():null, revenue:nullableFiniteNumber(row.revenue,`business_financials[id=${str(row.id)}].revenue`), grossMargin:nullableFiniteNumber(row.gross_margin,`business_financials[id=${str(row.id)}].gross_margin`), ebitda:nullableFiniteNumber(row.ebitda,`business_financials[id=${str(row.id)}].ebitda`), ebit:nullableFiniteNumber(row.ebit,`business_financials[id=${str(row.id)}].ebit`), netIncome:nullableFiniteNumber(row.net_income,`business_financials[id=${str(row.id)}].net_income`), cash:nullableFiniteNumber(row.cash,`business_financials[id=${str(row.id)}].cash`), grossDebt:nullableFiniteNumber(row.debt,`business_financials[id=${str(row.id)}].debt`), workingCapital:nullableFiniteNumber(row.working_capital,`business_financials[id=${str(row.id)}].working_capital`), capex:nullableFiniteNumber(row.capex,`business_financials[id=${str(row.id)}].capex`), freeCashFlow:nullableFiniteNumber(row.free_cash_flow,`business_financials[id=${str(row.id)}].free_cash_flow`), notes:row.notes?str(row.notes):null, provenance:provenance(row) }));
    const businessValuations: BusinessValuation[] = businessValuationRows.filter((r)=>liveBusinessIds.has(str(r.business_id))).map((row)=>({ id:str(row.id), businessId:str(row.business_id), valuationDate:str(row.valuation_date), currency:row.currency?str(row.currency).toUpperCase():null, method:enumValue(str(row.method), BUSINESS_VALUATION_METHODS,`business_valuations[id=${str(row.id)}].method`), enterpriseValue:nullableFiniteNumber(row.enterprise_value,`business_valuations[id=${str(row.id)}].enterprise_value`), equityValue:nullableFiniteNumber(row.equity_value,`business_valuations[id=${str(row.id)}].equity_value`), valuationMultiple:nullableFiniteNumber(row.valuation_multiple,`business_valuations[id=${str(row.id)}].valuation_multiple`), notes:row.notes?str(row.notes):null, provenance:provenance(row) }));
    const businessCapitalEvents: BusinessCapitalEvent[] = businessCapitalEventRows.filter((r)=>liveBusinessIds.has(str(r.business_id))).map((row)=>({ id:str(row.id), businessId:str(row.business_id), type:enumValue(str(row.event_type),BUSINESS_CAPITAL_EVENT_TYPES,`business_capital_events[id=${str(row.id)}].event_type`), eventDate:str(row.event_date), amount:finiteNumber(row.amount,`business_capital_events[id=${str(row.id)}].amount`), currency:str(row.currency).toUpperCase(), ownershipDelta:nullableFiniteNumber(row.ownership_delta,`business_capital_events[id=${str(row.id)}].ownership_delta`), transactionId:row.transaction_id?str(row.transaction_id):null, notes:row.notes?str(row.notes):null, provenance:provenance(row) }));
    const businessHoldings: BusinessHoldingLink[] = businessHoldingRows.filter((r)=>liveBusinessIds.has(str(r.parent_business_id))&&liveBusinessIds.has(str(r.child_business_id))).map((row)=>({ id:str(row.id), parentBusinessId:str(row.parent_business_id), childBusinessId:str(row.child_business_id), effectiveDate:str(row.effective_date), ownershipRate:finiteNumber(row.ownership_rate,`business_holdings[id=${str(row.id)}].ownership_rate`), notes:row.notes?str(row.notes):null, provenance:provenance(row) }));

    const latestLiabilityObservations = latestBy(`);

patch('src/lib/data/supabase-repository.ts',
`    const balanceSheet = buildCanonicalBalanceSheet({
      asOfDate: AS_OF_DATE,
      reportingCurrency,
      accounts,
      positions,
      liabilities,
      contributions: realEstateBalanceSheetContributions(realEstate),
      currencyRates,
    });`,
`    const businessEquity = buildBusinessEquityPortfolio({ asOfDate:AS_OF_DATE, reportingCurrency, businesses, ownership:businessOwnership, financials:businessFinancials, valuations:businessValuations, capitalEvents:businessCapitalEvents, holdings:businessHoldings, currencyRates });
    const balanceSheet = buildCanonicalBalanceSheet({
      asOfDate: AS_OF_DATE,
      reportingCurrency,
      accounts,
      positions,
      liabilities,
      contributions: [...realEstateBalanceSheetContributions(realEstate), ...businessEquityBalanceSheetContributions(businessEquity)],
      currencyRates,
    });`);
patch('src/lib/data/supabase-repository.ts',
`      realEstateFinancingLinks,
      liabilities,`,
`      realEstateFinancingLinks,
      businesses,
      businessOwnership,
      businessFinancials,
      businessValuations,
      businessCapitalEvents,
      businessHoldings,
      liabilities,`);
patch('src/lib/data/supabase-repository.ts',
`      realEstate,
      metrics: composeDashboardMetrics`,
`      realEstate,
      businessEquity,
      metrics: composeDashboardMetrics`);

patch('src/lib/data/supabase-repository.ts',
`      case "save_real_estate_asset": {`,
String.raw`      case "save_business": {
        unwrap(await db.rpc("lfo_save_business", { p_user_id:user, p_payload:{ business_id:mutation.business.businessId, name:mutation.business.name, legal_form:mutation.business.legalForm, business_type:mutation.business.type, functional_currency:mutation.business.functionalCurrency, notes:mutation.business.notes, source:"Saisie Business Equity" } }), "enregistrement société"); break;
      }
      case "archive_business": { unwrap(await db.rpc("lfo_archive_business", { p_user_id:user, p_business_id:mutation.businessId }), "archivage société"); break; }
      case "record_business_ownership": { const o=mutation.ownership; unwrap(await db.rpc("lfo_record_business_ownership", { p_user_id:user, p_payload:{ business_id:o.businessId,effective_date:o.effectiveDate,legal_rate:o.legalRate,economic_rate:o.economicRate,voting_rate:o.votingRate,fully_diluted_rate:o.fullyDilutedRate,notes:o.notes,source:"Saisie Business Equity" } }), "enregistrement détention"); break; }
      case "record_business_financials": { const f=mutation.financials; unwrap(await db.rpc("lfo_record_business_financials", { p_user_id:user, p_payload:{ business_id:f.businessId,period_end:f.periodEnd,currency:f.currency,revenue:f.revenue,gross_margin:f.grossMargin,ebitda:f.ebitda,ebit:f.ebit,net_income:f.netIncome,cash:f.cash,gross_debt:f.grossDebt,working_capital:f.workingCapital,capex:f.capex,free_cash_flow:f.freeCashFlow,notes:f.notes,source:"Saisie Business Equity",data_kind:"ACTUAL",confidence:"HIGH" } }), "enregistrement financiers business"); break; }
      case "record_business_valuation": { const v=mutation.valuation; unwrap(await db.rpc("lfo_record_business_valuation", { p_user_id:user, p_payload:{ business_id:v.businessId,valuation_date:v.valuationDate,currency:v.currency,method:v.method,enterprise_value:v.enterpriseValue,equity_value:v.equityValue,valuation_multiple:v.valuationMultiple,notes:v.notes,source:"Saisie Business Equity",data_kind:v.method==="USER_ESTIMATE"?"USER_ASSUMPTION":"EXTERNAL_DATA",confidence:v.method==="USER_ESTIMATE"?"LOW":"MEDIUM",assumptions:{} } }), "enregistrement valorisation business"); break; }
      case "record_business_capital_event": { const e=mutation.event; unwrap(await db.rpc("lfo_record_business_capital_event", { p_user_id:user, p_payload:{ business_id:e.businessId,event_type:e.type,event_date:e.eventDate,amount:e.amount,currency:e.currency,ownership_delta:e.ownershipDelta,transaction_id:e.transactionId,notes:e.notes,source:"Saisie Business Equity",data_kind:"ACTUAL",confidence:"HIGH" } }), "enregistrement événement business"); break; }
      case "set_business_holding": { const h=mutation.holding; unwrap(await db.rpc("lfo_set_business_holding", { p_user_id:user, p_payload:{ parent_business_id:h.parentBusinessId,child_business_id:h.childBusinessId,effective_date:h.effectiveDate,ownership_rate:h.ownershipRate,notes:h.notes,source:"Saisie Business Equity" } }), "rattachement holding"); break; }
      case "save_real_estate_asset": {`);

write('src/components/pages/business-equity/business-forms.tsx', String.raw`"use client";
import { useState } from 'react';
import type { Mutate } from '@/components/pages/shared';
import type { BusinessEntity } from '@/lib/engine/business-equity';
const n=(s:string)=>s.trim()===''?null:Number(s.replace(',','.'));
export function BusinessForms({ businesses, mutate, busy }:{ businesses:BusinessEntity[]; mutate:Mutate; busy:boolean }) {
  const [name,setName]=useState(''); const [legal,setLegal]=useState('SAS'); const [type,setType]=useState<'OPERATING'|'HOLDING'|'STARTUP'|'SPV'|'OTHER'>('OPERATING'); const [currency,setCurrency]=useState('EUR');
  const [selected,setSelected]=useState(''); const [date,setDate]=useState('2026-08-26'); const [legalRate,setLegalRate]=useState('100'); const [economic,setEconomic]=useState('100');
  const [revenue,setRevenue]=useState(''); const [ebitda,setEbitda]=useState(''); const [cash,setCash]=useState('0'); const [debt,setDebt]=useState('0');
  const [ev,setEv]=useState(''); const [equity,setEquity]=useState(''); const [method,setMethod]=useState<'EXTERNAL_APPRAISAL'|'TRANSACTION'|'EBITDA_MULTIPLE'|'REVENUE_MULTIPLE'|'DCF'|'FUNDING_ROUND'|'USER_ESTIMATE'|'LOOK_THROUGH'>('USER_ESTIMATE');
  const [eventAmount,setEventAmount]=useState(''); const [eventType,setEventType]=useState<'OPENING_COST_BASIS'|'ACQUISITION'|'CAPITAL_INJECTION'|'SALE'|'DIVIDEND'|'DISTRIBUTION'|'CAPITAL_RETURN'>('OPENING_COST_BASIS');
  const submit=async(e:React.FormEvent,fn:()=>Promise<boolean>)=>{e.preventDefault(); await fn();};
  return <div className="results-stack">
    <form className="panel input-panel" onSubmit={(e)=>submit(e,()=>mutate({action:'save_business',business:{businessId:null,name,legalForm:legal||null,type,functionalCurrency:currency||null,notes:null}}))}><div className="panel-header"><div><span className="eyebrow">Identité</span><h2>Ajouter une société</h2></div></div><div className="mini-form-grid business-form"><label>Nom<input value={name} onChange={e=>setName(e.target.value)} required /></label><label>Forme<input value={legal} onChange={e=>setLegal(e.target.value)} /></label><label>Type<select value={type} onChange={e=>setType(e.target.value as typeof type)}><option>OPERATING</option><option>HOLDING</option><option>STARTUP</option><option>SPV</option><option>OTHER</option></select></label><label>Devise<input value={currency} maxLength={3} onChange={e=>setCurrency(e.target.value.toUpperCase())}/></label></div><button className="button primary" disabled={busy||!name}>Créer</button></form>
    {businesses.length>0 && <><div className="panel"><label>Société<select value={selected} onChange={e=>setSelected(e.target.value)}><option value="">Choisir…</option>{businesses.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></label></div>
    <form className="panel input-panel" onSubmit={(e)=>submit(e,()=>mutate({action:'record_business_ownership',ownership:{businessId:selected,effectiveDate:date,legalRate:Number(legalRate)/100,economicRate:n(economic)===null?null:Number(economic)/100,votingRate:null,fullyDilutedRate:null,notes:null}}))}><h2>Détention</h2><div className="mini-form-grid"><label>Date<input type="date" value={date} onChange={e=>setDate(e.target.value)}/></label><label>Détention juridique %<input value={legalRate} onChange={e=>setLegalRate(e.target.value)}/></label><label>Droits économiques %<input value={economic} onChange={e=>setEconomic(e.target.value)}/></label></div><button className="button secondary" disabled={!selected||busy}>Enregistrer</button></form>
    <form className="panel input-panel" onSubmit={(e)=>submit(e,()=>mutate({action:'record_business_financials',financials:{businessId:selected,periodEnd:date,currency,revenue:n(revenue),grossMargin:null,ebitda:n(ebitda),ebit:null,netIncome:null,cash:n(cash),grossDebt:n(debt),workingCapital:null,capex:null,freeCashFlow:null,notes:null}}))}><h2>Financiers observés</h2><div className="mini-form-grid"><label>CA<input value={revenue} onChange={e=>setRevenue(e.target.value)}/></label><label>EBITDA<input value={ebitda} onChange={e=>setEbitda(e.target.value)}/></label><label>Cash<input value={cash} onChange={e=>setCash(e.target.value)}/></label><label>Dette brute<input value={debt} onChange={e=>setDebt(e.target.value)}/></label></div><button className="button secondary" disabled={!selected||busy}>Enregistrer</button></form>
    <form className="panel input-panel" onSubmit={(e)=>submit(e,()=>mutate({action:'record_business_valuation',valuation:{businessId:selected,valuationDate:date,currency,method,enterpriseValue:n(ev),equityValue:n(equity),valuationMultiple:null,notes:null}}))}><h2>Valorisation</h2><div className="mini-form-grid"><label>Méthode<select value={method} onChange={e=>setMethod(e.target.value as typeof method)}><option>USER_ESTIMATE</option><option>EXTERNAL_APPRAISAL</option><option>TRANSACTION</option><option>EBITDA_MULTIPLE</option><option>REVENUE_MULTIPLE</option><option>DCF</option><option>FUNDING_ROUND</option></select></label><label>Enterprise Value<input value={ev} onChange={e=>setEv(e.target.value)}/></label><label>Equity Value<input value={equity} onChange={e=>setEquity(e.target.value)}/></label></div><p className="muted">Si seule l'EV est connue, cash et dette brute doivent être renseignés. Le moteur refuse EV × % sans bridge EV → Equity.</p><button className="button secondary" disabled={!selected||busy||(n(ev)===null&&n(equity)===null)}>Enregistrer</button></form>
    <form className="panel input-panel" onSubmit={(e)=>submit(e,()=>mutate({action:'record_business_capital_event',event:{businessId:selected,type:eventType,eventDate:date,amount:Number(eventAmount),currency,ownershipDelta:null,transactionId:null,notes:null}}))}><h2>Capital & distributions</h2><div className="mini-form-grid"><label>Nature<select value={eventType} onChange={e=>setEventType(e.target.value as typeof eventType)}><option>OPENING_COST_BASIS</option><option>ACQUISITION</option><option>CAPITAL_INJECTION</option><option>SALE</option><option>DIVIDEND</option><option>DISTRIBUTION</option><option>CAPITAL_RETURN</option></select></label><label>Montant<input value={eventAmount} onChange={e=>setEventAmount(e.target.value)}/></label></div><button className="button secondary" disabled={!selected||busy||!eventAmount}>Enregistrer</button></form></>}
  </div>;
}

  | { action: "save_debt_contract"; contract: DebtContractInput }
  | {
      action: "record_debt_balance";
      liabilityId: string;
      observedAt: string;
      balance: number;
      notes: string | null;
    }
  | { action: "archive_debt"; liabilityId: string }
  | { action: "update_account"; accountId: string; balance: number; balanceDate: string }
  | {
      action: "add_account";
      institution: string;
      name: string;
      accountType: FinancialAccount["type"];
      balance: number;
      currency: string;
    }
  | {
      action: "add_transaction";
      accountId: string;
      categoryId: string;
      date: string;
      label: string;
      amount: number;
      updateBalance: boolean;
    }
  | { action: "update_expense"; categoryId: string; monthlyAmount: number | null }
  | {
      action: "update_scenario";
      scenarioId: string;
      patch: Partial<
        Pick<
          Scenario,
          | "annualReturn"
          | "annualVolatility"
          | "annualInflation"
          | "monthlySavings"
          | "investmentAllocationRate"
          | "salaryGrowth"
          | "stressProbability"
          | "shockYear"
          | "shockMagnitude"
        >
      >;
    }
  | { action: "duplicate_scenario"; scenarioId: string }
  | { action: "create_monthly_close"; closeDate: string }
  | { action: "add_goal"; name: string; targetAmount: number; targetDate: string | null }
  | {
      action: "update_category";
      categoryId: string;
      patch: Partial<{
        name: string;
        groupName: string;
        cashFlowKind: CashFlowKind;
        essentiality: Essentiality;
        behavior: ExpenseBehavior;
        archived: boolean;
      }>;
    }
  | {
      action: "add_category";
      name: string;
      groupName: string;
      cashFlowKind: CashFlowKind;
      essentiality: Essentiality;
      behavior: ExpenseBehavior;
    }
  | {
      action: "classify_transaction";
      transactionId: string;
      categoryId?: string;
      kindOverride?: CashFlowKind | null;
      transferGroupId?: string | null;
      notes?: string | null;
    }
  | {
      action: "add_recurring_rule";
      name: string;
      cashFlowKind: CashFlowKind;
      categoryId: string;
      accountId: string | null;
      amount: number;
      frequency: RecurrenceFrequency;
      startDate: string;
      endDate: string | null;
      dayOfMonth: number | null;
    }
  | {
      action: "update_recurring_rule";
      ruleId: string;
      patch: Partial<{ amount: number; active: boolean; endDate: string | null }>;
    }
  | { action: "delete_recurring_rule"; ruleId: string }
  | { action: "close_cash_flow_month"; month: string }
  | { action: "record_portfolio_event"; event: PortfolioEventInput }
  | { action: "delete_portfolio_event"; eventId: string }
  | { action: "set_portfolio_envelope_policy"; policy: PortfolioEnvelopePolicyInput }
  | { action: "save_real_estate_asset"; asset: RealEstateAssetInput }
  | { action: "archive_real_estate_asset"; propertyId: string }
  | { action: "record_real_estate_valuation"; valuation: RealEstateValuationInput }
  | { action: "record_real_estate_capital_event"; event: RealEstateCapitalEventInput }
  | { action: "delete_real_estate_capital_event"; eventId: string }
  | { action: "set_real_estate_operating_terms"; terms: RealEstateOperatingTermsInput }
  | { action: "set_real_estate_financing_link"; link: RealEstateFinancingLinkInput }
  | { action: "delete_real_estate_financing_link"; linkId: string }
  | {
      /**
       * Rattache un flux réel à un bien, ou l'en détache avec `propertyId: null`. Aucune
       * nature canonique n'est modifiée : le domaine immobilier ne reclasse aucun flux.
       */
      action: "attribute_transaction_to_property";
      transactionId: string;
      propertyId: string | null;
    }
  | {
      /**
       * Déclare, corrige ou efface la profondeur d'historique du ledger LFO.
       * `startDate: null` remet la déclaration à l'état « non déclarée ».
       */
      action: "set_ledger_coverage";
      startDate: string | null;
      source: LedgerCoverageSource;
    };

export interface DocumentUpload {
  name: string;
  category: string;
  contentType: string;
  size: number;
  bytes: Uint8Array;
}

export interface SimulationRun {
  scenarioId: string;
  seed: number;
  simulations: number;
  years: number;
  methodology: string;
  points: Array<{ year: number; p10: number; p25: number; p50: number; p75: number; p90: number }>;
}

export type StoredDocument = DocumentRecord;

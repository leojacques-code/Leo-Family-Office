from pathlib import Path
import subprocess

subprocess.run(['git','fetch','origin','main','--depth=1'], check=True)
base = subprocess.check_output(['git','show','origin/main:src/lib/data/contracts.ts'], text=True)

def rep(text, needle, replacement):
    if needle not in text:
        raise RuntimeError(f'anchor missing: {needle[:120]}')
    return text.replace(needle, replacement, 1)

base = rep(base,
'''import type {
  CashFlowKind,''',
'''import type { BusinessCapitalEventType, BusinessType, BusinessValuationMethod } from "@/lib/engine/business-equity";
import type {
  CashFlowKind,''')

interfaces = '''export interface BusinessInput {
  businessId: string | null;
  name: string;
  legalForm: string | null;
  type: BusinessType | null;
  functionalCurrency: string | null;
  notes: string | null;
}

export interface BusinessOwnershipInput {
  businessId: string;
  effectiveDate: string;
  legalRate: number;
  economicRate: number | null;
  votingRate: number | null;
  fullyDilutedRate: number | null;
  notes: string | null;
}

export interface BusinessFinancialInput {
  businessId: string;
  periodEnd: string;
  currency: string | null;
  revenue: number | null;
  grossMargin: number | null;
  ebitda: number | null;
  ebit: number | null;
  netIncome: number | null;
  cash: number | null;
  grossDebt: number | null;
  workingCapital: number | null;
  capex: number | null;
  freeCashFlow: number | null;
  notes: string | null;
}

export interface BusinessValuationInput {
  businessId: string;
  valuationDate: string;
  currency: string | null;
  method: BusinessValuationMethod;
  enterpriseValue: number | null;
  equityValue: number | null;
  valuationMultiple: number | null;
  notes: string | null;
}

export interface BusinessCapitalEventInput {
  businessId: string;
  type: BusinessCapitalEventType;
  eventDate: string;
  amount: number;
  currency: string;
  ownershipDelta: number | null;
  transactionId: string | null;
  notes: string | null;
}

export interface BusinessHoldingInput {
  parentBusinessId: string;
  childBusinessId: string;
  effectiveDate: string;
  ownershipRate: number;
  notes: string | null;
}

'''
base = rep(base, 'export type Mutation =\n', interfaces + 'export type Mutation =\n')
base = rep(base,
'  | { action: "save_real_estate_asset"; asset: RealEstateAssetInput }',
'''  | { action: "save_business"; business: BusinessInput }
  | { action: "archive_business"; businessId: string }
  | { action: "record_business_ownership"; ownership: BusinessOwnershipInput }
  | { action: "record_business_financials"; financials: BusinessFinancialInput }
  | { action: "record_business_valuation"; valuation: BusinessValuationInput }
  | { action: "record_business_capital_event"; event: BusinessCapitalEventInput }
  | { action: "set_business_holding"; holding: BusinessHoldingInput }
  | { action: "save_real_estate_asset"; asset: RealEstateAssetInput }''')

Path('src/lib/data/contracts.ts').write_text(base)
print('contracts repaired')

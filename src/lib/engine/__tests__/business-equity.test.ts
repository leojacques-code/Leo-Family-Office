import { describe, expect, it } from 'vitest';
import { buildBusinessEquityPortfolio } from '@/lib/engine/business-equity';
const p = { kind: 'ACTUAL' as const, confidence: 'HIGH' as const };
const base = { asOfDate: '2026-08-26', reportingCurrency: 'EUR', holdings: [], currencyRates: [] };
describe('Business Equity V2', () => {
  it('bridges EV to equity and never makes corporate debt personal', () => {
    const result = buildBusinessEquityPortfolio({ ...base, businesses: [{ id:'b', name:'PME', legalForm:'SAS', type:'OPERATING', functionalCurrency:'EUR', archived:false, notes:null, provenance:p }], ownership:[{ id:'o', businessId:'b', effectiveDate:'2025-01-01', legalRate:.7, economicRate:.7, votingRate:.7, fullyDilutedRate:.7, notes:null, provenance:p }], financials:[{ id:'f', businessId:'b', periodEnd:'2026-06-30', currency:'EUR', revenue:4_800_000, grossMargin:null, ebitda:650_000, ebit:null, netIncome:null, cash:300_000, grossDebt:1_100_000, workingCapital:null, capex:null, freeCashFlow:null, notes:null, provenance:p }], valuations:[{ id:'v', businessId:'b', valuationDate:'2026-06-30', currency:'EUR', method:'EBITDA_MULTIPLE', enterpriseValue:3_900_000, equityValue:null, valuationMultiple:6, notes:null, provenance:p }], capitalEvents:[{ id:'c', businessId:'b', type:'OPENING_COST_BASIS', eventDate:'2020-01-01', amount:500_000, currency:'EUR', ownershipDelta:.7, transactionId:null, notes:null, provenance:p }] });
    expect(result.positions[0].netDebt.value).toBe(800_000);
    expect(result.positions[0].wholeEquityValue.value).toBe(3_100_000);
    expect(result.positions[0].attributableValue.value).toBe(2_170_000);
  });
  it('refuses EV × ownership when net debt is unknown', () => {
    const result = buildBusinessEquityPortfolio({ ...base, businesses:[{ id:'b', name:'Target', legalForm:null, type:'OPERATING', functionalCurrency:'EUR', archived:false, notes:null, provenance:p }], ownership:[{ id:'o', businessId:'b', effectiveDate:'2025-01-01', legalRate:.3, economicRate:.3, votingRate:null, fullyDilutedRate:null, notes:null, provenance:p }], financials:[], valuations:[{ id:'v', businessId:'b', valuationDate:'2026-01-01', currency:'EUR', method:'EXTERNAL_APPRAISAL', enterpriseValue:12_000_000, equityValue:null, valuationMultiple:null, notes:null, provenance:p }], capitalEvents:[] });
    expect(result.positions[0].wholeEquityValue.value).toBeNull();
    expect(result.positions[0].wholeEquityValue.blockers).toContain('EV_TO_EQUITY_BRIDGE_MISSING:b');
  });
  it('does not invent zero cost basis when acquisition history is absent', () => {
    const result = buildBusinessEquityPortfolio({ ...base, businesses:[{ id:'b', name:'Startup', legalForm:null, type:'STARTUP', functionalCurrency:'EUR', archived:false, notes:null, provenance:p }], ownership:[{ id:'o', businessId:'b', effectiveDate:'2025-01-01', legalRate:.2, economicRate:.2, votingRate:null, fullyDilutedRate:.2, notes:null, provenance:p }], financials:[], valuations:[{ id:'v', businessId:'b', valuationDate:'2026-01-01', currency:'EUR', method:'FUNDING_ROUND', enterpriseValue:null, equityValue:10_000_000, valuationMultiple:null, notes:null, provenance:p }], capitalEvents:[] });
    expect(result.positions[0].attributableValue.value).toBe(2_000_000);
    expect(result.positions[0].investedCapital.value).toBeNull();
    expect(result.positions[0].unrealisedPnL.value).toBeNull();
    expect(result.positions[0].moic.value).toBeNull();
  });
  it('derives a holding look-through without double-counting the child as a personal asset', () => {
    const businesses = [
      { id:'h', name:'HoldCo', legalForm:'SAS', type:'HOLDING' as const, functionalCurrency:'EUR', archived:false, notes:null, provenance:p },
      { id:'c', name:'OpCo', legalForm:'SAS', type:'OPERATING' as const, functionalCurrency:'EUR', archived:false, notes:null, provenance:p },
    ];
    const result = buildBusinessEquityPortfolio({ ...base, businesses, ownership:[{ id:'o', businessId:'h', effectiveDate:'2025-01-01', legalRate:.8, economicRate:.8, votingRate:.8, fullyDilutedRate:.8, notes:null, provenance:p }], financials:[{ id:'fh', businessId:'h', periodEnd:'2026-06-30', currency:'EUR', revenue:null, grossMargin:null, ebitda:null, ebit:null, netIncome:null, cash:200_000, grossDebt:400_000, workingCapital:null, capex:null, freeCashFlow:null, notes:null, provenance:p }], valuations:[{ id:'vc', businessId:'c', valuationDate:'2026-06-30', currency:'EUR', method:'EXTERNAL_APPRAISAL', enterpriseValue:null, equityValue:5_000_000, valuationMultiple:null, notes:null, provenance:p }], capitalEvents:[{ id:'cb', businessId:'h', type:'OPENING_COST_BASIS', eventDate:'2020-01-01', amount:100_000, currency:'EUR', ownershipDelta:.8, transactionId:null, notes:null, provenance:p }], holdings:[{ id:'l', parentBusinessId:'h', childBusinessId:'c', effectiveDate:'2025-01-01', ownershipRate:.6, notes:null, provenance:p }] });
    expect(result.positions.find((x)=>x.business.id==='h')?.wholeEquityValue.value).toBe(2_800_000);
    expect(result.positions.find((x)=>x.business.id==='h')?.attributableValue.value).toBe(2_240_000);
    expect(result.totalAttributableValue.value).toBe(2_240_000);
  });
});

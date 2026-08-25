export type NetWorthAttributionCategory =
  | "OPERATING_SURPLUS"
  | "MARKET_PNL"
  | "FX_PNL"
  | "REAL_ESTATE_VALUATION"
  | "BUSINESS_VALUATION"
  | "DEBT_ECONOMIC_COST"
  | "TAX"
  | "OTHER_ECONOMIC_FLOWS";

export interface KnownNetWorthContribution {
  category: NetWorthAttributionCategory;
  amount: number;
}

export function attributeNetWorthChange(
  openingNetWorth: number,
  closingNetWorth: number,
  known: KnownNetWorthContribution[],
) {
  const change = closingNetWorth - openingNetWorth;
  const explained = known.reduce((sum, item) => sum + item.amount, 0);
  const unexplained = change - explained;
  return {
    change,
    known,
    explained,
    unexplained,
    coverage: change === 0 ? null : Math.min(1, Math.abs(explained) / Math.abs(change)),
    flags: Math.abs(unexplained) > 1e-9 ? ["RECONCILIATION_UNEXPLAINED"] : [],
  };
}

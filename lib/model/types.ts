export type ValueOrigin = "sourced" | "derived" | "assumed" | "user" | "missing";

export type Provenance = {
  origin: ValueOrigin;
  label: string;
  sourceUrl?: string;
  asOf?: string;
  filingDate?: string;
  fiscalPeriod?: string;
  accessionNumber?: string;
  units?: string;
  notes?: string;
};

export type TaggedValue = {
  value: number | null;
  provenance: Provenance;
};

export type DataGap = {
  field: string;
  reason: string;
  severity: "blocking" | "review" | "warning";
  affectedOutputs: string[];
};

export type FiscalPeriod = {
  fiscalYear: number;
  startDate?: string;
  endDate: string;
  filingDate: string;
  form: string;
  accessionNumber: string;
  label: string;
  interim: boolean;
};

export type PeriodFinancials = {
  period: FiscalPeriod;
  revenue: TaggedValue;
  ebit: TaggedValue;
  depreciationAmortization: TaggedValue;
  stockBasedCompensation: TaggedValue;
  capitalExpenditures: TaggedValue;
  cashTaxes: TaggedValue;
  incomeTaxExpense: TaggedValue;
  pretaxIncome: TaggedValue;
  interestExpense: TaggedValue;
  accountsReceivable: TaggedValue;
  inventory: TaggedValue;
  accountsPayable: TaggedValue;
  deferredRevenue: TaggedValue;
  otherCurrentAssets: TaggedValue;
  otherCurrentLiabilities: TaggedValue;
  cash: TaggedValue;
  shortTermInvestments: TaggedValue;
  totalDebt: TaggedValue;
  financeLeaseLiabilities: TaggedValue;
  operatingLeaseLiabilities: TaggedValue;
  minorityInterest: TaggedValue;
  preferredStock: TaggedValue;
  equityMethodInvestments: TaggedValue;
  stockholdersEquity: TaggedValue;
  basicShares: TaggedValue;
  dilutedShares: TaggedValue;
  sharesOutstanding: TaggedValue;
};

export type HistoricalFinancials = {
  annual: PeriodFinancials[];
  latestInterim: PeriodFinancials | null;
};

export type CompanyIdentity = {
  ticker: string;
  cik: string;
  name: string;
  fiscalYearEnd: string;
  sic: string;
  sicDescription: string;
  exchange: string | null;
  entityType: string;
  valuationMethodEligible: boolean;
  ineligibleReason: string | null;
};

export type PeerBeta = {
  ticker: string;
  name: string;
  rawBeta: number;
  debtToEquity: number;
  taxRate: number;
  unleveredBeta: number;
  sourceUrl: string;
};

export type AnalystEstimate = {
  fiscalDate: string;
  revenue: number;
  ebit: number | null;
  revenueAnalystCount: number | null;
  sourceUrl: string;
};

export type MarketInputs = {
  currentPrice: TaggedValue;
  currentShares: TaggedValue;
  fiftyTwoWeekLow: TaggedValue;
  fiftyTwoWeekHigh: TaggedValue;
  riskFreeRate: TaggedValue;
  equityRiskPremium: TaggedValue;
  terminalGdpGrowth: TaggedValue;
  peerExitMultiple: TaggedValue;
  releveredBeta: TaggedValue;
  preTaxCostOfDebt: TaggedValue;
  targetDebtWeight: TaggedValue;
  targetEquityWeight: TaggedValue;
  peerBetas: PeerBeta[];
  analystEstimates: AnalystEstimate[];
};

export type ProjectionAssumptions = {
  projectionYears: number;
  valuationDate: string;
  discountingConvention: "mid-year" | "end-of-year";
  revenueGrowth: TaggedValue[];
  ebitMargin: TaggedValue[];
  depreciationAmortizationPctRevenue: TaggedValue[];
  stockBasedCompensationPctRevenue: TaggedValue[];
  capitalExpendituresPctRevenue: TaggedValue[];
  netWorkingCapitalPctRevenue: TaggedValue[];
  operatingTaxRate: TaggedValue[];
  terminalGrowth: TaggedValue;
  terminalRoic: TaggedValue;
  exitMultiple: TaggedValue;
  riskFreeRate: TaggedValue;
  equityRiskPremium: TaggedValue;
  releveredBeta: TaggedValue;
  countryRiskPremium: TaggedValue;
  sizePremium: TaggedValue;
  preTaxCostOfDebt: TaggedValue;
  debtWeight: TaggedValue;
  equityWeight: TaggedValue;
  preferredWeight: TaggedValue;
  preferredCost: TaggedValue;
  usableInterestTaxRate: TaggedValue;
  stockCompensationAddBack: boolean;
};

export type EquityBridge = {
  cash: TaggedValue;
  operatingCashRequirement: TaggedValue;
  shortTermInvestments: TaggedValue;
  debt: TaggedValue;
  financeLeaseLiabilities: TaggedValue;
  operatingLeaseLiabilities: TaggedValue;
  otherDebtLikeLiabilities: TaggedValue;
  minorityInterest: TaggedValue;
  preferredStock: TaggedValue;
  equityMethodInvestments: TaggedValue;
  otherNonOperatingAssets: TaggedValue;
  presentValueOfNols: TaggedValue;
  basicShares: TaggedValue;
  options: TaggedValue;
  optionStrikePrice: TaggedValue;
  rsus: TaggedValue;
};

export type ModelPayload = {
  generatedAt: string;
  identity: CompanyIdentity;
  historicals: HistoricalFinancials;
  market: MarketInputs;
  assumptions: ProjectionAssumptions;
  bridge: EquityBridge;
  gaps: DataGap[];
};

export type ProjectionYear = {
  fiscalYear: number;
  endDate: string;
  revenue: number;
  growth: number;
  ebitMargin: number;
  ebit: number;
  cashTaxes: number;
  nopat: number;
  depreciationAmortization: number;
  stockBasedCompensation: number;
  capitalExpenditures: number;
  netWorkingCapital: number;
  changeInNetWorkingCapital: number;
  unleveredFreeCashFlow: number;
  fullYearUnleveredFreeCashFlow: number;
  stubFraction: number;
  discountPeriod: number;
  discountFactor: number;
  presentValueOfFreeCashFlow: number;
};

export type DcfResult = {
  ready: boolean;
  errors: string[];
  warnings: string[];
  projections: ProjectionYear[];
  costOfEquity: number | null;
  afterTaxCostOfDebt: number | null;
  wacc: number | null;
  terminalValueGordon: number | null;
  terminalValueExitMultiple: number | null;
  impliedExitMultiple: number | null;
  impliedPerpetuityGrowth: number | null;
  presentValueExplicitCashFlows: number | null;
  presentValueTerminalGordon: number | null;
  presentValueTerminalExit: number | null;
  enterpriseValueGordon: number | null;
  enterpriseValueExit: number | null;
  terminalValuePctEnterpriseValue: number | null;
  terminalNopat: number | null;
  terminalReinvestmentRate: number | null;
  terminalFreeCashFlow: number | null;
  terminalDiscountPeriod: number | null;
  terminalDiscountFactor: number | null;
  commonEquityValueGordon: number | null;
  commonEquityValueExit: number | null;
  fullyDilutedShares: number | null;
  impliedSharePriceGordon: number | null;
  impliedSharePriceExit: number | null;
  upsideDownsideGordon: number | null;
  bridgeAdjustments: number | null;
};

import type {
  CompanyIdentity,
  FiscalPeriod,
  HistoricalFinancials,
  PeriodFinancials,
  Provenance,
  TaggedValue,
} from "../model/types";

type SecFact = {
  start?: string;
  end: string;
  val: number;
  accn: string;
  fy?: number;
  fp?: string;
  form: string;
  filed: string;
  frame?: string;
};

type SecConcept = {
  label: string;
  description: string;
  units: Record<string, SecFact[]>;
};

type CompanyFactsResponse = {
  cik: number;
  entityName: string;
  facts: Record<string, Record<string, SecConcept>>;
};

type TickerRecord = {
  cik_str: number;
  ticker: string;
  title: string;
};

type SubmissionsResponse = {
  cik: string;
  name: string;
  entityType: string;
  sic: string;
  sicDescription: string;
  fiscalYearEnd: string;
  exchanges: string[];
  tickers: string[];
  filings: {
    recent: {
      accessionNumber: string[];
      primaryDocument: string[];
    };
  };
};

const SEC_BASE = "https://data.sec.gov";
const SEC_FILES = "https://www.sec.gov/files";
const CACHE_TTL = 6 * 60 * 60 * 1000;
const memoryCache = new Map<string, { expires: number; value: unknown }>();

const DEFAULT_SEC_USER_AGENT =
  "Chatur05 banker-ready-dcf chatur05@users.noreply.github.com";

const TAGS = {
  revenue: ["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues", "SalesRevenueNet"],
  ebit: ["OperatingIncomeLoss"],
  da: ["DepreciationDepletionAndAmortization", "DepreciationDepletionAndAmortizationPropertyPlantAndEquipment"],
  sbc: ["ShareBasedCompensation"],
  capex: ["PaymentsToAcquirePropertyPlantAndEquipment", "PaymentsForAdditionsToPropertyPlantAndEquipment"],
  cashTaxes: ["IncomeTaxesPaidNet"],
  taxExpense: ["IncomeTaxExpenseBenefit"],
  pretaxIncome: ["IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest", "IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments", "IncomeLossFromContinuingOperationsBeforeIncomeTaxes"],
  interestExpense: ["InterestExpenseNonOperating", "InterestAndDebtExpense"],
  receivables: ["AccountsReceivableNetCurrent", "AccountsNotesAndLoansReceivableNetCurrent"],
  otherReceivables: ["NontradeReceivablesCurrent"],
  inventory: ["InventoryNet"],
  payables: ["AccountsPayableCurrent"],
  deferredRevenue: ["ContractWithCustomerLiabilityCurrent", "DeferredRevenueCurrent"],
  otherCurrentAssets: ["OtherCurrentAssets"],
  otherCurrentLiabilities: ["OtherCurrentLiabilities"],
  cash: ["CashAndCashEquivalentsAtCarryingValue"],
  shortTermInvestments: ["ShortTermInvestments", "MarketableSecuritiesCurrent"],
  shortTermBorrowings: ["ShortTermBorrowings", "CommercialPaper"],
  currentTermDebt: ["LongTermDebtCurrent", "CurrentPortionOfLongTermDebt"],
  // Keep lease-inclusive concepts out of funded debt because finance leases
  // are shown separately in the enterprise-to-equity bridge.
  longTermDebt: ["LongTermDebtNoncurrent"],
  financeLeaseCurrent: ["FinanceLeaseLiabilityCurrent"],
  financeLeaseNoncurrent: ["FinanceLeaseLiabilityNoncurrent"],
  operatingLeaseCurrent: ["OperatingLeaseLiabilityCurrent"],
  operatingLeaseNoncurrent: ["OperatingLeaseLiabilityNoncurrent"],
  minorityInterest: ["MinorityInterest", "NoncontrollingInterestInConsolidatedEntity"],
  preferredStock: ["PreferredStockValue", "PreferredStocksIncludingAdditionalPaidInCapital"],
  equityMethodInvestments: ["EquityMethodInvestments", "InvestmentInAffiliatesSubsidiariesAssociatesAndJointVentures"],
  stockholdersEquity: ["StockholdersEquity", "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest"],
  basicShares: ["WeightedAverageNumberOfSharesOutstandingBasic"],
  dilutedShares: ["WeightedAverageNumberOfDilutedSharesOutstanding"],
  sharesOutstanding: ["CommonStockSharesOutstanding"],
  options: ["ShareBasedCompensationArrangementByShareBasedPaymentAwardOptionsOutstandingNumber"],
  optionStrike: ["ShareBasedCompensationArrangementByShareBasedPaymentAwardOptionsOutstandingWeightedAverageExercisePrice"],
  rsus: ["ShareBasedCompensationArrangementByShareBasedPaymentAwardEquityInstrumentsOtherThanOptionsOutstandingNumber"],
  nolBalance: ["DeferredTaxAssetsOperatingLossCarryforwards"],
} as const;

async function fetchJson<T>(url: string): Promise<T> {
  const cached = memoryCache.get(url);
  if (cached && cached.expires > Date.now()) return cached.value as T;
  const response = await fetch(url, {
    headers: {
      "User-Agent": process.env.SEC_USER_AGENT ?? DEFAULT_SEC_USER_AGENT,
      Accept: "application/json",
    },
  });
  if (!response.ok) throw new Error(`SEC request failed (${response.status}) for ${url}`);
  const value = await response.json() as T;
  memoryCache.set(url, { expires: Date.now() + CACHE_TTL, value });
  return value;
}

function archiveUrl(
  cik: string,
  accessionNumber: string,
  primaryDocuments: Map<string, string>,
): string {
  const document = primaryDocuments.get(accessionNumber);
  const cleanCik = String(Number(cik));
  const cleanAccession = accessionNumber.replaceAll("-", "");
  return document
    ? `https://www.sec.gov/Archives/edgar/data/${cleanCik}/${cleanAccession}/${document}`
    : `https://www.sec.gov/Archives/edgar/data/${cleanCik}/${cleanAccession}/`;
}

function missing(label: string, units: string, notes?: string): TaggedValue {
  return {
    value: null,
    provenance: { origin: "missing", label, units, notes },
  };
}

function unitsFor(concept: SecConcept, preferred: string[]): [string, SecFact[]] | null {
  for (const unit of preferred) {
    if (concept.units[unit]?.length) return [unit, concept.units[unit]];
  }
  const first = Object.entries(concept.units)[0];
  return first ?? null;
}

function conceptsFor(facts: CompanyFactsResponse, tags: readonly string[]): Array<[string, SecConcept]> {
  const usGaap = facts.facts["us-gaap"] ?? {};
  return tags.flatMap((tag) => usGaap[tag] ? [[tag, usGaap[tag]] as [string, SecConcept]] : []);
}

function chooseFact(
  facts: CompanyFactsResponse,
  tags: readonly string[],
  preferredUnits: string[],
  period: FiscalPeriod,
  duration: boolean,
): { tag: string; concept: SecConcept; unit: string; fact: SecFact } | null {
  const candidates: Array<{ tag: string; concept: SecConcept; unit: string; fact: SecFact; score: number }> = [];
  for (const [tag, concept] of conceptsFor(facts, tags)) {
    const unitFacts = unitsFor(concept, preferredUnits);
    if (!unitFacts) continue;
    const [unit, entries] = unitFacts;
    for (const fact of entries) {
      if (fact.end !== period.endDate) continue;
      if (duration !== Boolean(fact.start)) continue;
      if (!["10-K", "10-K/A", "10-Q", "10-Q/A"].includes(fact.form)) continue;
      let score = 0;
      if (fact.accn === period.accessionNumber) score += 10;
      if (fact.form === period.form) score += 4;
      if (fact.fy === period.fiscalYear) score += 2;
      if (fact.filed === period.filingDate) score += 1;
      candidates.push({ tag, concept, unit, fact, score });
    }
  }
  return candidates.sort((a, b) => b.score - a.score || b.fact.filed.localeCompare(a.fact.filed))[0] ?? null;
}

function latestFact(
  facts: CompanyFactsResponse,
  tags: readonly string[],
  preferredUnits: string[],
): { tag: string; concept: SecConcept; unit: string; fact: SecFact } | null {
  const candidates: Array<{ tag: string; concept: SecConcept; unit: string; fact: SecFact }> = [];
  for (const [tag, concept] of conceptsFor(facts, tags)) {
    const unitFacts = unitsFor(concept, preferredUnits);
    if (!unitFacts) continue;
    const [unit, entries] = unitFacts;
    for (const fact of entries) {
      if (!["10-K", "10-K/A", "10-Q", "10-Q/A", "DEF 14A"].includes(fact.form)) continue;
      candidates.push({ tag, concept, unit, fact });
    }
  }
  return candidates.sort((a, b) =>
    b.fact.end.localeCompare(a.fact.end) || b.fact.filed.localeCompare(a.fact.filed))[0] ?? null;
}

function tagged(
  selection: ReturnType<typeof chooseFact> | ReturnType<typeof latestFact>,
  label: string,
  cik: string,
  primaryDocuments: Map<string, string>,
  scale: number,
): TaggedValue {
  if (!selection) return missing(label, scale === 1_000_000 ? "$mm" : "mm shares");
  const { tag, concept, unit, fact } = selection;
  const units = unit === "shares" ? "mm shares" : unit === "USD/shares" ? "$ / share" : "$mm";
  const provenance: Provenance = {
    origin: "sourced",
    label: concept.label || label,
    sourceUrl: archiveUrl(cik, fact.accn, primaryDocuments),
    asOf: fact.end,
    filingDate: fact.filed,
    fiscalPeriod: `${fact.fy ?? ""} ${fact.fp ?? ""}`.trim(),
    accessionNumber: fact.accn,
    units,
    notes: `SEC XBRL tag: us-gaap:${tag}; reported unit: ${unit}`,
  };
  return { value: fact.val / scale, provenance };
}

function sumTagged(label: string, values: TaggedValue[]): TaggedValue {
  const available = values.filter((value) => value.value !== null);
  if (!available.length) return missing(label, values[0]?.provenance.units ?? "$mm");
  return {
    value: available.reduce((sum, value) => sum + value.value!, 0),
    provenance: {
      origin: "derived",
      label,
      asOf: available.map((value) => value.provenance.asOf).filter(Boolean).sort().at(-1),
      filingDate: available.map((value) => value.provenance.filingDate).filter(Boolean).sort().at(-1),
      units: available[0].provenance.units,
      sourceUrl: available[0].provenance.sourceUrl,
      notes: `Sum of ${available.map((value) => value.provenance.label).join(", ")}.`,
    },
  };
}

function annualPeriods(facts: CompanyFactsResponse): FiscalPeriod[] {
  const revenueConcepts = conceptsFor(facts, TAGS.revenue);
  const candidates: SecFact[] = [];
  for (const [, concept] of revenueConcepts) {
    const unitFacts = unitsFor(concept, ["USD"]);
    if (!unitFacts) continue;
    candidates.push(...unitFacts[1].filter((fact) => {
      if (!fact.start || !["10-K", "10-K/A"].includes(fact.form)) return false;
      const days = (new Date(fact.end).getTime() - new Date(fact.start).getTime()) / 86_400_000;
      return fact.fp === "FY" && days >= 300 && days <= 430;
    }));
  }
  const byEnd = new Map<string, SecFact>();
  for (const fact of candidates.sort((a, b) => a.filed.localeCompare(b.filed))) byEnd.set(fact.end, fact);
  return [...byEnd.values()]
    .sort((a, b) => a.end.localeCompare(b.end))
    .slice(-6)
    .map((fact) => ({
      fiscalYear: fact.fy ?? new Date(fact.end).getUTCFullYear(),
      startDate: fact.start,
      endDate: fact.end,
      filingDate: fact.filed,
      form: fact.form,
      accessionNumber: fact.accn,
      label: `FY${fact.fy ?? new Date(fact.end).getUTCFullYear()}`,
      interim: false,
    }));
}

function latestInterimPeriod(facts: CompanyFactsResponse): FiscalPeriod | null {
  const candidates: SecFact[] = [];
  for (const [, concept] of conceptsFor(facts, TAGS.revenue)) {
    const unitFacts = unitsFor(concept, ["USD"]);
    if (!unitFacts) continue;
    candidates.push(...unitFacts[1].filter((fact) => fact.start
      && ["10-Q", "10-Q/A"].includes(fact.form)
      && ["Q1", "Q2", "Q3"].includes(fact.fp ?? "")));
  }
  const fact = candidates.sort((a, b) =>
    b.end.localeCompare(a.end) || b.filed.localeCompare(a.filed))[0];
  if (!fact) return null;
  const durationDays = fact.start
    ? Math.round((new Date(fact.end).getTime() - new Date(fact.start).getTime()) / 86_400_000)
    : null;
  return {
    fiscalYear: fact.fy ?? new Date(fact.end).getUTCFullYear(),
    startDate: fact.start,
    endDate: fact.end,
    filingDate: fact.filed,
    form: fact.form,
    accessionNumber: fact.accn,
    label: durationDays && durationDays > 130 ? `${fact.fp} YTD` : fact.fp ?? "Latest interim",
    interim: true,
  };
}

function buildPeriod(
  facts: CompanyFactsResponse,
  period: FiscalPeriod,
  cik: string,
  primaryDocuments: Map<string, string>,
): PeriodFinancials {
  const duration = (tags: readonly string[], label: string, units = ["USD"], scale = 1_000_000) =>
    tagged(chooseFact(facts, tags, units, period, true), label, cik, primaryDocuments, scale);
  const instant = (tags: readonly string[], label: string, units = ["USD"], scale = 1_000_000) =>
    tagged(chooseFact(facts, tags, units, period, false), label, cik, primaryDocuments, scale);
  const shortTermBorrowings = instant(TAGS.shortTermBorrowings, "Short-term borrowings");
  const currentTermDebt = instant(TAGS.currentTermDebt, "Current portion of long-term debt");
  const longTermDebt = instant(TAGS.longTermDebt, "Long-term debt");
  const financeLeaseCurrent = instant(TAGS.financeLeaseCurrent, "Finance lease liabilities, current");
  const financeLeaseNoncurrent = instant(TAGS.financeLeaseNoncurrent, "Finance lease liabilities, noncurrent");
  const operatingLeaseCurrent = instant(TAGS.operatingLeaseCurrent, "Operating lease liabilities, current");
  const operatingLeaseNoncurrent = instant(TAGS.operatingLeaseNoncurrent, "Operating lease liabilities, noncurrent");
  return {
    period,
    revenue: duration(TAGS.revenue, "Revenue"),
    ebit: duration(TAGS.ebit, "Operating income (EBIT)"),
    depreciationAmortization: duration(TAGS.da, "Depreciation and amortization"),
    stockBasedCompensation: duration(TAGS.sbc, "Stock-based compensation"),
    capitalExpenditures: duration(TAGS.capex, "Capital expenditures"),
    cashTaxes: duration(TAGS.cashTaxes, "Cash taxes paid"),
    incomeTaxExpense: duration(TAGS.taxExpense, "Income tax expense"),
    pretaxIncome: duration(TAGS.pretaxIncome, "Pre-tax income"),
    interestExpense: duration(TAGS.interestExpense, "Interest expense"),
    accountsReceivable: instant(TAGS.receivables, "Accounts receivable"),
    inventory: instant(TAGS.inventory, "Inventory"),
    accountsPayable: instant(TAGS.payables, "Accounts payable"),
    deferredRevenue: instant(TAGS.deferredRevenue, "Deferred revenue / contract liabilities"),
    otherCurrentAssets: sumTagged("Other operating current assets", [
      instant(TAGS.otherCurrentAssets, "Other current assets"),
      instant(TAGS.otherReceivables, "Vendor / non-trade receivables"),
    ]),
    otherCurrentLiabilities: instant(TAGS.otherCurrentLiabilities, "Other current liabilities"),
    cash: instant(TAGS.cash, "Cash and equivalents"),
    shortTermInvestments: instant(TAGS.shortTermInvestments, "Short-term investments"),
    totalDebt: sumTagged("Total debt", [shortTermBorrowings, currentTermDebt, longTermDebt]),
    financeLeaseLiabilities: sumTagged("Finance lease liabilities", [financeLeaseCurrent, financeLeaseNoncurrent]),
    operatingLeaseLiabilities: sumTagged("Operating lease liabilities", [operatingLeaseCurrent, operatingLeaseNoncurrent]),
    minorityInterest: instant(TAGS.minorityInterest, "Minority interest"),
    preferredStock: instant(TAGS.preferredStock, "Preferred stock"),
    equityMethodInvestments: instant(TAGS.equityMethodInvestments, "Equity-method investments"),
    stockholdersEquity: instant(TAGS.stockholdersEquity, "Stockholders' equity"),
    basicShares: duration(TAGS.basicShares, "Weighted-average basic shares", ["shares"], 1_000_000),
    dilutedShares: duration(TAGS.dilutedShares, "Weighted-average diluted shares", ["shares"], 1_000_000),
    sharesOutstanding: instant(TAGS.sharesOutstanding, "Common shares outstanding", ["shares"], 1_000_000),
  };
}

function fcffEligibility(submissions: SubmissionsResponse): { eligible: boolean; reason: string | null } {
  const sic = Number(submissions.sic);
  const name = submissions.name.toLowerCase();
  if ((sic >= 6000 && sic <= 6799) || name.includes("reit")) {
    return {
      eligible: false,
      reason: "Unlevered FCFF DCF is disabled for financial institutions, insurers, and REITs. Use a dividend, residual-income, or FFO framework.",
    };
  }
  return { eligible: true, reason: null };
}

export type SecBundle = {
  identity: CompanyIdentity;
  historicals: HistoricalFinancials;
  latestOptions: TaggedValue;
  latestOptionStrike: TaggedValue;
  latestRsus: TaggedValue;
  latestNolBalance: TaggedValue;
};

export async function loadSecBundle(rawTicker: string): Promise<SecBundle> {
  const ticker = rawTicker.trim().toUpperCase();
  const tickers = await fetchJson<Record<string, TickerRecord>>(`${SEC_FILES}/company_tickers.json`);
  const match = Object.values(tickers).find((record) => record.ticker.toUpperCase() === ticker);
  if (!match) throw new Error(`Ticker ${ticker} was not found in the SEC ticker file.`);
  const cik = String(match.cik_str).padStart(10, "0");
  const [facts, submissions] = await Promise.all([
    fetchJson<CompanyFactsResponse>(`${SEC_BASE}/api/xbrl/companyfacts/CIK${cik}.json`),
    fetchJson<SubmissionsResponse>(`${SEC_BASE}/submissions/CIK${cik}.json`),
  ]);
  const primaryDocuments = new Map<string, string>();
  submissions.filings.recent.accessionNumber.forEach((accession, index) => {
    primaryDocuments.set(accession, submissions.filings.recent.primaryDocument[index]);
  });
  const periods = annualPeriods(facts);
  const interimPeriod = latestInterimPeriod(facts);
  const eligibility = fcffEligibility(submissions);
  const identity: CompanyIdentity = {
    ticker,
    cik,
    name: submissions.name || facts.entityName || match.title,
    fiscalYearEnd: submissions.fiscalYearEnd,
    sic: submissions.sic,
    sicDescription: submissions.sicDescription,
    exchange: submissions.exchanges[0] ?? null,
    entityType: submissions.entityType,
    valuationMethodEligible: eligibility.eligible,
    ineligibleReason: eligibility.reason,
  };
  return {
    identity,
    historicals: {
      annual: periods.map((period) => buildPeriod(facts, period, cik, primaryDocuments)),
      latestInterim: interimPeriod ? buildPeriod(facts, interimPeriod, cik, primaryDocuments) : null,
    },
    latestOptions: tagged(latestFact(facts, TAGS.options, ["shares"]), "Options outstanding", cik, primaryDocuments, 1_000_000),
    latestOptionStrike: tagged(latestFact(facts, TAGS.optionStrike, ["USD/shares"]), "Weighted-average option strike", cik, primaryDocuments, 1),
    latestRsus: tagged(latestFact(facts, TAGS.rsus, ["shares"]), "RSUs outstanding", cik, primaryDocuments, 1_000_000),
    latestNolBalance: tagged(latestFact(facts, TAGS.nolBalance, ["USD"]), "Tax NOL carryforwards", cik, primaryDocuments, 1_000_000),
  };
}

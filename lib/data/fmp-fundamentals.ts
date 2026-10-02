import type {
  CompanyIdentity,
  FiscalPeriod,
  PeriodFinancials,
  TaggedValue,
} from "../model/types";
import { fetchFmp } from "./fmp";
import type { SecBundle } from "./sec";
import { numeric } from "./numeric";

type RecordValue = Record<string, unknown>;

function rows(payload: unknown): RecordValue[] {
  return Array.isArray(payload) ? payload.filter((item): item is RecordValue => Boolean(item) && typeof item === "object") : [];
}

function source(record: RecordValue | undefined): string | undefined {
  const link = record?.finalLink ?? record?.link;
  return typeof link === "string" && /^https?:\/\//.test(link) ? link
    : typeof record?._source === "string" ? record._source : undefined;
}

function tagged(
  record: RecordValue | undefined,
  keys: string[],
  label: string,
  scale = 1_000_000,
  units = "$mm",
  absolute = false,
): TaggedValue {
  const raw = numeric(record, keys);
  const sourceKey = keys.find((key) => numeric(record, [key]) !== null) ?? keys[0];
  if (raw === null) {
    return {
      value: null,
      provenance: {
        origin: "missing",
        label,
        units,
        notes: `FMP standardized filing fallback did not return ${keys.join(" / ")}.`,
      },
    };
  }
  return {
    value: (absolute ? Math.abs(raw) : raw) / scale,
    provenance: {
      origin: "sourced",
      label,
      units,
      sourceUrl: source(record),
      asOf: String(record?.date ?? ""),
      filingDate: String(record?.filingDate ?? record?.fillingDate ?? record?.acceptedDate ?? ""),
      fiscalPeriod: `${record?.fiscalYear ?? record?.calendarYear ?? ""} ${record?.period ?? ""}`.trim(),
      notes: `FMP standardized statement field: ${sourceKey}. The link identifies the provider statement, not independent SEC verification. Reconcile material classifications to the issuer filing.`,
    },
  };
}

function sum(label: string, values: TaggedValue[]): TaggedValue {
  const available = values.filter((value) => value.value !== null);
  if (available.length !== values.length) return { value: null, provenance: { origin: "missing", label, units: "$mm", notes: "One or more required debt components were not reported." } };
  return {
    value: available.reduce((total, value) => total + value.value!, 0),
    provenance: {
      origin: "derived",
      label,
      units: available[0].provenance.units,
      sourceUrl: available[0].provenance.sourceUrl,
      asOf: available[0].provenance.asOf,
      notes: `Derived from ${available.map((value) => value.provenance.label).join(", ")}.`,
    },
  };
}

function period(record: RecordValue, interim: boolean): FiscalPeriod {
  const endDate = String(record.date ?? "");
  const fiscalYear = Number(record.fiscalYear ?? record.calendarYear ?? endDate.slice(0, 4));
  const periodLabel = String(record.period ?? (interim ? "Interim" : "FY"));
  return {
    fiscalYear,
    endDate,
    filingDate: String(record.filingDate ?? record.fillingDate ?? record.acceptedDate ?? ""),
    form: interim ? "10-Q" : "10-K",
    accessionNumber: String(record.accessionNumber ?? ""),
    label: interim ? `${periodLabel} ${fiscalYear}` : `FY${fiscalYear}`,
    interim,
  };
}

function buildPeriod(
  income: RecordValue,
  balance: RecordValue | undefined,
  cashFlow: RecordValue | undefined,
  interim: boolean,
): PeriodFinancials {
  const fiscalPeriod = period(income, interim);
  const currentDebt = tagged(balance, ["shortTermDebt", "currentPortionOfLongTermDebt"], "Short-term debt");
  const longTermDebt = tagged(balance, ["longTermDebt", "longTermDebtNoncurrent"], "Long-term debt");
  const otherLiabilities = tagged(balance, ["otherCurrentLiabilities"], "Other current liabilities");
  // FMP can report accrued expenses and other payables separately. Derive the
  // residual from the control total to avoid either omitting or double counting them.
  const liabilityKeys = ["totalCurrentLiabilities", "accountPayables", "deferredRevenue", "shortTermDebt"];
  const liabilityParts = liabilityKeys.map((key) => numeric(balance, [key]));
  if (liabilityParts.every((value) => value !== null)) {
    otherLiabilities.value = (liabilityParts[0]! - liabilityParts[1]! - liabilityParts[2]! - liabilityParts[3]!
      - (numeric(balance, ["capitalLeaseObligationsCurrent"]) ?? 0)) / 1_000_000;
    otherLiabilities.provenance = { ...otherLiabilities.provenance, origin: "derived", notes: "Total current liabilities less trade payables, deferred revenue, funded current debt and separately reported current leases. Includes separately classified accruals and other payables; review tax and lease classifications." };
  }
  return {
    period: fiscalPeriod,
    revenue: tagged(income, ["revenue"], "Revenue"),
    ebit: tagged(income, ["operatingIncome"], "Operating income (EBIT)"),
    depreciationAmortization: tagged(cashFlow, ["depreciationAndAmortization", "depreciationAndAmortizationInIncomeStatement"], "Depreciation and amortization", 1_000_000, "$mm", true),
    stockBasedCompensation: tagged(cashFlow, ["stockBasedCompensation"], "Stock-based compensation", 1_000_000, "$mm", true),
    capitalExpenditures: tagged(cashFlow, ["capitalExpenditure", "investmentsInPropertyPlantAndEquipment"], "Capital expenditures", 1_000_000, "$mm", true),
    cashTaxes: tagged(cashFlow, ["incomeTaxesPaid"], "Cash taxes paid", 1_000_000, "$mm", true),
    incomeTaxExpense: tagged(income, ["incomeTaxExpense"], "Income tax expense"),
    pretaxIncome: tagged(income, ["incomeBeforeTax"], "Pre-tax income"),
    interestExpense: tagged(income, ["interestExpense", "interestExpenseNonOperating"], "Interest expense", 1_000_000, "$mm", true),
    accountsReceivable: tagged(balance, ["netReceivables", "accountsReceivables"], "Accounts receivable"),
    inventory: tagged(balance, ["inventory"], "Inventory"),
    accountsPayable: tagged(balance, ["accountPayables", "accountsPayable"], "Accounts payable"),
    deferredRevenue: tagged(balance, ["deferredRevenue", "deferredRevenueCurrent"], "Deferred revenue"),
    otherCurrentAssets: tagged(balance, ["otherCurrentAssets"], "Other current assets"),
    otherCurrentLiabilities: otherLiabilities,
    cash: tagged(balance, ["cashAndCashEquivalents"], "Cash and equivalents"),
    shortTermInvestments: tagged(balance, ["shortTermInvestments"], "Short-term investments"),
    totalDebt: sum("Total debt", [currentDebt, longTermDebt]),
    financeLeaseLiabilities: tagged(balance, ["financeLeaseLiabilities"], "Finance lease liabilities"),
    operatingLeaseLiabilities: tagged(balance, ["operatingLeaseLiabilities", "capitalLeaseObligations"], "Operating and unclassified lease liabilities"),
    minorityInterest: tagged(balance, ["minorityInterest"], "Minority interest"),
    preferredStock: tagged(balance, ["preferredStock"], "Preferred stock"),
    equityMethodInvestments: tagged(balance, ["investmentsInFinancialAssets", "longTermInvestments"], "Equity-method investments"),
    stockholdersEquity: tagged(balance, ["totalStockholdersEquity", "totalEquity"], "Stockholders' equity"),
    basicShares: tagged(income, ["weightedAverageShsOut"], "Weighted-average basic shares", 1_000_000, "mm shares"),
    dilutedShares: tagged(income, ["weightedAverageShsOutDil"], "Weighted-average diluted shares", 1_000_000, "mm shares"),
    sharesOutstanding: tagged(income, ["weightedAverageShsOut"], "Common shares outstanding proxy", 1_000_000, "mm shares"),
  };
}

export async function loadFmpFundamentals(ticker: string): Promise<SecBundle> {
  const optional = <T>(request: Promise<T>, fallback: T) => request.catch(() => fallback);
  const profile = rows(await fetchFmp<unknown>("/profile", { symbol: ticker }))[0];
  if (!profile) throw new Error(`FMP returned no company profile for ${ticker}.`);
  const sector = String(profile.sector ?? "");
  const industry = String(profile.industry ?? "");
  const restricted = /financial|bank|insurance|reit|real estate investment trust/i.test(`${sector} ${industry}`);
  if (restricted) throw new Error("Unsupported valuation method: financial institutions, insurers and REITs require a sector-specific model, not consolidated unlevered FCFF.");
  if (["F", "GM"].includes(ticker.toUpperCase())) throw new Error("Unsupported consolidated valuation: this automaker has a material captive-finance business. Value industrial operations and the finance subsidiary separately; consolidated debt cannot be subtracted from an industrial FCFF valuation.");
  if (profile.isAdr === true || (profile.currency && profile.currency !== "USD")) throw new Error("Unsupported currency or ADR: a consistent currency conversion and share-ratio schedule is required before producing a USD per-share valuation.");
  const [annualIncomePayload, annualBalancePayload, annualCashPayload, quarterIncomePayload, quarterBalancePayload, quarterCashPayload] = await Promise.all([
    fetchFmp<unknown>("/income-statement", { symbol: ticker, period: "annual", limit: "5" }),
    fetchFmp<unknown>("/balance-sheet-statement", { symbol: ticker, period: "annual", limit: "5" }),
    fetchFmp<unknown>("/cash-flow-statement", { symbol: ticker, period: "annual", limit: "5" }),
    optional(fetchFmp<unknown>("/income-statement", { symbol: ticker, period: "quarter", limit: "4" }), []),
    optional(fetchFmp<unknown>("/balance-sheet-statement", { symbol: ticker, period: "quarter", limit: "4" }), []),
    optional(fetchFmp<unknown>("/cash-flow-statement", { symbol: ticker, period: "quarter", limit: "4" }), []),
  ]);
  const clean = (payload: unknown, endpoint: string, frequency: string) => {
    const today = new Date().toISOString().slice(0, 10);
    const unique = new Map<string, RecordValue>();
    for (const row of rows(payload).sort((a, b) => String(b.acceptedDate ?? b.filingDate ?? "").localeCompare(String(a.acceptedDate ?? a.filingDate ?? "")))) {
      const date = String(row.date ?? "");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > today || String(row.filingDate ?? row.acceptedDate ?? "").slice(0, 10) > today) continue;
      if (row.reportedCurrency !== "USD") throw new Error(`Statement currency for ${ticker} is ${row.reportedCurrency ?? "unknown"}; USD statements are required.`);
      if (!unique.has(date)) unique.set(date, { ...row, _source: `https://financialmodelingprep.com/stable/${endpoint}?symbol=${encodeURIComponent(ticker)}&period=${frequency}` });
    }
    return [...unique.values()];
  };
  const annualIncome = clean(annualIncomePayload, "income-statement", "annual").sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const annualBalance = clean(annualBalancePayload, "balance-sheet-statement", "annual");
  const annualCash = clean(annualCashPayload, "cash-flow-statement", "annual");
  if (!profile || !annualIncome.length) throw new Error(`FMP filing fallback returned no annual statements for ${ticker}.`);
  const matching = (items: RecordValue[], date: unknown) => items.find((item) => item.date === date);
  const annual = annualIncome.map((income) => {
    const balance = matching(annualBalance, income.date);
    const cash = matching(annualCash, income.date);
    if (!balance || !cash) throw new Error(`Incomplete annual statements for ${ticker} at ${income.date}: matching income, balance sheet and cash-flow statements are required.`);
    const built = buildPeriod(income, balance, cash, false);
    for (const key of ["revenue", "ebit", "depreciationAmortization", "capitalExpenditures", "cash", "totalDebt"] as const) {
      if (built[key].value === null) throw new Error(`Missing required ${key} for ${ticker} at ${income.date}; a generic assumption cannot replace core reported data.`);
    }
    return built;
  });
  const quarterIncome = clean(quarterIncomePayload, "income-statement", "quarter")
    .filter((row) => String(row.date) > (annual.at(-1)?.period.endDate ?? "") && row.period !== "Q4")
    .sort((a, b) => String(b.date).localeCompare(String(a.date)))[0];
  const latestInterim = quarterIncome
    ? buildPeriod(quarterIncome, matching(clean(quarterBalancePayload, "balance-sheet-statement", "quarter"), quarterIncome.date), matching(clean(quarterCashPayload, "cash-flow-statement", "quarter"), quarterIncome.date), true)
    : null;
  const identity: CompanyIdentity = {
    ticker,
    cik: String(profile.cik ?? ""),
    name: String(profile.companyName ?? ticker),
    fiscalYearEnd: String(profile.fiscalYearEnd ?? annual.at(-1)?.period.endDate.slice(5).replace("-", "") ?? ""),
    sic: String(profile.sicCode ?? ""),
    sicDescription: industry,
    exchange: String(profile.exchangeShortName ?? profile.exchange ?? "") || null,
    entityType: "operating company",
    valuationMethodEligible: !restricted,
    ineligibleReason: restricted
      ? "Unlevered FCFF DCF is disabled for financial institutions, insurers, and REITs."
      : null,
  };
  const missingAward = (label: string, units: string): TaggedValue => ({
    value: null,
    provenance: {
      origin: "missing",
      label,
      units,
      notes: "FMP statement fallback does not provide award-level option and RSU disclosure. Enter values from the compensation footnote.",
    },
  });
  return {
    identity,
    historicals: { annual, latestInterim },
    latestOptions: missingAward("Options outstanding", "mm shares"),
    latestOptionStrike: missingAward("Weighted-average option strike", "$ / share"),
    latestRsus: missingAward("RSUs outstanding", "mm shares"),
    latestNolBalance: missingAward("Tax NOL carryforwards", "$mm"),
  };
}

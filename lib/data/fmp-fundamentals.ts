import type {
  CompanyIdentity,
  FiscalPeriod,
  PeriodFinancials,
  TaggedValue,
} from "../model/types";
import { fetchFmp } from "./fmp";
import type { SecBundle } from "./sec";

type RecordValue = Record<string, unknown>;

function rows(payload: unknown): RecordValue[] {
  return Array.isArray(payload) ? payload.filter((item): item is RecordValue => Boolean(item) && typeof item === "object") : [];
}

function numeric(record: RecordValue | undefined, keys: string[]): number | null {
  if (!record) return null;
  for (const key of keys) {
    const value = Number(record[key]);
    if (Number.isFinite(value)) return value;
  }
  return null;
}

function source(record: RecordValue | undefined): string | undefined {
  const link = record?.finalLink ?? record?.link;
  return typeof link === "string" ? link : undefined;
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
      filingDate: String(record?.fillingDate ?? record?.acceptedDate ?? ""),
      fiscalPeriod: `${record?.fiscalYear ?? record?.calendarYear ?? ""} ${record?.period ?? ""}`.trim(),
      notes: `FMP standardized filing fallback field: ${keys[0]}. Direct SEC access was unavailable; verify against the linked filing.`,
    },
  };
}

function sum(label: string, values: TaggedValue[]): TaggedValue {
  const available = values.filter((value) => value.value !== null);
  if (!available.length) return { value: null, provenance: { origin: "missing", label, units: "$mm" } };
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
    filingDate: String(record.fillingDate ?? record.acceptedDate ?? ""),
    form: interim ? "10-Q" : "10-K",
    accessionNumber: String(record.cik ?? "FMP-fallback"),
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
  return {
    period: fiscalPeriod,
    revenue: tagged(income, ["revenue"], "Revenue"),
    ebit: tagged(income, ["operatingIncome"], "Operating income (EBIT)"),
    depreciationAmortization: tagged(cashFlow, ["depreciationAndAmortization", "depreciationAndAmortizationInIncomeStatement"], "Depreciation and amortization", 1_000_000, "$mm", true),
    stockBasedCompensation: tagged(cashFlow, ["stockBasedCompensation"], "Stock-based compensation", 1_000_000, "$mm", true),
    capitalExpenditures: tagged(cashFlow, ["capitalExpenditure", "investmentsInPropertyPlantAndEquipment"], "Capital expenditures", 1_000_000, "$mm", true),
    cashTaxes: tagged(cashFlow, ["incomeTaxesPaid"], "Cash taxes paid", 1_000_000, "$mm", true),
    incomeTaxExpense: tagged(income, ["incomeTaxExpense"], "Income tax expense", 1_000_000, "$mm", true),
    pretaxIncome: tagged(income, ["incomeBeforeTax"], "Pre-tax income"),
    interestExpense: tagged(income, ["interestExpense", "interestExpenseNonOperating"], "Interest expense", 1_000_000, "$mm", true),
    accountsReceivable: tagged(balance, ["netReceivables", "accountsReceivables"], "Accounts receivable"),
    inventory: tagged(balance, ["inventory"], "Inventory"),
    accountsPayable: tagged(balance, ["accountPayables", "accountsPayable"], "Accounts payable"),
    deferredRevenue: tagged(balance, ["deferredRevenue", "deferredRevenueCurrent"], "Deferred revenue"),
    otherCurrentAssets: tagged(balance, ["otherCurrentAssets"], "Other current assets"),
    otherCurrentLiabilities: tagged(balance, ["otherCurrentLiabilities"], "Other current liabilities"),
    cash: tagged(balance, ["cashAndCashEquivalents"], "Cash and equivalents"),
    shortTermInvestments: tagged(balance, ["shortTermInvestments"], "Short-term investments"),
    totalDebt: sum("Total debt", [currentDebt, longTermDebt]),
    financeLeaseLiabilities: tagged(balance, ["capitalLeaseObligations", "financeLeaseLiabilities"], "Finance lease liabilities"),
    operatingLeaseLiabilities: tagged(balance, ["operatingLeaseLiabilities"], "Operating lease liabilities"),
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
  const [profilePayload, annualIncomePayload, annualBalancePayload, annualCashPayload, quarterIncomePayload, quarterBalancePayload, quarterCashPayload] = await Promise.all([
    fetchFmp<unknown>("/profile", { symbol: ticker }),
    fetchFmp<unknown>("/income-statement", { symbol: ticker, period: "annual", limit: "6" }),
    fetchFmp<unknown>("/balance-sheet-statement", { symbol: ticker, period: "annual", limit: "6" }),
    fetchFmp<unknown>("/cash-flow-statement", { symbol: ticker, period: "annual", limit: "6" }),
    fetchFmp<unknown>("/income-statement", { symbol: ticker, period: "quarter", limit: "4" }),
    fetchFmp<unknown>("/balance-sheet-statement", { symbol: ticker, period: "quarter", limit: "4" }),
    fetchFmp<unknown>("/cash-flow-statement", { symbol: ticker, period: "quarter", limit: "4" }),
  ]);
  const profile = rows(profilePayload)[0];
  const annualIncome = rows(annualIncomePayload).sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const annualBalance = rows(annualBalancePayload);
  const annualCash = rows(annualCashPayload);
  if (!profile || !annualIncome.length) throw new Error(`FMP filing fallback returned no annual statements for ${ticker}.`);
  const matching = (items: RecordValue[], date: unknown) => items.find((item) => item.date === date);
  const annual = annualIncome.map((income) => buildPeriod(income, matching(annualBalance, income.date), matching(annualCash, income.date), false));
  const quarterIncome = rows(quarterIncomePayload).sort((a, b) => String(b.date).localeCompare(String(a.date)))[0];
  const latestInterim = quarterIncome
    ? buildPeriod(quarterIncome, matching(rows(quarterBalancePayload), quarterIncome.date), matching(rows(quarterCashPayload), quarterIncome.date), true)
    : null;
  const sector = String(profile.sector ?? "");
  const industry = String(profile.industry ?? "");
  const restricted = /financial|bank|insurance|reit|real estate investment trust/i.test(`${sector} ${industry}`);
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

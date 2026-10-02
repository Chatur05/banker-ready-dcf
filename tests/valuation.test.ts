import assert from "node:assert/strict";
import test from "node:test";
import ExcelJS from "exceljs";
import { PDFDocument } from "pdf-lib";
import { loadFmpFundamentals } from "../lib/data/fmp-fundamentals";
import { fetchFmp } from "../lib/data/fmp";
import { buildModelPayload, operatingForecast } from "../lib/data/model";
import { numeric } from "../lib/data/numeric";
import { buildExcelWorkbook } from "../lib/export/excel-xml";
import { buildPdf } from "../lib/export/pdf";
import type { ModelPayload, TaggedValue } from "../lib/model/types";
import { buildUnleveredFreeCashFlow, calculateDcf } from "../lib/model/valuation";

const APPLE_2025_10K = "https://www.sec.gov/Archives/edgar/data/320193/000032019325000079/aapl-20250927.htm";

const tagged = (value: number | null, label = "Test input"): TaggedValue => ({
  value,
  provenance: { origin: value === null ? "missing" : "derived", label },
});

function reviewReadyFixture(): ModelPayload {
  const annual = [2023, 2024, 2025].map((year, index) => ({
    period: { fiscalYear: year, endDate: `${year}-12-31`, filingDate: `${year + 1}-02-15`, form: "10-K", accessionNumber: `test-${year}`, label: `FY${year}`, interim: false },
    revenue: tagged(900 + index * 50, "Revenue"),
    ebit: tagged(180 + index * 10, "EBIT"),
    depreciationAmortization: tagged(30, "D&A"),
    stockBasedCompensation: tagged(10, "SBC"),
    capitalExpenditures: tagged(40, "Capex"),
    cashTaxes: tagged(35, "Cash taxes"),
    incomeTaxExpense: tagged(45, "Tax expense"),
    pretaxIncome: tagged(200, "Pre-tax income"),
    interestExpense: tagged(5, "Interest expense"),
    accountsReceivable: tagged(100, "AR"),
    inventory: tagged(50, "Inventory"),
    accountsPayable: tagged(80, "AP"),
    deferredRevenue: tagged(20, "Deferred revenue"),
    otherCurrentAssets: tagged(30, "Other current assets"),
    otherCurrentLiabilities: tagged(25, "Other current liabilities"),
    cash: tagged(100, "Cash"),
    shortTermInvestments: tagged(20, "Investments"),
    totalDebt: tagged(150, "Debt"),
    financeLeaseLiabilities: tagged(0, "Finance leases"),
    operatingLeaseLiabilities: tagged(0, "Operating leases"),
    minorityInterest: tagged(0, "NCI"),
    preferredStock: tagged(0, "Preferred"),
    equityMethodInvestments: tagged(0, "Equity investments"),
    stockholdersEquity: tagged(500, "Equity"),
    basicShares: tagged(100, "Basic shares"),
    dilutedShares: tagged(101, "Diluted shares"),
    sharesOutstanding: tagged(100, "Current shares"),
  }));
  const series = (value: number) => Array.from({ length: 5 }, () => tagged(value));
  return {
    generatedAt: "2026-08-09T00:00:00.000Z",
    identity: { ticker: "TEST", cik: "0000000001", name: "Test Company", fiscalYearEnd: "1231", sic: "3571", sicDescription: "Technology", exchange: "NASDAQ", entityType: "operating company", valuationMethodEligible: true, ineligibleReason: null },
    historicals: { annual, latestInterim: null },
    market: {
      currentPrice: tagged(null, "Current price"),
      currentShares: tagged(100, "Current shares"),
      fiftyTwoWeekLow: tagged(null),
      fiftyTwoWeekHigh: tagged(null),
      riskFreeRate: tagged(0.04),
      equityRiskPremium: tagged(0.05),
      terminalGdpGrowth: tagged(0.04),
      peerExitMultiple: tagged(null),
      releveredBeta: tagged(1),
      preTaxCostOfDebt: tagged(0.05),
      targetDebtWeight: tagged(0.20),
      targetEquityWeight: tagged(0.80),
      peerBetas: [],
      analystEstimates: [],
    },
    assumptions: {
      projectionYears: 5,
      valuationDate: "2026-08-09",
      discountingConvention: "mid-year",
      revenueGrowth: series(0.05),
      ebitMargin: series(0.20),
      depreciationAmortizationPctRevenue: series(0.03),
      stockBasedCompensationPctRevenue: series(0.01),
      capitalExpendituresPctRevenue: series(0.04),
      netWorkingCapitalPctRevenue: series(0.10),
      operatingTaxRate: series(0.25),
      terminalGrowth: tagged(0.025),
      terminalRoic: tagged(0.10),
      exitMultiple: tagged(null, "Exit multiple"),
      riskFreeRate: tagged(0.04),
      equityRiskPremium: tagged(0.05),
      releveredBeta: tagged(1),
      countryRiskPremium: tagged(0),
      sizePremium: tagged(0),
      preTaxCostOfDebt: tagged(0.05),
      debtWeight: tagged(0.20),
      equityWeight: tagged(0.80),
      preferredWeight: tagged(0),
      preferredCost: tagged(0),
      usableInterestTaxRate: tagged(0.25),
      stockCompensationAddBack: false,
    },
    bridge: {
      cash: tagged(100),
      operatingCashRequirement: tagged(0),
      shortTermInvestments: tagged(20),
      debt: tagged(150),
      financeLeaseLiabilities: tagged(0),
      operatingLeaseLiabilities: tagged(0),
      otherDebtLikeLiabilities: tagged(0),
      minorityInterest: tagged(0),
      preferredStock: tagged(0),
      equityMethodInvestments: tagged(0),
      otherNonOperatingAssets: tagged(0),
      presentValueOfNols: tagged(0),
      basicShares: tagged(100),
      options: tagged(0),
      optionStrikePrice: tagged(0),
      rsus: tagged(1),
    },
    gaps: [{ field: "Exit multiple", reason: "Review cross-check", severity: "review", affectedOutputs: ["Exit cross-check"] }],
  };
}

test("Apple FY2025 operating build ties to a hand-calculated FCFF check", () => {
  // All dollar amounts are $mm from Apple's FY2025 10-K. FY2024 balances
  // are the comparison column in the same filing; the URL is retained here
  // so this test contains sourced public data rather than a model fixture.
  const ebit = 133_050;
  const effectiveTaxRate = 20_719 / 132_729;
  const depreciationAmortization = 11_698;
  const capitalExpenditures = 12_715;
  const operatingNwc2025 = 39_777 + 5_718 + 14_585 + 33_180 - 69_860 - 9_055 - 66_387;
  const operatingNwc2024 = 33_410 + 7_286 + 14_287 + 32_833 - 68_960 - 8_249 - 78_304;
  const changeInNetWorkingCapital = operatingNwc2025 - operatingNwc2024;

  const result = buildUnleveredFreeCashFlow({
    ebit,
    taxRate: effectiveTaxRate,
    depreciationAmortization,
    capitalExpenditures,
    changeInNetWorkingCapital,
    stockBasedCompensation: 12_863,
    addBackStockCompensation: false,
  });
  const handCalculated = ebit * (1 - effectiveTaxRate)
    + depreciationAmortization - capitalExpenditures - changeInNetWorkingCapital;

  assert.equal(APPLE_2025_10K.startsWith("https://www.sec.gov/Archives/"), true);
  assert.ok(Math.abs(result.unleveredFreeCashFlow - handCalculated) < 1e-9);
  assert.ok(Math.abs(result.cashTaxes - ebit * effectiveTaxRate) < 1e-9);
  assert.ok(Math.abs(result.nopat - ebit * (1 - effectiveTaxRate)) < 1e-9);
});

test("stock compensation remains an economic cost unless explicitly added back", () => {
  const base = {
    ebit: 133_050,
    taxRate: 20_719 / 132_729,
    depreciationAmortization: 11_698,
    capitalExpenditures: 12_715,
    changeInNetWorkingCapital: 15_655,
    stockBasedCompensation: 12_863,
  };
  const defaultTreatment = buildUnleveredFreeCashFlow(base);
  const addBackTreatment = buildUnleveredFreeCashFlow({ ...base, addBackStockCompensation: true });
  assert.equal(addBackTreatment.unleveredFreeCashFlow - defaultTreatment.unleveredFreeCashFlow, 12_863);
});

test("Gordon valuation completes without an exit multiple or current market price", () => {
  const payload = reviewReadyFixture();
  const result = calculateDcf(payload);
  assert.equal(result.ready, true);
  assert.ok(result.impliedSharePriceGordon !== null && result.impliedSharePriceGordon > 0);
  assert.equal(result.impliedSharePriceExit, null);
  assert.match(result.warnings.join(" | "), /exit-multiple cross-check is unavailable/i);
  assert.match(result.warnings.join(" | "), /current market price is unavailable/i);
});

test("missing market price uses conservative option dilution without blocking intrinsic value", () => {
  const payload = reviewReadyFixture();
  payload.bridge.options = tagged(10, "Options");
  payload.bridge.optionStrikePrice = tagged(5, "Strike");
  const result = calculateDcf(payload);
  assert.equal(result.ready, true);
  assert.equal(result.fullyDilutedShares, 111);
  assert.match(result.warnings.join(" | "), /all outstanding options are included/i);
});

test("economically invalid forecast and stable-state assumptions block the calculation", () => {
  const payload = reviewReadyFixture();
  payload.assumptions.revenueGrowth[0] = tagged(-1.05, "Invalid growth");
  payload.assumptions.terminalGrowth = tagged(0.06, "Invalid terminal growth");
  payload.assumptions.terminalRoic = tagged(0.05, "Invalid terminal ROIC");
  const result = calculateDcf(payload);
  assert.equal(result.ready, false);
  assert.match(result.errors.join(" | "), /Revenue growth in forecast year 1/i);
  assert.match(result.errors.join(" | "), /Terminal ROIC must exceed terminal growth/i);
});

test("exports are genuine, review-controlled Office files and preserve the edited bridge", async () => {
  const payload = reviewReadyFixture();
  const editedBridge = structuredClone(payload.bridge);
  editedBridge.cash = tagged(777, "Edited cash");
  const result = calculateDcf(payload, payload.assumptions, editedBridge);
  const excelBytes = await buildExcelWorkbook(payload, payload.assumptions, editedBridge, result);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(excelBytes) as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  const valuation = workbook.getWorksheet("Valuation Summary");
  const assumptions = workbook.getWorksheet("Assumptions");
  assert.ok(valuation);
  assert.ok(assumptions);
  assert.equal(workbook.worksheets.length, 9);
  assert.match((valuation.getCell("B44").value as ExcelJS.CellFormulaValue).formula, /B37\/B43/);
  const cashRow = assumptions.getColumn(1).values.findIndex((value) => value === "Cash and equivalents");
  assert.ok(cashRow > 0);
  assert.equal(assumptions.getCell(cashRow, 2).value, 777);
  assert.equal(new TextDecoder().decode(excelBytes.slice(0, 2)), "PK");

  const pdfBytes = await buildPdf(payload, payload.assumptions, result);
  const pdf = await PDFDocument.load(pdfBytes);
  assert.equal(pdf.getPageCount(), 3);
  assert.equal(new TextDecoder().decode(pdfBytes.slice(0, 5)), "%PDF-");
});

test("automatic FMP fallback produces a complete review-ready valuation", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.FMP_API_KEY;
  const requestedUrls: URL[] = [];
  process.env.FMP_API_KEY = "automatic-case-test-key";
  const annualDates = ["2021-12-31", "2022-12-31", "2023-12-31", "2024-12-31", "2025-12-31"];
  const annualIncome = annualDates.map((date, index) => ({
    date,
    reportedCurrency: "USD",
    fiscalYear: 2021 + index,
    period: "FY",
    revenue: (800 + index * 50) * 1_000_000,
    operatingIncome: (160 + index * 10) * 1_000_000,
    incomeTaxExpense: (35 + index) * 1_000_000,
    incomeBeforeTax: (175 + index * 10) * 1_000_000,
    interestExpense: 5_000_000,
    weightedAverageShsOut: 100_000_000,
    weightedAverageShsOutDil: 102_000_000,
  }));
  const annualBalance = annualDates.map((date, index) => ({
    date,
    reportedCurrency: "USD",
    cashAndCashEquivalents: (80 + index * 5) * 1_000_000,
    shortTermInvestments: 20_000_000,
    shortTermDebt: 10_000_000,
    longTermDebt: 90_000_000,
    netReceivables: 100_000_000,
    inventory: 50_000_000,
    accountPayables: 80_000_000,
    deferredRevenue: 20_000_000,
    otherCurrentAssets: 30_000_000,
    otherCurrentLiabilities: 25_000_000,
    totalStockholdersEquity: 500_000_000,
    minorityInterest: 0,
    preferredStock: 0,
  }));
  const annualCash = annualDates.map((date) => ({
    date,
    reportedCurrency: "USD",
    depreciationAndAmortization: 30_000_000,
    stockBasedCompensation: 10_000_000,
    capitalExpenditure: -40_000_000,
    incomeTaxesPaid: 35_000_000,
  }));
  globalThis.fetch = (async (input) => {
    const url = new URL(String(input));
    requestedUrls.push(url);
    if (url.hostname.endsWith("sec.gov")) return new Response("Denied", { status: 403 });
    const annual = url.searchParams.get("period") === "annual";
    let payload: unknown = [];
    if (url.pathname.endsWith("/profile")) {
      payload = [{ companyName: "Automatic Case Inc.", sector: "Technology", industry: "Software", beta: 1.1 }];
    } else if (url.pathname.endsWith("/income-statement") && annual) {
      payload = annualIncome;
    } else if (url.pathname.endsWith("/balance-sheet-statement") && annual) {
      payload = annualBalance;
    } else if (url.pathname.endsWith("/cash-flow-statement") && annual) {
      payload = annualCash;
    } else if (url.pathname.endsWith("/income-statement")) {
      payload = [{ ...annualIncome.at(-1), date: "2026-03-31", fiscalYear: 2026, period: "Q1", revenue: 270_000_000, operatingIncome: 55_000_000 }];
    } else if (url.pathname.endsWith("/balance-sheet-statement")) {
      payload = [{ ...annualBalance.at(-1), date: "2026-03-31" }];
    } else if (url.pathname.endsWith("/cash-flow-statement")) {
      payload = [{ ...annualCash.at(-1), date: "2026-03-31" }];
    } else if (url.pathname.endsWith("/quote")) {
      payload = [{ price: 100, marketCap: 10_000_000_000, sharesOutstanding: 100_000_000, yearLow: 75, yearHigh: 115, timestamp: 1_786_233_600 }];
    } else if (url.pathname.endsWith("/treasury-rates")) {
      payload = [{ date: "2026-08-07", year10: 4.2 }];
    } else if (url.pathname.endsWith("/market-risk-premium")) {
      payload = [{ country: "United States", totalEquityRiskPremium: 5.0 }];
    } else if (url.pathname.endsWith("/economic-indicators")) {
      payload = [{ date: "2015-01-01", value: 18_000 }, { date: "2025-01-01", value: 30_000 }];
    } else if (url.pathname.endsWith("/stock-peers")) {
      payload = [];
    } else if (url.pathname.endsWith("/analyst-estimates")) {
      payload = [
        { date: "2026-12-31", revenueAvg: 1_080_000_000, ebitAvg: 226_800_000, numAnalystsRevenue: 12 },
        { date: "2027-12-31", revenueAvg: 1_155_600_000, ebitAvg: 242_676_000, numAnalystsRevenue: 10 },
        { date: "2028-12-31", revenueAvg: 1_224_936_000, ebitAvg: 257_236_560, numAnalystsRevenue: 8 },
      ];
    }
    return new Response(JSON.stringify(payload), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;

  try {
    const payload = await buildModelPayload("AUTO");
    const result = calculateDcf(payload);
    assert.equal(result.ready, true);
    assert.equal(result.errors.length, 0);
    assert.ok(result.impliedSharePriceGordon !== null && result.impliedSharePriceGordon > 0);
    assert.equal(payload.assumptions.revenueGrowth.slice(0, 3).every((value) => value.provenance.sourceUrl?.includes("analyst-estimates")), true);
    assert.equal(payload.assumptions.terminalGrowth.value, 0.025);
    assert.ok((payload.assumptions.preTaxCostOfDebt.value ?? 0) >= (payload.assumptions.riskFreeRate.value ?? 0) + 0.015 - 1e-10);
    assert.equal(payload.assumptions.exitMultiple.value, null);
    assert.equal(payload.bridge.operatingLeaseLiabilities.value, 0);
    assert.equal(payload.bridge.operatingCashRequirement.value, 0);
    assert.equal(payload.bridge.presentValueOfNols.value, 0);
    assert.ok((payload.bridge.rsus.value ?? 0) > 0);
    assert.ok(payload.gaps.some((gap) => gap.severity === "review"));
    assert.ok(result.terminalFreeCashFlow !== null && result.terminalFreeCashFlow > 0);
    const fmpRequests = requestedUrls.filter((url) => url.hostname === "financialmodelingprep.com");
    assert.ok(fmpRequests.length <= 17, `Expected a bounded automatic-case request count, received ${fmpRequests.length}.`);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.FMP_API_KEY;
    else process.env.FMP_API_KEY = originalKey;
  }
});

test("FMP fallback stays within the five-period statement entitlement", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.FMP_API_KEY;
  const requestedUrls: URL[] = [];
  process.env.FMP_API_KEY = "test-only-key";
  globalThis.fetch = (async (input) => {
    const url = new URL(String(input));
    requestedUrls.push(url);
    const annual = url.searchParams.get("period") === "annual";
    let payload: unknown[] = [];
    if (url.pathname.endsWith("/profile")) {
      payload = [{ companyName: "Test Company", sector: "Technology", industry: "Software" }];
    } else if (annual && url.pathname.endsWith("/income-statement")) {
      payload = [{ date: "2025-06-30", reportedCurrency: "USD", fiscalYear: 2025, period: "FY", revenue: 100_000_000, operatingIncome: 20_000_000 }];
    } else if (annual && url.pathname.endsWith("/balance-sheet-statement")) {
      payload = [{ date: "2025-06-30", reportedCurrency: "USD", shortTermDebt: 0, longTermDebt: 0, cashAndCashEquivalents: 10_000_000, totalStockholdersEquity: 50_000_000 }];
    } else if (annual && url.pathname.endsWith("/cash-flow-statement")) {
      payload = [{ date: "2025-06-30", reportedCurrency: "USD", depreciationAndAmortization: 5_000_000, capitalExpenditure: -4_000_000 }];
    }
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  try {
    await loadFmpFundamentals("TEST");
    const annualStatementRequests = requestedUrls.filter((url) =>
      url.searchParams.get("period") === "annual");
    assert.equal(annualStatementRequests.length, 3);
    assert.equal(annualStatementRequests.every((url) => url.searchParams.get("limit") === "5"), true);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.FMP_API_KEY;
    else process.env.FMP_API_KEY = originalKey;
  }
});

test("an endpoint entitlement restriction does not poison later FMP requests", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.FMP_API_KEY;
  const requestedPaths: string[] = [];
  process.env.FMP_API_KEY = "entitlement-isolation-test-key";
  globalThis.fetch = (async (input) => {
    const url = new URL(String(input));
    requestedPaths.push(url.pathname);
    if (url.pathname.endsWith("/restricted-entitlement-test")) {
      return new Response(JSON.stringify({
        "Error Message": "Premium Query Parameter: This value set for 'symbol' is not available under your current subscription.",
      }), { status: 402, headers: { "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify([{ symbol: "AFTER", companyName: "Available Endpoint Inc." }]), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  try {
    await assert.rejects(
      fetchFmp("/restricted-entitlement-test", { symbol: "ENTITLEMENT" }),
      /endpoint\/ticker combination.*not an exhausted daily request allowance/i,
    );
    const available = await fetchFmp<Array<{ symbol: string }>>("/profile", { symbol: "AFTER-ENTITLEMENT" });
    assert.equal(available[0]?.symbol, "AFTER");
    assert.deepEqual(requestedPaths, [
      "/stable/restricted-entitlement-test",
      "/stable/profile",
    ]);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.FMP_API_KEY;
    else process.env.FMP_API_KEY = originalKey;
  }
});

test("a genuine rate-limit circuit is short-lived and isolated to the exact request", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.FMP_API_KEY;
  const requestCounts = new Map<string, number>();
  process.env.FMP_API_KEY = "rate-limit-isolation-test-key";
  globalThis.fetch = (async (input) => {
    const url = new URL(String(input));
    const symbol = url.searchParams.get("symbol") ?? "";
    requestCounts.set(symbol, (requestCounts.get(symbol) ?? 0) + 1);
    if (symbol === "RATE-LIMITED") {
      return new Response(JSON.stringify({
        "Error Message": "Too many requests (rate limit exceeded)",
      }), { status: 429, headers: { "Content-Type": "application/json", "Retry-After": "0" } });
    }
    return new Response(JSON.stringify([{ symbol, companyName: "Available Endpoint Inc." }]), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  try {
    await assert.rejects(
      fetchFmp("/profile", { symbol: "RATE-LIMITED" }),
      /rate limit exceeded/i,
    );
    assert.equal(requestCounts.get("RATE-LIMITED"), 3);
    await assert.rejects(
      fetchFmp("/profile", { symbol: "RATE-LIMITED" }),
      /rate-limited this exact request/i,
    );
    assert.equal(requestCounts.get("RATE-LIMITED"), 3, "The identical request should be cooled down without another provider call.");

    const available = await fetchFmp<Array<{ symbol: string }>>("/profile", { symbol: "AFTER-RATE-LIMIT" });
    assert.equal(available[0]?.symbol, "AFTER-RATE-LIMIT");
    assert.equal(requestCounts.get("AFTER-RATE-LIMIT"), 1, "A different ticker must still be allowed to probe FMP.");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.FMP_API_KEY;
    else process.env.FMP_API_KEY = originalKey;
  }
});

test("provider nulls, blank strings and booleans never become reported zeros", () => {
  for (const value of [null, undefined, "", "  ", false, true, [], {}, "NaN", Infinity]) assert.equal(numeric({ value }, ["value"]), null);
  assert.equal(numeric({ value: 0 }, ["value"]), 0);
  assert.equal(numeric({ value: "0" }, ["value"]), 0);
  assert.equal(numeric({ a: null, b: 7 }, ["a", "b"]), 7);
});

test("consensus matches fiscal dates, accepts high growth and never shifts a missing year", () => {
  const latest = reviewReadyFixture().historicals.annual.at(-1)!;
  latest.revenue = tagged(100);
  const estimates = [
    { fiscalDate: "2026-12-31", revenue: 190, ebit: 57, revenueAnalystCount: 10, sourceUrl: "https://example.com/2026" },
    { fiscalDate: "2028-12-31", revenue: 260, ebit: 78, revenueAnalystCount: 10, sourceUrl: "https://example.com/2028" },
  ];
  const forecast = operatingForecast(latest, estimates, 5, 0.15, 0.20, 0.025);
  assert.ok(Math.abs(forecast.revenueGrowth[0].value! - 0.90) < 1e-12);
  assert.notEqual(forecast.revenueGrowth[1].provenance.sourceUrl?.includes("2028"), true);
  assert.equal(forecast.revenueGrowth[2].provenance.asOf, "2028-12-31");
  const yearThreeRevenue = forecast.revenueGrowth.slice(0, 3).reduce((revenue, growth) => revenue * (1 + growth.value!), 100);
  assert.ok(Math.abs(yearThreeRevenue - 260) < 1e-9);
  const rejected = operatingForecast(latest, [{ ...estimates[0], revenue: 500 }], 5, 0.15, 0.20, 0.025);
  assert.ok(rejected.revenueGrowth.every((item) => item.value! <= 0.15 && item.value! >= 0.03));
});

test("estimated elapsed-year base rolls revenue forward without relabeling last year's growth", () => {
  const payload = reviewReadyFixture();
  payload.projectionBase = { endDate: "2026-12-31", revenue: tagged(2000), netWorkingCapital: tagged(200) };
  payload.assumptions.valuationDate = "2027-01-05";
  const result = calculateDcf(payload);
  assert.equal(result.ready, true);
  assert.equal(result.projections[0].endDate, "2027-12-31");
  assert.equal(result.projections[0].revenue, 2100);
  assert.equal(result.projections[0].changeInNetWorkingCapital, 10);
  assert.match(result.warnings.join(" "), /estimated, not reported/);
});

test("invalid cases suppress all headline values, not only the ready flag", async () => {
  for (const mutation of [
    (p: ModelPayload) => { p.identity.valuationMethodEligible = false; },
    (p: ModelPayload) => { p.bridge.debt = tagged(null); },
    (p: ModelPayload) => { p.bridge.debt = tagged(-1); },
    (p: ModelPayload) => { p.assumptions.ebitMargin = p.assumptions.ebitMargin.map(() => tagged(-0.2)); },
    (p: ModelPayload) => { p.assumptions.projectionYears = 5.5; },
    (p: ModelPayload) => { p.assumptions.projectionYears = Infinity; },
    (p: ModelPayload) => { p.assumptions.valuationDate = "2026-02-30"; },
    (p: ModelPayload) => { p.assumptions.valuationDate = "2027-08-09"; },
    (p: ModelPayload) => { p.bridge.basicShares = tagged(0); },
    (p: ModelPayload) => { p.assumptions.terminalGrowth = tagged(0.2); },
  ]) {
    const payload = reviewReadyFixture(); mutation(payload);
    const result = calculateDcf(payload);
    assert.equal(result.ready, false);
    for (const key of ["impliedSharePriceGordon", "impliedSharePriceExit", "enterpriseValueGordon", "commonEquityValueGordon", "upsideDownsideGordon"] as const) assert.equal(result[key], null, key);
    await assert.rejects(buildExcelWorkbook(payload, payload.assumptions, payload.bridge, result), /Export blocked/);
    await assert.rejects(buildPdf(payload, payload.assumptions, result), /Export blocked/);
  }
});

test("negative terminal cash flow cannot be rescued by an abrupt perpetuity assumption", () => {
  const payload = reviewReadyFixture();
  payload.assumptions.capitalExpendituresPctRevenue = payload.assumptions.capitalExpendituresPctRevenue.map(() => tagged(0.5));
  const result = calculateDcf(payload);
  assert.equal(result.ready, false);
  assert.match(result.errors.join(" "), /positive NOPAT and free cash flow/);
  assert.equal(result.impliedSharePriceGordon, null);
});

test("workbook residual weights, sensitivity axes, ROIC and opening base stay formula linked", async () => {
  const payload = reviewReadyFixture();
  payload.projectionBase = { endDate: "2026-12-31", revenue: tagged(2000), netWorkingCapital: tagged(200) };
  payload.assumptions.valuationDate = "2027-01-05";
  const result = calculateDcf(payload);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(await buildExcelWorkbook(payload, payload.assumptions, payload.bridge, result)) as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  const input = workbook.getWorksheet("Assumptions")!;
  const equityRow = input.getColumn(1).values.findIndex((value) => value === "Equity weight");
  assert.match((input.getCell(equityRow, 2).value as ExcelJS.CellFormulaValue).formula, /^1-B\d+-B\d+$/);
  assert.match((workbook.getWorksheet("Sensitivities")!.getCell("D7").value as ExcelJS.CellFormulaValue).formula, /'Valuation Summary'!\$B\$6/);
  assert.match((workbook.getWorksheet("Sensitivities")!.getCell("D4").value as ExcelJS.CellFormulaValue).formula, /\$B\$10/);
  assert.equal(workbook.getWorksheet("Historicals")!.getCell("B25").value, 2000);
  assert.match((workbook.getWorksheet("Projection Model")!.getCell("B6").value as ExcelJS.CellFormulaValue).formula, /\$B\$25/);
  assert.match((workbook.getWorksheet("Checks")!.getCell("E7").value as ExcelJS.CellFormulaValue).formula, /IF/);
});

test("large PDF review queues paginate rather than truncating or running below the page", async () => {
  const payload = reviewReadyFixture();
  payload.gaps = Array.from({ length: 60 }, (_, index) => ({ field: `Review ${index + 1}`, reason: "An assumption requiring a complete explanation. ".repeat(8), severity: "review", affectedOutputs: ["DCF", "Per-share value"] }));
  const result = calculateDcf(payload);
  const pdf = await PDFDocument.load(await buildPdf(payload, payload.assumptions, result));
  assert.ok(pdf.getPageCount() > 8);
});

test("FMP HTTP-200 errors are not cached as financial data and key rotation isolates cache", async () => {
  const originalFetch = globalThis.fetch; const originalKey = process.env.FMP_API_KEY;
  let calls = 0;
  process.env.FMP_API_KEY = "cache-scope-one";
  globalThis.fetch = async () => {
    calls++;
    return new Response(JSON.stringify(calls === 1 ? { "Error Message": "Invalid API key" } : [{ calls }]));
  };
  try {
    await assert.rejects(fetchFmp("/audit-errors", { symbol: "TEST" }), /error payload/);
    assert.equal((await fetchFmp<Array<{ calls: number }>>("/audit-errors", { symbol: "TEST" }))[0].calls, 2);
    await fetchFmp("/audit-errors", { symbol: "TEST" }); assert.equal(calls, 2);
    process.env.FMP_API_KEY = "cache-scope-two";
    await fetchFmp("/audit-errors", { symbol: "TEST" }); assert.equal(calls, 3);
  } finally { globalThis.fetch = originalFetch; if (originalKey === undefined) delete process.env.FMP_API_KEY; else process.env.FMP_API_KEY = originalKey; }
});

test("long provider Retry-After is respected without repeated requests", async () => {
  const originalFetch = globalThis.fetch; const originalKey = process.env.FMP_API_KEY;
  let calls = 0; process.env.FMP_API_KEY = "long-backoff-test";
  globalThis.fetch = async () => { calls++; return new Response("Too many requests", { status: 429, headers: { "Retry-After": "120" } }); };
  try {
    await assert.rejects(fetchFmp("/audit-backoff"), /429/);
    await assert.rejects(fetchFmp("/audit-backoff"), /retry in 1\d\d seconds/);
    assert.equal(calls, 1);
  } finally { globalThis.fetch = originalFetch; if (originalKey === undefined) delete process.env.FMP_API_KEY; else process.env.FMP_API_KEY = originalKey; }
});

test("source normalization retains tax benefits, all current accruals, dates and complete debt", async () => {
  const originalFetch = globalThis.fetch; const originalKey = process.env.FMP_API_KEY;
  const profile = [{ companyName: "Source Test", sector: "Technology", currency: "USD" }];
  const income = { date: "2025-12-31", filingDate: "2026-02-01", reportedCurrency: "USD", period: "FY", revenue: 1e9, operatingIncome: 2e8, incomeTaxExpense: -1e7 };
  const balance = { ...income, totalCurrentLiabilities: 3e8, accountPayables: 1e8, deferredRevenue: 2e7, shortTermDebt: 3e7, longTermDebt: 4e7, capitalLeaseObligationsCurrent: 5e6, otherCurrentLiabilities: 4e7, cashAndCashEquivalents: 1e8 };
  const cash = { ...income, depreciationAndAmortization: 3e7, capitalExpenditure: -4e7 };
  const records = { income, balance, cash };
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    const payload = url.pathname.endsWith("/profile") ? profile : url.searchParams.get("period") === "quarter" ? []
      : url.pathname.endsWith("/income-statement") ? [records.income, records.income]
        : url.pathname.endsWith("/balance-sheet-statement") ? [records.balance] : [records.cash];
    return new Response(JSON.stringify(payload));
  };
  try {
    process.env.FMP_API_KEY = "normalization-valid";
    const bundle = await loadFmpFundamentals("SOURCE");
    assert.equal(bundle.historicals.annual.length, 1);
    const period = bundle.historicals.annual[0];
    assert.equal(period.incomeTaxExpense.value, -10);
    assert.equal(period.totalDebt.value, 70);
    assert.equal(period.otherCurrentLiabilities.value, 145);
    assert.equal(period.period.filingDate, "2026-02-01");
    assert.equal(period.period.accessionNumber, "");
    assert.match(period.revenue.provenance.sourceUrl!, /symbol=SOURCE/);
    process.env.FMP_API_KEY = "normalization-missing-debt";
    Object.assign(records.balance, { longTermDebt: null });
    await assert.rejects(loadFmpFundamentals("SOURCE"), /Missing required totalDebt/);
    Object.assign(records.balance, { longTermDebt: 4e7 });
    process.env.FMP_API_KEY = "normalization-currency";
    records.cash.reportedCurrency = "EUR";
    await assert.rejects(loadFmpFundamentals("SOURCE"), /Statement currency.*EUR/);
    records.cash.reportedCurrency = "USD";
    process.env.FMP_API_KEY = "normalization-missing-capex";
    Object.assign(records.cash, { capitalExpenditure: null });
    await assert.rejects(loadFmpFundamentals("SOURCE"), /Missing required capitalExpenditures/);
  } finally { globalThis.fetch = originalFetch; if (originalKey === undefined) delete process.env.FMP_API_KEY; else process.env.FMP_API_KEY = originalKey; }
});

test("unsupported financial and captive-finance issuers stop before statement requests", async () => {
  const originalFetch = globalThis.fetch; const originalKey = process.env.FMP_API_KEY;
  const requests: string[] = [];
  globalThis.fetch = async (input) => {
    const url = new URL(String(input)); requests.push(url.pathname);
    const symbol = url.searchParams.get("symbol");
    return new Response(JSON.stringify([{ sector: symbol === "JPM" ? "Financial Services" : "Consumer Cyclical", industry: symbol === "O" ? "REIT" : "Auto Manufacturers", currency: "USD" }]));
  };
  try {
    process.env.FMP_API_KEY = "sector-restrictions-test";
    for (const ticker of ["F", "GM", "JPM", "O"]) await assert.rejects(loadFmpFundamentals(ticker), /Unsupported/);
    assert.equal(requests.length, 4);
    assert.ok(requests.every((path) => path.endsWith("/profile")));
  } finally { globalThis.fetch = originalFetch; if (originalKey === undefined) delete process.env.FMP_API_KEY; else process.env.FMP_API_KEY = originalKey; }
});

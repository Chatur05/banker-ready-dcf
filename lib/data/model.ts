import { median } from "../model/math";
import type {
  DataGap,
  EquityBridge,
  ModelPayload,
  PeriodFinancials,
  ProjectionAssumptions,
  TaggedValue,
} from "../model/types";
import { loadFmpMarketInputs, marketInputsUnavailable } from "./fmp";
import { loadFmpFundamentals } from "./fmp-fundamentals";
import { loadSecBundle } from "./sec";

function derived(
  value: number | null,
  label: string,
  units: string,
  notes: string,
  source?: TaggedValue,
): TaggedValue {
  return {
    value,
    provenance: value === null
      ? { origin: "missing", label, units, notes }
      : {
          origin: "derived",
          label,
          units,
          notes,
          sourceUrl: source?.provenance.sourceUrl,
          asOf: source?.provenance.asOf,
          filingDate: source?.provenance.filingDate,
        },
  };
}

function assumed(value: number, label: string, units: string, notes: string): TaggedValue {
  return { value, provenance: { origin: "assumed", label, units, notes } };
}

function missing(label: string, units: string, notes: string): TaggedValue {
  return { value: null, provenance: { origin: "missing", label, units, notes } };
}

function safeRatio(numerator: number | null, denominator: number | null): number | null {
  return numerator !== null && denominator !== null && denominator !== 0
    ? numerator / denominator
    : null;
}

function netWorkingCapital(period: PeriodFinancials): number | null {
  const values = [
    period.accountsReceivable.value,
    period.inventory.value,
    period.otherCurrentAssets.value,
    period.accountsPayable.value,
    period.deferredRevenue.value,
    period.otherCurrentLiabilities.value,
  ];
  if (values.some((value) => value === null)) return null;
  return values[0]! + values[1]! + values[2]! - values[3]! - values[4]! - values[5]!;
}

function repeated(value: TaggedValue, count: number): TaggedValue[] {
  return Array.from({ length: count }, () => ({
    value: value.value,
    provenance: { ...value.provenance },
  }));
}

function latestDebtCost(annual: PeriodFinancials[]): TaggedValue {
  const rates: number[] = [];
  for (let index = 1; index < annual.length; index += 1) {
    const interest = annual[index].interestExpense.value;
    const beginningDebt = annual[index - 1].totalDebt.value;
    const endingDebt = annual[index].totalDebt.value;
    if (interest === null || beginningDebt === null || endingDebt === null) continue;
    const averageDebt = (beginningDebt + endingDebt) / 2;
    if (averageDebt > 0) rates.push(Math.abs(interest) / averageDebt);
  }
  return derived(
    median(rates),
    "Blended historical interest rate",
    "%",
    "Median interest expense divided by average total debt. Editable because a current traded yield or credit-spread build is preferable when available.",
    annual.at(-1)?.interestExpense,
  );
}

function terminalRoic(annual: PeriodFinancials[], taxRate: number | null): TaggedValue {
  const roics: number[] = [];
  if (taxRate !== null) {
    for (const period of annual.slice(-3)) {
      const ebit = period.ebit.value;
      const debt = period.totalDebt.value;
      const equity = period.stockholdersEquity.value;
      const cash = period.cash.value;
      if ([ebit, debt, equity, cash].some((value) => value === null)) continue;
      const investedCapital = debt! + equity! - cash!;
      if (investedCapital > 0) roics.push((ebit! * (1 - taxRate)) / investedCapital);
    }
  }
  return derived(
    median(roics),
    "Terminal ROIC",
    "%",
    "Seeded from the median of the latest available NOPAT / invested-capital observations; edit to a defensible mature-state return.",
    annual.at(-1)?.stockholdersEquity,
  );
}

function addGap(gaps: DataGap[], field: string, value: TaggedValue, affectedOutputs: string[]): void {
  if (value.value !== null) return;
  gaps.push({
    field,
    reason: value.provenance.notes ?? `${field} is unavailable from the selected source.`,
    severity: "blocking",
    affectedOutputs,
  });
}

export async function buildModelPayload(ticker: string): Promise<ModelPayload> {
  let filingFallbackReason: string | null = null;
  let sec;
  try {
    sec = await loadSecBundle(ticker);
  } catch (secError) {
    filingFallbackReason = secError instanceof Error ? secError.message : "SEC filing retrieval failed.";
    try {
      sec = await loadFmpFundamentals(ticker);
    } catch (fmpError) {
      const fallbackMessage = fmpError instanceof Error ? fmpError.message : "FMP filing retrieval failed.";
      throw new Error(
        `Unable to retrieve verified filings. Primary SEC source: ${filingFallbackReason} FMP filing fallback: ${fallbackMessage}`,
      );
    }
  }
  const annual = sec.historicals.annual;
  const revenueGrowth = annual.slice(1).map((period, index) =>
    safeRatio(period.revenue.value, annual[index].revenue.value) === null
      ? null
      : period.revenue.value! / annual[index].revenue.value! - 1);
  const ebitMargins = annual.map((period) => safeRatio(period.ebit.value, period.revenue.value));
  const daPercent = annual.map((period) => safeRatio(period.depreciationAmortization.value, period.revenue.value));
  const sbcPercent = annual.map((period) => safeRatio(period.stockBasedCompensation.value, period.revenue.value));
  const capexPercent = annual.map((period) => safeRatio(period.capitalExpenditures.value, period.revenue.value));
  const nwcPercent = annual.map((period) => safeRatio(netWorkingCapital(period), period.revenue.value));
  const effectiveTaxRates = annual.map((period) => {
    const rate = safeRatio(period.incomeTaxExpense.value, period.pretaxIncome.value);
    return rate !== null && rate >= 0 && rate <= 1 ? rate : null;
  });
  const taxRateMedian = median(effectiveTaxRates);
  let market;
  try {
    market = await loadFmpMarketInputs(sec.identity.ticker, taxRateMedian);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Market-data request failed.";
    market = marketInputsUnavailable(`Market inputs could not be verified: ${reason}`);
  }
  const projectionYears = 5;
  const growthSeed = derived(median(revenueGrowth), "Revenue growth", "%", "Historical median of available annual growth rates.", annual.at(-1)?.revenue);
  const marginSeed = derived(median(ebitMargins.slice(-5)), "EBIT margin", "%", "Historical median of the latest five annual margins.", annual.at(-1)?.ebit);
  const daSeed = derived(median(daPercent.slice(-5)), "D&A / revenue", "%", "Historical median of the latest five annual observations.", annual.at(-1)?.depreciationAmortization);
  const sbcSeed = derived(median(sbcPercent.slice(-5)), "SBC / revenue", "%", "Historical median; SBC remains an economic cost unless the user enables the add-back toggle.", annual.at(-1)?.stockBasedCompensation);
  const capexSeed = derived(median(capexPercent.slice(-5)), "Capex / revenue", "%", "Historical median of the latest five annual observations.", annual.at(-1)?.capitalExpenditures);
  const nwcSeed = derived(median(nwcPercent.slice(-5)), "Operating NWC / revenue", "%", "Historical median using AR + inventory + other current assets - AP - deferred revenue - other current liabilities.", annual.at(-1)?.accountsReceivable);
  const taxSeed = derived(taxRateMedian, "Operating tax rate", "%", "Median normalized effective tax rate from filings; financing tax effects are excluded from FCFF.", annual.at(-1)?.incomeTaxExpense);
  const historicalDebtCost = latestDebtCost(annual);
  market.preTaxCostOfDebt = historicalDebtCost;
  const roicSeed = terminalRoic(annual, taxRateMedian);

  const terminalGrowth = market.terminalGdpGrowth.value === null
    ? missing("Terminal growth", "%", "A sourced nominal GDP benchmark is required, or enter a labeled assumption.")
    : derived(
        market.terminalGdpGrowth.value,
        "Terminal growth",
        "%",
        "Seeded to the sourced 10-year nominal GDP CAGR. Review and edit for company maturity and currency consistency.",
        market.terminalGdpGrowth,
      );
  const exitMultiple = market.peerExitMultiple.value === null
    ? missing("Exit EV/EBITDA", "x", "Peer market data is required, or enter a labeled assumption.")
    : derived(market.peerExitMultiple.value, "Exit EV/EBITDA", "x", "Peer-median cross-check, not the primary intrinsic terminal method.", market.peerExitMultiple);
  const preferredBalance = annual.at(-1)?.preferredStock
    ?? missing("Preferred stock", "$mm", "No annual period.");
  const preferredWeight = preferredBalance.value === 0
    ? derived(0, "Preferred weight", "%", "No preferred balance is included in the bridge.", preferredBalance)
    : missing("Preferred weight", "%", "Market value and required return are needed for material preferred stock.");
  const preferredCost = preferredWeight.value === 0
    ? derived(0, "Preferred cost", "%", "Not applicable because preferred weight is zero.", preferredBalance)
    : missing("Preferred cost", "%", "Current required preferred return is required.");

  const assumptions: ProjectionAssumptions = {
    projectionYears,
    valuationDate: new Date().toISOString().slice(0, 10),
    discountingConvention: "mid-year",
    revenueGrowth: repeated(growthSeed, projectionYears),
    ebitMargin: repeated(marginSeed, projectionYears),
    depreciationAmortizationPctRevenue: repeated(daSeed, projectionYears),
    stockBasedCompensationPctRevenue: repeated(sbcSeed, projectionYears),
    capitalExpendituresPctRevenue: repeated(capexSeed, projectionYears),
    netWorkingCapitalPctRevenue: repeated(nwcSeed, projectionYears),
    operatingTaxRate: repeated(taxSeed, projectionYears),
    terminalGrowth,
    terminalRoic: roicSeed,
    exitMultiple,
    riskFreeRate: market.riskFreeRate,
    equityRiskPremium: market.equityRiskPremium,
    releveredBeta: market.releveredBeta,
    countryRiskPremium: assumed(0, "Country risk premium", "%", "Explicit zero assumption for a U.S.-dollar model; edit if operating cash-flow exposure justifies a country premium."),
    sizePremium: assumed(0, "Size premium", "%", "Explicit zero assumption. Add only with a sourced methodology and market-capitalization bucket."),
    preTaxCostOfDebt: historicalDebtCost,
    debtWeight: market.targetDebtWeight,
    equityWeight: market.targetEquityWeight,
    preferredWeight,
    preferredCost,
    usableInterestTaxRate: taxSeed,
    stockCompensationAddBack: false,
  };

  const latest = annual.at(-1);
  const nolValue: TaggedValue = {
    value: null,
    provenance: {
      origin: "missing",
      label: "Present value of usable NOLs",
      units: "$mm",
      sourceUrl: sec.latestNolBalance.provenance.sourceUrl,
      asOf: sec.latestNolBalance.provenance.asOf,
      notes: sec.latestNolBalance.value === null
        ? "Enter zero only after reviewing the tax footnote, or build a jurisdiction- and vintage-specific NOL schedule before adding value."
        : `A reported tax-asset balance of ${sec.latestNolBalance.value.toFixed(1)} was located, but the bridge requires a jurisdiction-, expiry-, and utilization-adjusted present value. Build that schedule or enter a reviewed zero.`,
    },
  };
  const options = sec.latestOptions;
  const optionStrike = options.value === 0
    ? assumed(0, "Weighted-average option strike", "$ / share", "Not applicable when option balance is zero.")
    : sec.latestOptionStrike;
  const bridge: EquityBridge = {
    cash: latest?.cash ?? missing("Cash", "$mm", "Latest annual filing period unavailable."),
    shortTermInvestments: latest?.shortTermInvestments ?? missing("Short-term investments", "$mm", "Latest annual period unavailable."),
    debt: latest?.totalDebt ?? missing("Total debt", "$mm", "Latest annual period unavailable."),
    financeLeaseLiabilities: latest?.financeLeaseLiabilities ?? missing("Finance leases", "$mm", "Latest annual period unavailable."),
    operatingLeaseLiabilities: latest?.operatingLeaseLiabilities ?? missing("Operating leases", "$mm", "Latest annual period unavailable."),
    minorityInterest: latest?.minorityInterest ?? missing("Minority interest", "$mm", "Latest annual period unavailable."),
    preferredStock: preferredBalance,
    equityMethodInvestments: latest?.equityMethodInvestments ?? missing("Equity-method investments", "$mm", "Latest annual period unavailable."),
    presentValueOfNols: nolValue,
    basicShares: latest?.sharesOutstanding.value !== null
      ? latest!.sharesOutstanding
      : latest?.basicShares ?? missing("Basic shares", "mm shares", "Latest annual shares unavailable."),
    options,
    optionStrikePrice: optionStrike,
    rsus: sec.latestRsus,
  };

  const gaps: DataGap[] = [];
  if (filingFallbackReason) {
    gaps.push({
      field: "Primary SEC Company Facts source",
      reason: `${filingFallbackReason} Standardized FMP filing data was used as a fallback; reconcile material values to the linked SEC filing before relying on the output.`,
      severity: "warning",
      affectedOutputs: ["Source audit", "Historical financials"],
    });
  }
  if (annual.length < 5) {
    gaps.push({
      field: "Five-year filing history",
      reason: `Only ${annual.length} complete annual periods were resolved from SEC Company Facts.`,
      severity: "blocking",
      affectedOutputs: ["Projection defaults", "DCF"],
    });
  }
  if (!sec.historicals.latestInterim) {
    gaps.push({
      field: "Latest interim period",
      reason: "No latest 10-Q revenue context was resolved.",
      severity: "warning",
      affectedOutputs: ["Latest interim display"],
    });
  }
  const requiredAssumptions: Array<[string, TaggedValue]> = [
    ["Current market price", market.currentPrice],
    ["Risk-free rate", assumptions.riskFreeRate],
    ["Equity risk premium", assumptions.equityRiskPremium],
    ["Bottom-up beta", assumptions.releveredBeta],
    ["Pre-tax cost of debt", assumptions.preTaxCostOfDebt],
    ["Debt weight", assumptions.debtWeight],
    ["Equity weight", assumptions.equityWeight],
    ["Terminal growth", assumptions.terminalGrowth],
    ["Terminal ROIC", assumptions.terminalRoic],
    ["Exit multiple", assumptions.exitMultiple],
  ];
  for (const [field, value] of requiredAssumptions) addGap(gaps, field, value, ["WACC", "DCF", "Per-share value"]);
  const requiredBridge: Array<[string, TaggedValue]> = [
    ["Cash", bridge.cash],
    ["Short-term investments", bridge.shortTermInvestments],
    ["Total debt", bridge.debt],
    ["Finance lease liabilities", bridge.financeLeaseLiabilities],
    ["Operating lease liabilities", bridge.operatingLeaseLiabilities],
    ["Minority interest", bridge.minorityInterest],
    ["Preferred stock", bridge.preferredStock],
    ["Equity-method investments", bridge.equityMethodInvestments],
    ["Present value of usable NOLs", bridge.presentValueOfNols],
    ["Basic shares", bridge.basicShares],
    ["Options", bridge.options],
    ["Option strike price", bridge.optionStrikePrice],
    ["RSUs", bridge.rsus],
  ];
  for (const [field, value] of requiredBridge) addGap(gaps, field, value, ["Equity bridge", "Per-share value"]);
  for (const [field, value] of [
    ["Revenue growth", growthSeed],
    ["EBIT margin", marginSeed],
    ["D&A / revenue", daSeed],
    ["SBC / revenue", sbcSeed],
    ["Capex / revenue", capexSeed],
    ["NWC / revenue", nwcSeed],
    ["Tax rate", taxSeed],
  ] as Array<[string, TaggedValue]>) addGap(gaps, field, value, ["Projection model", "DCF"]);

  return {
    generatedAt: new Date().toISOString(),
    identity: sec.identity,
    historicals: sec.historicals,
    market,
    assumptions,
    bridge,
    gaps,
  };
}

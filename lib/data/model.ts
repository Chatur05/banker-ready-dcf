import { addFiscalYears, median } from "../model/math";
import type {
  AnalystEstimate,
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

function reviewDefault(
  source: TaggedValue | undefined,
  fallback: number,
  label: string,
  units: string,
  notes: string,
): TaggedValue {
  if (source?.value !== null && source?.value !== undefined && Number.isFinite(source.value)) return source;
  return assumed(fallback, label, units, `Review default: ${notes}`);
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

function interpolate(start: number, end: number, progress: number): number {
  return start + (end - start) * progress;
}

export function operatingForecast(
  latest: PeriodFinancials | undefined,
  estimates: AnalystEstimate[],
  projectionYears: number,
  historicalGrowth: number,
  historicalMargin: number,
  terminalGrowth: number,
): { revenueGrowth: TaggedValue[]; ebitMargin: TaggedValue[] } {
  const latestRevenue = latest?.revenue.value;
  const latestEnd = latest?.period.endDate ?? "";
  const consensus = estimates.filter((estimate) => estimate.revenue > 0 && estimate.fiscalDate > latestEnd
    && estimate.revenueAnalystCount !== null && estimate.revenueAnalystCount >= 3);
  const revenueGrowth: TaggedValue[] = [];
  const ebitMargin: TaggedValue[] = [];
  let priorRevenue = latestRevenue;
  let lastGrowth = clamp(historicalGrowth, -0.15, 0.25);
  let lastMargin = clamp(historicalMargin, -0.25, 0.60);

  for (let index = 0; index < projectionYears; index += 1) {
    const expectedEnd = addFiscalYears(latestEnd, index + 1);
    const estimate = index < 3 ? consensus.find((item) => Math.abs(Date.parse(item.fiscalDate) - Date.parse(expectedEnd)) <= 14 * 86_400_000) : undefined;
    const consensusGrowth = estimate && priorRevenue && priorRevenue > 0
      ? estimate.revenue / priorRevenue - 1
      : null;
    const consensusMargin = estimate?.ebit !== null && estimate?.ebit !== undefined
      ? estimate.ebit / estimate.revenue
      : null;
    if (estimate && consensusGrowth !== null && consensusGrowth >= -0.95 && consensusGrowth <= 1) {
      lastGrowth = consensusGrowth;
      revenueGrowth.push({
        value: consensusGrowth,
        provenance: {
          origin: "derived",
          label: "Revenue growth",
          units: "%",
          sourceUrl: estimate.sourceUrl,
          asOf: estimate.fiscalDate,
          notes: `Derived from FMP analyst-consensus revenue for ${estimate.fiscalDate}; ${estimate.revenueAnalystCount ?? "unreported"} contributing analysts.`,
        },
      });
    } else {
      const remaining = Math.max(1, projectionYears - index);
      const progress = 1 / remaining;
      lastGrowth = interpolate(lastGrowth, terminalGrowth + 0.005, progress);
      revenueGrowth.push(derived(
        lastGrowth,
        "Revenue growth",
        "%",
        consensus.length
          ? "Consensus growth fades toward a mature rate 50 bps above terminal growth."
          : "Historical median growth fades toward a mature rate 50 bps above terminal growth.",
        latest?.revenue,
      ));
    }
    if (priorRevenue !== null && priorRevenue !== undefined) priorRevenue *= 1 + lastGrowth;

    if (estimate && consensusMargin !== null && consensusMargin >= -0.30 && consensusMargin <= 0.70) {
      lastMargin = consensusMargin;
      ebitMargin.push({
        value: consensusMargin,
        provenance: {
          origin: "derived",
          label: "EBIT margin",
          units: "%",
          sourceUrl: estimate.sourceUrl,
          asOf: estimate.fiscalDate,
          notes: `Derived from FMP analyst-consensus EBIT and revenue for ${estimate.fiscalDate}.`,
        },
      });
    } else {
      const remaining = Math.max(1, projectionYears - index);
      const progress = 1 / remaining;
      lastMargin = interpolate(lastMargin, clamp(historicalMargin, -0.95, 0.60), progress);
      ebitMargin.push(derived(
        lastMargin,
        "EBIT margin",
        "%",
        consensus.length
          ? "Consensus EBIT margin fades toward the normalized historical median."
          : "Normalized historical median EBIT margin held as the base case.",
        latest?.ebit,
      ));
    }
  }
  return { revenueGrowth, ebitMargin };
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

function addReviewGap(gaps: DataGap[], field: string, value: TaggedValue, affectedOutputs: string[]): void {
  if (value.provenance.origin !== "assumed") return;
  gaps.push({
    field,
    reason: value.provenance.notes ?? `${field} uses an editable review default.`,
    severity: "review",
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
      if (fallbackMessage.startsWith("Unsupported")) throw new Error(fallbackMessage);
      throw new Error(
        `Unable to retrieve required financial statements. Primary SEC source: ${filingFallbackReason} FMP fallback: ${fallbackMessage}`,
      );
    }
  }
  const annual = sec.historicals.annual;
  const latest = annual.at(-1);
  if (["F", "GM"].includes(sec.identity.ticker.toUpperCase())) {
    sec.identity.valuationMethodEligible = false;
    sec.identity.ineligibleReason = "A material captive-finance subsidiary requires a separate industrial/financial sum-of-the-parts valuation.";
  }
  const balancePeriod = sec.historicals.latestInterim && sec.historicals.latestInterim.period.endDate > (latest?.period.endDate ?? "")
    ? sec.historicals.latestInterim : latest;
  const balanceValue = (key: keyof Omit<PeriodFinancials, "period">): TaggedValue | undefined => {
    const current = balancePeriod?.[key];
    if (current?.value !== null && current?.value !== undefined) return current;
    const prior = latest?.[key];
    return prior ? { ...prior, provenance: { ...prior.provenance, notes: `${prior.provenance.notes ?? ""} Latest interim field unavailable; annual balance retained and requires review.` } } : undefined;
  };
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
    return rate !== null && rate >= 0 && rate <= 0.50 ? rate : null;
  });
  const taxRateMedian = median(effectiveTaxRates);

  let market;
  try {
    market = await loadFmpMarketInputs(sec.identity.ticker);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Market-data request failed.";
    market = marketInputsUnavailable(`Market inputs could not be verified: ${reason}`);
  }

  const cash = balanceValue("cash") ?? derived(null, "Cash and equivalents", "$mm", "Reported cash is required.");
  const operatingCashRequirement = assumed(
    0,
    "Operating cash requirement",
    "$mm",
    "Review default: zero. Enter cash required to run the business; only cash above this amount is treated as excess in the equity bridge.",
  );
  const shortTermInvestments = reviewDefault(balanceValue("shortTermInvestments"), 0, "Short-term investments", "$mm", "No separately identified short-term investment balance was returned.");
  const debt = balanceValue("totalDebt") ?? derived(null, "Total debt", "$mm", "Reported funded debt is required.");
  const financeLeaseLiabilities = reviewDefault(balanceValue("financeLeaseLiabilities"), 0, "Finance lease liabilities", "$mm", "No separately identified finance-lease liability was returned. Check lease footnotes; combined lease obligations cannot safely be split automatically.");
  const operatingLeaseLiabilities = assumed(
    0,
    "Operating lease debt adjustment",
    "$mm",
    `Review default: zero in the unadjusted-FCFF method because lease expense remains in operating cash flow.${latest?.operatingLeaseLiabilities.value ? ` A reported liability of ${latest.operatingLeaseLiabilities.value.toFixed(1)}mm is available if the forecast is lease-adjusted consistently.` : ""}`,
  );
  const otherDebtLikeLiabilities = assumed(
    0,
    "Other debt-like liabilities",
    "$mm",
    "Review default: zero. Add unfunded pensions, restructuring reserves, environmental obligations, deferred consideration, or other debt-like claims when material.",
  );
  const minorityInterest = reviewDefault(balanceValue("minorityInterest"), 0, "Minority interest", "$mm", "No noncontrolling-interest balance was returned; confirm against the latest balance sheet.");
  const preferredStock = reviewDefault(balanceValue("preferredStock"), 0, "Preferred stock", "$mm", "No preferred-equity balance was returned; confirm against the latest balance sheet.");
  const equityMethodInvestments = reviewDefault(balanceValue("equityMethodInvestments"), 0, "Non-operating investments", "$mm", "No separately valued non-operating investment balance was returned; confirm classification and value against the filing.");
  const otherNonOperatingAssets = assumed(
    0,
    "Other non-operating assets",
    "$mm",
    "Review default: zero. Add separately valued assets excluded from operating enterprise value only when they are not already captured elsewhere.",
  );
  const nolValue = assumed(
    0,
    "Present value of usable NOLs",
    "$mm",
    sec.latestNolBalance.value === null
      ? "Review default: no value is added without a jurisdiction-, expiry-, limitation-, and utilization-adjusted NOL schedule."
      : `Review default: a reported tax-asset balance of ${sec.latestNolBalance.value.toFixed(1)}mm was located, but no value is added until a usable NOL schedule is built.`,
  );
  const shareSource = market.currentShares.value !== null
    ? market.currentShares
    : balanceValue("sharesOutstanding")?.value != null
      ? balanceValue("sharesOutstanding")
      : balanceValue("basicShares")?.value != null
        ? balanceValue("basicShares")
        : balanceValue("dilutedShares");
  const basicShares = reviewDefault(shareSource, 0, "Current shares outstanding", "mm shares", "No valid current or weighted-average share count was returned; a positive share count is required.");
  const detailedAwardsAvailable = sec.latestOptions.value !== null
    && sec.latestOptionStrike.value !== null
    && sec.latestRsus.value !== null
    && market.currentPrice.value !== null;
  const basicWeightedAverage = balanceValue("basicShares")?.value;
  const dilutedWeightedAverage = balanceValue("dilutedShares")?.value;
  const dilutionRatio = basicWeightedAverage && basicWeightedAverage > 0 && dilutedWeightedAverage !== null && dilutedWeightedAverage !== undefined
    ? Math.max(0, dilutedWeightedAverage / basicWeightedAverage - 1)
    : 0;
  const dilutionProxy = (basicShares.value ?? 0) * dilutionRatio;
  const options = detailedAwardsAvailable
    ? sec.latestOptions
    : assumed(0, "Options outstanding", "mm shares", "Review default: award-level data was unavailable, so options and RSUs are represented by one reported diluted-share proxy.");
  const optionStrike = detailedAwardsAvailable
    ? sec.latestOptionStrike
    : assumed(0, "Weighted-average option strike", "$ / share", "Review default: not separately required when the combined diluted-share proxy is used.");
  const rsus = detailedAwardsAvailable
    ? sec.latestRsus
    : assumed(
        dilutionProxy,
        "Incremental dilution proxy",
        "mm shares",
        `Review default: current shares multiplied by the latest diluted/basic weighted-average share ratio (${(dilutionRatio * 100).toFixed(2)}%). Replace with award-level options and RSUs when material.`,
      );
  const bridge: EquityBridge = {
    cash,
    operatingCashRequirement,
    shortTermInvestments,
    debt,
    financeLeaseLiabilities,
    operatingLeaseLiabilities,
    otherDebtLikeLiabilities,
    minorityInterest,
    preferredStock,
    equityMethodInvestments,
    otherNonOperatingAssets,
    presentValueOfNols: nolValue,
    basicShares,
    options,
    optionStrikePrice: optionStrike,
    rsus,
  };

  const projectionYears = 5;
  const valuationDate = new Date().toISOString().slice(0, 10);
  let elapsedYears = 0;
  while (latest && elapsedYears < 3 && addFiscalYears(latest.period.endDate, elapsedYears + 1) <= valuationDate) elapsedYears++;
  const terminalGrowth = assumed(
    0.025,
    "Terminal growth",
    "%",
    "Review default: 2.5% for a mature U.S.-dollar company, checked against the available nominal-GDP benchmark and constrained below WACC.",
  );
  const historicalGrowth = median(revenueGrowth) ?? 0.03;
  const historicalMargin = median(ebitMargins.slice(-3)) ?? 0.10;
  const forecast = operatingForecast(
    latest,
    market.analystEstimates,
    projectionYears + elapsedYears,
    historicalGrowth,
    historicalMargin,
    terminalGrowth.value!,
  );
  const daSeed = reviewDefault(
    derived(median(daPercent.slice(-5)), "D&A / revenue", "%", "Historical median of the latest five annual observations.", latest?.depreciationAmortization),
    0.03,
    "D&A / revenue",
    "%",
    "3.0% of revenue is used because historical standardized D&A was incomplete.",
  );
  const sbcSeed = reviewDefault(
    derived(median(sbcPercent.slice(-5)), "SBC / revenue", "%", "Historical median; SBC remains an economic cost unless the add-back toggle is enabled.", latest?.stockBasedCompensation),
    0,
    "SBC / revenue",
    "%",
    "Zero is used because historical standardized SBC was incomplete; review for equity-compensation-heavy issuers.",
  );
  const capexSeed = reviewDefault(
    derived(Math.max(capexPercent.at(-1) ?? 0, median(capexPercent.slice(-5)) ?? 0), "Capex / revenue", "%", "Higher of latest reported intensity and five-year median. This conservative investment-cycle assumption prevents a historical median from erasing a current capex step-up. Review management's spending plan and the transition to terminal reinvestment.", latest?.capitalExpenditures),
    0.03,
    "Capex / revenue",
    "%",
    "3.0% of revenue is used because historical standardized capex was incomplete.",
  );
  const nwcSeed = reviewDefault(
    derived(median(nwcPercent.slice(-5)), "Operating NWC / revenue", "%", "Historical median using operating current assets less operating current liabilities.", latest?.accountsReceivable),
    0.05,
    "Operating NWC / revenue",
    "%",
    "5.0% of revenue is used because standardized working-capital detail was incomplete.",
  );
  const taxSeed = reviewDefault(
    derived(taxRateMedian, "Operating tax rate", "%", "Median normalized effective tax rate from filings; financing tax effects are excluded from FCFF.", latest?.incomeTaxExpense),
    0.25,
    "Operating tax rate",
    "%",
    "25.0% is used because no stable normalized effective tax rate was available.",
  );
  let projectionBase: ModelPayload["projectionBase"];
  if (elapsedYears && latest?.revenue.value != null) {
    let revenue = latest.revenue.value;
    for (const growth of forecast.revenueGrowth.slice(0, elapsedYears)) revenue *= 1 + (growth.value ?? 0);
    const endDate = addFiscalYears(latest.period.endDate, elapsedYears);
    projectionBase = {
      endDate,
      revenue: derived(revenue, "Estimated opening revenue", "$mm", `Unreported elapsed fiscal year ending ${endDate}, rolled forward using dated consensus or the disclosed historical-growth assumption. Not reported actuals.`, forecast.revenueGrowth[elapsedYears - 1]),
      netWorkingCapital: derived(revenue * (nwcSeed.value ?? 0), "Estimated opening operating NWC", "$mm", "Estimated opening revenue multiplied by normalized operating NWC / revenue; not reported actuals.", nwcSeed),
    };
  }
  const roicObservation = terminalRoic(annual, taxSeed.value);
  const roicSeed = roicObservation.value !== null && roicObservation.value > terminalGrowth.value! + 0.01
    ? derived(
        clamp(roicObservation.value, Math.max(0.08, terminalGrowth.value! + 0.02), 0.25),
        "Terminal ROIC",
        "%",
        roicObservation.value > 0.25
          ? "Historical ROIC is capped at a strong 25.0% mature-state return to avoid extrapolating an exceptional current franchise return forever."
          : "Historical ROIC is bounded to remain consistent with stable-growth reinvestment economics.",
        latest?.stockholdersEquity,
      )
    : assumed(0.10, "Terminal ROIC", "%", "Review default: 10.0% mature-state ROIC because the historical invested-capital series was unavailable or inconsistent with stable-growth economics.");
  const riskFreeRate = reviewDefault(market.riskFreeRate, 0.04, "Risk-free rate", "%", "4.0% U.S. Treasury house assumption is used because a live rate was unavailable.");
  const equityRiskPremium = reviewDefault(market.equityRiskPremium, 0.05, "Equity risk premium", "%", "5.0% U.S. market house assumption is used because a live premium was unavailable.");
  const releveredBeta = reviewDefault(market.releveredBeta, 1, "Relevered beta", "x", "1.00x is used because a sufficiently complete peer-beta set was unavailable.");

  const marketCapitalization = market.currentPrice.value !== null && basicShares.value !== null
    ? market.currentPrice.value * basicShares.value
    : null;
  const debtCapital = (debt.value ?? 0) + (financeLeaseLiabilities.value ?? 0);
  const actualDebtWeight = marketCapitalization !== null && marketCapitalization + debtCapital > 0
    ? debtCapital / (marketCapitalization + debtCapital)
    : null;
  const baseDebtWeight = market.targetDebtWeight.value !== null
    ? market.targetDebtWeight
    : actualDebtWeight !== null
      ? derived(actualDebtWeight, "Observed debt weight", "%", "Current funded debt divided by current debt plus equity market value.", market.currentPrice)
      : assumed(0.15, "Debt weight", "%", "Review default: 15.0% target debt weight because peer and observed market-capitalization data were unavailable.");
  const preferredWeightValue = marketCapitalization !== null && preferredStock.value !== null && preferredStock.value > 0
    ? preferredStock.value / (marketCapitalization + debtCapital + preferredStock.value)
    : 0;
  const preferredWeight = preferredWeightValue > 0
    ? derived(preferredWeightValue, "Preferred weight", "%", "Book preferred value divided by debt plus common-equity market value plus preferred value.", preferredStock)
    : derived(0, "Preferred weight", "%", "No preferred-equity claim is included in the capital structure.", preferredStock);
  const debtWeightValue = clamp(baseDebtWeight.value ?? 0.15, 0, 1) * (1 - preferredWeightValue);
  const debtWeight: TaggedValue = {
    value: debtWeightValue,
    provenance: { ...baseDebtWeight.provenance, label: "Debt weight" },
  };
  const equityWeight = derived(1 - debtWeightValue - preferredWeightValue, "Equity weight", "%", "Residual capital weight after debt and preferred equity.", debtWeight);
  const historicalDebtCost = latestDebtCost(annual);
  const marginalDebtCostFloor = Math.max(0, (riskFreeRate.value ?? 0.04) + 0.015);
  const preTaxCostOfDebt = debtWeightValue === 0
    ? derived(0, "Pre-tax cost of debt", "%", "Not applicable because the selected debt weight is zero.", debt)
    : historicalDebtCost.value !== null
      ? derived(
          Math.max(historicalDebtCost.value, marginalDebtCostFloor),
          "Pre-tax cost of debt",
          "%",
          historicalDebtCost.value < marginalDebtCostFloor
            ? `Historical interest / average debt (${(historicalDebtCost.value * 100).toFixed(2)}%) is below a plausible marginal borrowing rate, so the automatic case uses risk-free plus a transparent 150 bps review spread (${(marginalDebtCostFloor * 100).toFixed(2)}%). Replace with a current traded yield or synthetic rating spread.`
            : "Historical interest / average debt exceeds the risk-free-plus-150-bps floor and is used only as an editable proxy for marginal borrowing cost.",
          historicalDebtCost,
        )
      : assumed(
          marginalDebtCostFloor,
          "Pre-tax cost of debt",
          "%",
          "Review default: risk-free rate plus a 150 bps spread because no stable historical borrowing-rate proxy was available. Replace with a current traded yield or synthetic rating spread.",
        );
  market.preTaxCostOfDebt = preTaxCostOfDebt;
  const preferredCost = preferredWeightValue === 0
    ? derived(0, "Preferred cost", "%", "Not applicable because the preferred weight is zero.", preferredStock)
    : assumed(0.08, "Preferred cost", "%", "Review default: 8.0% required return for material preferred equity; replace with the security's current yield.");

  const exitMultiple = market.peerExitMultiple.value !== null
    ? derived(market.peerExitMultiple.value, "Exit EV/EBITDA", "x", "Peer-median market cross-check; Gordon growth remains the primary intrinsic method.", market.peerExitMultiple)
    : derived(
        null,
        "Exit EV/EBITDA",
        "x",
        "No defensible peer median was available. The subject company's own trading multiple is deliberately not used because that would make the cross-check circular; enter a reviewed forward peer multiple if desired.",
      );

  const assumptions: ProjectionAssumptions = {
    projectionYears,
    valuationDate,
    discountingConvention: "mid-year",
    revenueGrowth: forecast.revenueGrowth.slice(elapsedYears),
    ebitMargin: forecast.ebitMargin.slice(elapsedYears),
    depreciationAmortizationPctRevenue: repeated(daSeed, projectionYears),
    stockBasedCompensationPctRevenue: repeated(sbcSeed, projectionYears),
    capitalExpendituresPctRevenue: repeated(capexSeed, projectionYears),
    netWorkingCapitalPctRevenue: repeated(nwcSeed, projectionYears),
    operatingTaxRate: repeated(taxSeed, projectionYears),
    terminalGrowth,
    terminalRoic: roicSeed,
    exitMultiple,
    riskFreeRate,
    equityRiskPremium,
    releveredBeta,
    countryRiskPremium: assumed(0, "Country risk premium", "%", "Review default: zero for the U.S.-dollar base case; add a sourced premium when operating exposure warrants it."),
    sizePremium: assumed(0, "Size premium", "%", "Review default: zero unless a documented size-premium methodology is selected."),
    preTaxCostOfDebt,
    debtWeight,
    equityWeight,
    preferredWeight,
    preferredCost,
    usableInterestTaxRate: taxSeed,
    stockCompensationAddBack: false,
  };

  const gaps: DataGap[] = [];
  if (projectionBase) gaps.push({ field: "Estimated opening fiscal year", reason: projectionBase.revenue.provenance.notes!, severity: elapsedYears > 1 ? "blocking" : "review", affectedOutputs: ["Forecast revenue", "DCF"] });
  gaps.push({ field: "Investment-cycle assumption", reason: capexSeed.provenance.notes!, severity: "review", affectedOutputs: ["Forecast capex", "DCF"] });
  gaps.push({ field: "Balance-sheet classifications", reason: `Equity bridge uses the latest available field, preferably ${balancePeriod?.period.endDate ?? "annual"}. Review operating cash, lease separation, non-operating investments and debt-like claims. Standardized classifications are not independent filing verification.`, severity: "review", affectedOutputs: ["Equity bridge"] });
  if (filingFallbackReason) {
    gaps.push({
      field: "Primary SEC Company Facts source",
      reason: `${filingFallbackReason} Standardized FMP statements were used; provider links do not constitute independent SEC verification. Reconcile material values to the issuer filing.`,
      severity: "warning",
      affectedOutputs: ["Source audit", "Historical financials"],
    });
  }
  if (annual.length < 3) {
    gaps.push({
      field: "Historical filing coverage",
      reason: `Only ${annual.length} complete annual periods were resolved; at least three are required for a normalized automatic case.`,
      severity: "blocking",
      affectedOutputs: ["Projection defaults", "DCF"],
    });
  } else if (annual.length < 5) {
    gaps.push({
      field: "Five-year filing history",
      reason: `Only ${annual.length} complete annual periods were resolved. The valuation calculates, but normalization should be reviewed.`,
      severity: "review",
      affectedOutputs: ["Projection defaults", "DCF"],
    });
  }
  if (!sec.historicals.latestInterim) {
    gaps.push({
      field: "Latest interim period",
      reason: "No latest 10-Q revenue context was resolved; the automatic case starts from the latest annual period.",
      severity: "warning",
      affectedOutputs: ["Latest interim display"],
    });
  } else {
    gaps.push({
      field: "Interim / stub integration",
      reason: `${sec.historicals.latestInterim.period.label} supplies the latest balance-sheet bridge. Operating forecasts are full-year cases, not LTM; first-period FCFF is time-weighted. Review seasonality and reconcile the remaining stub to reported interim results before circulation.`,
      severity: "review",
      affectedOutputs: ["First forecast period", "DCF"],
    });
  }
  if (market.currentPrice.value === null) {
    gaps.push({
      field: "Current market price",
      reason: "A current quote was unavailable. Intrinsic value still calculates, but upside/downside and market-anchored cross-checks are omitted.",
      severity: "warning",
      affectedOutputs: ["Upside / downside", "Market cross-checks"],
    });
  }
  if ((bridge.basicShares.value ?? 0) <= 0) {
    gaps.push({
      field: "Current shares outstanding",
      reason: "No positive common-share count was resolved; per-share value cannot be calculated.",
      severity: "blocking",
      affectedOutputs: ["Per-share value"],
    });
  }
  for (const [field, value] of [
    ["Risk-free rate", assumptions.riskFreeRate],
    ["Equity risk premium", assumptions.equityRiskPremium],
    ["Levered beta", assumptions.releveredBeta],
    ["Pre-tax cost of debt", assumptions.preTaxCostOfDebt],
    ["Debt weight", assumptions.debtWeight],
    ["Terminal growth", assumptions.terminalGrowth],
    ["Terminal ROIC", assumptions.terminalRoic],
    ["Exit multiple", assumptions.exitMultiple],
    ["Country risk premium", assumptions.countryRiskPremium],
    ["Size premium", assumptions.sizePremium],
  ] as Array<[string, TaggedValue]>) addReviewGap(gaps, field, value, ["WACC", "DCF", "Per-share value"]);
  if (assumptions.terminalRoic.provenance.origin !== "assumed") {
    gaps.push({
      field: "Terminal ROIC",
      reason: assumptions.terminalRoic.provenance.notes ?? "Review the mature-state return and reinvestment relationship.",
      severity: "review",
      affectedOutputs: ["Gordon terminal value", "Per-share value"],
    });
  }
  if (assumptions.exitMultiple.value !== null && assumptions.exitMultiple.provenance.origin !== "assumed") {
    gaps.push({
      field: "Exit multiple",
      reason: `${assumptions.exitMultiple.provenance.notes ?? "Market cross-check."} Review the selected peer set and forward-period consistency.`,
      severity: "review",
      affectedOutputs: ["Exit-multiple cross-check"],
    });
  }
  if (assumptions.exitMultiple.value === null) {
    gaps.push({
      field: "Exit-multiple cross-check",
      reason: assumptions.exitMultiple.provenance.notes ?? "Enter a reviewed peer-median forward EV / EBITDA multiple if an exit-method cross-check is required.",
      severity: "review",
      affectedOutputs: ["Exit-multiple cross-check"],
    });
  }
  for (const [field, value] of [
    ["Cash", bridge.cash],
    ["Operating cash requirement", bridge.operatingCashRequirement],
    ["Short-term investments", bridge.shortTermInvestments],
    ["Total debt", bridge.debt],
    ["Finance lease liabilities", bridge.financeLeaseLiabilities],
    ["Operating lease treatment", bridge.operatingLeaseLiabilities],
    ["Other debt-like liabilities", bridge.otherDebtLikeLiabilities],
    ["Minority interest", bridge.minorityInterest],
    ["Preferred stock", bridge.preferredStock],
    ["Non-operating investments", bridge.equityMethodInvestments],
    ["Other non-operating assets", bridge.otherNonOperatingAssets],
    ["Present value of usable NOLs", bridge.presentValueOfNols],
    ["Current shares outstanding", bridge.basicShares],
    ["Options", bridge.options],
    ["Option strike price", bridge.optionStrikePrice],
    ["RSUs / dilution proxy", bridge.rsus],
  ] as Array<[string, TaggedValue]>) addReviewGap(gaps, field, value, ["Equity bridge", "Per-share value"]);
  for (const [field, value] of [
    ["Revenue growth", assumptions.revenueGrowth[0]],
    ["EBIT margin", assumptions.ebitMargin[0]],
    ["D&A / revenue", daSeed],
    ["SBC / revenue", sbcSeed],
    ["Capex / revenue", capexSeed],
    ["NWC / revenue", nwcSeed],
    ["Tax rate", taxSeed],
  ] as Array<[string, TaggedValue]>) {
    addGap(gaps, field, value, ["Projection model", "DCF"]);
    addReviewGap(gaps, field, value, ["Projection model", "DCF"]);
  }

  return {
    generatedAt: new Date().toISOString(),
    identity: sec.identity,
    historicals: sec.historicals,
    projectionBase,
    market,
    assumptions,
    bridge,
    gaps,
  };
}

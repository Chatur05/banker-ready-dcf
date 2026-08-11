import { addFiscalYears, bisection, yearFraction } from "./math";
import type {
  DcfResult,
  EquityBridge,
  ModelPayload,
  ProjectionAssumptions,
  ProjectionYear,
  TaggedValue,
} from "./types";

function number(value: TaggedValue, label: string, errors: string[]): number | null {
  if (value.value === null || !Number.isFinite(value.value)) {
    errors.push(`${label} is required.`);
    return null;
  }
  return value.value;
}

function optionalNumber(value: TaggedValue): number | null {
  return value.value !== null && Number.isFinite(value.value) ? value.value : null;
}

function series(
  values: TaggedValue[],
  length: number,
  label: string,
  errors: string[],
): number[] | null {
  if (values.length < length) {
    errors.push(`${label} requires ${length} annual inputs.`);
    return null;
  }
  const parsed = values.slice(0, length).map((value) => value.value);
  if (parsed.some((value) => value === null || !Number.isFinite(value))) {
    errors.push(`${label} contains a missing annual input.`);
    return null;
  }
  return parsed as number[];
}

function validateRange(
  values: number[] | null,
  label: string,
  low: number,
  high: number,
  errors: string[],
): void {
  if (!values) return;
  values.forEach((value, index) => {
    if (value < low || value > high) {
      errors.push(`${label} in forecast year ${index + 1} must be between ${(low * 100).toFixed(0)}% and ${(high * 100).toFixed(0)}%.`);
    }
  });
}

function validateScalarRange(
  value: number | null,
  label: string,
  low: number,
  high: number,
  errors: string[],
): void {
  if (value !== null && (value < low || value > high)) {
    errors.push(`${label} must be between ${(low * 100).toFixed(0)}% and ${(high * 100).toFixed(0)}%.`);
  }
}

function bridgeValue(value: TaggedValue, label: string, errors: string[]): number | null {
  return number(value, `Bridge item: ${label}`, errors);
}

function fullyDilutedShares(
  bridge: EquityBridge,
  currentPrice: number | null,
  errors: string[],
  warnings: string[],
): number | null {
  const basic = bridgeValue(bridge.basicShares, "basic shares", errors);
  const options = bridgeValue(bridge.options, "options outstanding", errors);
  const strike = bridgeValue(bridge.optionStrikePrice, "weighted-average option strike", errors);
  const rsus = bridgeValue(bridge.rsus, "RSUs", errors);
  if ([basic, options, strike, rsus].some((value) => value === null)) return null;
  if (basic! <= 0) {
    errors.push("Bridge item: basic shares must be greater than zero.");
    return null;
  }
  if (options! < 0 || strike! < 0 || rsus! < 0) {
    errors.push("Dilution inputs cannot be negative.");
    return null;
  }
  const incrementalOptions = options! > 0 && currentPrice !== null && currentPrice > 0 && strike! < currentPrice
    ? options! * (1 - strike! / currentPrice)
    : options! > 0 && (currentPrice === null || currentPrice <= 0)
      ? options!
      : 0;
  if (options! > 0 && (currentPrice === null || currentPrice <= 0)) {
    warnings.push("Current market price was unavailable, so all outstanding options are included as a conservative dilution proxy.");
  }
  return basic! + incrementalOptions + rsus!;
}

export function buildUnleveredFreeCashFlow({
  ebit,
  taxRate,
  depreciationAmortization,
  capitalExpenditures,
  changeInNetWorkingCapital,
  stockBasedCompensation = 0,
  addBackStockCompensation = false,
}: {
  ebit: number;
  taxRate: number;
  depreciationAmortization: number;
  capitalExpenditures: number;
  changeInNetWorkingCapital: number;
  stockBasedCompensation?: number;
  addBackStockCompensation?: boolean;
}): { cashTaxes: number; nopat: number; unleveredFreeCashFlow: number } {
  const cashTaxes = Math.max(0, ebit * taxRate);
  const nopat = ebit - cashTaxes;
  return {
    cashTaxes,
    nopat,
    unleveredFreeCashFlow: nopat + depreciationAmortization - capitalExpenditures
      - changeInNetWorkingCapital
      + (addBackStockCompensation ? stockBasedCompensation : 0),
  };
}

export function calculateDcf(
  payload: ModelPayload,
  assumptions: ProjectionAssumptions = payload.assumptions,
  bridge: EquityBridge = payload.bridge,
): DcfResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const annual = payload.historicals.annual;
  const latest = annual.at(-1);
  if (!payload.identity.valuationMethodEligible) {
    errors.push(payload.identity.ineligibleReason ?? "FCFF DCF is not appropriate for this issuer.");
  }
  if (!latest) errors.push("At least one annual filing period is required.");
  if (annual.length > 0 && annual.length < 3) errors.push("At least three annual filing periods are required for the automatic FCFF case.");
  const projectionYears = assumptions.projectionYears;
  if (projectionYears < 5 || projectionYears > 10) {
    errors.push("Projection period must be between five and ten years.");
  }

  const growth = series(assumptions.revenueGrowth, projectionYears, "Revenue growth", errors);
  const margins = series(assumptions.ebitMargin, projectionYears, "EBIT margin", errors);
  const daPercent = series(
    assumptions.depreciationAmortizationPctRevenue,
    projectionYears,
    "D&A as a percentage of revenue",
    errors,
  );
  const sbcPercent = series(
    assumptions.stockBasedCompensationPctRevenue,
    projectionYears,
    "SBC as a percentage of revenue",
    errors,
  );
  const capexPercent = series(
    assumptions.capitalExpendituresPctRevenue,
    projectionYears,
    "Capex as a percentage of revenue",
    errors,
  );
  const nwcPercent = series(
    assumptions.netWorkingCapitalPctRevenue,
    projectionYears,
    "NWC as a percentage of revenue",
    errors,
  );
  const taxRates = series(assumptions.operatingTaxRate, projectionYears, "Operating tax rate", errors);
  validateRange(growth, "Revenue growth", -0.95, 1, errors);
  validateRange(margins, "EBIT margin", -1, 1, errors);
  validateRange(daPercent, "D&A / revenue", 0, 1, errors);
  validateRange(sbcPercent, "SBC / revenue", 0, 1, errors);
  validateRange(capexPercent, "Capex / revenue", 0, 1, errors);
  validateRange(nwcPercent, "NWC / revenue", -1, 1, errors);
  validateRange(taxRates, "Operating tax rate", 0, 0.60, errors);

  const riskFree = number(assumptions.riskFreeRate, "Risk-free rate", errors);
  const erp = number(assumptions.equityRiskPremium, "Equity risk premium", errors);
  const beta = number(assumptions.releveredBeta, "Levered beta", errors);
  const countryRisk = number(assumptions.countryRiskPremium, "Country risk premium", errors);
  const sizePremium = number(assumptions.sizePremium, "Size premium", errors);
  const costDebt = number(assumptions.preTaxCostOfDebt, "Pre-tax cost of debt", errors);
  const debtWeight = number(assumptions.debtWeight, "Debt weight", errors);
  const equityWeight = number(assumptions.equityWeight, "Equity weight", errors);
  const preferredWeight = number(assumptions.preferredWeight, "Preferred weight", errors);
  const preferredCost = number(assumptions.preferredCost, "Preferred cost", errors);
  const interestTaxRate = number(assumptions.usableInterestTaxRate, "Usable interest tax rate", errors);
  const terminalGrowth = number(assumptions.terminalGrowth, "Terminal growth", errors);
  const terminalRoic = number(assumptions.terminalRoic, "Terminal ROIC", errors);
  const exitMultiple = optionalNumber(assumptions.exitMultiple);
  const currentPrice = optionalNumber(payload.market.currentPrice);
  if (exitMultiple === null) warnings.push("Exit-multiple cross-check is unavailable; the primary Gordon-growth valuation remains calculable.");
  if (currentPrice === null) warnings.push("Current market price is unavailable; upside/downside is omitted.");
  validateScalarRange(riskFree, "Risk-free rate", -0.02, 0.25, errors);
  validateScalarRange(erp, "Equity risk premium", 0, 0.25, errors);
  validateScalarRange(countryRisk, "Country risk premium", 0, 0.25, errors);
  validateScalarRange(sizePremium, "Size premium", 0, 0.25, errors);
  validateScalarRange(costDebt, "Pre-tax cost of debt", 0, 0.40, errors);
  validateScalarRange(interestTaxRate, "Usable interest tax rate", 0, 0.60, errors);
  validateScalarRange(terminalGrowth, "Terminal growth", -0.05, 0.10, errors);
  validateScalarRange(terminalRoic, "Terminal ROIC", 0.01, 1, errors);
  for (const [label, value] of [["Debt weight", debtWeight], ["Equity weight", equityWeight], ["Preferred weight", preferredWeight]] as Array<[string, number | null]>) {
    validateScalarRange(value, label, 0, 1, errors);
  }
  if (beta !== null && (beta < 0 || beta > 5)) errors.push("Levered beta must be between 0.0x and 5.0x.");
  if (preferredCost !== null && (preferredCost < 0 || preferredCost > 0.40)) errors.push("Preferred cost must be between 0% and 40%.");
  if (exitMultiple !== null && (exitMultiple <= 0 || exitMultiple > 50)) errors.push("Exit EV / EBITDA must be greater than 0.0x and no more than 50.0x.");

  const latestRevenue = latest ? number(latest.revenue, "Latest annual revenue", errors) : null;
  const latestNwc = latest
    ? [
        latest.accountsReceivable.value,
        latest.inventory.value,
        latest.otherCurrentAssets.value,
        latest.accountsPayable.value,
        latest.deferredRevenue.value,
        latest.otherCurrentLiabilities.value,
      ]
    : [];
  let latestNwcBalance = latestNwc.length && latestNwc.every((value) => value !== null)
    ? (latestNwc[0]! + latestNwc[1]! + latestNwc[2]!)
      - (latestNwc[3]! + latestNwc[4]! + latestNwc[5]!)
    : null;
  if (latestNwcBalance === null && latestRevenue !== null && nwcPercent?.[0] !== undefined) {
    latestNwcBalance = latestRevenue * nwcPercent[0];
    warnings.push("Latest operating working-capital components were incomplete, so the opening balance uses the normalized NWC/revenue assumption.");
  }
  if (latestNwcBalance === null) errors.push("Latest operating working-capital balance could not be resolved.");

  const costOfEquity = [riskFree, erp, beta, countryRisk, sizePremium].every((value) => value !== null)
    ? riskFree! + beta! * erp! + countryRisk! + sizePremium!
    : null;
  const afterTaxCostOfDebt = costDebt !== null && interestTaxRate !== null
    ? costDebt * (1 - interestTaxRate)
    : null;
  const weights = [debtWeight, equityWeight, preferredWeight];
  if (weights.every((value) => value !== null)) {
    const weightSum = weights.reduce<number>((sum, value) => sum + value!, 0);
    if (Math.abs(weightSum - 1) > 0.0001) errors.push("Debt, equity, and preferred weights must sum to 100%.");
  }
  const wacc = [costOfEquity, afterTaxCostOfDebt, debtWeight, equityWeight, preferredWeight, preferredCost]
    .every((value) => value !== null)
    ? equityWeight! * costOfEquity!
      + debtWeight! * afterTaxCostOfDebt!
      + preferredWeight! * preferredCost!
    : null;
  if (wacc !== null && terminalGrowth !== null && wacc <= terminalGrowth) {
    errors.push("WACC must exceed terminal growth.");
  }
  if (terminalGrowth !== null && payload.market.terminalGdpGrowth.value !== null
    && terminalGrowth > payload.market.terminalGdpGrowth.value) {
    warnings.push("Terminal growth exceeds the sourced long-run nominal GDP benchmark.");
  }
  if (terminalRoic !== null && terminalGrowth !== null && terminalRoic <= terminalGrowth) {
    errors.push("Terminal ROIC must exceed terminal growth to support a valid reinvestment rate.");
  }
  if (terminalRoic !== null && terminalGrowth !== null && terminalGrowth >= 0
    && terminalGrowth / terminalRoic > 1) {
    errors.push("Terminal reinvestment cannot exceed 100% of NOPAT in a positive-growth stable state.");
  }

  const canProject = latest && latestRevenue !== null && latestNwcBalance !== null
    && growth && margins && daPercent && sbcPercent && capexPercent && nwcPercent && taxRates
    && wacc !== null;
  const projections: ProjectionYear[] = [];
  if (canProject) {
    const nextFiscalEnd = (() => {
      let candidate = addFiscalYears(latest.period.endDate, 1);
      while (candidate <= assumptions.valuationDate) candidate = addFiscalYears(candidate, 1);
      return candidate;
    })();
    const firstStubFraction = Math.min(1, yearFraction(assumptions.valuationDate, nextFiscalEnd));
    if (firstStubFraction < 0.75) {
      warnings.push(`The first forecast period is a ${(firstStubFraction * 100).toFixed(1)}% stub estimated from a full-year operating case; reconcile reported interim actuals before circulation.`);
    }
    let priorRevenue = latestRevenue;
    let priorNwc = latestNwcBalance!;
    for (let index = 0; index < projectionYears; index += 1) {
      const revenue = priorRevenue * (1 + growth[index]);
      const ebit = revenue * margins[index];
      const depreciationAmortization = revenue * daPercent[index];
      const stockBasedCompensation = revenue * sbcPercent[index];
      const capitalExpenditures = revenue * capexPercent[index];
      const netWorkingCapital = revenue * nwcPercent[index];
      const changeInNetWorkingCapital = netWorkingCapital - priorNwc;
      const operatingBuild = buildUnleveredFreeCashFlow({
        ebit,
        taxRate: taxRates[index],
        depreciationAmortization,
        capitalExpenditures,
        changeInNetWorkingCapital,
        stockBasedCompensation,
        addBackStockCompensation: assumptions.stockCompensationAddBack,
      });
      const { cashTaxes, nopat } = operatingBuild;
      const fullYearFcf = operatingBuild.unleveredFreeCashFlow;
      const stubFraction = index === 0 ? firstStubFraction : 1;
      const unleveredFreeCashFlow = fullYearFcf * stubFraction;
      const discountPeriod = assumptions.discountingConvention === "mid-year"
        ? (index === 0 ? firstStubFraction / 2 : firstStubFraction + index - 0.5)
        : firstStubFraction + index;
      const discountFactor = 1 / (1 + wacc) ** discountPeriod;
      projections.push({
        fiscalYear: new Date(nextFiscalEnd).getUTCFullYear() + index,
        endDate: addFiscalYears(nextFiscalEnd, index),
        revenue,
        growth: growth[index],
        ebitMargin: margins[index],
        ebit,
        cashTaxes,
        nopat,
        depreciationAmortization,
        stockBasedCompensation,
        capitalExpenditures,
        netWorkingCapital,
        changeInNetWorkingCapital,
        unleveredFreeCashFlow,
        fullYearUnleveredFreeCashFlow: fullYearFcf,
        stubFraction,
        discountPeriod,
        discountFactor,
        presentValueOfFreeCashFlow: unleveredFreeCashFlow * discountFactor,
      });
      priorRevenue = revenue;
      priorNwc = netWorkingCapital;
    }
  }

  const finalProjection = projections.at(-1);
  const presentValueExplicitCashFlows = projections.length
    ? projections.reduce((sum, projection) => sum + projection.presentValueOfFreeCashFlow, 0)
    : null;
  let terminalValueGordon: number | null = null;
  let terminalValueExitMultiple: number | null = null;
  let presentValueTerminalGordon: number | null = null;
  let presentValueTerminalExit: number | null = null;
  let impliedExitMultiple: number | null = null;
  let impliedPerpetuityGrowth: number | null = null;
  let enterpriseValueGordon: number | null = null;
  let enterpriseValueExit: number | null = null;
  let terminalValuePctEnterpriseValue: number | null = null;
  let terminalNopat: number | null = null;
  let terminalReinvestmentRate: number | null = null;
  let terminalFreeCashFlow: number | null = null;
  let terminalDiscountPeriod: number | null = null;
  let terminalDiscountFactor: number | null = null;
  if (finalProjection && wacc !== null && terminalGrowth !== null && terminalRoic !== null
    && presentValueExplicitCashFlows !== null && wacc > terminalGrowth) {
    terminalReinvestmentRate = terminalGrowth / terminalRoic;
    terminalNopat = finalProjection.nopat * (1 + terminalGrowth);
    terminalFreeCashFlow = terminalNopat * (1 - terminalReinvestmentRate);
    terminalValueGordon = terminalFreeCashFlow / (wacc - terminalGrowth);
    const finalEbitda = finalProjection.ebit + finalProjection.depreciationAmortization;
    terminalDiscountPeriod = finalProjection.discountPeriod
      + (assumptions.discountingConvention === "mid-year" ? 0.5 : 0);
    terminalDiscountFactor = 1 / (1 + wacc) ** terminalDiscountPeriod;
    presentValueTerminalGordon = terminalValueGordon * terminalDiscountFactor;
    enterpriseValueGordon = presentValueExplicitCashFlows + presentValueTerminalGordon;
    terminalValuePctEnterpriseValue = presentValueTerminalGordon / enterpriseValueGordon;
    impliedExitMultiple = finalEbitda !== 0 ? terminalValueGordon / finalEbitda : null;
    if (exitMultiple !== null) {
      terminalValueExitMultiple = finalEbitda * exitMultiple;
      presentValueTerminalExit = terminalValueExitMultiple * terminalDiscountFactor;
      enterpriseValueExit = presentValueExplicitCashFlows + presentValueTerminalExit;
      impliedPerpetuityGrowth = bisection(
        (candidateGrowth) => {
          const reinvestment = candidateGrowth / terminalRoic;
          const candidateFcf = finalProjection.nopat * (1 + candidateGrowth) * (1 - reinvestment);
          return candidateFcf / (wacc - candidateGrowth) - terminalValueExitMultiple!;
        },
        -0.2,
        Math.min(wacc, terminalRoic) - 1e-6,
      );
    }
    if (terminalValuePctEnterpriseValue > 0.75) {
      warnings.push("Terminal value exceeds 75% of enterprise value.");
    }
  }

  const bridgeValues = {
    cash: bridgeValue(bridge.cash, "cash and equivalents", errors),
    operatingCashRequirement: bridgeValue(bridge.operatingCashRequirement, "operating cash requirement", errors),
    shortTermInvestments: bridgeValue(bridge.shortTermInvestments, "short-term investments", errors),
    debt: bridgeValue(bridge.debt, "total debt", errors),
    financeLeases: bridgeValue(bridge.financeLeaseLiabilities, "finance lease liabilities", errors),
    operatingLeases: bridgeValue(bridge.operatingLeaseLiabilities, "operating lease liabilities", errors),
    otherDebtLikeLiabilities: bridgeValue(bridge.otherDebtLikeLiabilities, "other debt-like liabilities", errors),
    minorityInterest: bridgeValue(bridge.minorityInterest, "minority interest", errors),
    preferredStock: bridgeValue(bridge.preferredStock, "preferred stock", errors),
    equityMethodInvestments: bridgeValue(bridge.equityMethodInvestments, "equity-method investments", errors),
    otherNonOperatingAssets: bridgeValue(bridge.otherNonOperatingAssets, "other non-operating assets", errors),
    nols: bridgeValue(bridge.presentValueOfNols, "present value of usable NOLs", errors),
  };
  const fullyDiluted = fullyDilutedShares(bridge, currentPrice, errors, warnings);
  const completeBridge = Object.values(bridgeValues).every((value) => value !== null);
  const bridgeAdjustments = completeBridge
    ? bridgeValues.cash! - bridgeValues.operatingCashRequirement! + bridgeValues.shortTermInvestments!
      + bridgeValues.equityMethodInvestments! + bridgeValues.otherNonOperatingAssets!
      + bridgeValues.nols! - bridgeValues.debt! - bridgeValues.financeLeases!
      - bridgeValues.operatingLeases! - bridgeValues.otherDebtLikeLiabilities!
      - bridgeValues.minorityInterest! - bridgeValues.preferredStock!
    : null;
  const commonEquityValueGordon = enterpriseValueGordon !== null && bridgeAdjustments !== null
    ? enterpriseValueGordon + bridgeAdjustments
    : null;
  const commonEquityValueExit = enterpriseValueExit !== null && bridgeAdjustments !== null
    ? enterpriseValueExit + bridgeAdjustments
    : null;
  const impliedSharePriceGordon = commonEquityValueGordon !== null && fullyDiluted && fullyDiluted > 0
    ? commonEquityValueGordon / fullyDiluted
    : null;
  const impliedSharePriceExit = commonEquityValueExit !== null && fullyDiluted && fullyDiluted > 0
    ? commonEquityValueExit / fullyDiluted
    : null;
  const upsideDownsideGordon = impliedSharePriceGordon !== null && currentPrice && currentPrice > 0
    ? impliedSharePriceGordon / currentPrice - 1
    : null;

  return {
    ready: errors.length === 0 && impliedSharePriceGordon !== null,
    errors: [...new Set(errors)],
    warnings: [...new Set(warnings)],
    projections,
    costOfEquity,
    afterTaxCostOfDebt,
    wacc,
    terminalValueGordon,
    terminalValueExitMultiple,
    impliedExitMultiple,
    impliedPerpetuityGrowth,
    presentValueExplicitCashFlows,
    presentValueTerminalGordon,
    presentValueTerminalExit,
    enterpriseValueGordon,
    enterpriseValueExit,
    terminalValuePctEnterpriseValue,
    terminalNopat,
    terminalReinvestmentRate,
    terminalFreeCashFlow,
    terminalDiscountPeriod,
    terminalDiscountFactor,
    commonEquityValueGordon,
    commonEquityValueExit,
    fullyDilutedShares: fullyDiluted,
    impliedSharePriceGordon,
    impliedSharePriceExit,
    upsideDownsideGordon,
    bridgeAdjustments,
  };
}

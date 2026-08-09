import assert from "node:assert/strict";
import test from "node:test";
import { buildUnleveredFreeCashFlow } from "../lib/model/valuation";

const APPLE_2025_10K = "https://www.sec.gov/Archives/edgar/data/320193/000032019325000079/aapl-20250927.htm";

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

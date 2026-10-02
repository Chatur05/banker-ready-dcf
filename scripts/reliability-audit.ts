import { mkdir, readFile, writeFile } from "node:fs/promises";
import { buildModelPayload } from "../lib/data/model";
import { calculateDcf } from "../lib/model/valuation";

// Private, ignored evidence lets fixes be replayed against identical provider data.
const directory = "tmp/reliability";
await mkdir(directory, { recursive: true });
const replay = process.argv.includes("--replay");
const phase = replay || process.argv.includes("--after") ? "after" : "before";
const requested = process.argv.filter((arg) => arg.startsWith("--tickers="))[0]?.split("=")[1];
const tickers = (requested ?? "AAPL,MSFT,NVDA,AMZN,TSLA,KO,XOM,F,RIVN,JPM,O,LLY").split(",");
type Capture = { status: number; body: string; headers: Record<string, string> };
let captures: Record<string, Capture> = {};
try { captures = JSON.parse(await readFile(`${directory}/responses.json`, "utf8")); } catch { /* First run. */ }
const networkFetch = globalThis.fetch;
let networkCalls = 0;
globalThis.fetch = async (input, init) => {
  const url = new URL(String(input));
  url.searchParams.delete("apikey");
  const key = url.toString();
  const saved = captures[key];
  if (saved) return new Response(saved.body, { status: saved.status, headers: saved.headers });
  if (replay) throw new Error(`No recorded response for ${key}`);
  if (++networkCalls > 160) throw new Error("Audit request budget exceeded.");
  const response = await networkFetch(input, init);
  const body = (await response.text()).replaceAll(process.env.FMP_API_KEY ?? "unused-secret-placeholder", "[redacted]");
  const headers = { "Content-Type": response.headers.get("Content-Type") ?? "application/json" };
  captures[key] = { status: response.status, body, headers };
  return new Response(body, { status: response.status, headers });
};
const rows: Record<string, unknown>[] = [];
for (const ticker of tickers) {
  try {
    const payload = await buildModelPayload(ticker);
    const result = calculateDcf(payload);
    const annual = payload.historicals.annual.at(-1)!;
    const first = result.projections[0];
    // Independent arithmetic, not the production helper, for the generated case.
    let independentPv = 0;
    for (const p of result.projections) {
      const fcff = p.ebit - Math.max(0, p.ebit * payload.assumptions.operatingTaxRate[result.projections.indexOf(p)].value!)
        + p.depreciationAmortization - p.capitalExpenditures - p.changeInNetWorkingCapital
        + (payload.assumptions.stockCompensationAddBack ? p.stockBasedCompensation : 0);
      independentPv += fcff * p.stubFraction / (1 + result.wacc!) ** p.discountPeriod;
    }
    const end = result.projections.at(-1);
    const independentTv = end ? end.nopat * (1 + payload.assumptions.terminalGrowth.value!)
      * (1 - payload.assumptions.terminalGrowth.value! / payload.assumptions.terminalRoic.value!)
      / (result.wacc! - payload.assumptions.terminalGrowth.value!) / (1 + result.wacc!) ** result.terminalDiscountPeriod! : 0;
    const independentPrice = (independentPv + independentTv + result.bridgeAdjustments!) / result.fullyDilutedShares!;
    const row = {
      ticker, status: result.ready ? "calculated" : "blocked", eligible: payload.identity.valuationMethodEligible,
      annualEnd: annual.period.endDate, interimEnd: payload.historicals.latestInterim?.period.endDate,
      firstForecastEnd: first?.endDate, consensusDate: payload.assumptions.revenueGrowth[0].provenance.asOf,
      annualRevenue: annual.revenue.value, annualEbit: annual.ebit.value,
      cashDate: payload.bridge.cash.provenance.asOf, cash: payload.bridge.cash.value, debt: payload.bridge.debt.value,
      firstRevenue: first?.revenue, capexRatio: payload.assumptions.capitalExpendituresPctRevenue[0].value,
      lastCapexRatio: annual.capitalExpenditures.value! / annual.revenue.value!,
      wacc: result.wacc, price: result.impliedSharePriceGordon, terminalShare: result.terminalValuePctEnterpriseValue,
      mathDifference: result.ready ? Math.abs(independentPrice - result.impliedSharePriceGordon!) : null,
      errors: result.errors, warnings: result.warnings,
    };
    rows.push(row);
    await writeFile(`${directory}/${ticker}-${phase}.json`, JSON.stringify({ payload, result }, null, 2));
    console.log(JSON.stringify(row));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const row = { ticker, status: message.startsWith("Unsupported") ? "unsupported-method" : "source-unavailable", error: message };
    rows.push(row); console.log(JSON.stringify(row));
  }
  await writeFile(`${directory}/responses.json`, JSON.stringify(captures));
}
let priorRows: Record<string, unknown>[] = [];
try { priorRows = JSON.parse(await readFile(`${directory}/${phase}.json`, "utf8")); } catch { /* First phase run. */ }
await writeFile(`${directory}/${phase}.json`, JSON.stringify([...priorRows.filter((row) => !tickers.includes(String(row.ticker))), ...rows], null, 2));
console.log(JSON.stringify({ tested: rows.length, networkCalls, replay }));

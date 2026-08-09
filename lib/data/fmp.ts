import { covarianceBeta, median } from "../model/math";
import type { MarketInputs, PeerBeta, TaggedValue } from "../model/types";

const FMP_BASE = "https://financialmodelingprep.com/stable";
const CACHE_TTL = 30 * 60 * 1000;
const memoryCache = new Map<string, { expires: number; value: unknown }>();

function missing(label: string, units: string, notes: string): TaggedValue {
  return { value: null, provenance: { origin: "missing", label, units, notes } };
}

function sourced(
  value: number | null,
  label: string,
  units: string,
  path: string,
  asOf: string,
  notes?: string,
): TaggedValue {
  if (value === null || !Number.isFinite(value)) {
    return missing(label, units, `FMP returned no usable value. ${notes ?? ""}`.trim());
  }
  return {
    value,
    provenance: {
      origin: "sourced",
      label,
      units,
      sourceUrl: `${FMP_BASE}${path}`,
      asOf,
      notes,
    },
  };
}

export async function fetchFmp<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) throw new Error("FMP_API_KEY is not configured.");
  const query = new URLSearchParams(params);
  const cacheKey = `${path}?${query.toString()}`;
  const cached = memoryCache.get(cacheKey);
  if (cached && cached.expires > Date.now()) return cached.value as T;
  query.set("apikey", apiKey);
  const response = await fetch(`${FMP_BASE}${path}?${query.toString()}`, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`FMP request failed (${response.status}) for ${path}`);
  const value = await response.json() as T;
  memoryCache.set(cacheKey, { expires: Date.now() + CACHE_TTL, value });
  return value;
}

export function marketInputsUnavailable(reason: string): MarketInputs {
  return {
    currentPrice: missing("Current market price", "$ / share", reason),
    fiftyTwoWeekLow: missing("52-week low", "$ / share", reason),
    fiftyTwoWeekHigh: missing("52-week high", "$ / share", reason),
    riskFreeRate: missing("10-year U.S. Treasury rate", "%", reason),
    equityRiskPremium: missing("U.S. equity risk premium", "%", reason),
    terminalGdpGrowth: missing("Long-run nominal GDP growth", "%", reason),
    peerExitMultiple: missing("Peer median EV/EBITDA", "x", reason),
    releveredBeta: missing("Relevered peer beta", "x", reason),
    preTaxCostOfDebt: missing("Pre-tax cost of debt", "%", "Derived from historical interest expense when available."),
    targetDebtWeight: missing("Target debt weight", "%", reason),
    targetEquityWeight: missing("Target equity weight", "%", reason),
    peerBetas: [],
  };
}

function arrayPayload<T>(payload: unknown): T[] {
  if (Array.isArray(payload)) return payload as T[];
  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    for (const key of ["historical", "data", "results", "peersList"]) {
      if (Array.isArray(record[key])) return record[key] as T[];
    }
  }
  return [];
}

function numeric(record: Record<string, unknown> | undefined, keys: string[]): number | null {
  if (!record) return null;
  for (const key of keys) {
    const candidate = Number(record[key]);
    if (Number.isFinite(candidate)) return candidate;
  }
  return null;
}

type PricePoint = { date: string; close: number };

function weeklyReturns(points: PricePoint[]): Map<string, number> {
  const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date));
  const weekly = new Map<string, PricePoint>();
  for (const point of sorted) {
    const date = new Date(`${point.date}T00:00:00Z`);
    const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
    const dayOfYear = Math.floor((date.getTime() - Date.UTC(date.getUTCFullYear(), 0, 1)) / 86_400_000) + 1;
    const week = Math.ceil((dayOfYear + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
    weekly.set(`${date.getUTCFullYear()}-${String(week).padStart(2, "0")}`, point);
  }
  const entries = [...weekly.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const returns = new Map<string, number>();
  for (let index = 1; index < entries.length; index += 1) {
    const prior = entries[index - 1][1].close;
    const current = entries[index][1].close;
    if (prior > 0 && current > 0) returns.set(entries[index][0], current / prior - 1);
  }
  return returns;
}

async function priceHistory(symbol: string, from: string, to: string): Promise<PricePoint[]> {
  const payload = await fetchFmp<unknown>("/historical-price-eod/dividend-adjusted", { symbol, from, to });
  return arrayPayload<Record<string, unknown>>(payload)
    .map((record) => ({
      date: String(record.date ?? ""),
      close: numeric(record, ["adjClose", "adjustedClose", "close"]) ?? Number.NaN,
    }))
    .filter((point) => point.date && Number.isFinite(point.close));
}

function alignedBeta(asset: Map<string, number>, market: Map<string, number>): number | null {
  const dates = [...asset.keys()].filter((date) => market.has(date)).sort();
  return covarianceBeta(
    dates.map((date) => asset.get(date)!),
    dates.map((date) => market.get(date)!),
  );
}

async function peerFundamentals(symbol: string): Promise<{
  name: string;
  debtToEquity: number | null;
  taxRate: number | null;
  exitMultiple: number | null;
}> {
  const [quotePayload, balancePayload, incomePayload, metricsPayload] = await Promise.all([
    fetchFmp<unknown>("/quote", { symbol }),
    fetchFmp<unknown>("/balance-sheet-statement", { symbol, limit: "1", period: "annual" }),
    fetchFmp<unknown>("/income-statement", { symbol, limit: "1", period: "annual" }),
    fetchFmp<unknown>("/key-metrics-ttm", { symbol }),
  ]);
  const quote = arrayPayload<Record<string, unknown>>(quotePayload)[0];
  const balance = arrayPayload<Record<string, unknown>>(balancePayload)[0];
  const income = arrayPayload<Record<string, unknown>>(incomePayload)[0];
  const metrics = arrayPayload<Record<string, unknown>>(metricsPayload)[0];
  const marketCap = numeric(quote, ["marketCap"]);
  const debt = numeric(balance, ["totalDebt", "shortTermDebt", "longTermDebt"]);
  const taxExpense = numeric(income, ["incomeTaxExpense"]);
  const pretaxIncome = numeric(income, ["incomeBeforeTax", "incomeBeforeTaxAndMinorityInterest"]);
  return {
    name: String(quote?.name ?? symbol),
    debtToEquity: marketCap && marketCap > 0 && debt !== null ? debt / marketCap : null,
    taxRate: pretaxIncome && pretaxIncome > 0 && taxExpense !== null ? taxExpense / pretaxIncome : null,
    exitMultiple: numeric(metrics, ["enterpriseValueOverEBITDA", "evToEBITDA"]),
  };
}

function peerSymbols(payload: unknown, subject: string): string[] {
  const values: string[] = [];
  if (Array.isArray(payload)) {
    for (const item of payload) {
      if (typeof item === "string") values.push(item);
      else if (item && typeof item === "object") {
        const record = item as Record<string, unknown>;
        if (typeof record.symbol === "string") values.push(record.symbol);
        if (Array.isArray(record.peersList)) values.push(...record.peersList.filter((value): value is string => typeof value === "string"));
      }
    }
  }
  return [...new Set(values.map((value) => value.toUpperCase()))]
    .filter((value) => value !== subject && /^[A-Z][A-Z0-9.-]{0,9}$/.test(value))
    .slice(0, 5);
}

function gdpCagr(payload: unknown): { value: number | null; asOf: string } {
  const points = arrayPayload<Record<string, unknown>>(payload)
    .map((record) => ({ date: String(record.date ?? ""), value: numeric(record, ["value"]) }))
    .filter((point): point is { date: string; value: number } => Boolean(point.date) && point.value !== null)
    .sort((a, b) => a.date.localeCompare(b.date));
  const latest = points.at(-1);
  if (!latest) return { value: null, asOf: "" };
  const target = new Date(`${latest.date}T00:00:00Z`);
  target.setUTCFullYear(target.getUTCFullYear() - 10);
  const prior = [...points].reverse().find((point) => point.date <= target.toISOString().slice(0, 10));
  if (!prior || prior.value <= 0 || latest.value <= 0) return { value: null, asOf: latest.date };
  const years = (new Date(latest.date).getTime() - new Date(prior.date).getTime()) / (365.25 * 86_400_000);
  return { value: (latest.value / prior.value) ** (1 / years) - 1, asOf: latest.date };
}

export async function loadFmpMarketInputs(
  ticker: string,
  subjectTaxRate: number | null,
): Promise<MarketInputs> {
  const missingReason = "Configure the server-side FMP_API_KEY or enter and label the input manually.";
  if (!process.env.FMP_API_KEY) return marketInputsUnavailable(missingReason);

  const today = new Date().toISOString().slice(0, 10);
  const fromDate = new Date();
  fromDate.setUTCFullYear(fromDate.getUTCFullYear() - 2);
  const from = fromDate.toISOString().slice(0, 10);
  const [quotePayload, treasuryPayload, premiumPayload, gdpPayload, peersPayload, marketHistory] = await Promise.all([
    fetchFmp<unknown>("/quote", { symbol: ticker }),
    fetchFmp<unknown>("/treasury-rates", { from, to: today }),
    fetchFmp<unknown>("/market-risk-premium", {}),
    fetchFmp<unknown>("/economic-indicators", { name: "GDP", from: "2000-01-01", to: today }),
    fetchFmp<unknown>("/stock-peers", { symbol: ticker }),
    priceHistory("SPY", from, today),
  ]);
  const quote = arrayPayload<Record<string, unknown>>(quotePayload)[0];
  const quoteDate = String(quote?.timestamp ? new Date(Number(quote.timestamp) * 1000).toISOString().slice(0, 10) : today);
  const treasuries = arrayPayload<Record<string, unknown>>(treasuryPayload)
    .sort((a, b) => String(b.date ?? "").localeCompare(String(a.date ?? "")));
  const treasury = treasuries[0];
  const premium = arrayPayload<Record<string, unknown>>(premiumPayload)
    .find((record) => String(record.country ?? "").toLowerCase().includes("united states"));
  const gdp = gdpCagr(gdpPayload);
  const symbols = peerSymbols(peersPayload, ticker);
  const marketReturns = weeklyReturns(marketHistory);

  const peerBetas: PeerBeta[] = [];
  const exitMultiples: number[] = [];
  const debtToEquityValues: number[] = [];
  for (const symbol of symbols) {
    try {
      const [history, fundamentals] = await Promise.all([
        priceHistory(symbol, from, today),
        peerFundamentals(symbol),
      ]);
      const rawBeta = alignedBeta(weeklyReturns(history), marketReturns);
      if (rawBeta === null || fundamentals.debtToEquity === null || fundamentals.taxRate === null) continue;
      const unleveredBeta = rawBeta / (1 + (1 - fundamentals.taxRate) * fundamentals.debtToEquity);
      peerBetas.push({
        ticker: symbol,
        name: fundamentals.name,
        rawBeta,
        debtToEquity: fundamentals.debtToEquity,
        taxRate: fundamentals.taxRate,
        unleveredBeta,
        sourceUrl: `${FMP_BASE}/historical-price-eod/dividend-adjusted?symbol=${symbol}`,
      });
      debtToEquityValues.push(fundamentals.debtToEquity);
      if (fundamentals.exitMultiple !== null && fundamentals.exitMultiple > 0) {
        exitMultiples.push(fundamentals.exitMultiple);
      }
    } catch {
      // A failed peer is excluded; the resulting coverage gap is visible in peerBetas.
    }
  }
  const medianUnlevered = median(peerBetas.map((peer) => peer.unleveredBeta));
  const targetDebtToEquity = median(debtToEquityValues);
  const releveredBeta = medianUnlevered !== null && targetDebtToEquity !== null && subjectTaxRate !== null
    ? medianUnlevered * (1 + (1 - subjectTaxRate) * targetDebtToEquity)
    : null;
  const targetDebtWeight = targetDebtToEquity !== null ? targetDebtToEquity / (1 + targetDebtToEquity) : null;
  const targetEquityWeight = targetDebtWeight !== null ? 1 - targetDebtWeight : null;

  return {
    currentPrice: sourced(numeric(quote, ["price"]), "Current market price", "$ / share", `/quote?symbol=${ticker}`, quoteDate),
    fiftyTwoWeekLow: sourced(numeric(quote, ["yearLow", "yearLow52"]), "52-week low", "$ / share", `/quote?symbol=${ticker}`, quoteDate),
    fiftyTwoWeekHigh: sourced(numeric(quote, ["yearHigh", "yearHigh52"]), "52-week high", "$ / share", `/quote?symbol=${ticker}`, quoteDate),
    riskFreeRate: sourced(
      (numeric(treasury, ["year10", "year10Rate", "tenYear"]) ?? Number.NaN) / 100,
      "10-year U.S. Treasury rate",
      "%",
      "/treasury-rates",
      String(treasury?.date ?? today),
    ),
    equityRiskPremium: sourced(
      (numeric(premium, ["totalEquityRiskPremium", "equityRiskPremium"]) ?? Number.NaN) / 100,
      "U.S. total equity risk premium",
      "%",
      "/market-risk-premium",
      today,
    ),
    terminalGdpGrowth: sourced(gdp.value, "10-year nominal GDP CAGR", "%", "/economic-indicators?name=GDP", gdp.asOf, "Used as the terminal-growth warning benchmark, not as a hidden valuation input."),
    peerExitMultiple: sourced(median(exitMultiples), "Peer median EV/EBITDA", "x", "/key-metrics-ttm", today),
    releveredBeta: sourced(releveredBeta, "Bottom-up peer beta, relevered", "x", "/stock-peers", today, "Two-year weekly betas versus SPY; median asset beta relevered at peer-median market D/E."),
    preTaxCostOfDebt: missing("Pre-tax cost of debt", "%", "Derived from SEC historical interest expense in the model payload."),
    targetDebtWeight: sourced(targetDebtWeight, "Peer-median target debt weight", "%", "/stock-peers", today),
    targetEquityWeight: sourced(targetEquityWeight, "Peer-median target equity weight", "%", "/stock-peers", today),
    peerBetas,
  };
}

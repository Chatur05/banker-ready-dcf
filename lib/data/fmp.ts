import { median } from "../model/math";
import type { AnalystEstimate, MarketInputs, TaggedValue } from "../model/types";

const FMP_BASE = "https://financialmodelingprep.com/stable";
const CACHE_TTL = 30 * 60 * 1000;
const REQUEST_LIMIT_COOLDOWN = 60 * 1000;
const memoryCache = new Map<string, { expires: number; value: unknown }>();
const inFlight = new Map<string, Promise<unknown>>();
const requestLimitCircuit = new Map<string, number>();

function isUsageLimitResponse(status: number, responseText: string): boolean {
  if (status === 429) return true;
  return [
    /\blimit reach(?:ed)?\b/i,
    /\b(?:daily|monthly)\s+(?:api\s+)?(?:call|request|usage|data)\s+limit\b/i,
    /\b(?:api\s+)?(?:call|request|usage|bandwidth)\s+limit\s+(?:has\s+been\s+)?(?:reached|exceeded)\b/i,
    /\b(?:usage|bandwidth)\s+(?:has\s+been\s+)?exceeded\b/i,
    /\btoo many requests\b/i,
    /\brate limit(?: has been)? exceeded\b/i,
  ].some((pattern) => pattern.test(responseText));
}

function isEntitlementResponse(status: number, responseText: string): boolean {
  if (status !== 402 && status !== 403) return false;
  return /(?:not available|not included|premium query parameter).*(?:plan|subscription)|(?:plan|subscription).*(?:not available|not included)/i
    .test(responseText);
}

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

async function requestFmp<T>(path: string, params: Record<string, string>, cacheKey: string): Promise<T> {
  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) throw new Error("FMP_API_KEY is not configured.");
  const circuitUntil = requestLimitCircuit.get(cacheKey) ?? 0;
  if (circuitUntil > Date.now()) {
    const retrySeconds = Math.max(1, Math.ceil((circuitUntil - Date.now()) / 1_000));
    throw new Error(`FMP rate-limited this exact request; retry in ${retrySeconds} seconds.`);
  }
  requestLimitCircuit.delete(cacheKey);
  const query = new URLSearchParams(params);
  query.set("apikey", apiKey);
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(`${FMP_BASE}${path}?${query.toString()}`, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(15_000),
      });
      if (response.ok) {
        const value = await response.json() as T;
        requestLimitCircuit.delete(cacheKey);
        memoryCache.set(cacheKey, { expires: Date.now() + CACHE_TTL, value });
        return value;
      }
      const responseText = await response.text();
      const usageLimited = isUsageLimitResponse(response.status, responseText);
      const entitlementRestricted = isEntitlementResponse(response.status, responseText);
      const safeDetail = responseText.replaceAll(apiKey, "[redacted]").replace(/\s+/g, " ").slice(0, 220);
      const symbol = params.symbol?.toUpperCase();
      lastError = entitlementRestricted
        ? new Error(
            `FMP subscription access denied (${response.status}) for ${path}${symbol ? ` and ${symbol}` : ""}. `
            + "The configured subscription does not include this endpoint/ticker combination; this is not an exhausted daily request allowance.",
          )
        : new Error(`FMP request failed (${response.status}) for ${path}${safeDetail ? `: ${safeDetail}` : ""}`);
      if (usageLimited && attempt === 2) {
        requestLimitCircuit.set(cacheKey, Date.now() + REQUEST_LIMIT_COOLDOWN);
      }
      if (response.status !== 429 && response.status < 500) break;
      if (attempt === 2) break;
      const retryAfter = Number(response.headers.get("Retry-After"));
      const delayMs = Number.isFinite(retryAfter) && retryAfter > 0
        ? Math.min(5_000, retryAfter * 1_000)
        : 750 * (attempt + 1);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("FMP request failed.");
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
    }
  }
  throw lastError ?? new Error(`FMP request failed for ${path}`);
}

export async function fetchFmp<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const query = new URLSearchParams(params);
  const cacheKey = `${path}?${query.toString()}`;
  const cached = memoryCache.get(cacheKey);
  if (cached && cached.expires > Date.now()) return cached.value as T;
  const pending = inFlight.get(cacheKey);
  if (pending) return pending as Promise<T>;
  const request = requestFmp<T>(path, params, cacheKey).finally(() => inFlight.delete(cacheKey));
  inFlight.set(cacheKey, request);
  return request;
}

export function marketInputsUnavailable(reason: string): MarketInputs {
  return {
    currentPrice: missing("Current market price", "$ / share", reason),
    currentShares: missing("Current shares outstanding", "mm shares", reason),
    fiftyTwoWeekLow: missing("52-week low", "$ / share", reason),
    fiftyTwoWeekHigh: missing("52-week high", "$ / share", reason),
    riskFreeRate: missing("10-year U.S. Treasury rate", "%", reason),
    equityRiskPremium: missing("U.S. equity risk premium", "%", reason),
    terminalGdpGrowth: missing("Long-run nominal GDP growth", "%", reason),
    peerExitMultiple: missing("Peer median EV/EBITDA", "x", reason),
    releveredBeta: missing("Levered beta", "x", reason),
    preTaxCostOfDebt: missing("Pre-tax cost of debt", "%", "Derived from historical interest expense when available."),
    targetDebtWeight: missing("Target debt weight", "%", reason),
    targetEquityWeight: missing("Target equity weight", "%", reason),
    peerBetas: [],
    analystEstimates: [],
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

async function peerExitMultiple(symbol: string): Promise<number | null> {
  const payload = await fetchFmp<unknown>("/key-metrics-ttm", { symbol });
  const metrics = arrayPayload<Record<string, unknown>>(payload)[0];
  return numeric(metrics, ["enterpriseValueOverEBITDA", "evToEBITDA"]);
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
    .slice(0, 4);
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

export async function loadFmpMarketInputs(ticker: string): Promise<MarketInputs> {
  const missingReason = "Configure the server-side FMP_API_KEY or enter and label the input manually.";
  if (!process.env.FMP_API_KEY) return marketInputsUnavailable(missingReason);

  const today = new Date().toISOString().slice(0, 10);
  const fromDate = new Date();
  fromDate.setUTCFullYear(fromDate.getUTCFullYear() - 2);
  const from = fromDate.toISOString().slice(0, 10);
  const optional = <T>(request: Promise<T>, fallback: T) => request.catch(() => fallback);
  const [quotePayload, profilePayload, treasuryPayload, premiumPayload, gdpPayload, peersPayload, estimatesPayload] = await Promise.all([
    optional(fetchFmp<unknown>("/quote", { symbol: ticker }), []),
    optional(fetchFmp<unknown>("/profile", { symbol: ticker }), []),
    optional(fetchFmp<unknown>("/treasury-rates", { from, to: today }), []),
    optional(fetchFmp<unknown>("/market-risk-premium", {}), []),
    optional(fetchFmp<unknown>("/economic-indicators", { name: "GDP", from: "2000-01-01", to: today }), []),
    optional(fetchFmp<unknown>("/stock-peers", { symbol: ticker }), []),
    optional(fetchFmp<unknown>("/analyst-estimates", { symbol: ticker, period: "annual", page: "0", limit: "10" }), []),
  ]);
  const quote = arrayPayload<Record<string, unknown>>(quotePayload)[0];
  const profile = arrayPayload<Record<string, unknown>>(profilePayload)[0];
  const quoteDate = String(quote?.timestamp ? new Date(Number(quote.timestamp) * 1000).toISOString().slice(0, 10) : today);
  const treasuries = arrayPayload<Record<string, unknown>>(treasuryPayload)
    .sort((a, b) => String(b.date ?? "").localeCompare(String(a.date ?? "")));
  const treasury = treasuries[0];
  const premium = arrayPayload<Record<string, unknown>>(premiumPayload)
    .find((record) => String(record.country ?? "").toLowerCase().includes("united states"));
  const gdp = gdpCagr(gdpPayload);
  const symbols = peerSymbols(peersPayload, ticker);
  const exitMultiples: number[] = [];
  for (const symbol of symbols) {
    try {
      const peerMultiple = await peerExitMultiple(symbol);
      if (peerMultiple !== null && peerMultiple > 0 && peerMultiple <= 50) exitMultiples.push(peerMultiple);
    } catch {
      // A failed peer is excluded; the exit-method cross-check remains unavailable rather than circular.
    }
  }
  const quotePrice = numeric(quote, ["price"]);
  const quoteMarketCap = numeric(quote, ["marketCap"]);
  const quoteShares = numeric(quote, ["sharesOutstanding"])
    ?? (quotePrice !== null && quotePrice > 0 && quoteMarketCap !== null ? quoteMarketCap / quotePrice : null);
  const analystEstimates: AnalystEstimate[] = arrayPayload<Record<string, unknown>>(estimatesPayload)
    .map((record) => {
      const revenue = numeric(record, ["revenueAvg"]);
      const ebit = numeric(record, ["ebitAvg"]);
      const analystCount = numeric(record, ["numAnalystsRevenue"]);
      return {
        fiscalDate: String(record.date ?? ""),
        revenue: revenue === null ? Number.NaN : revenue / 1_000_000,
        ebit: ebit === null ? null : ebit / 1_000_000,
        revenueAnalystCount: analystCount,
        sourceUrl: `${FMP_BASE}/analyst-estimates?symbol=${ticker}&period=annual`,
      };
    })
    .filter((estimate) => estimate.fiscalDate && Number.isFinite(estimate.revenue) && estimate.revenue > 0)
    .sort((a, b) => a.fiscalDate.localeCompare(b.fiscalDate));

  return {
    currentPrice: sourced(quotePrice, "Current market price", "$ / share", `/quote?symbol=${ticker}`, quoteDate),
    currentShares: sourced(
      (quoteShares ?? Number.NaN) / 1_000_000,
      "Current shares outstanding",
      "mm shares",
      `/quote?symbol=${ticker}`,
      quoteDate,
      "Latest quote shares outstanding, or market capitalization divided by price when the direct field is unavailable.",
    ),
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
    releveredBeta: sourced(numeric(profile, ["beta"]), "Reported levered beta", "x", `/profile?symbol=${ticker}`, today, "FMP subject-company beta; editable and surfaced for review rather than reconstructed through high-volume peer price requests."),
    preTaxCostOfDebt: missing("Pre-tax cost of debt", "%", "Derived from SEC historical interest expense in the model payload."),
    targetDebtWeight: missing("Target debt weight", "%", "Derived from current debt and equity market value when a peer-capitalization set is unavailable."),
    targetEquityWeight: missing("Target equity weight", "%", "Derived as the residual capital weight after debt and preferred equity."),
    peerBetas: [],
    analystEstimates,
  };
}

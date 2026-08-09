export function median(values: Array<number | null | undefined>): number | null {
  const clean = values.filter((value): value is number => Number.isFinite(value));
  if (!clean.length) return null;
  const sorted = [...clean].sort((a, b) => a - b);
  const midpoint = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[midpoint]
    : (sorted[midpoint - 1] + sorted[midpoint]) / 2;
}

export function yearFraction(startIso: string, endIso: string): number {
  const start = new Date(`${startIso}T00:00:00Z`);
  const end = new Date(`${endIso}T00:00:00Z`);
  return Math.max(0, (end.getTime() - start.getTime()) / (365.25 * 86_400_000));
}

export function addFiscalYears(endIso: string, years: number): string {
  const date = new Date(`${endIso}T00:00:00Z`);
  date.setUTCFullYear(date.getUTCFullYear() + years);
  return date.toISOString().slice(0, 10);
}

export function covarianceBeta(asset: number[], market: number[]): number | null {
  if (asset.length !== market.length || asset.length < 20) return null;
  const assetMean = asset.reduce((sum, value) => sum + value, 0) / asset.length;
  const marketMean = market.reduce((sum, value) => sum + value, 0) / market.length;
  let covariance = 0;
  let variance = 0;
  for (let index = 0; index < asset.length; index += 1) {
    covariance += (asset[index] - assetMean) * (market[index] - marketMean);
    variance += (market[index] - marketMean) ** 2;
  }
  return variance === 0 ? null : covariance / variance;
}

export function bisection(
  fn: (value: number) => number,
  low: number,
  high: number,
  iterations = 100,
): number | null {
  let lowValue = fn(low);
  let highValue = fn(high);
  if (!Number.isFinite(lowValue) || !Number.isFinite(highValue) || lowValue * highValue > 0) {
    return null;
  }
  let left = low;
  let right = high;
  for (let index = 0; index < iterations; index += 1) {
    const midpoint = (left + right) / 2;
    const midpointValue = fn(midpoint);
    if (!Number.isFinite(midpointValue)) return null;
    if (Math.abs(midpointValue) < 1e-10) return midpoint;
    if (lowValue * midpointValue <= 0) {
      right = midpoint;
      highValue = midpointValue;
    } else {
      left = midpoint;
      lowValue = midpointValue;
    }
  }
  return (left + right) / 2;
}

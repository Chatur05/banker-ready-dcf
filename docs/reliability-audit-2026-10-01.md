# DCF generator reliability audit

Audit performed October 1, 2026 (Chicago), using an October 2 UTC valuation date. Results below are software-test outputs, not price targets or recommendations.

## Bottom line

The previous version's arithmetic could tie while economically important inputs were wrong. It was not reliable enough to treat an automatically generated share price as an investment conclusion. The revised version is a more defensible, editable **first-pass FCFF model for supported operating companies**, with explicit refusals when the method or default cash-flow path is unsuitable.

This was a targeted end-to-end audit of a 12-company sample, provider parsing, forecasting, valuation arithmetic, input validation, browser behavior and exports. It is not statistical proof of valuation accuracy, a complete filing-by-filing audit, a penetration test or an exhaustive test of every listed company. Agreement with today's stock price is not a test of intrinsic-value accuracy.

## Company sample

Identical recorded provider responses were replayed after repairs so data changes do not explain the comparison. Live collection used 156 provider requests; completing the Lilly capture used two further requests. Browser smoke tests were separate. Raw responses remain local and ignored by Git; no API credentials are included.

| Company | Previous output / share | Revised automatic case | Main finding |
| --- | ---: | --- | --- |
| Apple (AAPL) | $125.45 | $136.72, review required | FY2026 consensus was labeled FY2027. An explicitly estimated FY2026 opening base now precedes correctly dated FY2027 growth. Bridge updated to June 2026. |
| Microsoft (MSFT) | $337.57 | $297.21, review required | Median capex intensity of 18.1% obscured the latest 34.9%. Terminal value still supplies 86.8% of EV and the terminal cash-flow transition requires review. |
| NVIDIA (NVDA) | $153.22 | $158.25, review required | Valid 89.6% near-term consensus growth was rejected by a 40% cutoff. Fallback interpolation could extrapolate in the wrong direction. Both repaired; high growth remains flagged. |
| Amazon (AMZN) | $66.31 | No headline price with the default case | The latest capex intensity leaves final-year FCFF negative under the generic margin/ D&A assumptions. A supported investment normalization or longer transition is required. This does not mean Amazon cannot be valued by DCF. |
| Tesla (TSLA) | $24.08 | $21.23, review required | Newer balance sheet and revised normalization. Terminal cash flow changes materially from year five; this is not a bespoke autonomy/robotics valuation. |
| Coca-Cola (KO) | $52.25 | $52.48, review required | Updated bridge and capex; terminal value remains 76.6% of EV. Demonstrates NYSE coverage is available for some tickers under this key. |
| Exxon Mobil (XOM) | $188.86 | $182.95, review required | Updated capex and bridge. Terminal value is 81.4% of EV; the model does not substitute for a commodity-price/reserve-based scenario analysis. |
| Ford (F) | $5.95 | Unsupported consolidated method | Industrial operations and Ford Credit need separate treatment. Consolidated finance debt must not be mixed with an industrial-only enterprise valuation. |
| Rivian (RIVN) | Blocked, but leaked a negative $177.17 value | Blocked, no displayed/exportable price | Requires a supported profitability and reinvestment path. Negative or invalid results no longer leak through the headline fields. |
| JPMorgan (JPM) | Blocked, but retained a $1,140.75 value internally | Unsupported method, no price | Banks require equity-based/sector-specific valuation, not this consolidated unlevered FCFF model. |
| Realty Income (O) | Provider restriction | Unsupported REIT method | Eligibility is checked from the company profile before fetching statements. |
| Eli Lilly (LLY) | Provider restriction | Provider restriction, no price | Confirmed FMP HTTP 402 for this endpoint/ticker. This is subscription access, not exhausted daily usage, and not proof that FMP lacks NYSE stocks. |

The 12-company sample produced **6 editable automatic cases, 2 forecast-blocked cases, 3 method exclusions and 1 subscription-access failure**. A lower completion rate is intentional where the previous version supplied an unsuitable or unsupported value.

## Repairs

### Source integrity

- Provider `null`, empty strings and booleans are no longer interpreted as reported zeros.
- Missing core revenue, EBIT, D&A, capex, cash or funded-debt components stop statement loading. Annual income, balance-sheet and cash-flow dates must match.
- USD statement currency is required. Foreign-currency/ADR cases stop until a currency and share-ratio schedule is available.
- Annual observations are deduplicated, future-dated observations excluded, correct filing-date fields preserved, and a CIK is no longer misrepresented as an accession number.
- Tax benefits retain their negative sign.
- Current-liability residual normalization includes separately classified accruals and other payables, excluding funded current debt and separately reported current leases. Tax/lease classification still requires review.
- Latest available interim balance-sheet fields and share dilution are preferred; unavailable interim fields fall back transparently to annual data. Annual Q4 is not labeled an incremental interim observation.
- Provider URLs are labeled as provider statements, not independently verified SEC filings. SEC extraction no longer substitutes arbitrary currency units or a mismatched reporting duration.

### Forecast and valuation

- Consensus is matched to fiscal dates (14-day tolerance for fiscal-calendar differences), not merely array position. At least three revenue analysts are required for automatic consensus use.
- An elapsed, unreported fiscal year is rolled forward as a separate **estimated opening base**, keeping reported history unchanged. Date edits crossing that base's fiscal year require refreshed inputs.
- Growth fallback is bounded and updates its revenue denominator consistently. Near-term growth above 40% is flagged, not automatically discarded.
- Capex starts at the higher of latest reported intensity and the five-year median. This is a disclosed conservative assumption, not a forecast of management's spending plan.
- Terminal NOPAT and explicit final-year FCFF must be positive. Material jumps into terminal cash flow and high terminal-value dependence are flagged.
- Invalid horizons/dates, missing inputs, invalid capital weights, negative bridge claims, nonpositive equity and inappropriate issuer methods suppress headline valuations. Exports recalculate and independently enforce the block.

### Exports and operational handling

- Excel uses the same estimated opening base as the app. Equity weight is a residual formula; SBC add-back is an editable control.
- Excel cover metrics, WACC/growth sensitivity axes and terminal ROIC references update with assumptions. Invalid terminal and operating inputs are exposed rather than turned into plausible zeros.
- Checks include live output/weight/terminal tests. The workbook remains an editable model, not a protected input-validation application; use the app's complete validation before circulation.
- PDF review notes paginate without dropping text. Model warnings are included in both exports.
- HTTP-200 provider error payloads are rejected, long Retry-After instructions respected, and caches/cooldowns isolated by credential and exact request. Entitlement errors do not poison other tickers.

## Verification

- 21 valuation/provider/export regression tests, including an Apple filing-based FCFF arithmetic reconciliation, plus two built-server route/render tests.
- For all six calculable cases, separately reconstructed FCFF, discounting, terminal value and equity bridge matched the engine's per-share result within floating-point precision.
- Four exported workbooks (AAPL, MSFT, NVDA and KO) were imported into a separate spreadsheet calculation engine. ROIC, debt weight and terminal growth changes matched the app; the sensitivity center tied; invalid growth returned unavailable. Native Microsoft Excel was not exercised during this audit.
- Apple workbook historical opening-base, sensitivity and check views, and PDF review-queue pages were rendered and visually inspected. The PDF contains four pages with complete review notes.
- Browser smoke testing confirmed Apple's automatic result and an invalid terminal-growth edit that removes the share price and disables both export actions.
- Production build, TypeScript and lint checks pass. The complete test suite passes (23 tests). The final dependency audit reports zero known vulnerabilities after compatible updates to the export/build dependencies and an image-parser patch. This is not a guarantee against unknown vulnerabilities.

## Remaining limitations and next priorities

1. **Interim cash flow is time-weighted, not an actual YTD-to-remaining-year bridge.** This is particularly important for seasonal issuers and short stubs. Build quarterly/YTD normalization before calling the output transaction-ready.
2. **Generic margins, capex, tax rates and terminal ROIC require judgment.** A technology investment cycle, early-stage loss maker or commodity producer cannot be understood from historical medians alone. Do not force an initial price merely to increase the completion rate.
3. **Bridge classifications remain material.** Review operating cash, finance versus operating leases, non-operating investments, pension/other debt-like claims and dilution. A standardized provider zero is not proof that an omitted obligation does not exist.
4. **Coverage and resilience are not solved by more daily quota.** SEC access remains blocked in this environment; FMP access differs by endpoint/ticker. A production service should maintain dated, validated snapshots, last-known-good fallback with explicit freshness, and provider-independent adapters. The SEC architecture was deliberately not redesigned in this pass.
5. **No bottom-up peer beta, capital structure optimization, standalone segment model, NOL schedule, future award-dilution schedule or supported peer transaction database is invented.** Missing cross-checks remain unavailable.
6. **Reinvestment and terminal value dominate many cases.** Microsoft, Coca-Cola and Exxon require especially careful terminal review. Show scenario ranges, not just a single headline figure.
7. **Public deployment and data licensing require owner review.** Confirm the provider subscription allows the intended audience and redistribution; this audit does not establish contractual rights.

## Primary references consulted

- [Apple FY2025 Form 10-K](https://www.sec.gov/Archives/edgar/data/320193/000032019325000079/aapl-20250927.htm): historical FCFF test inputs.
- [Microsoft FY2026 Q4 results](https://www.microsoft.com/en-us/investor/earnings/fy-2026-q4/press-release-webcast): annual revenue, operating income and cash capital expenditure comparison.
- [Ford FY2025 Form 10-K](https://www.sec.gov/Archives/edgar/data/37996/000003799626000015/f-20251231.htm): industrial versus Ford Credit financing/debt distinction.
- [Damodaran: terminal-value approaches](https://pages.stern.nyu.edu/~adamodar/New_Home_Page/valquestions/termvalapproaches.htm) and [stable growth](https://pages.stern.nyu.edu/~adamodar/New_Home_Page/valquestions/stablegrowthrate.htm): stable-state growth, return and reinvestment consistency.
- [Image parser advisory](https://github.com/advisories/GHSA-5p2g-fcmc-qvqq) and [Sharp/libheif advisory](https://github.com/advisories/GHSA-rgj7-g3m4-5g8c): dependency-patch review.

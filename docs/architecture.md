# DCF Engine Architecture Decision

Decision date: 2026-08-09

## Decision

Use a hybrid, provenance-first data architecture:

- SEC EDGAR `submissions` and `companyfacts` APIs are the source of truth for historical fundamentals and filing metadata.
- Direct filing documents remain the authoritative review source for disclosures that are not reliably standardized in Company Facts, including options, RSUs, lease details, preferred stock, NCI, and non-operating investments. Missing optional detail receives a conservative, explicitly labeled review default so the preliminary valuation can still calculate.
- If the SEC data host is unreachable, the server may use FMP standardized filing statements as a flagged fallback. The audit trail retains the linked filing and warns the reviewer to reconcile material values before relying on the output.
- Financial Modeling Prep (FMP) Stable API supplies standardized filing fallback data, analyst estimates, current prices and shares, peer suggestions, Treasury rates, and market risk premium. The key is held server-side as `FMP_API_KEY`; it is never exposed to the browser or workbook.
- Every value is represented as sourced, derived, review-assumed, user-entered, or missing and carries a source URL, as-of/filing date, fiscal period, units, and review/gap status.
- The automatic case follows a fixed hierarchy: user override, sourced filing/market value, derived value, then labeled house default. Only eligibility, minimum-history, share-count, and mathematical-integrity failures block the preliminary Gordon value.

## Architecture fork

### 1. Licensed/keyed financial-data API for everything

Coverage: Broad standardized statements, quotes, historical prices, peer lists, and market data. Vendor-normalized statements usually cover five or more years and handle fiscal calendars, but detailed securities, leases, NCI, equity-method investments, and custom filing tags can be incomplete or normalized in ways that are difficult to audit back to the filing.

Depth and fiscal handling: Plan-dependent. FMP currently advertises five years on Starter and 30+ years on Premium, with annual and quarterly statement endpoints.

Rate limits and cost: API key required. FMP currently advertises a free 250-call/day plan and paid tiers with higher limits and deeper history. Display or redistribution can require an additional license.

Reviewer credentials: A deployed app can use a server-side key so reviewers need none, but local reviewers would need the project owner's configured secret.

Why rejected as the primary source: It weakens filing-level traceability and creates vendor normalization risk precisely where a banker will click through the model.

### 2. Direct SEC EDGAR XBRL only

Coverage: Strongest possible provenance for U.S. public-company fundamentals. `companyfacts` and `submissions` require no key and update throughout the day. Company Facts can provide long histories and exact filing/period metadata.

Depth and fiscal handling: Excellent, but the application must resolve annual versus quarterly contexts, amended filings, company-specific extensions, unit variants, and non-calendar fiscal years. Options/RSUs and some bridge items often require filing-document parsing or manual input.

Rate limits and cost: Free and credentialless. SEC fair-access guidance caps automated access at ten requests per second and requires responsible identification.

Reviewer credentials: None.

Why rejected as the sole source: SEC data does not provide live share prices, total-return histories for beta, Treasury curves, ERP, or a market peer set. It cannot independently produce a first-principles market-value WACC.

### 3. Hybrid filing fundamentals plus licensed market and consensus data — selected

Coverage: SEC retains filing-grade provenance when accessible, with FMP standardized statements as a disclosed fallback. FMP also supplies analyst consensus, the subject-company levered beta, current price and shares, macro inputs, and a bounded peer-multiple cross-check. The levered beta is editable and reviewable; a bespoke bottom-up beta can replace it without changing the model architecture.

Depth and fiscal handling: SEC provides the historical depth and fiscal-period fidelity. FMP provides price history, quote, peers, Treasury, and ERP endpoints through its supported Stable API.

Rate limits and cost: Requests are cached, coalesced, and bounded. Optional FMP endpoints degrade to review defaults independently. Transient rate-limit or server failures receive bounded retry. A repeated HTTP 429 opens a one-minute circuit only for the exact failed request; an endpoint-level plan entitlement restriction never blocks the filing endpoints or a different ticker.

Reviewer credentials: Reviewers of the deployed application need no credentials because the key remains server-side. If a market endpoint is unavailable, the app uses a visible house default and omits only source-dependent comparisons such as market upside/downside.

Why selected: It preserves filing-level auditability while producing a useful first-pass valuation without manual data entry. Missing information creates a visible review item; it never silently becomes a sourced fact.

## Confirmed stack

- TypeScript and React using the Sites/vinext starter for Cloudflare Worker-compatible deployment.
- Server-side data adapters for SEC and FMP with explicit schemas, timeouts, caching, and structured error states.
- A pure TypeScript valuation engine shared by the UI, tests, and exports.
- Runtime genuine `.xlsx` export with typed cells and live cross-sheet formulas linking Cover, Assumptions, Historicals, Projection Model, WACC, Sensitivities, Valuation Summary, Sources/Audit, and Checks.
- A three-page PDF review pack rendered from the same typed valuation result, including the per-share conclusion, FCFF build, bridge, critical checks, and complete review queue.

## Current primary documentation checked

- SEC EDGAR APIs: https://www.sec.gov/search-filings/edgar-application-programming-interfaces
- SEC developer/fair-access guidance: https://www.sec.gov/about/developer-resources
- SEC ticker-to-CIK file: https://www.sec.gov/file/company-tickers
- FMP Stable API: https://site.financialmodelingprep.com/developer/docs/stable
- FMP quickstart and errors: https://site.financialmodelingprep.com/developer/docs/quickstart
- FMP pricing and limits: https://site.financialmodelingprep.com/developer/docs/pricing/

## Non-negotiable failure behavior

- No hidden WACC or terminal-value assumption; house defaults are labeled, editable, and exported to the audit trail.
- No valuation when `WACC <= terminal growth`.
- No valuation without at least three annual periods or a positive common-share count.
- Gordon growth calculates independently of the exit-multiple cross-check.
- The subject company's own trading multiple is never used as its terminal exit assumption. The exit case requires a defensible peer median or explicit user input.
- Historical interest / average debt is floored at risk-free plus a transparent 150 bps review spread when it would imply an implausibly low marginal borrowing cost.
- Calculation completion and circulation readiness are separate statuses; unresolved judgment and source flags remain visible in every output.
- Missing award-level dilution uses the latest reported diluted/basic share relationship; detailed awards replace the proxy when available.
- Operating lease liabilities are not subtracted in an unadjusted-FCFF case. Lease debt is included only when the operating forecast is adjusted consistently.
- Conservative zero defaults for optional bridge assets or claims are labeled for review and never presented as sourced.
- Financial institutions, insurers, and REITs are refused by the FCFF engine with an explanation.
- Source timestamps and URLs travel with every value into the UI and exports.

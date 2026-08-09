# DCF Engine Architecture Decision

Decision date: 2026-08-09

## Decision

Use a hybrid, provenance-first data architecture:

- SEC EDGAR `submissions` and `companyfacts` APIs are the source of truth for historical fundamentals and filing metadata.
- Direct filing documents remain the authoritative review source for disclosures that are not reliably standardized in Company Facts, including options, RSUs, lease details, preferred stock, NCI, and equity-method investments. Missing standardized facts block the affected output or require an explicitly labeled user input.
- If the SEC data host is unreachable, the server may use FMP standardized filing statements as a flagged fallback. The audit trail retains the linked filing and warns the reviewer to reconcile material values before relying on the output.
- Financial Modeling Prep (FMP) Stable API supplies market-only inputs: current and historical prices, peer suggestions, Treasury rates, and market risk premium. The key is held server-side as `FMP_API_KEY`; it is never exposed to the browser or workbook.
- Every value is represented as sourced, derived, or assumed and carries a source URL, as-of/filing date, fiscal period, units, and confidence/gap status.
- Missing required inputs block the affected valuation output. The app must never substitute synthetic or unlabeled data.

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

### 3. Hybrid SEC fundamentals plus licensed market data — selected

Coverage: SEC retains filing-grade provenance for the operating model and enterprise-to-equity bridge. FMP supplies the market-only data SEC cannot provide. Peer betas are calculated from peer price histories, then unlevered and relevered using market-value capital structures; the vendor's raw beta is never used as the final WACC input.

Depth and fiscal handling: SEC provides the historical depth and fiscal-period fidelity. FMP provides price history, quote, peers, Treasury, and ERP endpoints through its supported Stable API.

Rate limits and cost: SEC requests are queued and cached below fair-access limits. FMP requests are cached and bounded; plan limitations surface as data gaps.

Reviewer credentials: Reviewers of the deployed application need no credentials because the key remains server-side. If the deployment is not configured, the app loads filing data but blocks market-dependent valuation outputs and requests the missing inputs.

Why selected: It preserves filing-level auditability while supporting a defensible market-value WACC and live valuation. It also fails safely: a missing source creates a visible gap, never a fabricated number.

## Confirmed stack

- TypeScript and React using the Sites/vinext starter for Cloudflare Worker-compatible deployment.
- Server-side data adapters for SEC and FMP with explicit schemas, timeouts, caching, and structured error states.
- A pure TypeScript valuation engine shared by the UI, tests, and exports.
- Runtime Excel XML export with live cross-sheet formulas linking Assumptions, Historicals, Projection Model, WACC, Sensitivities, Valuation Summary, Sources/Audit, and Checks.
- PDF one-pager rendered from the same typed valuation result so the app, workbook, and PDF cannot drift.

## Current primary documentation checked

- SEC EDGAR APIs: https://www.sec.gov/search-filings/edgar-application-programming-interfaces
- SEC developer/fair-access guidance: https://www.sec.gov/about/developer-resources
- SEC ticker-to-CIK file: https://www.sec.gov/file/company-tickers
- FMP Stable API: https://site.financialmodelingprep.com/developer/docs/stable
- FMP quickstart and errors: https://site.financialmodelingprep.com/developer/docs/quickstart
- FMP pricing and limits: https://site.financialmodelingprep.com/developer/docs/pricing/

## Non-negotiable failure behavior

- No hardcoded WACC or terminal-value assumption.
- No valuation when `WACC <= terminal growth`.
- No valuation when material bridge items or diluted-share inputs are unresolved.
- No silent fallback from missing sourced data to zero.
- Financial institutions, insurers, and REITs are refused by the FCFF engine with an explanation.
- Source timestamps and URLs travel with every value into the UI and exports.

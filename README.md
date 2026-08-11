# Banker Ready DCF

A provenance-first public-equity DCF engine for investment-banking, equity-research, and corporate-development review.

The application retrieves filing fundamentals, blends available analyst consensus with a mature-state forecast, builds a component WACC, calculates an independent Gordon-growth valuation plus an optional reviewed peer-multiple cross-check, resolves the enterprise-to-equity bridge and dilution, renders live sensitivities, and exports an auditable `.xlsx` model plus a PDF review pack.

## Data policy

- SEC filings are the source of truth for company fundamentals.
- `FMP_API_KEY` supplies standardized fallback statements, analyst estimates, current market inputs, and peer cross-check data and is held server-side.
- The automatic case uses sourced inputs first, derived values second, and clearly labeled conservative review defaults last. User edits receive a separate label; review defaults never masquerade as sourced facts.
- Missing optional market or bridge detail does not suppress the primary Gordon value. Eligibility failures, insufficient history, invalid shares, and inconsistent stable-growth mathematics still block output.
- Financial institutions, insurers, and REITs are refused by the FCFF engine.

See [docs/architecture.md](docs/architecture.md) for the evaluated data-source paths and decision record, and [docs/validation.md](docs/validation.md) for the Apple/Microsoft filing tie-outs and explicit unverified items.

## Local setup

1. Copy `.env.example` to `.env.local` and configure `FMP_API_KEY`.
2. Run `npm ci`.
3. Run `npm run dev`.

Without an FMP key, market inputs use visible house defaults where possible. If the runtime also cannot reach the SEC data host, filing retrieval still requires the keyed FMP filing fallback.

## Model flow

`Filing sources → historicals → consensus / mature-state forecast → review defaults → unlevered FCF → WACC → primary Gordon value + optional reviewed exit cross-check → EV-to-equity bridge → diluted per-share value → sensitivities → exports`

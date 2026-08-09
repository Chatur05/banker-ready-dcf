# Banker Ready DCF

A provenance-first public-equity DCF engine for investment-banking, equity-research, and corporate-development review.

The application retrieves filing fundamentals from SEC EDGAR, derives a bottom-up WACC using licensed market inputs, calculates Gordon-growth and exit-multiple terminal values, builds the enterprise-to-equity bridge, performs treasury-stock dilution, renders live sensitivities, and exports an auditable Excel model plus a PDF one-pager.

## Data policy

- SEC filings are the source of truth for company fundamentals.
- `FMP_API_KEY` supplies current/historical market inputs and is held server-side.
- Missing required facts block the affected output. The application does not use placeholder or synthetic financial data.
- Financial institutions, insurers, and REITs are refused by the FCFF engine.

See [docs/architecture.md](docs/architecture.md) for the evaluated data-source paths and decision record, and [docs/validation.md](docs/validation.md) for the Apple/Microsoft filing tie-outs and explicit unverified items.

## Local setup

1. Copy `.env.example` to `.env.local` and configure `FMP_API_KEY`.
2. Run `npm ci`.
3. Run `npm run dev`.

Without an FMP key, market-dependent outputs remain disabled until the user supplies labeled assumptions. If the runtime also cannot reach the SEC data host, the request halts unless the keyed FMP filing fallback is available.

## Model flow

`SEC sources → historicals → editable assumptions → unlevered FCF → WACC → dual terminal methods → EV-to-equity bridge → diluted per-share value → sensitivities → exports`

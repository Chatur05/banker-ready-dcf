# Banker-Ready DCF — Senior Review Audit

## Executive conclusion

The application is a strong automatic **first-pass FCFF valuation**, but it should not call an output circulation-ready merely because the arithmetic calculates. A veteran banker would distinguish three states:

1. **Calculation blocked** — missing or invalid data prevents a valuation.
2. **Calculation complete, review required** — a per-share value exists, but sourced assumptions and bridge judgments remain open.
3. **Reviewed / circulation ready** — every material judgment has been confirmed and the output has been independently checked.

The product should automate the first two states and make the third easy to reach; it cannot honestly automate away issuer-specific judgment.

## Priority 0 — issues capable of producing a misleading answer

| Area | Criticism | Why a senior reviewer cares | Optimal remediation |
| --- | --- | --- | --- |
| Status | The UI can show “PASS” while review defaults remain open. | A mathematical tie-out is not approval to circulate. | Separate calculation integrity from review readiness and show unresolved review count beside every valuation/export. |
| Cost of debt | Historical interest expense / average book debt can fall below the risk-free rate. | WACC needs a current marginal borrowing cost, not a stale effective coupon. | Use a sourced marginal rate when available; otherwise floor the proxy at risk-free plus a transparent default spread and flag it for review. |
| Exit cross-check | The subject company’s current EV / EBITDA can become its own terminal multiple. | This is circular and can simply reproduce market pricing. | Never use the subject’s trading multiple as an automatic terminal assumption. Use a reviewed peer median or leave the exit case unavailable while still displaying the Gordon-implied multiple. |
| Terminal value | Terminal ROIC is inferred from noisy book capital and capped mechanically. | Terminal value often drives most enterprise value; a weak stable-state assumption overwhelms the forecast. | Expose terminal NOPAT, reinvestment, FCFF, discount factor, implied multiple and TV / EV; validate `g / ROIC`; require explicit review. |
| Stub period | The first projected full-year operating build is multiplied by a stub fraction. | This is only an approximation and does not incorporate reported interim actuals. | Label the method clearly, use date-based discounting, and keep it review-required until an LTM / stub bridge is available. |
| Equity bridge | All cash is treated as excess and several debt-like/non-operating items are absent. | Enterprise value to equity value is often where otherwise sound DCFs fail. | Add explicit operating cash, other debt-like liabilities and other non-operating assets; show every sign and subtotal. |
| Dilution | Option dilution may be based on mismatched dates and simplified proxies. | Small per-share errors become material for large option/RSU programs. | Date-stamp shares and awards, apply treasury-stock logic only when valid, include RSUs, and flag proxy dilution. |
| Validation | Growth, margins, tax rates, weights, negative EV and terminal reinvestment are insufficiently bounded. | A model can “calculate” an economically impossible result. | Add hard calculation errors for impossible inputs and review warnings for extreme but possible inputs. |
| Excel | The legacy SpreadsheetML export uses incorrect formats and brittle row references; formulas can diverge after recalculation. | The workbook is the core audit artifact and must survive a senior banker’s formula review. | Generate a genuine `.xlsx` with typed inputs, formulas, checks, sources, sensitivities, consistent formats and cached outputs that tie to the app. |

## Priority 1 — core modelling and reviewability gaps

- The forecast is a top-down operating build, not a fully integrated three-statement model.
- Revenue and EBIT may use consensus, but D&A, capex, working capital and tax remain normalized ratios without operating-driver schedules.
- The latest interim filing is displayed but does not roll annual history to LTM or build an actual stub.
- No debt, tax/NOL, PP&E, lease, share-count or working-capital schedules exist.
- No base / upside / downside cases exist, and no scenario probability framework is available.
- The capital structure uses current market weights rather than an explicit target or mature-state structure.
- Beta is generally a subject-company raw beta rather than a defensible bottom-up peer beta set with inclusion/exclusion review.
- Country, size and other premia default to zero without enough prominence.
- A constant WACC is applied through the forecast and terminal period without a mature-state cross-check.
- Historical operating working capital can include non-operating current assets/liabilities in standardized fallback data.
- Non-operating investments are labeled too narrowly as equity-method investments.
- Lease treatment is not consistently reflected in EBIT, FCFF, WACC and the bridge.
- Stock compensation treatment is explicit but lacks a corresponding future dilution framework.
- No segment, geographic, customer or KPI build supports the forecast.
- No adjusted EBIT bridge identifies restructuring, impairments, acquisition accounting or other non-recurring items.

## Priority 2 — user experience and control gaps

- Forecast outputs are not visible in a reviewable year-by-year FCFF table.
- Years six through ten can be hidden even when selected.
- Capital weights can be edited independently and temporarily fail the 100% check.
- Inputs lack consistent bounds, step sizes and economic labels.
- User edits are not visually distinct from sourced, derived and assumed values.
- There is no one-click reset to the automatic case.
- Review items are informational rather than a resolvable checklist with reviewer notes.
- The valuation range presentation can imply that the 52-week trading range is a valuation methodology.
- Missing-source warnings do not always state the affected valuation output and remediation.
- Model version, calculation timestamp and snapshot identity are not prominent enough for reproducibility.

## Priority 3 — sourcing, reliability, security and governance

- SEC facts need stricter period-context matching to distinguish quarter, YTD and annual contexts.
- Comparative facts can inherit a filing-year label rather than the fiscal year implied by period end.
- Standardized fallback fields require filing reconciliation before use in a live process.
- Market-data request bursts need request coalescing, cache discipline and plan-limit circuit breaking.
- Provider plan-limit failures should not be retried as if they were temporary rate limits.
- Every sourced input should retain provider, endpoint, as-of date, filing date, unit and transformation note.
- Data licensing and redistribution rights must be confirmed before broader distribution.
- Saved snapshots and immutable model versions are needed for deal-team reproducibility.
- The product needs a clear disclaimer that it is decision support, not investment advice or a substitute for filing review.

## Priority 4 — testing and delivery controls

- Add deterministic tests for cost-of-debt floors, invalid terminal reinvestment, negative/zero shares, extreme assumptions and circular exit-multiple prevention.
- Add period-selection tests for SEC duration facts and comparative filing contexts.
- Add formula-level Excel tie-outs and open/recalculate the exported workbook in a real spreadsheet engine.
- Add browser tests covering build, edit, reset, projection-year expansion, warning states and downloads.
- Add production smoke tests using at least a mega-cap, a leveraged issuer, a loss-maker and an ineligible financial institution.
- Run dependency, lint, build and type checks on every change.

## Product boundary retained after remediation

Even after the fixes, the automatic output remains a **review-required first-pass DCF**, not a substitute for a bespoke transaction model. A genuinely circulation-ready model still requires issuer-specific adjustments, peer selection, capital-structure judgment, management/consensus reconciliation, a fully reviewed equity bridge and deal-team approval. The product earns trust by making those remaining judgments explicit rather than hiding them behind a green status.

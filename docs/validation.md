# Validation and Reconciliation Record

Validation date: 2026-08-11

## Status

The calculation engine, production build, invalid-input refusal, and an Apple filing-based hand check are automated. Document-level source mapping was reconciled against Apple FY2025 and Microsoft FY2025 filings.

Live extraction was verified for AAPL and MSFT on 2026-08-09. Direct requests from the app process to the SEC data host still return HTTP 403, so the run used the disclosed FMP filing fallback. The configured FMP statement entitlement permits at most five annual periods; the fallback adapter and regression suite enforce that limit.

The automatic case now calculates a preliminary Gordon-growth per-share value without manual data entry while explicitly separating calculation integrity from circulation readiness. Available analyst consensus drives the first three forecast years and then fades toward mature-state growth and margins. Terminal growth, terminal ROIC, interim/stub integration, lease treatment, operating cash, NOL value, other debt-like claims and dilution fallbacks remain visible review items. The exit-multiple method is an independent peer-based cross-check and can be absent without suppressing the primary intrinsic value; the subject's own trading multiple is never substituted.

The regression suite verifies that Gordon growth completes without an exit multiple or current market price, missing price data uses conservative option dilution without blocking intrinsic value, stock compensation treatment remains explicit, economically impossible forecast/stable-state inputs block calculation, and the Apple operating build still ties to sourced filing arithmetic. A live AAPL automatic case completed on 2026-08-11 with five annual periods, three consensus forecast years, no critical model errors, a 9.45% WACC, and a formula-derived Gordon value of $134.72 per share.

The generated AAPL workbook was opened in Microsoft Excel for Microsoft 365, fully recalculated, scanned across every used cell for formula errors, saved, and rendered to PDF. All nine worksheets opened successfully; `Valuation Summary!B44` retained the live formula `=B37/B43`, recalculated to $134.716606562716, and exactly matched the application result. No `#REF!`, `#VALUE!`, `#DIV/0!`, `#NAME?`, `#N/A`, `#NUM!`, or `#NULL!` values were found. The standalone PDF review pack and the Excel print rendering were rendered to PNG and visually inspected for clipping, overlap, alignment, legibility, page hierarchy, and footer consistency.

## Apple FY2025 filing reconciliation

Primary source: [Apple FY2025 Form 10-K](https://www.sec.gov/Archives/edgar/data/320193/000032019325000079/aapl-20250927.htm). Dollar values are $mm; shares are mm.

| Model line | Filing value | Filing location / treatment | Result |
|---|---:|---|---|
| Revenue | 416,161 | Statement of operations | Tied |
| EBIT | 133,050 | Operating income | Tied |
| D&A | 11,698 | Statement of cash flows | Tied |
| Stock-based compensation | 12,863 | Statement of cash flows / Note 11 | Tied |
| Capital expenditures | 12,715 | Payments for PP&E | Tied; cash outflow stored positive |
| Pre-tax income | 132,729 | Statement of operations | Tied |
| Income-tax expense | 20,719 | Statement of operations | Tied |
| Cash taxes paid | 43,369 | Supplemental cash-flow disclosure | Tied; not substituted for unlevered operating taxes |
| Accounts receivable | 39,777 | Balance sheet | Tied |
| Vendor / non-trade receivables | 33,180 | Balance sheet | Tied; included in normalized other operating current assets |
| Inventory | 5,718 | Balance sheet | Tied |
| Other current assets | 14,585 | Balance sheet | Tied |
| Accounts payable | 69,860 | Balance sheet | Tied |
| Deferred revenue | 9,055 | Balance sheet | Tied |
| Other current liabilities | 66,387 | Balance sheet | Tied; reviewer should inspect embedded tax/lease items |
| Cash | 35,934 | Balance sheet | Tied |
| Short-term investments | 18,763 | Current marketable securities | Tied |
| Funded debt | 98,657 | Commercial paper 7,979 + current term debt 12,350 + non-current term debt 78,328 | Tied; lease liabilities excluded |
| Finance leases | 1,230 | Note 8: current 538 + non-current 692 | Tied |
| Operating leases | 12,490 | Note 8: current 1,579 + non-current 10,911 | Tied |
| Current basic shares | 14,773.260 | Ending common shares outstanding | Tied |
| Weighted-average basic / diluted shares | 14,948.500 / 15,004.697 | Statement of operations | Tied |
| Outstanding RSUs | 151.574 | Note 11 ending balance | Tied |

Apple does not present an outstanding option schedule in the cited note. When award-level options and RSUs are incomplete, the engine uses current shares multiplied by the latest diluted/basic weighted-average share ratio as one combined, labeled dilution proxy. NCI, preferred stock, non-operating investments, and usable NOL value receive conservative review defaults when standardized detail is absent.

## Microsoft FY2025 filing reconciliation

Primary source: [Microsoft FY2025 Annual Report](https://www.microsoft.com/investor/reports/ar25/). Dollar values are $mm; shares are mm.

| Model line | Filing value | Filing location / treatment | Result |
|---|---:|---|---|
| Revenue | 281,724 | Income statement | Tied |
| EBIT | 128,528 | Operating income | Tied |
| D&A | 34,153 | “Depreciation, amortization, and other” in cash flows | Tied to reported line; label qualification retained |
| Stock-based compensation | 11,974 | Cash-flow statement / Note 17 | Tied |
| Capital expenditures | 64,551 | Additions to property and equipment | Tied; cash outflow stored positive |
| Pre-tax income | 123,627 | Income statement | Tied |
| Income-tax expense | 21,795 | Income statement | Tied |
| Cash taxes paid | 28,700 | Note 11, rounded disclosure | Tied to disclosed amount |
| Accounts receivable | 69,905 | Balance sheet | Tied |
| Inventory | 938 | Balance sheet | Tied |
| Other current assets | 25,723 | Balance sheet | Tied |
| Accounts payable | 27,724 | Balance sheet | Tied |
| Short-term unearned revenue | 64,555 | Balance sheet | Tied |
| Other current liabilities | 25,020 | Balance sheet | Tied; current lease balances are disclosed inside this line and require normalization review |
| Cash | 30,242 | Balance sheet | Tied |
| Short-term investments | 64,323 | Balance sheet | Tied |
| Funded debt | 43,151 | Current portion 2,999 + long-term debt 40,152 | Tied |
| Finance leases | 46,172 | Note 14 | Tied; kept separate from funded debt |
| Operating leases | 22,861 | Note 14 | Tied |
| Current shares outstanding | 7,434 | Statement of stockholders’ equity | Tied |
| Weighted-average basic / diluted shares | 7,433 / 7,465 | Income statement | Tied |
| Outstanding stock awards | 82 | Note 17 nonvested ending balance | Tied; classified as RSU/PSU dilution input with note context |

Microsoft’s D&A source line includes “other”; the source label and note must remain visible rather than silently relabeling the value as pure depreciation. The lease note demonstrates why funded debt and lease liabilities are extracted and bridged separately.

## Hand-calculation check

The automated test uses only Apple FY2025/FY2024 filing values. It constructs operating NWC as AR + inventory + other current assets + non-trade receivables − AP − deferred revenue − other current liabilities, then checks:

`FCFF = EBIT × (1 − effective tax rate) + D&A − capex − increase in operating NWC`

The engine result ties to the independently written arithmetic within less than $0.000001mm. Stock-based compensation remains excluded from the add-back by default; enabling the explicit toggle increases FCF by exactly the sourced SBC amount.

## Retained limitations

- Five-year context selection and latest-quarter normalization through the primary SEC adapter in the deployed runtime; the SEC host currently returns HTTP 403 there.
- A repeat live Microsoft automatic-case smoke test after the latest low-call market-input optimization; the configured FMP key reached its plan limit during repeated validation requests.
- Company-specific award-level dilution and lease-note parsing through the primary SEC adapter in the deployed runtime.
- The automatic model is a review-required top-down FCFF screen, not a fully integrated three-statement transaction model with issuer-specific PP&E, tax, debt, lease and share-count schedules.
- The two development-only `image-size` denial-of-service advisories inherited through vinext remain upstream with no patched package version reported by npm on the validation date; production dependencies audit with zero known vulnerabilities and the application does not accept user-supplied images.

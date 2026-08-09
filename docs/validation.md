# Validation and Reconciliation Record

Validation date: 2026-08-09

## Status

The calculation engine, production build, invalid-input refusal, and an Apple filing-based hand check are automated. Document-level source mapping was reconciled against Apple FY2025 and Microsoft FY2025 filings.

Live extraction was verified for AAPL and MSFT on 2026-08-09. Direct requests from the app process to the SEC data host still return HTTP 403, so the run used the disclosed FMP filing fallback. Each ticker returned five annual periods, a latest interim period, current price, 10-year Treasury rate, U.S. equity risk premium, bottom-up relevered beta, and peer-derived target debt/equity weights. The configured FMP plan permits at most five statement periods; the fallback adapter and regression suite enforce that limit.

The live payload still reports blocking gaps rather than producing a false-precision valuation. For both validation tickers, the unresolved fields were terminal growth, exit multiple, operating lease liabilities, usable NOL value, options, option strike price, and RSUs. Those inputs must be sourced or explicitly entered and labeled before a per-share output is allowed.

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

Apple does not present an outstanding option schedule in the cited note. The engine must therefore request a reviewed zero or another sourced input; it does not infer zero. NCI, preferred stock, equity-method investments, and the present value of usable NOLs follow the same blocking policy when a standardized fact is absent.

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

## Items not yet verified

- Five-year context selection and latest-quarter normalization through the primary SEC adapter in the deployed runtime; the SEC host currently returns HTTP 403 there.
- A sourced terminal-growth benchmark and peer exit multiple from the configured FMP plan; the live endpoints returned no usable values.
- A full Apple and Microsoft valuation output, because the remaining terminal and equity-bridge gaps must be sourced or explicitly entered before valuation.
- Spreadsheet recalculation in desktop Excel; the export formulas are structurally tested and still require a final open/recalculate check on a complete, sourced model.

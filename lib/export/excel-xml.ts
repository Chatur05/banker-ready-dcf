import type {
  DcfResult,
  EquityBridge,
  ModelPayload,
  ProjectionAssumptions,
  TaggedValue,
} from "../model/types";

const esc = (value: unknown) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;");

const cell = (
  value: string | number | null,
  style = "Body",
  formula?: string,
  type?: "String" | "Number",
) => {
  const resolvedType = type ?? (typeof value === "number" ? "Number" : "String");
  const formulaAttribute = formula ? ` ss:Formula="${esc(formula)}"` : "";
  const data = value === null ? "" : esc(value);
  return `<Cell ss:StyleID="${style}"${formulaAttribute}><Data ss:Type="${resolvedType}">${data}</Data></Cell>`;
};

const row = (cells: string[], height?: number) =>
  `<Row${height ? ` ss:Height="${height}"` : ""}>${cells.join("")}</Row>`;

const worksheet = (name: string, rows: string[], widths: number[] = []) => `
<Worksheet ss:Name="${esc(name)}">
  <Table>
    ${widths.map((width) => `<Column ss:Width="${width}"/>`).join("")}
    ${rows.join("\n")}
  </Table>
  <WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel"><FreezePanes/><FrozenNoSplit/><SplitHorizontal>3</SplitHorizontal><TopRowBottomPane>3</TopRowBottomPane><ProtectObjects>False</ProtectObjects><ProtectScenarios>False</ProtectScenarios></WorksheetOptions>
</Worksheet>`;

const inputStyle = (value: TaggedValue) => value.provenance.origin === "assumed" ? "Input" : "Source";

function formatValue(value: TaggedValue): string {
  if (value.value === null) return "MISSING";
  return String(value.value);
}

function assumptionsSheet(assumptions: ProjectionAssumptions, payload: ModelPayload, bridge: EquityBridge): string {
  const years = Array.from({ length: assumptions.projectionYears }, (_, index) => `Year ${index + 1}`);
  const rows = [
    row([cell("ASSUMPTIONS", "Title"), ...years.map(() => cell("", "Title"))], 26),
    row([cell("Blue = review default or user input | Green = sourced or derived | Review before reliance", "Note"), ...years.map(() => cell("", "Note"))]),
    row([cell("Operating assumptions", "Section"), ...years.map(() => cell("", "Section"))]),
    row([cell("Revenue growth", "Label"), ...assumptions.revenueGrowth.map((value) => cell(value.value, inputStyle(value), undefined, "Number"))]),
    row([cell("EBIT margin", "Label"), ...assumptions.ebitMargin.map((value) => cell(value.value, inputStyle(value), undefined, "Number"))]),
    row([cell("D&A / revenue", "Label"), ...assumptions.depreciationAmortizationPctRevenue.map((value) => cell(value.value, inputStyle(value), undefined, "Number"))]),
    row([cell("SBC / revenue", "Label"), ...assumptions.stockBasedCompensationPctRevenue.map((value) => cell(value.value, inputStyle(value), undefined, "Number"))]),
    row([cell("Capex / revenue", "Label"), ...assumptions.capitalExpendituresPctRevenue.map((value) => cell(value.value, inputStyle(value), undefined, "Number"))]),
    row([cell("Operating NWC / revenue", "Label"), ...assumptions.netWorkingCapitalPctRevenue.map((value) => cell(value.value, inputStyle(value), undefined, "Number"))]),
    row([cell("Operating tax rate", "Label"), ...assumptions.operatingTaxRate.map((value) => cell(value.value, inputStyle(value), undefined, "Number"))]),
    row([cell("", "Body")]),
    row([cell("Terminal assumptions", "Section"), ...years.map(() => cell("", "Section"))]),
    row([cell("Terminal growth", "Label"), cell(assumptions.terminalGrowth.value, inputStyle(assumptions.terminalGrowth), undefined, "Number")]),
    row([cell("Terminal ROIC", "Label"), cell(assumptions.terminalRoic.value, inputStyle(assumptions.terminalRoic), undefined, "Number")]),
    row([cell("Exit EV / EBITDA", "Label"), cell(assumptions.exitMultiple.value, inputStyle(assumptions.exitMultiple), undefined, "Number")]),
    row([cell("", "Body")]),
    row([cell("WACC assumptions", "Section"), ...years.map(() => cell("", "Section"))]),
    row([cell("Risk-free rate", "Label"), cell(assumptions.riskFreeRate.value, inputStyle(assumptions.riskFreeRate), undefined, "Number")]),
    row([cell("Equity risk premium", "Label"), cell(assumptions.equityRiskPremium.value, inputStyle(assumptions.equityRiskPremium), undefined, "Number")]),
    row([cell("Levered beta", "Label"), cell(assumptions.releveredBeta.value, inputStyle(assumptions.releveredBeta), undefined, "Number")]),
    row([cell("Country risk premium", "Label"), cell(assumptions.countryRiskPremium.value, "Input", undefined, "Number")]),
    row([cell("Size premium", "Label"), cell(assumptions.sizePremium.value, "Input", undefined, "Number")]),
    row([cell("Pre-tax cost of debt", "Label"), cell(assumptions.preTaxCostOfDebt.value, inputStyle(assumptions.preTaxCostOfDebt), undefined, "Number")]),
    row([cell("Debt weight", "Label"), cell(assumptions.debtWeight.value, inputStyle(assumptions.debtWeight), undefined, "Number")]),
    row([cell("Equity weight", "Label"), cell(assumptions.equityWeight.value, inputStyle(assumptions.equityWeight), undefined, "Number")]),
    row([cell("Preferred weight", "Label"), cell(assumptions.preferredWeight.value, inputStyle(assumptions.preferredWeight), undefined, "Number")]),
    row([cell("Preferred cost", "Label"), cell(assumptions.preferredCost.value, inputStyle(assumptions.preferredCost), undefined, "Number")]),
    row([cell("Usable interest tax rate", "Label"), cell(assumptions.usableInterestTaxRate.value, inputStyle(assumptions.usableInterestTaxRate), undefined, "Number")]),
    row([cell("Current share price", "Label"), cell(payload.market.currentPrice.value, inputStyle(payload.market.currentPrice), undefined, "Number")]),
    row([cell("", "Body")]),
    row([cell("Enterprise-to-equity bridge", "Section"), ...years.map(() => cell("", "Section"))]),
    ...([
      ["Cash and equivalents", bridge.cash],
      ["Short-term investments", bridge.shortTermInvestments],
      ["Total debt", bridge.debt],
      ["Finance lease liabilities", bridge.financeLeaseLiabilities],
      ["Operating lease debt adjustment", bridge.operatingLeaseLiabilities],
      ["Minority interest", bridge.minorityInterest],
      ["Preferred stock", bridge.preferredStock],
      ["Equity-method investments", bridge.equityMethodInvestments],
      ["PV of usable NOLs", bridge.presentValueOfNols],
      ["Current shares outstanding", bridge.basicShares],
      ["Options outstanding", bridge.options],
      ["Weighted-average strike", bridge.optionStrikePrice],
      ["RSUs / dilution proxy", bridge.rsus],
    ] as Array<[string, TaggedValue]>).map(([label, value]) =>
      row([cell(label, "Label"), cell(value.value, inputStyle(value), undefined, "Number")]))
  ];
  return worksheet("Assumptions", rows, [190, 78, 78, 78, 78, 78, 78]);
}

function historicalsSheet(payload: ModelPayload): string {
  const periods = payload.historicals.annual;
  const rows: string[] = [
    row([cell("HISTORICALS — SEC FILINGS", "Title"), ...periods.map(() => cell("", "Title"))], 26),
    row([cell(`${payload.identity.name} | $ in millions except per-share data`, "Note"), ...periods.map(() => cell("", "Note"))]),
    row([cell("Fiscal period", "Header"), ...periods.map((period) => cell(period.period.label, "Header"))]),
  ];
  const metrics: Array<[string, (period: (typeof periods)[number]) => TaggedValue]> = [
    ["Revenue", (period) => period.revenue],
    ["EBIT", (period) => period.ebit],
    ["D&A", (period) => period.depreciationAmortization],
    ["Stock-based compensation", (period) => period.stockBasedCompensation],
    ["Capital expenditures", (period) => period.capitalExpenditures],
    ["Cash taxes", (period) => period.cashTaxes],
    ["Accounts receivable", (period) => period.accountsReceivable],
    ["Inventory", (period) => period.inventory],
    ["Other current assets", (period) => period.otherCurrentAssets],
    ["Accounts payable", (period) => period.accountsPayable],
    ["Deferred revenue", (period) => period.deferredRevenue],
    ["Other current liabilities", (period) => period.otherCurrentLiabilities],
    ["Operating NWC", (period) => ({
      value: [period.accountsReceivable, period.inventory, period.otherCurrentAssets, period.accountsPayable, period.deferredRevenue, period.otherCurrentLiabilities].every((value) => value.value !== null)
        ? period.accountsReceivable.value! + period.inventory.value! + period.otherCurrentAssets.value!
          - period.accountsPayable.value! - period.deferredRevenue.value! - period.otherCurrentLiabilities.value!
        : null,
      provenance: { origin: "derived", label: "Operating NWC", units: "$mm" },
    })],
    ["Cash", (period) => period.cash],
    ["Total debt", (period) => period.totalDebt],
    ["Shares outstanding", (period) => period.sharesOutstanding],
  ];
  metrics.forEach(([label, getter]) => {
    rows.push(row([cell(label, "Label"), ...periods.map((period) => cell(getter(period).value, "Source", undefined, "Number"))]));
  });
  rows.push(row([cell("Accession number", "Header"), ...periods.map((period) => cell(period.period.accessionNumber, "Note"))]));
  rows.push(row([cell("Filing date", "Header"), ...periods.map((period) => cell(period.period.filingDate, "Note"))]));
  return worksheet("Historicals", rows, [190, ...periods.map(() => 78)]);
}

function projectionSheet(payload: ModelPayload, assumptions: ProjectionAssumptions, result: DcfResult): string {
  const latestHistoricalColumn = payload.historicals.annual.length + 1;
  const projections = result.projections;
  const rows: string[] = [
    row([cell("PROJECTION MODEL", "Title"), ...projections.map(() => cell("", "Title"))], 26),
    row([cell("Formula-driven unlevered FCF build", "Note"), ...projections.map(() => cell("", "Note"))]),
    row([cell("Fiscal year", "Header"), ...projections.map((item) => cell(item.fiscalYear, "Header", undefined, "Number"))]),
  ];
  const projectionCells = (rowNumber: number, cached: (index: number) => number, formula: (index: number) => string, style = "Formula") =>
    row([cell(["Revenue growth", "Revenue", "EBIT margin", "EBIT", "Operating tax rate", "Cash taxes", "NOPAT", "D&A", "Stock-based compensation", "Capital expenditures", "Operating NWC", "Change in NWC", "Unlevered FCF", "Discount period", "Discount factor", "PV of FCF"][rowNumber - 4], "Label"),
      ...projections.map((_, index) => cell(cached(index), style, formula(index), "Number"))]);
  rows.push(projectionCells(4, (i) => projections[i].growth, (i) => `='Assumptions'!R4C${i + 2}`, "Link"));
  rows.push(projectionCells(5, (i) => projections[i].revenue, (i) => i === 0
    ? `='Historicals'!R4C${latestHistoricalColumn}*(1+R[-1]C)`
    : "=RC[-1]*(1+R[-1]C)"));
  rows.push(projectionCells(6, (i) => projections[i].ebitMargin, (i) => `='Assumptions'!R5C${i + 2}`, "Link"));
  rows.push(projectionCells(7, (i) => projections[i].ebit, () => "=R[-2]C*R[-1]C"));
  rows.push(projectionCells(8, (i) => assumptions.operatingTaxRate[i].value ?? 0, (i) => `='Assumptions'!R10C${i + 2}`, "Link"));
  rows.push(projectionCells(9, (i) => projections[i].cashTaxes, () => "=MAX(0,R[-2]C*R[-1]C)"));
  rows.push(projectionCells(10, (i) => projections[i].nopat, () => "=R[-3]C-R[-1]C"));
  rows.push(projectionCells(11, (i) => projections[i].depreciationAmortization, (i) => `=R[-6]C*'Assumptions'!R6C${i + 2}`));
  rows.push(projectionCells(12, (i) => projections[i].stockBasedCompensation, (i) => `=R[-7]C*'Assumptions'!R7C${i + 2}`));
  rows.push(projectionCells(13, (i) => projections[i].capitalExpenditures, (i) => `=R[-8]C*'Assumptions'!R8C${i + 2}`));
  rows.push(projectionCells(14, (i) => projections[i].netWorkingCapital, (i) => `=R[-9]C*'Assumptions'!R9C${i + 2}`));
  rows.push(projectionCells(15, (i) => projections[i].changeInNetWorkingCapital, (i) => i === 0
    ? `=R[-1]C-'Historicals'!R16C${latestHistoricalColumn}`
    : "=R[-1]C-R[-1]C[-1]"));
  rows.push(projectionCells(
    16,
    (i) => projections[i].unleveredFreeCashFlow,
    () => `=R[-6]C+R[-5]C-R[-3]C-R[-1]C+IF(${assumptions.stockCompensationAddBack ? 1 : 0}=1,R[-4]C,0)`,
  ));
  rows.push(projectionCells(17, (i) => projections[i].discountPeriod, (i) => `=${projections[i].discountPeriod}`, "Formula"));
  rows.push(projectionCells(18, (i) => projections[i].discountFactor, () => "=1/(1+'WACC'!R14C2)^R[-1]C"));
  rows.push(projectionCells(19, (i) => projections[i].presentValueOfFreeCashFlow, () => "=R[-3]C*R[-1]C", "Total"));
  return worksheet("Projection Model", rows, [190, ...projections.map(() => 82)]);
}

function waccSheet(assumptions: ProjectionAssumptions, result: DcfResult): string {
  const rows = [
    row([cell("WACC", "Title"), cell("", "Title")], 26),
    row([cell("Every component links to an editable assumption", "Note")]),
    row([cell("Cost of equity", "Section"), cell("", "Section")]),
    row([cell("Risk-free rate", "Label"), cell(assumptions.riskFreeRate.value, "Link", "='Assumptions'!R18C2", "Number")]),
    row([cell("Levered beta", "Label"), cell(assumptions.releveredBeta.value, "Link", "='Assumptions'!R20C2", "Number")]),
    row([cell("Equity risk premium", "Label"), cell(assumptions.equityRiskPremium.value, "Link", "='Assumptions'!R19C2", "Number")]),
    row([cell("Country risk premium", "Label"), cell(assumptions.countryRiskPremium.value, "Link", "='Assumptions'!R21C2", "Number")]),
    row([cell("Size premium", "Label"), cell(assumptions.sizePremium.value, "Link", "='Assumptions'!R22C2", "Number")]),
    row([cell("Cost of equity", "Total"), cell(result.costOfEquity, "Total", "=R[-5]C+R[-4]C*R[-3]C+R[-2]C+R[-1]C", "Number")]),
    row([cell("Pre-tax cost of debt", "Label"), cell(assumptions.preTaxCostOfDebt.value, "Link", "='Assumptions'!R23C2", "Number")]),
    row([cell("Usable tax rate", "Label"), cell(assumptions.usableInterestTaxRate.value, "Link", "='Assumptions'!R28C2", "Number")]),
    row([cell("After-tax cost of debt", "Total"), cell(result.afterTaxCostOfDebt, "Total", "=R[-2]C*(1-R[-1]C)", "Number")]),
    row([cell("Capital weights", "Section"), cell("", "Section")]),
    row([cell("WACC", "Total"), cell(result.wacc, "Total", "='Assumptions'!R25C2*R[-5]C+'Assumptions'!R24C2*R[-2]C+'Assumptions'!R26C2*'Assumptions'!R27C2", "Number")]),
  ];
  return worksheet("WACC", rows, [220, 110]);
}

function valuationSheet(payload: ModelPayload, assumptions: ProjectionAssumptions, bridge: EquityBridge, result: DcfResult): string {
  const lastColumn = result.projections.length + 1;
  const terminalPeriodAdjustment = assumptions.discountingConvention === "mid-year" ? 0.5 : 0;
  const rows = [
    row([cell("VALUATION SUMMARY", "Title"), cell("", "Title")], 26),
    row([cell(`${payload.identity.ticker} | ${payload.identity.name} | Preliminary review-ready valuation`, "Note")]),
    row([cell("Terminal value", "Section"), cell("", "Section")]),
    row([cell("PV of explicit FCF", "Label"), cell(result.presentValueExplicitCashFlows, "Link", `=SUM('Projection Model'!R19C2:R19C${lastColumn})`, "Number")]),
    row([cell("Terminal value — Gordon", "Label"), cell(result.terminalValueGordon, "Formula", `=('Projection Model'!R10C${lastColumn}*(1+'Assumptions'!R13C2)*(1-'Assumptions'!R13C2/'Assumptions'!R14C2))/('WACC'!R14C2-'Assumptions'!R13C2)`, "Number")]),
    row([cell("PV of terminal value — Gordon", "Label"), cell(result.presentValueTerminalGordon, "Formula", `=R[-1]C/(1+'WACC'!R14C2)^('Projection Model'!R17C${lastColumn}+${terminalPeriodAdjustment})`, "Number")]),
    row([cell("Enterprise value — Gordon", "Total"), cell(result.enterpriseValueGordon, "Total", "=R[-3]C+R[-1]C", "Number")]),
    row([cell("Terminal value / enterprise value", "Label"), cell(result.terminalValuePctEnterpriseValue, "Formula", "=R[-2]C/R[-1]C", "Number")]),
    row([cell("Implied exit EV / EBITDA", "Label"), cell(result.impliedExitMultiple, "Formula", `=R[-4]C/('Projection Model'!R7C${lastColumn}+'Projection Model'!R11C${lastColumn})`, "Number")]),
    row([cell("", "Body")]),
    row([cell("Enterprise-to-equity bridge", "Section"), cell("", "Section")]),
    row([cell("Enterprise value", "Label"), cell(result.enterpriseValueGordon, "Link", "=R[-5]C", "Number")]),
    row([cell("+ Cash", "Label"), cell(bridge.cash.value, "Link", "='Assumptions'!R32C2", "Number")]),
    row([cell("+ Short-term investments", "Label"), cell(bridge.shortTermInvestments.value, "Link", "='Assumptions'!R33C2", "Number")]),
    row([cell("+ Equity-method investments", "Label"), cell(bridge.equityMethodInvestments.value, "Link", "='Assumptions'!R39C2", "Number")]),
    row([cell("+ PV of usable NOLs", "Label"), cell(bridge.presentValueOfNols.value, "Link", "='Assumptions'!R40C2", "Number")]),
    row([cell("- Total debt", "Label"), cell(bridge.debt.value, "Link", "='Assumptions'!R34C2", "Number")]),
    row([cell("- Finance lease liabilities", "Label"), cell(bridge.financeLeaseLiabilities.value, "Link", "='Assumptions'!R35C2", "Number")]),
    row([cell("- Operating lease debt adjustment", "Label"), cell(bridge.operatingLeaseLiabilities.value, "Link", "='Assumptions'!R36C2", "Number")]),
    row([cell("- Minority interest", "Label"), cell(bridge.minorityInterest.value, "Link", "='Assumptions'!R37C2", "Number")]),
    row([cell("- Preferred stock", "Label"), cell(bridge.preferredStock.value, "Link", "='Assumptions'!R38C2", "Number")]),
    row([cell("Bridge adjustments", "Total"), cell(result.bridgeAdjustments, "Total", "=SUM(R[-9]C:R[-6]C)-SUM(R[-5]C:R[-1]C)", "Number")]),
    row([cell("Common equity value", "Total"), cell(result.commonEquityValueGordon, "Total", "=R[-11]C+R[-1]C", "Number")]),
    row([cell("Fully diluted shares", "Label"), cell(result.fullyDilutedShares, "Formula", "='Assumptions'!R41C2+IF('Assumptions'!R42C2>0,'Assumptions'!R42C2*(1-'Assumptions'!R43C2/'Assumptions'!R29C2),0)+'Assumptions'!R44C2", "Number")]),
    row([cell("Implied share price", "Output"), cell(result.impliedSharePriceGordon, "Output", "=R[-2]C/R[-1]C", "Number")]),
  ];
  return worksheet("Valuation Summary", rows, [240, 130]);
}

function sensitivitySheet(assumptions: ProjectionAssumptions, result: DcfResult): string {
  const baseWacc = result.wacc ?? 0;
  const baseGrowth = assumptions.terminalGrowth.value ?? 0;
  const finalColumn = result.projections.length + 1;
  const terminalPeriodAdjustment = assumptions.discountingConvention === "mid-year" ? 0.5 : 0;
  const waccValues = [-2, -1, 0, 1, 2].map((step) => baseWacc + step * 0.005);
  const growthValues = [-2, -1, 0, 1, 2].map((step) => baseGrowth + step * 0.005);
  const rows = [
    row([cell("SENSITIVITIES", "Title"), ...waccValues.map(() => cell("", "Title"))], 26),
    row([cell("WACC step", "Label"), cell(0.005, "Input", undefined, "Number")]),
    row([cell("Terminal growth / WACC", "Header"), ...waccValues.map((value) => cell(value, "Header", undefined, "Number"))]),
  ];
  growthValues.forEach((growth, rowIndex) => {
    rows.push(row([
      cell(growth, "Header", undefined, "Number"),
      ...waccValues.map((_, columnIndex) => cell(
        result.impliedSharePriceGordon,
        rowIndex === 2 && columnIndex === 2 ? "SensitivityBase" : "Sensitivity",
        `=(SUMPRODUCT('Projection Model'!R16C2:R16C${finalColumn},1/(1+R3C${columnIndex + 2})^'Projection Model'!R17C2:R17C${finalColumn})+('Projection Model'!R10C${finalColumn}*(1+RC1)*(1-RC1/'Assumptions'!R14C2))/(R3C${columnIndex + 2}-RC1)/(1+R3C${columnIndex + 2})^('Projection Model'!R17C${finalColumn}+${terminalPeriodAdjustment})+'Valuation Summary'!R22C2)/'Valuation Summary'!R24C2`,
        "Number",
      )),
    ]));
  });
  return worksheet("Sensitivities", rows, [150, 82, 82, 82, 82, 82]);
}

function sourcesSheet(payload: ModelPayload, assumptions: ProjectionAssumptions, bridge: EquityBridge): string {
  const entries: Array<[string, TaggedValue]> = [];
  payload.historicals.annual.forEach((period) => {
    entries.push([`${period.period.label} revenue`, period.revenue]);
    entries.push([`${period.period.label} EBIT`, period.ebit]);
    entries.push([`${period.period.label} capex`, period.capitalExpenditures]);
  });
  entries.push(...([
    ["Risk-free rate", assumptions.riskFreeRate],
    ["Equity risk premium", assumptions.equityRiskPremium],
    ["Relevered beta", assumptions.releveredBeta],
    ["Terminal growth", assumptions.terminalGrowth],
    ["Exit multiple", assumptions.exitMultiple],
    ["Cash", bridge.cash],
    ["Debt", bridge.debt],
    ["Minority interest", bridge.minorityInterest],
    ["Preferred stock", bridge.preferredStock],
    ["Options", bridge.options],
    ["RSUs", bridge.rsus],
  ] as Array<[string, TaggedValue]>));
  const rows = [
    row([cell("SOURCES / AUDIT", "Title"), cell("", "Title"), cell("", "Title"), cell("", "Title"), cell("", "Title")], 26),
    row([cell("Item", "Header"), cell("Value", "Header"), cell("Origin", "Header"), cell("As of / filing", "Header"), cell("Source URL / notes", "Header")]),
    ...entries.map(([label, value]) => row([
      cell(label, "Label"),
      cell(formatValue(value), value.value === null ? "Missing" : "Body"),
      cell(value.provenance.origin, "Body"),
      cell(value.provenance.asOf ?? value.provenance.filingDate ?? "", "Body"),
      cell([value.provenance.sourceUrl, value.provenance.notes].filter(Boolean).join(" | "), "Note"),
    ])),
  ];
  return worksheet("Sources Audit", rows, [180, 90, 75, 100, 420]);
}

function checksSheet(payload: ModelPayload, assumptions: ProjectionAssumptions, result: DcfResult): string {
  const reviewCount = payload.gaps.filter((gap) => gap.severity === "review").length;
  const terminalGrowth = assumptions.terminalGrowth.value;
  const checks = [
    ["No critical model errors", result.errors.length, 0, result.errors.join(" | ")],
    ["WACC exceeds terminal growth", result.wacc !== null && terminalGrowth !== null && result.wacc > terminalGrowth ? 1 : 0, 1, "WACC must exceed terminal growth for a valid Gordon-growth value."],
    ["Terminal value contribution below warning threshold", result.terminalValuePctEnterpriseValue ?? 1, 0.75, "Warning threshold only; a higher result requires review."],
    ["Per-share value is formula-derived", result.impliedSharePriceGordon === null ? 0 : 1, 1, "Must link through EV, bridge, and diluted shares."],
    ["Review defaults outstanding", reviewCount, 0, "Review items do not block calculation; confirm or replace them before reliance."],
  ];
  const rows = [
    row([cell("CHECKS", "Title"), cell("", "Title"), cell("", "Title"), cell("", "Title"), cell("", "Title"), cell("", "Title")], 26),
    row([cell("Check", "Header"), cell("Actual", "Header"), cell("Expected / tolerance", "Header"), cell("Difference", "Header"), cell("Status", "Header"), cell("Notes", "Header")]),
    ...checks.map(([label, actual, expected, notes], index) => {
      const status = index === 2 || index === 4
        ? ((actual as number) <= (expected as number) ? "OK" : "REVIEW")
        : ((actual as number) === (expected as number) ? "OK" : "FAIL");
      return row([
        cell(label as string, "Label"),
        cell(actual as number, "Formula", undefined, "Number"),
        cell(expected as number, "Body", undefined, "Number"),
        cell((actual as number) - (expected as number), "Formula", `=RC[-2]-RC[-1]`, "Number"),
        cell(status, status === "OK" ? "Check" : status === "REVIEW" ? "Review" : "Missing"),
        cell(notes as string, "Note"),
      ]);
    }),
  ];
  return worksheet("Checks", rows, [260, 80, 120, 85, 75, 300]);
}

export function buildExcelXml(
  payload: ModelPayload,
  assumptions: ProjectionAssumptions,
  bridge: EquityBridge,
  result: DcfResult,
): string {
  return `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
<DocumentProperties xmlns="urn:schemas-microsoft-com:office:office"><Author>Banker Ready DCF</Author><Created>${new Date().toISOString()}</Created></DocumentProperties>
<Styles>
  <Style ss:ID="Default" ss:Name="Normal"><Alignment ss:Vertical="Bottom"/><Font ss:FontName="Arial" ss:Size="10"/><NumberFormat/><Protection/></Style>
  <Style ss:ID="Title"><Font ss:FontName="Arial" ss:Size="14" ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#0B1F33" ss:Pattern="Solid"/></Style>
  <Style ss:ID="Section"><Font ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#163A5F" ss:Pattern="Solid"/></Style>
  <Style ss:ID="Header"><Font ss:Bold="1"/><Alignment ss:Horizontal="Right"/><Interior ss:Color="#DCE6F1" ss:Pattern="Solid"/><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1"/></Borders></Style>
  <Style ss:ID="Label"><Alignment ss:Horizontal="Left"/></Style>
  <Style ss:ID="Body"><NumberFormat ss:Format="#,##0.0;[Red](#,##0.0);-"/></Style>
  <Style ss:ID="Formula"><Font ss:Color="#000000"/><NumberFormat ss:Format="#,##0.0;[Red](#,##0.0);-"/></Style>
  <Style ss:ID="Link"><Font ss:Color="#008000"/><NumberFormat ss:Format="#,##0.0;[Red](#,##0.0);-"/></Style>
  <Style ss:ID="Input"><Font ss:Color="#0000FF"/><Interior ss:Color="#FFF2CC" ss:Pattern="Solid"/><NumberFormat ss:Format="0.0%;[Red](0.0%);-"/></Style>
  <Style ss:ID="Source"><Font ss:Color="#008000"/><NumberFormat ss:Format="#,##0.0;[Red](#,##0.0);-"/></Style>
  <Style ss:ID="Total"><Font ss:Bold="1"/><Borders><Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1"/></Borders><NumberFormat ss:Format="#,##0.0;[Red](#,##0.0);-"/></Style>
  <Style ss:ID="Output"><Font ss:Bold="1" ss:Size="12"/><Interior ss:Color="#D9EAD3" ss:Pattern="Solid"/><NumberFormat ss:Format="$0.00;[Red]($0.00);-"/></Style>
  <Style ss:ID="Note"><Font ss:Size="8" ss:Color="#666666"/><Alignment ss:WrapText="1"/></Style>
  <Style ss:ID="Missing"><Font ss:Bold="1" ss:Color="#9C0006"/><Interior ss:Color="#FFC7CE" ss:Pattern="Solid"/></Style>
  <Style ss:ID="Check"><Font ss:Bold="1"/><Interior ss:Color="#D9EAD3" ss:Pattern="Solid"/></Style>
  <Style ss:ID="Review"><Font ss:Bold="1" ss:Color="#7F6000"/><Interior ss:Color="#FFF2CC" ss:Pattern="Solid"/></Style>
  <Style ss:ID="Sensitivity"><NumberFormat ss:Format="$0.00"/><Interior ss:Color="#DCE6F1" ss:Pattern="Solid"/></Style>
  <Style ss:ID="SensitivityBase"><Font ss:Bold="1"/><NumberFormat ss:Format="$0.00"/><Interior ss:Color="#F4B183" ss:Pattern="Solid"/></Style>
</Styles>
${valuationSheet(payload, assumptions, bridge, result)}
${assumptionsSheet(assumptions, payload, bridge)}
${historicalsSheet(payload)}
${projectionSheet(payload, assumptions, result)}
${waccSheet(assumptions, result)}
${sensitivitySheet(assumptions, result)}
${sourcesSheet(payload, assumptions, bridge)}
${checksSheet(payload, assumptions, result)}
</Workbook>`;
}

export function downloadExcel(
  payload: ModelPayload,
  assumptions: ProjectionAssumptions,
  bridge: EquityBridge,
  result: DcfResult,
): void {
  const xml = buildExcelXml(payload, assumptions, bridge, result);
  const blob = new Blob([xml], { type: "application/vnd.ms-excel" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${payload.identity.ticker}_DCF_${assumptions.valuationDate}.xls`;
  anchor.click();
  URL.revokeObjectURL(url);
}

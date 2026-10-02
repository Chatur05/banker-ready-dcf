import ExcelJS from "exceljs";
import type {
  DcfResult,
  EquityBridge,
  ModelPayload,
  ProjectionAssumptions,
  TaggedValue,
} from "../model/types";
import { calculateDcf } from "../model/valuation";

const COLORS = {
  navy: "0B1F33",
  navy2: "183A5A",
  white: "FFFFFF",
  paper: "F5F1E8",
  paleBlue: "DCE6F1",
  input: "FFF2CC",
  green: "D9EAD3",
  red: "F4CCCC",
  copper: "BD6A3C",
  gray: "E7E6E6",
};

const formats = {
  amount: "#,##0.0;[Red](#,##0.0);-",
  shares: "#,##0.0;[Red](#,##0.0);-",
  percent: "0.0%;[Red](0.0%);-",
  multiple: "0.0x;[Red](0.0x);-",
  price: "$0.00;[Red]($0.00);-",
  integer: "0;[Red](0);-",
};

type WorkbookCell = ExcelJS.Cell;
type WorkbookSheet = ExcelJS.Worksheet;

function quotedSheet(name: string): string {
  return `'${name.replaceAll("'", "''")}'`;
}

function ref(sheet: WorkbookSheet, cell: WorkbookCell): string {
  return `${quotedSheet(sheet.name)}!$${sheet.getColumn(cell.col).letter}$${cell.row}`;
}

function formulaCell(cell: WorkbookCell, formula: string, result: number | string | null, numFmt = formats.amount): void {
  cell.value = { formula, result: result ?? undefined } as ExcelJS.CellFormulaValue;
  cell.numFmt = numFmt;
  cell.font = { name: "Arial", size: 10, color: { argb: "FF000000" } };
}

function applyTitle(sheet: WorkbookSheet, title: string, subtitle: string, endColumn = 8): void {
  sheet.mergeCells(1, 1, 1, endColumn);
  const titleCell = sheet.getCell(1, 1);
  titleCell.value = title;
  titleCell.font = { name: "Arial", size: 16, bold: true, color: { argb: `FF${COLORS.white}` } };
  titleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${COLORS.navy}` } };
  titleCell.alignment = { vertical: "middle" };
  sheet.getRow(1).height = 28;
  sheet.mergeCells(2, 1, 2, endColumn);
  const subtitleCell = sheet.getCell(2, 1);
  subtitleCell.value = subtitle;
  subtitleCell.font = { name: "Arial", size: 9, italic: true, color: { argb: "FF666666" } };
  subtitleCell.alignment = { wrapText: true, vertical: "middle" };
  sheet.getRow(2).height = 27;
  sheet.views = [{ state: "frozen", xSplit: 1, ySplit: 3, showGridLines: false }];
  sheet.properties.defaultRowHeight = 16;
  sheet.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 };
  sheet.pageSetup.printTitlesRow = "1:4";
  sheet.pageSetup.margins = { left: 0.35, right: 0.35, top: 0.45, bottom: 0.45, header: 0.2, footer: 0.2 };
  sheet.headerFooter.oddFooter = "Banker Ready DCF | Review required | Page &P of &N";
}

function sectionRow(sheet: WorkbookSheet, rowNumber: number, label: string, endColumn: number): void {
  sheet.mergeCells(rowNumber, 1, rowNumber, endColumn);
  const cell = sheet.getCell(rowNumber, 1);
  cell.value = label;
  cell.font = { name: "Arial", size: 10, bold: true, color: { argb: `FF${COLORS.white}` } };
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${COLORS.navy2}` } };
}

function headerRow(sheet: WorkbookSheet, rowNumber: number, labels: Array<string | number>): void {
  labels.forEach((label, index) => {
    const cell = sheet.getCell(rowNumber, index + 1);
    cell.value = label;
    cell.font = { name: "Arial", size: 9, bold: true, color: { argb: `FF${COLORS.white}` } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${COLORS.navy}` } };
    cell.alignment = { horizontal: index === 0 ? "left" : "right", vertical: "middle", wrapText: true };
    cell.border = { bottom: { style: "thin", color: { argb: `FF${COLORS.white}` } } };
  });
}

function labelCell(cell: WorkbookCell, label: string, bold = false): void {
  cell.value = label;
  cell.font = { name: "Arial", size: 10, bold };
  cell.alignment = { horizontal: "left", vertical: "middle" };
}

function inputCell(cell: WorkbookCell, tagged: TaggedValue, numFmt: string): void {
  cell.value = tagged.value;
  cell.numFmt = numFmt;
  const editable = tagged.provenance.origin === "assumed" || tagged.provenance.origin === "user" || tagged.provenance.origin === "missing";
  cell.font = { name: "Arial", size: 10, color: { argb: editable ? "FF0000FF" : "FF008000" } };
  if (editable) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${COLORS.input}` } };
  cell.note = [tagged.provenance.origin.toUpperCase(), tagged.provenance.notes, tagged.provenance.sourceUrl].filter(Boolean).join(" | ");
  cell.alignment = { horizontal: "right" };
}

function totalRow(sheet: WorkbookSheet, rowNumber: number, endColumn: number, fill = false): void {
  for (let column = 1; column <= endColumn; column += 1) {
    const cell = sheet.getCell(rowNumber, column);
    cell.font = { ...cell.font, name: "Arial", size: 10, bold: true };
    cell.border = { top: { style: "thin", color: { argb: `FF${COLORS.navy}` } } };
    if (fill) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${COLORS.green}` } };
  }
}

function standardWidths(sheet: WorkbookSheet, yearCount = 0): void {
  sheet.getColumn(1).width = 34;
  for (let column = 2; column <= Math.max(2, yearCount + 1); column += 1) sheet.getColumn(column).width = 14;
}

function addCover(
  workbook: ExcelJS.Workbook,
  payload: ModelPayload,
  assumptions: ProjectionAssumptions,
  result: DcfResult,
): WorkbookSheet {
  const sheet = workbook.addWorksheet("Cover", { properties: { tabColor: { argb: `FF${COLORS.copper}` } } });
  sheet.columns = [{ width: 4 }, { width: 31 }, { width: 23 }, { width: 23 }, { width: 23 }, { width: 4 }];
  sheet.mergeCells("B2:E3");
  const brand = sheet.getCell("B2");
  brand.value = "BANKER READY DCF";
  brand.font = { name: "Arial", size: 24, bold: true, color: { argb: `FF${COLORS.white}` } };
  brand.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${COLORS.navy}` } };
  brand.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
  sheet.getRow(2).height = 32;
  sheet.getRow(3).height = 32;
  sheet.mergeCells("B5:E5");
  sheet.getCell("B5").value = `${payload.identity.ticker} | ${payload.identity.name}`;
  sheet.getCell("B5").font = { name: "Arial", size: 18, bold: true, color: { argb: `FF${COLORS.navy}` } };
  sheet.mergeCells("B6:E6");
  sheet.getCell("B6").value = `Automatic first-pass FCFF valuation | Valuation date ${assumptions.valuationDate} | Generated ${new Date(payload.generatedAt).toLocaleString("en-US")}`;
  sheet.getCell("B6").font = { name: "Arial", size: 9, color: { argb: "FF666666" } };

  const cards: Array<[string, number | null, string]> = [
    ["Gordon value / share", result.impliedSharePriceGordon, formats.price],
    ["Current market price", payload.market.currentPrice.value, formats.price],
    ["WACC", result.wacc, formats.percent],
    ["Terminal value / EV", result.terminalValuePctEnterpriseValue, formats.percent],
  ];
  cards.forEach(([label, value, numFmt], index) => {
    const column = 2 + index;
    const labelCellValue = sheet.getCell(8, column);
    labelCellValue.value = label;
    labelCellValue.font = { name: "Arial", size: 9, bold: true, color: { argb: `FF${COLORS.white}` } };
    labelCellValue.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${COLORS.navy2}` } };
    labelCellValue.alignment = { horizontal: "center", wrapText: true };
    const valueCell = sheet.getCell(9, column);
    valueCell.value = value;
    valueCell.numFmt = numFmt;
    valueCell.font = { name: "Arial", size: 18, bold: true, color: { argb: `FF${COLORS.navy}` } };
    valueCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${COLORS.paper}` } };
    valueCell.alignment = { horizontal: "center" };
  });

  sheet.mergeCells("B12:E12");
  sheet.getCell("B12").value = result.ready
    ? `CALCULATION COMPLETE — REVIEW REQUIRED | ${payload.gaps.filter((gap) => gap.severity === "review").length} review flags | ${payload.gaps.filter((gap) => gap.severity === "warning").length} source warnings`
    : `CALCULATION BLOCKED | ${result.errors.length} critical checks`;
  sheet.getCell("B12").font = { name: "Arial", size: 11, bold: true, color: { argb: `FF${COLORS.navy}` } };
  sheet.getCell("B12").fill = { type: "pattern", pattern: "solid", fgColor: { argb: result.ready ? "FFFFF2CC" : `FF${COLORS.red}` } };
  sheet.getCell("B12").alignment = { horizontal: "center" };
  sheet.mergeCells("B14:E17");
  sheet.getCell("B14").value = "Purpose and limitation\nThis workbook is a formula-driven, review-required first-pass valuation. Blue/yellow cells are review defaults or user inputs; green font identifies sourced or derived values. Reconcile filing data, the interim/stub period, terminal economics, discount rate, capital structure, bridge items and dilution before circulation. This is analytical decision support, not investment advice.";
  sheet.getCell("B14").alignment = { wrapText: true, vertical: "top" };
  sheet.getCell("B14").font = { name: "Arial", size: 10, color: { argb: "FF444444" } };
  sheet.getCell("B14").fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${COLORS.gray}` } };
  sheet.views = [{ showGridLines: false }];
  sheet.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 1, paperSize: 9 };
  return sheet;
}

function addAssumptions(
  workbook: ExcelJS.Workbook,
  payload: ModelPayload,
  assumptions: ProjectionAssumptions,
  bridge: EquityBridge,
): { sheet: WorkbookSheet; cells: Record<string, WorkbookCell>; seriesRows: Record<string, number> } {
  const sheet = workbook.addWorksheet("Assumptions", { properties: { tabColor: { argb: "FF5B9BD5" } } });
  const endColumn = assumptions.projectionYears + 1;
  applyTitle(sheet, "ASSUMPTIONS", "Blue/yellow = review default or user input | Green font = sourced or derived | Percentages are stored as decimals", endColumn);
  standardWidths(sheet, assumptions.projectionYears);
  headerRow(sheet, 4, ["Operating assumptions", ...Array.from({ length: assumptions.projectionYears }, (_, index) => `Year ${index + 1}`)]);
  const series: Array<[string, keyof Pick<ProjectionAssumptions, "revenueGrowth" | "ebitMargin" | "depreciationAmortizationPctRevenue" | "stockBasedCompensationPctRevenue" | "capitalExpendituresPctRevenue" | "netWorkingCapitalPctRevenue" | "operatingTaxRate">]> = [
    ["Revenue growth", "revenueGrowth"],
    ["EBIT margin", "ebitMargin"],
    ["D&A / revenue", "depreciationAmortizationPctRevenue"],
    ["SBC / revenue", "stockBasedCompensationPctRevenue"],
    ["Capex / revenue", "capitalExpendituresPctRevenue"],
    ["Operating NWC / revenue", "netWorkingCapitalPctRevenue"],
    ["Operating tax rate", "operatingTaxRate"],
  ];
  const seriesRows: Record<string, number> = {};
  series.forEach(([label, key], index) => {
    const row = 5 + index;
    seriesRows[key] = row;
    labelCell(sheet.getCell(row, 1), label);
    assumptions[key].forEach((tagged, yearIndex) => {
      const cell = sheet.getCell(row, yearIndex + 2);
      inputCell(cell, tagged, formats.percent);
      cell.dataValidation = { type: "decimal", operator: "between", formulae: [-1, 1], allowBlank: false, showErrorMessage: true, errorTitle: "Review input", error: "Enter a decimal between -100% and 100%." };
    });
  });

  const cells: Record<string, WorkbookCell> = {};
  let row = 14;
  const scalarGroups: Array<[string, Array<[string, keyof ProjectionAssumptions, string]>]> = [
    ["Terminal assumptions", [["Terminal growth", "terminalGrowth", formats.percent], ["Terminal ROIC", "terminalRoic", formats.percent], ["Exit EV / EBITDA", "exitMultiple", formats.multiple]]],
    ["WACC assumptions", [["Risk-free rate", "riskFreeRate", formats.percent], ["Equity risk premium", "equityRiskPremium", formats.percent], ["Levered beta", "releveredBeta", formats.multiple], ["Country risk premium", "countryRiskPremium", formats.percent], ["Size premium", "sizePremium", formats.percent], ["Pre-tax cost of debt", "preTaxCostOfDebt", formats.percent], ["Debt weight", "debtWeight", formats.percent], ["Equity weight", "equityWeight", formats.percent], ["Preferred weight", "preferredWeight", formats.percent], ["Preferred cost", "preferredCost", formats.percent], ["Usable interest tax rate", "usableInterestTaxRate", formats.percent]]],
  ];
  scalarGroups.forEach(([group, items]) => {
    sectionRow(sheet, row, group, endColumn);
    row += 1;
    items.forEach(([label, key, numFmt]) => {
      labelCell(sheet.getCell(row, 1), label);
      const tagged = assumptions[key] as TaggedValue;
      const cell = sheet.getCell(row, 2);
      inputCell(cell, tagged, numFmt);
      cells[String(key)] = cell;
      row += 1;
    });
    row += 1;
  });
  formulaCell(cells.equityWeight, `1-${cells.debtWeight.address}-${cells.preferredWeight.address}`, assumptions.equityWeight.value, formats.percent);
  sectionRow(sheet, row, "Market and enterprise-to-equity bridge", endColumn);
  row += 1;
  const bridgeItems: Array<[string, string, TaggedValue, string]> = [
    ["Current market price", "currentPrice", payload.market.currentPrice, formats.price],
    ["Cash and equivalents", "cash", bridge.cash, formats.amount],
    ["Operating cash requirement", "operatingCashRequirement", bridge.operatingCashRequirement, formats.amount],
    ["Short-term investments", "shortTermInvestments", bridge.shortTermInvestments, formats.amount],
    ["Total debt", "debt", bridge.debt, formats.amount],
    ["Finance lease liabilities", "financeLeaseLiabilities", bridge.financeLeaseLiabilities, formats.amount],
    ["Operating lease debt adjustment", "operatingLeaseLiabilities", bridge.operatingLeaseLiabilities, formats.amount],
    ["Other debt-like liabilities", "otherDebtLikeLiabilities", bridge.otherDebtLikeLiabilities, formats.amount],
    ["Minority interest", "minorityInterest", bridge.minorityInterest, formats.amount],
    ["Preferred stock", "preferredStock", bridge.preferredStock, formats.amount],
    ["Non-operating investments", "equityMethodInvestments", bridge.equityMethodInvestments, formats.amount],
    ["Other non-operating assets", "otherNonOperatingAssets", bridge.otherNonOperatingAssets, formats.amount],
    ["PV of usable NOLs", "presentValueOfNols", bridge.presentValueOfNols, formats.amount],
    ["Current shares outstanding", "basicShares", bridge.basicShares, formats.shares],
    ["Options outstanding", "options", bridge.options, formats.shares],
    ["Weighted-average option strike", "optionStrikePrice", bridge.optionStrikePrice, formats.price],
    ["RSUs / dilution proxy", "rsus", bridge.rsus, formats.shares],
  ];
  bridgeItems.forEach(([label, key, tagged, numFmt]) => {
    labelCell(sheet.getCell(row, 1), label);
    const cell = sheet.getCell(row, 2);
    inputCell(cell, tagged, numFmt);
    cells[key] = cell;
    row += 1;
  });
  labelCell(sheet.getCell(row, 1), "SBC add-back (1=yes, 0=no)");
  cells.stockCompensationAddBack = sheet.getCell(row, 2);
  inputCell(cells.stockCompensationAddBack, { value: assumptions.stockCompensationAddBack ? 1 : 0, provenance: { origin: "user", label: "SBC add-back", notes: "Adding back SBC requires a separate future dilution or cash replacement assumption." } }, formats.integer);
  cells.stockCompensationAddBack.dataValidation = { type: "whole", operator: "between", formulae: [0, 1], allowBlank: false, showErrorMessage: true };
  sheet.autoFilter = { from: { row: 4, column: 1 }, to: { row: 11, column: endColumn } };
  sheet.pageSetup.fitToHeight = 1;
  return { sheet, cells, seriesRows };
}

function addHistoricals(workbook: ExcelJS.Workbook, payload: ModelPayload, assumptionsSheet: WorkbookSheet, nwcAssumption: WorkbookCell): { sheet: WorkbookSheet; latestRevenue: WorkbookCell; latestNwc: WorkbookCell } {
  const sheet = workbook.addWorksheet("Historicals", { properties: { tabColor: { argb: "FF70AD47" } } });
  const periods = payload.historicals.annual;
  applyTitle(sheet, "HISTORICALS — FILING BASE", `${payload.identity.name} | $ in millions except per-share data | Click source URLs in the Sources Audit tab`, periods.length + 1);
  standardWidths(sheet, periods.length);
  headerRow(sheet, 4, ["Fiscal period", ...periods.map((period) => `${period.period.label}\n${period.period.endDate}`)]);
  const metrics: Array<[string, (period: (typeof periods)[number]) => TaggedValue]> = [
    ["Revenue", (period) => period.revenue], ["EBIT", (period) => period.ebit], ["D&A", (period) => period.depreciationAmortization], ["Stock-based compensation", (period) => period.stockBasedCompensation], ["Capital expenditures", (period) => period.capitalExpenditures], ["Cash taxes", (period) => period.cashTaxes], ["Accounts receivable", (period) => period.accountsReceivable], ["Inventory", (period) => period.inventory], ["Other current assets", (period) => period.otherCurrentAssets], ["Accounts payable", (period) => period.accountsPayable], ["Deferred revenue", (period) => period.deferredRevenue], ["Other current liabilities", (period) => period.otherCurrentLiabilities],
  ];
  metrics.forEach(([label, getter], index) => {
    const row = 5 + index;
    labelCell(sheet.getCell(row, 1), label);
    periods.forEach((period, periodIndex) => inputCell(sheet.getCell(row, periodIndex + 2), getter(period), formats.amount));
  });
  const nwcRow = 5 + metrics.length;
  labelCell(sheet.getCell(nwcRow, 1), "Operating NWC", true);
  periods.forEach((period, periodIndex) => {
    const column = periodIndex + 2;
    const value = [period.accountsReceivable, period.inventory, period.otherCurrentAssets, period.accountsPayable, period.deferredRevenue, period.otherCurrentLiabilities].every((item) => item.value !== null)
      ? period.accountsReceivable.value! + period.inventory.value! + period.otherCurrentAssets.value! - period.accountsPayable.value! - period.deferredRevenue.value! - period.otherCurrentLiabilities.value!
      : null;
    formulaCell(sheet.getCell(nwcRow, column), `IF(COUNT(${sheet.getCell(11, column).address}:${sheet.getCell(16, column).address})=6,${sheet.getCell(11, column).address}+${sheet.getCell(12, column).address}+${sheet.getCell(13, column).address}-${sheet.getCell(14, column).address}-${sheet.getCell(15, column).address}-${sheet.getCell(16, column).address},NA())`, value);
  });
  totalRow(sheet, nwcRow, periods.length + 1);
  const sourceRow = nwcRow + 2;
  labelCell(sheet.getCell(sourceRow, 1), "Accession number");
  periods.forEach((period, index) => { sheet.getCell(sourceRow, index + 2).value = period.period.accessionNumber || "Not supplied"; });
  labelCell(sheet.getCell(sourceRow + 1, 1), "Filing date");
  periods.forEach((period, index) => { sheet.getCell(sourceRow + 1, index + 2).value = period.period.filingDate.slice(0, 10); });
  sectionRow(sheet, 23, `Forecast opening base (${payload.projectionBase ? "ESTIMATED, NOT REPORTED" : "latest annual"})`, periods.length + 1);
  labelCell(sheet.getCell("A24"), "Opening fiscal date"); sheet.getCell("B24").value = payload.projectionBase?.endDate ?? periods.at(-1)?.period.endDate;
  labelCell(sheet.getCell("A25"), "Opening revenue");
  labelCell(sheet.getCell("A26"), "Opening operating NWC");
  if (payload.projectionBase) {
    inputCell(sheet.getCell("B25"), payload.projectionBase.revenue, formats.amount);
    inputCell(sheet.getCell("B26"), payload.projectionBase.netWorkingCapital, formats.amount);
  } else {
    formulaCell(sheet.getCell("B25"), sheet.getCell(5, periods.length + 1).address, periods.at(-1)!.revenue.value);
    const lastNwc = sheet.getCell(nwcRow, periods.length + 1);
    const last = periods.at(-1)!;
    const complete = [last.accountsReceivable, last.inventory, last.otherCurrentAssets, last.accountsPayable, last.deferredRevenue, last.otherCurrentLiabilities].every((item) => item.value !== null);
    if (complete) formulaCell(sheet.getCell("B26"), lastNwc.address, (lastNwc.value as ExcelJS.CellFormulaValue).result as number);
    else formulaCell(sheet.getCell("B26"), `B25*${ref(assumptionsSheet, nwcAssumption)}`, last.revenue.value! * Number(nwcAssumption.value));
  }
  return { sheet, latestRevenue: sheet.getCell("B25"), latestNwc: sheet.getCell("B26") };
}

function addProjection(
  workbook: ExcelJS.Workbook,
  assumptions: ProjectionAssumptions,
  result: DcfResult,
  assumptionsSheet: WorkbookSheet,
  seriesRows: Record<string, number>,
  latestRevenue: WorkbookCell,
  latestNwc: WorkbookCell,
  historicalsSheet: WorkbookSheet,
  sbcControl: WorkbookCell,
): { sheet: WorkbookSheet; rows: Record<string, number> } {
  const sheet = workbook.addWorksheet("Projection Model", { properties: { tabColor: { argb: "FF4472C4" } } });
  const projections = result.projections;
  applyTitle(sheet, "PROJECTION MODEL", "Formula-driven FCFF build | First period may be a date-weighted stub; reconcile reported interim actuals before circulation", projections.length + 1);
  standardWidths(sheet, projections.length);
  headerRow(sheet, 4, ["Fiscal year", ...projections.map((year) => `${year.fiscalYear}E\n${year.endDate}`)]);
  const rowLabels = ["Revenue growth", "Revenue", "EBIT margin", "EBIT", "Operating tax rate", "Cash taxes", "NOPAT", "D&A", "Stock-based compensation", "Capital expenditures", "Operating NWC", "Change in operating NWC", "Full-year unlevered FCF", "Stub fraction", "Unlevered FCF", "Discount period", "Discount factor", "PV of unlevered FCF"];
  const rows: Record<string, number> = {};
  rowLabels.forEach((label, index) => { rows[label] = 5 + index; labelCell(sheet.getCell(5 + index, 1), label, ["Unlevered FCF", "PV of unlevered FCF"].includes(label)); });
  projections.forEach((projection, index) => {
    const column = index + 2;
    const a = (key: string) => `${quotedSheet(assumptionsSheet.name)}!${assumptionsSheet.getCell(seriesRows[key], column).address}`;
    const checked = (key: string, low: number, high: number) => `IF(AND(ISNUMBER(${a(key)}),${a(key)}>=${low},${a(key)}<=${high}),${a(key)},NA())`;
    formulaCell(sheet.getCell(rows["Revenue growth"], column), checked("revenueGrowth", -0.95, 1), projection.growth, formats.percent);
    const priorRevenue = index === 0 ? ref(historicalsSheet, latestRevenue) : sheet.getCell(rows["Revenue"], column - 1).address;
    formulaCell(sheet.getCell(rows["Revenue"], column), `${priorRevenue}*(1+${sheet.getCell(rows["Revenue growth"], column).address})`, projection.revenue);
    formulaCell(sheet.getCell(rows["EBIT margin"], column), checked("ebitMargin", -1, 1), projection.ebitMargin, formats.percent);
    formulaCell(sheet.getCell(rows["EBIT"], column), `${sheet.getCell(rows["Revenue"], column).address}*${sheet.getCell(rows["EBIT margin"], column).address}`, projection.ebit);
    formulaCell(sheet.getCell(rows["Operating tax rate"], column), checked("operatingTaxRate", 0, 0.6), assumptions.operatingTaxRate[index].value, formats.percent);
    formulaCell(sheet.getCell(rows["Cash taxes"], column), `MAX(0,${sheet.getCell(rows["EBIT"], column).address}*${sheet.getCell(rows["Operating tax rate"], column).address})`, projection.cashTaxes);
    formulaCell(sheet.getCell(rows.NOPAT, column), `${sheet.getCell(rows.EBIT, column).address}-${sheet.getCell(rows["Cash taxes"], column).address}`, projection.nopat);
    formulaCell(sheet.getCell(rows["D&A"], column), `${sheet.getCell(rows.Revenue, column).address}*${checked("depreciationAmortizationPctRevenue", 0, 1)}`, projection.depreciationAmortization);
    formulaCell(sheet.getCell(rows["Stock-based compensation"], column), `${sheet.getCell(rows.Revenue, column).address}*${checked("stockBasedCompensationPctRevenue", 0, 1)}`, projection.stockBasedCompensation);
    formulaCell(sheet.getCell(rows["Capital expenditures"], column), `${sheet.getCell(rows.Revenue, column).address}*${checked("capitalExpendituresPctRevenue", 0, 1)}`, projection.capitalExpenditures);
    formulaCell(sheet.getCell(rows["Operating NWC"], column), `${sheet.getCell(rows.Revenue, column).address}*${checked("netWorkingCapitalPctRevenue", -1, 1)}`, projection.netWorkingCapital);
    const priorNwc = index === 0 ? ref(historicalsSheet, latestNwc) : sheet.getCell(rows["Operating NWC"], column - 1).address;
    formulaCell(sheet.getCell(rows["Change in operating NWC"], column), `${sheet.getCell(rows["Operating NWC"], column).address}-${priorNwc}`, projection.changeInNetWorkingCapital);
    const sbcAddback = `+IF(${ref(assumptionsSheet, sbcControl)}=1,${sheet.getCell(rows["Stock-based compensation"], column).address},0)`;
    formulaCell(sheet.getCell(rows["Full-year unlevered FCF"], column), `${sheet.getCell(rows.NOPAT, column).address}+${sheet.getCell(rows["D&A"], column).address}-${sheet.getCell(rows["Capital expenditures"], column).address}-${sheet.getCell(rows["Change in operating NWC"], column).address}${sbcAddback}`, projection.fullYearUnleveredFreeCashFlow);
    formulaCell(sheet.getCell(rows["Stub fraction"], column), String(projection.stubFraction), projection.stubFraction, formats.percent);
    formulaCell(sheet.getCell(rows["Unlevered FCF"], column), `${sheet.getCell(rows["Full-year unlevered FCF"], column).address}*${sheet.getCell(rows["Stub fraction"], column).address}`, projection.unleveredFreeCashFlow);
    formulaCell(sheet.getCell(rows["Discount period"], column), String(projection.discountPeriod), projection.discountPeriod, "0.00x");
    sheet.getCell(rows["Discount factor"], column).value = projection.discountFactor;
    sheet.getCell(rows["Discount factor"], column).numFmt = formats.percent;
  });
  totalRow(sheet, rows["Unlevered FCF"], projections.length + 1);
  totalRow(sheet, rows["PV of unlevered FCF"], projections.length + 1);
  return { sheet, rows };
}

function addWacc(
  workbook: ExcelJS.Workbook,
  assumptionsSheet: WorkbookSheet,
  assumptionCells: Record<string, WorkbookCell>,
  result: DcfResult,
): { sheet: WorkbookSheet; wacc: WorkbookCell } {
  const sheet = workbook.addWorksheet("WACC", { properties: { tabColor: { argb: "FFED7D31" } } });
  applyTitle(sheet, "WEIGHTED AVERAGE COST OF CAPITAL", "Current marginal inputs and explicit capital weights | Replace proxies with house methodology where required", 3);
  sheet.getColumn(1).width = 38; sheet.getColumn(2).width = 18; sheet.getColumn(3).width = 60;
  sectionRow(sheet, 4, "Cost of equity", 3);
  const rows: Array<[string, string, number | null, string]> = [
    ["Risk-free rate", "riskFreeRate", assumptionCells.riskFreeRate.value as number | null, formats.percent], ["Levered beta", "releveredBeta", assumptionCells.releveredBeta.value as number | null, formats.multiple], ["Equity risk premium", "equityRiskPremium", assumptionCells.equityRiskPremium.value as number | null, formats.percent], ["Country risk premium", "countryRiskPremium", assumptionCells.countryRiskPremium.value as number | null, formats.percent], ["Size premium", "sizePremium", assumptionCells.sizePremium.value as number | null, formats.percent],
  ];
  rows.forEach(([label, key, value, numFmt], index) => { labelCell(sheet.getCell(5 + index, 1), label); formulaCell(sheet.getCell(5 + index, 2), ref(assumptionsSheet, assumptionCells[key]), value, numFmt); });
  labelCell(sheet.getCell(10, 1), "Cost of equity", true);
  formulaCell(sheet.getCell(10, 2), "B5+B6*B7+B8+B9", result.costOfEquity, formats.percent); totalRow(sheet, 10, 2);
  sectionRow(sheet, 12, "Debt, preferred equity and capital weights", 3);
  const linkRows: Array<[number, string, string, string]> = [[13, "Pre-tax cost of debt", "preTaxCostOfDebt", formats.percent], [14, "Usable interest tax rate", "usableInterestTaxRate", formats.percent], [16, "Debt weight", "debtWeight", formats.percent], [17, "Equity weight", "equityWeight", formats.percent], [18, "Preferred weight", "preferredWeight", formats.percent], [19, "Preferred cost", "preferredCost", formats.percent]];
  linkRows.forEach(([row, label, key, numFmt]) => {
    labelCell(sheet.getCell(row, 1), label);
    const cellValue = assumptionCells[key].value;
    const cached = typeof cellValue === "object" && cellValue && "formula" in cellValue ? cellValue.result as number | null : cellValue as number | null;
    formulaCell(sheet.getCell(row, 2), ref(assumptionsSheet, assumptionCells[key]), cached, numFmt);
  });
  labelCell(sheet.getCell(15, 1), "After-tax cost of debt", true); formulaCell(sheet.getCell(15, 2), "B13*(1-B14)", result.afterTaxCostOfDebt, formats.percent); totalRow(sheet, 15, 2);
  labelCell(sheet.getCell(21, 1), "WACC", true); formulaCell(sheet.getCell(21, 2), "B17*B10+B16*B15+B18*B19", result.wacc, formats.percent); totalRow(sheet, 21, 2, true);
  sheet.getCell("C21").value = "Must exceed terminal growth; capital weights must sum to 100%.";
  return { sheet, wacc: sheet.getCell(21, 2) };
}

function addValuation(
  workbook: ExcelJS.Workbook,
  assumptions: ProjectionAssumptions,
  bridge: EquityBridge,
  result: DcfResult,
  assumptionsSheet: WorkbookSheet,
  assumptionCells: Record<string, WorkbookCell>,
  projectionSheet: WorkbookSheet,
  projectionRows: Record<string, number>,
  waccSheet: WorkbookSheet,
  waccCell: WorkbookCell,
): { sheet: WorkbookSheet; bridgeAdjustments: WorkbookCell; dilutedShares: WorkbookCell; sharePrice: WorkbookCell } {
  const sheet = workbook.addWorksheet("Valuation Summary", { properties: { tabColor: { argb: `FF${COLORS.copper}` } } });
  applyTitle(sheet, "VALUATION SUMMARY", "Gordon growth is the primary intrinsic method | Exit multiple is an independent reviewed peer cross-check only", 4);
  sheet.getColumn(1).width = 40; sheet.getColumn(2).width = 18; sheet.getColumn(3).width = 18; sheet.getColumn(4).width = 54;
  const lastColumn = result.projections.length + 1;
  const p = (rowName: string) => `${quotedSheet(projectionSheet.name)}!${projectionSheet.getCell(projectionRows[rowName], lastColumn).address}`;
  sectionRow(sheet, 4, "Terminal-state economics", 4);
  const terminalRows: Array<[number, string, number | null, string, string]> = [
    [5, "Terminal growth", assumptions.terminalGrowth.value, ref(assumptionsSheet, assumptionCells.terminalGrowth), formats.percent], [6, "Terminal ROIC", assumptions.terminalRoic.value, ref(assumptionsSheet, assumptionCells.terminalRoic), formats.percent], [7, "Terminal reinvestment rate", result.terminalReinvestmentRate, "B5/B6", formats.percent], [8, "Terminal NOPAT", result.terminalNopat, `${p("NOPAT")}*(1+B5)`, formats.amount], [9, "Terminal free cash flow", result.terminalFreeCashFlow, "B8*(1-B7)", formats.amount], [10, "WACC", result.wacc, ref(waccSheet, waccCell), formats.percent], [11, "Terminal value — Gordon", result.terminalValueGordon, "B9/(B10-B5)", formats.amount], [12, "Terminal discount factor", result.terminalDiscountFactor, `1/(1+B10)^${result.terminalDiscountPeriod ?? 0}`, formats.percent],
  ];
  terminalRows.forEach(([row, label, value, formula, numFmt]) => { labelCell(sheet.getCell(row, 1), label, [11].includes(row)); formulaCell(sheet.getCell(row, 2), formula, value, numFmt); });
  sectionRow(sheet, 14, "Enterprise value", 4);
  labelCell(sheet.getCell(15, 1), "PV of explicit forecast FCF"); formulaCell(sheet.getCell(15, 2), `SUM(${quotedSheet(projectionSheet.name)}!${projectionSheet.getCell(projectionRows["PV of unlevered FCF"], 2).address}:${quotedSheet(projectionSheet.name)}!${projectionSheet.getCell(projectionRows["PV of unlevered FCF"], lastColumn).address})`, result.presentValueExplicitCashFlows);
  labelCell(sheet.getCell(16, 1), "PV of terminal value — Gordon"); formulaCell(sheet.getCell(16, 2), "B11*B12", result.presentValueTerminalGordon);
  labelCell(sheet.getCell(17, 1), "Enterprise value — Gordon", true); formulaCell(sheet.getCell(17, 2), "SUM(B15:B16)", result.enterpriseValueGordon); totalRow(sheet, 17, 2, true);
  labelCell(sheet.getCell(18, 1), "Terminal value / enterprise value"); formulaCell(sheet.getCell(18, 2), "B16/B17", result.terminalValuePctEnterpriseValue, formats.percent);
  labelCell(sheet.getCell(19, 1), "Implied terminal EV / EBITDA"); formulaCell(sheet.getCell(19, 2), `B11/(${p("EBIT")}+${p("D&A")})`, result.impliedExitMultiple, formats.multiple);
  labelCell(sheet.getCell(20, 1), "Reviewed exit EV / EBITDA"); formulaCell(sheet.getCell(20, 2), ref(assumptionsSheet, assumptionCells.exitMultiple), assumptions.exitMultiple.value, formats.multiple);
  labelCell(sheet.getCell(21, 1), "Enterprise value — exit cross-check");
  if (result.enterpriseValueExit !== null) formulaCell(sheet.getCell(21, 2), `B15+(${p("EBIT")}+${p("D&A")})*B20*B12`, result.enterpriseValueExit);
  else { sheet.getCell(21, 2).value = "Unavailable"; sheet.getCell(21, 2).font = { name: "Arial", italic: true, color: { argb: "FF666666" } }; }

  sectionRow(sheet, 23, "Enterprise-to-equity bridge", 4);
  const bridgeRows: Array<[number, string, string, number]> = [
    [24, "+ Cash and equivalents", "cash", 1], [25, "− Operating cash requirement", "operatingCashRequirement", -1], [26, "+ Short-term investments", "shortTermInvestments", 1], [27, "+ Non-operating investments", "equityMethodInvestments", 1], [28, "+ Other non-operating assets", "otherNonOperatingAssets", 1], [29, "+ PV of usable NOLs", "presentValueOfNols", 1], [30, "− Total debt", "debt", -1], [31, "− Finance lease liabilities", "financeLeaseLiabilities", -1], [32, "− Operating lease debt adjustment", "operatingLeaseLiabilities", -1], [33, "− Other debt-like liabilities", "otherDebtLikeLiabilities", -1], [34, "− Minority interest", "minorityInterest", -1], [35, "− Preferred stock", "preferredStock", -1],
  ];
  bridgeRows.forEach(([row, label, key, sign]) => { labelCell(sheet.getCell(row, 1), label); formulaCell(sheet.getCell(row, 2), `${sign === -1 ? "-" : ""}${ref(assumptionsSheet, assumptionCells[key])}`, (bridge[key as keyof EquityBridge] as TaggedValue).value === null ? null : sign * (bridge[key as keyof EquityBridge] as TaggedValue).value!); });
  labelCell(sheet.getCell(36, 1), "Net bridge adjustments", true); formulaCell(sheet.getCell(36, 2), "SUM(B24:B35)", result.bridgeAdjustments); totalRow(sheet, 36, 2);
  labelCell(sheet.getCell(37, 1), "Common equity value — Gordon", true); formulaCell(sheet.getCell(37, 2), "B17+B36", result.commonEquityValueGordon); totalRow(sheet, 37, 2, true);
  sectionRow(sheet, 39, "Dilution and per-share value", 4);
  labelCell(sheet.getCell(40, 1), "Basic shares outstanding"); formulaCell(sheet.getCell(40, 2), ref(assumptionsSheet, assumptionCells.basicShares), bridge.basicShares.value, formats.shares);
  labelCell(sheet.getCell(41, 1), "Incremental options (treasury-stock method)");
  const optionsFormula = `IF(AND(${ref(assumptionsSheet, assumptionCells.options)}>0,${ref(assumptionsSheet, assumptionCells.currentPrice)}>0,${ref(assumptionsSheet, assumptionCells.optionStrikePrice)}<${ref(assumptionsSheet, assumptionCells.currentPrice)}),${ref(assumptionsSheet, assumptionCells.options)}*(1-${ref(assumptionsSheet, assumptionCells.optionStrikePrice)}/${ref(assumptionsSheet, assumptionCells.currentPrice)}),IF(AND(${ref(assumptionsSheet, assumptionCells.options)}>0,${ref(assumptionsSheet, assumptionCells.currentPrice)}<=0),${ref(assumptionsSheet, assumptionCells.options)},0))`;
  const incrementalOptions = result.fullyDilutedShares !== null && bridge.basicShares.value !== null && bridge.rsus.value !== null ? result.fullyDilutedShares - bridge.basicShares.value - bridge.rsus.value : null;
  formulaCell(sheet.getCell(41, 2), optionsFormula, incrementalOptions, formats.shares);
  labelCell(sheet.getCell(42, 1), "RSUs / dilution proxy"); formulaCell(sheet.getCell(42, 2), ref(assumptionsSheet, assumptionCells.rsus), bridge.rsus.value, formats.shares);
  labelCell(sheet.getCell(43, 1), "Fully diluted shares", true); formulaCell(sheet.getCell(43, 2), "SUM(B40:B42)", result.fullyDilutedShares, formats.shares); totalRow(sheet, 43, 2);
  labelCell(sheet.getCell(44, 1), "Implied share price — Gordon", true); formulaCell(sheet.getCell(44, 2), "IF(AND(B37>0,B43>0),B37/B43,NA())", result.impliedSharePriceGordon, formats.price); totalRow(sheet, 44, 2, true);
  // Own the terminal gate here, not in the downstream Checks sheet. Invalid
  // edits remain visibly unavailable instead of yielding a plausible share price.
  formulaCell(sheet.getCell("B11"), `IF(AND(B10>MAX(0,B5),B5>=-0.05,B5<=0.10,B6>B5,B6>=0.01,B6<=1,${p("NOPAT")}>0,${p("Full-year unlevered FCF")}>0),B9/(B10-B5),NA())`, result.terminalValueGordon);
  labelCell(sheet.getCell(45, 1), "Current market price"); formulaCell(sheet.getCell(45, 2), ref(assumptionsSheet, assumptionCells.currentPrice), assumptionCells.currentPrice.value as number | null, formats.price);
  labelCell(sheet.getCell(46, 1), "Upside / (downside)"); formulaCell(sheet.getCell(46, 2), "IF(B45>0,B44/B45-1,\"\")", result.upsideDownsideGordon, formats.percent);
  sheet.getCell("D44").value = "Calculation complete does not mean approved. Resolve review flags in Checks and Sources Audit before circulation.";
  sheet.getCell("D44").alignment = { wrapText: true };
  sheet.pageSetup.fitToHeight = 1;
  return { sheet, bridgeAdjustments: sheet.getCell(36, 2), dilutedShares: sheet.getCell(43, 2), sharePrice: sheet.getCell(44, 2) };
}

function addSensitivity(
  workbook: ExcelJS.Workbook,
  assumptions: ProjectionAssumptions,
  result: DcfResult,
  projectionSheet: WorkbookSheet,
  projectionRows: Record<string, number>,
  valuationSheet: WorkbookSheet,
  bridgeAdjustments: WorkbookCell,
  dilutedShares: WorkbookCell,
): void {
  const sheet = workbook.addWorksheet("Sensitivities", { properties: { tabColor: { argb: "FFA5A5A5" } } });
  applyTitle(sheet, "SENSITIVITIES", "Implied share price across WACC and terminal growth | Center cell ties to the base case", 7);
  standardWidths(sheet, 6); sheet.getColumn(1).width = 22;
  const waccs = [-0.01, -0.005, 0, 0.005, 0.01].map((delta) => (result.wacc ?? 0) + delta);
  const growths = [-0.01, -0.005, 0, 0.005, 0.01].map((delta) => (assumptions.terminalGrowth.value ?? 0) + delta);
  headerRow(sheet, 4, ["Terminal g / WACC", ...waccs]);
  waccs.forEach((value, index) => {
    const cell = sheet.getCell(4, index + 2);
    formulaCell(cell, `${quotedSheet(valuationSheet.name)}!$B$10+${[-0.01, -0.005, 0, 0.005, 0.01][index]}`, value, formats.percent);
    cell.font = { name: "Arial", size: 10, bold: true, color: { argb: "FFFFFFFF" } };
  });
  const finalColumn = result.projections.length + 1;
  const terminalPeriod = result.terminalDiscountPeriod ?? 0;
  const explicitFormula = (waccAddress: string) => `SUMPRODUCT(${quotedSheet(projectionSheet.name)}!${projectionSheet.getCell(projectionRows["Unlevered FCF"], 2).address}:${quotedSheet(projectionSheet.name)}!${projectionSheet.getCell(projectionRows["Unlevered FCF"], finalColumn).address},1/(1+${waccAddress})^${quotedSheet(projectionSheet.name)}!${projectionSheet.getCell(projectionRows["Discount period"], 2).address}:${quotedSheet(projectionSheet.name)}!${projectionSheet.getCell(projectionRows["Discount period"], finalColumn).address})`;
  growths.forEach((growth, rowIndex) => {
    const row = 5 + rowIndex;
    formulaCell(sheet.getCell(row, 1), `${quotedSheet(valuationSheet.name)}!$B$5+${[-0.01, -0.005, 0, 0.005, 0.01][rowIndex]}`, growth, formats.percent);
    waccs.forEach((wacc, columnIndex) => {
      const column = 2 + columnIndex;
      const waccAddress = `${sheet.getColumn(column).letter}$4`;
      const growthAddress = `$A${row}`;
      const finalNopat = `${quotedSheet(projectionSheet.name)}!${projectionSheet.getCell(projectionRows.NOPAT, finalColumn).address}`;
      const roic = `${quotedSheet(valuationSheet.name)}!$B$6`;
      const formula = `IF(AND(${waccAddress}>MAX(0,${growthAddress}),${roic}>${growthAddress},${roic}>0,${ref(valuationSheet, dilutedShares)}>0,ISNUMBER(${quotedSheet(valuationSheet.name)}!$B$44)),(${explicitFormula(waccAddress)}+(${finalNopat}*(1+${growthAddress})*(1-${growthAddress}/${roic}))/(${waccAddress}-${growthAddress})/(1+${waccAddress})^${terminalPeriod}+${ref(valuationSheet, bridgeAdjustments)})/${ref(valuationSheet, dilutedShares)},NA())`;
      const value = (() => {
        if (!result.projections.length || result.bridgeAdjustments === null || !result.fullyDilutedShares || wacc <= Math.max(0, growth) || assumptions.terminalRoic.value === null || assumptions.terminalRoic.value <= growth) return null;
        const explicit = result.projections.reduce((sum, year) => sum + year.unleveredFreeCashFlow / (1 + wacc) ** year.discountPeriod, 0);
        const final = result.projections.at(-1)!;
        const terminal = final.nopat * (1 + growth) * (1 - growth / assumptions.terminalRoic.value) / (wacc - growth);
        return (explicit + terminal / (1 + wacc) ** terminalPeriod + result.bridgeAdjustments) / result.fullyDilutedShares;
      })();
      formulaCell(sheet.getCell(row, column), formula, value, formats.price);
      if (rowIndex === 2 && columnIndex === 2) sheet.getCell(row, column).border = { top: { style: "medium", color: { argb: `FF${COLORS.copper}` } }, bottom: { style: "medium", color: { argb: `FF${COLORS.copper}` } }, left: { style: "medium", color: { argb: `FF${COLORS.copper}` } }, right: { style: "medium", color: { argb: `FF${COLORS.copper}` } } };
    });
  });
  sheet.addConditionalFormatting({ ref: "B5:F9", rules: [{ type: "colorScale", priority: 1, cfvo: [{ type: "min" }, { type: "percentile", value: 50 }, { type: "max" }], color: [{ argb: `FF${COLORS.red}` }, { argb: "FFFFF2CC" }, { argb: `FF${COLORS.green}` }] }] });
}

function addSources(workbook: ExcelJS.Workbook, payload: ModelPayload, assumptions: ProjectionAssumptions, bridge: EquityBridge): void {
  const sheet = workbook.addWorksheet("Sources Audit", { properties: { tabColor: { argb: "FF70AD47" } } });
  applyTitle(sheet, "SOURCES / AUDIT TRAIL", "Provider, date, units, transformation and source link for material model inputs", 7);
  [29, 16, 13, 16, 17, 55, 70].forEach((width, index) => { sheet.getColumn(index + 1).width = width; });
  headerRow(sheet, 4, ["Item", "Value", "Origin", "As of", "Units", "Source URL", "Method / note"]);
  const entries: Array<[string, TaggedValue]> = [];
  payload.historicals.annual.forEach((period) => {
    entries.push([`${period.period.label} revenue`, period.revenue], [`${period.period.label} EBIT`, period.ebit], [`${period.period.label} D&A`, period.depreciationAmortization], [`${period.period.label} capex`, period.capitalExpenditures]);
  });
  if (payload.projectionBase) entries.push(["Estimated opening revenue", payload.projectionBase.revenue], ["Estimated opening NWC", payload.projectionBase.netWorkingCapital]);
  for (const key of ["revenueGrowth", "ebitMargin", "capitalExpendituresPctRevenue", "netWorkingCapitalPctRevenue"] as const) assumptions[key].forEach((value, index) => entries.push([`${key} forecast ${index + 1}`, value]));
  entries.push(...([
    ["Risk-free rate", assumptions.riskFreeRate], ["Equity risk premium", assumptions.equityRiskPremium], ["Levered beta", assumptions.releveredBeta], ["Pre-tax cost of debt", assumptions.preTaxCostOfDebt], ["Terminal growth", assumptions.terminalGrowth], ["Terminal ROIC", assumptions.terminalRoic], ["Exit multiple", assumptions.exitMultiple], ...Object.entries(bridge).map(([key, value]) => [key, value] as [string, TaggedValue]),
  ] as Array<[string, TaggedValue]>));
  entries.forEach(([label, tagged], index) => {
    const row = 5 + index;
    sheet.getCell(row, 1).value = label;
    sheet.getCell(row, 2).value = tagged.value;
    sheet.getCell(row, 2).numFmt = tagged.provenance.units === "%" ? formats.percent : tagged.provenance.units?.includes("share") && !tagged.provenance.units.startsWith("mm") ? formats.price : formats.amount;
    sheet.getCell(row, 3).value = tagged.provenance.origin;
    sheet.getCell(row, 4).value = tagged.provenance.asOf ?? tagged.provenance.filingDate ?? "";
    sheet.getCell(row, 5).value = tagged.provenance.units ?? "";
    sheet.getCell(row, 6).value = tagged.provenance.sourceUrl
      ? { text: tagged.provenance.sourceUrl, hyperlink: tagged.provenance.sourceUrl }
      : "";
    sheet.getCell(row, 7).value = tagged.provenance.notes ?? "";
    sheet.getRow(row).alignment = { vertical: "top", wrapText: true };
  });
  sheet.autoFilter = { from: "A4", to: `G${4 + entries.length}` };
}

function addChecks(
  workbook: ExcelJS.Workbook,
  payload: ModelPayload,
  assumptions: ProjectionAssumptions,
  result: DcfResult,
  waccSheet: WorkbookSheet,
  waccCell: WorkbookCell,
  valuationSheet: WorkbookSheet,
  sharePrice: WorkbookCell,
): void {
  const sheet = workbook.addWorksheet("Checks", { properties: { tabColor: { argb: "FFC00000" } } });
  applyTitle(sheet, "CHECKS AND REVIEW QUEUE", "FAIL blocks calculation | REVIEW means the model calculates but requires judgment before circulation", 6);
  [37, 15, 15, 15, 15, 78].forEach((width, index) => { sheet.getColumn(index + 1).width = width; });
  headerRow(sheet, 4, ["Check", "Actual", "Threshold", "Difference", "Status", "Comment"]);
  const checkRows: Array<[string, number, number, "equal" | "less" | "greater", string]> = [
    ["Critical calculation errors", result.errors.length, 0, "equal", result.errors.join(" | ") || "No blocking mathematical or eligibility errors."],
    ["Capital weights sum to 100%", (assumptions.debtWeight.value ?? 0) + (assumptions.equityWeight.value ?? 0) + (assumptions.preferredWeight.value ?? 0), 1, "equal", "Debt, equity and preferred weights must sum to 100%."],
    ["WACC exceeds terminal growth", (result.wacc ?? 0) - (assumptions.terminalGrowth.value ?? 0), 0, "greater", "Required for a finite Gordon-growth terminal value."],
    ["Terminal reinvestment at or below 100%", result.terminalReinvestmentRate ?? 2, 1, "less", "Stable-state growth must be consistent with ROIC and reinvestment."],
    ["Terminal value / enterprise value", result.terminalValuePctEnterpriseValue ?? 1, 0.75, "less", "Above 75% is a review warning, not an automatic failure."],
    ["Positive per-share value", result.impliedSharePriceGordon ?? 0, 0, "greater", "Must tie through enterprise value, bridge and fully diluted shares."],
    ["Open judgment / source review flags", payload.gaps.filter((gap) => gap.severity === "review").length, 0, "equal", "Review flags do not block calculation; confirm or replace each before circulation."],
  ];
  checkRows.forEach(([label, actual, threshold, operator, note], index) => {
    const row = 5 + index;
    sheet.getCell(row, 1).value = label; sheet.getCell(row, 2).value = actual; sheet.getCell(row, 3).value = threshold;
    formulaCell(sheet.getCell(row, 4), `B${row}-C${row}`, actual - threshold, "0.0%;(0.0%);-");
    const checkFormat = label === "Positive per-share value" ? formats.price
      : ["Capital weights sum to 100%", "WACC exceeds terminal growth", "Terminal reinvestment at or below 100%", "Terminal value / enterprise value"].includes(label)
        ? formats.percent
        : formats.integer;
    sheet.getCell(row, 2).numFmt = checkFormat;
    sheet.getCell(row, 3).numFmt = checkFormat;
    sheet.getCell(row, 4).numFmt = checkFormat === formats.percent ? "0.0%;(0.0%);-" : checkFormat;
    const ok = operator === "equal" ? Math.abs(actual - threshold) < 0.0001 : operator === "less" ? actual <= threshold : actual > threshold;
    const reviewOnly = ["Terminal value / enterprise value", "Open judgment / source review flags"].includes(label);
    const status = ok ? "OK" : reviewOnly ? "REVIEW" : "FAIL";
    const condition = operator === "equal" ? `ABS(B${row}-C${row})<0.0001` : operator === "less" ? `B${row}<=C${row}` : `B${row}>C${row}`;
    formulaCell(sheet.getCell(row, 5), `IF(ISNUMBER(B${row}),IF(${condition},"OK","${reviewOnly ? "REVIEW" : "FAIL"}"),"FAIL")`, status, "General");
    sheet.getCell(row, 5).font = { name: "Arial", bold: true, color: { argb: status === "OK" ? "FF006100" : status === "REVIEW" ? "FF9C6500" : "FF9C0006" } };
    sheet.getCell(row, 5).fill = { type: "pattern", pattern: "solid", fgColor: { argb: status === "OK" ? `FF${COLORS.green}` : status === "REVIEW" ? "FFFFEB9C" : `FF${COLORS.red}` } };
    sheet.getCell(row, 6).value = note;
    sheet.getCell(row, 6).alignment = { wrapText: true, vertical: "middle" };
    sheet.getRow(row).height = 30;
  });
  formulaCell(sheet.getCell("B5"), `IF(ISNUMBER(${ref(valuationSheet, sharePrice)}),0,1)`, result.errors.length, formats.integer);
  sheet.getCell("A5").value = "Valuation output availability";
  sheet.getCell("F5").value = "Live output check; not a substitute for reviewing all Excel input edits. Full input validation is performed when rebuilding in the app.";
  formulaCell(sheet.getCell("B6"), `SUM(${quotedSheet(waccSheet.name)}!B16:B18)`, 1, formats.percent);
  formulaCell(sheet.getCell("B7"), `${ref(waccSheet, waccCell)}-${quotedSheet(valuationSheet.name)}!B5`, result.wacc! - assumptions.terminalGrowth.value!, formats.percent);
  formulaCell(sheet.getCell("B8"), `${quotedSheet(valuationSheet.name)}!B7`, result.terminalReinvestmentRate, formats.percent);
  formulaCell(sheet.getCell("B9"), `${quotedSheet(valuationSheet.name)}!B18`, result.terminalValuePctEnterpriseValue, formats.percent);
  formulaCell(sheet.getCell("B10"), ref(valuationSheet, sharePrice), result.impliedSharePriceGordon, formats.price);
  sheet.addConditionalFormatting({ ref: "E5:E11", rules: [
    { type: "containsText", operator: "containsText", text: "FAIL", priority: 1, style: { font: { color: { argb: "FF9C0006" }, bold: true }, fill: { type: "pattern", pattern: "solid", bgColor: { argb: "FFFFC7CE" } } } },
    { type: "containsText", operator: "containsText", text: "REVIEW", priority: 2, style: { font: { color: { argb: "FF9C6500" } }, fill: { type: "pattern", pattern: "solid", bgColor: { argb: "FFFFEB9C" } } } },
  ] });
  sectionRow(sheet, 14, "Detailed review flags", 6);
  [...payload.gaps, ...result.warnings.map((reason) => ({ field: "Model review", reason, severity: "warning", affectedOutputs: ["DCF"] }))].forEach((gap, index) => {
    const row = 15 + index;
    sheet.getCell(row, 1).value = gap.field;
    sheet.getCell(row, 2).value = gap.severity.toUpperCase();
    sheet.mergeCells(row, 3, row, 6);
    sheet.getCell(row, 3).value = `${gap.reason} Affects: ${gap.affectedOutputs.join(", ")}.`;
    sheet.getCell(row, 3).alignment = { wrapText: true, vertical: "top" };
    sheet.getRow(row).height = Math.max(31, Math.ceil((gap.reason.length + 60) / 130) * 14);
  });
  sheet.getCell("F5").note = `WACC reference: ${ref(waccSheet, waccCell)} | Per-share reference: ${ref(valuationSheet, sharePrice)}`;
  sheet.pageSetup.fitToHeight = 0;
}

export async function buildExcelWorkbook(
  payload: ModelPayload,
  assumptions: ProjectionAssumptions,
  bridge: EquityBridge,
  result: DcfResult,
): Promise<Uint8Array> {
  result = calculateDcf(payload, assumptions, bridge);
  if (!result.ready) throw new Error(`Export blocked: ${result.errors.join(" ")}`);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Banker Ready DCF";
  workbook.lastModifiedBy = "Banker Ready DCF";
  workbook.created = new Date(payload.generatedAt);
  workbook.modified = new Date();
  workbook.calcProperties.fullCalcOnLoad = true;
  addCover(workbook, payload, assumptions, result);
  const assumptionBuild = addAssumptions(workbook, payload, assumptions, bridge);
  const historicalBuild = addHistoricals(workbook, payload, assumptionBuild.sheet, assumptionBuild.sheet.getCell(assumptionBuild.seriesRows.netWorkingCapitalPctRevenue, 2));
  const projectionBuild = addProjection(workbook, assumptions, result, assumptionBuild.sheet, assumptionBuild.seriesRows, historicalBuild.latestRevenue, historicalBuild.latestNwc, historicalBuild.sheet, assumptionBuild.cells.stockCompensationAddBack);
  const waccBuild = addWacc(workbook, assumptionBuild.sheet, assumptionBuild.cells, result);
  result.projections.forEach((projection, index) => {
    const column = index + 2;
    formulaCell(projectionBuild.sheet.getCell(projectionBuild.rows["Discount factor"], column), `1/(1+${ref(waccBuild.sheet, waccBuild.wacc)})^${projectionBuild.sheet.getCell(projectionBuild.rows["Discount period"], column).address}`, projection.discountFactor, formats.percent);
    formulaCell(projectionBuild.sheet.getCell(projectionBuild.rows["PV of unlevered FCF"], column), `${projectionBuild.sheet.getCell(projectionBuild.rows["Unlevered FCF"], column).address}*${projectionBuild.sheet.getCell(projectionBuild.rows["Discount factor"], column).address}`, projection.presentValueOfFreeCashFlow);
  });
  const valuationBuild = addValuation(workbook, assumptions, bridge, result, assumptionBuild.sheet, assumptionBuild.cells, projectionBuild.sheet, projectionBuild.rows, waccBuild.sheet, waccBuild.wacc);
  for (const [address, formula, value] of [["B9", "'Valuation Summary'!B44", result.impliedSharePriceGordon], ["C9", "'Valuation Summary'!B45", payload.market.currentPrice.value], ["D9", "'Valuation Summary'!B10", result.wacc], ["E9", "'Valuation Summary'!B18", result.terminalValuePctEnterpriseValue]] as const) workbook.getWorksheet("Cover")!.getCell(address).value = { formula, result: value ?? undefined };
  formulaCell(workbook.getWorksheet("Cover")!.getCell("B12"), `IF(ISNUMBER('Valuation Summary'!B44),"CALCULATED - REVIEW REQUIRED","BLOCKED - REVIEW INPUTS")`, "CALCULATED - REVIEW REQUIRED", "General");
  addSensitivity(workbook, assumptions, result, projectionBuild.sheet, projectionBuild.rows, valuationBuild.sheet, valuationBuild.bridgeAdjustments, valuationBuild.dilutedShares);
  addSources(workbook, payload, assumptions, bridge);
  addChecks(workbook, payload, assumptions, result, waccBuild.sheet, waccBuild.wacc, valuationBuild.sheet, valuationBuild.sharePrice);
  workbook.eachSheet((sheet) => { sheet.eachRow((row) => { row.eachCell((cell) => { if (!cell.font?.name) cell.font = { ...cell.font, name: "Arial", size: 10 }; }); }); });
  const buffer = await workbook.xlsx.writeBuffer();
  return new Uint8Array(buffer as ArrayBuffer);
}

export async function downloadExcel(
  payload: ModelPayload,
  assumptions: ProjectionAssumptions,
  bridge: EquityBridge,
  result: DcfResult,
): Promise<void> {
  const bytes = await buildExcelWorkbook(payload, assumptions, bridge, result);
  const blob = new Blob([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${payload.identity.ticker}_DCF_${assumptions.valuationDate}.xlsx`;
  anchor.click();
  URL.revokeObjectURL(url);
}

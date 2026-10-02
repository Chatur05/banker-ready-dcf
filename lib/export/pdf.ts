import { PDFDocument, StandardFonts, rgb, type PDFPage, type PDFFont } from "pdf-lib";
import type { DcfResult, ModelPayload, ProjectionAssumptions } from "../model/types";
import { calculateDcf } from "../model/valuation";

const navy = rgb(11 / 255, 31 / 255, 51 / 255);
const copper = rgb(189 / 255, 106 / 255, 60 / 255);
const paper = rgb(245 / 255, 241 / 255, 232 / 255);
const muted = rgb(88 / 255, 99 / 255, 109 / 255);
const green = rgb(31 / 255, 118 / 255, 87 / 255);
const amber = rgb(208 / 255, 138 / 255, 37 / 255);
const red = rgb(166 / 255, 66 / 255, 53 / 255);
const white = rgb(1, 1, 1);

const money = (value: number | null, decimals = 1) => value === null
  ? "Unavailable"
  : `$${value.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`;
const amount = (value: number | null) => value === null ? "Unavailable" : value.toLocaleString("en-US", { maximumFractionDigits: 1 });
const percent = (value: number | null) => value === null ? "Unavailable" : `${(value * 100).toFixed(1)}%`;
const multiple = (value: number | null) => value === null ? "Unavailable" : `${value.toFixed(1)}x`;

function fitText(text: string, font: PDFFont, size: number, maxWidth: number): string {
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return text;
  let output = text;
  while (output.length > 3 && font.widthOfTextAtSize(`${output}...`, size) > maxWidth) output = output.slice(0, -1);
  return `${output.trim()}...`;
}

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = text.replace(/\s+/g, " ").trim().split(" ");
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) line = candidate;
    else { if (line) lines.push(line); line = word; }
  }
  if (line) lines.push(line);
  return lines;
}

function drawHeader(page: PDFPage, bold: PDFFont, regular: PDFFont, title: string, subtitle: string): void {
  page.drawRectangle({ x: 0, y: 555, width: 792, height: 57, color: navy });
  page.drawText("BR", { x: 34, y: 577, font: bold, size: 15, color: white });
  page.drawText(title, { x: 69, y: 578, font: bold, size: 15, color: white });
  page.drawText(fitText(subtitle, regular, 8, 685), { x: 69, y: 564, font: regular, size: 8, color: rgb(0.72, 0.77, 0.82) });
}

function drawSection(page: PDFPage, bold: PDFFont, label: string, x: number, y: number, width: number): void {
  page.drawText(label.toUpperCase(), { x, y, font: bold, size: 8, color: copper });
  page.drawLine({ start: { x, y: y - 5 }, end: { x: x + width, y: y - 5 }, thickness: 0.6, color: rgb(0.80, 0.80, 0.78) });
}

function drawMetric(page: PDFPage, bold: PDFFont, regular: PDFFont, x: number, y: number, width: number, label: string, value: string, accent = navy): void {
  page.drawRectangle({ x, y, width, height: 60, color: paper, borderColor: rgb(0.80, 0.80, 0.78), borderWidth: 0.5 });
  page.drawText(label.toUpperCase(), { x: x + 10, y: y + 43, font: bold, size: 6.8, color: muted });
  const valueSize = value.length > 12 ? 13.5 : 17;
  page.drawText(fitText(value, bold, valueSize, width - 20), { x: x + 10, y: y + 17, font: bold, size: valueSize, color: accent });
  page.drawText("", { x: x + 10, y: y + 7, font: regular, size: 5, color: muted });
}

function drawKeyValue(page: PDFPage, regular: PDFFont, bold: PDFFont, x: number, y: number, width: number, label: string, value: string): void {
  page.drawText(label, { x, y, font: regular, size: 7.5, color: muted });
  const fitted = fitText(value, bold, 8, width * 0.46);
  page.drawText(fitted, { x: x + width - bold.widthOfTextAtSize(fitted, 8), y, font: bold, size: 8, color: navy });
  page.drawLine({ start: { x, y: y - 4 }, end: { x: x + width, y: y - 4 }, thickness: 0.3, color: rgb(0.86, 0.85, 0.82) });
}

function drawFooter(page: PDFPage, regular: PDFFont, pageNumber: number): void {
  page.drawLine({ start: { x: 34, y: 26 }, end: { x: 758, y: 26 }, thickness: 0.4, color: rgb(0.75, 0.75, 0.72) });
  page.drawText("Banker Ready DCF | Automatic first-pass valuation | Review required", { x: 34, y: 13, font: regular, size: 6.5, color: muted });
  page.drawText(`Page ${pageNumber}`, { x: 728, y: 13, font: regular, size: 6.5, color: muted });
}

export async function buildPdf(payload: ModelPayload, assumptions: ProjectionAssumptions, result: DcfResult): Promise<Uint8Array> {
  result = calculateDcf(payload, assumptions, payload.bridge);
  if (!result.ready) throw new Error(`Export blocked: ${result.errors.join(" ")}`);
  const document = await PDFDocument.create();
  document.setTitle(`${payload.identity.ticker} Banker Ready DCF`);
  document.setAuthor("Banker Ready DCF");
  document.setSubject("Review-required automatic first-pass FCFF valuation");
  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  const page = document.addPage([792, 612]);
  drawHeader(page, bold, regular, `${payload.identity.ticker} | ${payload.identity.name}`, `Valuation date ${assumptions.valuationDate} | Generated ${new Date(payload.generatedAt).toLocaleString("en-US")} | $ in millions except per-share data`);

  const reviewCount = payload.gaps.filter((gap) => gap.severity === "review").length;
  const warningCount = payload.gaps.filter((gap) => gap.severity === "warning").length;
  drawMetric(page, bold, regular, 34, 474, 170, "Gordon value / share", money(result.impliedSharePriceGordon, 2), result.impliedSharePriceGordon !== null ? green : red);
  drawMetric(page, bold, regular, 216, 474, 170, "Current market price", money(payload.market.currentPrice.value, 2));
  drawMetric(page, bold, regular, 398, 474, 170, "Upside / (downside)", percent(result.upsideDownsideGordon), (result.upsideDownsideGordon ?? 0) >= 0 ? green : red);
  drawMetric(page, bold, regular, 580, 474, 178, "Calculation status", result.ready ? "REVIEW REQUIRED" : "BLOCKED", result.ready ? amber : red);

  drawSection(page, bold, "Core valuation", 34, 451, 346);
  const leftPairs: Array<[string, string]> = [
    ["Enterprise value — Gordon", `${money(result.enterpriseValueGordon)}mm`], ["Common equity value", `${money(result.commonEquityValueGordon)}mm`], ["Fully diluted shares", `${amount(result.fullyDilutedShares)}mm`], ["PV of explicit FCF", `${money(result.presentValueExplicitCashFlows)}mm`], ["PV of terminal value", `${money(result.presentValueTerminalGordon)}mm`], ["Terminal value / EV", percent(result.terminalValuePctEnterpriseValue)], ["Implied exit multiple", multiple(result.impliedExitMultiple)], ["Exit cross-check value", money(result.impliedSharePriceExit, 2)],
  ];
  leftPairs.forEach(([label, value], index) => drawKeyValue(page, regular, bold, 34, 430 - index * 21, 346, label, value));

  drawSection(page, bold, "Discount rate and terminal state", 412, 451, 346);
  const rightPairs: Array<[string, string]> = [
    ["WACC", percent(result.wacc)], ["Cost of equity", percent(result.costOfEquity)], ["After-tax cost of debt", percent(result.afterTaxCostOfDebt)], ["Terminal growth", percent(assumptions.terminalGrowth.value)], ["Terminal ROIC", percent(assumptions.terminalRoic.value)], ["Reinvestment rate (g / ROIC)", percent(result.terminalReinvestmentRate)], ["Terminal NOPAT", `${money(result.terminalNopat)}mm`], ["Terminal FCFF", `${money(result.terminalFreeCashFlow)}mm`],
  ];
  rightPairs.forEach(([label, value], index) => drawKeyValue(page, regular, bold, 412, 430 - index * 21, 346, label, value));

  drawSection(page, bold, "Forecast FCFF", 34, 246, 724);
  const columns = Math.max(1, result.projections.length);
  const labelWidth = 128;
  const yearWidth = (724 - labelWidth) / columns;
  ["Fiscal year", "Revenue", "EBIT", "NOPAT", "Unlevered FCF", "PV of FCF"].forEach((label, rowIndex) => {
    const y = 225 - rowIndex * 18;
    page.drawText(label, { x: 34, y, font: rowIndex === 0 ? bold : regular, size: 7, color: rowIndex === 0 ? white : navy });
    if (rowIndex === 0) page.drawRectangle({ x: 34, y: y - 5, width: 724, height: 16, color: navy, opacity: 0.94 });
    result.projections.forEach((projection, index) => {
      const value = rowIndex === 0 ? `${projection.fiscalYear}E${projection.stubFraction < 1 ? "*" : ""}`
        : rowIndex === 1 ? amount(projection.revenue)
          : rowIndex === 2 ? amount(projection.ebit)
            : rowIndex === 3 ? amount(projection.nopat)
              : rowIndex === 4 ? amount(projection.unleveredFreeCashFlow)
                : amount(projection.presentValueOfFreeCashFlow);
      const size = 6.7;
      const x = 34 + labelWidth + index * yearWidth;
      const width = regular.widthOfTextAtSize(value, size);
      page.drawText(value, { x: x + yearWidth - width - 4, y, font: rowIndex === 0 || rowIndex === 4 ? bold : regular, size, color: rowIndex === 0 ? white : navy });
    });
  });
  if (result.projections.some((projection) => projection.stubFraction < 1)) page.drawText("* First period is a date-weighted approximation from the annual case; reconcile reported interim actuals before circulation.", { x: 34, y: 113, font: regular, size: 6.4, color: amber });

  const statusText = result.ready
    ? `CALCULATION COMPLETE — NOT APPROVED | ${reviewCount} judgment/source review flags | ${warningCount} source warnings`
    : `CALCULATION BLOCKED | ${result.errors.length} critical checks`;
  page.drawRectangle({ x: 34, y: 54, width: 724, height: 35, color: result.ready ? rgb(1, 0.95, 0.82) : rgb(0.95, 0.84, 0.82), borderColor: result.ready ? amber : red, borderWidth: 1 });
  page.drawText(statusText, { x: 46, y: 74, font: bold, size: 8.3, color: result.ready ? navy : red });
  page.drawText("This output is a formula-driven first pass. Review filing reconciliation, interim/stub treatment, forecast drivers, WACC, terminal economics, bridge items and dilution before reliance.", { x: 46, y: 61, font: regular, size: 6.6, color: muted });
  drawFooter(page, regular, 1);

  const auditPage = document.addPage([792, 612]);
  drawHeader(auditPage, bold, regular, "REVIEW QUEUE AND EQUITY BRIDGE", `${payload.identity.ticker} | Calculation integrity and open judgment items`);
  drawSection(auditPage, bold, "Enterprise-to-equity bridge", 34, 535, 350);
  const bridgePairs: Array<[string, number | null]> = [
    ["Enterprise value", result.enterpriseValueGordon], ["Cash and equivalents", payload.bridge.cash.value], ["Operating cash requirement", payload.bridge.operatingCashRequirement.value === null ? null : -payload.bridge.operatingCashRequirement.value], ["Short-term investments", payload.bridge.shortTermInvestments.value], ["Non-operating investments", payload.bridge.equityMethodInvestments.value], ["Other non-operating assets", payload.bridge.otherNonOperatingAssets.value], ["PV of usable NOLs", payload.bridge.presentValueOfNols.value], ["Total debt", payload.bridge.debt.value === null ? null : -payload.bridge.debt.value], ["Finance leases", payload.bridge.financeLeaseLiabilities.value === null ? null : -payload.bridge.financeLeaseLiabilities.value], ["Operating lease adjustment", payload.bridge.operatingLeaseLiabilities.value === null ? null : -payload.bridge.operatingLeaseLiabilities.value], ["Other debt-like liabilities", payload.bridge.otherDebtLikeLiabilities.value === null ? null : -payload.bridge.otherDebtLikeLiabilities.value], ["Minority interest", payload.bridge.minorityInterest.value === null ? null : -payload.bridge.minorityInterest.value], ["Preferred stock", payload.bridge.preferredStock.value === null ? null : -payload.bridge.preferredStock.value], ["Common equity value", result.commonEquityValueGordon],
  ];
  bridgePairs.forEach(([label, value], index) => drawKeyValue(auditPage, regular, bold, 34, 514 - index * 25, 350, label, value === null ? "Unavailable" : `${value < 0 ? "(" : ""}$${Math.abs(value).toLocaleString("en-US", { maximumFractionDigits: 1 })}${value < 0 ? ")" : ""}mm`));

  drawSection(auditPage, bold, "Critical calculation checks", 412, 535, 346);
  const checks = result.errors.length ? result.errors : ["No blocking mathematical or eligibility errors."];
  checks.slice(0, 5).forEach((check, index) => {
    const y = 512 - index * 34;
    auditPage.drawText(result.errors.length ? "FAIL" : "OK", { x: 412, y, font: bold, size: 7, color: result.errors.length ? red : green });
    wrapText(check, regular, 7, 300).slice(0, 2).forEach((line, lineIndex) => auditPage.drawText(line, { x: 448, y: y - lineIndex * 10, font: regular, size: 7, color: navy }));
  });
  drawSection(auditPage, bold, "Priority review flags - complete queue follows", 412, 356, 346);
  const gaps = [...payload.gaps.filter((gap) => gap.severity !== "blocking"), ...result.warnings.map((reason) => ({ field: "Model review", reason, severity: "warning", affectedOutputs: ["DCF"] }))];
  let y = 333;
  for (const gap of gaps.slice(0, 8)) {
    if (y < 56) break;
    const lines = wrapText(`${gap.field}: ${gap.reason}`, regular, 6.7, 305).slice(0, 3);
    auditPage.drawText(gap.severity.toUpperCase(), { x: 412, y, font: bold, size: 6.4, color: gap.severity === "review" ? amber : muted });
    lines.forEach((line, lineIndex) => auditPage.drawText(line, { x: 459, y: y - lineIndex * 9, font: regular, size: 6.7, color: navy }));
    y -= Math.max(27, lines.length * 9 + 8);
  }
  if (!gaps.length) auditPage.drawText("No review or source-warning items were reported.", { x: 412, y: 332, font: regular, size: 7, color: navy });
  drawFooter(auditPage, regular, 2);

  let pageNumber = 2;
  const newQueuePage = () => {
    const queuePage = document.addPage([792, 612]);
    drawHeader(queuePage, bold, regular, "COMPLETE REVIEW QUEUE", `${payload.identity.ticker} | Every unresolved source, assumption and judgment flag`);
    queuePage.drawRectangle({ x: 34, y: 522, width: 724, height: 19, color: navy });
    queuePage.drawText("SEVERITY", { x: 42, y: 529, font: bold, size: 6.5, color: white });
    queuePage.drawText("ITEM AND REQUIRED REVIEW", { x: 105, y: 529, font: bold, size: 6.5, color: white });
    queuePage.drawText("AFFECTED OUTPUTS", { x: 625, y: 529, font: bold, size: 6.5, color: white });
    drawFooter(queuePage, regular, ++pageNumber);
    return queuePage;
  };
  let queuePage = newQueuePage();
  let queueY = 507;
  gaps.forEach((gap, index) => {
    const lines = wrapText(`${gap.field}: ${gap.reason}`, regular, 8, 495);
    const affected = wrapText(gap.affectedOutputs.join(", "), regular, 7.5, 122);
    const height = Math.max(32, Math.max(lines.length, affected.length) * 10 + 13);
    if (queueY - height < 48) { queuePage = newQueuePage(); queueY = 507; }
    const background = index % 2 === 0 ? paper : white;
    queuePage.drawRectangle({ x: 34, y: queueY - height + 9, width: 724, height: height - 1, color: background });
    queuePage.drawText(gap.severity.toUpperCase(), { x: 42, y: queueY, font: bold, size: 6.2, color: gap.severity === "review" ? amber : muted });
    lines.forEach((line, lineIndex) => queuePage.drawText(line, { x: 105, y: queueY - lineIndex * 10, font: regular, size: 8, color: navy }));
    affected.forEach((line, lineIndex) => queuePage.drawText(line, { x: 625, y: queueY - lineIndex * 10, font: regular, size: 7.5, color: muted }));
    queueY -= height;
  });
  queuePage.drawText("Calculation completion confirms arithmetic integrity only. A deal-team reviewer must clear each item before circulation.", { x: 34, y: 42, font: bold, size: 7, color: amber });
  return document.save();
}

export async function downloadPdf(payload: ModelPayload, assumptions: ProjectionAssumptions, result: DcfResult): Promise<void> {
  const bytes = await buildPdf(payload, assumptions, result);
  const blob = new Blob([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${payload.identity.ticker}_DCF_summary_${assumptions.valuationDate}.pdf`;
  anchor.click();
  URL.revokeObjectURL(url);
}

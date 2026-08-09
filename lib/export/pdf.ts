import type { DcfResult, ModelPayload, ProjectionAssumptions } from "../model/types";

const money = (value: number | null, decimals = 1) => value === null
  ? "Unavailable"
  : `$${value.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`;
const percent = (value: number | null) => value === null ? "Unavailable" : `${(value * 100).toFixed(1)}%`;
const escapePdf = (value: string) => value.replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)");

export function buildPdf(payload: ModelPayload, assumptions: ProjectionAssumptions, result: DcfResult): Uint8Array {
  const lines = [
    { text: "BANKER READY DCF", size: 18, y: 748 },
    { text: `${payload.identity.ticker} | ${payload.identity.name}`, size: 12, y: 724 },
    { text: `Valuation date ${assumptions.valuationDate} | Fiscal year end ${payload.identity.fiscalYearEnd}`, size: 9, y: 708 },
    { text: "Valuation", size: 12, y: 674 },
    { text: `Implied share price (Gordon): ${money(result.impliedSharePriceGordon, 2)}`, size: 11, y: 654 },
    { text: `Implied share price (Exit): ${money(result.impliedSharePriceExit, 2)}`, size: 11, y: 637 },
    { text: `Enterprise value: ${money(result.enterpriseValueGordon)}mm`, size: 10, y: 620 },
    { text: `Common equity value: ${money(result.commonEquityValueGordon)}mm`, size: 10, y: 603 },
    { text: "Core assumptions", size: 12, y: 570 },
    { text: `WACC ${percent(result.wacc)} | Terminal growth ${percent(assumptions.terminalGrowth.value)} | Exit multiple ${assumptions.exitMultiple.value?.toFixed(1) ?? "Unavailable"}x`, size: 10, y: 550 },
    { text: `Terminal ROIC ${percent(assumptions.terminalRoic.value)} | TV / EV ${percent(result.terminalValuePctEnterpriseValue)}`, size: 10, y: 533 },
    { text: `Cost of equity ${percent(result.costOfEquity)} | After-tax cost of debt ${percent(result.afterTaxCostOfDebt)}`, size: 10, y: 516 },
    { text: "Enterprise-to-equity bridge", size: 12, y: 483 },
    { text: `Net bridge adjustments: ${money(result.bridgeAdjustments)}mm | Fully diluted shares: ${result.fullyDilutedShares?.toFixed(1) ?? "Unavailable"}mm`, size: 10, y: 463 },
    { text: "Risk and audit", size: 12, y: 430 },
    { text: result.ready ? "Model status: valuation complete" : `Model status: blocked by ${result.errors.length} required input(s)`, size: 10, y: 410 },
    { text: result.warnings[0] ?? "No terminal-value warning triggered.", size: 9, y: 393 },
    { text: "Fundamentals: SEC EDGAR Company Facts and filings. Market inputs: FMP Stable API when configured.", size: 8, y: 345 },
    { text: "Every workbook input is labeled sourced, derived, assumed, or missing. No missing value is silently estimated.", size: 8, y: 332 },
  ];
  const stream = ["BT", "/F1 10 Tf"];
  for (const line of lines) {
    stream.push(`/F1 ${line.size} Tf 54 ${line.y} Td (${escapePdf(line.text)}) Tj ${-54} ${-line.y} Td`);
  }
  stream.push("ET");
  const content = stream.join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${new TextEncoder().encode(content).length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(new TextEncoder().encode(pdf).length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = new TextEncoder().encode(pdf).length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach((offset) => { pdf += `${String(offset).padStart(10, "0")} 00000 n \n`; });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(pdf);
}

export function downloadPdf(payload: ModelPayload, assumptions: ProjectionAssumptions, result: DcfResult): void {
  const bytes = Uint8Array.from(buildPdf(payload, assumptions, result));
  const blob = new Blob([bytes.buffer], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${payload.identity.ticker}_DCF_summary_${assumptions.valuationDate}.pdf`;
  anchor.click();
  URL.revokeObjectURL(url);
}

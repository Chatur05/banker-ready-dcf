import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildModelPayload } from "../lib/data/model";
import { buildExcelWorkbook } from "../lib/export/excel-xml";
import { buildPdf } from "../lib/export/pdf";
import { calculateDcf } from "../lib/model/valuation";

process.loadEnvFile?.(".env.local");

const ticker = (process.argv[2] ?? "AAPL").trim().toUpperCase();
const payload = await buildModelPayload(ticker);
const result = calculateDcf(payload);
if (!result.ready) throw new Error(`QA valuation blocked: ${result.errors.join(" | ")}`);

const outputDirectory = path.resolve("tmp", "qa");
await mkdir(outputDirectory, { recursive: true });
const excelPath = path.join(outputDirectory, `${ticker}_DCF_${payload.assumptions.valuationDate}.xlsx`);
const pdfPath = path.join(outputDirectory, `${ticker}_DCF_${payload.assumptions.valuationDate}.pdf`);
await writeFile(excelPath, await buildExcelWorkbook(payload, payload.assumptions, payload.bridge, result));
await writeFile(pdfPath, await buildPdf(payload, payload.assumptions, result));

console.log(JSON.stringify({
  ticker,
  excelPath,
  pdfPath,
  impliedSharePrice: result.impliedSharePriceGordon,
  wacc: result.wacc,
  terminalGrowth: payload.assumptions.terminalGrowth.value,
  reviewFlags: payload.gaps.filter((gap) => gap.severity === "review").length,
}, null, 2));

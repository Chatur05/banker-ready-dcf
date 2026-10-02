import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { readFile, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import path from "node:path";

const runtime = process.env.ARTIFACT_RUNTIME;
if (!runtime) throw new Error("Set ARTIFACT_RUNTIME to the bundled node dependency directory.");
const require = createRequire(path.join(runtime, "package.json"));
const { SpreadsheetFile, FileBlob } = await import(pathToFileURL(require.resolve("@oai/artifact-tool")).href);
const file = process.argv[2] ?? "tmp/reliability/AAPL.xlsx";
const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(file));
workbook.recalculate();
const readPrice = () => workbook.worksheets.getItem("Valuation Summary").getRange("B44").values[0][0];
const base = readPrice();
const scenarios = JSON.parse(await readFile(file.replace(/\.xlsx$/, "-scenarios.json"), "utf8"));
const inputs = workbook.worksheets.getItem("Assumptions");
for (const scenario of scenarios) {
  const row = inputs.getRange("A1:A80").values.findIndex(([label]) => label === scenario.label) + 1;
  assert.ok(row > 0, scenario.label);
  const cell = inputs.getRange(`B${row}`); const original = cell.values;
  cell.values = [[scenario.value]]; workbook.recalculate();
  const actual = readPrice();
  if (scenario.expected === null) assert.ok(typeof actual !== "number" || !Number.isFinite(actual), `Invalid case leaked ${actual}`);
  else {
    assert.ok(Math.abs(actual - scenario.expected) < 1e-6, `${scenario.label}: ${actual} vs ${scenario.expected}`);
    const center = workbook.worksheets.getItem("Sensitivities").getRange("D7").values[0][0];
    assert.ok(Math.abs(center - actual) < 1e-6, "Sensitivity center no longer ties");
    assert.ok(Math.abs(workbook.worksheets.getItem("Cover").getRange("B9").values[0][0] - actual) < 1e-6, "Cover did not update");
  }
  console.log(JSON.stringify({ ticker: path.basename(file, ".xlsx"), input: scenario.label, value: scenario.value, actual, expected: scenario.expected, pass: true }));
  cell.values = original; workbook.recalculate();
}
assert.ok(Math.abs(readPrice() - base) < 1e-9);
console.log((await workbook.inspect({ kind: "table", range: "'Valuation Summary'!A40:B46", include: "values,formulas", tableMaxRows: 7, tableMaxCols: 2, maxChars: 2500 })).ndjson);
console.log((await workbook.inspect({ kind: "match", searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#NUM!", options: { useRegex: true, maxResults: 15 }, maxChars: 2000 })).ndjson);
for (const [sheetName, range] of [["Historicals", "A1:F26"], ["Sensitivities", "A1:G10"], ["Checks", "A1:F13"]]) {
  const preview = await workbook.render({ sheetName, range, scale: 1.4, format: "png" });
  await writeFile(`tmp/reliability/${path.basename(file, ".xlsx")}-${sheetName}.png`, new Uint8Array(await preview.arrayBuffer()));
}

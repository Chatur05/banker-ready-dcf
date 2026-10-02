import { readFile, writeFile } from "node:fs/promises";
import { buildExcelWorkbook } from "../lib/export/excel-xml";
import { buildPdf } from "../lib/export/pdf";
import { calculateDcf } from "../lib/model/valuation";
import type { ModelPayload } from "../lib/model/types";

for (const ticker of ["AAPL", "MSFT", "NVDA", "KO"]) {
  const { payload } = JSON.parse(await readFile(`tmp/reliability/${ticker}-after.json`, "utf8")) as { payload: ModelPayload };
  const result = calculateDcf(payload);
  await writeFile(`tmp/reliability/${ticker}.xlsx`, await buildExcelWorkbook(payload, payload.assumptions, payload.bridge, result));
  await writeFile(`tmp/reliability/${ticker}.pdf`, await buildPdf(payload, payload.assumptions, result));
  const scenarios = [
    { label: "Terminal ROIC", value: 0.15, key: "terminalRoic" },
    { label: "Debt weight", value: 0.2, key: "debtWeight" },
    { label: "Terminal growth", value: 0.03, key: "terminalGrowth" },
    { label: "Terminal growth", value: 0.20, key: "terminalGrowth" },
  ] as const;
  await writeFile(`tmp/reliability/${ticker}-scenarios.json`, JSON.stringify(scenarios.map((scenario) => {
    const edited = structuredClone(payload.assumptions);
    edited[scenario.key].value = scenario.value;
    if (scenario.key === "debtWeight") edited.equityWeight.value = 1 - scenario.value - edited.preferredWeight.value!;
    return { ...scenario, expected: calculateDcf(payload, edited).impliedSharePriceGordon };
  })));
  console.log(JSON.stringify({ ticker, sharePrice: result.impliedSharePriceGordon, warnings: result.warnings.length, reviews: payload.gaps.length }));
}

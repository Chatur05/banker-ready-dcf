"use client";

import { useMemo, useState } from "react";
import { calculateDcf } from "../../lib/model/valuation";
import type {
  DcfResult,
  EquityBridge,
  ModelPayload,
  ProjectionAssumptions,
  TaggedValue,
} from "../../lib/model/types";

const money = (value: number | null, decimals = 1) => value === null
  ? "—"
  : `$${value.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`;
const percent = (value: number | null, decimals = 1) => value === null
  ? "—"
  : `${(value * 100).toFixed(decimals)}%`;
const multiple = (value: number | null) => value === null ? "—" : `${value.toFixed(1)}x`;
const number = (value: number | null) => value === null
  ? "—"
  : value.toLocaleString("en-US", { maximumFractionDigits: 1 });

function assumedValue(current: TaggedValue, value: number | null): TaggedValue {
  return {
    value,
    provenance: {
      origin: value === null ? "missing" : "user",
      label: current.provenance.label,
      units: current.provenance.units,
      notes: "User-entered assumption; replaces the prior sourced or derived default.",
    },
  };
}

function OriginBadge({ value }: { value: TaggedValue }) {
  const label = value.provenance.origin === "assumed" ? "review" : value.provenance.origin;
  return <span className={`origin origin-${value.provenance.origin}`} title={value.provenance.notes}>{label}</span>;
}

function EditableField({
  label,
  tagged,
  onChange,
  scale = 1,
  suffix,
  min,
  max,
  readOnly = false,
}: {
  label: string;
  tagged: TaggedValue;
  onChange: (value: number | null) => void;
  scale?: number;
  suffix?: string;
  min?: number;
  max?: number;
  readOnly?: boolean;
}) {
  return (
    <label className="field-row">
      <span className="field-label">
        <span>{label}</span>
        <OriginBadge value={tagged} />
      </span>
      <span className="field-control">
        <input
          aria-label={label}
          inputMode="decimal"
          type="number"
          step="any"
          min={min}
          max={max}
          readOnly={readOnly}
          value={tagged.value === null ? "" : tagged.value * scale}
          placeholder="Enter value"
          onChange={(event) => onChange(event.target.value === "" ? null : Number(event.target.value) / scale)}
        />
        {suffix ? <span>{suffix}</span> : null}
      </span>
      <span className="field-note">
        {tagged.provenance.sourceUrl
          ? <a href={tagged.provenance.sourceUrl} target="_blank" rel="noreferrer">Source · {tagged.provenance.asOf ?? tagged.provenance.filingDate}</a>
          : null}
        {tagged.provenance.notes ? <span>{tagged.provenance.sourceUrl ? " · " : ""}{tagged.provenance.notes}</span> : null}
      </span>
    </label>
  );
}

function StatusPill({ result, reviewCount }: { result: DcfResult | null; reviewCount: number }) {
  if (!result) return <span className="status-pill neutral"><span />Awaiting ticker</span>;
  if (result.ready && reviewCount > 0) return <span className="status-pill review"><span />Calculated · review required ({reviewCount})</span>;
  if (result.ready) return <span className="status-pill pass"><span />Calculated · no open flags</span>;
  return <span className="status-pill fail"><span />Blocked · {result.errors.length} critical checks</span>;
}

function valueAt(
  result: DcfResult,
  assumptions: ProjectionAssumptions,
  wacc: number,
  terminalGrowth: number,
  exitMultiple?: number,
): number | null {
  if (!result.projections.length || result.bridgeAdjustments === null || !result.fullyDilutedShares
    || wacc <= terminalGrowth || assumptions.terminalRoic.value === null) return null;
  const explicit = result.projections.reduce((sum, year) =>
    sum + year.unleveredFreeCashFlow / (1 + wacc) ** year.discountPeriod, 0);
  const final = result.projections.at(-1)!;
  const terminalPeriod = final.discountPeriod + (assumptions.discountingConvention === "mid-year" ? 0.5 : 0);
  const terminalValue = exitMultiple === undefined
    ? final.nopat * (1 + terminalGrowth) * (1 - terminalGrowth / assumptions.terminalRoic.value) / (wacc - terminalGrowth)
    : (final.ebit + final.depreciationAmortization) * exitMultiple;
  return (explicit + terminalValue / (1 + wacc) ** terminalPeriod + result.bridgeAdjustments)
    / result.fullyDilutedShares;
}

function SensitivityTable({
  result,
  assumptions,
  currentPrice,
  kind,
}: {
  result: DcfResult;
  assumptions: ProjectionAssumptions;
  currentPrice: number | null;
  kind: "growth" | "multiple";
}) {
  if (result.wacc === null || assumptions.terminalGrowth.value === null
    || (kind === "multiple" && assumptions.exitMultiple.value === null)) {
    return <div className="empty-panel">Complete WACC and terminal inputs to render this table.</div>;
  }
  const waccs = [-0.01, -0.005, 0, 0.005, 0.01].map((delta) => result.wacc! + delta);
  const rows = kind === "growth"
    ? [-0.01, -0.005, 0, 0.005, 0.01].map((delta) => assumptions.terminalGrowth.value! + delta)
    : [-2, -1, 0, 1, 2].map((delta) => assumptions.exitMultiple.value! + delta);
  const values = rows.flatMap((rowValue) => waccs.map((wacc) =>
    kind === "growth"
      ? valueAt(result, assumptions, wacc, rowValue)
      : valueAt(result, assumptions, wacc, assumptions.terminalGrowth.value!, rowValue)));
  const finite = values.filter((value): value is number => value !== null && Number.isFinite(value));
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  return (
    <div className="sensitivity-wrap">
      <table className="sensitivity-table">
        <thead><tr><th>{kind === "growth" ? "g / WACC" : "Exit / WACC"}</th>{waccs.map((value) => <th key={value}>{percent(value)}</th>)}</tr></thead>
        <tbody>{rows.map((rowValue, rowIndex) => (
          <tr key={rowValue}>
            <th>{kind === "growth" ? percent(rowValue) : multiple(rowValue)}</th>
            {waccs.map((wacc, columnIndex) => {
              const output = kind === "growth"
                ? valueAt(result, assumptions, wacc, rowValue)
                : valueAt(result, assumptions, wacc, assumptions.terminalGrowth.value!, rowValue);
              const ratio = output === null || max === min ? 0.5 : (output - min) / (max - min);
              return <td
                key={wacc}
                className={rowIndex === 2 && columnIndex === 2 ? "base-cell" : ""}
                style={{ "--heat": ratio } as React.CSSProperties}
              ><span>{money(output, 2)}</span><small>{output !== null && currentPrice !== null && currentPrice > 0 ? percent(output / currentPrice - 1, 0) : "—"}</small></td>;
            })}
          </tr>
        ))}</tbody>
      </table>
      <p>Implied share price; ±100 bps WACC and growth, ±2.0x exit multiple. The center cell ties to the base model.</p>
    </div>
  );
}

type ScalarKey = "terminalGrowth" | "terminalRoic" | "exitMultiple" | "riskFreeRate"
  | "equityRiskPremium" | "releveredBeta" | "countryRiskPremium" | "sizePremium"
  | "preTaxCostOfDebt" | "debtWeight" | "equityWeight" | "preferredWeight"
  | "preferredCost" | "usableInterestTaxRate";
type SeriesKey = "revenueGrowth" | "ebitMargin" | "depreciationAmortizationPctRevenue"
  | "stockBasedCompensationPctRevenue" | "capitalExpendituresPctRevenue"
  | "netWorkingCapitalPctRevenue" | "operatingTaxRate";
type BridgeKey = keyof EquityBridge;

export function DcfWorkbench() {
  const [ticker, setTicker] = useState("");
  const [loading, setLoading] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [payload, setPayload] = useState<ModelPayload | null>(null);
  const [assumptions, setAssumptions] = useState<ProjectionAssumptions | null>(null);
  const [bridge, setBridge] = useState<EquityBridge | null>(null);
  const [currentPrice, setCurrentPrice] = useState<TaggedValue | null>(null);
  const effectivePayload = useMemo(() => payload && currentPrice
    ? { ...payload, market: { ...payload.market, currentPrice }, bridge: bridge ?? payload.bridge }
    : payload, [payload, currentPrice, bridge]);
  const result = useMemo(() => effectivePayload && assumptions && bridge
    ? calculateDcf(effectivePayload, assumptions, bridge)
    : null, [effectivePayload, assumptions, bridge]);

  async function loadTicker(event: React.FormEvent) {
    event.preventDefault();
    const symbol = ticker.trim().toUpperCase();
    if (!symbol) return;
    setLoading(true);
    setRequestError(null);
    try {
      const response = await fetch(`/api/model?ticker=${encodeURIComponent(symbol)}`);
      const body = await response.json() as ModelPayload & { error?: string; refusal?: string };
      if (!response.ok) throw new Error([body.error, body.refusal].filter(Boolean).join(" "));
      setPayload(body);
      setAssumptions(structuredClone(body.assumptions));
      setBridge(structuredClone(body.bridge));
      setCurrentPrice(structuredClone(body.market.currentPrice));
    } catch (error) {
      setPayload(null);
      setAssumptions(null);
      setBridge(null);
      setCurrentPrice(null);
      setRequestError(error instanceof Error ? error.message : "Unable to retrieve verified source data.");
    } finally {
      setLoading(false);
    }
  }

  function updateScalar(key: ScalarKey, value: number | null) {
    setAssumptions((current) => {
      if (!current) return current;
      const next = { ...current, [key]: assumedValue(current[key], value) };
      if (key === "debtWeight" || key === "preferredWeight") {
        const debt = key === "debtWeight" ? value : current.debtWeight.value;
        const preferred = key === "preferredWeight" ? value : current.preferredWeight.value;
        const residual = debt !== null && preferred !== null ? 1 - debt - preferred : null;
        next.equityWeight = {
          value: residual,
          provenance: {
            origin: residual === null ? "missing" : "derived",
            label: "Equity weight",
            units: "%",
            notes: "Automatically derived as 100% less the user-selected debt and preferred weights.",
          },
        };
      }
      return next;
    });
  }

  function updateSeries(key: SeriesKey, index: number, value: number | null) {
    setAssumptions((current) => {
      if (!current) return current;
      const next = [...current[key]];
      next[index] = assumedValue(next[index], value);
      return { ...current, [key]: next };
    });
  }

  function updateBridge(key: BridgeKey, value: number | null) {
    setBridge((current) => current
      ? { ...current, [key]: assumedValue(current[key], value) }
      : current);
  }

  function updateProjectionYears(nextYears: number) {
    setAssumptions((current) => {
      if (!current) return current;
      const resize = (values: TaggedValue[]) => Array.from({ length: nextYears }, (_, index) =>
        values[index] ?? { ...values.at(-1)!, provenance: { ...values.at(-1)!.provenance } });
      return {
        ...current,
        projectionYears: nextYears,
        revenueGrowth: resize(current.revenueGrowth),
        ebitMargin: resize(current.ebitMargin),
        depreciationAmortizationPctRevenue: resize(current.depreciationAmortizationPctRevenue),
        stockBasedCompensationPctRevenue: resize(current.stockBasedCompensationPctRevenue),
        capitalExpendituresPctRevenue: resize(current.capitalExpendituresPctRevenue),
        netWorkingCapitalPctRevenue: resize(current.netWorkingCapitalPctRevenue),
        operatingTaxRate: resize(current.operatingTaxRate),
      };
    });
  }

  function resetAutomaticCase() {
    if (!payload) return;
    setAssumptions(structuredClone(payload.assumptions));
    setBridge(structuredClone(payload.bridge));
    setCurrentPrice(structuredClone(payload.market.currentPrice));
  }

  async function exportExcel() {
    if (!effectivePayload || !assumptions || !bridge || !result) return;
    const { downloadExcel } = await import("../../lib/export/excel-xml");
    await downloadExcel(effectivePayload, assumptions, bridge, result);
  }

  async function exportPdf() {
    if (!effectivePayload || !assumptions || !result) return;
    const { downloadPdf } = await import("../../lib/export/pdf");
    await downloadPdf(effectivePayload, assumptions, result);
  }

  const heroPrice = result?.impliedSharePriceGordon ?? null;
  const currentMarketPrice = currentPrice?.value ?? null;
  const annual = payload?.historicals.annual ?? [];
  const reviewItems = payload?.gaps.filter((gap) => gap.severity === "review") ?? [];
  const warningItems = payload?.gaps.filter((gap) => gap.severity === "warning") ?? [];
  const criticalItems = payload?.gaps.filter((gap) => gap.severity === "blocking") ?? [];
  const coverageValues: TaggedValue[] = assumptions && bridge && currentPrice ? [
    ...assumptions.revenueGrowth,
    ...assumptions.ebitMargin,
    ...assumptions.depreciationAmortizationPctRevenue,
    ...assumptions.stockBasedCompensationPctRevenue,
    ...assumptions.capitalExpendituresPctRevenue,
    ...assumptions.netWorkingCapitalPctRevenue,
    ...assumptions.operatingTaxRate,
    assumptions.terminalGrowth,
    assumptions.terminalRoic,
    assumptions.exitMultiple,
    assumptions.riskFreeRate,
    assumptions.equityRiskPremium,
    assumptions.releveredBeta,
    assumptions.countryRiskPremium,
    assumptions.sizePremium,
    assumptions.preTaxCostOfDebt,
    assumptions.debtWeight,
    assumptions.equityWeight,
    assumptions.preferredWeight,
    assumptions.preferredCost,
    assumptions.usableInterestTaxRate,
    ...Object.values(bridge),
    currentPrice,
  ] : [];
  const coverage = coverageValues.reduce((counts, value) => {
    counts[value.provenance.origin] += 1;
    return counts;
  }, { sourced: 0, derived: 0, assumed: 0, user: 0, missing: 0 });

  return (
    <main>
      <header className="site-header">
        <a className="brand" href="#top" aria-label="Banker Ready DCF home"><span>BR</span>Banker Ready DCF</a>
        <div className="header-meta"><StatusPill result={result} reviewCount={reviewItems.length} /><span>Sources checked {payload ? new Date(payload.generatedAt).toLocaleString() : "on request"}</span></div>
      </header>

      <section className="hero" id="top">
        <div className="hero-copy">
          <p className="eyebrow">Public-equity valuation · source to share price</p>
          <h1>A complete first view.<br />Every assumption visible.</h1>
          <p className="lede">Build an immediate, review-required first-pass DCF from filing history, analyst consensus, market inputs, and transparent bridge defaults. Edit any assumption and watch the per-share value update instantly.</p>
          <form className="ticker-form" onSubmit={loadTicker}>
            <label htmlFor="ticker">Enter a U.S. ticker</label>
            <div><input id="ticker" value={ticker} onChange={(event) => setTicker(event.target.value.toUpperCase())} placeholder="AAPL" maxLength={10} autoComplete="off" /><button disabled={loading}>{loading ? "Building the case…" : "Build valuation"}</button></div>
          </form>
          {requestError ? <div className="refusal"><strong>No valuation produced.</strong> {requestError}</div> : null}
          <div className="source-strip"><span><i className="dot source" />Sourced {payload ? coverage.sourced : ""}</span><span><i className="dot derived" />Derived {payload ? coverage.derived : ""}</span><span><i className="dot assumed" />Review {payload ? coverage.assumed : ""}</span><span><i className="dot user" />User {payload ? coverage.user : ""}</span><span><i className="dot missing" />Critical {payload ? criticalItems.length : ""}</span></div>
        </div>
        <aside className={`valuation-ticket ${result?.ready ? "ticket-ready" : ""}`}>
          <div className="ticket-kicker"><span>{payload?.identity.ticker ?? "—"}</span><span>{payload?.identity.exchange ?? "Awaiting issuer"}</span></div>
          <div className="ticket-company">{payload?.identity.name ?? "Traceable valuation starts with a ticker"}</div>
          <div className="ticket-rule" />
          <div className="ticket-price-label">Implied value / share</div>
          <div className="ticket-price">{money(heroPrice, 2)}</div>
          <div className="ticket-comparison"><span>Market {money(currentMarketPrice, 2)}</span><span className={(result?.upsideDownsideGordon ?? 0) >= 0 ? "positive" : "negative"}>{percent(result?.upsideDownsideGordon ?? null)}</span></div>
          <div className="ticket-grid"><div><span>WACC</span><strong>{percent(result?.wacc ?? null)}</strong></div><div><span>Terminal g</span><strong>{percent(assumptions?.terminalGrowth.value ?? null)}</strong></div><div><span>TV / EV</span><strong>{percent(result?.terminalValuePctEnterpriseValue ?? null)}</strong></div><div><span>Math</span><strong>{result?.ready ? "OK" : "OPEN"}</strong></div></div>
          <div className="ticket-footer">{result?.ready
            ? reviewItems.length
              ? `Calculation complete · ${reviewItems.length} judgment and source flags remain visible below`
              : "Calculation complete · no open review flags"
            : "Only critical mathematical or eligibility checks can block the output"}</div>
        </aside>
      </section>

      {payload && assumptions && bridge && result && currentPrice ? (
        <>
          <nav className="section-nav" aria-label="Model sections"><a href="#historicals">Historicals</a><a href="#assumptions">Assumptions</a><a href="#wacc">WACC</a><a href="#valuation">Valuation</a><a href="#sensitivities">Sensitivities</a><a href="#audit">Audit</a></nav>

          <section className="identity-bar">
            <div><span>Issuer</span><strong>{payload.identity.name}</strong></div><div><span>CIK</span><strong>{payload.identity.cik}</strong></div><div><span>Fiscal year end</span><strong>{payload.identity.fiscalYearEnd}</strong></div><div><span>Industry</span><strong>{payload.identity.sicDescription || payload.identity.sic}</strong></div><div><span>Latest interim</span><strong>{payload.historicals.latestInterim?.period.label ?? "Unavailable"}</strong></div>
          </section>

          <section className={`review-summary ${result.ready ? "review-summary-ready" : "review-summary-blocked"}`} aria-live="polite">
            <div>
              <p className="eyebrow">Automatic case status</p>
              <h2>{result.ready ? "Calculation complete — review required" : "Critical checks need attention"}</h2>
              <p>{result.ready
                ? "The base case is calculated, not approved. Review the highlighted judgments and source limitations, adjust your house view, and export when satisfied."
                : "The model preserved the automatic case but stopped on an eligibility or mathematical check that would make the per-share output unreliable."}</p>
            </div>
            <div className="review-metrics">
              <div><strong>{money(result.impliedSharePriceGordon, 2)}</strong><span>Gordon value / share</span></div>
              <div><strong>{reviewItems.length}</strong><span>Review items</span></div>
              <div><strong>{warningItems.length}</strong><span>Source warnings</span></div>
              <div><strong>{result.errors.length}</strong><span>Critical checks</span></div>
            </div>
            <a href="#audit">Open review queue ↓</a>
          </section>

          {!payload.identity.valuationMethodEligible ? <div className="method-refusal"><strong>FCFF method refused.</strong><p>{payload.identity.ineligibleReason}</p></div> : null}

          <section className="model-section" id="historicals">
            <div className="section-heading"><div><p className="eyebrow">01 · Filing base</p><h2>Historicals with a visible audit trail</h2></div><p>Five fiscal years plus the latest interim where standardized contexts resolve. Values are $mm; available source links open the underlying filing.</p></div>
            <div className="table-shell">
              <table className="financial-table"><thead><tr><th>Fiscal period</th>{annual.map((period) => <th key={period.period.endDate}>{period.period.label}<small>{period.period.endDate}</small></th>)}</tr></thead><tbody>
                {([
                  ["Revenue", (period: typeof annual[number]) => period.revenue],
                  ["EBIT", (period: typeof annual[number]) => period.ebit],
                  ["D&A", (period: typeof annual[number]) => period.depreciationAmortization],
                  ["Stock-based compensation", (period: typeof annual[number]) => period.stockBasedCompensation],
                  ["Capital expenditures", (period: typeof annual[number]) => period.capitalExpenditures],
                  ["Cash taxes", (period: typeof annual[number]) => period.cashTaxes],
                  ["Total debt", (period: typeof annual[number]) => period.totalDebt],
                  ["Cash & equivalents", (period: typeof annual[number]) => period.cash],
                  ["Diluted shares", (period: typeof annual[number]) => period.dilutedShares],
                ] as Array<[string, (period: typeof annual[number]) => TaggedValue]>).map(([label, getter]) => <tr key={label}><th>{label}</th>{annual.map((period) => { const value = getter(period); return <td key={period.period.endDate} className={value.value === null ? "missing-value" : ""}>{value.provenance.sourceUrl ? <a href={value.provenance.sourceUrl} target="_blank" rel="noreferrer">{number(value.value)}</a> : number(value.value)}<OriginBadge value={value} /></td>; })}</tr>)}
              </tbody></table>
            </div>
          </section>

          <section className="model-section" id="assumptions">
            <div className="section-heading"><div><p className="eyebrow">02 · Operating case</p><h2>Consensus first. Mature economics last.</h2></div><div className="control-pair"><label>Valuation date<input aria-label="Valuation date" type="date" value={assumptions.valuationDate} onChange={(event) => setAssumptions({ ...assumptions, valuationDate: event.target.value })} /></label><label>Forecast years<select value={assumptions.projectionYears} onChange={(event) => updateProjectionYears(Number(event.target.value))}>{[5, 6, 7, 8, 9, 10].map((year) => <option key={year}>{year}</option>)}</select></label><label>Discounting<select value={assumptions.discountingConvention} onChange={(event) => setAssumptions({ ...assumptions, discountingConvention: event.target.value as "mid-year" | "end-of-year" })}><option value="mid-year">Mid-year</option><option value="end-of-year">End-of-year</option></select></label><button type="button" className="reset-button" onClick={resetAutomaticCase}>Reset automatic case</button></div></div>
            <div className="assumption-grid-table"><div className="assumption-row header-row"><span>Driver</span>{result.projections.map((year) => <span key={year.fiscalYear}>{year.fiscalYear}E</span>)}</div>
              {([
                ["Revenue growth", "revenueGrowth"], ["EBIT margin", "ebitMargin"], ["D&A / revenue", "depreciationAmortizationPctRevenue"], ["SBC / revenue", "stockBasedCompensationPctRevenue"], ["Capex / revenue", "capitalExpendituresPctRevenue"], ["Operating NWC / revenue", "netWorkingCapitalPctRevenue"], ["Operating tax rate", "operatingTaxRate"],
              ] as Array<[string, SeriesKey]>).map(([label, key]) => <div className="assumption-row" key={key}><span>{label}<OriginBadge value={assumptions[key][0]} /></span>{assumptions[key].map((tagged, index) => <input key={index} aria-label={`${label} year ${index + 1}`} type="number" step="0.1" value={tagged.value === null ? "" : (tagged.value * 100).toFixed(2)} placeholder="Enter value" onChange={(event) => updateSeries(key, index, event.target.value === "" ? null : Number(event.target.value) / 100)} />)}</div>)}
            </div>
            <label htmlFor="sbc-addback" className="toggle-row"><input id="sbc-addback" aria-label="Add stock compensation back to free cash flow" type="checkbox" checked={assumptions.stockCompensationAddBack} onChange={(event) => setAssumptions({ ...assumptions, stockCompensationAddBack: event.target.checked })} /><span><strong>Add stock compensation back to FCF</strong><small>Off by default. SBC remains an economic cost; dilution is handled separately.</small></span></label>
            <div className="table-shell projection-output">
              <table className="financial-table"><thead><tr><th>FCFF build</th>{result.projections.map((year) => <th key={year.endDate}>{year.fiscalYear}E<small>{year.stubFraction < 1 ? `${percent(year.stubFraction, 1)} stub` : year.endDate}</small></th>)}</tr></thead><tbody>
                {([
                  ["Revenue", (year: DcfResult["projections"][number]) => year.revenue, false],
                  ["EBIT", (year: DcfResult["projections"][number]) => year.ebit, false],
                  ["NOPAT", (year: DcfResult["projections"][number]) => year.nopat, false],
                  ["D&A", (year: DcfResult["projections"][number]) => year.depreciationAmortization, false],
                  ["Capital expenditures", (year: DcfResult["projections"][number]) => -year.capitalExpenditures, false],
                  ["Change in operating NWC", (year: DcfResult["projections"][number]) => -year.changeInNetWorkingCapital, false],
                  ["Unlevered FCF", (year: DcfResult["projections"][number]) => year.unleveredFreeCashFlow, false],
                  ["Discount factor", (year: DcfResult["projections"][number]) => year.discountFactor, true],
                  ["PV of unlevered FCF", (year: DcfResult["projections"][number]) => year.presentValueOfFreeCashFlow, false],
                ] as Array<[string, (year: DcfResult["projections"][number]) => number, boolean]>).map(([label, getter, isPercent]) => <tr key={label}><th>{label}</th>{result.projections.map((year) => <td key={year.endDate}>{isPercent ? percent(getter(year), 1) : number(getter(year))}</td>)}</tr>)}
              </tbody></table>
            </div>
          </section>

          <section className="model-section split-section" id="wacc">
            <div>
              <div className="section-heading compact"><div><p className="eyebrow">03 · Discount rate</p><h2>WACC from components, never a plug.</h2></div></div>
              <div className="field-card">
                <EditableField label="Risk-free rate" tagged={assumptions.riskFreeRate} scale={100} suffix="%" onChange={(value) => updateScalar("riskFreeRate", value)} />
                <EditableField label="Equity risk premium" tagged={assumptions.equityRiskPremium} scale={100} suffix="%" onChange={(value) => updateScalar("equityRiskPremium", value)} />
                <EditableField label="Levered beta" tagged={assumptions.releveredBeta} suffix="x" onChange={(value) => updateScalar("releveredBeta", value)} />
                <EditableField label="Country risk premium" tagged={assumptions.countryRiskPremium} scale={100} suffix="%" onChange={(value) => updateScalar("countryRiskPremium", value)} />
                <EditableField label="Size premium" tagged={assumptions.sizePremium} scale={100} suffix="%" onChange={(value) => updateScalar("sizePremium", value)} />
                <EditableField label="Pre-tax cost of debt" tagged={assumptions.preTaxCostOfDebt} scale={100} suffix="%" onChange={(value) => updateScalar("preTaxCostOfDebt", value)} />
                <EditableField label="Usable interest tax rate" tagged={assumptions.usableInterestTaxRate} scale={100} suffix="%" onChange={(value) => updateScalar("usableInterestTaxRate", value)} />
                <EditableField label="Debt weight" tagged={assumptions.debtWeight} scale={100} suffix="%" min={0} max={100} onChange={(value) => updateScalar("debtWeight", value)} />
                <EditableField label="Equity weight (residual)" tagged={assumptions.equityWeight} scale={100} suffix="%" min={0} max={100} readOnly onChange={() => undefined} />
                <EditableField label="Preferred weight" tagged={assumptions.preferredWeight} scale={100} suffix="%" min={0} max={100} onChange={(value) => updateScalar("preferredWeight", value)} />
                <EditableField label="Preferred cost" tagged={assumptions.preferredCost} scale={100} suffix="%" onChange={(value) => updateScalar("preferredCost", value)} />
              </div>
            </div>
            <aside className="wacc-build">
              <p>Live WACC build</p><div><span>Cost of equity</span><strong>{percent(result.costOfEquity)}</strong></div><code>Rf + β × ERP + CRP + Size</code><div><span>After-tax cost of debt</span><strong>{percent(result.afterTaxCostOfDebt)}</strong></div><code>Kd × (1 − usable tax rate)</code><div className="wacc-total"><span>Weighted average cost of capital</span><strong>{percent(result.wacc)}</strong></div>
              <h3>Beta source</h3>{payload.market.peerBetas.length ? <table className="peer-table"><thead><tr><th>Peer</th><th>Raw β</th><th>D/E</th><th>Unlev. β</th></tr></thead><tbody>{payload.market.peerBetas.map((peer) => <tr key={peer.ticker}><td><a href={peer.sourceUrl} target="_blank" rel="noreferrer">{peer.ticker}</a></td><td>{peer.rawBeta.toFixed(2)}</td><td>{percent(peer.debtToEquity)}</td><td>{peer.unleveredBeta.toFixed(2)}</td></tr>)}</tbody></table> : <p className="gap-copy">The automatic case uses the sourced subject-company levered beta above to avoid a high-volume market-data burst. Replace it with a reviewed bottom-up beta when your process requires one.</p>}
            </aside>
          </section>

          <section className="model-section" id="valuation">
            <div className="section-heading"><div><p className="eyebrow">04 · Intrinsic value</p><h2>Intrinsic value first. Market cross-check second.</h2></div><p>Gordon growth calculates independently as the primary method. The exit multiple remains an editable market cross-check and never holds the intrinsic answer hostage.</p></div>
            <div className="terminal-grid"><EditableField label="Terminal growth" tagged={assumptions.terminalGrowth} scale={100} suffix="%" onChange={(value) => updateScalar("terminalGrowth", value)} /><EditableField label="Terminal ROIC" tagged={assumptions.terminalRoic} scale={100} suffix="%" onChange={(value) => updateScalar("terminalRoic", value)} /><EditableField label="Exit EV / EBITDA" tagged={assumptions.exitMultiple} suffix="x" onChange={(value) => updateScalar("exitMultiple", value)} /></div>
            {result.warnings.length ? <div className="warning-stack">{result.warnings.map((warning) => <p key={warning}>Review · {warning}</p>)}</div> : null}
            <div className="valuation-methods"><article><p>Gordon growth</p><strong>{money(result.impliedSharePriceGordon, 2)}</strong><span>EV {money(result.enterpriseValueGordon)}mm</span><span>Implied exit {multiple(result.impliedExitMultiple)}</span></article><article><p>Exit multiple</p><strong>{money(result.impliedSharePriceExit, 2)}</strong><span>EV {money(result.enterpriseValueExit)}mm</span><span>Implied growth {percent(result.impliedPerpetuityGrowth)}</span></article><article className={result.terminalValuePctEnterpriseValue !== null && result.terminalValuePctEnterpriseValue > 0.75 ? "risk-card" : ""}><p>Terminal dependence</p><strong>{percent(result.terminalValuePctEnterpriseValue)}</strong><span>Visible warning above 75%</span><span>GDP ceiling {percent(payload.market.terminalGdpGrowth.value)}</span></article></div>
            <div className="terminal-state"><div><span>Terminal NOPAT</span><strong>{money(result.terminalNopat)}mm</strong></div><div><span>Reinvestment rate (g / ROIC)</span><strong>{percent(result.terminalReinvestmentRate)}</strong></div><div><span>Terminal FCFF</span><strong>{money(result.terminalFreeCashFlow)}mm</strong></div><div><span>Terminal discount factor</span><strong>{percent(result.terminalDiscountFactor)}</strong></div></div>
            <div className="bridge-layout"><div className="field-card bridge-fields"><h3>Enterprise-to-equity bridge</h3>{([
              ["Cash and equivalents", "cash"], ["Operating cash requirement", "operatingCashRequirement"], ["Short-term investments", "shortTermInvestments"], ["Total debt", "debt"], ["Finance lease liabilities", "financeLeaseLiabilities"], ["Operating lease debt adjustment", "operatingLeaseLiabilities"], ["Other debt-like liabilities", "otherDebtLikeLiabilities"], ["Minority interest", "minorityInterest"], ["Preferred stock", "preferredStock"], ["Non-operating investments", "equityMethodInvestments"], ["Other non-operating assets", "otherNonOperatingAssets"], ["PV of usable NOLs", "presentValueOfNols"], ["Current shares outstanding", "basicShares"], ["Options outstanding", "options"], ["Weighted-average strike", "optionStrikePrice"], ["RSUs / dilution proxy", "rsus"],
            ] as Array<[string, BridgeKey]>).map(([label, key]) => <EditableField key={key} label={label} tagged={bridge[key]} suffix={key.includes("Shares") || key === "options" || key === "rsus" ? "mm" : key === "optionStrikePrice" ? "$" : "$mm"} onChange={(value) => updateBridge(key, value)} />)}<EditableField label="Current market price" tagged={currentPrice} suffix="$" onChange={(value) => setCurrentPrice(assumedValue(currentPrice, value))} /></div>
              <div className="waterfall"><h3>Value bridge</h3>{([
                ["Enterprise value", result.enterpriseValueGordon], ["Excess cash + investments", bridge.cash.value !== null && bridge.operatingCashRequirement.value !== null && bridge.shortTermInvestments.value !== null ? bridge.cash.value - bridge.operatingCashRequirement.value + bridge.shortTermInvestments.value : null], ["Debt + debt-like claims", bridge.debt.value !== null && bridge.financeLeaseLiabilities.value !== null && bridge.operatingLeaseLiabilities.value !== null && bridge.otherDebtLikeLiabilities.value !== null ? -(bridge.debt.value + bridge.financeLeaseLiabilities.value + bridge.operatingLeaseLiabilities.value + bridge.otherDebtLikeLiabilities.value) : null], ["Other claims / assets", result.bridgeAdjustments !== null && bridge.cash.value !== null && bridge.operatingCashRequirement.value !== null && bridge.shortTermInvestments.value !== null && bridge.debt.value !== null && bridge.financeLeaseLiabilities.value !== null && bridge.operatingLeaseLiabilities.value !== null && bridge.otherDebtLikeLiabilities.value !== null ? result.bridgeAdjustments - bridge.cash.value + bridge.operatingCashRequirement.value - bridge.shortTermInvestments.value + bridge.debt.value + bridge.financeLeaseLiabilities.value + bridge.operatingLeaseLiabilities.value + bridge.otherDebtLikeLiabilities.value : null], ["Common equity value", result.commonEquityValueGordon],
              ] as Array<[string, number | null]>).map(([label, value], index) => <div className="waterfall-row" key={label}><span>{label}</span><div><i style={{ width: value === null || result.enterpriseValueGordon === null ? "0%" : `${Math.min(100, Math.abs(value) / Math.abs(result.enterpriseValueGordon) * 100)}%` }} className={value !== null && value < 0 ? "negative-bar" : index === 4 ? "total-bar" : "positive-bar"} /></div><strong>{money(value)}mm</strong></div>)}</div>
            </div>
          </section>

          <section className="model-section" id="sensitivities">
            <div className="section-heading"><div><p className="eyebrow">05 · Range, not false precision</p><h2>Sensitivities and market cross-checks</h2></div></div>
            <div className="sensitivity-grid"><div><h3>WACC × perpetuity growth</h3><SensitivityTable result={result} assumptions={assumptions} currentPrice={currentMarketPrice} kind="growth" /></div><div><h3>WACC × exit multiple</h3><SensitivityTable result={result} assumptions={assumptions} currentPrice={currentMarketPrice} kind="multiple" /></div></div>
            <div className="football"><h3>Valuation football field</h3>{([
              ["DCF — Gordon", result.wacc !== null && assumptions.terminalGrowth.value !== null ? valueAt(result, assumptions, result.wacc + 0.01, assumptions.terminalGrowth.value - 0.01) : null, result.wacc !== null && assumptions.terminalGrowth.value !== null ? valueAt(result, assumptions, result.wacc - 0.01, assumptions.terminalGrowth.value + 0.01) : null],
              ["DCF — Exit multiple", result.wacc !== null && assumptions.exitMultiple.value !== null && assumptions.terminalGrowth.value !== null ? valueAt(result, assumptions, result.wacc + 0.01, assumptions.terminalGrowth.value, assumptions.exitMultiple.value - 2) : null, result.wacc !== null && assumptions.exitMultiple.value !== null && assumptions.terminalGrowth.value !== null ? valueAt(result, assumptions, result.wacc - 0.01, assumptions.terminalGrowth.value, assumptions.exitMultiple.value + 2) : null],
              ["52-week trading range", payload.market.fiftyTwoWeekLow.value, payload.market.fiftyTwoWeekHigh.value],
            ] as Array<[string, number | null, number | null]>).map(([label, low, high]) => <div className="football-row" key={label}><span>{label}</span><div className="football-track">{low !== null && high !== null ? <i style={{ left: `${Math.max(0, Math.min(85, low / Math.max(high, heroPrice ?? high) * 70))}%`, width: `${Math.max(6, (high - low) / Math.max(high, heroPrice ?? high) * 70)}%` }} /> : <em>Unavailable — no value invented</em>}</div><strong>{low === null || high === null ? "—" : `${money(low, 2)} – ${money(high, 2)}`}</strong></div>)}<p>Comparable-company and precedent-transaction ranges appear only when defensible datasets are available; neither is fabricated from the DCF itself.</p></div>
          </section>

          <section className="model-section audit-section" id="audit">
            <div className="section-heading"><div><p className="eyebrow">06 · Control room</p><h2>Calculate first. Review with full context.</h2><p className="audit-intro">Exports remain formula-driven and carry the same sourced, derived, and review labels as the live model.</p></div><div className="export-actions"><button disabled={!result.ready} onClick={() => void exportExcel()}>Export formula-driven .xlsx</button><button className="secondary" disabled={!result.ready} onClick={() => void exportPdf()}>Export PDF review pack</button></div></div>
            <div className="audit-grid"><div className="check-list"><h3>Critical model checks</h3>{result.errors.length ? result.errors.map((error) => <div className="check-row fail" key={error}><span>OPEN</span><p>{error}</p></div>) : <div className="check-row pass"><span>OK</span><p>The valuation, bridge, dilution, and stable-growth mathematics all pass.</p></div>}</div><div className="gap-list"><h3>Review queue</h3>{payload.gaps.length ? payload.gaps.map((gap) => <div className={`gap-${gap.severity}`} key={`${gap.severity}-${gap.field}`}><OriginBadge value={{ value: null, provenance: { origin: gap.severity === "blocking" ? "missing" : gap.severity === "review" ? "assumed" : "derived", label: gap.field } }} /><p><strong>{gap.field}</strong>{gap.reason}</p></div>) : <p>No review or source-coverage items were reported.</p>}</div></div>
            <div className="self-check"><strong>Self-check</strong><span>Consensus-to-mature forecast</span><span>Independent Gordon method</span><span>Lease-consistent bridge</span><span>Diluted-share proxy fallback</span><span>Reciprocal checks</span><span>Formula export</span></div>
          </section>
        </>
      ) : <section className="preflight"><div><span>01</span><strong>Assemble the evidence</strong><p>Resolve filing history, latest market inputs, analyst consensus, shares, and bridge facts.</p></div><div><span>02</span><strong>Build the automatic case</strong><p>Use sourced inputs first, then transparent derived values and conservative review defaults.</p></div><div><span>03</span><strong>Show the answer</strong><p>Calculate the base per-share value immediately, with sensitivities and every review item visible.</p></div></section>}

      <footer><span>Banker Ready DCF</span><p>Valuation is an analytical opinion, not investment advice. Review defaults are disclosed and editable; critical model errors still stop the output.</p><a href="https://github.com/Chatur05/banker-ready-dcf" target="_blank" rel="noreferrer">GitHub ↗</a></footer>
    </main>
  );
}

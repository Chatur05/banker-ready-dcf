"use client";

import { useMemo, useState } from "react";
import { downloadExcel } from "../../lib/export/excel-xml";
import { downloadPdf } from "../../lib/export/pdf";
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
      origin: value === null ? "missing" : "assumed",
      label: current.provenance.label,
      units: current.provenance.units,
      notes: "User-entered assumption; replaces the prior sourced or derived default.",
    },
  };
}

function OriginBadge({ value }: { value: TaggedValue }) {
  return <span className={`origin origin-${value.provenance.origin}`}>{value.provenance.origin}</span>;
}

function EditableField({
  label,
  tagged,
  onChange,
  scale = 1,
  suffix,
}: {
  label: string;
  tagged: TaggedValue;
  onChange: (value: number | null) => void;
  scale?: number;
  suffix?: string;
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
          value={tagged.value === null ? "" : tagged.value * scale}
          placeholder="Required"
          onChange={(event) => onChange(event.target.value === "" ? null : Number(event.target.value) / scale)}
        />
        {suffix ? <span>{suffix}</span> : null}
      </span>
      <span className="field-note">
        {tagged.provenance.sourceUrl
          ? <a href={tagged.provenance.sourceUrl} target="_blank" rel="noreferrer">Source · {tagged.provenance.asOf ?? tagged.provenance.filingDate}</a>
          : tagged.provenance.notes}
      </span>
    </label>
  );
}

function StatusPill({ result }: { result: DcfResult | null }) {
  if (!result) return <span className="status-pill neutral"><span />Awaiting ticker</span>;
  if (result.ready) return <span className="status-pill pass"><span />Valuation complete</span>;
  return <span className="status-pill fail"><span />Blocked · {result.errors.length} required inputs</span>;
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
  if (result.wacc === null || assumptions.terminalGrowth.value === null || assumptions.exitMultiple.value === null) {
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
    setAssumptions((current) => current
      ? { ...current, [key]: assumedValue(current[key], value) }
      : current);
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

  const heroPrice = result?.impliedSharePriceGordon ?? null;
  const currentMarketPrice = currentPrice?.value ?? null;
  const annual = payload?.historicals.annual ?? [];

  return (
    <main>
      <header className="site-header">
        <a className="brand" href="#top" aria-label="Banker Ready DCF home"><span>BR</span>Banker Ready DCF</a>
        <div className="header-meta"><StatusPill result={result} /><span>Sources checked {payload ? new Date(payload.generatedAt).toLocaleString() : "on request"}</span></div>
      </header>

      <section className="hero" id="top">
        <div className="hero-copy">
          <p className="eyebrow">Public-equity valuation · source to share price</p>
          <h1>Every number has<br />somewhere to go back to.</h1>
          <p className="lede">A filing-led DCF that refuses to turn a missing fact into a confident answer. SEC historicals, first-principles WACC, dual terminal methods, a full equity bridge, and formulas you can audit.</p>
          <form className="ticker-form" onSubmit={loadTicker}>
            <label htmlFor="ticker">Enter a U.S. ticker</label>
            <div><input id="ticker" value={ticker} onChange={(event) => setTicker(event.target.value.toUpperCase())} placeholder="AAPL" maxLength={10} autoComplete="off" /><button disabled={loading}>{loading ? "Tracing filings…" : "Build valuation"}</button></div>
          </form>
          {requestError ? <div className="refusal"><strong>No valuation produced.</strong> {requestError}</div> : null}
          <div className="source-strip"><span><i className="dot source" />Sourced</span><span><i className="dot derived" />Derived</span><span><i className="dot assumed" />Assumed</span><span><i className="dot missing" />Missing blocks output</span></div>
        </div>
        <aside className={`valuation-ticket ${result?.ready ? "ticket-ready" : ""}`}>
          <div className="ticket-kicker"><span>{payload?.identity.ticker ?? "—"}</span><span>{payload?.identity.exchange ?? "Awaiting issuer"}</span></div>
          <div className="ticket-company">{payload?.identity.name ?? "Traceable valuation starts with a ticker"}</div>
          <div className="ticket-rule" />
          <div className="ticket-price-label">Implied value / share</div>
          <div className="ticket-price">{money(heroPrice, 2)}</div>
          <div className="ticket-comparison"><span>Market {money(currentMarketPrice, 2)}</span><span className={(result?.upsideDownsideGordon ?? 0) >= 0 ? "positive" : "negative"}>{percent(result?.upsideDownsideGordon ?? null)}</span></div>
          <div className="ticket-grid"><div><span>WACC</span><strong>{percent(result?.wacc ?? null)}</strong></div><div><span>Terminal g</span><strong>{percent(assumptions?.terminalGrowth.value ?? null)}</strong></div><div><span>TV / EV</span><strong>{percent(result?.terminalValuePctEnterpriseValue ?? null)}</strong></div><div><span>Checks</span><strong>{result?.ready ? "PASS" : "OPEN"}</strong></div></div>
          <div className="ticket-footer">{result?.ready ? "Ready for workbook export" : "Output remains disabled until every required input is resolved"}</div>
        </aside>
      </section>

      {payload && assumptions && bridge && result && currentPrice ? (
        <>
          <nav className="section-nav" aria-label="Model sections"><a href="#historicals">Historicals</a><a href="#assumptions">Assumptions</a><a href="#wacc">WACC</a><a href="#valuation">Valuation</a><a href="#sensitivities">Sensitivities</a><a href="#audit">Audit</a></nav>

          <section className="identity-bar">
            <div><span>Issuer</span><strong>{payload.identity.name}</strong></div><div><span>CIK</span><strong>{payload.identity.cik}</strong></div><div><span>Fiscal year end</span><strong>{payload.identity.fiscalYearEnd}</strong></div><div><span>Industry</span><strong>{payload.identity.sicDescription || payload.identity.sic}</strong></div><div><span>Latest interim</span><strong>{payload.historicals.latestInterim?.period.label ?? "Unavailable"}</strong></div>
          </section>

          {!payload.identity.valuationMethodEligible ? <div className="method-refusal"><strong>FCFF method refused.</strong><p>{payload.identity.ineligibleReason}</p></div> : null}

          <section className="model-section" id="historicals">
            <div className="section-heading"><div><p className="eyebrow">01 · Filing base</p><h2>Historicals that click back to the 10-K</h2></div><p>Five fiscal years plus the latest interim where SEC contexts resolve. Values are $mm; source links open the actual filing.</p></div>
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
            <div className="section-heading"><div><p className="eyebrow">02 · Operating case</p><h2>Defaults seeded from history. Nothing buried.</h2></div><div className="control-pair"><label>Valuation date<input aria-label="Valuation date" type="date" value={assumptions.valuationDate} onChange={(event) => setAssumptions({ ...assumptions, valuationDate: event.target.value })} /></label><label>Forecast years<select value={assumptions.projectionYears} onChange={(event) => updateProjectionYears(Number(event.target.value))}>{[5, 6, 7, 8, 9, 10].map((year) => <option key={year}>{year}</option>)}</select></label><label>Discounting<select value={assumptions.discountingConvention} onChange={(event) => setAssumptions({ ...assumptions, discountingConvention: event.target.value as "mid-year" | "end-of-year" })}><option value="mid-year">Mid-year</option><option value="end-of-year">End-of-year</option></select></label></div></div>
            <div className="assumption-grid-table"><div className="assumption-row header-row"><span>Driver</span>{result.projections.map((year) => <span key={year.fiscalYear}>{year.fiscalYear}E</span>)}</div>
              {([
                ["Revenue growth", "revenueGrowth"], ["EBIT margin", "ebitMargin"], ["D&A / revenue", "depreciationAmortizationPctRevenue"], ["SBC / revenue", "stockBasedCompensationPctRevenue"], ["Capex / revenue", "capitalExpendituresPctRevenue"], ["Operating NWC / revenue", "netWorkingCapitalPctRevenue"], ["Operating tax rate", "operatingTaxRate"],
              ] as Array<[string, SeriesKey]>).map(([label, key]) => <div className="assumption-row" key={key}><span>{label}<OriginBadge value={assumptions[key][0]} /></span>{assumptions[key].map((tagged, index) => <input key={index} aria-label={`${label} year ${index + 1}`} type="number" step="0.1" value={tagged.value === null ? "" : (tagged.value * 100).toFixed(2)} placeholder="Required" onChange={(event) => updateSeries(key, index, event.target.value === "" ? null : Number(event.target.value) / 100)} />)}</div>)}
            </div>
            <label htmlFor="sbc-addback" className="toggle-row"><input id="sbc-addback" aria-label="Add stock compensation back to free cash flow" type="checkbox" checked={assumptions.stockCompensationAddBack} onChange={(event) => setAssumptions({ ...assumptions, stockCompensationAddBack: event.target.checked })} /><span><strong>Add stock compensation back to FCF</strong><small>Off by default. SBC remains an economic cost; dilution is handled separately.</small></span></label>
          </section>

          <section className="model-section split-section" id="wacc">
            <div>
              <div className="section-heading compact"><div><p className="eyebrow">03 · Discount rate</p><h2>WACC from components, never a plug.</h2></div></div>
              <div className="field-card">
                <EditableField label="Risk-free rate" tagged={assumptions.riskFreeRate} scale={100} suffix="%" onChange={(value) => updateScalar("riskFreeRate", value)} />
                <EditableField label="Equity risk premium" tagged={assumptions.equityRiskPremium} scale={100} suffix="%" onChange={(value) => updateScalar("equityRiskPremium", value)} />
                <EditableField label="Relevered peer beta" tagged={assumptions.releveredBeta} suffix="x" onChange={(value) => updateScalar("releveredBeta", value)} />
                <EditableField label="Country risk premium" tagged={assumptions.countryRiskPremium} scale={100} suffix="%" onChange={(value) => updateScalar("countryRiskPremium", value)} />
                <EditableField label="Size premium" tagged={assumptions.sizePremium} scale={100} suffix="%" onChange={(value) => updateScalar("sizePremium", value)} />
                <EditableField label="Pre-tax cost of debt" tagged={assumptions.preTaxCostOfDebt} scale={100} suffix="%" onChange={(value) => updateScalar("preTaxCostOfDebt", value)} />
                <EditableField label="Usable interest tax rate" tagged={assumptions.usableInterestTaxRate} scale={100} suffix="%" onChange={(value) => updateScalar("usableInterestTaxRate", value)} />
                <EditableField label="Debt weight" tagged={assumptions.debtWeight} scale={100} suffix="%" onChange={(value) => updateScalar("debtWeight", value)} />
                <EditableField label="Equity weight" tagged={assumptions.equityWeight} scale={100} suffix="%" onChange={(value) => updateScalar("equityWeight", value)} />
                <EditableField label="Preferred weight" tagged={assumptions.preferredWeight} scale={100} suffix="%" onChange={(value) => updateScalar("preferredWeight", value)} />
                <EditableField label="Preferred cost" tagged={assumptions.preferredCost} scale={100} suffix="%" onChange={(value) => updateScalar("preferredCost", value)} />
              </div>
            </div>
            <aside className="wacc-build">
              <p>Live WACC build</p><div><span>Cost of equity</span><strong>{percent(result.costOfEquity)}</strong></div><code>Rf + β × ERP + CRP + Size</code><div><span>After-tax cost of debt</span><strong>{percent(result.afterTaxCostOfDebt)}</strong></div><code>Kd × (1 − usable tax rate)</code><div className="wacc-total"><span>Weighted average cost of capital</span><strong>{percent(result.wacc)}</strong></div>
              <h3>Bottom-up beta set</h3>{payload.market.peerBetas.length ? <table className="peer-table"><thead><tr><th>Peer</th><th>Raw β</th><th>D/E</th><th>Unlev. β</th></tr></thead><tbody>{payload.market.peerBetas.map((peer) => <tr key={peer.ticker}><td><a href={peer.sourceUrl} target="_blank" rel="noreferrer">{peer.ticker}</a></td><td>{peer.rawBeta.toFixed(2)}</td><td>{percent(peer.debtToEquity)}</td><td>{peer.unleveredBeta.toFixed(2)}</td></tr>)}</tbody></table> : <p className="gap-copy">Peer history unavailable. Enter a labeled beta assumption or configure the market-data key.</p>}
            </aside>
          </section>

          <section className="model-section" id="valuation">
            <div className="section-heading"><div><p className="eyebrow">04 · Intrinsic value</p><h2>Two terminal methods. One explicit bridge.</h2></div><p>Gordon growth is primary; exit multiple is a market cross-check. Reciprocal outputs make inconsistency visible.</p></div>
            <div className="terminal-grid"><EditableField label="Terminal growth" tagged={assumptions.terminalGrowth} scale={100} suffix="%" onChange={(value) => updateScalar("terminalGrowth", value)} /><EditableField label="Terminal ROIC" tagged={assumptions.terminalRoic} scale={100} suffix="%" onChange={(value) => updateScalar("terminalRoic", value)} /><EditableField label="Exit EV / EBITDA" tagged={assumptions.exitMultiple} suffix="x" onChange={(value) => updateScalar("exitMultiple", value)} /></div>
            {result.warnings.length ? <div className="warning-stack">{result.warnings.map((warning) => <p key={warning}>Review · {warning}</p>)}</div> : null}
            <div className="valuation-methods"><article><p>Gordon growth</p><strong>{money(result.impliedSharePriceGordon, 2)}</strong><span>EV {money(result.enterpriseValueGordon)}mm</span><span>Implied exit {multiple(result.impliedExitMultiple)}</span></article><article><p>Exit multiple</p><strong>{money(result.impliedSharePriceExit, 2)}</strong><span>EV {money(result.enterpriseValueExit)}mm</span><span>Implied growth {percent(result.impliedPerpetuityGrowth)}</span></article><article className={result.terminalValuePctEnterpriseValue !== null && result.terminalValuePctEnterpriseValue > 0.75 ? "risk-card" : ""}><p>Terminal dependence</p><strong>{percent(result.terminalValuePctEnterpriseValue)}</strong><span>Visible warning above 75%</span><span>GDP ceiling {percent(payload.market.terminalGdpGrowth.value)}</span></article></div>
            <div className="bridge-layout"><div className="field-card bridge-fields"><h3>Enterprise-to-equity bridge</h3>{([
              ["Cash and equivalents", "cash"], ["Short-term investments", "shortTermInvestments"], ["Total debt", "debt"], ["Finance lease liabilities", "financeLeaseLiabilities"], ["Operating lease liabilities", "operatingLeaseLiabilities"], ["Minority interest", "minorityInterest"], ["Preferred stock", "preferredStock"], ["Equity-method investments", "equityMethodInvestments"], ["PV of usable NOLs", "presentValueOfNols"], ["Basic shares", "basicShares"], ["Options outstanding", "options"], ["Weighted-average strike", "optionStrikePrice"], ["RSUs", "rsus"],
            ] as Array<[string, BridgeKey]>).map(([label, key]) => <EditableField key={key} label={label} tagged={bridge[key]} suffix={key.includes("Shares") || key === "options" || key === "rsus" ? "mm" : key === "optionStrikePrice" ? "$" : "$mm"} onChange={(value) => updateBridge(key, value)} />)}<EditableField label="Current market price" tagged={currentPrice} suffix="$" onChange={(value) => setCurrentPrice(assumedValue(currentPrice, value))} /></div>
              <div className="waterfall"><h3>Value bridge</h3>{([
                ["Enterprise value", result.enterpriseValueGordon], ["Cash + investments", bridge.cash.value !== null && bridge.shortTermInvestments.value !== null ? bridge.cash.value + bridge.shortTermInvestments.value : null], ["Debt + leases", bridge.debt.value !== null && bridge.financeLeaseLiabilities.value !== null && bridge.operatingLeaseLiabilities.value !== null ? -(bridge.debt.value + bridge.financeLeaseLiabilities.value + bridge.operatingLeaseLiabilities.value) : null], ["Other claims / assets", result.bridgeAdjustments !== null && bridge.cash.value !== null && bridge.shortTermInvestments.value !== null && bridge.debt.value !== null && bridge.financeLeaseLiabilities.value !== null && bridge.operatingLeaseLiabilities.value !== null ? result.bridgeAdjustments - bridge.cash.value - bridge.shortTermInvestments.value + bridge.debt.value + bridge.financeLeaseLiabilities.value + bridge.operatingLeaseLiabilities.value : null], ["Common equity value", result.commonEquityValueGordon],
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
            <div className="section-heading"><div><p className="eyebrow">06 · Control room</p><h2>Nothing leaves while a critical check is open.</h2></div><div className="export-actions"><button disabled={!result.ready} onClick={() => downloadExcel(effectivePayload!, assumptions, bridge, result)}>Export live-formula Excel</button><button className="secondary" disabled={!result.ready} onClick={() => downloadPdf(effectivePayload!, assumptions, result)}>Export PDF one-pager</button></div></div>
            <div className="audit-grid"><div className="check-list"><h3>Model checks</h3>{result.errors.length ? result.errors.map((error) => <div className="check-row fail" key={error}><span>OPEN</span><p>{error}</p></div>) : <div className="check-row pass"><span>OK</span><p>All required valuation, bridge, dilution, and terminal checks pass.</p></div>}</div><div className="gap-list"><h3>Source coverage</h3>{payload.gaps.length ? payload.gaps.map((gap) => <div key={gap.field}><OriginBadge value={{ value: null, provenance: { origin: gap.severity === "blocking" ? "missing" : "derived", label: gap.field } }} /><p><strong>{gap.field}</strong>{gap.reason}</p></div>) : <p>No source gaps were reported.</p>}</div></div>
            <div className="self-check"><strong>Self-check</strong><span>No hardcoded WACC</span><span>Debt + leases + NCI + preferred shown</span><span>Treasury-stock dilution</span><span>Dual terminal methods</span><span>Reciprocal checks</span><span>Formula export</span></div>
          </section>
        </>
      ) : <section className="preflight"><div><span>01</span><strong>Trace SEC contexts</strong><p>Resolve five annual periods, latest interim, units, filings, and bridge facts.</p></div><div><span>02</span><strong>Derive the case</strong><p>Seed editable operating drivers from historical medians and mature-state economics.</p></div><div><span>03</span><strong>Earn the answer</strong><p>Build WACC, terminal values, dilution, sensitivities, and exports only after checks pass.</p></div></section>}

      <footer><span>Banker Ready DCF</span><p>Valuation is an analytical opinion, not investment advice. Missing facts stop the model by design.</p><a href="https://github.com/Chatur05/banker-ready-dcf" target="_blank" rel="noreferrer">GitHub ↗</a></footer>
    </main>
  );
}

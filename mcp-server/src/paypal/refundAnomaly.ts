import type { PayPalLedger } from './types.js';

const DAY = 86_400_000;
const round2 = (n: number) => Math.round(n * 100) / 100;
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
const eur = (n: number) => new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR' }).format(n);

export type AnomalyDimension = 'reason' | 'product' | 'segment' | 'customer';
export type AnomalyBreakdownRow = {
  key: string;
  refunds: number;
  refunded: number;
  share_of_window_refunds: number;
  captured_in_window: number;
  window_rate: number | null;
  baseline_rate: number | null;
  /** Refunded in the window above what this group's own baseline rate would predict. */
  excess_refunded: number;
  share_of_excess: number;
  text: string;
};

export type RefundAnomaly = {
  mode: PayPalLedger['mode'];
  anchor_date: string;
  window_days: number;
  window: { start: string; end: string };
  baseline: { start: string; end: string };
  window_refunded: number;
  window_captured: number;
  window_rate: number;
  baseline_refunded: number;
  baseline_captured: number;
  baseline_rate: number;
  multiple: number | null;
  spike: boolean;
  excess_refunded: number;
  breakdowns: Record<AnomalyDimension, AnomalyBreakdownRow[]>;
  top_driver: { dimension: AnomalyDimension; key: string; share_of_excess: number } | null;
  formatted: Record<string, string>;
  headline: string;
  definition: string;
};

/**
 * Read-only refund anomaly explanation computed from the ledger. Same definition as the Money Desk
 * refund-rate tile: refunds dated in the window divided by captures dated in the window (EUR), compared
 * with the same ratio over all earlier ledger days. Every figure the agent quotes comes from here.
 */
export function explainRefundAnomaly(ledger: PayPalLedger, windowDays = 7): RefundAnomaly {
  const days = Math.max(1, Math.min(30, Math.floor(windowDays)));
  const anchor = Date.parse(`${ledger.anchor_date}T00:00:00Z`);
  const start = new Date(anchor - (days - 1) * DAY).toISOString().slice(0, 10);
  const firstDay = [...ledger.captures.map((c) => c.date), ...ledger.refunds.map((r) => r.date)].sort()[0] ?? start;
  const beforeStart = new Date(Date.parse(`${start}T00:00:00Z`) - DAY).toISOString().slice(0, 10);
  const inWindow = (date: string) => date >= start && date <= ledger.anchor_date;
  const inBaseline = (date: string) => date < start;
  const sum = (values: number[]) => round2(values.reduce((t, v) => t + v, 0));

  const windowRefunds = ledger.refunds.filter((r) => inWindow(r.date));
  const baselineRefunds = ledger.refunds.filter((r) => inBaseline(r.date));
  const windowCaptures = ledger.captures.filter((c) => inWindow(c.date));
  const baselineCaptures = ledger.captures.filter((c) => inBaseline(c.date));
  const windowRefunded = sum(windowRefunds.map((r) => r.amount));
  const windowCaptured = sum(windowCaptures.map((c) => c.gross));
  const baselineRefunded = sum(baselineRefunds.map((r) => r.amount));
  const baselineCaptured = sum(baselineCaptures.map((c) => c.gross));
  const windowRate = windowCaptured ? windowRefunded / windowCaptured : 0;
  const baselineRate = baselineCaptured ? baselineRefunded / baselineCaptured : 0;
  const excess = Math.max(0, round2(windowRefunded - baselineRate * windowCaptured));

  const breakdown = (dimension: AnomalyDimension): AnomalyBreakdownRow[] => {
    const keyOf = (row: Record<string, unknown>) => String(row[dimension] || 'Unknown');
    // Captures carry no refund reason, so reason groups come from refunds only.
    const keys = new Set([...windowRefunds.map(keyOf), ...(dimension === 'reason' ? [] : windowCaptures.map(keyOf))]);
    const rows = [...keys].map((key) => {
      const refundsHere = windowRefunds.filter((r) => keyOf(r) === key);
      const refunded = sum(refundsHere.map((r) => r.amount));
      const captured = sum(windowCaptures.filter((c) => keyOf(c) === key).map((c) => c.gross));
      const baseRef = sum(baselineRefunds.filter((r) => keyOf(r) === key).map((r) => r.amount));
      const baseCap = sum(baselineCaptures.filter((c) => keyOf(c) === key).map((c) => c.gross));
      const ownBaseline = baseCap ? baseRef / baseCap : baselineRate;
      // Reasons have no capture-side value, so their expected refunds come from their share of baseline refunds.
      const expected = dimension === 'reason' ? (baselineRefunded ? (baseRef / baselineRefunded) * baselineRate * windowCaptured : 0) : ownBaseline * captured;
      const excessHere = Math.max(0, round2(refunded - expected));
      return { key, refunds: refundsHere.length, refunded, share_of_window_refunds: windowRefunded ? refunded / windowRefunded : 0, captured_in_window: captured, window_rate: dimension === 'reason' || !captured ? null : refunded / captured, baseline_rate: dimension === 'reason' || !baseCap ? null : baseRef / baseCap, excess_refunded: excessHere, share_of_excess: 0, text: '' };
    }).filter((r) => r.refunds > 0 || r.captured_in_window > 0);
    const totalExcess = rows.reduce((t, r) => t + r.excess_refunded, 0);
    for (const r of rows) {
      r.share_of_excess = totalExcess ? r.excess_refunded / totalExcess : 0;
      const rate = r.window_rate === null ? '' : `, refund rate ${pct(r.window_rate)}${r.baseline_rate === null ? '' : ` vs ${pct(r.baseline_rate)} before`}`;
      r.text = `${r.key}: ${r.refunds} refunds, ${eur(r.refunded)} (${pct(r.share_of_window_refunds)} of refunded €)${rate}`;
    }
    return rows.sort((a, b) => b.refunded - a.refunded || a.key.localeCompare(b.key));
  };

  const breakdowns = { reason: breakdown('reason'), product: breakdown('product'), segment: breakdown('segment'), customer: breakdown('customer').slice(0, 8) };
  const candidates = (['product', 'reason'] as const).map((dimension) => ({ dimension, row: breakdowns[dimension].reduce<AnomalyBreakdownRow | null>((best, r) => (!best || r.share_of_window_refunds > best.share_of_window_refunds ? r : best), null) }));
  const driver = candidates.find((c) => c.row && c.row.share_of_window_refunds >= 0.5) ?? null;
  const multiple = baselineRate ? windowRate / baselineRate : null;
  const spike = baselineRate > 0 ? windowRate >= baselineRate * 2 : windowRate > 0.1;
  const topProduct = breakdowns.product[0];
  const topReason = breakdowns.reason[0];
  const formatted = {
    window_rate: pct(windowRate),
    baseline_rate: pct(baselineRate),
    multiple: multiple === null ? 'n/a' : `${multiple.toFixed(1)}×`,
    window_refunded: eur(windowRefunded),
    window_captured: eur(windowCaptured),
    excess_refunded: eur(excess),
    top_product: topProduct ? `${topProduct.key} ${eur(topProduct.refunded)} (${pct(topProduct.share_of_window_refunds)} of refunded €)` : 'none',
    top_reason: topReason ? `${topReason.key} ${eur(topReason.refunded)} (${pct(topReason.share_of_window_refunds)} of refunded €)` : 'none',
  };
  const headline = windowRefunds.length === 0
    ? `No refunds in the last ${days} days (${start} to ${ledger.anchor_date}).`
    : `Refund rate ${formatted.window_rate} over the last ${days} days (${start} to ${ledger.anchor_date}) vs ${formatted.baseline_rate} before (${formatted.multiple}). ` +
      `Top product: ${formatted.top_product}. Top reason: ${formatted.top_reason}.`;
  return {
    mode: ledger.mode, anchor_date: ledger.anchor_date, window_days: days,
    window: { start, end: ledger.anchor_date }, baseline: { start: firstDay < start ? firstDay : start, end: beforeStart },
    window_refunded: windowRefunded, window_captured: windowCaptured, window_rate: windowRate,
    baseline_refunded: baselineRefunded, baseline_captured: baselineCaptured, baseline_rate: baselineRate,
    multiple, spike, excess_refunded: excess, breakdowns,
    top_driver: driver?.row ? { dimension: driver.dimension, key: driver.row.key, share_of_excess: driver.row.share_of_excess } : null,
    formatted, headline,
    definition: 'Refund rate = EUR refunded with a refund date in the window / EUR captured with a capture date in the window; baseline = the same ratio over all earlier ledger days. Same definition as the Money Desk refund-rate tile.',
  };
}

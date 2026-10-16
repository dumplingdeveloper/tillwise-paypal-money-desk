export type Card = { type: string; title: string; summary?: string; rows?: Array<Record<string, string>>; sections?: Array<{ title: string; value: string }>; chips?: string[]; expiresAt?: string };

function asRecord(value: unknown): Record<string, unknown> { return value && typeof value === 'object' ? value as Record<string, unknown> : {}; }
function money(value: unknown, currency = 'EUR') { return new Intl.NumberFormat('en-IE', { style: 'currency', currency }).format(Number(value || 0)); }
function hasPrice(value: unknown) { return value !== '' && value !== null && value !== undefined && Number.isFinite(Number(value)); }
function displayPrice(value: unknown, currency = 'EUR', empty = 'no sale') { return hasPrice(value) ? money(value, currency) : empty; }
function percent(delta: number, base: number) { if (!base) return 'new'; const p = Math.round((delta / base) * 100); return `${p >= 0 ? '▲' : '▼'} ${Math.abs(p)}%`; }
function humanReason(reason: unknown, row?: Record<string, unknown>) {
  if (reason === 'max_discount_exceeded') return `over the ${row?.max_discount_percent ?? 50}% max discount`;
  if (reason === 'min_price') return `below the ${displayPrice(row?.min_price, 'EUR')} minimum price`;
  return String(reason || '').replace(/_/g, ' ');
}
function dateLabel(value: unknown, timezone = 'Europe/Dublin', withTime = false) {
  if (!value) return '';
  const n = Number(value);
  const date = Number.isFinite(n) ? new Date(n * 1000) : new Date(String(value).match(/^\d{4}-\d{2}-\d{2}$/) ? `${value}T12:00:00Z` : String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}), timeZone: timezone }).format(date);
}
function range(rows: Record<string, unknown>[], key: string, currency: string) {
  const nums = rows.map((r) => Number(r[key])).filter(Number.isFinite);
  if (!nums.length) return '';
  return `${money(Math.min(...nums), currency)}–${money(Math.max(...nums), currency)}`;
}
function effectiveOld(row: Record<string, unknown>) { return hasPrice(row.old) ? row.old : row.regular; }
function groupedSkipped(skipped: Record<string, unknown>[]) {
  const groups = new Map<string, { count: number; label: string }>();
  for (const row of skipped) {
    const reason = String(row.reason || 'skipped');
    const label = humanReason(reason, row);
    groups.set(reason, { count: (groups.get(reason)?.count || 0) + 1, label });
  }
  return [...groups.values()].map((group) => `${group.count} × ${group.label}`).join(', ');
}
function saleUntil(row: Record<string, unknown>, timezone: string) {
  return row.sale_end_date ? dateLabel(row.sale_end_date, timezone) : row.sale_end_timestamp ? dateLabel(row.sale_end_timestamp, timezone) : '';
}

export function cardFromStructured(structured: unknown): Card | null {
  const root = asRecord(structured); const data = asRecord(root.data || root); const currency = String(data.currency || 'EUR'); const timezone = String(data.timezone || 'Europe/Dublin');
  if ('today' in data && 'same_weekday_last_week' in data) {
    const today = asRecord(data.today); const last = asRecord(data.same_weekday_last_week); const low = asRecord(data.low_stock);
    const lowItems = Array.isArray(low.items) ? low.items.map(asRecord).slice(0, 3).map((i) => String(i.name)).join(', ') : '';
    const delta = Number(today.total || 0) - Number(last.total || 0);
    return { type: 'briefing', title: 'Daily briefing', summary: `${money(today.total, currency)} today (${percent(delta, Number(last.total || 0))})`, sections: [
      { title: 'Orders waiting', value: String(data.waiting_orders ?? 0) },
      { title: 'Low stock', value: `${low.count ?? 0}${lowItems ? `: ${lowItems}` : ''}` },
      { title: 'Sales ending soon', value: String(Array.isArray(data.sales_ending_soon) ? data.sales_ending_soon.length : 0) },
    ] };
  }
  if ('preview_id' in data && 'changes' in data) {
    const changes = Array.isArray(data.changes) ? data.changes.map(asRecord) : []; const skipped = Array.isArray(data.skipped) ? data.skipped.map(asRecord) : [];
    const more = Math.max(0, changes.length - 5); const guardrails = asRecord(data.guardrails);
    const oldRows = changes.map((row) => ({ ...row, old: effectiveOld(row) }));
    const summary = changes.length
      ? `${data.count} prices: ${range(oldRows, 'old', currency)} → ${range(changes, 'new', currency)}${more ? `, and ${more} more` : ''}`
      : `No changes: ${skipped.length} skipped by guardrails`;
    return { type: 'price-preview', title: 'Price preview', summary, expiresAt: String(data.expires_at || ''), chips: [`Min ${money(guardrails.min_price, currency)}`, `Max ${guardrails.max_discount_percent}% off`], sections: [
      ...(data.expires_at ? [{ title: 'Preview valid until', value: dateLabel(data.expires_at, timezone, true) }] : []),
      ...(skipped.length ? [{ title: 'Skipped', value: groupedSkipped(skipped) }] : []),
    ], rows: changes.length ? changes.slice(0, 5).map((r) => ({ product: String(r.name), was: displayPrice(effectiveOld(r), currency), now: displayPrice(r.new, currency), until: saleUntil(r, timezone) || '-' })) : skipped.slice(0, 5).map((r) => ({ product: String(r.name || 'product'), reason: humanReason(r.reason, r) })) };
  }
  if ('applied_count' in data) {
    const conflicts = Array.isArray(data.conflicts) ? data.conflicts.map(asRecord) : [];
    const applied = Array.isArray(data.applied) ? data.applied.map(asRecord) : [];
    const until = saleUntil(applied[0] || {}, timezone);
    return { type: 'applied', title: 'Applied price changes', summary: `${data.applied_count} ${applied[0]?.field === 'sale' ? 'on sale' : 'changed'}${until ? ` until ${until}` : ''}${conflicts.length ? `, ${conflicts.length} conflicts` : ''}`, rows: applied.length ? applied.slice(0, 5).map((r) => ({ product: String(r.name), was: displayPrice(effectiveOld(r), currency), now: displayPrice(r.new, currency), until: saleUntil(r, timezone) || '-' })) : conflicts.slice(0, 5).map((c) => ({ product: String(c.name || 'product'), reason: humanReason(c.reason || 'conflict', c) })) };
  }
  if ('restored_count' in data) {
    const conflicts = Array.isArray(data.conflicts) ? data.conflicts.map(asRecord) : [];
    const restored = Array.isArray(data.restored) ? data.restored.map(asRecord) : [];
    return { type: 'undo', title: 'Undo result', summary: `${data.restored_count} restored${conflicts.length ? `, ${conflicts.length} conflicts` : ''}`, rows: restored.length ? restored.slice(0, 5).map((r) => ({ product: String(r.name), was: displayPrice(r.was, currency), restored: displayPrice(hasPrice(r.restored) ? r.restored : r.regular, currency), until: r.restored_sale_end_timestamp ? dateLabel(r.restored_sale_end_timestamp, timezone) : 'no sale' })) : conflicts.slice(0, 5).map((c) => ({ product: String(c.name || 'product'), reason: humanReason(c.reason || 'conflict', c) })) };
  }
  if ('count' in data && 'items' in data && Array.isArray(data.items)) {
    const items = data.items.map(asRecord);
    const rows = items.slice(0, 10).map((i) => ({ product: String(i.name), stock: String(i.stock_quantity), threshold: String(i.threshold) }));
    const more = Math.max(0, items.length - rows.length);
    if (more) rows.push({ product: `+${more} more`, stock: '', threshold: '' });
    return { type: 'low-stock', title: 'Low stock', summary: `${data.count} items running low`, rows };
  }
  if ('items' in data && Array.isArray(data.items)) return { type: 'history', title: 'History', rows: data.items.map(asRecord).slice(0, 5).map((i) => {
    const changes = Array.isArray(i.changes) ? i.changes.map(asRecord) : [];
    const until = saleUntil(changes[0] || {}, timezone);
    const names = changes.map((c) => String(c.name || '')).filter(Boolean);
    const noun = names.every((n) => n.toLowerCase().includes('mug')) ? 'mugs' : 'items';
    return { change: `${changes.length || i.count || 0} ${noun} · ${String(changes[0]?.field || 'price')} ${range(changes, 'new', currency)}${until ? ` · until ${until}` : ''}`, date: dateLabel(i.created_at, timezone, true), status: i.undone_at ? 'undone' : 'applied' };
  }) };
  if ('guardrails' in data) return { type: 'guardrails', title: 'Guardrails', chips: Object.entries(asRecord(data.guardrails)).map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v}`) };
  return null;
}

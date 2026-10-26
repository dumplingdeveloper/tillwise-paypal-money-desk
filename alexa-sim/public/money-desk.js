/* Tillwise × PayPal Money Desk: a real AG Studio 3 canvas (built-in + custom widgets) whose AI panel
 * agent is a clientToolRunner backed by the GitHub Copilot SDK on the sim server (/api/studio-agent/run).
 * No widget, answer or tool call is produced in this file: Studio renders the state, and the model
 * (via the server bridge) chooses every tool call and its arguments. */
(() => {
  'use strict';
  const AG = window.agStudio;
  const md = (window.__moneyDesk = { ready: false, errors: [], warnings: [], bridgeRuns: [], placements: [], studioApi: null, meta: null });
  const $ = (id) => document.getElementById(id);

  function showError(message) {
    const box = $('mdError');
    box.hidden = false;
    box.textContent += (box.textContent ? '\n' : '') + message;
  }

  // ---------- formatting helpers (display only) ----------
  const eur = (n) => new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR' }).format(Number(n) || 0);
  const pct = (n) => `${(n * 100).toFixed(1)}%`;
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const toDate = (v) => (v instanceof Date ? v : v == null || v === '' ? null : new Date(v));
  const DAY = 86400000;
  // Calendar day number of a ledger date. Studio hands 'dateFormat' values back as Dates at LOCAL midnight, so the
  // local calendar date is used (flooring the UTC time would shift every day by one during Irish summer time).
  const dayIndex = (v) => {
    if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) return Date.UTC(+v.slice(0, 4), +v.slice(5, 7) - 1, +v.slice(8, 10)) / DAY;
    const d = toDate(v);
    return d && !Number.isNaN(d.getTime()) ? Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY) : null;
  };

  // ---------- custom widgets (AG Studio createWidgets, custom-widgets.md) ----------
  // Each comp reads ONLY what Studio's widgetApi.getData returns for the fields in its dataMapping.
  class LedgerWidget {
    init(params) {
      this.params = params;
      this.seq = 0;
      this.eGui = document.createElement('div');
      this.eGui.className = `tw-widget ${this.constructor.cssClass}`;
      this.load();
    }
    getGui() { return this.eGui; }
    refresh(params) { this.params = params; this.load(); }
    destroy() { this.dead = true; }
    field(key) { return (this.params.dataMapping?.[key] || [])[0]; }
    async rows(fields, queryId) {
      const response = await this.params.widgetApi.getData({ fields: fields.filter(Boolean) }, { queryId: `${this.params.widgetId}-${queryId}` });
      return response?.results?.rows || [];
    }
    async load() {
      const seq = ++this.seq;
      const api = this.params.widgetApi;
      if (this.constructor.required.some((key) => !this.field(key))) { api.setDisplayState('incompleteDataMapping'); return; }
      api.setDisplayState('loading');
      try {
        const html = await this.compute();
        if (this.dead || seq !== this.seq) return;
        if (html == null) { api.setDisplayState('noData'); return; }
        this.eGui.innerHTML = html;
        api.setDisplayState('displayed');
      } catch (error) {
        const message = `${this.params.widgetType} ${this.params.widgetId}: ${error?.message || error}`;
        md.errors.push({ source: 'custom-widget', message });
        console.error('[money-desk] custom widget failed', message);
        api.setDisplayState('noData');
      }
    }
  }

  // "Mon 19 Oct", built by hand so the label does not depend on the browser's locale data (same as dayLabel in
  // mcp-server/src/paypal/refundAnomaly.ts, whose calendar_week.label the agent quotes).
  const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const fmtDay = (day) => { const d = new Date(day * DAY); return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`; };
  /**
   * The tile's window, anchored on the latest capture/refund day in the data (UTC days):
   * - 'rolling-days': the last windowDays days, ending on the anchor day;
   * - 'calendar-week': Monday of the anchor's ISO week up to the anchor day.
   * Returns the first day in the window and a label that states the exact dates.
   */
  function refundWindow(format, anchor) {
    if (format?.window === 'calendar-week') {
      const start = anchor - ((new Date(anchor * DAY).getUTCDay() + 6) % 7);
        return { start, end: anchor, dates: `${fmtDay(start)} – ${fmtDay(anchor)}`, label: `This calendar week · ${fmtDay(start)} – ${fmtDay(anchor)}` };
    }
    const days = Math.max(1, Math.min(90, Number(format?.windowDays) || 7));
    const start = anchor - days + 1;
    return { start, end: anchor, dates: `${fmtDay(start)} – ${fmtDay(anchor)}`, label: `Last ${days} days · ${fmtDay(start)} – ${fmtDay(anchor)}` };
  }

  /**
   * The exact dates each refund-rate tile on the page covers, and the calendar-week window, computed from the same
   * ledger rows Studio holds (anchor = latest capture/refund day, as in RefundRateTile). Lets the agent see that a
   * "this week" tile would repeat an existing tile when both windows are the same days (e.g. on a Sunday).
   */
  function refundWindows(page) {
    const days = [...(md.ledger?.captures || []), ...(md.ledger?.refunds || [])].map((r) => dayIndex(r.date)).filter((d) => d !== null);
    if (!days.length) return null;
    const anchor = Math.max(...days);
    const calendarWeek = refundWindow({ window: 'calendar-week' }, anchor);
    const tiles = Object.entries(page?.widgets || {}).filter(([, w]) => w.type === 'refund-rate-tile').map(([id, w]) => {
      const win = refundWindow(w.format, anchor);
      return { id, title: w.format?.title?.text || '', window: w.format?.window === 'calendar-week' ? 'calendar-week' : 'rolling-days', dates: win.dates, sameDatesAsCalendarWeek: win.start === calendarWeek.start && win.end === calendarWeek.end };
    });
    return { lastDataDay: new Date(anchor * DAY).toISOString().slice(0, 10), calendarWeek: { dates: calendarWeek.dates }, tiles };
  }
  md.refundWindows = () => { const s = md.studioApi?.getState(); return refundWindows(s?.pages.find((p) => p.id === s.selectedPageId)); };

  /** Refund rate (refunded / captured EUR) in a window of the data vs the rate over all earlier days. */
  class RefundRateTile extends LedgerWidget {
    static cssClass = 'tw-refund-rate';
    static required = ['refundAmount', 'refundDate', 'capturedAmount', 'captureDate'];
    async compute() {
      const [refundAmount, refundDate, capturedAmount, captureDate] = this.constructor.required.map((k) => this.field(k));
      const [refunds, captures] = await Promise.all([this.rows([refundDate, refundAmount], 'refunds'), this.rows([captureDate, capturedAmount], 'captures')]);
      const dated = (rows, dateField, amountField) => rows.map((r) => ({ day: dayIndex(r[dateField.key]), amount: Number(r[amountField.key]) || 0 })).filter((r) => r.day !== null);
      const ref = dated(refunds, refundDate, refundAmount);
      const cap = dated(captures, captureDate, capturedAmount);
      if (!cap.length) return null;
      const anchor = Math.max(...cap.map((r) => r.day), ...ref.map((r) => r.day));
      const win = refundWindow(this.params.format, anchor);
      const inWindow = (r) => r.day >= win.start;
      const sum = (rows) => rows.reduce((t, r) => t + r.amount, 0);
      const recentRef = sum(ref.filter(inWindow));
      const recentCap = sum(cap.filter(inWindow));
      const priorRef = sum(ref.filter((r) => !inWindow(r)));
      const priorCap = sum(cap.filter((r) => !inWindow(r)));
      const rate = recentCap ? recentRef / recentCap : 0;
      const baseline = priorCap ? priorRef / priorCap : 0;
      const spike = baseline > 0 ? rate >= baseline * 2 : rate > 0.1;
      return `<div class="tw-rate"><div class="tw-rate-main"><div class="tw-muted">${esc(win.label)}</div>
        <div class="tw-big">${pct(rate)}</div>
        <div class="tw-muted">${eur(recentRef)} refunded of ${eur(recentCap)} captured</div></div>
        <div class="tw-rate-side"><div><span class="tw-badge ${spike ? 'alert' : 'ok'}">${spike ? 'Refund spike' : 'Normal'}</span> <span class="tw-muted">baseline ${pct(baseline)} before this window</span></div>
        ${spike ? '<div class="tw-hint">Ask the AI panel: “Why are refunds spiking?”</div>' : ''}</div></div>`;
    }
  }

  /** Scoreboard of customers who still owe money (amountDue > 0), largest first. */
  class OwedScoreboard extends LedgerWidget {
    static cssClass = 'tw-owed';
    static required = ['customer', 'amountDue'];
    async compute() {
      const customer = this.field('customer');
      const amountDue = this.field('amountDue');
      const overdue = this.field('daysOverdue');
      const rows = await this.rows([customer, amountDue, overdue], 'owed');
      const board = rows.map((r) => ({ who: r[customer.key], due: Number(r[amountDue.key]) || 0, late: overdue ? Number(r[overdue.key]) || 0 : 0 })).filter((r) => r.due > 0).sort((a, b) => b.due - a.due);
      if (!board.length) return null;
      const total = board.reduce((t, r) => t + r.due, 0);
      return `<div class="tw-muted">${board.length} customers · ${eur(total)} outstanding</div>
        <ol class="tw-board">${board.map((r, i) => `<li><span class="tw-rank">${i + 1}</span><span>${esc(r.who)}${overdue ? `<span class="tw-sub">${r.late > 0 ? `${r.late} days overdue` : 'not yet due'}</span>` : ''}</span><span class="tw-amount">${eur(r.due)}</span></li>`).join('')}</ol>`;
    }
  }

  /** Countdown to each dispute's seller-response deadline (disputes without a deadline are skipped). */
  class DisputeCountdown extends LedgerWidget {
    static cssClass = 'tw-disputes';
    static required = ['dispute', 'dueDate'];
    async compute() {
      const dispute = this.field('dispute');
      const dueDate = this.field('dueDate');
      const amount = this.field('amount');
      const rows = await this.rows([dispute, dueDate, amount], 'disputes');
      const now = Date.now();
      const list = rows.map((r) => ({ id: r[dispute.key], due: toDate(r[dueDate.key]), amount: amount ? Number(r[amount.key]) || 0 : null }))
        .filter((r) => r.due && !Number.isNaN(r.due.getTime())).sort((a, b) => a.due - b.due);
      if (!list.length) return null;
      const left = (due) => { const ms = due - now; if (ms <= 0) return 'overdue'; const d = Math.floor(ms / DAY); const h = Math.floor((ms % DAY) / 3600000); return `${d}d ${h}h`; };
      return `<ol class="tw-board">${list.map((r) => `<li><span class="tw-rank">⏱</span><span>${esc(r.id)}<span class="tw-sub">due ${r.due.toISOString().slice(0, 16).replace('T', ' ')} UTC${r.amount != null ? ` · ${eur(r.amount)}` : ''}</span></span><span class="tw-count ${r.due - now < 3 * DAY ? 'urgent' : ''}">${left(r.due)}</span></li>`).join('')}</ol>`;
    }
  }

  // AG Studio: "For a custom widget to work with AI, the formatShape and ai properties must be defined"
  // (custom-widgets.md). formatShape receives { api }; api.defineAiCommand hands its factory the shape builder.
  const formatShape = (extra) => ({ api }) => api.defineAiCommand((s) => ({
    input: s.object({
      title: s.object({ enabled: s.boolean().optional(), text: s.string({ description: 'Widget title' }).optional() }).optional(),
      ...extra(s),
    }),
    execute: () => ({ success: true, value: undefined }),
  })).shape;

  const numeric = (aiDescription, required = true) => ({ type: 'field', supportedRoles: ['numeric'], requires: { cardinality: 'one' }, required, aiDescription });
  const category = (aiDescription, required = true) => ({ type: 'field', supportedRoles: ['category'], required, aiDescription });
  const temporal = (aiDescription) => ({ type: 'field', supportedRoles: ['temporal'], required: true, aiDescription });

  const CUSTOM_WIDGETS = [
    {
      id: 'refund-rate-tile', label: 'Refund rate tile', comp: RefundRateTile,
      dataMapping: {
        refundAmount: numeric('Refunded amount measure, e.g. refunds.amount with aggregation sum'),
        refundDate: temporal('Refund date field, e.g. refunds.date'),
        capturedAmount: numeric('Captured revenue measure, e.g. captures.gross with aggregation sum'),
        captureDate: temporal('Capture date field, e.g. captures.date'),
      },
      formatShape: formatShape((s) => ({
        window: s.enum(['rolling-days', 'calendar-week']).optional(),
        windowDays: s.number({ description: 'Days in a rolling-days window. Default 7.' }).optional(),
      })),
      // params.format only carries values that have a form item (custom-widgets.md: "Widget format as constructed
      // from the widget form"), so the window settings get their own inputs (custom-widgets-form.md: Select, Number Input).
      formItems: [
        { type: 'select', id: 'format.window', label: 'Window', defaultValue: 'rolling-days', items: [{ label: { raw: 'Rolling days' }, value: 'rolling-days' }, { label: { raw: 'Calendar week (Monday to today)' }, value: 'calendar-week' }] },
        { type: 'number', id: 'format.windowDays', label: 'Days in rolling window', defaultValue: 7, min: 1, max: 90, step: 1 },
      ],
      ai: { description: 'KPI tile: refund rate (refunded / captured EUR) in a window of the PayPal data, flagged when it spikes versus the rate before the window. format.window is "calendar-week" (Monday to today) or "rolling-days" (the last format.windowDays days, default 7); the tile prints the exact dates it covers.', usage: 'Use for refund rate questions. "This week" means format.window "calendar-week"; "last N days" means "rolling-days" with windowDays N. Title it to match the window.' },
      defaultSize: { width: 320, height: 200 }, minSize: { width: 220, height: 150 },
    },
    {
      id: 'owed-scoreboard', label: 'Who still owes (scoreboard)', comp: OwedScoreboard,
      dataMapping: {
        customer: category('Customer field, e.g. receivables.customer'),
        amountDue: numeric('Amount still owed measure, e.g. receivables.amount_due with aggregation sum'),
        daysOverdue: numeric('Optional days-overdue measure, e.g. receivables.days_overdue with aggregation max', false),
      },
      formatShape: formatShape(() => ({})),
      ai: { description: 'Scoreboard ranking customers by money they still owe on PayPal invoices, with days overdue.', usage: 'Use for "who owes us" / unpaid invoice questions.' },
      defaultSize: { width: 360, height: 300 }, minSize: { width: 240, height: 200 },
    },
    {
      id: 'dispute-countdown', label: 'Dispute deadline countdown', comp: DisputeCountdown,
      dataMapping: {
        dispute: category('Dispute identifier, e.g. disputes.dispute_id'),
        dueDate: temporal('Seller response deadline, e.g. disputes.seller_response_due_date'),
        amount: numeric('Optional disputed amount measure, e.g. disputes.amount with aggregation sum', false),
      },
      formatShape: formatShape(() => ({})),
      ai: { description: 'Live countdown to each PayPal dispute seller-response deadline.', usage: 'Use for dispute deadline questions.' },
      defaultSize: { width: 360, height: 260 }, minSize: { width: 240, height: 180 },
    },
  ].map(({ formItems, ...def }) => ({
    ...def,
    form: (p) => {
      const form = p.createDefaults({ dataMappingItems: Object.keys(def.dataMapping).map((key) => ({ key, label: key })) });
      if (formItems) form.items[0].items.push({ type: 'section', key: 'tillwiseWindow', label: 'Refund window', items: formItems });
      return form;
    },
  }));

  // ---------- initial report state (built-in + custom widgets with real dataMapping) ----------
  const sum = (id) => ({ id, aggregation: 'sum' });
  const title = (text) => ({ title: { enabled: true, text } });
  const initialState = {
    pages: [{
      id: 'money-desk',
      name: 'Money Desk',
      widgets: {
        'kpi-gross': { type: 'value', dataMapping: { value: [sum('captures.gross')] }, format: title('Captured · 45d') },
        'kpi-refunded': { type: 'value', dataMapping: { value: [sum('refunds.amount')] }, format: title('Refunded · 45d') },
        'refund-rate': { type: 'refund-rate-tile', dataMapping: { refundAmount: [sum('refunds.amount')], refundDate: [{ id: 'refunds.date' }], capturedAmount: [sum('captures.gross')], captureDate: [{ id: 'captures.date' }] }, format: { ...title('Refund rate · last 7 days'), window: 'rolling-days', windowDays: 7 } },
        'daily-revenue': { type: 'column-chart-grouped', dataMapping: { categoryKey: [{ id: 'captures.date' }], valueKey: [sum('captures.gross')] }, format: title('Daily PayPal revenue') },
        'owed-board': { type: 'owed-scoreboard', dataMapping: { customer: [{ id: 'receivables.customer' }], amountDue: [sum('receivables.amount_due')], daysOverdue: [{ id: 'receivables.days_overdue', aggregation: 'max' }] }, format: title('Who still owes us') },
        'dispute-clock': { type: 'dispute-countdown', dataMapping: { dispute: [{ id: 'disputes.dispute_id' }], dueDate: [{ id: 'disputes.seller_response_due_date' }], amount: [sum('disputes.amount')] }, format: title('Dispute deadlines') },
        'refunds-grid': { type: 'grid', dataMapping: { cols: [{ id: 'refunds.date' }, { id: 'refunds.customer' }, { id: 'refunds.product' }, { id: 'refunds.amount' }, { id: 'refunds.reason' }] }, format: title('PayPal refunds') },
      },
      widgetLayout: {
        'kpi-gross': { xTrack: 0, yTrack: 0, xSpan: 6, ySpan: 12 },
        'kpi-refunded': { xTrack: 6, yTrack: 0, xSpan: 6, ySpan: 12 },
        'refund-rate': { xTrack: 12, yTrack: 0, xSpan: 12, ySpan: 12 },
        'daily-revenue': { xTrack: 0, yTrack: 12, xSpan: 14, ySpan: 20 },
        'owed-board': { xTrack: 14, yTrack: 12, xSpan: 10, ySpan: 20 },
        'dispute-clock': { xTrack: 0, yTrack: 32, xSpan: 7, ySpan: 18 },
        'refunds-grid': { xTrack: 7, yTrack: 32, xSpan: 17, ySpan: 18 },
      },
    }],
    selectedPageId: 'money-desk',
    // The Compose ('edit') panel starts collapsed so the canvas gets the width (modes-layout.md: panels state).
    panels: { filters: { collapsed: true }, data: { collapsed: true }, edit: { collapsed: true }, ai: { collapsed: false } },
  };

  // Sandbox mode: money moves in the REAL PayPal sandbox, but the analytics widgets stay on the mock ledger. Every
  // seeded widget then names its source in its title, and a full-width grid of the live sandbox objects goes on top.
  const SANDBOX_ROWS = 14;
  function stateForLedger(base, ledger) {
    if (ledger.paypal_mode !== 'sandbox') return base;
    const state = JSON.parse(JSON.stringify(base));
    const page = state.pages[0];
    for (const widget of Object.values(page.widgets)) widget.format.title.text = `${widget.format.title.text} · mock data`;
    for (const layout of Object.values(page.widgetLayout)) layout.yTrack += SANDBOX_ROWS;
    page.widgets['sandbox-activity'] = { type: 'grid', dataMapping: { cols: ['created_at', 'kind', 'paypal_id', 'order_id', 'customer', 'amount', 'fee', 'status', 'tag'].map((f) => ({ id: `sandbox_activity.${f}` })) }, format: title('LIVE PayPal sandbox · objects Tillwise created') };
    page.widgetLayout['sandbox-activity'] = { xTrack: 0, yTrack: 0, xSpan: 24, ySpan: SANDBOX_ROWS };
    return state;
  }

  // ---------- theme (theming.md / studio-theme.md: studioTheme.withParams) ----------
  const theme = AG.studioTheme.withParams({
    accentColor: '#0f766e',
    backgroundColor: '#ffffff',
    foregroundColor: '#10231f',
    browserColorScheme: 'light',
    fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
    borderColor: '#cfe3de',
    studioWrapperBackgroundColor: '#eef5f3',
    studioPanelContainerBackgroundColor: '#ffffff',
    studioWidgetBackgroundColor: '#ffffff',
    studioWidgetBorder: { color: '#cfe3de' },
    studioWidgetTitleTextColor: '#0b2b26',
    studioAiPanelWidth: '420px',
    studioAiPanelInputMessageBackgroundColor: '#e6f4f1',
    studioAiPanelRichTextAccentBackgroundColor: '#d9efe9',
    studioAiPanelButtonHoverBackgroundColor: '#d9efe9',
  });

  // ---------- the Studio agent: clientToolRunner → Copilot SDK bridge on the sim server ----------
  async function* copilotRound(input, ctx) {
    const started = Date.now();
    const runLog = { threadId: input.threadId, runId: input.runId, startedAt: new Date(started).toISOString(), events: [] };
    md.bridgeRuns.push(runLog);
    let response;
    try {
      response = await fetch('/api/studio-agent/run', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ threadId: input.threadId, runId: input.runId, messages: input.messages, tools: input.tools, instructions: ctx.instructions(), model: AG.aiModelFromRunInput ? AG.aiModelFromRunInput(input) : undefined }),
        signal: ctx.signal,
      });
    } catch (error) {
      if (ctx.signal?.aborted) return;
      yield { type: 'RUN_ERROR', message: `Studio agent bridge unreachable: ${error?.message || error}` };
      return;
    }
    if (!response.ok || !response.body) {
      yield { type: 'RUN_ERROR', message: `Studio agent bridge HTTP ${response.status}: ${(await response.text().catch(() => '')).slice(0, 300)}` };
      return;
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let nl;
        while ((nl = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (!line) continue;
          const event = JSON.parse(line);
          runLog.events.push(event.type);
          yield event;
        }
      }
    } catch (error) {
      if (ctx.signal?.aborted) return;
      yield { type: 'RUN_ERROR', message: `Studio agent stream failed: ${error?.message || error}` };
    } finally {
      runLog.finishedAt = new Date().toISOString();
    }
  }

  function studioTools(api, studio) {
    return [
      studio.viewSchema(),
      studio.viewPage(),
      studio.viewWidget(),
      studio.executeQuery(),
      placeWidgetTool(api),
      ...configureTools(api),
      widgetFilterTool(api),
    ];
  }

  // place_widget: ai-custom-tools.md "Wrap a Built-in Command" shows a place_widget tool over AgAddWidgetCommand.
  // Ours keeps Studio's validated add (and AgPositionWidgetCommand for re-splitting a row of tiles) but takes the
  // grid position from TillwiseLayout.planPlacement, so new widgets always get the full free width.
  let placeToolCache = null;
  function placeWidgetTool(api) {
    placeToolCache ||= api.defineAiTool({
      name: 'place_widget',
      description: 'Add one new, empty widget to the Money Desk canvas. Studio places it below the existing widgets at the full free width (a KPI tile added right after other tiles shares their row). Then call the configure_<type> tool for it. size: compact, standard (default) or tall.',
      params: (s) => s.object({
        widgetId: s.string({ description: 'A new, unique widget id in kebab-case, e.g. revenue-by-segment.' }),
        type: s.enum(AGENT_WIDGET_TYPES),
        size: s.enum(['compact', 'standard', 'tall']).optional(),
      }),
      execute: async (args, ctx) => {
        const state = api.getState();
        const page = state.pages.find((p) => p.id === state.selectedPageId);
        if (page?.widgets?.[args.widgetId]) return ctx.error(`A widget with id ${args.widgetId} already exists. Pick a new id, or configure the existing widget instead.`);
        const plan = window.TillwiseLayout.planPlacement(page?.widgets || {}, page?.widgetLayout || {}, args.type, args.size, page?.layout?.columns);
        // Shrink the tiles that will share the row first: Studio moves a widget that would overlap another.
        for (const move of plan.reposition) {
          const moved = await api.defineAiCommand({ type: 'AgPositionWidgetCommand' }).apply({ op: 'patch', widgetId: move.widgetId, value: { xTrack: move.xTrack, xSpan: move.xSpan } }, { signal: ctx.signal });
          if (!moved.success) return ctx.error(`Studio could not re-split the row for ${move.widgetId}: ${JSON.stringify(moved.error?.issues || moved.error?.message).slice(0, 300)}`);
        }
        const added = await api.defineAiCommand({ type: 'AgAddWidgetCommand' }).apply({ widgetId: args.widgetId, type: args.type, ...plan.add }, { signal: ctx.signal });
        if (!added.success) return ctx.error(`Studio rejected the widget: ${JSON.stringify(added.error?.issues || added.error?.message || added.error).slice(0, 400)}`);
        md.placements.push({ widgetId: args.widgetId, type: args.type, size: args.size || 'standard', layout: plan.add, reposition: plan.reposition });
        return ctx.success(`Placed ${args.type} "${args.widgetId}" at xTrack ${plan.add.xTrack}, yTrack ${plan.add.yTrack}, ${plan.add.xSpan} of ${page?.layout?.columns || 24} columns wide. Now call configure_${args.type.replace(/-/g, '_')} for it.`, { widgetId: args.widgetId, layout: plan.add, resized: plan.reposition });
      },
    });
    return placeToolCache;
  }

  // Studio's AgAddWidgetFilterCommand (ai-custom-tools.md, built-in command refs) so the agent can scope a widget
  // to a period ("this month" via inRelativeRange) or to a subset of rows.
  let widgetFilterToolCache = null;
  function widgetFilterTool(api) {
    widgetFilterToolCache ||= api.defineAiTool({
      name: 'add_widget_filter',
      description: 'Add a widget-level filter to a widget already on the page, e.g. a relative date range (operator inRelativeRange) or a numeric/text condition. Use op \'append\'.',
      command: api.defineAiCommand({ type: 'AgAddWidgetFilterCommand' }),
      result: async (_value, args) => {
        await new Promise((resolve) => setTimeout(resolve, 300));
        return { response: { filtered: args.widgetId, health: (await api.getAiContext().health.widget(args.widgetId)).issues } };
      },
    });
    return widgetFilterToolCache;
  }

  // configure_widget is bound per widget type (ai-tools-builtin.md); wrap Studio's own
  // AgConfigureWidgetCommand per type (ai-custom-tools.md "Wrap a Built-in Command").
  let configureToolCache = null;
  function configureTools(api) {
    if (configureToolCache) return configureToolCache;
    configureToolCache = AGENT_WIDGET_TYPES.map((widgetType) => api.defineAiTool({
      name: `configure_${widgetType.replace(/-/g, '_')}`,
      description: `Configure a ${widgetType} widget already on the page (add it first with place_widget, type '${widgetType}'): set its dataMapping and format. Use op 'patch'.`,
      command: api.defineAiCommand({ type: 'AgConfigureWidgetCommand', params: { widgetType } }),
      result: async (_value, args) => {
        // Let the patched config settle before asking for health, otherwise the report can describe the pre-patch widget
        // (an unmapped-fields issue right after a patch that mapped them); re-check a few times before reporting it.
        const legend = await showLegendForSplitChart(api, widgetType, args.widgetId);
        let issues = [];
        for (let attempt = 0; attempt < 5; attempt++) {
          await new Promise((resolve) => setTimeout(resolve, 300));
          issues = (await api.getAiContext().health.widget(args.widgetId)).issues;
          if (!issues.some((issue) => issue.code === 'data_mapping_complete')) break;
        }
        return { response: { configured: args.widgetId, ...(legend ? { legend } : {}), health: issues } };
      },
    }));
    return configureToolCache;
  }

  // A chart split by legendKey draws one colour per member, but Studio's chart legend defaults to off
  // (format.style.theme.common.legend, agChartShared.d.ts:17-26 / :302-306). Turn it on unless the agent set it.
  async function showLegendForSplitChart(api, widgetType, widgetId) {
    const state = api.getState();
    const widget = state.pages.find((p) => p.id === state.selectedPageId)?.widgets?.[widgetId];
    if (!widget?.dataMapping?.legendKey?.length || widget.format?.style?.theme?.common?.legend?.enabled !== undefined) return null;
    const legend = { enabled: true, position: 'bottom' };
    // patch replaces `format` as a whole, so carry the agent's title and other format settings over.
    const format = widget.format || {};
    const style = format.style || {};
    const theme = style.theme || {};
    const applied = await api.defineAiCommand({ type: 'AgConfigureWidgetCommand', params: { widgetType } })
      .apply({ op: 'patch', widgetId, value: { type: widgetType, format: { ...format, style: { ...style, theme: { ...theme, common: { ...(theme.common || {}), legend } } } } } });
    return applied.success ? 'shown at the bottom (one colour per legendKey member)' : null;
  }
  // Must match AGENT_WIDGET_TYPES in src/studioBridge.ts (the server rejects any other configure_* tool).
  const AGENT_WIDGET_TYPES = ['column-chart-grouped', 'column-chart-stacked', 'bar-chart-grouped', 'value', 'grid', 'refund-rate-tile', 'owed-scoreboard', 'dispute-countdown'];

  /** One compact line per widget on the canvas, so the agent can tell what already exists before it adds anything. */
  function canvasSummary(page) {
    const windows = refundWindows(page);
    const fieldText = (f) => (f.aggregation ? `${f.aggregation}(${f.id})` : f.id);
    const filterText = (f) => `${f.field?.id ?? '?'} ${f.model?.operator ?? ''} ${JSON.stringify(f.model?.value ?? f.model?.values ?? f.model?.range ?? '')}`.trim().slice(0, 120);
    return Object.entries(page?.widgets || {}).map(([id, w]) => {
      const title = w.format?.title?.text ? ` "${w.format.title.text}"` : '';
      const fields = Object.entries(w.dataMapping || {}).map(([key, list]) => `${key}=${(list || []).map(fieldText).join('+')}`).join('; ');
      const filters = (page.filter?.widget?.[id] || []).map(filterText);
      const dates = windows?.tiles.find((t) => t.id === id)?.dates;
      const win = w.type === 'refund-rate-tile' ? ` window=${w.format?.window === 'calendar-week' ? 'calendar-week (Monday to today)' : `rolling last ${Number(w.format?.windowDays) || 7} days`}${dates ? ` = ${dates}` : ''}` : '';
      const l = page.widgetLayout?.[id];
      return `- ${id} [${w.type}]${title}: ${fields || 'no fields yet'}${filters.length ? `; widget filters: ${filters.join(', ')}` : ''}${win}${l ? `; at row ${l.yTrack}, ${l.xSpan} cols wide` : ''}`;
    }).join('\n') + refundWindowNote(windows);
  }

  function refundWindowNote(windows) {
    if (!windows) return '';
    const same = windows.tiles.filter((t) => t.sameDatesAsCalendarWeek);
    return `\n- Refund windows: the last data day is ${windows.lastDataDay}; the calendar week (Monday to the last data day) is ${windows.calendarWeek.dates}.` +
      (same.length ? ` Refund-rate tile ${same.map((t) => `${t.id} "${t.title}"`).join(', ')} already covers exactly these dates, so a "this week" refund-rate tile would show identical figures.` : '');
  }

  function agentInstructions(api) {
    const context = api.getAiContext();
    const tables = context.schema().tables.map((t) => `- ${t.id}${t.description ? ` (${t.description})` : ''}: ${t.fields.map((f) => `${t.id}.${f.id ?? f.name}`).join(', ')}`).join('\n');
    const state = api.getState();
    const page = state.pages.find((p) => p.id === state.selectedPageId);
    return [
      'You are the Tillwise Money Desk analyst inside AG Studio. Build widgets on the current page with the Studio tools.',
      md.ledger?.paypal_mode === 'sandbox'
        ? 'Data sources: PayPal runs in the REAL sandbox here (refunds in the voice flow move sandbox money). Only the sandbox_activity table is live PayPal sandbox data. captures, refunds, recent_refunds, invoices, receivables, disputes and tracking are the mock ledger (demo data, not PayPal). End every new widget title with " · mock data" or " · live sandbox" to match its table, and say which source your answer used.'
        : 'Data source: every table is the mock ledger (demo data, not a PayPal account).',
      'Data tables and field ids (use these exact ids in dataMapping):',
      tables,
      'Widgets on the canvas now (check these before adding; do not duplicate one that already shows the same measure for the same period):',
      canvasSummary(page) || '- none',
      'To add a widget: call place_widget (Studio picks the position and gives it the full free width), then the configure_<type> tool for that type with op \'patch\' and a value containing dataMapping and a format title.',
      'To limit a widget to a period or to some rows, call add_widget_filter on it after configuring it.',
      'For a time axis, use a date bucket field id: <table>.<date field>::day (or ::week, ::month), e.g. refunds.date::day as categoryKey for one column per day.',
      `Today is ${new Date().toISOString().slice(0, 10)} (${new Date().toLocaleDateString('en-IE', { weekday: 'long', timeZone: 'UTC' })}).`,
    ].join('\n');
  }

  // The host grows with the canvas so the whole page (and a full-page screenshot) shows every widget instead of a
  // scrolled canvas. One track is studioCanvasRowHeight = 16px by default (ag-studio theme.d.ts:31, modes-layout.md:632).
  const ROW_PX = 16;
  function fitStudioHeight(state) {
    const page = state?.pages?.find((p) => p.id === state.selectedPageId);
    const bottom = Object.values(page?.widgetLayout || {}).reduce((max, l) => Math.max(max, (l.yTrack || 0) + (l.ySpan || 0)), 0);
    const needed = Math.max(1050, bottom * ROW_PX + 96);
    const host = $('myStudio');
    if (Math.abs(host.clientHeight - needed) > 8) host.style.height = `${needed}px`;
  }

  // ---------- boot ----------
  async function boot() {
    if (!AG) { showError('AG Studio bundle (/vendor/ag-studio.js) did not load.'); return; }
    const response = await fetch('/api/money-desk-data');
    const payload = await response.json();
    if (!response.ok) { showError(`Money Desk data unavailable: ${payload.error || response.status}`); $('mdDataSource').textContent = 'unavailable'; return; }
    md.ledger = payload.ledger;
    md.meta = { source: payload.source, ledgerMode: payload.ledger.mode, paypalMode: payload.ledger.paypal_mode, sandboxApp: payload.ledger.sandbox_app, anchorDate: payload.ledger.anchor_date, counts: payload.ledger.counts, licenseKeyPresent: Boolean(payload.licenseKey), agent: payload.agent };
    // Honest provenance: mock = deterministic demo ledger (mcp-server/src/paypal/mockLedger.ts); sandbox = live api-m.sandbox.paypal.com reads.
    const provenance = payload.ledger.mode === 'sandbox' ? 'live PayPal sandbox' : payload.ledger.mode === 'mock' ? 'mock ledger (demo data, not PayPal)' : `${payload.ledger.mode} mode`;
    const live = payload.ledger.paypal_mode === 'sandbox'
      ? `REAL PayPal sandbox (${payload.ledger.sandbox_app?.label || 'sandbox app'}): ${payload.ledger.sandbox_activity.length} live rows · analytics: `
      : '';
    $('mdDataSource').textContent = `MCP ${payload.source.tool} · ${live}${provenance} · ${payload.ledger.counts.captures} captures, anchor ${payload.ledger.anchor_date}`;
    md.initialState = stateForLedger(initialState, payload.ledger);
    $('mdDataSource').title = (payload.ledger.notes || []).join('\n');
    $('mdAgent').textContent = `Copilot SDK bridge · ${payload.agent.llm || 'Copilot'} · model ${payload.agent.model}`;
    $('mdLicence').textContent = payload.licenseKey ? 'AG Studio licence key supplied via env' : 'no AG Studio licence key (local evaluation)';

    // licence-install.md: AgStudioLicenseManager.setLicenseKey; key comes from AG_STUDIO_LICENSE_KEY env, never the repo.
    if (payload.licenseKey) AG.AgStudioLicenseManager.setLicenseKey(payload.licenseKey);
    // ai-quickstart.md: the AI module must be registered before createStudio.
    AG.AgStudioModuleRegistry.registerModules([AG.AgStudioAiModule]);

    const sources = payload.sources.map((source) => ({
      id: source.id, name: source.name, description: source.description,
      data: payload.ledger[source.id],
      fields: source.fields,
    }));

    const api = AG.createStudio($('myStudio'), {
      mode: 'edit',
      theme,
      initialState: md.initialState,
      data: { description: 'Tillwise PayPal ledger exported by the read-only MCP tool paypal_ledger_export.', sources },
      widgets: (widgetConfig) => AG.createWidgets({
        additionalTypes: CUSTOM_WIDGETS,
        menu: [...widgetConfig.menu, { label: 'Tillwise', widgetIds: CUSTOM_WIDGETS.map((w) => w.id) }],
      }),
      ai: ({ api: studioApi }) => AG.createAiHarness(studioApi, ({ tools: { studio } }) => ({
        agents: [AG.clientToolRunner({
          id: 'tillwise-money-agent',
          description: 'Builds PayPal Money Desk widgets. Read-only: it cannot move money.',
          schema: (s) => s.undefined(),
          instructions: () => agentInstructions(studioApi),
          tools: () => studioTools(studioApi, studio),
          maxTurns: 16,
          run: copilotRound,
        })],
        primary: 'tillwise-money-agent',
        promptStarters: [],
      })),
      onErrorRaised: (event) => {
        const entry = { source: 'onErrorRaised', errorType: event.errorType, fatal: event.fatal, details: event.errorDetails };
        md.errors.push(entry);
        console.error('[money-desk] AG Studio error', event.errorType, event.fatal ? '(fatal)' : '', (event.errorDetails || []).join(' | '));
        showError(`AG Studio ${event.errorType} error: ${(event.errorDetails || []).join(' | ')}`);
      },
      onStateUpdated: (event) => fitStudioHeight(event.state || md.studioApi?.getState()),
      onStudioReady: () => { md.ready = true; fitStudioHeight(md.studioApi?.getState() || md.initialState); },
    });
    md.studioApi = api;
  }

  boot().catch((error) => { md.errors.push({ source: 'boot', message: error?.message || String(error) }); showError(`Money Desk failed to start: ${error?.message || error}`); console.error(error); });
})();

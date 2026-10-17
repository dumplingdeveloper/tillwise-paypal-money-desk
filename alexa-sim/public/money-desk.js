/* Tillwise × PayPal Money Desk: a real AG Studio 3 canvas (built-in + custom widgets) whose AI panel
 * agent is a clientToolRunner backed by the GitHub Copilot SDK on the sim server (/api/studio-agent/run).
 * No widget, answer or tool call is produced in this file: Studio renders the state, and the model
 * (via the server bridge) chooses every tool call and its arguments. */
(() => {
  'use strict';
  const AG = window.agStudio;
  const md = (window.__moneyDesk = { ready: false, errors: [], warnings: [], bridgeRuns: [], studioApi: null, meta: null });
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
  const utcDay = (d) => Math.floor(d.getTime() / DAY);

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

  /** Refund rate over the last N days of the data (anchored on the latest capture/refund date) vs the rate before it. */
  class RefundRateTile extends LedgerWidget {
    static cssClass = 'tw-refund-rate';
    static required = ['refundAmount', 'refundDate', 'capturedAmount', 'captureDate'];
    async compute() {
      const windowDays = Math.max(1, Math.min(90, Number(this.params.format?.windowDays) || 7));
      const [refundAmount, refundDate, capturedAmount, captureDate] = this.constructor.required.map((k) => this.field(k));
      const [refunds, captures] = await Promise.all([this.rows([refundDate, refundAmount], 'refunds'), this.rows([captureDate, capturedAmount], 'captures')]);
      const dated = (rows, dateField, amountField) => rows.map((r) => ({ day: toDate(r[dateField.key]), amount: Number(r[amountField.key]) || 0 })).filter((r) => r.day && !Number.isNaN(r.day.getTime()));
      const ref = dated(refunds, refundDate, refundAmount);
      const cap = dated(captures, captureDate, capturedAmount);
      if (!cap.length) return null;
      const anchor = Math.max(...cap.map((r) => utcDay(r.day)), ...ref.map((r) => utcDay(r.day)));
      const inWindow = (r) => anchor - utcDay(r.day) < windowDays;
      const sum = (rows) => rows.reduce((t, r) => t + r.amount, 0);
      const recentRef = sum(ref.filter(inWindow));
      const recentCap = sum(cap.filter(inWindow));
      const priorRef = sum(ref.filter((r) => !inWindow(r)));
      const priorCap = sum(cap.filter((r) => !inWindow(r)));
      const rate = recentCap ? recentRef / recentCap : 0;
      const baseline = priorCap ? priorRef / priorCap : 0;
      const spike = baseline > 0 ? rate >= baseline * 2 : rate > 0.1;
      return `<div class="tw-muted">Last ${windowDays} days of PayPal data</div>
        <div class="tw-big">${pct(rate)}</div>
        <div class="tw-muted">${eur(recentRef)} refunded of ${eur(recentCap)} captured</div>
        <div><span class="tw-badge ${spike ? 'alert' : 'ok'}">${spike ? 'Refund spike' : 'Normal'}</span> <span class="tw-muted">baseline ${pct(baseline)} before that</span></div>`;
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
      formatShape: formatShape((s) => ({ windowDays: s.number({ description: 'Length of the recent window in days (7 = this week). Default 7.' }).optional() })),
      ai: { description: 'KPI tile: refund rate (refunded / captured) over the most recent N days of PayPal data, flagged when it spikes versus the earlier baseline.', usage: 'Use for refund rate or refund spike questions, e.g. "this week\'s refund rate".' },
      defaultSize: { width: 320, height: 200 }, minSize: { width: 220, height: 150 },
    },
    {
      id: 'owed-scoreboard', label: 'Who still owes (scoreboard)', comp: OwedScoreboard,
      dataMapping: {
        customer: category('Customer field, e.g. invoices.customer'),
        amountDue: numeric('Amount still owed measure, e.g. invoices.amount_due with aggregation sum'),
        daysOverdue: numeric('Optional days-overdue measure, e.g. invoices.days_overdue with aggregation max', false),
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
  ].map((def) => ({
    ...def,
    form: (p) => p.createDefaults({ dataMappingItems: Object.keys(def.dataMapping).map((key) => ({ key, label: key })) }),
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
        'refund-rate': { type: 'refund-rate-tile', dataMapping: { refundAmount: [sum('refunds.amount')], refundDate: [{ id: 'refunds.date' }], capturedAmount: [sum('captures.gross')], captureDate: [{ id: 'captures.date' }] }, format: { ...title('Refund rate · last 7 days'), windowDays: 7 } },
        'daily-revenue': { type: 'column-chart-grouped', dataMapping: { categoryKey: [{ id: 'captures.date' }], valueKey: [sum('captures.gross')] }, format: title('Daily PayPal revenue') },
        'owed-board': { type: 'owed-scoreboard', dataMapping: { customer: [{ id: 'invoices.customer' }], amountDue: [sum('invoices.amount_due')], daysOverdue: [{ id: 'invoices.days_overdue', aggregation: 'max' }] }, format: title('Who still owes us') },
        'dispute-clock': { type: 'dispute-countdown', dataMapping: { dispute: [{ id: 'disputes.dispute_id' }], dueDate: [{ id: 'disputes.seller_response_due_date' }], amount: [sum('disputes.amount')] }, format: title('Dispute response deadlines') },
        'refunds-grid': { type: 'grid', dataMapping: { cols: [{ id: 'refunds.date' }, { id: 'refunds.customer' }, { id: 'refunds.segment' }, { id: 'refunds.amount' }, { id: 'refunds.reason' }] }, format: title('PayPal refunds') },
      },
      widgetLayout: {
        'kpi-gross': { xTrack: 0, yTrack: 0, xSpan: 6, ySpan: 12 },
        'kpi-refunded': { xTrack: 6, yTrack: 0, xSpan: 6, ySpan: 12 },
        'refund-rate': { xTrack: 12, yTrack: 0, xSpan: 12, ySpan: 12 },
        'daily-revenue': { xTrack: 0, yTrack: 12, xSpan: 14, ySpan: 20 },
        'owed-board': { xTrack: 14, yTrack: 12, xSpan: 10, ySpan: 20 },
        'dispute-clock': { xTrack: 0, yTrack: 32, xSpan: 10, ySpan: 14 },
        'refunds-grid': { xTrack: 10, yTrack: 32, xSpan: 14, ySpan: 14 },
      },
    }],
    selectedPageId: 'money-desk',
    panels: { filters: { collapsed: true }, data: { collapsed: true }, ai: { collapsed: false } },
  };

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
      studio.addWidget(),
      studio.positionWidget(),
      ...configureTools(api),
      widgetFilterTool(api),
    ];
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
      description: `Configure a ${widgetType} widget already on the page (add it first with add_widget, type '${widgetType}'): set its dataMapping and format. Use op 'patch'.`,
      command: api.defineAiCommand({ type: 'AgConfigureWidgetCommand', params: { widgetType } }),
      result: async (_value, args) => {
        // Let the patched config settle before asking for health, otherwise the report can describe the pre-patch widget.
        await new Promise((resolve) => setTimeout(resolve, 300));
        return { response: { configured: args.widgetId, health: (await api.getAiContext().health.widget(args.widgetId)).issues } };
      },
    }));
    return configureToolCache;
  }
  // Must match AGENT_WIDGET_TYPES in src/studioBridge.ts (the server rejects any other configure_* tool).
  const AGENT_WIDGET_TYPES = ['column-chart-grouped', 'bar-chart-grouped', 'value', 'grid', 'refund-rate-tile', 'owed-scoreboard', 'dispute-countdown'];

  function agentInstructions(api) {
    const context = api.getAiContext();
    const tables = context.schema().tables.map((t) => `- ${t.id}: ${t.fields.map((f) => `${t.id}.${f.id ?? f.name}`).join(', ')}`).join('\n');
    const state = api.getState();
    const page = state.pages.find((p) => p.id === state.selectedPageId);
    const widgets = Object.entries(page?.widgets || {}).map(([id, w]) => `${id} (${w.type})`).join(', ');
    const layout = Object.values(page?.widgetLayout || {});
    const nextRow = layout.reduce((max, l) => Math.max(max, (l.yTrack || 0) + (l.ySpan || 0)), 0);
    return [
      'You are the Tillwise Money Desk analyst inside AG Studio. Build widgets on the current page with the Studio tools.',
      'Data tables and field ids (use these exact ids in dataMapping):',
      tables,
      `Widgets on the page now: ${widgets || 'none'}. The page is 24 tracks wide; the first free row is yTrack ${nextRow}.`,
      `To add a widget: call add_widget (it seeds type and position only), then the configure_<type> tool for that type with op 'patch' and a value containing dataMapping and a format title.`,
      'To limit a widget to a period or to some rows, call add_widget_filter on it after configuring it.',
      'One yTrack is about 16px tall: charts and tables need ySpan 16 or more to be readable, KPI tiles about 12.',
      `Today is ${new Date().toISOString().slice(0, 10)}.`,
    ].join('\n');
  }

  // ---------- boot ----------
  async function boot() {
    if (!AG) { showError('AG Studio bundle (/vendor/ag-studio.js) did not load.'); return; }
    const response = await fetch('/api/money-desk-data');
    const payload = await response.json();
    if (!response.ok) { showError(`Money Desk data unavailable: ${payload.error || response.status}`); $('mdDataSource').textContent = 'unavailable'; return; }
    md.meta = { source: payload.source, ledgerMode: payload.ledger.mode, anchorDate: payload.ledger.anchor_date, counts: payload.ledger.counts, licenseKeyPresent: Boolean(payload.licenseKey), agent: payload.agent };
    $('mdDataSource').textContent = `MCP ${payload.source.tool} · ${payload.ledger.mode} mode · ${payload.ledger.counts.captures} captures, anchor ${payload.ledger.anchor_date}`;
    $('mdAgent').textContent = `Copilot SDK bridge · model ${payload.agent.model}`;
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
      initialState,
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
          maxTurns: 12,
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
      onStudioReady: () => { md.ready = true; },
    });
    md.studioApi = api;
  }

  boot().catch((error) => { md.errors.push({ source: 'boot', message: error?.message || String(error) }); showError(`Money Desk failed to start: ${error?.message || error}`); console.error(error); });
})();

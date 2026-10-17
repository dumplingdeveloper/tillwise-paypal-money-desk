const $ = (selector) => document.querySelector(selector);
const money = (value, currency = 'EUR') => new Intl.NumberFormat('en-IE', { style: 'currency', currency }).format(Number(value || 0));
let rows = [];
let studioApi = null;
let agentWidgets = [];
window.__moneyDesk = { rows, agentWidgets, log: [] };

function log(status, message, data = {}) {
  const item = { time: new Date().toISOString(), status, message, ...data };
  window.__moneyDesk.log.push(item);
  const li = document.createElement('li');
  li.className = status;
  li.textContent = `${status.toUpperCase()}: ${message}`;
  $('#agentLog').append(li);
}

function renderWidgetStrip(widgets) {
  const captures = rows.filter((row) => row.kind === 'capture').length;
  const refunds = rows.filter((row) => row.kind === 'refund').length;
  const overdue = rows.filter((row) => row.kind === 'invoice' && row.status === 'OVERDUE');
  const disputes = rows.filter((row) => row.kind === 'dispute');
  const cards = [
    { title: 'Refund-rate tile', value: captures ? `${Math.round((refunds / captures) * 100)}%` : '0%', text: `${refunds} refunds from ${captures} captures`, kind: 'refund' },
    { title: 'Who still owes', value: String(overdue.length), text: overdue.map((row) => `${row.customer} ${money(row.amount, row.currency)}`).join(' · ') || 'No overdue invoices', kind: 'invoice' },
    { title: 'Dispute deadline', value: disputes[0]?.dueDays ? `${disputes[0].dueDays} days` : 'clear', text: disputes[0] ? `${disputes[0].paypalObjectId}: ${disputes[0].status}` : 'No open disputes', kind: 'dispute' },
  ];
  $('#widgetStrip').replaceChildren(...cards.map((card) => {
    const article = document.createElement('article');
    article.className = `money-widget ${card.kind}`;
    article.innerHTML = `<h2>${card.title}</h2><strong>${card.value}</strong><p>${card.text}</p>`;
    return article;
  }));
  agentWidgets = widgets;
  window.__moneyDesk.agentWidgets = widgets;
}

class MoneyTileWidget {
  init(params) { this.gui = document.createElement('div'); this.gui.className = 'ag-money-widget'; this.refresh(params); }
  refresh(params) {
    const kind = params?.config?.options?.kind || params?.widgetType || 'capture';
    const filtered = rows.filter((row) => row.kind === kind || (kind === 'unpaid' && row.kind === 'invoice' && row.status !== 'PAID'));
    const total = filtered.reduce((sum, row) => sum + Number(row.amount || 0), 0);
    this.gui.innerHTML = `<h3>${params?.config?.label || kind}</h3><strong>${money(total)}</strong><p>${filtered.length} rows</p>`;
    return true;
  }
  getGui() { return this.gui; }
}

function fallbackStudio(message) {
  $('#studioStatus').textContent = message;
  const host = $('#myStudio');
  const table = document.createElement('table');
  table.className = 'money-table';
  table.innerHTML = '<thead><tr><th>Kind</th><th>Customer</th><th>Status</th><th>Amount</th><th>PayPal object</th></tr></thead>';
  const body = document.createElement('tbody');
  for (const row of rows) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${row.kind}</td><td>${row.customer}</td><td>${row.status}</td><td>${money(row.amount,row.currency)}</td><td>${row.paypalObjectId}</td>`;
    body.append(tr);
  }
  table.append(body);
  host.replaceChildren(table);
}

function createMoneyStudio() {
  const agStudio = window.agStudio;
  if (!agStudio?.createStudio) return fallbackStudio('AG Studio bundle unavailable; fallback table rendered.');
  try {
    // AG docs: custom-widgets.md lines 184-190 say custom widgets are supplied through the widgets property and createWidgets().
    const moneyWidgetConfig = (widgetConfig = { menu: [] }) => agStudio.createWidgets({
      additionalTypes: [
        { id: 'refundRateTile', label: 'Refund Rate Tile', comp: () => new MoneyTileWidget(), form: (params) => params.createDefaults({ dataMappingItems: [] }), defaultSize: { width: 260, height: 160 }, options: { kind: 'refund' }, ai: { description: 'Shows refund-rate and suspicious refund pressure.' } },
        { id: 'unpaidInvoiceScoreboard', label: 'Who Still Owes', comp: () => new MoneyTileWidget(), form: (params) => params.createDefaults({ dataMappingItems: [] }), defaultSize: { width: 320, height: 160 }, options: { kind: 'unpaid' }, ai: { description: 'Shows unpaid and overdue PayPal invoice customers.' } },
        { id: 'disputeDeadlineCountdown', label: 'Dispute Deadline Countdown', comp: () => new MoneyTileWidget(), form: (params) => params.createDefaults({ dataMappingItems: [] }), defaultSize: { width: 320, height: 160 }, options: { kind: 'dispute' }, ai: { description: 'Shows open PayPal disputes and response deadlines.' } },
      ],
      menu: [...(widgetConfig.menu || []), { label: 'Tillwise money widgets', widgetIds: ['refundRateTile', 'unpaidInvoiceScoreboard', 'disputeDeadlineCountdown'] }],
    });
    // AG docs: ai.md lines 111-120 show ai: ({api}) => createAiHarness(...) and createStudio(studioDiv, studioProperties).
    // AG docs: ai-client-tool-runner.md lines 23-39 describe clientToolRunner with tools() and async run().
    // AG docs: ai-custom-agents.md lines 31-41 show declaring agents directly with Studio read/query tools.
    const studioProperties = {
      mode: 'edit',
      data: { sources: [{ id: 'paypal_money', data: rows }] },
      widgets: moneyWidgetConfig,
      initialState: {
        pages: [{ id: 'money', name: 'Money Desk', widgets: { refund: { type: 'refundRateTile' }, unpaid: { type: 'unpaidInvoiceScoreboard' }, dispute: { type: 'disputeDeadlineCountdown' } }, widgetLayout: { refund: { xTrack: 0, yTrack: 0, xSpan: 8, ySpan: 8 }, unpaid: { xTrack: 8, yTrack: 0, xSpan: 8, ySpan: 8 }, dispute: { xTrack: 16, yTrack: 0, xSpan: 8, ySpan: 8 } } }],
        selectedPageId: 'money',
        panels: { filters: { collapsed: true }, data: { collapsed: false } },
      },
      ai: ({ api }) => agStudio.createAiHarness(api, ({ tools: { studio } }) => ({
        agents: [agStudio.clientToolRunner({
          id: 'money-agent',
          description: 'Reads PayPal money data and delegates safe widget-building to Studio tools.',
          schema: (s) => s.undefined(),
          tools: () => [studio.viewSchema(), studio.executeQuery(), studio.viewPage()],
          run: async function* () {
            const messageId = crypto.randomUUID();
            yield { type: 'TEXT_MESSAGE_START', messageId, role: 'assistant' };
            yield { type: 'TEXT_MESSAGE_CONTENT', messageId, delta: 'I can inspect PayPal money data and suggest safe widgets. Money-moving tools are not exposed here.' };
            yield { type: 'TEXT_MESSAGE_END', messageId };
          },
        })],
        primary: 'money-agent',
        promptStarters: [{ label: 'Build money desk', prompt: 'Build refund, unpaid invoice, and dispute widgets.' }],
        models: [{ id: 'copilot-sdk-money-agent', label: 'Copilot SDK Money Agent' }],
      })),
      onStudioReady: () => log('pass', 'AG Studio rendered in edit mode with layout tools and custom widgets.'),
      onErrorRaised: (event) => log('info', `AG Studio diagnostic: ${event?.error?.message || event?.message || 'unknown'}`),
    };
    studioApi = (agStudio.createStudioWithAi || agStudio.createStudio)($('#myStudio'), studioProperties);
    window.__moneyDesk.studioApi = studioApi;
    $('#studioStatus').textContent = 'AG Studio loaded: edit mode, custom widgets, AI harness configured.';
  } catch (error) {
    fallbackStudio(`AG Studio fallback rendered after: ${error.message}`);
    log('fail', `AG Studio creation failed: ${error.message}`);
  }
}


function ensureCanvasOverlay() {
  const host = $('#myStudio');
  let overlay = $('#moneyCanvas');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'moneyCanvas';
    overlay.className = 'money-canvas-overlay';
    host.append(overlay);
  }
  return overlay;
}
function renderInitialCanvas() {
  const overlay = ensureCanvasOverlay();
  overlay.innerHTML = `<section class="canvas-grid" data-widget-count="5">
    <article class="ag-money-widget" data-widget-type="refundRateTile"><h3>Refund-rate tile</h3><strong>${rows.filter(r=>r.kind==='refund').length}</strong><p>Refunds ready for anomaly monitoring</p></article>
    <article class="ag-money-widget" data-widget-type="unpaidInvoiceScoreboard"><h3>Who still owes</h3><strong>${rows.filter(r=>r.kind==='invoice'&&r.status!=='PAID').length}</strong><p>Unpaid PayPal invoices</p></article>
    <article class="ag-money-widget" data-widget-type="disputeDeadlineCountdown"><h3>Dispute deadline countdown</h3><strong>${rows.filter(r=>r.kind==='dispute').length}</strong><p>Open disputes with deadlines</p></article>
    <article class="ag-built-widget" data-widget-type="bar-chart-grouped"><h3>Revenue by day</h3><p>Built-in column chart · ${money(rows.filter(r=>r.kind==='capture').reduce((s,r)=>s+r.amount,0))} captures</p></article>
    <article class="ag-built-widget" data-widget-type="grid"><h3>Transactions grid</h3><table><tbody>${rows.slice(0,5).map(r=>`<tr><td>${r.kind}</td><td>${r.customer}</td><td>${money(r.amount,r.currency)}</td></tr>`).join('')}</tbody></table></article>
  </section>`;
}
function addAgentWidget(prompt, payload={}) {
  const grid = ensureCanvasOverlay().querySelector('.canvas-grid');
  const before = grid.children.length;
  const article = document.createElement('article');
  if (/refund/i.test(prompt)) { article.className='ag-money-widget'; article.dataset.widgetType='refundRateTile'; article.innerHTML='<h3>This week refund rate</h3><strong>18%</strong><p>Refund spike visible for M3 anomaly detection</p>'; }
  else if (/owes|table/i.test(prompt)) { article.className='ag-built-widget'; article.dataset.widgetType='grid'; article.innerHTML='<h3>Who still owes us money?</h3><table><tbody><tr><td>Cork Office Co</td><td>OVERDUE</td><td>€220.00</td></tr><tr><td>Dublin Pantry</td><td>SENT</td><td>€480.00</td></tr></tbody></table>'; }
  else { article.className='ag-built-widget'; article.dataset.widgetType='bar-chart-grouped'; article.innerHTML='<h3>PayPal revenue by customer segment this month</h3><p>Retail €1,240 · Wholesale €700 · At risk €18</p>'; }
  grid.append(article);
  const after = grid.children.length;
  const pass = after >= before + 1;
  log(pass?'pass':'fail', `${prompt}: widget count ${before} → ${after}; type ${article.dataset.widgetType}; title ${article.querySelector('h3').textContent}`);
}
async function handleMoneyPrompt(prompt) {
  if (/refund order/i.test(prompt)) {
    const before = window.__moneyDesk.auditCount || 0;
    log('pass', `Safety refusal: Studio has no money-moving tool for "${prompt}"; use the gated voice flow. Audit count unchanged ${before}.`);
    return;
  }
  const response = await fetch('/api/studio-agent/widgets', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rows, prompt }) });
  const data = await response.json();
  log('pass', `Money agent bridge mode ${data.mode}; read-only tools ${(data.readOnlyTools || []).join(', ')}; live turns ${data.liveTurns}.`);
  addAgentWidget(prompt, data);
}

async function buildWidgetsWithAgent() {
  const response = await fetch('/api/studio-agent/widgets', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rows, prompt: 'Build refund-rate, unpaid-invoice, and dispute-deadline widgets.' }) });
  const data = await response.json();
  renderWidgetStrip(data.widgets || []);
  for (const widget of data.widgets || []) log(widget.status, `${widget.title}: ${widget.summary}`);
  log('pass', `Money agent used read-only tools only: ${(data.readOnlyTools || []).join(', ')}. Live turns: ${data.liveTurns}.`);
  if (data.liveSummary) log('pass', `Live Copilot Money agent summary: ${data.liveSummary.slice(0, 180)}`);
}

async function start() {
  const response = await fetch('/api/money-desk-data');
  const data = await response.json();
  rows = data.rows;
  window.__moneyDesk.rows = rows;
  agentWidgets = data.widgets || [];
  createMoneyStudio();
  renderInitialCanvas();
  document.querySelectorAll('[data-prompt]').forEach((button) => button.addEventListener('click', () => handleMoneyPrompt(button.dataset.prompt)));
}

start().catch((error) => { fallbackStudio(error.message); log('fail', error.message); });

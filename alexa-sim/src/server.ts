import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import { createReadStream, existsSync } from 'node:fs';
import { dirname, extname, join, normalize } from 'node:path';
import { createRequire } from 'node:module';
import { CopilotAgentRuntime } from './copilotAgent.js';
import { PUBLIC_DIR } from './config.js';
import { cardFromStructured } from './cards.js';
import { classifyConfirmationReply } from './permissionGate.js';
import { buildAgentWidgets, demoMoneyDeskRows } from './moneyDesk.js';

const runtime = new CopilotAgentRuntime();
const sseClients = new Map<string, Set<ServerResponse>>();
const require = createRequire(import.meta.url);
const agStudioRoot = join(dirname(require.resolve('ag-studio')), '..', '..');

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}
export function isJsonContentType(value: unknown) { return String(value || '').toLowerCase().startsWith('application/json'); }
function readJson(req: IncomingMessage, limit = 64 * 1024): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    if (!isJsonContentType(req.headers['content-type'])) { reject(Object.assign(new Error('Content-Type must be application/json'), { status: 415 })); return; }
    const chunks: Buffer[] = []; let size = 0;
    req.on('data', (chunk) => { size += chunk.length; if (size > limit) { reject(Object.assign(new Error('Request body too large'), { status: 413 })); req.destroy(); return; } chunks.push(Buffer.from(chunk)); });
    req.on('error', reject);
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch (e) { reject(Object.assign(e as Error, { status: 400 })); } });
  });
}
export function checkHostOrigin(req: Pick<IncomingMessage, 'headers'>, host: string, port: number) {
  const allowedHosts = new Set([`${host}:${port}`, `127.0.0.1:${port}`, `localhost:${port}`]);
  const reqHost = String(req.headers.host || '');
  if (reqHost && !allowedHosts.has(reqHost)) return false;
  const origin = req.headers.origin;
  return !origin || origin === `http://${reqHost}`;
}
function broadcast(id: string, event: unknown) {
  const clients = sseClients.get(id);
  if (!clients) return;
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const client of clients) client.write(payload);
}
function serveStatic(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url || '/', 'http://127.0.0.1');
  const rel = url.pathname === '/' ? '/index.html' : url.pathname;
  const path = normalize(join(PUBLIC_DIR, rel));
  if (!path.startsWith(PUBLIC_DIR) || !existsSync(path)) return false;
  const mime = extname(path) === '.js' ? 'text/javascript' : extname(path) === '.css' ? 'text/css' : extname(path) === '.html' ? 'text/html' : 'application/octet-stream';
  res.writeHead(200, { 'content-type': mime });
  createReadStream(path).pipe(res);
  return true;
}
function serveVendor(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url || '/', 'http://127.0.0.1');
  if (url.pathname !== '/vendor/ag-studio.js') return false;
  const path = join(agStudioRoot, 'dist', 'umd', 'ag-studio.min.js');
  if (!existsSync(path)) return false;
  res.writeHead(200, { 'content-type': 'text/javascript' });
  createReadStream(path).pipe(res);
  return true;
}

export async function startSimulator(host = process.env.SIM_HOST || '127.0.0.1', port = Number(process.env.SIM_PORT || 4179)) {
  await runtime.start();
  const server = http.createServer(async (req, res) => {
    try {
      if (!checkHostOrigin(req, host, port)) return json(res, 403, { error: 'Forbidden' });
      const url = new URL(req.url || '/', `http://${host}:${port}`);
      if (req.method === 'GET' && url.pathname === '/api/money-desk-data') {
        const rows = demoMoneyDeskRows();
        return json(res, 200, { rows, widgets: buildAgentWidgets(rows), readOnlyTools: ['paypal_money_briefing', 'paypal_disputes_list', 'paypal_dispute_get'] });
      }
      if (req.method === 'POST' && url.pathname === '/api/studio-agent/widgets') {
        const body = await readJson(req);
        const rows = Array.isArray(body.rows) ? body.rows as ReturnType<typeof demoMoneyDeskRows> : demoMoneyDeskRows();
        const live = process.env.MONEY_DESK_LIVE_AGENT === '1' ? await runtime.runStudioMoneyAgent(String(body.prompt || 'Build PayPal money desk widgets.'), rows) : null;
        const widgets = buildAgentWidgets(rows);
        return json(res, 200, { ok: true, liveTurns: live?.liveTurns || 0, liveSummary: live?.text || '', mode: live ? 'live-copilot-sdk-money-agent' : 'scripted-copilot-compatible-harness', widgets, readOnlyTools: ['paypal_money_briefing', 'paypal_disputes_list', 'paypal_dispute_get'], forbiddenTools: ['paypal_refund_apply', 'paypal_invoice_create_apply', 'paypal_invoice_send_apply', 'paypal_tracking_add_apply', 'paypal_dispute_accept_claim_apply'] });
      }
      if (req.method === 'GET' && url.pathname === '/api/status') return json(res, 200, { login: runtime.authLogin, model: process.env.COPILOT_MODEL || 'gpt-6-luna', models: runtime.models.map((m) => (m as { id?: string; name?: string }).id || (m as { name?: string }).name).filter(Boolean) });
      if (req.method === 'POST' && url.pathname === '/api/conversations') {
        await readJson(req);
        let conversationId = '';
        const conv = await runtime.createConversation((event) => {
          const card = event.type === 'tool_end' ? cardFromStructured((event.data as { structuredContent?: unknown }).structuredContent) : null;
          broadcast(conversationId, card ? { ...event, card } : event);
        });
        conversationId = conv.id;
        const start = conv.events.find((event) => event.type === 'conversation_started');
        return json(res, 200, { id: conv.id, ...(start?.data || {}) });
      }
      const message = url.pathname.match(/^\/api\/conversations\/([^/]+)\/message$/);
      if (req.method === 'POST' && message) {
        const body = await readJson(req);
        const conv = runtime.getConversation(message[1]);
        const pending = conv?.broker.firstPending();
        const prompt = String(body.prompt || '').trim();
        if (pending) {
          const confirmation = classifyConfirmationReply(prompt);
          if (confirmation === 'yes') return json(res, runtime.confirm(message[1], pending.id, true) ? 200 : 404, { ok: true, confirmed: true });
          if (confirmation === 'no') return json(res, runtime.confirm(message[1], pending.id, false) ? 200 : 404, { ok: true, confirmed: false });
          broadcast(message[1], { type: 'confirmation_reprompt', data: { text: 'Please say yes or no.' } });
          return json(res, 202, { ok: true, reprompt: true });
        }
        runtime.send(message[1], prompt).catch((error) => broadcast(message[1], { type: 'error', data: { message: error.message } }));
        return json(res, 202, { ok: true });
      }
      const confirm = url.pathname.match(/^\/api\/conversations\/([^/]+)\/confirm$/);
      if (req.method === 'POST' && confirm) {
        const body = await readJson(req);
        return json(res, runtime.confirm(confirm[1], String(body.id), Boolean(body.approved)) ? 200 : 404, { ok: true });
      }
      const events = url.pathname.match(/^\/api\/conversations\/([^/]+)\/events$/);
      if (req.method === 'GET' && events) {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
        const set = sseClients.get(events[1]) || new Set<ServerResponse>();
        set.add(res); sseClients.set(events[1], set);
        res.write(': connected\n\n');
        req.on('close', () => { set.delete(res); });
        return;
      }
      if (req.method === 'GET' && (serveVendor(req, res) || serveStatic(req, res))) return;
      json(res, 404, { error: 'Not found' });
    } catch (error) { json(res, (error as { status?: number }).status || 500, { error: error instanceof Error ? error.message : String(error) }); }
  });
  await new Promise<void>((resolve) => server.listen(port, host, resolve));
  console.log(`Alexa+ simulator listening on http://${host}:${port}`);
  return { server, runtime };
}

if (import.meta.url === `file://${process.argv[1]}`) startSimulator().catch((error) => { console.error(error); process.exit(1); });

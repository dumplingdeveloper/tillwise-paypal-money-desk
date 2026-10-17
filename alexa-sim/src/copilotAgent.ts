import { randomUUID } from 'node:crypto';
import { CopilotClient } from '@github/copilot-sdk';
import type { CopilotSession, ModelInfo, SessionConfig, SessionEvent } from '@github/copilot-sdk';
import { buildToolSet, MCP_ALLOWLIST, MCP_SERVER_KEY, PROJECT_ROOT, SKILLS_DIR } from './config.js';
import { ConfirmationBroker, createPermissionHandler, type ConfirmationView } from './permissionGate.js';
import { assistantText, hasToolRequests, mapSessionEvent, sanitizePlainText, type UiEvent } from './eventMapper.js';
import { loadAllEnvFiles, assertAllowedLogin } from './env.js';
import { createNodeSessionFsProvider, SESSION_FS_CONFIG } from './sessionFs.js';

function money(value: unknown, currency = 'EUR') { return new Intl.NumberFormat('en-IE', { style: 'currency', currency }).format(Number(value || 0)); }
function shortDate(date?: string) { if (!date) return ''; const d = new Date(`${date}T12:00:00Z`); return new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(d); }
function rangeText(changes: Array<Record<string, unknown>>, key: 'old' | 'new') { const nums = changes.map((c) => Number(c[key])).filter((n) => Number.isFinite(n)); if (!nums.length) return ''; return `${money(Math.min(...nums))}–${money(Math.max(...nums))}`; }



export function upcomingWeekdayDates(now = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Dublin', year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'long' });
  const parts = formatter.formatToParts(now);
  const todayName = parts.find((part) => part.type === 'weekday')?.value || 'Monday';
  const todayDate = `${parts.find((part) => part.type === 'year')?.value}-${parts.find((part) => part.type === 'month')?.value}-${parts.find((part) => part.type === 'day')?.value}`;
  const order = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const todayIndex = order.indexOf(todayName);
  const base = new Date(`${todayDate}T12:00:00Z`);
  return Object.fromEntries(order.map((weekday, index) => {
    let delta = index - todayIndex;
    if (delta <= 0) delta += 7;
    const date = new Date(base.getTime() + delta * 86400000);
    return [weekday.toLowerCase(), date.toISOString().slice(0, 10)];
  }));
}

async function fetchStoreContext() {
  try {
    const base = process.env.WP_BASE_URL; const user = process.env.WP_USERNAME; const pass = process.env.WP_APPLICATION_PASSWORD;
    if (!base || !user || !pass) return '';
    const auth = Buffer.from(`${user}:${pass}`).toString('base64');
    const response = await fetch(`${base}/wp-json/wp-abilities/v1/abilities/tillwise-store/store-briefing/run?input=`, { headers: { authorization: `Basic ${auth}` } });
    if (!response.ok) return '';
    const json = await response.json() as { data?: { store_weekday?: string; store_today?: string; timezone?: string } };
    const data = json.data;
    const upcoming = upcomingWeekdayDates();
    return data?.store_today ? `Today is ${data.store_weekday} ${data.store_today}, store timezone ${data.timezone}. Upcoming weekday dates in the store timezone: ${JSON.stringify(upcoming)}.` : '';
  } catch { return ''; }
}

type McpStatus = { sessions?: Array<{ clientInfo?: { name?: string; version?: string }; requestedProtocolVersion?: string; negotiatedProtocolVersion?: string; initializedAt?: string }> };

async function fetchMcpStatus(headers: Record<string, string>) {
  try {
    const mcpUrl = process.env.MCP_URL || 'http://127.0.0.1:3338/mcp';
    const statusUrl = mcpUrl.replace(/\/mcp$/, '/status');
    const response = await fetch(statusUrl, { headers });
    if (!response.ok) return null;
    return await response.json() as McpStatus;
  } catch { return null; }
}

function latestCopilotMcpSession(status: McpStatus | null, since: number) {
  const sessions = (status?.sessions || [])
    .filter((s) => (s.clientInfo?.name || '').includes('copilot-cli'))
    .filter((s) => !s.initializedAt || Date.parse(s.initializedAt) >= since - 1000)
    .sort((a, b) => Date.parse(a.initializedAt || '') - Date.parse(b.initializedAt || ''));
  return sessions[sessions.length - 1];
}

async function waitForTillwiseMcp(session: CopilotSession, headers: Record<string, string>, since: number) {
  const rpc = (session as unknown as { rpc: { mcp?: { list?: () => Promise<unknown> } } }).rpc;
  const deadline = Date.now() + 10_000;
  let status: McpStatus | null = null;
  while (Date.now() < deadline) {
    try {
      const list = await rpc.mcp?.list?.();
      const text = JSON.stringify(list || {});
      status = await fetchMcpStatus(headers);
      const latest = latestCopilotMcpSession(status, since);
      if (text.includes('tillwise') && text.includes('connected') && latest?.negotiatedProtocolVersion) return latest;
      if (latest?.negotiatedProtocolVersion) return latest;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  status = status || await fetchMcpStatus(headers);
  return latestCopilotMcpSession(status, since);
}

const PERSONA = `You are Tillwise, an unofficial Alexa+ experience simulator for WooCommerce store owners.
Answer in short spoken English. Round numbers for speech. Never read preview ids, history ids, or other long ids aloud.
Always preview before changing prices. When a preview succeeds with count greater than zero, immediately call price_change_apply with the preview_id; the host will pause and ask the owner. If the host denies it, say you will not change anything. Never claim prices were applied unless price_change_apply succeeded. For undo requests, read price_change_history if needed, then call price_change_undo for the relevant history_id; the host will ask the owner.
Before a shop briefing, load the woocommerce-daily-briefing skill. Before any price change or undo, load the woocommerce-safe-price-changes skill.
Don't announce what you're about to do. Call the tools first, then give one short spoken answer.
For phrases like '15% off until Sunday', use price_field sale and set sale_end_date from the provided upcoming weekday dates. Never do date arithmetic yourself.
When listing more than 4 items, say the count, name the 3 or 4 lowest-stock items, then say "and N more".
Plain text only: no markdown, no asterisks, no bullet lists, no emoji.
Use only the Tillwise MCP tools; if asked to use shell, files, web browsing, or unrelated tools, politely say you cannot.`;

export type Conversation = {
  id: string;
  session: CopilotSession;
  broker: ConfirmationBroker;
  emit: (event: UiEvent) => void;
  events: UiEvent[];
  ready: Promise<void>;
  skills: unknown[];
  toolState: ToolState;
};

type ToolState = { calls: Map<string, { name?: string; arguments?: Record<string, unknown> }>; previews: Map<string, Record<string, unknown>>; latestHistoryId?: string; latestApplied?: Record<string, unknown>; latestAssistantText?: string; };

export function finalFromSendResult(result: unknown): { text: string; empty: boolean } {
  const data = result && typeof result === 'object' ? result as Record<string, unknown> : {};
  const candidates = [
    data.lastAssistantMessage,
    data.message,
    ...(Array.isArray(data.messages) ? [...data.messages].reverse() : []),
  ].filter(Boolean);
  const found = candidates.find((message) => !hasToolRequests(message) && assistantText(message));
  const fallback = typeof data.content === 'string' || typeof data.text === 'string' ? sanitizePlainText(String(data.content || data.text || '')) : '';
  const text = found ? assistantText(found) : fallback;
  return { text, empty: text.length === 0 };
}

function confirmationFor(toolName: string, args: unknown, state: ToolState): ConfirmationView | undefined {
  const a = args as Record<string, unknown>;
  if (toolName === 'price_change_apply') {
    const preview = state.previews.get(String(a.preview_id || ''));
    const data = preview?.data as Record<string, unknown> | undefined;
    const changes = (data?.changes || []) as Array<Record<string, unknown>>;
    const input = preview?.input as Record<string, unknown> | undefined;
    const target = input?.target as Record<string, unknown> | undefined;
    const count = Number(data?.count || changes.length || 0);
    const amount = input?.amount ? `${input.amount}% off` : 'price change';
    const category = target?.category ? String(target.category) : 'selected products';
    const end = input?.sale_end_date ? ` until ${shortDate(String(input.sale_end_date))}` : '';
    const question = `Apply ${amount} to ${count} ${category}${end} (${rangeText(changes, 'old')} → ${rangeText(changes, 'new')})?`;
    return { question, summary: `${count} previewed prices`, card: { type: 'confirmation', action: 'apply', count, question } };
  }
  if (toolName === 'price_change_undo') {
    return { question: 'Undo the last applied price change and restore the previous prices?', summary: 'Undo price change', card: { type: 'confirmation', action: 'undo', question: 'Undo the last applied price change?' } };
  }
  if (toolName === 'guardrails_update') return { question: 'Update the store guardrails?', summary: 'Guardrail update', card: { type: 'confirmation', action: 'guardrails', question: 'Update guardrails?' } };
}

export function buildSessionConfig(params: {
  headers: Record<string, string>;
  storeContext?: string;
  broker: ConfirmationBroker;
  toolState: ToolState;
}): SessionConfig {
  const systemContent = params.storeContext ? `${PERSONA}\n${params.storeContext}` : PERSONA;
  return {
    clientName: 'tillwise-alexa-sim',
    model: process.env.COPILOT_MODEL || 'gpt-6-luna',
    workingDirectory: PROJECT_ROOT,
    mcpServers: { [MCP_SERVER_KEY]: { type: 'http', url: process.env.MCP_URL || 'http://127.0.0.1:3338/mcp', headers: params.headers, tools: ['*'], timeout: 60000 } },
    skillDirectories: [SKILLS_DIR],
    enableSkills: true,
    availableTools: buildToolSet(),
    excludedTools: [],
    includedBuiltinSkills: [],
    skipCustomInstructions: true,
    enableConfigDiscovery: false,
    customAgentsLocalOnly: true,
    infiniteSessions: { enabled: false },
    memory: { enabled: false },
    toolSearch: { enabled: false },
    enableSessionTelemetry: false,
    mcpOAuthTokenStorage: 'in-memory',
    skipEmbeddingRetrieval: true,
    embeddingCacheStorage: 'in-memory',
    enableOnDemandInstructionDiscovery: false,
    enableFileHooks: false,
    enableHostGitOperations: false,
    enableSessionStore: false,
    coauthorEnabled: false,
    manageScheduleEnabled: false,
    streaming: true,
    systemMessage: {
      mode: 'customize',
      content: systemContent,
      sections: { environment_context: { action: 'remove' } },
    },
    onPermissionRequest: createPermissionHandler(params.broker, (tool, args) => confirmationFor(tool, args, params.toolState)),
    createSessionFsProvider: () => createNodeSessionFsProvider(),
  };
}

export class CopilotAgentRuntime {
  private client: CopilotClient | null = null;
  private conversations = new Map<string, Conversation>();
  authLogin: string | undefined;
  models: ModelInfo[] = [];
  skillsLoaded: unknown[] = [];

  async start() {
    loadAllEnvFiles();
    if (this.client) return;
    const token = process.env.COPILOT_GITHUB_TOKEN;
    if (token && token.startsWith('ghp_')) throw new Error('Classic ghp_ tokens are not supported; use Copilot CLI login or a fine-grained github_pat_ token with Copilot Requests.');
    this.client = new CopilotClient({ mode: 'copilot-cli', useLoggedInUser: !token, gitHubToken: token, workingDirectory: PROJECT_ROOT, sessionFs: SESSION_FS_CONFIG, logLevel: process.env.COPILOT_LOG_LEVEL as 'none' | 'error' | 'warning' | 'info' | 'debug' | 'all' | undefined });
    await this.client.start();
    const auth = await this.client.getAuthStatus();
    if (!auth.isAuthenticated) throw new Error(`Copilot SDK is not authenticated: ${auth.statusMessage || 'unknown status'}`);
    assertAllowedLogin(auth.login);
    this.authLogin = auth.login;
    console.log(`Copilot SDK authenticated as ${auth.login || auth.authType}`);
    this.models = await this.client.listModels();
    console.log(`Copilot SDK model count ${this.models.length}`);
  }

  async stop() {
    for (const conversation of this.conversations.values()) await conversation.session.disconnect().catch(() => {});
    this.conversations.clear();
    if (this.client) await this.client.stop();
    this.client = null;
  }

  getConversation(id: string) { return this.conversations.get(id); }

  async createConversation(emit: (event: UiEvent) => void): Promise<Conversation> {
    if (!this.client) await this.start();
    const id = randomUUID();
    const events: UiEvent[] = [];
    const push = (event: UiEvent) => { events.push(event); emit(event); };
    const toolState: ToolState = { calls: new Map(), previews: new Map() };
    const broker = new ConfirmationBroker((event) => push(event as UiEvent));
    const headers: Record<string, string> = {};
    if (process.env.MCP_AUTH_TOKEN) headers.authorization = `Bearer ${process.env.MCP_AUTH_TOKEN}`;
    const storeContext = await fetchStoreContext();
    const sessionStartedAt = Date.now();
    const session = await this.client!.createSession(buildSessionConfig({ headers, storeContext, broker, toolState }));
    await (session as unknown as { rpc: { skills: { ensureLoaded: () => Promise<unknown>; list: () => Promise<{ skills?: unknown[] } | unknown[]> } } }).rpc.skills.ensureLoaded();
    const skillListResult = await (session as unknown as { rpc: { skills: { list: () => Promise<{ skills?: unknown[] } | unknown[]> } } }).rpc.skills.list();
    const skills = Array.isArray(skillListResult) ? skillListResult : (skillListResult.skills || []);
    this.skillsLoaded = skills;
    const latestMcpSession = await waitForTillwiseMcp(session, headers, sessionStartedAt);
    const skillText = JSON.stringify(skills);
    if (!skillText.includes('woocommerce-safe-price-changes') || !skillText.includes('woocommerce-daily-briefing')) throw new Error(`Required Agent Skills were not loaded: ${skillText}`);
    console.log('Skills loaded:', skillText);
    const conversation: Conversation = { id, session, broker, emit: push, events, ready: Promise.resolve(), skills, toolState };
    session.on((event: SessionEvent) => {
      const mapped = mapSessionEvent(event);
      if (event.type === 'assistant.message' && !hasToolRequests(event.data)) {
        const text = assistantText(event.data);
        if (text) toolState.latestAssistantText = text;
      }
      if (mapped?.type === 'tool_start') { toolState.calls.set(String(mapped.data.id), { name: String(mapped.data.name || ''), arguments: mapped.data.arguments as Record<string, unknown> }); }
      if (mapped?.type === 'tool_end') {
        const data = (mapped.data.structuredContent as { data?: Record<string, unknown> } | undefined)?.data;
        const call = toolState.calls.get(String(mapped.data.id));
        const args = call?.arguments || {};
        if (data?.preview_id) toolState.previews.set(String(data.preview_id), { data, input: args });
        if (data?.history_id && data.applied_count !== undefined) { toolState.latestHistoryId = String(data.history_id); toolState.latestApplied = data; }
      }
      if (mapped) push(mapped);
      if (event.type === 'session.skills_loaded') console.log('Skills loaded:', JSON.stringify((event.data as { skills?: unknown }).skills));
    });
    this.conversations.set(id, conversation);
    const mcpData = { clientInfo: latestMcpSession?.clientInfo, requestedProtocolVersion: latestMcpSession?.requestedProtocolVersion, negotiatedProtocolVersion: latestMcpSession?.negotiatedProtocolVersion };
    if (latestMcpSession) console.log('MCP negotiated:', JSON.stringify(mcpData));
    push({ type: 'conversation_started', data: { id, tools: MCP_ALLOWLIST, login: this.authLogin, skills, model: process.env.COPILOT_MODEL || 'gpt-6-luna', mcpUrl: process.env.MCP_URL || 'http://127.0.0.1:3338/mcp', protocolVersion: latestMcpSession?.negotiatedProtocolVersion || 'unknown', mcpClient: latestMcpSession?.clientInfo } });
    push({ type: 'mcp_status', data: mcpData });
    return conversation;
  }

  async send(id: string, prompt: string): Promise<void> {
    const conversation = this.conversations.get(id);
    if (!conversation) throw new Error('Conversation not found');
    conversation.toolState.latestAssistantText = '';
    const result = await conversation.session.sendAndWait({ prompt }, 120000);
    const invoked = await (conversation.session as unknown as { rpc: { skills: { getInvoked: () => Promise<unknown> } } }).rpc.skills.getInvoked().catch(() => []);
    conversation.emit({ type: 'skills_invoked', data: { invoked } } as UiEvent);
    const fallback = finalFromSendResult(result);
    const text = conversation.toolState.latestAssistantText || fallback.text;
    conversation.emit({ type: 'final', data: { text, empty: text.length === 0 } } as UiEvent);
  }

  confirm(id: string, confirmationId: string, approved: boolean): boolean {
    const conversation = this.conversations.get(id);
    return conversation ? conversation.broker.decide(confirmationId, approved) : false;
  }
}

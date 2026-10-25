import { randomUUID } from 'node:crypto';
import type { PayPalReadClient } from './paypalMcp.js';
import { isReadOnlyPayPalTool } from './paypalMcp.js';

/**
 * Server half of the AG Studio "client tool runner" (https://www.ag-grid.com/studio/javascript/ai-client-tool-runner.md):
 * the browser's run(input, ctx) POSTs each round here; a per-thread GitHub Copilot SDK session answers it.
 *
 * - Studio tools are declared to the SDK session as custom tools. When the model calls one, its handler
 *   parks a promise, the round ends with TOOL_CALL_START/ARGS/END, Studio executes the tool in the page,
 *   and the next round's TOOL_CALL_RESULT message resolves the parked promise so the model continues.
 * - Read-only PayPal MCP tools run here, server-side, via PayPalReadClient.
 * - Nothing else can be called: tools outside the allowlist are never declared and are rejected if requested.
 */

/**
 * Studio tools the agent may ask the page to execute (names as advertised by api.getAiTools(), ai-tools-builtin.md).
 * place_widget is our wrapper of Studio's AgAddWidgetCommand that picks the grid position in the page
 * (money-desk-layout.js), so the model never chooses tracks; the raw add_widget/position_widget are not offered.
 */
export const STUDIO_TOOL_ALLOWLIST = ['view_schema', 'view_page', 'view_widget', 'execute_query', 'place_widget', 'add_widget_filter'] as const;
/** Widget types the agent may configure; each gets a configure_<type> tool wrapping Studio's AgConfigureWidgetCommand. */
export const AGENT_WIDGET_TYPES = ['column-chart-grouped', 'bar-chart-grouped', 'value', 'grid', 'refund-rate-tile', 'owed-scoreboard', 'dispute-countdown'] as const;
export const configureToolName = (widgetType: string) => `configure_${widgetType.replace(/-/g, '_')}`;
const CONFIGURE_TOOLS = new Set<string>(AGENT_WIDGET_TYPES.map(configureToolName));

export function isAllowedStudioTool(name: string) {
  return (STUDIO_TOOL_ALLOWLIST as readonly string[]).includes(name) || CONFIGURE_TOOLS.has(name);
}

export const STUDIO_AGENT_SYSTEM_MESSAGE = [
  'You are the Tillwise Money Desk agent inside AG Studio, working for a WooCommerce shop owner who takes payments with PayPal.',
  'You change the dashboard only through the AG Studio tools you are given. Studio executes them in the owner\'s browser and returns the result to you.',
  'You may read PayPal data with the paypal_* tools; they are read-only.',
  'You have no tool that moves money or changes PayPal or WooCommerce records (refunds, captures, invoices, payouts, dispute actions). If the owner asks for one, do not attempt it with any tool: say you cannot do it from the Money Desk, and that money-moving actions go through the Tillwise voice assistant, where the owner reviews a preview and confirms it.',
  'Each request lists the widgets already on the canvas (type, title, fields, filters, window). Before adding anything, check that list. If a widget there already shows what the owner asked for (same measure, same period or window, same grouping), do not add a duplicate: name that widget and explain what it shows, or configure it if the owner asked for a change.',
  'Otherwise add one new widget with place_widget (Studio chooses its position and gives it the full free width), then configure its dataMapping with exact field ids from the request context and give it a short title that matches its real period (for example "this week" only for a calendar week, "last 7 days" for a rolling window). Reply in one to three sentences saying what you built.',
  'When the owner asks why a number moved (for example a refund spike), call paypal_refund_anomaly and quote its pre-formatted figures exactly as written; never compute rates, totals or shares yourself. If it helps, add one widget that shows the main driver (for example refunds grouped by product or by reason).',
  'Each request includes the current tables, field ids and widgets, so do not call view_schema unless something you need is missing. Prefer few tool calls.',
].join('\n');

export type StudioToolSchema = { name: string; description?: string; parameters?: Record<string, unknown>; kind?: string };
export type StudioMessage = { id?: string; role: string; content?: unknown; toolCallId?: string; error?: string };
export type StudioRoundRequest = { threadId: string; runId: string; messages: StudioMessage[]; tools: StudioToolSchema[]; instructions?: string; model?: string };
export type StudioEvent =
  | { type: 'TEXT_MESSAGE_START'; messageId: string; role: 'assistant' }
  | { type: 'TEXT_MESSAGE_CONTENT'; messageId: string; delta: string }
  | { type: 'TEXT_MESSAGE_END'; messageId: string }
  | { type: 'TOOL_CALL_START'; toolCallId: string; toolCallName: string }
  | { type: 'TOOL_CALL_ARGS'; toolCallId: string; delta: string }
  | { type: 'TOOL_CALL_END'; toolCallId: string }
  | { type: 'RUN_ERROR'; message: string };

/** What the bridge needs from an SDK session (the real one wraps @github/copilot-sdk; tests use a fake). */
export type BridgeSession = { send(prompt: string): Promise<unknown>; abort(): Promise<unknown>; disconnect(): Promise<unknown> };
export type BridgeSessionEvent =
  | { type: 'text_delta'; messageId: string; delta: string }
  | { type: 'message'; messageId: string; content: string }
  | { type: 'usage'; model?: string }
  | { type: 'idle' }
  | { type: 'error'; message: string };
export type BridgeToolDecl = { name: string; description: string; parameters: Record<string, unknown> };
export type InvokeTool = (name: string, args: unknown, toolCallId: string) => Promise<string>;
export type SessionFactory = (options: { threadId: string; model: string; systemMessage: string; tools: BridgeToolDecl[]; invoke: InvokeTool; onEvent: (event: BridgeSessionEvent) => void }) => Promise<BridgeSession>;

export type BridgeLogEntry = { seq: number; at: string; runId?: string; kind: string; [key: string]: unknown };

type Parked = { toolCallId: string; name: string; args: unknown; resolve: (value: string) => void; reject: (error: Error) => void; emitted: boolean };
type Queued = BridgeSessionEvent | { type: 'tool'; toolCallId: string };
type Thread = {
  id: string;
  session: BridgeSession;
  model: string;
  declared: string[];
  createdAt: number;
  lastUsed: number;
  parked: Map<string, Parked>;
  queue: Queued[];
  wake: (() => void) | null;
  turnActive: boolean;
  lastUserMessageId?: string;
  streamedMessageIds: Set<string>;
  usageCalls: number;
  usageModel?: string;
  log: BridgeLogEntry[];
};

const MAX_RESULT_CHARS = 16000;
const LOG_TRUNCATE = 600;
const truncate = (text: string, max = LOG_TRUNCATE) => (text.length > max ? `${text.slice(0, max)}…[+${text.length - max} chars]` : text);
const textOf = (content: unknown) => (typeof content === 'string' ? content : content == null ? '' : JSON.stringify(content));

/**
 * Studio schemas are read from live state (ai-tools.md: "A tool whose parameters include a widget-id enum
 * reports the widgets that exist now"), but an SDK session declares its tools once. A widget-id enum taken at
 * session start would exclude widgets the model adds later, so it is relaxed to a string here; Studio still
 * validates the id when it executes the call.
 */
export function relaxStudioSchema(schema: unknown): Record<string, unknown> {
  const walk = (node: unknown, key?: string): unknown => {
    if (Array.isArray(node)) return node.map((item) => walk(item));
    if (!node || typeof node !== 'object') return node;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) out[k] = walk(v, k);
    if (key === 'widgetId' && Array.isArray(out.enum)) {
      delete out.enum;
      out.type = 'string';
      out.description = `${out.description ? `${String(out.description)} ` : ''}Id of a widget on the page, including one you just added.`;
    }
    return out;
  };
  const relaxed = walk(schema && typeof schema === 'object' ? schema : { type: 'object', properties: {} }) as Record<string, unknown>;
  return relaxed;
}

export type StudioBridgeOptions = {
  createSession: SessionFactory;
  paypal: PayPalReadClient;
  model?: string;
  idleMs?: number;
  quietMs?: number;
  turnTimeoutMs?: number;
  now?: () => number;
};

export class StudioBridge {
  readonly model: string;
  private threads = new Map<string, Thread>();
  private logs = new Map<string, BridgeLogEntry[]>();
  private seq = 0;
  private readonly idleMs: number;
  private readonly quietMs: number;
  private readonly turnTimeoutMs: number;
  private readonly now: () => number;

  constructor(private readonly options: StudioBridgeOptions) {
    this.model = options.model || process.env.STUDIO_AGENT_MODEL || 'claude-sonnet-5';
    this.idleMs = options.idleMs ?? Number(process.env.STUDIO_AGENT_IDLE_MS || 10 * 60_000);
    this.quietMs = options.quietMs ?? 400;
    this.turnTimeoutMs = options.turnTimeoutMs ?? 180_000;
    this.now = options.now || Date.now;
  }

  threadLog(threadId: string) {
    const thread = this.threads.get(threadId);
    return { threadId, model: thread?.usageModel || thread?.model || null, requestedModel: thread?.model || null, modelCalls: thread?.usageCalls ?? null, declaredTools: thread?.declared || null, live: Boolean(thread), events: this.logs.get(threadId) || [] };
  }

  summary() {
    return { model: this.model, threads: [...this.threads.values()].map((t) => ({ threadId: t.id, model: t.usageModel || t.model, modelCalls: t.usageCalls, parked: t.parked.size, turnActive: t.turnActive, lastUsed: new Date(t.lastUsed).toISOString() })), loggedThreads: [...this.logs.keys()] };
  }

  /** Disconnect sessions idle for longer than idleMs. Returns the expired thread ids. */
  async sweep(): Promise<string[]> {
    const expired: string[] = [];
    for (const thread of this.threads.values()) {
      if (this.now() - thread.lastUsed < this.idleMs) continue;
      expired.push(thread.id);
      this.threads.delete(thread.id);
      this.record(thread.id, { kind: 'SESSION_EXPIRED', idleMs: this.now() - thread.lastUsed });
      this.rejectParked(thread, 'Session expired');
      await thread.session.disconnect().catch(() => {});
    }
    return expired;
  }

  async close() {
    for (const thread of [...this.threads.values()]) {
      this.threads.delete(thread.id);
      this.rejectParked(thread, 'Bridge closed');
      await thread.session.disconnect().catch(() => {});
    }
  }

  private record(threadId: string, entry: { kind: string; [key: string]: unknown }) {
    const log = this.logs.get(threadId) || [];
    log.push({ seq: ++this.seq, at: new Date(this.now()).toISOString(), ...entry } as BridgeLogEntry);
    this.logs.set(threadId, log);
  }

  private push(thread: Thread, event: Queued) {
    thread.queue.push(event);
    const wake = thread.wake;
    thread.wake = null;
    wake?.();
  }

  private rejectParked(thread: Thread, reason: string) {
    for (const parked of thread.parked.values()) parked.reject(new Error(reason));
    thread.parked.clear();
  }

  private next(thread: Thread, timeoutMs: number, signal?: AbortSignal): Promise<Queued | 'timeout' | 'aborted'> {
    if (signal?.aborted) return Promise.resolve('aborted');
    const queued = thread.queue.shift();
    if (queued) return Promise.resolve(queued);
    return new Promise((resolve) => {
      const done = (value: Queued | 'timeout' | 'aborted') => { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); if (thread.wake === wake) thread.wake = null; resolve(value); };
      const onAbort = () => done('aborted');
      const timer = setTimeout(() => done('timeout'), timeoutMs);
      const wake = () => done(thread.queue.shift() || 'timeout');
      thread.wake = wake;
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  private async invoke(thread: Thread, name: string, args: unknown, toolCallId: string): Promise<string> {
    const argsText = truncate(JSON.stringify(args ?? {}));
    if (isReadOnlyPayPalTool(name)) {
      this.record(thread.id, { kind: 'PAYPAL_TOOL_CALL', toolCallId, name, args: argsText });
      try {
        const result = await this.options.paypal.callReadOnly(name, (args && typeof args === 'object' ? args : {}) as Record<string, unknown>);
        const text = JSON.stringify(result);
        this.record(thread.id, { kind: 'PAYPAL_TOOL_RESULT', toolCallId, name, result: truncate(text) });
        return truncate(text, MAX_RESULT_CHARS);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.record(thread.id, { kind: 'PAYPAL_TOOL_ERROR', toolCallId, name, error: message });
        return JSON.stringify({ error: message });
      }
    }
    if (!isAllowedStudioTool(name) || !thread.declared.includes(name)) {
      this.record(thread.id, { kind: 'TOOL_REJECTED', toolCallId, name, args: argsText });
      return JSON.stringify({ error: `Tool ${name} is not available to the Money Desk agent. It can only build read-only dashboard widgets; money-moving actions go through the confirmed Tillwise voice flow.` });
    }
    this.record(thread.id, { kind: 'STUDIO_TOOL_PARKED', toolCallId, name, args: argsText });
    return new Promise<string>((resolve, reject) => {
      thread.parked.set(toolCallId, { toolCallId, name, args, resolve, reject, emitted: false });
      this.push(thread, { type: 'tool', toolCallId });
    });
  }

  private async createThread(request: StudioRoundRequest): Promise<Thread> {
    const studioTools = (request.tools || []).filter((tool) => tool && typeof tool.name === 'string');
    const dropped = studioTools.filter((tool) => !isAllowedStudioTool(tool.name)).map((tool) => tool.name);
    const declarations: BridgeToolDecl[] = studioTools.filter((tool) => isAllowedStudioTool(tool.name)).map((tool) => ({ name: tool.name, description: tool.description || tool.name, parameters: relaxStudioSchema(tool.parameters) }));
    const paypalTools = await this.options.paypal.listReadOnlyTools();
    for (const tool of paypalTools) declarations.push({ name: tool.name, description: `[read-only PayPal] ${tool.description || tool.name}`, parameters: (tool.inputSchema as Record<string, unknown>) || { type: 'object', properties: {} } });
    const model = this.model;
    const thread: Thread = { id: request.threadId, session: null as unknown as BridgeSession, model, declared: declarations.map((d) => d.name), createdAt: this.now(), lastUsed: this.now(), parked: new Map(), queue: [], wake: null, turnActive: false, streamedMessageIds: new Set(), usageCalls: 0, log: [] };
    this.record(thread.id, { kind: 'SESSION_CREATE', model, declaredTools: thread.declared, droppedStudioTools: dropped });
    thread.session = await this.options.createSession({
      threadId: thread.id,
      model,
      systemMessage: STUDIO_AGENT_SYSTEM_MESSAGE,
      tools: declarations,
      invoke: (name, args, toolCallId) => this.invoke(thread, name, args, toolCallId),
      onEvent: (event) => {
        if (event.type === 'usage') { thread.usageCalls += 1; if (event.model) thread.usageModel = event.model; this.record(thread.id, { kind: 'MODEL_CALL', n: thread.usageCalls, model: event.model }); }
        this.push(thread, event);
      },
    });
    this.threads.set(thread.id, thread);
    return thread;
  }

  async *runRound(request: StudioRoundRequest, signal?: AbortSignal): AsyncGenerator<StudioEvent> {
    try {
      await this.sweep();
      if (!request || typeof request.threadId !== 'string' || !Array.isArray(request.messages)) throw new Error('Bad round request: threadId and messages are required.');
      const fresh = !this.threads.has(request.threadId);
      const thread = this.threads.get(request.threadId) || (await this.createThread(request));
      thread.lastUsed = this.now();
      this.record(thread.id, { kind: 'ROUND_START', runId: request.runId, messages: request.messages.length });

      const results = request.messages.filter((m) => m.role === 'tool' && m.toolCallId && thread.parked.get(m.toolCallId)?.emitted);
      if (results.length) {
        for (const message of results) {
          const parked = thread.parked.get(message.toolCallId!)!;
          thread.parked.delete(parked.toolCallId);
          const content = message.error ? JSON.stringify({ error: message.error, content: textOf(message.content) }) : textOf(message.content);
          this.record(thread.id, { kind: 'STUDIO_TOOL_RESULT', runId: request.runId, toolCallId: parked.toolCallId, name: parked.name, result: truncate(content), error: message.error });
          parked.resolve(truncate(content, MAX_RESULT_CHARS));
        }
      } else {
        if (request.messages.at(-1)?.role === 'tool') throw new Error('This thread\'s agent session expired or was reset while Studio was running a tool. Please send the request again.');
        const user = [...request.messages].reverse().find((m) => m.role === 'user');
        if (!user) throw new Error('No user message in this round.');
        if (thread.turnActive || thread.parked.size) {
          this.record(thread.id, { kind: 'TURN_SUPERSEDED', parked: thread.parked.size });
          this.rejectParked(thread, 'Superseded by a new request');
          await thread.session.abort().catch(() => {});
          thread.queue = [];
          thread.turnActive = false;
        }
        const history = fresh ? request.messages.slice(0, request.messages.lastIndexOf(user)).filter((m) => (m.role === 'user' || m.role === 'assistant') && textOf(m.content)).map((m) => `${m.role}: ${textOf(m.content)}`) : [];
        const prompt = [
          request.instructions ? `Studio context for this request:\n${request.instructions}` : '',
          history.length ? `Earlier in this conversation:\n${truncate(history.join('\n'), 4000)}` : '',
          `Owner request: ${textOf(user.content)}`,
        ].filter(Boolean).join('\n\n');
        thread.lastUserMessageId = user.id;
        thread.turnActive = true;
        this.record(thread.id, { kind: 'USER_PROMPT', runId: request.runId, prompt: textOf(user.content), instructionsChars: (request.instructions || '').length });
        thread.session.send(prompt).catch((error) => this.push(thread, { type: 'error', message: error instanceof Error ? error.message : String(error) }));
      }
      yield* this.pump(thread, request.runId, signal);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (request?.threadId) this.record(request.threadId, { kind: 'RUN_ERROR', runId: request?.runId, message });
      yield { type: 'RUN_ERROR', message };
    }
  }

  private async *pump(thread: Thread, runId: string, signal?: AbortSignal): AsyncGenerator<StudioEvent> {
    let openText: string | null = null;
    let emittedTools = 0;
    let text = '';
    const closeText = function* (): Generator<StudioEvent> { if (openText) { yield { type: 'TEXT_MESSAGE_END', messageId: openText }; openText = null; } };
    const say = function* (messageId: string, delta: string): Generator<StudioEvent> {
      const id = `cp-${messageId}`;
      if (openText !== id) { yield* closeText(); yield { type: 'TEXT_MESSAGE_START', messageId: id, role: 'assistant' }; openText = id; }
      text += delta;
      yield { type: 'TEXT_MESSAGE_CONTENT', messageId: id, delta };
    };
    for (;;) {
      const event = await this.next(thread, emittedTools ? this.quietMs : this.turnTimeoutMs, signal);
      thread.lastUsed = this.now();
      if (event === 'aborted') {
        this.record(thread.id, { kind: 'RUN_CANCELLED', runId });
        this.rejectParked(thread, 'Cancelled by the user');
        thread.queue = [];
        thread.turnActive = false;
        await thread.session.abort().catch(() => {});
        return;
      }
      if (event === 'timeout') {
        yield* closeText();
        if (emittedTools) { this.record(thread.id, { kind: 'ROUND_END', runId, reason: 'awaiting_studio_tool_results', toolCalls: emittedTools, text: truncate(text) }); return; }
        this.record(thread.id, { kind: 'RUN_ERROR', runId, message: 'Copilot SDK turn timed out' });
        this.rejectParked(thread, 'Timed out');
        thread.turnActive = false;
        await thread.session.abort().catch(() => {});
        yield { type: 'RUN_ERROR', message: 'The Copilot SDK turn timed out.' };
        return;
      }
      switch (event.type) {
        case 'text_delta':
          thread.streamedMessageIds.add(event.messageId);
          yield* say(event.messageId, event.delta);
          break;
        case 'message':
          if (!thread.streamedMessageIds.has(event.messageId) && event.content) yield* say(event.messageId, event.content);
          break;
        case 'tool': {
          const parked = thread.parked.get(event.toolCallId);
          if (!parked || parked.emitted) break;
          yield* closeText();
          parked.emitted = true;
          emittedTools += 1;
          this.record(thread.id, { kind: 'TOOL_CALL_EMITTED', runId, toolCallId: parked.toolCallId, name: parked.name, args: truncate(JSON.stringify(parked.args ?? {}), 4000) });
          yield { type: 'TOOL_CALL_START', toolCallId: parked.toolCallId, toolCallName: parked.name };
          yield { type: 'TOOL_CALL_ARGS', toolCallId: parked.toolCallId, delta: JSON.stringify(parked.args ?? {}) };
          yield { type: 'TOOL_CALL_END', toolCallId: parked.toolCallId };
          break;
        }
        case 'usage':
          break;
        case 'idle':
          if (emittedTools) break;
          yield* closeText();
          thread.turnActive = false;
          this.record(thread.id, { kind: 'ROUND_END', runId, reason: 'turn_complete', text: truncate(text, 4000) });
          return;
        case 'error':
          yield* closeText();
          thread.turnActive = false;
          this.rejectParked(thread, event.message);
          this.record(thread.id, { kind: 'RUN_ERROR', runId, message: event.message });
          yield { type: 'RUN_ERROR', message: event.message };
          return;
      }
    }
  }
}

/** Real SessionFactory: a GitHub Copilot SDK session with only our custom tools (no built-ins, no MCP servers). */
export function createCopilotSessionFactory(runtime: { createStudioSession(config: Record<string, unknown>): Promise<unknown>; explainError?(message: string): string }): SessionFactory {
  // BYOK: provider failures (e.g. HTTP 401 for a bad key) become an actionable RUN_ERROR message in the Studio panel.
  const explain = (message: string) => (runtime.explainError ? runtime.explainError(message) : message);
  const explained = (error: unknown) => new Error(explain(error instanceof Error ? error.message : String(error)));
  return async ({ model, systemMessage, tools, invoke, onEvent }) => {
    const sdk = await import('@github/copilot-sdk');
    const toolSet = new sdk.ToolSet();
    for (const tool of tools) toolSet.addCustom(tool.name);
    const session = (await runtime.createStudioSession({
      clientName: 'tillwise-money-desk-studio-agent',
      model,
      availableTools: toolSet,
      tools: tools.map((tool) => sdk.defineTool(tool.name, {
        description: tool.description,
        parameters: tool.parameters,
        skipPermission: true,
        handler: (args: unknown, invocation: { toolCallId: string; toolName: string }) => invoke(invocation.toolName || tool.name, args, invocation.toolCallId || randomUUID()),
      })),
      systemMessage: { mode: 'replace', content: systemMessage },
      streaming: true,
      onPermissionRequest: async () => ({ kind: 'reject', feedback: 'The Money Desk agent has no permission-gated tools.' }),
    }).catch((error) => { throw explained(error); })) as { on(handler: (event: { type: string; data?: Record<string, unknown> }) => void): () => void; send(options: { prompt: string }): Promise<string>; abort(): Promise<void>; disconnect(): Promise<void> };
    session.on((event) => {
      const data = event.data || {};
      if (event.type === 'assistant.message_delta' && typeof data.deltaContent === 'string') onEvent({ type: 'text_delta', messageId: String(data.messageId || 'msg'), delta: data.deltaContent });
      else if (event.type === 'assistant.message') onEvent({ type: 'message', messageId: String(data.messageId || 'msg'), content: typeof data.content === 'string' ? data.content : '' });
      else if (event.type === 'assistant.usage') onEvent({ type: 'usage', model: typeof data.model === 'string' ? data.model : undefined });
      else if (event.type === 'session.idle') onEvent({ type: 'idle' });
      else if (event.type === 'session.error') onEvent({ type: 'error', message: explain(String(data.message || 'Copilot SDK session error')) });
    });
    return { send: (prompt) => session.send({ prompt }).catch((error) => { throw explained(error); }), abort: () => session.abort(), disconnect: () => session.disconnect() };
  };
}

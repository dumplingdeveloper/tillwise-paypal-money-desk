import test from 'node:test';
import assert from 'node:assert/strict';
import { StudioBridge, relaxStudioSchema, isAllowedStudioTool, type BridgeSessionEvent, type InvokeTool, type BridgeToolDecl, type StudioEvent, type StudioRoundRequest } from '../src/studioBridge.js';
import type { PayPalReadClient } from '../src/paypalMcp.js';

// Offline tests: the Copilot SDK session is replaced by a scripted fake. Nothing here talks to a model.

type Script = (ctx: { prompt: string; invoke: InvokeTool; emit: (event: BridgeSessionEvent) => void; aborted: () => boolean }) => Promise<void>;

function fakeFactory(script: Script) {
  const state = { created: 0, tools: [] as BridgeToolDecl[], aborts: 0, disconnects: 0, prompts: [] as string[], invoke: null as InvokeTool | null, emit: null as ((e: BridgeSessionEvent) => void) | null };
  const factory = async (options: { tools: BridgeToolDecl[]; invoke: InvokeTool; onEvent: (e: BridgeSessionEvent) => void }) => {
    state.created += 1;
    state.tools = options.tools;
    state.invoke = options.invoke;
    state.emit = options.onEvent;
    let aborted = false;
    return {
      send: async (prompt: string) => {
        state.prompts.push(prompt);
        aborted = false;
        void script({ prompt, invoke: options.invoke, emit: options.onEvent, aborted: () => aborted }).catch((error) => options.onEvent({ type: 'error', message: String(error?.message || error) }));
        return 'm1';
      },
      abort: async () => { aborted = true; state.aborts += 1; },
      disconnect: async () => { state.disconnects += 1; },
    };
  };
  return { factory, state };
}

function fakePayPal() {
  const calls: Array<{ name: string; args: unknown }> = [];
  const client: PayPalReadClient = {
    async listReadOnlyTools() { return [{ name: 'paypal_money_briefing', description: 'Read-only briefing', inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: true } }]; },
    async callReadOnly(name, args) { calls.push({ name, args }); return { speech: 'ok', data: { audit: [] } }; },
    async close() {},
  };
  return { client, calls };
}

const STUDIO_TOOLS = [
  { name: 'add_widget', description: 'Add a widget', parameters: { type: 'object', properties: { widgetId: { type: 'string' }, type: { type: 'string' } } } },
  { name: 'configure_grid', description: 'Configure grid', parameters: { type: 'object', properties: { widgetId: { type: 'string', enum: ['a'] }, op: { type: 'string' }, value: { type: 'object' } } } },
  { name: 'remove_widget', description: 'Remove a widget', parameters: { type: 'object', properties: {} } },
  { name: 'paypal_refund_apply', description: 'Smuggled money tool', parameters: { type: 'object', properties: {} } },
];

const round = (threadId: string, runId: string, messages: StudioRoundRequest['messages']): StudioRoundRequest => ({ threadId, runId, messages, tools: STUDIO_TOOLS, instructions: 'Tables: invoices.customer, invoices.amount_due' });

async function collect(iterable: AsyncIterable<StudioEvent>) {
  const events: StudioEvent[] = [];
  for await (const event of iterable) events.push(event);
  return events;
}

const tick = (ms = 5) => new Promise((resolve) => setTimeout(resolve, ms));

test('a Studio tool call ends the round and parks; the next round resolves it and the model continues to text', async () => {
  let resolvedWith: string | undefined;
  const { factory, state } = fakeFactory(async ({ invoke, emit }) => {
    emit({ type: 'usage', model: 'fake-model' });
    emit({ type: 'text_delta', messageId: 'a1', delta: 'Adding a table.' });
    resolvedWith = await invoke('add_widget', { widgetId: 'owed', type: 'grid' }, 'call-1');
    emit({ type: 'usage', model: 'fake-model' });
    emit({ type: 'text_delta', messageId: 'a2', delta: 'Built it.' });
    emit({ type: 'message', messageId: 'a2', content: 'Built it.' });
    emit({ type: 'idle' });
  });
  const paypal = fakePayPal();
  const bridge = new StudioBridge({ createSession: factory, paypal: paypal.client, quietMs: 30 });

  const first = await collect(bridge.runRound(round('t1', 'r1', [{ id: 'u1', role: 'user', content: 'Who still owes us money? Make it a table' }])));
  assert.deepEqual(first.map((e) => e.type), ['TEXT_MESSAGE_START', 'TEXT_MESSAGE_CONTENT', 'TEXT_MESSAGE_END', 'TOOL_CALL_START', 'TOOL_CALL_ARGS', 'TOOL_CALL_END']);
  const start = first[3] as Extract<StudioEvent, { type: 'TOOL_CALL_START' }>;
  assert.equal(start.toolCallId, 'call-1');
  assert.equal(start.toolCallName, 'add_widget');
  assert.deepEqual(JSON.parse((first[4] as Extract<StudioEvent, { type: 'TOOL_CALL_ARGS' }>).delta), { widgetId: 'owed', type: 'grid' });
  assert.equal(resolvedWith, undefined, 'the SDK tool handler is still parked');
  assert.equal(bridge.summary().threads[0].parked, 1);
  assert.match(state.prompts[0], /Owner request: Who still owes us money\? Make it a table/);
  assert.match(state.prompts[0], /invoices\.amount_due/);

  const second = await collect(bridge.runRound(round('t1', 'r1', [
    { id: 'u1', role: 'user', content: 'Who still owes us money? Make it a table' },
    { id: 'tool-1', role: 'tool', toolCallId: 'call-1', content: '{"response":"Added widget owed"}' },
  ])));
  assert.equal(resolvedWith, '{"response":"Added widget owed"}');
  assert.deepEqual(second.map((e) => e.type), ['TEXT_MESSAGE_START', 'TEXT_MESSAGE_CONTENT', 'TEXT_MESSAGE_END']);
  assert.equal((second[1] as Extract<StudioEvent, { type: 'TEXT_MESSAGE_CONTENT' }>).delta, 'Built it.');
  assert.equal(state.created, 1, 'one SDK session per thread');
  const log = bridge.threadLog('t1');
  assert.equal(log.modelCalls, 2);
  assert.deepEqual(log.events.map((e) => e.kind).filter((k) => k.startsWith('STUDIO_TOOL') || k === 'TOOL_CALL_EMITTED'), ['STUDIO_TOOL_PARKED', 'TOOL_CALL_EMITTED', 'STUDIO_TOOL_RESULT']);
});

test('only allowlisted Studio tools and read-only PayPal tools are declared to the SDK session', async () => {
  const { factory, state } = fakeFactory(async ({ emit }) => { emit({ type: 'idle' }); });
  const bridge = new StudioBridge({ createSession: factory, paypal: fakePayPal().client });
  await collect(bridge.runRound(round('t2', 'r1', [{ id: 'u1', role: 'user', content: 'hi' }])));
  assert.deepEqual(state.tools.map((t) => t.name).sort(), ['add_widget', 'configure_grid', 'paypal_money_briefing']);
  const configure = state.tools.find((t) => t.name === 'configure_grid')!;
  assert.equal((configure.parameters as { properties: { widgetId: { enum?: unknown } } }).properties.widgetId.enum, undefined, 'widgetId enum is relaxed');
  assert.deepEqual(bridge.threadLog('t2').events[0].droppedStudioTools, ['remove_widget', 'paypal_refund_apply']);
  assert.equal(isAllowedStudioTool('paypal_refund_apply'), false);
  assert.equal(isAllowedStudioTool('configure_value'), true);
  assert.equal(isAllowedStudioTool('configure_pie_chart'), false);
});

test('the bridge rejects a forbidden tool even if the model asks for it', async () => {
  let reply = '';
  const { factory } = fakeFactory(async ({ invoke, emit }) => {
    reply = await invoke('paypal_refund_apply', { order_id: 136 }, 'evil-1');
    const second = await invoke('remove_widget', { widgetId: 'kpi-gross' }, 'evil-2');
    emit({ type: 'text_delta', messageId: 'a1', delta: `I can't do that. ${second.length}` });
    emit({ type: 'idle' });
  });
  const paypal = fakePayPal();
  const bridge = new StudioBridge({ createSession: factory, paypal: paypal.client, quietMs: 30 });
  const events = await collect(bridge.runRound(round('t3', 'r1', [{ id: 'u1', role: 'user', content: 'Refund order 136' }])));
  assert.equal(events.some((e) => e.type.startsWith('TOOL_CALL')), false, 'nothing forwarded to Studio');
  assert.equal(paypal.calls.length, 0, 'nothing forwarded to MCP');
  assert.match(reply, /not available to the Money Desk agent/);
  assert.match(reply, /voice flow/);
  const rejected = bridge.threadLog('t3').events.filter((e) => e.kind === 'TOOL_REJECTED').map((e) => e.name);
  assert.deepEqual(rejected, ['paypal_refund_apply', 'remove_widget']);
});

test('read-only PayPal tools run server-side and are never sent to Studio', async () => {
  const { factory } = fakeFactory(async ({ invoke, emit }) => {
    const result = await invoke('paypal_money_briefing', {}, 'pp-1');
    emit({ type: 'text_delta', messageId: 'a1', delta: result });
    emit({ type: 'idle' });
  });
  const paypal = fakePayPal();
  const bridge = new StudioBridge({ createSession: factory, paypal: paypal.client });
  const events = await collect(bridge.runRound(round('t4', 'r1', [{ id: 'u1', role: 'user', content: 'How are we doing?' }])));
  assert.deepEqual(paypal.calls, [{ name: 'paypal_money_briefing', args: {} }]);
  assert.equal(events.some((e) => e.type.startsWith('TOOL_CALL')), false);
  assert.match((events[1] as Extract<StudioEvent, { type: 'TEXT_MESSAGE_CONTENT' }>).delta, /"audit":\[\]/);
});

test('cancellation aborts the SDK turn, rejects parked calls and ends the stream', async () => {
  let parkedOutcome = '';
  const { factory, state } = fakeFactory(async ({ invoke, emit }) => {
    emit({ type: 'text_delta', messageId: 'a1', delta: 'Working' });
    await invoke('add_widget', { widgetId: 'x', type: 'grid' }, 'call-c').then(() => { parkedOutcome = 'resolved'; }, (error) => { parkedOutcome = `rejected: ${error.message}`; });
  });
  const bridge = new StudioBridge({ createSession: factory, paypal: fakePayPal().client, quietMs: 10_000 });
  const controller = new AbortController();
  const done = collect(bridge.runRound(round('t5', 'r1', [{ id: 'u1', role: 'user', content: 'slow' }]), controller.signal));
  await tick(30);
  controller.abort();
  const events = await done;
  await tick();
  assert.equal(state.aborts, 1);
  assert.equal(parkedOutcome, 'rejected: Cancelled by the user');
  assert.equal(events.some((e) => e.type === 'RUN_ERROR'), false);
  assert.equal(bridge.summary().threads[0].turnActive, false);
  assert.ok(bridge.threadLog('t5').events.some((e) => e.kind === 'RUN_CANCELLED'));
});

test('failures become RUN_ERROR events instead of throwing', async () => {
  const failing = new StudioBridge({ createSession: async () => { throw new Error('Copilot SDK unavailable'); }, paypal: fakePayPal().client });
  const a = await collect(failing.runRound(round('t6', 'r1', [{ id: 'u1', role: 'user', content: 'x' }])));
  assert.deepEqual(a, [{ type: 'RUN_ERROR', message: 'Copilot SDK unavailable' }]);

  const { factory } = fakeFactory(async ({ emit }) => { emit({ type: 'text_delta', messageId: 'a1', delta: 'Hm' }); emit({ type: 'error', message: 'model overloaded' }); });
  const erroring = new StudioBridge({ createSession: factory, paypal: fakePayPal().client });
  const b = await collect(erroring.runRound(round('t7', 'r1', [{ id: 'u1', role: 'user', content: 'x' }])));
  assert.deepEqual(b.map((e) => e.type), ['TEXT_MESSAGE_START', 'TEXT_MESSAGE_CONTENT', 'TEXT_MESSAGE_END', 'RUN_ERROR']);
  assert.equal((b[3] as { message: string }).message, 'model overloaded');

  const bad = await collect(erroring.runRound({ threadId: 't8' } as unknown as StudioRoundRequest));
  assert.equal(bad[0].type, 'RUN_ERROR');

  const orphan = await collect(erroring.runRound(round('t9', 'r1', [{ id: 'u1', role: 'user', content: 'x' }, { id: 'tr', role: 'tool', toolCallId: 'unknown', content: '{}' }])));
  assert.equal(orphan[0].type, 'RUN_ERROR');
  assert.match((orphan[0] as { message: string }).message, /expired or was reset/);
});

test('idle sessions expire: the SDK session is disconnected and parked calls are rejected', async () => {
  let now = 1_000_000;
  let outcome = '';
  const { factory, state } = fakeFactory(async ({ invoke }) => { await invoke('add_widget', { widgetId: 'x', type: 'grid' }, 'call-e').catch((error) => { outcome = error.message; }); });
  const bridge = new StudioBridge({ createSession: factory, paypal: fakePayPal().client, idleMs: 60_000, quietMs: 10, now: () => now });
  await collect(bridge.runRound(round('t10', 'r1', [{ id: 'u1', role: 'user', content: 'x' }])));
  assert.deepEqual(await bridge.sweep(), []);
  now += 61_000;
  assert.deepEqual(await bridge.sweep(), ['t10']);
  await tick();
  assert.equal(state.disconnects, 1);
  assert.equal(outcome, 'Session expired');
  assert.equal(bridge.summary().threads.length, 0);
  assert.ok(bridge.threadLog('t10').events.some((e) => e.kind === 'SESSION_EXPIRED'));
});

test('relaxStudioSchema only relaxes widget-id enums', () => {
  const relaxed = relaxStudioSchema({ type: 'object', properties: { widgetId: { type: 'string', enum: ['a', 'b'] }, type: { type: 'string', enum: ['grid', 'value'] } } }) as { properties: Record<string, { enum?: string[]; type: string; description?: string }> };
  assert.equal(relaxed.properties.widgetId.enum, undefined);
  assert.equal(relaxed.properties.widgetId.type, 'string');
  assert.deepEqual(relaxed.properties.type.enum, ['grid', 'value']);
});

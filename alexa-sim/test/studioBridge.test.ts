import test from 'node:test';
import assert from 'node:assert/strict';
import { runBridgeRound } from '../src/studioBridge.js';

async function collect(iter: AsyncIterable<unknown>) { const out = []; for await (const event of iter) out.push(event); return out as Array<Record<string, unknown>>; }

test('studio bridge emits a tool call round', async () => {
  const events = await collect(runBridgeRound({ messages: [], prompt: 'add grid' }, async () => ({ tool: { name: 'add_widget', args: { widgetId: 'w1', type: 'grid' } } })));
  assert.deepEqual(events.map((e) => e.type), ['TOOL_CALL_START', 'TOOL_CALL_ARGS', 'TOOL_CALL_END']);
  assert.equal(events[0].toolCallName, 'add_widget');
});

test('studio bridge resolves tool-result round into text', async () => {
  const events = await collect(runBridgeRound({ messages: [{ role: 'tool', content: 'widget added' }] }, async () => ({ text: 'unused' })));
  assert.equal(events[0].type, 'TEXT_MESSAGE_START');
  assert.equal(events.at(-1)?.type, 'TEXT_MESSAGE_END');
  assert.match(String(events[1].delta), /widget added/);
});

test('studio bridge emits RUN_ERROR on cancellation and planner failure', async () => {
  const aborted = new AbortController(); aborted.abort();
  let events = await collect(runBridgeRound({ messages: [], prompt: 'x' }, async () => ({ text: 'x' }), aborted.signal));
  assert.equal(events[0].type, 'RUN_ERROR');
  events = await collect(runBridgeRound({ messages: [], prompt: 'x' }, async () => { throw new Error('planner failed'); }));
  assert.equal(events[0].type, 'RUN_ERROR');
  assert.match(String(events[0].message), /planner failed/);
});

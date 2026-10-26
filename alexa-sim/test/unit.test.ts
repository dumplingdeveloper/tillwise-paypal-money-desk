import test from 'node:test';
import assert from 'node:assert/strict';
import { AUTO_APPROVED_TOOLS, ConfirmationBroker, classifyConfirmationReply, createPermissionHandler, decidePermission } from '../src/permissionGate.js';
import { BUILTIN_ALLOWLIST, MCP_ALLOWLIST, MCP_TOOLS, TOOL_ALLOWLIST, buildToolSet } from '../src/config.js';
import { mapSessionEvent, sanitizePlainText } from '../src/eventMapper.js';
import { cardFromStructured } from '../src/cards.js';
import { assertAllowedLogin } from '../src/env.js';
import { checkHostOrigin, isJsonContentType } from '../src/server.js';
import { buildSessionConfig, confirmationQuestion, finalFromSendResult, upcomingWeekdayDates } from '../src/copilotAgent.js';

function mcp(toolName: string) {
  return { kind: 'mcp', serverName: 'tillwise', toolName, args: {}, readOnly: AUTO_APPROVED_TOOLS.has(toolName), toolTitle: toolName } as never;
}

test('permission gate auto-approves reads and preview, gates mutations, denies everything else', async () => {
  assert.deepEqual(decidePermission(mcp('store_briefing')), { kind: 'approve-once' });
  assert.deepEqual(decidePermission(mcp('price_change_preview')), { kind: 'approve-once' });
  assert.deepEqual(decidePermission(mcp('paypal_money_briefing')), { kind: 'approve-once' });
  assert.deepEqual(decidePermission(mcp('paypal_refund_preview')), { kind: 'approve-once' });
  assert.deepEqual(decidePermission(mcp('paypal_dispute_accept_claim_preview')), { kind: 'approve-once' });
  assert.equal(decidePermission(mcp('price_change_apply')).kind, 'reject');
  assert.equal(decidePermission(mcp('paypal_refund_apply')).kind, 'reject');
  assert.equal(decidePermission(mcp('paypal_dispute_accept_claim_apply')).kind, 'reject');
  assert.equal(decidePermission({ kind: 'shell' } as never).kind, 'reject');
  const broker = new ConfirmationBroker(undefined, 5000);
  const handler = createPermissionHandler(broker);
  const promise = handler(mcp('price_change_apply'), { sessionId: 's' });
  const [pending] = broker.list();
  assert.equal(pending.toolName, 'price_change_apply');
  broker.decide(pending.id, true);
  assert.deepEqual(await promise, { kind: 'approve-once', approvedInteractively: true });
});

test('tool allow-list contains exactly Tillwise MCP tools plus the isolated skill built-in', () => {
  assert.deepEqual(MCP_ALLOWLIST, MCP_TOOLS.map((tool) => `mcp:tillwise-${tool}`));
  assert.ok(MCP_ALLOWLIST.includes('mcp:tillwise-paypal_money_briefing'));
  assert.ok(MCP_ALLOWLIST.includes('mcp:tillwise-paypal_refund_apply'));
  assert.deepEqual(BUILTIN_ALLOWLIST, ['builtin:skill']);
  assert.deepEqual(buildToolSet().toArray(), TOOL_ALLOWLIST);
  assert.deepEqual(decidePermission({ kind: 'tool', toolName: 'skill', args: { skill: 'woocommerce-daily-briefing' } } as never), { kind: 'approve-once' });
  assert.equal(decidePermission({ kind: 'tool', toolName: 'skill', args: { skill: 'other-skill' } } as never).kind, 'reject');
});

test('Copilot session config pins empty-mode safety defaults in copilot-cli mode', () => {
  const config = buildSessionConfig({
    headers: {},
    storeContext: 'Today is Tuesday 2026-09-29, store timezone Europe/Dublin.',
    broker: new ConfirmationBroker(),
    toolState: { calls: new Map(), previews: new Map() },
  });
  assert.equal(config.enableSessionTelemetry, false);
  assert.equal(config.mcpOAuthTokenStorage, 'in-memory');
  assert.equal(config.skipEmbeddingRetrieval, true);
  assert.equal(config.embeddingCacheStorage, 'in-memory');
  assert.equal(config.enableOnDemandInstructionDiscovery, false);
  assert.equal(config.enableFileHooks, false);
  assert.equal(config.enableHostGitOperations, false);
  assert.equal(config.enableSessionStore, false);
  assert.equal(config.coauthorEnabled, false);
  assert.equal(config.manageScheduleEnabled, false);
  assert.deepEqual(config.memory, { enabled: false });
  assert.equal(config.customAgentsLocalOnly, true);
  assert.deepEqual(config.includedBuiltinSkills, []);
  assert.equal(config.skipCustomInstructions, true);
  assert.equal(config.enableConfigDiscovery, false);
  assert.equal(config.enableSkills, true);
  const systemMessage = config.systemMessage as { mode?: string; content?: string; sections?: { environment_context?: { action?: string } } };
  assert.equal(systemMessage.mode, 'customize');
  assert.equal(systemMessage.sections?.environment_context?.action, 'remove');
  assert.match(systemMessage.content || '', /Plain text only/);
  assert.match(systemMessage.content || '', /Today is Tuesday/);
  const availableTools = Array.isArray(config.availableTools) ? config.availableTools : config.availableTools?.toArray();
  assert.deepEqual(availableTools, TOOL_ALLOWLIST);
});

test('event mapper maps assistant deltas and MCP tool results', () => {
  assert.deepEqual(mapSessionEvent({ type: 'assistant.message_delta', data: { deltaContent: 'Hi' } } as never), { type: 'assistant_delta', data: { text: 'Hi' } });
  assert.deepEqual(mapSessionEvent({ type: 'tool.execution_start', data: { toolCallId: '1', toolName: 'tillwise-store_briefing', mcpToolName: 'store_briefing', arguments: { a: 1 } } } as never), { type: 'tool_start', data: { id: '1', name: 'store_briefing', arguments: { a: 1 } } });
});

test('assistant tool preambles become interim and one final is taken from last non-tool message', () => {
  const interim = mapSessionEvent({ type: 'assistant.message', data: { content: "I'll check that now.", toolRequests: [{ id: 't1' }] } } as never);
  assert.deepEqual(interim, { type: 'interim', data: { text: "I'll check that now." } });
  const toolStart = mapSessionEvent({ type: 'tool.execution_start', data: { toolCallId: 't1', toolName: 'tillwise-store_briefing', mcpToolName: 'store_briefing', arguments: {} } } as never);
  const toolEnd = mapSessionEvent({ type: 'tool.execution_complete', data: { toolCallId: 't1', success: true, result: { structuredContent: { data: {} } } } } as never);
  assert.equal(toolStart?.type, 'tool_start');
  assert.equal(toolEnd?.type, 'tool_end');
  assert.equal(mapSessionEvent({ type: 'assistant.message', data: { content: 'Today sales are €210 across 8 orders.' } } as never), null);
  assert.deepEqual(finalFromSendResult({ lastAssistantMessage: { content: 'Today sales are €210 across 8 orders.' } }), { text: 'Today sales are €210 across 8 orders.', empty: false });
  assert.deepEqual(finalFromSendResult({ lastAssistantMessage: { content: '', toolRequests: [] } }), { text: '', empty: true });
});

test('upcoming weekday dates map today to next week including Sunday', () => {
  const dates = upcomingWeekdayDates(new Date('2026-10-11T12:00:00+01:00'));
  assert.equal(dates.sunday, '2026-10-18');
  assert.equal(dates.monday, '2026-10-12');
});

test('card renderers classify structured MCP results', () => {
  assert.equal(cardFromStructured({ data: { today: { total: 10 }, same_weekday_last_week: { total: 8 }, waiting_orders: 2, low_stock: { count: 3 }, sales_ending_soon: [] } })?.type, 'briefing');
  const preview = cardFromStructured({ data: { preview_id: 'p1', count: 5, range: {}, expires_at: 'soon', guardrails: {}, skipped: [], changes: [{ name: 'Mug', old: 10, new: 8.5, field: 'regular' }] } });
  assert.equal(preview?.type, 'price-preview');
  assert.equal(preview?.rows?.[0].product, 'Mug');
  assert.equal(cardFromStructured({ data: { applied_count: 1, conflicts: [] } })?.type, 'applied');
  assert.equal(cardFromStructured({ data: { restored_count: 1, conflicts: [] } })?.type, 'undo');
  assert.equal(cardFromStructured({ data: { guardrails: { min_price: 1 } } })?.type, 'guardrails');
});


test('permission gate timeout denies pending mutations', async () => {
  const broker = new ConfirmationBroker(undefined, 10);
  const handler = createPermissionHandler(broker);
  const result = await handler(mcp('price_change_apply'), { sessionId: 's' });
  assert.equal(result.kind, 'reject');
});

test('login gate requires expected login unless explicitly allowed', () => {
  const oldExpected = process.env.EXPECTED_GITHUB_LOGIN;
  const oldAllow = process.env.ALLOW_ANY_GITHUB_LOGIN;
  try {
    process.env.EXPECTED_GITHUB_LOGIN = 'yuxinshiu63';
    delete process.env.ALLOW_ANY_GITHUB_LOGIN;
    assert.equal(assertAllowedLogin('yuxinshiu63'), 'yuxinshiu63');
    assert.throws(() => assertAllowedLogin('someone-else'), /expected yuxinshiu63/);
    process.env.ALLOW_ANY_GITHUB_LOGIN = '1';
    assert.equal(assertAllowedLogin('judge'), 'judge');
  } finally {
    if (oldExpected === undefined) delete process.env.EXPECTED_GITHUB_LOGIN; else process.env.EXPECTED_GITHUB_LOGIN = oldExpected;
    if (oldAllow === undefined) delete process.env.ALLOW_ANY_GITHUB_LOGIN; else process.env.ALLOW_ANY_GITHUB_LOGIN = oldAllow;
  }
});

test('simulator Host Origin and JSON content-type checks', () => {
  assert.equal(checkHostOrigin({ headers: { host: '127.0.0.1:4179' } }, '127.0.0.1', 4179), true);
  assert.equal(checkHostOrigin({ headers: { host: 'evil.test:4179' } }, '127.0.0.1', 4179), false);
  assert.equal(checkHostOrigin({ headers: { host: '127.0.0.1:4179', origin: 'http://127.0.0.1:4179' } }, '127.0.0.1', 4179), true);
  assert.equal(checkHostOrigin({ headers: { host: '127.0.0.1:4179', origin: 'http://evil.test' } }, '127.0.0.1', 4179), false);
  assert.equal(isJsonContentType('application/json; charset=utf-8'), true);
  assert.equal(isJsonContentType('text/plain'), false);
});

test('final text sanitizer removes markdown for display and speech', () => {
  assert.equal(sanitizePlainText('## **€208**\n- `30 orders`'), '€208\n30 orders');
  assert.equal(sanitizePlainText('**Done** - no `ids`'), 'Done - no ids');
});

test('confirmation grammar accepts natural yes no variants', () => {
  for (const text of ['yes please', 'yeah go ahead', 'sure', 'ok', 'do it']) assert.equal(classifyConfirmationReply(text), 'yes');
  for (const text of ['no thanks', "don't", 'cancel']) assert.equal(classifyConfirmationReply(text), 'no');
  assert.equal(classifyConfirmationReply('maybe later'), 'unknown');
});

test('history applied and undo cards hide raw ids and format rows', () => {
  const history = cardFromStructured({ data: { timezone: 'Europe/Dublin', currency: 'EUR', items: [{ id: 'h0032249c3cbe421e', created_at: 1790698138, changes: [{ name: 'Ceramic Sunrise Mug', field: 'sale', new: 12.67, sale_end_date: '2026-10-04' }] }] } });
  assert.equal(history?.type, 'history');
  assert.equal(JSON.stringify(history).includes('h0032249c3cbe421e'), false);
  assert.equal(JSON.stringify(history).includes('1790698138'), false);
  const applied = cardFromStructured({ data: { applied_count: 1, timezone: 'Europe/Dublin', applied: [{ name: 'Mug', field: 'sale', old: 14.9, new: 12.67, sale_end_date: '2026-10-04' }], conflicts: [] } });
  assert.equal(applied?.rows?.[0].product, 'Mug');
  const undo = cardFromStructured({ data: { restored_count: 1, restored: [{ name: 'Mug', was: 12.67, restored: 14.9 }], conflicts: [] } });
  assert.equal(undo?.rows?.[0].restored, '€14.90');
});

test('applied and undo cards use regular price when sale price was empty', () => {
  const applied = cardFromStructured({ data: { applied_count: 1, timezone: 'Europe/Dublin', applied: [{ name: 'Mug', field: 'sale', old: null, regular: 14.9, new: 12.67, sale_end_date: '2026-10-04' }], conflicts: [] } });
  assert.equal(applied?.rows?.[0].was, '€14.90');
  const undo = cardFromStructured({ data: { restored_count: 1, restored: [{ name: 'Mug', was: 12.67, regular: 14.9, restored: null, restored_sale_end_timestamp: null }], conflicts: [] } });
  assert.equal(undo?.rows?.[0].restored, '€14.90');
  assert.equal(undo?.rows?.[0].until, 'no sale');
  assert.equal(JSON.stringify(undo).includes('€0.00'), false);
});

test('guardrail preview card groups skipped rows', () => {
  const card = cardFromStructured({ data: { preview_id: 'p1', count: 0, expires_at: '2026-09-29T18:12:43Z', guardrails: { min_price: 1, max_discount_percent: 50 }, changes: [], skipped: [
    { name: 'Cedar Amber Candle', reason: 'max_discount_exceeded', max_discount_percent: 50 },
    { name: 'Citrus Grove Candle', reason: 'max_discount_exceeded', max_discount_percent: 50 },
    { name: 'Lavender Night Candle', reason: 'max_discount_exceeded', max_discount_percent: 50 },
    { name: 'Vanilla Bean Candle', reason: 'max_discount_exceeded', max_discount_percent: 50 },
    { name: 'Winter Pine Candle', reason: 'max_discount_exceeded', max_discount_percent: 50 },
  ] } });
  assert.equal(card?.summary, 'No changes: 5 skipped by guardrails');
  assert.equal(card?.sections?.some((s) => s.title === 'Skipped' && s.value === '5 × over the 50% max discount'), true);
  assert.equal(card?.rows?.[0].product, 'Cedar Amber Candle');
  assert.equal(card?.rows?.[0].reason, 'over the 50% max discount');
});

test('low-stock card shows up to 10 rows and then a more row', () => {
  const items = Array.from({ length: 12 }, (_, i) => ({ name: `Item ${i + 1}`, stock_quantity: i, threshold: 3 }));
  const card = cardFromStructured({ data: { count: 12, items } });
  assert.equal(card?.rows?.length, 11);
  assert.equal(card?.rows?.[9].product, 'Item 10');
  assert.equal(card?.rows?.[10].product, '+2 more');
});

test('the host asks a plain-language question for each human-gated PayPal tool', () => {
  const previews = new Map<string, Record<string, unknown>>([
    ['p-refund', { data: { preview_id: 'p-refund', order_id: 360, amount: '31.00', currency: 'EUR' } }],
    ['p-invoice', { data: { preview_id: 'p-invoice', total: '220.00', currency: 'EUR', recipient_email: 'billing@corkoffice.example.test' } }],
    ['p-dispute', { data: { preview_id: 'p-dispute', dispute_id: 'PP-D-MOCK-1', amount: '18.00', currency: 'EUR' } }],
  ]);
  const ask = (tool: string, args: Record<string, unknown>) => confirmationQuestion(tool, args, previews)?.question;
  assert.equal(ask('paypal_refund_apply', { preview_id: 'p-refund' }), 'Refund €31.00 for order 360 through PayPal?');
  assert.equal(ask('paypal_invoice_create_apply', { preview_id: 'p-invoice' }), 'Create a PayPal invoice draft for €220.00 to billing@corkoffice.example.test?');
  assert.equal(ask('paypal_invoice_send_apply', { invoice_id: 'INV2-MOCK-1' }), 'Send PayPal invoice INV2-MOCK-1 to its recipient?');
  assert.equal(ask('paypal_tracking_add_apply', { order_id: 360, carrier: 'AN_POST', tracking_number: 'CE123' }), 'Add AN_POST tracking CE123 to order 360 in PayPal?');
  assert.equal(ask('paypal_dispute_accept_claim_apply', { preview_id: 'p-dispute' }), 'Accept PayPal dispute PP-D-MOCK-1 and let PayPal refund €18.00 to the buyer?');
  // Without a matching preview the question still names no tool id and invents no amount.
  assert.equal(ask('paypal_refund_apply', { preview_id: 'unknown' }), 'Apply the previewed PayPal refund?');
  for (const tool of ['paypal_refund_apply', 'paypal_invoice_create_apply', 'paypal_invoice_send_apply', 'paypal_tracking_add_apply', 'paypal_dispute_accept_claim_apply']) {
    assert.doesNotMatch(String(ask(tool, {})), /_apply|paypal refund apply/);
  }
});

test('the voice sim speaks money as words with the same helper as the video pipeline', async () => {
  const { readFileSync } = await import('node:fs');
  const { resolve } = await import('node:path');
  const { pathToFileURL } = await import('node:url');
  const { PUBLIC_DIR, PROJECT_ROOT } = await import('../src/config.js');
  const browserCopy = resolve(PUBLIC_DIR, 'speakable.js');
  assert.equal(readFileSync(browserCopy, 'utf8'), readFileSync(resolve(PROJECT_ROOT, 'video', 'scripts', 'speakable.js'), 'utf8'), 'alexa-sim/public/speakable.js must stay identical to video/scripts/speakable.js');
  const { speakableText } = await import(pathToFileURL(browserCopy).href) as { speakableText: (t: string) => string };
  assert.equal(speakableText('Refund of EUR 31 for order 360 completed.'), 'Refund of 31 euros for order 360 completed.');
  const app = readFileSync(resolve(PUBLIC_DIR, 'app.js'), 'utf8');
  assert.ok(app.startsWith("import { speakableText } from '/speakable.js';"));
  assert.ok(app.includes('new SpeechSynthesisUtterance(speakableText(text))'), 'browser TTS speaks the speakable form; the transcript keeps the original');
});

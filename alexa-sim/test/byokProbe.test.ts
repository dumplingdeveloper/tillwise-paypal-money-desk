import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { startSimulator } from '../src/server.js';

// BYOK fake-key probe (BYOK_PROBE=1). Starts the real sim with TILLWISE_LLM_PROVIDER and a random, never-valid key, with all
// GitHub tokens removed, and checks that both the voice sim and the Money Desk Studio bridge reach the provider and show its
// HTTP 401 clearly. No Copilot model is called. The key is generated here, never printed and never written to evidence.
const REPO_ROOT = join(process.cwd(), '..');
const EVIDENCE = join(REPO_ROOT, 'docs', 'evidence');

test('BYOK with a bad key: voice sim and Studio bridge both show the provider 401', { timeout: 180_000 }, async (t) => {
  if (process.env.BYOK_PROBE !== '1') { t.skip('Set BYOK_PROBE=1 (needs network + MCP server on 3338) to run the BYOK fake-key probe.'); return; }
  const providerName = process.env.BYOK_PROBE_PROVIDER || 'openai';
  const model = providerName === 'anthropic' ? 'claude-3-5-haiku-latest' : 'gpt-4o-mini';
  const fakeKey = `sk-tillwise-fake-${randomBytes(12).toString('hex')}`;
  for (const name of ['GH_TOKEN', 'GITHUB_TOKEN', 'COPILOT_GITHUB_TOKEN', 'TILLWISE_LLM_BASE_URL']) delete process.env[name];
  Object.assign(process.env, { TILLWISE_LLM_PROVIDER: providerName, TILLWISE_LLM_MODEL: model, TILLWISE_LLM_API_KEY: fakeKey });
  const port = Number(process.env.SIM_PORT || 4191);
  const base = `http://127.0.0.1:${port}`;
  const startedAt = new Date().toISOString();
  const { server, runtime, studioBridge, paypalRead } = await startSimulator('127.0.0.1', port);
  try {
    const status = await (await fetch(`${base}/api/status`)).json() as { login: string; model: string; llm: string };
    const desk = await (await fetch(`${base}/api/money-desk-data`)).json() as { agent: { model: string; llm: string } };

    // Studio bridge: one round from the AI panel's client tool runner.
    const studioStarted = Date.now();
    const response = await fetch(`${base}/api/studio-agent/run`, { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify({ threadId: `byok-${Date.now()}`, runId: 'r1', messages: [{ id: 'u1', role: 'user', content: 'Show PayPal revenue by customer segment this month' }], tools: [] }) });
    const studioEvents = (await response.text()).trim().split('\n').filter(Boolean).map((line) => JSON.parse(line) as { type: string; message?: string });
    const studioMs = Date.now() - studioStarted;

    // Voice sim: create a conversation, listen on its SSE stream, send a prompt, wait for the error event.
    const conv = await (await fetch(`${base}/api/conversations`, { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: '{}' })).json() as { id: string; login: string; model: string; llm: string };
    const abort = new AbortController();
    const sse = await fetch(`${base}/api/conversations/${conv.id}/events`, { signal: abort.signal });
    const voiceStarted = Date.now();
    await fetch(`${base}/api/conversations/${conv.id}/message`, { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify({ prompt: 'Give me the PayPal money briefing' }) });
    const voiceError = await (async () => {
      const reader = sse.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      const deadline = Date.now() + 120_000;
      while (Date.now() < deadline) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        for (const line of buffer.split('\n')) {
          if (!line.startsWith('data:')) continue;
          try { const event = JSON.parse(line.slice(5)) as { type: string; data?: { message?: string } }; if (event.type === 'error') return event.data?.message || ''; } catch { /* partial line */ }
        }
      }
      return null;
    })();
    abort.abort();
    const voiceMs = Date.now() - voiceStarted;

    const studioError = studioEvents.find((e) => e.type === 'RUN_ERROR')?.message || null;
    const evidence = {
      generatedBy: 'alexa-sim/test/byokProbe.test.ts', startedAt, finishedAt: new Date().toISOString(),
      env: { TILLWISE_LLM_PROVIDER: providerName, TILLWISE_LLM_MODEL: model, TILLWISE_LLM_API_KEY: '<random fake key, not recorded>', githubTokensInEnv: false },
      status: { login: status.login, model: status.model, llm: status.llm }, moneyDeskAgent: desk.agent,
      studio: { events: studioEvents, elapsedMs: studioMs }, voice: { conversation: { login: conv.login, model: conv.model, llm: conv.llm }, error: voiceError, elapsedMs: voiceMs },
    };
    const text = JSON.stringify(evidence, null, 2);
    assert.equal(text.includes(fakeKey), false, 'the key must never appear in output');
    mkdirSync(EVIDENCE, { recursive: true });
    writeFileSync(join(EVIDENCE, `byok-fake-key-probe-${providerName}.json`), `${text}\n`);
    console.log(`BYOK_PROBE provider=${providerName} model=${model} status.llm=${JSON.stringify(status.llm)} studio=${JSON.stringify(studioError)} voice=${JSON.stringify(voiceError)}`);

    assert.equal(status.login, `byok:${providerName}`);
    assert.match(status.llm, new RegExp(`^BYOK ${providerName} · ${model}`));
    assert.equal(desk.agent.model, model);
    assert.match(String(studioError), new RegExp(`BYOK provider ${providerName} rejected the API key \\(HTTP 401\\)`));
    assert.match(String(voiceError), new RegExp(`BYOK provider ${providerName} rejected the API key \\(HTTP 401\\)`));
  } finally {
    await studioBridge.close();
    await paypalRead.close();
    await runtime.stop();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

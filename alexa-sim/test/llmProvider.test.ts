import test from 'node:test';
import assert from 'node:assert/strict';
import { byokFromEnv, byokRuntimeEnv, explainLlmError, LlmConfigError } from '../src/llmProvider.js';
import { StudioBridge, createCopilotSessionFactory, type StudioEvent } from '../src/studioBridge.js';
import type { PayPalReadClient } from '../src/paypalMcp.js';

// Offline: env parsing and error mapping only. The fake key below is a placeholder string, never a real credential.
const FAKE = 'sk-test-placeholder-not-a-key';

test('no TILLWISE_LLM_PROVIDER (or "copilot") keeps the logged-in Copilot account', () => {
  assert.equal(byokFromEnv({}), null);
  assert.equal(byokFromEnv({ TILLWISE_LLM_PROVIDER: 'copilot', TILLWISE_LLM_MODEL: 'x' }), null);
});

test('openai / anthropic defaults, explicit model, key never in the label', () => {
  const openai = byokFromEnv({ TILLWISE_LLM_PROVIDER: 'openai', TILLWISE_LLM_MODEL: 'gpt-4o-mini', TILLWISE_LLM_API_KEY: FAKE })!;
  assert.deepEqual(openai.provider, { type: 'openai', baseUrl: 'https://api.openai.com/v1', apiKey: FAKE });
  assert.equal(openai.model, 'gpt-4o-mini');
  assert.equal(openai.label, 'BYOK openai · gpt-4o-mini @ api.openai.com (key set)');
  assert.equal(openai.label.includes(FAKE), false);
  const anthropic = byokFromEnv({ TILLWISE_LLM_PROVIDER: 'Anthropic', TILLWISE_LLM_MODEL: 'claude-x', TILLWISE_LLM_API_KEY: FAKE })!;
  assert.equal(anthropic.provider.type, 'anthropic');
  assert.equal(anthropic.provider.baseUrl, 'https://api.anthropic.com');
});

test('ollama and loopback base URLs run without a key; azure needs a base URL', () => {
  const ollama = byokFromEnv({ TILLWISE_LLM_PROVIDER: 'ollama', TILLWISE_LLM_MODEL: 'qwen3:4b-instruct' })!;
  assert.deepEqual(ollama.provider, { type: 'openai', baseUrl: 'http://127.0.0.1:11434/v1' });
  assert.ok(byokFromEnv({ TILLWISE_LLM_PROVIDER: 'openai', TILLWISE_LLM_MODEL: 'm', TILLWISE_LLM_BASE_URL: 'http://localhost:8080/v1' }));
  const azure = byokFromEnv({ TILLWISE_LLM_PROVIDER: 'azure', TILLWISE_LLM_MODEL: 'dep', TILLWISE_LLM_API_KEY: FAKE, TILLWISE_LLM_BASE_URL: 'https://x.openai.azure.com', TILLWISE_LLM_AZURE_API_VERSION: '2024-10-21', TILLWISE_LLM_WIRE_API: 'responses' })!;
  assert.deepEqual(azure.provider, { type: 'azure', baseUrl: 'https://x.openai.azure.com', apiKey: FAKE, wireApi: 'responses', azure: { apiVersion: '2024-10-21' } });
});

test('misconfiguration fails fast with a message that names the env var', () => {
  assert.throws(() => byokFromEnv({ TILLWISE_LLM_PROVIDER: 'gemini', TILLWISE_LLM_MODEL: 'm' }), (e: Error) => e instanceof LlmConfigError && /TILLWISE_LLM_PROVIDER/.test(e.message));
  assert.throws(() => byokFromEnv({ TILLWISE_LLM_PROVIDER: 'openai', TILLWISE_LLM_API_KEY: FAKE }), /TILLWISE_LLM_MODEL is required/);
  assert.throws(() => byokFromEnv({ TILLWISE_LLM_PROVIDER: 'openai', TILLWISE_LLM_MODEL: 'm' }), /TILLWISE_LLM_API_KEY is required/);
  assert.throws(() => byokFromEnv({ TILLWISE_LLM_PROVIDER: 'azure', TILLWISE_LLM_MODEL: 'm', TILLWISE_LLM_API_KEY: FAKE }), /TILLWISE_LLM_BASE_URL is required/);
});

test('BYOK runtime env drops GitHub tokens', () => {
  const env = byokRuntimeEnv({ PATH: '/bin', GH_TOKEN: 'a', GITHUB_TOKEN: 'b', COPILOT_GITHUB_TOKEN: 'c' });
  assert.deepEqual(env, { PATH: '/bin' });
});

test('a provider 401 becomes an actionable message without the key', () => {
  const byok = byokFromEnv({ TILLWISE_LLM_PROVIDER: 'openai', TILLWISE_LLM_MODEL: 'gpt-4o-mini', TILLWISE_LLM_API_KEY: FAKE });
  const raw = 'Authentication failed with provider at https://api.openai.com/v1 (HTTP 401).\n  Check your COPILOT_PROVIDER_API_KEY, COPILOT_PROVIDER_API_KEY_COMMAND, or COPILOT_PROVIDER_BEARER_TOKEN.';
  const message = explainLlmError(raw, byok);
  assert.match(message, /^BYOK provider openai rejected the API key \(HTTP 401\)\. Check TILLWISE_LLM_API_KEY/);
  assert.equal(message.includes(FAKE), false);
  assert.equal(message.includes('COPILOT_PROVIDER_API_KEY'), false);
  assert.equal(explainLlmError(raw, null), raw);
});

test('the Studio bridge surfaces a BYOK 401 as RUN_ERROR in the AI panel', async () => {
  const byok = byokFromEnv({ TILLWISE_LLM_PROVIDER: 'openai', TILLWISE_LLM_MODEL: 'gpt-4o-mini', TILLWISE_LLM_API_KEY: FAKE });
  const runtime = {
    async createStudioSession() { throw new Error('Authentication failed with provider at https://api.openai.com/v1 (HTTP 401).'); },
    explainError: (message: string) => explainLlmError(message, byok),
  };
  const paypal: PayPalReadClient = { async listReadOnlyTools() { return []; }, async callReadOnly() { return { speech: '', data: {} }; }, async close() {} };
  const bridge = new StudioBridge({ createSession: createCopilotSessionFactory(runtime), paypal, model: byok!.model });
  const events: StudioEvent[] = [];
  for await (const event of bridge.runRound({ threadId: 't', runId: 'r', messages: [{ id: 'u1', role: 'user', content: 'hi' }], tools: [] }, new AbortController().signal)) events.push(event);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'RUN_ERROR');
  assert.match((events[0] as { message: string }).message, /BYOK provider openai rejected the API key \(HTTP 401\)/);
});

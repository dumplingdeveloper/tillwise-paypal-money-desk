import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ProviderConfig } from '@github/copilot-sdk';

/**
 * Bring-your-own-key (BYOK) model provider for judges without a Copilot subscription.
 *
 * Copilot SDK 1.0.15 `SessionConfig.provider` (node_modules/@github/copilot-sdk/dist/types.d.ts:2009-2012): "Custom provider
 * configuration (BYOK - Bring Your Own Key). When specified, uses the provided API endpoint instead of the Copilot API."
 * `ProviderConfig` (types.d.ts:2510-2534): `type?: "openai" | "azure" | "anthropic"`, `baseUrl` (required), `apiKey?`.
 * The SDK README (:963) says "When using a custom provider, you must specify the `model` explicitly."
 *
 * Env (all optional; unset = the logged-in Copilot account):
 *   TILLWISE_LLM_PROVIDER   openai | anthropic | azure | ollama   (ollama = OpenAI-compatible local server, no key)
 *   TILLWISE_LLM_MODEL      required with a provider, used by both the voice sim and the Money Desk Studio agent
 *   TILLWISE_LLM_API_KEY    required for openai / anthropic / azure unless TILLWISE_LLM_BASE_URL is a loopback address
 *   TILLWISE_LLM_BASE_URL   defaults: openai https://api.openai.com/v1, anthropic https://api.anthropic.com, ollama http://127.0.0.1:11434/v1
 *   TILLWISE_LLM_AZURE_API_VERSION, TILLWISE_LLM_WIRE_API (completions | responses)
 */
export type ByokSettings = {
  kind: 'byok';
  providerName: 'openai' | 'anthropic' | 'azure' | 'ollama';
  provider: ProviderConfig;
  model: string;
  /** Safe to show/log: provider, model and host; never the key. */
  label: string;
};

const DEFAULT_BASE_URL: Record<string, string | undefined> = {
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com',
  ollama: 'http://127.0.0.1:11434/v1',
  azure: undefined,
};

export class LlmConfigError extends Error {}

function isLoopback(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
  } catch {
    return false;
  }
}

export function byokFromEnv(env: NodeJS.ProcessEnv = process.env): ByokSettings | null {
  const raw = (env.TILLWISE_LLM_PROVIDER || '').trim().toLowerCase();
  if (!raw || raw === 'copilot') return null;
  if (!['openai', 'anthropic', 'azure', 'ollama'].includes(raw)) throw new LlmConfigError(`TILLWISE_LLM_PROVIDER must be one of openai, anthropic, azure, ollama or copilot (got "${raw}").`);
  const providerName = raw as ByokSettings['providerName'];
  const model = (env.TILLWISE_LLM_MODEL || '').trim();
  if (!model) throw new LlmConfigError(`TILLWISE_LLM_MODEL is required when TILLWISE_LLM_PROVIDER=${providerName} (the Copilot SDK needs an explicit model for a custom provider).`);
  const baseUrl = (env.TILLWISE_LLM_BASE_URL || '').trim() || DEFAULT_BASE_URL[providerName];
  if (!baseUrl) throw new LlmConfigError(`TILLWISE_LLM_BASE_URL is required when TILLWISE_LLM_PROVIDER=${providerName}.`);
  try { new URL(baseUrl); } catch { throw new LlmConfigError(`TILLWISE_LLM_BASE_URL is not a valid URL.`); }
  const apiKey = (env.TILLWISE_LLM_API_KEY || '').trim() || undefined;
  if (!apiKey && providerName !== 'ollama' && !isLoopback(baseUrl)) throw new LlmConfigError(`TILLWISE_LLM_API_KEY is required when TILLWISE_LLM_PROVIDER=${providerName} (only local providers such as Ollama can run without a key).`);
  const provider: ProviderConfig = { type: providerName === 'ollama' ? 'openai' : providerName, baseUrl, ...(apiKey ? { apiKey } : {}) };
  const wireApi = (env.TILLWISE_LLM_WIRE_API || '').trim();
  if (wireApi === 'completions' || wireApi === 'responses') provider.wireApi = wireApi;
  if (providerName === 'azure' && env.TILLWISE_LLM_AZURE_API_VERSION) provider.azure = { apiVersion: env.TILLWISE_LLM_AZURE_API_VERSION };
  const host = new URL(baseUrl).host;
  return { kind: 'byok', providerName, provider, model, label: `BYOK ${providerName} · ${model} @ ${host}${apiKey ? ' (key set)' : ' (no key)'}` };
}

/** Isolated COPILOT_HOME so a BYOK run never reads or writes the developer's ~/.copilot login state (types.d.ts:280). */
export function byokBaseDirectory(): string {
  return join(tmpdir(), 'tillwise-copilot-byok-home');
}

/** Runtime env for BYOK: no GitHub tokens are passed on, so the session can only reach the configured provider. */
export function byokRuntimeEnv(env: NodeJS.ProcessEnv = process.env): Record<string, string | undefined> {
  const copy: Record<string, string | undefined> = { ...env };
  for (const name of ['GH_TOKEN', 'GITHUB_TOKEN', 'COPILOT_GITHUB_TOKEN']) delete copy[name];
  return copy;
}

/**
 * Turns provider failures into a message a judge can act on. The runtime's own 401 text points at COPILOT_PROVIDER_* env
 * vars, which this app does not use, so we name ours. Never includes the key.
 */
export function explainLlmError(message: string, byok: ByokSettings | null = null): string {
  const text = String(message || 'unknown error');
  if (!byok) return text;
  if (/HTTP 401|Authentication failed with provider|invalid[_ ]api[_ ]key|unauthori[sz]ed/i.test(text)) {
    return `BYOK provider ${byok.providerName} rejected the API key (HTTP 401). Check TILLWISE_LLM_API_KEY / TILLWISE_LLM_BASE_URL. Provider said: ${text.split('\n')[0]}`;
  }
  if (/HTTP 404|model.*not.*found|does not exist/i.test(text)) return `BYOK provider ${byok.providerName} does not know model "${byok.model}". Check TILLWISE_LLM_MODEL. Provider said: ${text.split('\n')[0]}`;
  if (/ECONNREFUSED|fetch failed|ENOTFOUND/i.test(text)) return `BYOK provider ${byok.providerName} is unreachable at ${byok.provider.baseUrl}. Provider said: ${text.split('\n')[0]}`;
  return `BYOK provider ${byok.providerName} error: ${text}`;
}

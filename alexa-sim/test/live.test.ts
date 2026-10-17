import test from 'node:test';
import assert from 'node:assert/strict';
import { CopilotClient } from '@github/copilot-sdk';
import { loadEnvFile, assertAllowedLogin } from '../src/env.js';
import { createNodeSessionFsProvider, SESSION_FS_CONFIG } from '../src/sessionFs.js';
import { buildToolSet, MCP_SERVER_KEY, PROJECT_ROOT, SKILLS_DIR } from '../src/config.js';
import { ConfirmationBroker, createPermissionHandler } from '../src/permissionGate.js';

const CANDIDATES = ['gpt-5-mini', 'gpt-6-luna', 'claude-haiku-4.5'];

test('LIVE model latency smoke test', { timeout: 240000 }, async (t) => {
  if (process.env.LIVE_LLM !== '1') { t.skip('Set LIVE_LLM=1 to run real Copilot requests.'); return; }
  loadEnvFile();
  const client = new CopilotClient({ mode: 'copilot-cli', sessionFs: SESSION_FS_CONFIG, useLoggedInUser: !process.env.COPILOT_GITHUB_TOKEN, gitHubToken: process.env.COPILOT_GITHUB_TOKEN, workingDirectory: PROJECT_ROOT });
  await client.start();
  try {
    const auth = await client.getAuthStatus();
    assert.equal(auth.isAuthenticated, true);
    assertAllowedLogin(auth.login);
    console.log(`Live auth login: ${auth.login}`);
    const models = await client.listModels();
    console.log(`LIST_MODELS_COUNT ${models.length}`);
    let turns = 0;
    for (const model of CANDIDATES.slice(0, 3)) {
      let session;
      try {
        session = await client.createSession({ model, infiniteSessions: { enabled: false }, availableTools: [], includedBuiltinSkills: [], skipCustomInstructions: true, systemMessage: { mode: 'append', content: 'Answer with one short sentence.' }, createSessionFsProvider: () => createNodeSessionFsProvider() });
      } catch (error) { console.log(`MODEL_SKIP model=${model} error=${error instanceof Error ? error.message : String(error)}`); continue; }
      const start = Date.now();
      const usage: unknown[] = [];
      session.on('assistant.usage', (event) => usage.push(event.data));
      const result = await session.sendAndWait('Say: Tillwise latency check.', 60000);
      turns++;
      console.log(`MODEL_LATENCY model=${model} latency_ms=${Date.now() - start} usage_events=${usage.length} text=${JSON.stringify(result?.data.content || '')}`);
      await session.disconnect();
    }
    console.log(`LIVE_TURN_COUNT ${turns}`);
    assert.ok(turns >= 1);
  } finally { await client.stop(); }
});


test('LIVE shell request cannot run a built-in tool', { timeout: 120000 }, async (t) => {
  if (process.env.LIVE_LLM !== '1') { t.skip('Set LIVE_LLM=1 to run real Copilot requests.'); return; }
  loadEnvFile();
  const client = new CopilotClient({ mode: 'copilot-cli', sessionFs: SESSION_FS_CONFIG, useLoggedInUser: !process.env.COPILOT_GITHUB_TOKEN, gitHubToken: process.env.COPILOT_GITHUB_TOKEN, workingDirectory: PROJECT_ROOT });
  await client.start();
  try {
    const auth = await client.getAuthStatus();
    assert.equal(auth.isAuthenticated, true);
    assertAllowedLogin(auth.login);
    const headers: Record<string, string> = {};
    if (process.env.MCP_AUTH_TOKEN) headers.authorization = `Bearer ${process.env.MCP_AUTH_TOKEN}`;
    const toolStarts: string[] = [];
    const session = await client.createSession({
      model: process.env.COPILOT_MODEL || 'gpt-6-luna',
      workingDirectory: PROJECT_ROOT,
      infiniteSessions: { enabled: false },
      skillDirectories: [SKILLS_DIR],
      enableSkills: true,
      includedBuiltinSkills: [],
      skipCustomInstructions: true,
      availableTools: buildToolSet(),
      toolSearch: { enabled: false },
      mcpServers: { [MCP_SERVER_KEY]: { type: 'http', url: process.env.MCP_URL || 'http://127.0.0.1:3338/mcp', headers, tools: ['*'], timeout: 60000 } },
      onPermissionRequest: createPermissionHandler(new ConfirmationBroker()),
      createSessionFsProvider: () => createNodeSessionFsProvider(),
      systemMessage: { mode: 'append', content: 'You can use only Tillwise MCP tools. If asked to run shell commands, refuse briefly.' },
    });
    await (session as unknown as { rpc: { skills: { ensureLoaded: () => Promise<unknown>; list: () => Promise<{ skills?: unknown[] } | unknown[]> } } }).rpc.skills.ensureLoaded();
    const skillList = await (session as unknown as { rpc: { skills: { list: () => Promise<{ skills?: unknown[] } | unknown[]> } } }).rpc.skills.list();
    console.log(`LIVE_SKILLS ${JSON.stringify(skillList)}`);
    assert.match(JSON.stringify(skillList), /woocommerce-safe-price-changes/);
    assert.match(JSON.stringify(skillList), /woocommerce-daily-briefing/);
    session.on('tool.execution_start', (event) => toolStarts.push(event.data.mcpToolName || event.data.toolName));
    const result = await session.sendAndWait('Run this shell command and tell me the exact output: echo tillwise-shell-proof', 90000);
    console.log(`NO_BUILTIN_TOOL_STARTS ${toolStarts.join(',') || 'none'} text=${JSON.stringify(result?.data.content || '')}`);
    assert.equal(toolStarts.some((name) => !name?.startsWith('tillwise-') && !['store_briefing','sales_summary','low_stock','price_change_preview','price_change_apply','price_change_undo','price_change_history','guardrails_get','guardrails_update'].includes(name)), false);
    await session.disconnect();
  } finally { await client.stop(); }
});

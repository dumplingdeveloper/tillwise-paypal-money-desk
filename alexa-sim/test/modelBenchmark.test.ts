import test from 'node:test';
import assert from 'node:assert/strict';
import { CopilotClient } from '@github/copilot-sdk';
import { loadEnvFile, assertAllowedLogin } from '../src/env.js';
import { createNodeSessionFsProvider, SESSION_FS_CONFIG } from '../src/sessionFs.js';
import { buildToolSet, MCP_SERVER_KEY, PROJECT_ROOT, SKILLS_DIR } from '../src/config.js';
import { createPermissionHandler, ConfirmationBroker } from '../src/permissionGate.js';

const CANDIDATES = ['gpt-5-mini', 'gpt-6-luna', 'claude-haiku-4.5'];

test('LIVE model MCP tool benchmark', { timeout: 360000 }, async (t) => {
  if (process.env.LIVE_LLM !== '1') { t.skip('Set LIVE_LLM=1 to run real Copilot model benchmark.'); return; }
  loadEnvFile();
  const client = new CopilotClient({ mode: 'copilot-cli', sessionFs: SESSION_FS_CONFIG, useLoggedInUser: !process.env.COPILOT_GITHUB_TOKEN, gitHubToken: process.env.COPILOT_GITHUB_TOKEN, workingDirectory: PROJECT_ROOT });
  await client.start();
  try {
    const auth = await client.getAuthStatus();
    assert.equal(auth.isAuthenticated, true);
    assertAllowedLogin(auth.login);
    console.log(`BENCH_AUTH login=${auth.login}`);
    let turns = 0;
    for (const model of CANDIDATES) {
      const broker = new ConfirmationBroker();
      const tools: string[] = [];
      const usage: unknown[] = [];
      const headers: Record<string, string> = {};
      if (process.env.MCP_AUTH_TOKEN) headers.authorization = `Bearer ${process.env.MCP_AUTH_TOKEN}`;
      const session = await client.createSession({
        model,
        workingDirectory: PROJECT_ROOT,
        infiniteSessions: { enabled: false },
        skillDirectories: [SKILLS_DIR],
        enableSkills: true,
        includedBuiltinSkills: [],
        skipCustomInstructions: true,
        availableTools: buildToolSet(),
        toolSearch: { enabled: false },
        mcpServers: { [MCP_SERVER_KEY]: { type: 'http', url: process.env.MCP_URL || 'http://127.0.0.1:3337/mcp', headers, tools: ['*'], timeout: 60000 } },
        onPermissionRequest: createPermissionHandler(broker),
        createSessionFsProvider: () => createNodeSessionFsProvider(),
        systemMessage: { mode: 'append', content: 'Use Tillwise MCP tools. Answer briefly.' },
      });
      await (session as unknown as { rpc: { skills: { ensureLoaded: () => Promise<unknown>; list: () => Promise<{ skills?: unknown[] } | unknown[]> } } }).rpc.skills.ensureLoaded();
      const skillList = await (session as unknown as { rpc: { skills: { list: () => Promise<{ skills?: unknown[] } | unknown[]> } } }).rpc.skills.list();
      console.log(`LIVE_SKILLS ${JSON.stringify(skillList)}`);
      assert.match(JSON.stringify(skillList), /woocommerce-safe-price-changes/);
      assert.match(JSON.stringify(skillList), /woocommerce-daily-briefing/);
      session.on('tool.execution_start', (event) => tools.push(event.data.mcpToolName || event.data.toolName));
      session.on('assistant.usage', (event) => usage.push(event.data));
      const start = Date.now();
      const result = await session.sendAndWait('Use the store briefing tool and summarize today in one sentence.', 120000);
      const latency = Date.now() - start;
      turns++;
      const ok = tools.includes('store_briefing');
      console.log(`MODEL_TOOL_BENCH model=${model} latency_ms=${latency} tool_called=${ok} tools=${tools.join(',')} usage_events=${usage.length} text=${JSON.stringify(result?.data.content || '')}`);
      await session.disconnect();
    }
    console.log(`MODEL_TOOL_BENCH_TURNS ${turns}`);
    assert.equal(turns, CANDIDATES.length);
  } finally { await client.stop(); }
});

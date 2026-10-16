import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { chromium } from 'playwright-core';
import { parseArgs, ROOT } from './common.js';

function run(cmd, args, options = {}) {
  const res = spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit', env: { ...process.env, HF_HOME: `${ROOT}/.cache/hf`, TRANSFORMERS_CACHE: `${ROOT}/.cache/hf` }, ...options });
  if (res.status !== 0) process.exit(res.status || 1);
}

async function main() {
  const args = parseArgs();
  const baseUrl = String(args.url || 'http://127.0.0.1:4178').replace(/\/$/, '');
  const scene = args.scene || 'scenes/live-sim.json';
  console.log(`Preflight GET ${baseUrl}`);
  let res;
  try { res = await fetch(baseUrl); } catch (err) { throw new Error(`Simulator is not reachable at ${baseUrl}: ${err.message}`); }
  if (!res.ok) throw new Error(`Simulator GET ${baseUrl} failed: HTTP ${res.status}`);

  const statusUrl = `${baseUrl}/api/status`;
  console.log(`Preflight GET ${statusUrl}`);
  let statusRes;
  try { statusRes = await fetch(statusUrl); } catch (err) { throw new Error(`Simulator status endpoint is not reachable at ${statusUrl}: ${err.message}`); }
  if (!statusRes.ok) throw new Error(`Simulator status endpoint ${statusUrl} failed: HTTP ${statusRes.status}. This does not look like the real simulator.`);
  let status;
  try { status = await statusRes.json(); } catch (err) { throw new Error(`Simulator status endpoint ${statusUrl} did not return JSON: ${err.message}`); }
  if (!Object.prototype.hasOwnProperty.call(status, 'login') || !Object.prototype.hasOwnProperty.call(status, 'model')) {
    throw new Error(`Simulator status endpoint ${statusUrl} must return both 'login' and 'model'. Received keys: ${Object.keys(status).join(', ') || '(none)'}`);
  }
  console.log(`Simulator status OK: login=${JSON.stringify(status.login)} model=${JSON.stringify(status.model)}`);

  const reset = path.resolve(ROOT, '../scripts/demo-reset.sh');
  if (!fs.existsSync(reset)) throw new Error(`Missing reset script: ${reset}`);
  console.log(`Running ${reset}`);
  run(reset, [], { cwd: path.dirname(ROOT) });

  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--window-size=1920,940', '--force-device-scale-factor=1'] });
  const page = await browser.newPage({ viewport: { width: 1920, height: 940 }, deviceScaleFactor: 1 });
  const demoUrl = `${baseUrl}/?demo=1`;
  console.log(`Checking ${demoUrl}`);
  // The page keeps an EventSource open, so 'networkidle' never settles.
  await page.goto(demoUrl, { waitUntil: 'load', timeout: 30000 });
  for (const selector of ['#text', '#send', '#hoodToggle']) {
    await page.locator(selector).waitFor({ state: 'visible', timeout: 10000 });
  }
  await page.locator('#hoodHeader .label').first().waitFor({ state: 'attached', timeout: 30000 });
  await browser.close();

  run(process.execPath, ['scripts/tts.js', '--scene', scene]);
  run(process.execPath, ['scripts/record.js', '--scene', scene, '--url', baseUrl]);
  run(process.execPath, ['scripts/compose.js', '--scene', scene]);
}

main().catch(err => { console.error(err); process.exit(1); });

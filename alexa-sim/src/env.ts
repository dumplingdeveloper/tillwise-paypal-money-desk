import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function loadEnvFile(path = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '.env')) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match) continue;
    if (process.env[match[1]] === undefined) process.env[match[1]] = match[2];
  }
}

export function assertAllowedLogin(login?: string): string {
  if (!login) throw new Error('Copilot SDK did not report a GitHub login.');
  if (process.env.ALLOW_ANY_GITHUB_LOGIN === '1') return login;
  const expected = process.env.EXPECTED_GITHUB_LOGIN;
  if (!expected) throw new Error('EXPECTED_GITHUB_LOGIN must be set, or set ALLOW_ANY_GITHUB_LOGIN=1 explicitly.');
  if (login !== expected) throw new Error(`Authenticated as ${login}, expected ${expected}. Refusing to send prompts.`);
  return login;
}

export function loadAllEnvFiles() {
  const here = dirname(fileURLToPath(import.meta.url));
  loadEnvFile(resolve(here, '..', '..', '.env'));
  loadEnvFile(resolve(here, '..', '..', '..', '.env'));
  loadEnvFile(resolve(here, '..', '..', '..', 'mcp-server', '.env'));
}

import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { startSimulator } from './server.js';
import { readEnvFile } from './config.js';

const root = resolve(process.cwd(), '..');
// Shell env wins over the seeded .env files, so ports can be overridden (e.g. MCP_PORT=3348 MCP_URL=http://127.0.0.1:3348/mcp).
const env = { ...readEnvFile(resolve(root, '.env')), ...readEnvFile(resolve(root, 'mcp-server', '.env')), ...process.env };
const mcp = spawn('npm', ['--prefix', resolve(root, 'mcp-server'), 'start'], { stdio: 'inherit', env });
process.on('exit', () => mcp.kill());
process.on('SIGINT', () => { mcp.kill(); process.exit(130); });
setTimeout(async () => { await startSimulator(); }, 1500);

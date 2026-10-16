import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { startSimulator } from './server.js';
import { readEnvFile } from './config.js';

const root = resolve(process.cwd(), '..');
const env = { ...process.env, ...readEnvFile(resolve(root, '.env')), ...readEnvFile(resolve(root, 'mcp-server', '.env')) };
const mcp = spawn('npm', ['--prefix', resolve(root, 'mcp-server'), 'start'], { stdio: 'inherit', env });
process.on('exit', () => mcp.kill());
process.on('SIGINT', () => { mcp.kill(); process.exit(130); });
setTimeout(async () => { await startSimulator(); }, 1500);

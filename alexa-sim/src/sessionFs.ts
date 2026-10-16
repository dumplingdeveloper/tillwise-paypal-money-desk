import { mkdir, readFile, writeFile, appendFile, stat, readdir, rm, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import type { Stats } from 'node:fs';
import type { SessionFsProvider, SessionFsFileInfo } from '@github/copilot-sdk';
import { ROOT, PROJECT_ROOT } from './config.js';

export const SESSION_FS_ROOT = resolve(ROOT, '.copilot-sdk-state');

function localPath(sessionPath: string): string {
  if (sessionPath === ROOT || sessionPath.startsWith(ROOT + sep) || sessionPath === PROJECT_ROOT || sessionPath.startsWith(PROJECT_ROOT + sep)) return sessionPath;
  const cleaned = sessionPath.replace(/^[/\\]+/, '');
  const path = resolve(SESSION_FS_ROOT, cleaned || '.');
  if (path !== SESSION_FS_ROOT && !path.startsWith(SESSION_FS_ROOT + sep)) throw Object.assign(new Error('Path escapes session filesystem root'), { code: 'EACCES' });
  return path;
}

function fileInfo(s: Stats): SessionFsFileInfo {
  return { isFile: s.isFile(), isDirectory: s.isDirectory(), size: Number(s.size), mtime: s.mtime.toISOString(), birthtime: s.birthtime.toISOString() };
}

export function createNodeSessionFsProvider(): SessionFsProvider {
  return {
    async readFile(path) { return readFile(localPath(path), 'utf8'); },
    async writeFile(path, content, mode) { const dest = localPath(path); await mkdir(dirname(dest), { recursive: true }); await writeFile(dest, content, { mode }); },
    async appendFile(path, content, mode) { const dest = localPath(path); await mkdir(dirname(dest), { recursive: true }); await appendFile(dest, content, { mode }); },
    async exists(path) { return existsSync(localPath(path)); },
    async stat(path) { return fileInfo(await stat(localPath(path))); },
    async mkdir(path, recursive, mode) { await mkdir(localPath(path), { recursive, mode }); },
    async readdir(path) { return readdir(localPath(path)); },
    async readdirWithTypes(path) { return (await readdir(localPath(path), { withFileTypes: true })).filter((entry) => entry.isFile() || entry.isDirectory()).map((entry) => ({ name: entry.name, type: entry.isDirectory() ? 'directory' as const : 'file' as const })); },
    async rm(path, recursive, force) { await rm(localPath(path), { recursive, force }); },
    async rename(src, dest) { const to = localPath(dest); await mkdir(dirname(to), { recursive: true }); await rename(localPath(src), to); },
  };
}

export const SESSION_FS_CONFIG = { initialCwd: '/', sessionStatePath: '/.state', conventions: 'posix' as const };

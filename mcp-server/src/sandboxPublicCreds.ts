/**
 * `npm run sandbox:public-creds`: saves PayPal's *public default* sandbox credentials to
 * ~/.config/tillwise/paypal-sandbox.env (mode 600), so a judge can try the real sandbox without a PayPal account.
 *
 * Source: PayPal's official Postman collection https://github.com/paypal/postman-collections,
 * file Collections/PayPal_Public_APIs.json, collection variables `client_id` and `client_secret`. Its own note:
 * "PayPal Public Collection comes with following default public set of credentials stored at the Collection level.
 *  You may choose to override these values via environment level variables. You may bring your own credentials
 *  from PayPal Developer Dashboard there."
 *
 * It is a SHARED app: everything created with it is visible to every other user of these credentials.
 * The values are never printed and never written anywhere except the env file.
 */
import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const POSTMAN_REPO = 'https://github.com/paypal/postman-collections';
/** Pinned so the download is reproducible (repo HEAD on 2026-10-26). `--ref main` follows the branch instead. */
export const POSTMAN_COMMIT = '7f7240ab2d9417a55bf9c68355bf33bf64b1665c';
export const POSTMAN_FILE = 'Collections/PayPal_Public_APIs.json';
export const postmanRawUrl = (ref = POSTMAN_COMMIT) => `https://raw.githubusercontent.com/paypal/postman-collections/${ref}/${POSTMAN_FILE}`;

type PostmanVariable = { key?: string; value?: unknown };
export type PublicCredentials = { clientId: string; clientSecret: string; note: string };

/** Reads the collection-level variables `client_id` / `client_secret` (and PayPal's note about them). */
export function extractPublicCredentials(collection: unknown): PublicCredentials {
  const vars = (collection as { variable?: PostmanVariable[] })?.variable;
  if (!Array.isArray(vars)) throw new Error('not a Postman collection: no collection-level "variable" array');
  const value = (key: string) => vars.find((v) => v.key === key)?.value;
  const clientId = value('client_id');
  const clientSecret = value('client_secret');
  // PayPal client ids/secrets are URL-safe base64-like strings; anything else means the file changed shape.
  const plausible = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{20,200}$/.test(v);
  if (!plausible(clientId) || !plausible(clientSecret)) throw new Error('collection variables client_id / client_secret are missing or not credential-shaped');
  const noteVar = vars.find((v) => typeof v.key === 'string' && /^PLEASE NOTE/i.test(v.key));
  const note = typeof noteVar?.value === 'string' ? noteVar.value.replace(/^<\s*/, '').replace(/\s+/g, ' ').trim() : '';
  return { clientId, clientSecret, note };
}

export type PublicCredsOptions = {
  url?: string;
  out?: string;
  force?: boolean;
  fetchImpl?: typeof fetch;
  log?: (line: string) => void;
  now?: () => Date;
};

/** Returns a process exit code: 0 saved, 3 the env file exists (no network call without --force), 1 failure. */
export async function savePublicSandboxCredentials(options: PublicCredsOptions = {}): Promise<number> {
  const log = options.log || ((line: string) => console.log(line));
  const out = options.out || join(homedir(), '.config', 'tillwise', 'paypal-sandbox.env');
  const sourceOut = out.replace(/\.env$/, '') + '.SOURCE.txt';
  const url = options.url || postmanRawUrl();
  const host = new URL(url).hostname;
  if (host !== 'raw.githubusercontent.com' && host !== '127.0.0.1') { log(`refusing to download credentials from ${host}`); return 1; }
  if (existsSync(out) && !options.force) {
    log(`${out} already exists; nothing changed (no network call). Use --force to replace it with PayPal's public default sandbox credentials.`);
    return 3;
  }
  let creds: PublicCredentials;
  try {
    const response = await (options.fetchImpl || fetch)(url, { headers: { accept: 'application/json' } });
    if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
    creds = extractPublicCredentials(await response.json());
  } catch (error) {
    log(`could not read PayPal's public collection: ${(error as Error).message}`);
    return 1;
  }
  mkdirSync(dirname(out), { recursive: true, mode: 0o700 });
  writeFileSync(out, `PAYPAL_CLIENT_ID=${creds.clientId}\nPAYPAL_CLIENT_SECRET=${creds.clientSecret}\n`, { mode: 0o600 });
  chmodSync(out, 0o600);
  const fetchedAt = (options.now || (() => new Date()))().toISOString();
  writeFileSync(sourceOut, [
    "PayPal's public default sandbox credentials (written by mcp-server `npm run sandbox:public-creds`).",
    `Repository: ${POSTMAN_REPO}`,
    `File: ${POSTMAN_FILE}`,
    `Downloaded from: ${url}`,
    `Fetched at: ${fetchedAt}`,
    'Collection variables: client_id -> PAYPAL_CLIENT_ID, client_secret -> PAYPAL_CLIENT_SECRET',
    `PayPal's note in the collection, verbatim: "${creds.note}"`,
    'This is a SHARED sandbox app: objects you create are visible to every other user of these credentials.',
    '',
  ].join('\n'), { mode: 0o600 });
  log(`Saved PayPal's public default sandbox credentials to ${out} (mode 600; client_id ${creds.clientId.length} chars, client_secret ${creds.clientSecret.length} chars; values not shown).`);
  log(`Provenance: ${sourceOut}. This is a SHARED sandbox app. Next: npm run sandbox:smoke`);
  return 0;
}

export function parsePublicCredsArgs(argv: string[]): { force: boolean; ref?: string } {
  const force = argv.includes('--force');
  const refArg = argv.find((a) => a.startsWith('--ref='));
  const ref = refArg ? refArg.slice('--ref='.length) : undefined;
  if (ref !== undefined && !/^[A-Za-z0-9._/-]{1,64}$/.test(ref)) throw new Error('--ref must be a branch name or commit sha');
  return { force, ref };
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const args = parsePublicCredsArgs(process.argv.slice(2));
  process.exitCode = await savePublicSandboxCredentials({ force: args.force, url: postmanRawUrl(args.ref) });
}

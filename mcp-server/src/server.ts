import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { LATEST_PROTOCOL_VERSION, isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { WpAbilityClient } from './wpClient.js';
import { registerTillwiseTools } from './tools.js';
import { PayPalService } from './paypal/service.js';
import { registerPayPalTools } from './paypal/tools.js';
import { installPayPalCallLog } from './paypal/callLog.js';

export type Env = Record<string, string | undefined>;

type NegotiatedSession = {
  sessionId: string;
  clientInfo?: { name?: string; version?: string };
  requestedProtocolVersion?: string;
  negotiatedProtocolVersion?: string;
  initializedAt: string;
};

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    req.on('error', reject);
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      if (!text) return resolve(undefined);
      try { resolve(JSON.parse(text)); } catch (error) { reject(error); }
    });
  });
}

export function createServer(wp: Pick<WpAbilityClient, 'run'>, env: Env = process.env) {
  const server = new McpServer({ name: 'tillwise-store-agent', version: '0.1.0' });
  registerTillwiseTools(server, wp);
  registerPayPalTools(server, PayPalService.fromEnv(wp, env));

  const root = dirname(dirname(fileURLToPath(import.meta.url)));
  for (const skillName of ['woocommerce-safe-price-changes', 'woocommerce-daily-briefing']) {
    const path = join(root, '..', 'skills', skillName, 'SKILL.md');
    server.registerResource(skillName, `skill://${skillName}`, {
      title: skillName,
      description: `Agent Skill instructions for ${skillName}.`,
      mimeType: 'text/markdown',
    }, async (uri) => ({ contents: [{ uri: uri.href, mimeType: 'text/markdown', text: existsSync(path) ? readFileSync(path, 'utf8') : '' }] }));
  }
  return server;
}

function hasInitializeRequest(body: unknown): boolean {
  return Array.isArray(body) ? body.some(isInitializeRequest) : isInitializeRequest(body);
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function initializeRequest(body: unknown): { params?: { protocolVersion?: string; clientInfo?: { name?: string; version?: string } } } | undefined {
  const messages = Array.isArray(body) ? body : [body];
  return messages.find(isInitializeRequest) as { params?: { protocolVersion?: string; clientInfo?: { name?: string; version?: string } } } | undefined;
}

export async function startHttpServer(env: Env = process.env) {
  const host = env.MCP_HOST || '127.0.0.1';
  const port = Number(env.MCP_PORT || '3338');
  const wp = new WpAbilityClient(env.WP_BASE_URL || 'http://127.0.0.1:8098', env.WP_USERNAME || 'shopmanager', env.WP_APPLICATION_PASSWORD || '');
  const transports = new Map<string, StreamableHTTPServerTransport>();
  const sessions = new Map<string, NegotiatedSession>();

  const makeTransport = () => {
    const transport: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      enableJsonResponse: true,
      enableDnsRebindingProtection: true,
      allowedHosts: [host, `${host}:${port}`, 'localhost', `localhost:${port}`, '127.0.0.1', `127.0.0.1:${port}`],
      allowedOrigins: [`http://${host}:${port}`, `http://127.0.0.1:${port}`, `http://localhost:${port}`],
      onsessioninitialized: (sessionId: string): void => { transports.set(sessionId, transport); },
    });
    transport.onclose = () => {
      const sessionId = transport.sessionId;
      if (sessionId) { transports.delete(sessionId); }
    };
    return transport;
  };

  const allowedHosts = new Set([host, `${host}:${port}`, 'localhost', `localhost:${port}`, '127.0.0.1', `127.0.0.1:${port}`]);
  const allowedOrigins = new Set([`http://${host}:${port}`, `http://127.0.0.1:${port}`, `http://localhost:${port}`]);
  const checkAccess = (req: IncomingMessage, res: ServerResponse): boolean => {
    const reqHost = headerValue(req.headers.host);
    if (reqHost && !allowedHosts.has(reqHost)) { res.writeHead(403).end('Forbidden'); return false; }
    const origin = headerValue(req.headers.origin);
    if (origin && !allowedOrigins.has(origin)) { res.writeHead(403).end('Forbidden'); return false; }
    const expectedToken = env.MCP_AUTH_TOKEN;
    if (expectedToken) {
      const got = req.headers.authorization || '';
      if (got !== `Bearer ${expectedToken}`) { res.writeHead(401).end('Unauthorized'); return false; }
    }
    return true;
  };

  const httpServer = http.createServer(async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const url = new URL(req.url || '/', `http://${host}:${port}`);
      if (url.pathname !== '/mcp' && url.pathname !== '/status') { res.writeHead(404).end('Not found'); return; }
      if (!checkAccess(req, res)) return;
      if (url.pathname === '/status') {
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ sessions: [...sessions.values()], latestProtocolVersion: LATEST_PROTOCOL_VERSION }));
        return;
      }

      const sessionId = headerValue(req.headers['mcp-session-id']);
      let transport = sessionId ? transports.get(sessionId) : undefined;

      if (req.method === 'POST') {
        const body = await readBody(req);
        const init = initializeRequest(body);
        if (!transport) {
          if (sessionId || !hasInitializeRequest(body)) {
            res.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: 'Bad Request: No valid session ID provided' }, id: null }));
            return;
          }
          transport = makeTransport();
          const mcp = createServer(wp, env);
          await mcp.connect(transport);
        }
        if (init) {
          const originalWrite = res.write.bind(res) as ServerResponse['write'];
          const originalEnd = res.end.bind(res) as ServerResponse['end'];
          const chunks: Buffer[] = [];
          res.write = ((chunk?: unknown, ...args: unknown[]) => {
            if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
            return originalWrite(chunk as never, ...(args as never[]));
          }) as ServerResponse['write'];
          res.end = ((chunk?: unknown, ...args: unknown[]) => {
            if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
            const text = Buffer.concat(chunks).toString('utf8');
            let negotiatedProtocolVersion: string | undefined;
            try { negotiatedProtocolVersion = JSON.parse(text).result?.protocolVersion; } catch { const match = text.match(/\"protocolVersion\"\s*:\s*\"([^\"]+)\"/); if (match) negotiatedProtocolVersion = match[1]; }
            const initializedSessionId = transport?.sessionId;
            if (initializedSessionId) {
              const record: NegotiatedSession = { sessionId: initializedSessionId, clientInfo: init.params?.clientInfo, requestedProtocolVersion: init.params?.protocolVersion, negotiatedProtocolVersion: negotiatedProtocolVersion || LATEST_PROTOCOL_VERSION, initializedAt: new Date().toISOString() };
              sessions.set(initializedSessionId, record);
              console.log(`MCP session ${initializedSessionId} client=${record.clientInfo?.name || 'unknown'}/${record.clientInfo?.version || 'unknown'} requested=${record.requestedProtocolVersion || 'unknown'} negotiated=${record.negotiatedProtocolVersion || 'unknown'}`);
            }
            return originalEnd(chunk as never, ...(args as never[]));
          }) as ServerResponse['end'];
        }
        await transport.handleRequest(req, res, body);
        return;
      }

      if ((req.method === 'GET' || req.method === 'DELETE') && transport) {
        await transport.handleRequest(req, res);
        return;
      }

      res.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: 'Bad Request: Invalid or missing session ID' }, id: null }));
    } catch (error) {
      console.error('MCP HTTP handler error', error);
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    }
  });

  await new Promise<void>((resolve) => httpServer.listen(port, host, resolve));
  console.log(`Tillwise MCP server listening on http://${host}:${port}/mcp`);
  console.log(`MCP LATEST_PROTOCOL_VERSION=${LATEST_PROTOCOL_VERSION}`);
  return {
    httpServer,
    mcp: { close: async () => { for (const transport of transports.values()) await transport.close(); transports.clear(); sessions.clear(); } },
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  installPayPalCallLog({ source: 'mcp-server' });
  startHttpServer().catch((error) => { console.error(error); process.exit(1); });
}

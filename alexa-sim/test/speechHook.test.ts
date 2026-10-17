import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createReadStream, existsSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { chromium } from 'playwright-core';
import { PUBLIC_DIR } from '../src/config.js';

function servePublic() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    const rel = url.pathname === '/' ? '/index.html' : url.pathname;
    const path = normalize(join(PUBLIC_DIR, rel));
    if (!path.startsWith(PUBLIC_DIR) || !existsSync(path)) { res.writeHead(404).end(); return; }
    const mime = extname(path) === '.js' ? 'text/javascript' : extname(path) === '.css' ? 'text/css' : 'text/html';
    res.writeHead(200, { 'content-type': mime });
    createReadStream(path).pipe(res);
  });
  return new Promise<{ server: http.Server; port: number }>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: (server.address() as { port: number }).port }));
  });
}

test('demo speech hook serializes synthetic SSE speech with state transitions', { timeout: 30000 }, async () => {
  const { server, port } = await servePublic();
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.addInitScript(() => {
      class MockEventSource {
        onmessage: ((event: { data: string }) => void) | null = null;
        constructor(_url: string) { (window as any).__mockEventSource = this; }
        close() {}
      }
      (window as any).EventSource = MockEventSource;
      (window as any).__speakCalls = [];
      (window as any).__tillwiseSpeak = ({ role, text }: { role: string; text: string }) => new Promise<void>((resolve) => {
        (window as any).__speakCalls.push({ role, text, phase: 'start', state: document.querySelector('#state')?.textContent });
        setTimeout(() => {
          (window as any).__speakCalls.push({ role, text, phase: 'end', state: document.querySelector('#state')?.textContent });
          resolve();
        }, 300);
      });
      const originalFetch = window.fetch.bind(window);
      window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === '/api/conversations') {
          return Promise.resolve(new Response(JSON.stringify({ id: 'mock-conversation', login: 'test', model: 'mock', mcpUrl: 'mock', protocolVersion: '2025-11-25', skills: [] }), { status: 200, headers: { 'content-type': 'application/json' } }));
        }
        if (url.includes('/message') || url.includes('/confirm')) {
          return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 202, headers: { 'content-type': 'application/json' } }));
        }
        return originalFetch(input, init);
      };
    });
    await page.goto(`http://127.0.0.1:${port}/?demo=1`);
    await page.waitForFunction(() => Boolean((window as any).__mockEventSource));
    const emit = async (event: unknown) => page.evaluate((payload) => {
      (window as any).__mockEventSource.onmessage?.({ data: JSON.stringify(payload) });
    }, event);

    await emit({ type: 'final', data: { text: 'First answer.' } });
    await emit({ type: 'permission', data: { id: 'perm1', toolName: 'price_change_apply', message: 'Apply the preview?', summary: '5 prices' } });
    await emit({ type: 'confirmation_reprompt', data: { text: 'Please say yes or no.' } });
    await emit({ type: 'final', data: { text: 'Second answer.' } });

    await page.waitForFunction(() => (window as any).__speakCalls.filter((c: { phase: string }) => c.phase === 'end').length === 4, null, { timeout: 10000 });
    const calls = await page.evaluate(() => (window as any).__speakCalls);
    assert.deepEqual(calls.map((c: { role: string; text: string; phase: string }) => `${c.phase}:${c.role}:${c.text}`), [
      'start:assistant:First answer.',
      'end:assistant:First answer.',
      'start:host:Apply the preview?',
      'end:host:Apply the preview?',
      'start:host:Please say yes or no.',
      'end:host:Please say yes or no.',
      'start:assistant:Second answer.',
      'end:assistant:Second answer.',
    ]);
    assert.equal(calls.every((c: { phase: string; state: string }) => c.phase !== 'start' || c.state === 'speaking'), true);
    assert.equal(await page.textContent('#state'), 'waiting for confirmation');
    const speechEvents = await page.evaluate(() => (window as any).__tillwise.events.filter((e: { type: string }) => e.type === 'speak_start' || e.type === 'speak_end').map((e: { type: string }) => e.type));
    assert.deepEqual(speechEvents, ['speak_start', 'speak_end', 'speak_start', 'speak_end', 'speak_start', 'speak_end', 'speak_start', 'speak_end']);
    const finalEvents = await page.evaluate(() => (window as any).__tillwise.events.filter((e: { type: string }) => e.type === 'final').length);
    assert.equal(finalEvents, 2);

    await emit({ type: 'permission_resolved', data: { id: 'perm1', approved: true, reason: 'owner' } });
    await emit({ type: 'final', data: { text: 'Done.' } });
    await page.waitForFunction(() => (window as any).__speakCalls.filter((c: { phase: string }) => c.phase === 'end').length === 5, null, { timeout: 10000 });
    assert.equal(await page.textContent('#state'), 'idle');

    await emit({ type: 'interim', data: { text: "I'll check that now." } });
    await emit({ type: 'permission', data: { id: 'perm2', toolName: 'price_change_apply', message: 'Apply another preview?', summary: '5 prices' } });
    await page.waitForTimeout(80);
    await emit({ type: 'permission_resolved', data: { id: 'perm2', approved: true, reason: 'owner' } });
    await page.waitForTimeout(80);
    await emit({ type: 'tool_start', data: { id: 'tool2', name: 'price_change_apply', arguments: {} } });
    await page.waitForTimeout(40);
    await emit({ type: 'tool_end', data: { id: 'tool2', name: 'price_change_apply', success: true } });
    const timeline = await page.evaluate(() => [...document.querySelectorAll('#timeline li')].map((li) => ({ text: li.textContent || '', sort: Number((li as HTMLElement).dataset.sortTime || 0) })));
    assert.equal(timeline.every((row, index, rows) => index === 0 || rows[index - 1].sort >= row.sort), true);
    assert.ok(timeline.find((row) => row.text.includes('price_change_apply'))?.text.includes('after confirmation'));
    assert.ok(timeline.find((row) => row.text.includes('permission'))?.text.includes('confirmed by owner (voice) after'));
    assert.ok(timeline.some((row) => row.text.includes("said") && row.text.includes("I'll check that now.")));

    // Real Copilot runtime order: tool_start arrives before the permission request.
    await emit({ type: 'tool_start', data: { id: 'tool3', name: 'price_change_undo', arguments: {} } });
    await emit({ type: 'permission', data: { id: 'perm3', toolName: 'price_change_undo', message: 'Undo the last change?', summary: 'undo' } });
    await page.waitForTimeout(1200);
    await emit({ type: 'permission_resolved', data: { id: 'perm3', approved: true, reason: 'owner' } });
    await page.waitForTimeout(40);
    await emit({ type: 'tool_end', data: { id: 'tool3', name: 'price_change_undo', success: true } });
    const undoRow = await page.evaluate(() => [...document.querySelectorAll('#timeline li')].map((li) => li.textContent || '').find((text) => text.includes('price_change_undo')) || '');
    assert.match(undoRow, /\d+ ms after confirmation/, `owner wait must not count as tool time: ${undoRow}`);
  } finally {
    const browserProcess = (browser as unknown as { process?: () => { kill: () => void } | null }).process?.();
    await Promise.race([browser.close(), new Promise((resolve) => setTimeout(resolve, 3000))]).catch(() => {});
    browserProcess?.kill();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

import assert from 'node:assert/strict';
import type { Page } from 'playwright-core';

/** Shared browser helpers for the Money Desk tests (offline plumbing + LIVE_LLM acceptance). */

export type WidgetSnapshot = Record<string, { type: string; dataMapping?: Record<string, Array<{ id: string; aggregation?: string }>>; format?: Record<string, unknown>; layout?: Record<string, number>; widgetFilters?: Array<{ field?: { id: string }; model?: unknown }> }>;

export async function openMoneyDesk(page: Page, baseUrl: string) {
  const consoleLines: string[] = [];
  page.on('console', (message) => consoleLines.push(`[${message.type()}] ${message.text()}`));
  page.on('pageerror', (error) => consoleLines.push(`[pageerror] ${error.message}`));
  await page.goto(`${baseUrl}/money-desk.html`);
  await page.waitForFunction(() => (window as any).__moneyDesk?.ready === true || (window as any).__moneyDesk?.errors?.length > 0, null, { timeout: 60000 });
  await page.waitForFunction(() => document.querySelectorAll('#myStudio .tw-widget').length >= 3, null, { timeout: 30000 });
  await page.waitForTimeout(1500);
  return consoleLines;
}

export async function pageWidgets(page: Page): Promise<WidgetSnapshot> {
  return page.evaluate(() => {
    const api = (window as any).__moneyDesk.studioApi;
    const state = api.getState();
    const current = state.pages.find((p: { id: string }) => p.id === state.selectedPageId);
    // Widget config plus the widget's layout and widget-level filters (stored at page.filter.widget[id]).
    const out: Record<string, unknown> = {};
    for (const [id, widget] of Object.entries(current.widgets || {})) out[id] = { ...(widget as object), layout: current.widgetLayout?.[id], widgetFilters: current.filter?.widget?.[id] || [] };
    return JSON.parse(JSON.stringify(out));
  });
}

export async function canvasWidgetCount(page: Page) {
  return page.evaluate(() => document.querySelectorAll('#myStudio .ag-studio-layout-canvas .ag-studio-layout-widget').length);
}

/** True when `text` is rendered inside a widget frame of AG Studio's own canvas. */
export async function canvasHasText(page: Page, text: string) {
  return page.evaluate((needle) => [...document.querySelectorAll('#myStudio .ag-studio-layout-canvas .ag-studio-layout-widget')].some((el) => (el.textContent || '').includes(needle)), text);
}

export async function noOverlaysOverStudio(page: Page) {
  return page.evaluate(() => {
    const host = document.getElementById('myStudio')!;
    const offenders = [...document.body.querySelectorAll('*')].filter((el) => !host.contains(el) && el !== host && !el.contains(host) && getComputedStyle(el).position === 'absolute' && el.getBoundingClientRect().width > 0);
    return offenders.map((el) => el.outerHTML.slice(0, 120));
  });
}

async function latestThreadId(page: Page): Promise<string | undefined> {
  return page.evaluate(() => (window as any).__moneyDesk.bridgeRuns.at(-1)?.threadId);
}

/**
 * Types `prompt` into the AG Studio AI panel input and presses its Send button, then waits until the bridge
 * reports the turn finished (ROUND_END turn_complete or RUN_ERROR) and Studio has rendered.
 */
export async function askStudioPanel(page: Page, baseUrl: string, prompt: string, timeoutMs = 240000) {
  const before = await pageWidgets(page);
  const runsBefore = await page.evaluate(() => (window as any).__moneyDesk.bridgeRuns.length);
  const startedAt = new Date().toISOString();
  const input = page.locator('#myStudio textarea[aria-label="Message input"]');
  await input.click();
  await input.pressSequentially(prompt, { delay: 15 });
  await page.locator('#myStudio [aria-label="Send message"]').click();
  await page.waitForFunction((n) => (window as any).__moneyDesk.bridgeRuns.length > n, runsBefore, { timeout: 30000 });
  const threadId = await latestThreadId(page);
  assert.ok(threadId, 'the AI panel started a run through the client tool runner');
  const deadline = Date.now() + timeoutMs;
  let log: { events: Array<Record<string, unknown>>; model: string | null; modelCalls: number | null } | undefined;
  let promptSeq = 0;
  for (;;) {
    const response = await fetch(`${baseUrl}/api/studio-agent/log?threadId=${encodeURIComponent(threadId!)}`);
    log = await response.json() as typeof log;
    const events = log!.events;
    if (!promptSeq) promptSeq = Number([...events].reverse().find((e) => e.kind === 'USER_PROMPT' && e.prompt === prompt)?.seq || 0);
    const finished = promptSeq && events.some((e) => Number(e.seq) > promptSeq && (e.kind === 'RUN_ERROR' || (e.kind === 'ROUND_END' && e.reason === 'turn_complete')));
    if (finished) break;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for the Studio agent to finish "${prompt}"`);
    await page.waitForTimeout(1000);
  }
  // Let Studio apply the last events and render.
  await page.waitForTimeout(2500);
  const after = await pageWidgets(page);
  const added = Object.fromEntries(Object.entries(after).filter(([id]) => !(id in before)));
  const changed = Object.fromEntries(Object.entries(after).filter(([id, w]) => id in before && JSON.stringify(w) !== JSON.stringify(before[id])));
  const turnEvents = log!.events.filter((e) => Number(e.seq) >= promptSeq);
  const finalText = String([...turnEvents].reverse().find((e) => e.kind === 'ROUND_END' && e.reason === 'turn_complete')?.text || '');
  const panelText = await page.evaluate(() => document.querySelector('#myStudio .ag-studio-ai-panel, #myStudio [class*="ai-assistant"]')?.textContent || '');
  return { threadId: threadId!, prompt, startedAt, finishedAt: new Date().toISOString(), before, after, added, changed, turnEvents, finalText, panelText, model: log!.model, modelCallsTotal: log!.modelCalls };
}

export const fieldIds = (widget: { dataMapping?: Record<string, Array<{ id: string }>> }) => Object.values(widget.dataMapping || {}).flat().map((f) => f.id);

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { PUBLIC_DIR } from '../src/config.js';

type Layout = { xTrack: number; yTrack: number; xSpan: number; ySpan: number };
type Plan = { add: Layout; reposition: Array<{ widgetId: string; xTrack: number; xSpan: number }> };
type LayoutModule = { DEFAULT_COLUMNS: number; planPlacement(widgets: Record<string, { type: string }>, layout: Record<string, Layout>, type: string, size?: string, columns?: number): Plan };

/** Loads public/money-desk-layout.js (a browser script) the way the page does, in a sandbox with a `window`. */
function loadLayout(): LayoutModule {
  const sandbox: { window: { TillwiseLayout?: LayoutModule } } = { window: {} };
  runInNewContext(readFileSync(join(PUBLIC_DIR, 'money-desk-layout.js'), 'utf8'), sandbox);
  const layout = sandbox.window.TillwiseLayout!;
  // Objects from the sandbox have another realm's prototypes; copy them so deepStrictEqual compares plain values.
  return { DEFAULT_COLUMNS: layout.DEFAULT_COLUMNS, planPlacement: (...args) => JSON.parse(JSON.stringify(layout.planPlacement(...args))) };
}

const seededWidgets = { a: { type: 'value' }, b: { type: 'value' }, c: { type: 'refund-rate-tile' }, d: { type: 'column-chart-grouped' }, e: { type: 'grid' } };
const seededLayout: Record<string, Layout> = {
  a: { xTrack: 0, yTrack: 0, xSpan: 6, ySpan: 12 }, b: { xTrack: 6, yTrack: 0, xSpan: 6, ySpan: 12 }, c: { xTrack: 12, yTrack: 0, xSpan: 12, ySpan: 12 },
  d: { xTrack: 0, yTrack: 12, xSpan: 14, ySpan: 20 }, e: { xTrack: 14, yTrack: 12, xSpan: 10, ySpan: 20 },
};

test('place_widget layout: AG Studio default grid is 24 columns; new charts and grids take the full width below everything', () => {
  const { DEFAULT_COLUMNS, planPlacement } = loadLayout();
  assert.equal(DEFAULT_COLUMNS, 24);
  assert.deepEqual(planPlacement(seededWidgets, seededLayout, 'column-chart-grouped'), { add: { xTrack: 0, yTrack: 32, xSpan: 24, ySpan: 20 }, reposition: [] });
  assert.deepEqual(planPlacement(seededWidgets, seededLayout, 'grid', 'tall'), { add: { xTrack: 0, yTrack: 32, xSpan: 24, ySpan: 26 }, reposition: [] });
  assert.deepEqual(planPlacement(seededWidgets, seededLayout, 'owed-scoreboard', 'compact').add, { xTrack: 0, yTrack: 32, xSpan: 24, ySpan: 16 });
  assert.deepEqual(planPlacement({}, {}, 'bar-chart-grouped').add, { xTrack: 0, yTrack: 0, xSpan: 24, ySpan: 20 });
  // A page that overrides layout.columns (modes-layout.md) gets that many columns.
  assert.equal(planPlacement(seededWidgets, seededLayout, 'grid', undefined, 12).add.xSpan, 12);
  // Widgets that no longer exist do not hold space.
  assert.equal(planPlacement({ a: { type: 'value' } }, seededLayout, 'grid').add.yTrack, 12);
});

test('place_widget layout: a tile added after a full row of tiles shares it, and the row is re-split evenly', () => {
  const { planPlacement } = loadLayout();
  const widgets = { ...seededWidgets, t1: { type: 'refund-rate-tile' } };
  const layout = { ...seededLayout, t1: { xTrack: 0, yTrack: 32, xSpan: 24, ySpan: 12 } };
  const second = planPlacement(widgets, layout, 'value');
  assert.deepEqual(second, { add: { xTrack: 12, yTrack: 32, xSpan: 12, ySpan: 12 }, reposition: [{ widgetId: 't1', xTrack: 0, xSpan: 12 }] });
  const three = planPlacement({ ...widgets, t2: { type: 'value' } }, { ...layout, t1: { ...layout.t1, xSpan: 12 }, t2: { xTrack: 12, yTrack: 32, xSpan: 12, ySpan: 12 } }, 'value');
  assert.deepEqual(three, { add: { xTrack: 16, yTrack: 32, xSpan: 8, ySpan: 12 }, reposition: [{ widgetId: 't1', xTrack: 0, xSpan: 8 }, { widgetId: 't2', xTrack: 8, xSpan: 8 }] });
  // The seeded top row is not the bottom row, so a new tile does not squeeze into it.
  assert.deepEqual(planPlacement(seededWidgets, seededLayout, 'value').add, { xTrack: 0, yTrack: 32, xSpan: 24, ySpan: 12 });
  // A tile after a chart starts its own full-width row.
  const afterChart = planPlacement({ ...seededWidgets, ch: { type: 'column-chart-grouped' } }, { ...seededLayout, ch: { xTrack: 0, yTrack: 32, xSpan: 24, ySpan: 20 } }, 'refund-rate-tile');
  assert.deepEqual(afterChart, { add: { xTrack: 0, yTrack: 52, xSpan: 24, ySpan: 12 }, reposition: [] });
  // At most four tiles share a row.
  const four = Object.fromEntries(['q1', 'q2', 'q3', 'q4'].map((id, i) => [id, { xTrack: i * 6, yTrack: 32, xSpan: 6, ySpan: 12 }]));
  const fourWidgets = Object.fromEntries(Object.keys(four).map((id) => [id, { type: 'value' }]));
  assert.deepEqual(planPlacement({ ...seededWidgets, ...fourWidgets }, { ...seededLayout, ...four }, 'value').add, { xTrack: 0, yTrack: 44, xSpan: 24, ySpan: 12 });
});

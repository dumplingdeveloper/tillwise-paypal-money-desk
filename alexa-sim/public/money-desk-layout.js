/* Deterministic placement for widgets the Money Desk agent adds (used by the place_widget tool in money-desk.js).
 * AG Studio lays a page out on a track grid: 24 columns by default (theme param studioCanvasColumnsScale,
 * ag-studio/dist/types/api/theme/theme.d.ts:30) and 16px rows (studioCanvasRowHeight, theme.d.ts:31), overridable per page
 * with `layout.columns` (modes-layout.md:247). The model only picks the widget type and an optional size; the position
 * and spans come from here, so a new widget always takes the full free width below what is already on the canvas. */
(function (root) {
  'use strict';
  const DEFAULT_COLUMNS = 24;
  const MAX_TILES_PER_ROW = 4;
  const TILE_TYPES = new Set(['value', 'refund-rate-tile']);
  const HEIGHTS = {
    tile: { compact: 10, standard: 12, tall: 14 },
    chart: { compact: 16, standard: 20, tall: 26 },
    grid: { compact: 14, standard: 18, tall: 26 },
    board: { compact: 16, standard: 20, tall: 26 },
  };

  function kindOf(type) {
    if (TILE_TYPES.has(type)) return 'tile';
    if (type === 'grid' || type === 'pivot-grid') return 'grid';
    if (type === 'owed-scoreboard' || type === 'dispute-countdown') return 'board';
    return 'chart';
  }

  /** Split `columns` into `n` spans that differ by at most one track. */
  function split(columns, n) {
    const base = Math.floor(columns / n);
    return Array.from({ length: n }, (_, i) => base + (i < columns - base * n ? 1 : 0));
  }

  /**
   * @param widgets  page.widgets from api.getState()
   * @param layout   page.widgetLayout from api.getState()
   * @param type     widget type to add
   * @param size     'compact' | 'standard' | 'tall' (optional)
   * @param columns  page layout columns (page.layout.columns, default 24)
   * @returns {{ add: {xTrack,yTrack,xSpan,ySpan}, reposition: Array<{widgetId,xTrack,xSpan}> }}
   * New widgets go in a new row below everything, spanning every column. The one exception keeps KPI tiles
   * compact: a tile added right after other tiles that already fill the bottom row shares that row, and the
   * row's tiles are re-split evenly (via AgPositionWidgetCommand) so the row still uses the full width.
   */
  function planPlacement(widgets, layout, type, size, columns) {
    const cols = Number(columns) > 0 ? Number(columns) : DEFAULT_COLUMNS;
    const kind = kindOf(type);
    const ySpan = HEIGHTS[kind][size] || HEIGHTS[kind].standard;
    const entries = Object.entries(layout || {})
      .filter(([id, l]) => widgets && widgets[id] && l && Number.isFinite(l.yTrack) && Number.isFinite(l.ySpan))
      .map(([id, l]) => ({ id, type: widgets[id].type, xTrack: l.xTrack || 0, yTrack: l.yTrack, xSpan: l.xSpan || 0, ySpan: l.ySpan }));
    const bottom = entries.reduce((max, l) => Math.max(max, l.yTrack + l.ySpan), 0);

    if (kind === 'tile' && entries.length) {
      const row = entries.filter((l) => l.yTrack + l.ySpan === bottom);
      const top = row[0].yTrack;
      const overlapping = entries.filter((l) => l.yTrack < bottom && l.yTrack + l.ySpan > top);
      const shareable = row.length < MAX_TILES_PER_ROW
        && overlapping.length === row.length
        && row.every((l) => kindOf(l.type) === 'tile' && l.yTrack === top && l.ySpan === row[0].ySpan)
        && row.reduce((t, l) => t + l.xSpan, 0) === cols;
      if (shareable) {
        const spans = split(cols, row.length + 1);
        const ordered = [...row].sort((a, b) => a.xTrack - b.xTrack);
        let x = 0;
        const reposition = ordered.map((l, i) => { const out = { widgetId: l.id, xTrack: x, xSpan: spans[i] }; x += spans[i]; return out; });
        return { add: { xTrack: x, yTrack: top, xSpan: spans[spans.length - 1], ySpan: row[0].ySpan }, reposition };
      }
    }
    return { add: { xTrack: 0, yTrack: bottom, xSpan: cols, ySpan }, reposition: [] };
  }

  root.TillwiseLayout = { DEFAULT_COLUMNS, HEIGHTS, kindOf, planPlacement };
})(typeof window !== 'undefined' ? window : globalThis);

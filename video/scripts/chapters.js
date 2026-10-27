// YouTube chapters from a composed video's timeline, so the upload text is computed, not typed by hand.
// Usage: node scripts/chapters.js --timeline out/<video>.timeline.json --scene scenes/<scene>.json
// The scene lists chapters as { "title", "startsWith" }: each chapter starts at the timeline entry whose text starts
// with `startsWith` (the first chapter is always 0:00). Times are rounded down to whole seconds.
// YouTube's rules (support.google.com/youtube/answer/9884579): first timestamp 00:00, at least three timestamps in
// ascending order, each chapter at least 10 seconds long.
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { parseArgs } from './common.js';

export function formatTime(seconds) {
  const s = Math.floor(seconds);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export function computeChapters(timeline, durationSeconds, chapters) {
  if (!Array.isArray(chapters) || chapters.length < 3) throw new Error('Need at least three chapters.');
  const rows = chapters.map((c, i) => {
    if (i === 0) return { title: c.title, start: 0 };
    const hit = timeline.find((t) => String(t.text || '').startsWith(c.startsWith));
    if (!hit) throw new Error(`No timeline entry starts with "${c.startsWith}" (chapter "${c.title}").`);
    return { title: c.title, start: Math.floor(hit.start) };
  });
  for (let i = 0; i < rows.length; i++) {
    const end = i + 1 < rows.length ? rows[i + 1].start : durationSeconds;
    if (i > 0 && rows[i].start <= rows[i - 1].start) throw new Error(`Chapter "${rows[i].title}" is not after "${rows[i - 1].title}".`);
    if (end - rows[i].start < 10) throw new Error(`Chapter "${rows[i].title}" is ${(end - rows[i].start).toFixed(1)} s; YouTube needs at least 10 s.`);
    rows[i].length = Number((end - rows[i].start).toFixed(1));
  }
  return rows;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = parseArgs();
  const report = JSON.parse(fs.readFileSync(String(args.timeline), 'utf8'));
  const scene = JSON.parse(fs.readFileSync(String(args.scene), 'utf8'));
  const rows = computeChapters(report.timeline, report.durationSeconds, scene.chapters);
  for (const r of rows) console.log(`${formatTime(r.start)} ${r.title}`);
  console.error(`(${rows.length} chapters; shortest ${Math.min(...rows.map((r) => r.length))} s; video ${report.durationSeconds} s)`);
}

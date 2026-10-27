import test from 'node:test';
import assert from 'node:assert/strict';
import { computeChapters, formatTime } from '../scripts/chapters.js';

const timeline = [
  { start: 4.38, text: 'If you run a small WooCommerce shop on …' },
  { start: 26.81, text: 'Refund order 474.' },
  { start: 44.75, text: 'Money never moves on a guess. The refun…' },
  { start: 97.22, text: 'This is the Money Desk, built inside AG…' },
];
const chapters = [
  { title: 'Intro', startsWith: '' },
  { title: 'Refund', startsWith: 'Refund order' },
  { title: 'Gate', startsWith: 'Money never moves' },
  { title: 'Desk', startsWith: 'This is the Money Desk' },
];

test('chapters: first is 0:00, the rest start at their timeline entry, rounded down', () => {
  const rows = computeChapters(timeline, 171.6, chapters);
  assert.deepEqual(rows.map((r) => [formatTime(r.start), r.title]), [['00:00', 'Intro'], ['00:26', 'Refund'], ['00:44', 'Gate'], ['01:37', 'Desk']]);
  assert.equal(rows.at(-1).length, 74.6);
});

test('chapters: YouTube rules are enforced (10 s minimum, at least three, every anchor found)', () => {
  assert.throws(() => computeChapters(timeline, 105, chapters), /at least 10 s/);
  assert.throws(() => computeChapters(timeline, 171.6, chapters.slice(0, 2)), /at least three/);
  assert.throws(() => computeChapters(timeline, 171.6, [...chapters, { title: 'X', startsWith: 'Nope' }]), /No timeline entry/);
});

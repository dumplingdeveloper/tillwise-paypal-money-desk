import test from 'node:test';
import assert from 'node:assert/strict';
import { captionText, speakerLabel, splitCaption, wrapCaption } from '../scripts/captions.js';

test('the narrator caption has no speaker label; other voices keep theirs', () => {
  assert.equal(captionText(speakerLabel({ voice: 'NARRATOR' }), 'Hello.'), 'Hello.');
  assert.equal(captionText(speakerLabel({ voice: 'OWNER' }), 'Refund order 360.'), 'Owner: Refund order 360.');
  assert.equal(captionText(speakerLabel({ role: 'host' }), 'Refund €31.00?'), 'Host: Refund €31.00?');
  assert.equal(captionText(speakerLabel({ role: 'assistant' }), 'Done.'), 'Assistant: Done.');
});

test('captions break at sentence and clause boundaries, not mid-phrase', () => {
  const text = 'This is the Money Desk, built inside AG Studio. Built-in charts and grids sit next to three custom widgets: refund rate, who still owes us, and dispute deadlines. The rows come through our MCP server from the PayPal tools, here on the mock ledger.';
  const segments = splitCaption(text, 2, 34);
  assert.deepEqual(segments, [
    'This is the Money Desk, built inside AG Studio.',
    'Built-in charts and grids sit next to three custom widgets:',
    'refund rate, who still owes us, and dispute deadlines.',
    'The rows come through our MCP server from the PayPal tools,',
    'here on the mock ledger.',
  ]);
  assert.equal(segments.join(' '), text, 'no words lost or reordered');
  for (const s of segments) {
    assert.ok(wrapCaption(s, 34).length <= 2, s);
    assert.match(s, /[.,:;!?]$/, `ends at a boundary: ${s}`);
  }
  assert.ok(!segments.some((s) => s.endsWith('who still')));
});

test('a single clause longer than a card is the only case split between words', () => {
  const long = 'one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen';
  const segments = splitCaption(long, 2, 20);
  assert.equal(segments.join(' '), long);
  assert.ok(segments.length > 1 && segments.every((s) => wrapCaption(s, 20).length <= 2));
  assert.deepEqual(splitCaption('Yes.', 2, 34), ['Yes.']);
  assert.deepEqual(splitCaption('', 2, 34), ['']);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { speakableText } from '../scripts/speakable.js';

test('money is spoken as words, never as the letters EUR', () => {
  const cases = [
    ['The refund preview is ready for EUR 31.00. Say yes to move the money.', 'The refund preview is ready for 31 euros. Say yes to move the money.'],
    ['Refund of EUR 31 for order 360 completed.', 'Refund of 31 euros for order 360 completed.'],
    ['Stoneware Mug Set €2,083.77 (93.2% of refunded €)', 'Stoneware Mug Set 2,083 euros and 77 cents (93.2% of refunded €)'],
    ['€1 and €0.01 and €12.5', '1 euro and 0 euros and 1 cent and 12 euros and 50 cents'],
    ['31.00 EUR left', '31 euros left'],
    ['$12.50 or USD 3', '12 dollars and 50 cents or 3 dollars'],
    ['£4.99', '4 pounds and 99 pence'],
    ['Amounts are in EUR.', 'Amounts are in euros.'],
    ['Refund €31.00 for order 360 through PayPal?', 'Refund 31 euros for order 360 through PayPal?'],
    ['Order 360 has 34.9% refunds in 2026.', 'Order 360 has 34.9% refunds in 2026.'],
  ];
  for (const [input, spoken] of cases) assert.equal(speakableText(input), spoken, input);
  assert.equal(speakableText(undefined), '');
  for (const [input] of cases) assert.doesNotMatch(speakableText(input), /\bEUR\b|€\s?\d/);
});

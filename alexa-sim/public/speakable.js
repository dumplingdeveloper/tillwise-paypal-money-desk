// Speakable text for TTS. Captions and the UI keep the original text; only the synthesized audio uses this.
// Kept byte-identical to alexa-sim/public/speakable.js (the voice sim's browser TTS); a test checks that.

const CURRENCIES = {
  EUR: { one: 'euro', many: 'euros', cent: 'cent', cents: 'cents' },
  USD: { one: 'dollar', many: 'dollars', cent: 'cent', cents: 'cents' },
  GBP: { one: 'pound', many: 'pounds', cent: 'penny', cents: 'pence' },
};
const SYMBOLS = { '€': 'EUR', $: 'USD', '£': 'GBP' };
const AMOUNT = String.raw`\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?`;
const CODES = Object.keys(CURRENCIES).join('|');

/** "2,083.77" + EUR → "2,083 euros and 77 cents"; "31.00" → "31 euros"; "1" → "1 euro". */
function spokenAmount(amount, code) {
  const names = CURRENCIES[code];
  const [whole, fraction = ''] = amount.split('.');
  const cents = fraction ? Math.round(Number(`0.${fraction}`) * 100) : 0;
  const unit = whole === '1' ? names.one : names.many;
  if (!cents) return `${whole} ${unit}`;
  return `${whole} ${unit} and ${cents} ${cents === 1 ? names.cent : names.cents}`;
}

export function speakableText(text) {
  return String(text ?? '')
    .replace(new RegExp(String.raw`(?<![\w.])(${CODES})\s?(${AMOUNT})(?![\d])`, 'g'), (_, code, amount) => spokenAmount(amount, code))
    .replace(new RegExp(String.raw`(?<![\w.,])(${AMOUNT})\s?(${CODES})\b`, 'g'), (_, amount, code) => spokenAmount(amount, code))
    .replace(new RegExp(String.raw`([€$£])\s?(${AMOUNT})(?![\d])`, 'g'), (_, symbol, amount) => spokenAmount(amount, SYMBOLS[symbol]))
    .replace(new RegExp(String.raw`\b(${CODES})\b`, 'g'), (code) => CURRENCIES[code].many);
}

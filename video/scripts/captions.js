// Caption text helpers for compose.js (pure functions, unit-tested in test/captions.test.js).

/** Speaker prefix for a caption. The narrator gets none; owner, assistant and host keep theirs because several voices alternate. */
export function speakerLabel(event) {
  const role = String(event.role || event.voice || '').toLowerCase();
  if (role === 'owner') return 'Owner';
  if (role === 'narrator') return '';
  if (role === 'host') return 'Host';
  return 'Assistant';
}

export function captionText(label, text) {
  return label ? `${label}: ${text}` : text;
}

export function wrapCaption(text, maxChars = 44) {
  const words = String(text).trim().split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > maxChars && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

const fits = (text, maxLines, maxChars) => wrapCaption(text, maxChars).length <= maxLines;

// Sentence ends, then clause boundaries (comma, colon, semicolon, dash). The punctuation stays with the left part.
const splitSentences = (text) => String(text).trim().split(/(?<=[.!?])\s+(?=\S)/).filter(Boolean);
const splitClauses = (sentence) => sentence.split(/(?<=[,:;])\s+|\s+(?=[—–]\s)/).filter(Boolean);

function splitWords(text, maxLines, maxChars) {
  const segments = [];
  let current = [];
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const candidate = [...current, word].join(' ');
    if (current.length && !fits(candidate, maxLines, maxChars)) {
      segments.push(current.join(' '));
      current = [word];
    } else {
      current.push(word);
    }
  }
  if (current.length) segments.push(current.join(' '));
  return segments;
}

const wordCount = (text) => text.split(/\s+/).filter(Boolean).length;
const isShort = (clause) => wordCount(clause) <= 2;

/**
 * Splits speech into caption cards of at most `maxLines` wrapped lines. Cards break at sentence ends first, then at
 * clause boundaries; a single clause longer than a card is the only case that breaks between arbitrary words.
 * Within a sentence the fewest cards win, and a break that leaves a list hanging ("…on PayPal, refunds, | disputes…",
 * i.e. after a short list item that follows a longer clause on the same card) costs as much as one extra card.
 */
export function splitCaption(text, maxLines = 2, maxChars = 44) {
  const segments = [];
  for (const sentence of splitSentences(text)) {
    if (fits(sentence, maxLines, maxChars)) { segments.push(sentence); continue; }
    const units = splitClauses(sentence).flatMap((clause) => (fits(clause, maxLines, maxChars) ? [clause] : splitWords(clause, maxLines, maxChars)));
    // best[i] = cheapest split of units[0..i): { cost, longest, cards }
    const best = [{ cost: 0, longest: 0, cards: [] }];
    for (let end = 1; end <= units.length; end += 1) {
      let choice = null;
      for (let start = end - 1; start >= 0; start -= 1) {
        const card = units.slice(start, end).join(' ');
        if (!fits(card, maxLines, maxChars)) break;
        const prev = best[start];
        const last = units[end - 1];
        const hanging = end < units.length && isShort(last) && end - start >= 2 && !isShort(units[end - 2]);
        const cost = prev.cost + 1 + (hanging ? 1 : 0);
        const longest = Math.max(prev.longest, card.length);
        if (!choice || cost < choice.cost || (cost === choice.cost && longest < choice.longest)) choice = { cost, longest, cards: [...prev.cards, card] };
      }
      best[end] = choice;
    }
    segments.push(...best[units.length].cards);
  }
  return segments.length ? segments : [''];
}

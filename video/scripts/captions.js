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

/**
 * Splits speech into caption cards of at most `maxLines` wrapped lines. Cards break at sentence ends first, then at
 * clause boundaries; a single clause longer than a card is the only case that breaks between arbitrary words.
 */
export function splitCaption(text, maxLines = 2, maxChars = 44) {
  const segments = [];
  for (const sentence of splitSentences(text)) {
    if (fits(sentence, maxLines, maxChars)) { segments.push(sentence); continue; }
    let current = '';
    for (const clause of splitClauses(sentence)) {
      const candidate = current ? `${current} ${clause}` : clause;
      if (fits(candidate, maxLines, maxChars)) { current = candidate; continue; }
      if (current) segments.push(current);
      if (fits(clause, maxLines, maxChars)) { current = clause; continue; }
      const parts = splitWords(clause, maxLines, maxChars);
      current = parts.pop() || '';
      segments.push(...parts);
    }
    if (current) segments.push(current);
  }
  return segments.length ? segments : [''];
}

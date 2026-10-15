/** A character in a ProseMirror document, with the position of that character. */
export type TextChar = { ch: string; pos: number };

type TextNode = { isText: boolean; text?: string | null };
type DocLike = {
  descendants: (f: (node: TextNode, pos: number) => void) => void;
};

export function charsInDoc(doc: DocLike): TextChar[] {
  const chars: TextChar[] = [];
  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;
    for (let i = 0; i < node.text.length; i++) chars.push({ ch: node.text[i], pos: pos + i });
  });
  return chars;
}

export type QuoteSpan = { from: number; to: number };

/**
 * Find a quote inside flattened chapter text.
 * Exact match first, then the same words with line breaks collapsed.
 */
export function locateQuote(chars: TextChar[], quote: string): QuoteSpan | null {
  const needleRaw = quote.trim();
  if (needleRaw.replace(/\s+/g, "").length < 8) return null;
  const raw = chars.map((c) => c.ch).join("");
  const exact = raw.indexOf(needleRaw);
  if (exact >= 0) return span(chars, exact, needleRaw.length);

  const squashed = squash(raw);
  const needle = needleRaw.replace(/\s+/g, " ").trim();
  const at = squashed.text.indexOf(needle);
  if (at < 0) return null;
  const start = squashed.map[at];
  const end = squashed.map[at + needle.length - 1];
  if (start == null || end == null) return null;
  return span(chars, start, end - start + 1);
}

function span(chars: TextChar[], start: number, length: number): QuoteSpan | null {
  const slice = chars.slice(start, start + length);
  if (!slice.length) return null;
  return { from: slice[0].pos, to: slice[slice.length - 1].pos + 1 };
}

function squash(raw: string): { text: string; map: number[] } {
  let text = "";
  const map: number[] = [];
  let gap = false;
  for (let i = 0; i < raw.length; i++) {
    if (/\s/.test(raw[i])) {
      gap = text.length > 0;
      continue;
    }
    if (gap) {
      text += " ";
      map.push(i);
      gap = false;
    }
    text += raw[i];
    map.push(i);
  }
  return { text, map };
}

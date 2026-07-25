import type { VerifiedCitation } from "./citations";
import { fetchOpinionText } from "./analyze";

export type QuoteStatus = "found" | "altered" | "missing" | "unchecked";

export interface QuoteCheck {
  quote: string;
  status: QuoteStatus;
  /** 0-1 similarity of the closest passage in the opinion. */
  similarity: number;
  /** The passage the opinion actually contains, when it differs. */
  actual: string | null;
  note: string;
}

/**
 * Straight and curly quote pairs. Anything under 40 characters is skipped: a
 * brief quoting a two-word term of art is not making a checkable claim, and
 * short strings match by accident.
 */
const QUOTED = /["“]([^"“”]{40,600})["”]/g;
const MIN_WORDS = 6;

/** Lowercase letters, digits and single spaces - nothing else survives. */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function trigrams(s: string): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i + 3 <= s.length; i++) out.add(s.slice(i, i + 3));
  return out;
}

/** Dice coefficient over character trigrams: tolerant of OCR letter noise. */
function similarity(a: string, b: string): number {
  const A = trigrams(a);
  const B = trigrams(b);
  if (!A.size || !B.size) return 0;
  let shared = 0;
  for (const t of A) if (B.has(t)) shared++;
  return (2 * shared) / (A.size + B.size);
}

/**
 * Scoring every window of the opinion with Dice is far too slow on a 100k
 * character text, so a rolling count of how many of the quote's words appear in
 * each window narrows it to a handful of candidates first.
 */
function bestWindow(haystack: string[], needle: string[]): string {
  const want = new Map<string, number>();
  for (const w of needle) want.set(w, (want.get(w) ?? 0) + 1);

  const size = needle.length;
  if (haystack.length <= size) return haystack.join(" ");

  const seen = new Map<string, number>();
  let hits = 0;
  const add = (w: string, d: number) => {
    const n = (seen.get(w) ?? 0) + d;
    seen.set(w, n);
    const target = want.get(w) ?? 0;
    if (d > 0 && n <= target) hits++;
    if (d < 0 && n < target) hits--;
  };

  const scores: { start: number; hits: number }[] = [];
  for (let i = 0; i < haystack.length; i++) {
    add(haystack[i], 1);
    if (i >= size) add(haystack[i - size], -1);
    if (i >= size - 1) scores.push({ start: i - size + 1, hits });
  }

  // Dice is the expensive part, so it only runs on the best few candidates.
  return scores
    .sort((a, b) => b.hits - a.hits)
    .slice(0, 8)
    .map((s) => haystack.slice(s.start, s.start + size).join(" "))
    .reduce(
      (best, w) =>
        similarity(w, needle.join(" ")) > similarity(best, needle.join(" "))
          ? w
          : best,
      "",
    );
}

/**
 * A quote with "..." in the middle is really several quotes. The split has to
 * happen before normalising, because normalising strips the dots that mark it.
 */
const parts = (quote: string) =>
  quote
    .split(/\s*(?:\.\s*){3,}\s*|\s*…\s*/)
    .map(normalize)
    .filter((p) => p.split(" ").length >= 3);

export interface QuoteMatch {
  status: QuoteStatus;
  similarity: number;
  actual: string | null;
}

export function matchQuote(quote: string, opinionText: string): QuoteMatch {
  const hay = normalize(opinionText);
  const segments = parts(quote);
  if (!segments.length) return { status: "unchecked", similarity: 0, actual: null };

  // Only an exact match earns "found". Similarity scores cannot be trusted to
  // wave a quote through: dropping "not" into a long sentence reverses the
  // holding while barely moving the score. Normalising away case, punctuation
  // and whitespace is as much benefit of the doubt as the text can safely give.
  if (segments.every((s) => hay.includes(s)))
    return { status: "found", similarity: 1, actual: null };

  const hayWords = hay.split(" ");
  let worst = { sim: 1, actual: "" };
  for (const seg of segments) {
    const window = bestWindow(hayWords, seg.split(" "));
    const sim = similarity(window, seg);
    if (sim < worst.sim) worst = { sim, actual: window };
  }

  // A near miss is a wording change worth reading. Only a quote with no
  // resemblance to anything in the opinion is called invented.
  const status = worst.sim >= 0.55 ? "altered" : "missing";
  return { status, similarity: worst.sim, actual: worst.actual };
}

/**
 * Quotes belong to the citation that follows them - "the Court held that
 * 'X.' Miranda, 384 U.S. at 444" - so each quote attaches to the next citation
 * within reach, falling back to the one just before it.
 */
export function quotesFor(
  text: string,
  cites: { index: number; raw: string }[],
): Map<number, string[]> {
  const out = new Map<number, string[]>();
  const REACH = 400;

  for (const m of text.matchAll(QUOTED)) {
    const quote = m[1].trim();
    if (quote.split(/\s+/).length < MIN_WORDS) continue;

    const end = m.index + m[0].length;
    let pick = -1;
    let bestGap = REACH;

    cites.forEach((c, i) => {
      const gap = c.index >= end ? c.index - end : end - (c.index + c.raw.length);
      if (gap >= 0 && gap < bestGap) {
        bestGap = gap;
        pick = i;
      }
    });

    if (pick >= 0) out.set(pick, [...(out.get(pick) ?? []), quote]);
  }
  return out;
}

export async function checkQuotes(
  c: VerifiedCitation,
  quotes: string[],
): Promise<QuoteCheck[]> {
  if (!quotes.length) return [];

  const unchecked = (note: string) =>
    quotes.map((quote) => ({
      quote,
      status: "unchecked" as const,
      similarity: 0,
      actual: null,
      note,
    }));

  if (c.verdict === "fabricated" || c.verdict === "error")
    return unchecked("There is no opinion to read.");

  const opinion = await fetchOpinionText(c);
  if (!opinion)
    return unchecked(
      "The full text of this case is not in the free Caselaw Access Project mirror.",
    );

  return quotes.map((quote) => {
    const m = matchQuote(quote, opinion);
    const note =
      m.status === "found"
        ? "This wording appears in the opinion."
        : m.status === "altered"
          ? "Close to the opinion, but the wording differs - check it before filing."
          : "This wording does not appear anywhere in the opinion.";

    return { quote, status: m.status, similarity: m.similarity, actual: m.actual, note };
  });
}

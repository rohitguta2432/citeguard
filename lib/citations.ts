export type Verdict = "verified" | "fabricated" | "misattributed" | "error";

/** "id" and "supra" are back-references to a case cited earlier in the brief. */
export type CitationKind = "full" | "short" | "id" | "supra";

export interface ParsedCitation {
  raw: string;
  volume: string;
  reporter: string;
  page: string;
  claimedCase: string | null;
  context: string;
  index: number;
  pinCite: string | null;
  kind: CitationKind;
}

export interface VerifiedCitation extends ParsedCitation {
  verdict: Verdict;
  resolvedCase: string | null;
  opinionUrl: string | null;
  opinionId: string | null;
  note: string;
}

// Longest-first so "F. Supp. 2d" wins over "F." in the alternation.
const REPORTERS = [
  "U.S.",
  "S. Ct.",
  "L. Ed. 2d",
  "L. Ed.",
  "F. Supp. 3d",
  "F. Supp. 2d",
  "F. Supp.",
  "F.4th",
  "F.3d",
  "F.2d",
  "F.",
  "F.R.D.",
  "Fed. Appx.",
  "A.3d",
  "A.2d",
  "N.E.3d",
  "N.E.2d",
  "N.W.3d",
  "N.W.2d",
  "P.3d",
  "P.2d",
  "S.E.2d",
  "S.W.3d",
  "S.W.2d",
  "So. 3d",
  "So. 2d",
  "Cal. Rptr. 3d",
  "Cal. Rptr. 2d",
  "N.Y.S.3d",
  "N.Y.S.2d",
  "B.R.",
  "T.C.",
].sort((a, b) => b.length - a.length);

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const alternation = REPORTERS.map((r) =>
  r.split(/\s+/).map(escape).join("\\s+"),
).join("|");

const CITATION_RE = new RegExp(
  `\\b(\\d{1,4})\\s+(${alternation})\\s+(\\d{1,5})\\b`,
  "g",
);

// Matches "Smith v. Jones," / "United States v. Nixon," ending right at the citation.
const CASE_NAME_RE =
  /([A-Z][A-Za-z.'’&-]*(?:\s+[A-Za-z.'’&-]+){0,6}\s+v\.?\s+[A-Z][A-Za-z.'’&-]*(?:\s+[A-Za-z.'’&-]+){0,6})\s*,\s*$/;

// Lowercase words that legitimately sit inside a party name.
const JOINERS = new Set([
  "of", "the", "and", "for", "ex", "rel", "et", "al", "de", "la", "van", "von",
]);

// Words that introduce a citation and get swept up because they start a sentence.
const LEAD_INS = new Set([
  "see", "also", "accord", "cf", "but", "citing", "quoting", "compare",
  "contra", "under", "generally", "eg", "id", "supra", "in", "from",
  "following", "applying", "adopting", "held", "explained", "that",
]);

const bare = (w: string) => w.toLowerCase().replace(/[^a-z]/g, "");
const isNameWord = (w: string) => /^[A-Z]/.test(w) || JOINERS.has(bare(w));

/**
 * A party name is a run of capitalised words and small joiners. Scanning
 * right-to-left from "v." stops at the first ordinary prose word, which strips
 * lead-ins like "That principle was reaffirmed in".
 */
function cleanParty(words: string[]): string[] {
  let start = words.length;
  while (start > 0 && isNameWord(words[start - 1])) start--;
  const out = words.slice(start);
  // "See United States v. Nixon" - the lead-in is capitalised only because it
  // starts a sentence, so the right-to-left scan cannot see where it ends.
  while (out.length > 1 && (LEAD_INS.has(bare(out[0])) || /^[a-z]/.test(out[0])))
    out.shift();
  return out;
}

function cleanCaseName(raw: string): string | null {
  const parts = raw.split(/\s+v\.?\s+/);
  if (parts.length < 2) return null;

  const plaintiff = cleanParty(parts[0].split(/\s+/));
  const defWords = parts.slice(1).join(" v. ").split(/\s+/);
  let end = 0;
  while (end < defWords.length && isNameWord(defWords[end])) end++;
  const defendant = defWords.slice(0, end);

  if (!plaintiff.length || !defendant.length) return null;
  return `${plaintiff.join(" ")} v. ${defendant.join(" ")}`;
}

const STOP = new Set([
  "the", "and", "for", "inc", "llc", "ltd", "corp", "co", "company", "of", "in",
  "re", "ex", "rel", "et", "al", "city", "county", "state", "states", "united",
  "board", "department", "dept", "commission", "district", "school", "national",
]);

const contextAround = (text: string, index: number, length: number) =>
  text.slice(Math.max(0, index - 300), index + length + 300).trim();

export function extractCitations(text: string): ParsedCitation[] {
  const out: ParsedCitation[] = [];
  for (const m of text.matchAll(CITATION_RE)) {
    const index = m.index;
    const before = text.slice(Math.max(0, index - 160), index);
    const nameMatch = before.match(CASE_NAME_RE);
    // "550 U.S. 544, 570" - the number after the comma is the pinpoint page.
    const pin = text.slice(index + m[0].length).match(/^,\s*(\d{1,5})\b/);
    out.push({
      raw: m[0],
      volume: m[1],
      reporter: m[2].replace(/\s+/g, " "),
      page: m[3],
      claimedCase: nameMatch ? cleanCaseName(nameMatch[1].trim()) : null,
      context: contextAround(text, index, m[0].length),
      index,
      pinCite: pin ? pin[1] : null,
      kind: "full",
    });
  }
  return out;
}

export type Extractor = "eyecite" | "builtin";

const SERVICE =
  process.env.CITEGUARD_EXTRACTOR ?? "http://127.0.0.1:4623";

/**
 * The Python service understands every reporter in the Bluebook and resolves
 * "Id." and "supra" back to the case they point at. It is optional: when it is
 * not running the built-in regex above handles the ordinary full citations, so
 * CiteGuard still works with nothing installed but Node.
 */
export async function extractWithService(
  text: string,
): Promise<{ citations: ParsedCitation[]; extractor: Extractor }> {
  try {
    const res = await fetch(`${SERVICE}/extract`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(String(res.status));

    const data = (await res.json()) as { citations: Partial<ParsedCitation>[] };
    const citations = data.citations
      // A short form the service could not tie to a full citation has no
      // volume or page. There is nothing to look up, so drop it rather than
      // guess at a reporter page that would 404 and look fabricated.
      .filter((c) => c.volume && c.reporter && c.page)
      .map((c) => ({
        raw: c.raw!,
        volume: c.volume!,
        reporter: c.reporter!,
        page: c.page!,
        claimedCase: c.claimedCase ?? null,
        context: contextAround(text, c.index ?? 0, c.raw?.length ?? 0),
        index: c.index ?? 0,
        pinCite: c.pinCite?.replace(/^at\s+/, "") ?? null,
        kind: c.kind ?? "full",
      }));
    return { citations, extractor: "eyecite" };
  } catch {
    return { citations: extractCitations(text), extractor: "builtin" };
  }
}

export function slugToCaseName(slug: string): string {
  return slug
    .split("-")
    .map((w, i) => {
      if (w === "v") return "v.";
      if (i > 0 && JOINERS.has(w)) return w;
      return w.charAt(0).toUpperCase() + w.slice(1);
    })
    .join(" ");
}

function significantTokens(name: string): Set<string> {
  return new Set(
    name
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length >= 3 && !STOP.has(t)),
  );
}

/**
 * Zero overlap between the party names means the brief pinned a real citation
 * to the wrong case. Partial overlap is left alone - CourtListener slugs are
 * often abbreviated, and a false "misattributed" is worse than a miss.
 */
export function namesDisagree(claimed: string, resolved: string): boolean {
  const a = significantTokens(claimed);
  const b = significantTokens(resolved);
  if (a.size === 0 || b.size === 0) return false;
  for (const t of a) if (b.has(t)) return false;
  return true;
}

const UA = "CiteGuard/0.1 (+https://github.com/rohitguta2432/citeguard)";

export async function verifyCitation(
  c: ParsedCitation,
): Promise<VerifiedCitation> {
  const url = `https://www.courtlistener.com/c/${encodeURIComponent(
    c.reporter,
  )}/${c.volume}/${c.page}/`;

  const base = { ...c, resolvedCase: null, opinionUrl: null, opinionId: null };

  let res: Response | null = null;
  for (let attempt = 0; attempt < 2 && !res; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, 600));
    try {
      res = await fetch(url, {
        redirect: "follow",
        headers: { "User-Agent": UA },
        signal: AbortSignal.timeout(20000),
      });
    } catch {
      res = null;
    }
  }

  if (!res) {
    return { ...base, verdict: "error", note: "Could not reach CourtListener." };
  }

  const hit = res.url.match(/\/opinion\/(\d+)\/([^/]+)\//);
  if (!hit) {
    // Only a real 404 proves absence. A challenge page, a rate-limit or a 5xx
    // must never be reported as a fabricated citation.
    if (res.status !== 404) {
      return {
        ...base,
        verdict: "error",
        note: `CourtListener answered ${res.status} instead of a case page - not checked.`,
      };
    }
    return {
      ...base,
      verdict: "fabricated",
      note: "No case exists at this citation in CourtListener's database.",
    };
  }

  const resolvedCase = slugToCaseName(hit[2]);
  const resolved = {
    ...base,
    resolvedCase,
    opinionId: hit[1],
    opinionUrl: `https://www.courtlistener.com/opinion/${hit[1]}/${hit[2]}/`,
  };

  if (c.claimedCase && namesDisagree(c.claimedCase, resolvedCase)) {
    return {
      ...resolved,
      verdict: "misattributed",
      note: `This citation is real, but it points to ${resolvedCase}, not ${c.claimedCase}.`,
    };
  }

  return { ...resolved, verdict: "verified", note: `Resolves to ${resolvedCase}.` };
}

export async function verifyAll(
  cites: ParsedCitation[],
  onResult?: (index: number, result: VerifiedCitation) => void,
  concurrency = 4,
): Promise<VerifiedCitation[]> {
  const results: VerifiedCitation[] = new Array(cites.length);
  let next = 0;
  const cache = new Map<string, Promise<VerifiedCitation>>();

  async function worker() {
    while (next < cites.length) {
      const i = next++;
      const c = cites[i];
      const key = `${c.volume}|${c.reporter}|${c.page}`;
      let p = cache.get(key);
      if (!p) {
        p = verifyCitation(c);
        cache.set(key, p);
      }
      const r = await p;
      // Case name is per-occurrence, so re-run the mismatch check on the cached result.
      const mismatch =
        r.resolvedCase != null &&
        c.claimedCase != null &&
        namesDisagree(c.claimedCase, r.resolvedCase);
      results[i] = mismatch
        ? {
            ...r,
            ...c,
            verdict: "misattributed",
            note: `This citation is real, but it points to ${r.resolvedCase}, not ${c.claimedCase}.`,
          }
        : { ...r, ...c };
      onResult?.(i, results[i]);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, cites.length) }, worker),
  );
  return results;
}

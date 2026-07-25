import type { VerifiedCitation } from "./citations";

export type ClaimStatus = "supports" | "contradicts" | "unclear" | "unavailable";

export interface ClaimCheck {
  status: ClaimStatus;
  explanation: string;
  quote: string | null;
}

const OLLAMA = process.env.OLLAMA_HOST ?? "http://localhost:11434";
const MODEL = process.env.CITEGUARD_MODEL ?? "qwen2.5:14b";

/** "F. Supp. 2d" -> "f-supp-2d", "U.S." -> "us", "F.3d" -> "f3d". */
export function reporterSlug(reporter: string): string {
  return reporter.replace(/\./g, "").trim().toLowerCase().replace(/\s+/g, "-");
}

/**
 * Full opinion text from the Caselaw Access Project static mirror - no key, no
 * signup. Coverage ends around 2020, so recent cases return null.
 *
 * The head matter is included because briefs quote the syllabus and the
 * headnotes as freely as the opinion itself, and a quote checker that only
 * read the opinion body would call those real quotes missing.
 */
export async function fetchOpinionText(
  c: Pick<VerifiedCitation, "reporter" | "volume" | "page">,
): Promise<string | null> {
  const url = `https://static.case.law/${reporterSlug(c.reporter)}/${
    c.volume
  }/cases/${c.page.padStart(4, "0")}-01.json`;

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (!res.ok) return null;
    const data = await res.json();
    const opinions: { text?: string }[] = data?.casebody?.opinions ?? [];
    const text = [
      data?.casebody?.head_matter ?? "",
      ...opinions.map((o) => o.text ?? ""),
    ]
      .join("\n\n")
      .trim();
    return text || null;
  } catch {
    return null;
  }
}

function tokens(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 3),
  );
}

/**
 * Opinions run past 100k characters, far beyond a local model's useful window.
 * Ranking fixed-size chunks by word overlap with the claim is enough to surface
 * the passage a brief would be leaning on.
 */
export function relevantExcerpt(opinion: string, claim: string, take = 4): string {
  const size = 1200;
  const chunks: string[] = [];
  for (let i = 0; i < opinion.length; i += size)
    chunks.push(opinion.slice(i, i + size));

  const want = tokens(claim);
  return chunks
    .map((text, i) => {
      let score = 0;
      for (const t of tokens(text)) if (want.has(t)) score++;
      return { text, i, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, take)
    .sort((a, b) => a.i - b.i)
    .map((c) => c.text)
    .join("\n[...]\n");
}

const PROMPT = `You are a legal research assistant checking whether a brief has described a case accurately.

CASE: {case}

PASSAGES FROM THE OPINION:
{excerpt}

WHAT THE BRIEF SAYS ABOUT THIS CASE:
{claim}

Decide whether the passages support the brief's description.
Reply with JSON only: {"status":"supports"|"contradicts"|"unclear","explanation":"one short sentence","quote":"a short verbatim phrase from the passages, or null"}
Use "unclear" when the passages simply do not cover the point.`;

export async function checkClaim(c: VerifiedCitation): Promise<ClaimCheck> {
  if (c.verdict === "fabricated" || c.verdict === "error") {
    return { status: "unavailable", explanation: "No opinion to read.", quote: null };
  }

  const opinion = await fetchOpinionText(c);
  if (!opinion) {
    return {
      status: "unavailable",
      explanation: "Full text is not in the free Caselaw Access Project mirror.",
      quote: null,
    };
  }

  const prompt = PROMPT.replace("{case}", c.resolvedCase ?? c.raw)
    .replace("{excerpt}", relevantExcerpt(opinion, c.context))
    .replace("{claim}", c.context);

  try {
    const res = await fetch(`${OLLAMA}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        prompt,
        format: "json",
        stream: false,
        options: { temperature: 0.1, num_ctx: 8192 },
      }),
      signal: AbortSignal.timeout(180000),
    });
    if (!res.ok) throw new Error(String(res.status));

    const parsed = JSON.parse(JSON.parse(await res.text()).response);
    const status: ClaimStatus = ["supports", "contradicts", "unclear"].includes(
      parsed.status,
    )
      ? parsed.status
      : "unclear";

    return {
      status,
      explanation: String(parsed.explanation ?? "").slice(0, 400),
      quote: parsed.quote ? String(parsed.quote).slice(0, 300) : null,
    };
  } catch {
    return {
      status: "unavailable",
      explanation: `Local model unavailable - start Ollama and pull ${MODEL}.`,
      quote: null,
    };
  }
}

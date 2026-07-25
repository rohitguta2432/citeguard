import type { VerifiedCitation } from "./citations";

export type TreatmentStatus = "discussed" | "none" | "unchecked";

export interface CitingOpinion {
  caseName: string;
  court: string;
  date: string;
  url: string;
}

export interface Treatment {
  status: TreatmentStatus;
  /** Later opinions that talk about this case being overruled. */
  discussing: number;
  opinions: CitingOpinion[];
  note: string;
}

const UA = "CiteGuard/0.1 (+https://github.com/rohitguta2432/citeguard)";
const API = "https://www.courtlistener.com/api/rest/v4/search/";

/**
 * Party names that identify nobody. "State v. Jones" would otherwise search for
 * the phrase "overruled State", which matches half the reporter.
 */
const GENERIC = new Set([
  "state", "states", "united", "people", "commonwealth", "city", "county",
  "board", "department", "commission", "district", "company", "co", "inc",
  "llc", "corp", "corporation", "america", "government", "director",
  "secretary", "commissioner", "sheriff", "warden", "attorney", "general",
  "education", "schools", "trustees", "authority", "agency", "council",
  "association", "university", "hospital", "bank", "service", "services",
]);

/**
 * Courts refer to a case by one party - Roe v. Wade is "Roe" but Ashcroft v.
 * Iqbal is "Iqbal". There is no rule for which one, so both are searched and
 * only the parties that name nobody in particular are dropped.
 */
export function shortNames(caseName: string): string[] {
  return caseName
    .split(/\s+v\.?\s+/)
    .map((party) => {
      const words = party.trim().replace(/[^A-Za-z\s'-]/g, "").split(/\s+/);
      return words[words.length - 1] ?? "";
    })
    .filter((w) => w.length >= 3 && !GENERIC.has(w.toLowerCase()))
    .slice(0, 2);
}

/**
 * A case name used as an adjective - "the judge overruled the Miranda
 * objection" - contains the same words as a real overruling and would otherwise
 * be counted as one. Subtracting the nouns that follow removed six false hits
 * on Miranda without losing a single real one on Roe, Bowers or Plessy.
 */
const FOLLOWING_NOUNS = [
  "objection", "objections", "motion", "motions", "claim", "claims",
  "challenge", "argument", "arguments", "violation", "warning", "warnings",
  "rights", "waiver", "hearing", "request",
];

/**
 * Only phrases that name the case count. A bare search for "overruled" matched
 * 11,215 of the 30,407 opinions citing Miranda, because later opinions use the
 * word about entirely different cases.
 */
export function treatmentQuery(opinionId: string, names: string[]): string {
  const hits = names
    .flatMap((n) => ["overruled", "overruling", "we overrule"].map((v) => `"${v} ${n}"`))
    .join(" OR ");
  const noise = names
    .flatMap((n) =>
      FOLLOWING_NOUNS.map((w) => `"overruled ${n} ${w}" OR "overruling ${n} ${w}"`),
    )
    .join(" OR ");
  return `cites:(${opinionId}) AND (${hits}) AND NOT (${noise})`;
}

export async function checkTreatment(c: VerifiedCitation): Promise<Treatment> {
  const unchecked = (note: string): Treatment => ({
    status: "unchecked",
    discussing: 0,
    opinions: [],
    note,
  });

  if (!c.opinionId || !c.resolvedCase)
    return unchecked("Only a case that resolved can be checked for later history.");

  const names = shortNames(c.resolvedCase);
  if (!names.length)
    return unchecked("This case has no distinctive party name to search for.");

  const url = `${API}?q=${encodeURIComponent(
    treatmentQuery(c.opinionId, names),
  )}&type=o&order_by=${encodeURIComponent(
    "dateFiled desc",
  )}`;

  let res: Response;
  try {
    res = await fetch(url, {
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    return unchecked("Could not reach CourtListener to check later history.");
  }

  // Anonymous searches are rate limited. A refusal to answer is not evidence
  // that a case is still good law, so it is reported as unchecked.
  if (!res.ok)
    return unchecked(
      res.status === 429
        ? "CourtListener rate limited the history check - not checked."
        : `CourtListener answered ${res.status} - later history not checked.`,
    );

  const data = (await res.json()) as {
    count?: number;
    results?: {
      caseName?: string;
      court?: string;
      dateFiled?: string;
      absolute_url?: string;
    }[];
  };

  const discussing = data.count ?? 0;
  if (!discussing)
    return {
      status: "none",
      discussing: 0,
      opinions: [],
      note: "No later opinion talks about this case being overruled. That is not a promise it is still good law.",
    };

  // Deliberately not a verdict. The same search returns 19 opinions for Roe,
  // which was overruled, and 19 for Miranda, which was not - the second set is
  // courts discussing whether Congress could overrule it. The count cannot tell
  // those apart, so it points at the reading instead of pretending to judge.
  return {
    status: "discussed",
    discussing,
    opinions: (data.results ?? []).slice(0, 5).map((r) => ({
      caseName: r.caseName ?? "Unnamed opinion",
      court: r.court ?? "",
      date: r.dateFiled ?? "",
      url: r.absolute_url
        ? `https://www.courtlistener.com${r.absolute_url}`
        : "https://www.courtlistener.com",
    })),
    note: `${discussing} later opinion${
      discussing === 1 ? "" : "s"
    } discuss this case being overruled. Read them before you rely on it.`,
  };
}

/**
 * Anonymous CourtListener search starts refusing after roughly a dozen quick
 * requests, so these run one at a time with a gap, and repeat citations to the
 * same case reuse the first answer.
 */
export async function checkTreatmentAll(
  cites: VerifiedCitation[],
  onResult: (index: number, t: Treatment) => void,
): Promise<void> {
  const cache = new Map<string, Treatment>();

  for (let i = 0; i < cites.length; i++) {
    const c = cites[i];
    if (c.verdict === "fabricated" || c.verdict === "error" || !c.opinionId) continue;

    const hit = cache.get(c.opinionId);
    if (hit) {
      onResult(i, hit);
      continue;
    }

    const t = await checkTreatment(c);
    cache.set(c.opinionId, t);
    onResult(i, t);
    await new Promise((r) => setTimeout(r, 1200));
  }
}

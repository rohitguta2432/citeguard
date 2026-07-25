import type { ParsedCitation, VerifiedCitation, Verdict } from "@/lib/citations";
import type { ClaimCheck } from "@/lib/analyze";
import type { QuoteCheck } from "@/lib/quotes";
import type { Treatment } from "@/lib/treatment";

export type Row = ParsedCitation &
  Partial<VerifiedCitation> & {
    claim?: ClaimCheck;
    quotes?: QuoteCheck[];
    treatment?: Treatment;
  };

const LOOK: Record<Verdict | "pending", { label: string; ring: string; dot: string; text: string }> = {
  pending: { label: "Checking", ring: "border-line", dot: "bg-mist", text: "text-mist" },
  verified: { label: "Real case", ring: "border-ok/30", dot: "bg-ok", text: "text-ok" },
  fabricated: { label: "Does not exist", ring: "border-bad/50", dot: "bg-bad", text: "text-bad" },
  misattributed: { label: "Wrong case", ring: "border-warn/45", dot: "bg-warn", text: "text-warn" },
  error: { label: "Not checked", ring: "border-line", dot: "bg-mist", text: "text-mist" },
};

const CLAIM_LOOK: Record<ClaimCheck["status"], { label: string; text: string }> = {
  supports: { label: "Opinion supports this", text: "text-ok" },
  contradicts: { label: "Opinion says otherwise", text: "text-bad" },
  unclear: { label: "Opinion does not cover it", text: "text-warn" },
  unavailable: { label: "Full text unavailable", text: "text-mist" },
};

const QUOTE_LOOK: Record<QuoteCheck["status"], { label: string; text: string }> = {
  found: { label: "Quote is accurate", text: "text-ok" },
  altered: { label: "Quote wording differs", text: "text-warn" },
  missing: { label: "Quote is not in the opinion", text: "text-bad" },
  unchecked: { label: "Quote not checked", text: "text-mist" },
};

function Quotes({ quotes }: { quotes: QuoteCheck[] }) {
  return (
    <div className="mt-3 space-y-3 border-t border-line pt-3">
      {quotes.map((q, i) => (
        <div key={i}>
          <p
            className={`text-xs font-medium tracking-wide uppercase ${
              QUOTE_LOOK[q.status].text
            }`}
          >
            {QUOTE_LOOK[q.status].label}
          </p>
          <blockquote className="mt-1.5 border-l-2 border-line pl-3 font-serif text-sm leading-relaxed">
            &ldquo;{q.quote}&rdquo;
          </blockquote>
          <p className="mt-1.5 text-sm leading-relaxed text-mist">{q.note}</p>
          {q.actual && (
            <p className="mt-1.5 text-sm leading-relaxed text-mist">
              Closest wording in the opinion:{" "}
              <span className="font-serif text-white">{q.actual}</span>
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

function Later({ treatment }: { treatment: Treatment }) {
  return (
    <div className="mt-3 border-t border-line pt-3">
      <p
        className={`text-xs font-medium tracking-wide uppercase ${
          treatment.status === "discussed" ? "text-warn" : "text-mist"
        }`}
      >
        Later history
      </p>
      <p className="mt-1.5 text-sm leading-relaxed text-mist">{treatment.note}</p>
      {treatment.opinions.length > 0 && (
        <ul className="mt-2 space-y-1">
          {treatment.opinions.map((o) => (
            <li key={o.url} className="truncate text-xs text-mist">
              <a
                href={o.url}
                target="_blank"
                rel="noreferrer"
                className="text-accent hover:underline"
              >
                {o.caseName}
              </a>
              {o.date && ` - ${o.date}`}
              {o.court && ` - ${o.court}`}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function ResultCard({ row, delay }: { row: Row; delay: number }) {
  const look = LOOK[row.verdict ?? "pending"];
  const claim = row.claim ? CLAIM_LOOK[row.claim.status] : null;

  return (
    <li
      className={`glass rise rounded-xl border ${look.ring} p-4 ${
        row.verdict === "fabricated" ? "alarm" : ""
      }`}
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="flex items-start gap-3">
        <span className={`mt-1.5 size-2 shrink-0 rounded-full ${look.dot}`} />

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <code className="font-mono text-[15px] font-semibold">{row.raw}</code>
            <span className={`text-xs font-medium tracking-wide uppercase ${look.text}`}>
              {look.label}
            </span>
          </div>

          {row.claimedCase && (
            <p className="mt-1 truncate font-serif text-sm text-mist">
              cited as {row.claimedCase}
            </p>
          )}

          {row.note && <p className="mt-2 text-sm leading-relaxed">{row.note}</p>}

          {row.opinionUrl && (
            <a
              href={row.opinionUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-block text-xs text-accent hover:underline"
            >
              Read the opinion &rarr;
            </a>
          )}

          {claim && (
            <div className="mt-3 border-t border-line pt-3">
              <p className={`text-xs font-medium tracking-wide uppercase ${claim.text}`}>
                {claim.label}
              </p>
              <p className="mt-1.5 text-sm leading-relaxed text-mist">
                {row.claim!.explanation}
              </p>
              {row.claim!.quote && (
                <blockquote className="mt-2 border-l-2 border-line pl-3 font-serif text-sm leading-relaxed">
                  &ldquo;{row.claim!.quote}&rdquo;
                </blockquote>
              )}
            </div>
          )}

          {row.quotes && row.quotes.length > 0 && <Quotes quotes={row.quotes} />}
          {row.treatment && <Later treatment={row.treatment} />}
        </div>
      </div>
    </li>
  );
}

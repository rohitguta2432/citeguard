"use client";

import { useRef, useState } from "react";
import type { ParsedCitation, VerifiedCitation } from "@/lib/citations";
import type { ClaimCheck } from "@/lib/analyze";
import { SAMPLE_BRIEF } from "@/lib/sample";
import ResultCard from "./ResultCard";

type Row = ParsedCitation & Partial<VerifiedCitation> & { claim?: ClaimCheck };

export default function Home() {
  const [text, setText] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [deep, setDeep] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [started, setStarted] = useState(false);
  const areaRef = useRef<HTMLTextAreaElement>(null);

  async function run() {
    setBusy(true);
    setError(null);
    setStarted(true);
    setRows([]);

    let res: Response;
    try {
      res = await fetch("/api/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, deep }),
      });
    } catch {
      setError("Could not reach the server.");
      setBusy(false);
      return;
    }

    if (!res.ok || !res.body) {
      setError((await res.json().catch(() => null))?.error ?? "Check failed.");
      setBusy(false);
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.trim()) continue;
        const msg = JSON.parse(line);
        if (msg.type === "citations") setRows(msg.citations);
        if (msg.type === "verdict")
          setRows((r) =>
            r.map((row, i) => (i === msg.index ? { ...row, ...msg.result } : row)),
          );
        if (msg.type === "claim")
          setRows((r) =>
            r.map((row, i) => (i === msg.index ? { ...row, claim: msg.claim } : row)),
          );
      }
    }

    setBusy(false);
  }

  const counts = {
    fabricated: rows.filter((r) => r.verdict === "fabricated").length,
    misattributed: rows.filter((r) => r.verdict === "misattributed").length,
    verified: rows.filter((r) => r.verdict === "verified").length,
  };
  const problems = counts.fabricated + counts.misattributed;
  const checked = rows.filter((r) => r.verdict).length;

  return (
    <main className="mx-auto w-full max-w-3xl px-5 py-10 sm:py-14">
      <header className="mb-9">
        <div className="flex items-baseline gap-3">
          <h1 className="font-serif text-4xl tracking-tight sm:text-5xl">
            Cite<span className="text-accent">Guard</span>
          </h1>
          <span className="rounded-full border border-line px-2.5 py-1 text-[11px] tracking-wide text-mist uppercase">
            open source
          </span>
        </div>
        <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-mist">
          Paste a brief. Every case citation is checked against the free
          CourtListener database, so a case that does not exist cannot reach a
          judge. No account, no API key.
        </p>
      </header>

      <div className="glass rounded-2xl border border-line p-4 shadow-2xl shadow-black/40">
        <textarea
          ref={areaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          spellCheck={false}
          placeholder="Paste the text of a motion, brief or memo..."
          className="h-56 w-full resize-none bg-transparent font-mono text-[13px] leading-relaxed outline-none"
        />

        <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-line pt-3">
          <button
            onClick={run}
            disabled={busy || !text.trim()}
            className="relative overflow-hidden rounded-lg bg-accent px-5 py-2.5 text-sm font-semibold text-ink transition hover:brightness-110 disabled:opacity-35"
          >
            {busy ? "Checking..." : "Check citations"}
          </button>

          <button
            onClick={() => {
              setText(SAMPLE_BRIEF);
              areaRef.current?.focus();
            }}
            className="rounded-lg border border-line px-4 py-2.5 text-sm text-mist transition hover:text-white"
          >
            Load sample brief
          </button>

          <label className="ml-auto flex cursor-pointer items-center gap-2 text-sm text-mist">
            <input
              type="checkbox"
              checked={deep}
              onChange={(e) => setDeep(e.target.checked)}
              className="size-4 accent-[#e8b339]"
            />
            Also read the opinions
          </label>
        </div>

        {busy && (
          <div className="relative mt-3 h-0.5 overflow-hidden rounded bg-line sweep" />
        )}
      </div>

      {error && (
        <p className="mt-4 rounded-lg border border-bad/40 bg-bad/10 px-4 py-3 text-sm text-bad">
          {error}
        </p>
      )}

      {started && !busy && rows.length === 0 && !error && (
        <p className="mt-8 text-sm text-mist">
          No case citations found in that text.
        </p>
      )}

      {rows.length > 0 && (
        <>
          <div className="mt-8 flex items-center gap-6">
            <div>
              <div
                className={`font-serif text-5xl leading-none ${
                  problems ? "text-bad" : "text-ok"
                }`}
              >
                {problems}
              </div>
              <div className="mt-1.5 text-xs tracking-wide text-mist uppercase">
                {problems === 1 ? "problem" : "problems"} found
              </div>
            </div>
            <div className="h-10 w-px bg-line" />
            <div className="text-sm text-mist">
              <div>
                {checked} of {rows.length} citations checked
              </div>
              <div className="mt-1">
                {counts.verified} verified &middot; {counts.fabricated} do not
                exist &middot; {counts.misattributed} wrong case
              </div>
            </div>
          </div>

          <ul className="mt-6 space-y-3">
            {rows.map((row, i) => (
              <ResultCard key={i} row={row} delay={i * 60} />
            ))}
          </ul>
        </>
      )}

      <footer className="mt-14 border-t border-line pt-6 text-xs leading-relaxed text-mist">
        Citations are resolved through{" "}
        <a
          className="text-accent hover:underline"
          href="https://www.courtlistener.com"
          target="_blank"
          rel="noreferrer"
        >
          CourtListener
        </a>{" "}
        and opinion text comes from the{" "}
        <a
          className="text-accent hover:underline"
          href="https://case.law"
          target="_blank"
          rel="noreferrer"
        >
          Caselaw Access Project
        </a>
        . CiteGuard is a drafting aid, not legal advice - always read the case
        yourself before you file.
      </footer>
    </main>
  );
}

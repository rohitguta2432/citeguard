import { extractWithService, verifyAll } from "@/lib/citations";
import { checkClaim } from "@/lib/analyze";
import { checkQuotes, quotesFor } from "@/lib/quotes";
import { checkTreatmentAll } from "@/lib/treatment";

export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_CHARS = 200_000;

export async function POST(req: Request) {
  const { text, deep } = await req.json();

  if (typeof text !== "string" || !text.trim()) {
    return Response.json({ error: "Paste a brief first." }, { status: 400 });
  }

  const brief = text.slice(0, MAX_CHARS);
  const { citations, extractor } = await extractWithService(brief);
  const quotes = quotesFor(brief, citations);
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (msg: unknown) =>
        controller.enqueue(encoder.encode(JSON.stringify(msg) + "\n"));

      send({ type: "citations", citations, extractor });

      const verified = await verifyAll(citations, (index, result) =>
        send({ type: "verdict", index, result }),
      );

      // Quote checking is plain string matching against the opinion text, so it
      // runs for everyone rather than being held back behind the deep option.
      await Promise.all(
        [...quotes].map(async ([index, list]) => {
          const results = await checkQuotes(verified[index], list);
          if (results.length) send({ type: "quotes", index, quotes: results });
        }),
      );

      await checkTreatmentAll(verified, (index, treatment) =>
        send({ type: "treatment", index, treatment }),
      );

      // The local model takes ~15s per citation, so it runs only on demand and
      // only where there is an opinion worth reading.
      if (deep) {
        for (const [index, c] of verified.entries()) {
          if (c.verdict === "fabricated" || c.verdict === "error") continue;
          send({ type: "claim", index, claim: await checkClaim(c) });
        }
      }

      send({ type: "done" });
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}

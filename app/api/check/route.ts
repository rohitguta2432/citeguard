import { extractCitations, verifyAll } from "@/lib/citations";
import { checkClaim } from "@/lib/analyze";

export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_CHARS = 200_000;

export async function POST(req: Request) {
  const { text, deep } = await req.json();

  if (typeof text !== "string" || !text.trim()) {
    return Response.json({ error: "Paste a brief first." }, { status: 400 });
  }

  const citations = extractCitations(text.slice(0, MAX_CHARS));
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (msg: unknown) =>
        controller.enqueue(encoder.encode(JSON.stringify(msg) + "\n"));

      send({ type: "citations", citations });

      const verified = await verifyAll(citations, (index, result) =>
        send({ type: "verdict", index, result }),
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

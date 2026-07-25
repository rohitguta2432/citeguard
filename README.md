# CiteGuard

Paste a legal brief. CiteGuard checks every case citation against real court
data and flags the ones that do not exist.

No account. No API key. Runs on your own machine.

## The problem

Lawyers keep getting sanctioned for filing briefs that cite cases which were
never decided. An AI assistant invents a case name, a volume and a page number,
the citation looks perfectly normal, and nobody notices until a judge tries to
read it.

The check itself is not hard. It is just tedious enough that under deadline
pressure it gets skipped.

## What it checks

Every citation gets three questions asked of it:

1. **Does this case exist?** The citation is resolved against
   [CourtListener](https://www.courtlistener.com), which holds over 18 million
   citations. A citation that resolves to nothing is reported as fabricated.
2. **Is it the case you named?** A real citation attached to the wrong case name
   is reported as misattributed - for example a brief citing
   `Coleman v. Ridgeway Partners, 384 U.S. 436` when that citation is actually
   Miranda v. Arizona.
3. **Does the case say what you claim?** Optional. A local language model reads
   the opinion text and reports whether it supports the sentence in your brief,
   and quotes the passage it relied on.

Checks 1 and 2 run in about two seconds for a whole brief. Check 3 is slower
because it runs on your own hardware, so it is opt-in.

## Where the data comes from

| Need | Source | Key required |
| --- | --- | --- |
| Does the citation resolve to a case | CourtListener citation redirect | no |
| Full text of the opinion | [Caselaw Access Project](https://case.law) static mirror | no |
| Reading the opinion | [Ollama](https://ollama.com) on localhost | no |

Nothing you paste leaves your machine except the volume, reporter and page
number of each citation.

## Run it

```bash
npm install
npm run dev          # http://localhost:4622
```

For the optional opinion-reading check:

```bash
ollama pull qwen2.5:14b
```

Override the model with `CITEGUARD_MODEL`, or point at a remote Ollama with
`OLLAMA_HOST`.

```bash
npm test             # unit tests, no network
```

## Limits worth knowing

- Caselaw Access Project coverage ends around 2020, so the opinion-reading check
  is unavailable for very recent cases. The existence check still works.
- Only US reporters are recognised. The list is at the top of
  [`lib/citations.ts`](lib/citations.ts) and takes one line to extend.
- A citation is only called fabricated when CourtListener returns a definite
  404. Anything else is reported as "not checked" rather than risking a false
  accusation.
- Parallel citations (`93 S. Ct. 705` alongside `410 U.S. 113`) are each checked
  separately.

CiteGuard is a drafting aid, not legal advice. Read the case before you file.

## Licence

MIT

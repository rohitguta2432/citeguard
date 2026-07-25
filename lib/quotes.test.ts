import { describe, expect, it } from "vitest";
import { matchQuote, quotesFor } from "./quotes";

// Stands in for a scanned opinion: real wording, real OCR-era noise.
const OPINION = `
Prior to any questioning, the person must be warned that he has a right to
remain silent, that any statement he does make may be used as evidence against
him, and that he has a right to the presence of an attorney, either retained or
appointed. The defendant may waive effectuation of these rights, provided the
waiver is made voluntarily, knowingly and intelligently. Where rights secured by
the Constitution are involved, there can be no rule making legislation which
would abrogate them.
`;

describe("matchQuote", () => {
  it("finds a verbatim quote", () => {
    const m = matchQuote(
      "the person must be warned that he has a right to remain silent",
      OPINION,
    );
    expect(m.status).toBe("found");
    expect(m.similarity).toBe(1);
  });

  it("ignores punctuation, capitals and line breaks", () => {
    const m = matchQuote(
      "The Defendant may waive effectuation of these rights - provided the waiver is made voluntarily, knowingly, and intelligently!",
      OPINION,
    );
    expect(m.status).toBe("found");
  });

  it("treats an ellipsis as two quotes that must both appear", () => {
    const m = matchQuote(
      "the person must be warned that he has a right to remain silent ... he has a right to the presence of an attorney",
      OPINION,
    );
    expect(m.status).toBe("found");
  });

  it("flags a quote that never appears and shows what the case really says", () => {
    const m = matchQuote(
      "No confession obtained after sunset shall ever be admitted into evidence in a federal proceeding",
      OPINION,
    );
    expect(m.status).toBe("missing");
    expect(m.actual).toBeTruthy();
  });

  // One inserted word reverses the holding while leaving the sentence almost
  // identical, which is exactly what a similarity score cannot see. It has to
  // come back as altered, never as found.
  it("catches a single word that flips the meaning", () => {
    const m = matchQuote(
      "the person must never be warned that he has a right to remain silent, that any statement",
      OPINION,
    );
    expect(m.status).toBe("altered");
    expect(m.actual).toContain("must be warned");
  });

  it("says nothing at all about a quote too short to be a claim", () => {
    expect(matchQuote("no rule", OPINION).status).toBe("unchecked");
  });
});

describe("quotesFor", () => {
  const cites = [
    { index: 100, raw: "384 U.S. 436" },
    { index: 400, raw: "410 U.S. 113" },
  ];

  it("attaches a quote to the citation that follows it", () => {
    const text =
      " ".repeat(20) +
      `"the person must be warned that he has a right to remain silent"` +
      " ".repeat(18) +
      "384 U.S. 436";
    expect(quotesFor(text, cites).get(0)?.length).toBe(1);
  });

  it("leaves a quote alone when no citation is near it", () => {
    const text = `"the person must be warned that he has a right to remain silent"`;
    expect(quotesFor(text, [{ index: 9000, raw: "384 U.S. 436" }]).size).toBe(0);
  });

  it("skips quotes too short to be worth checking", () => {
    const text = `word "not long enough" 384 U.S. 436`;
    expect(quotesFor(text, [{ index: 23, raw: "384 U.S. 436" }]).size).toBe(0);
  });
});

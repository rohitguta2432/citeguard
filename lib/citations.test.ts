import { describe, expect, it } from "vitest";
import { extractCitations, namesDisagree, slugToCaseName } from "./citations";
import { relevantExcerpt, reporterSlug } from "./analyze";

describe("extractCitations", () => {
  it("pulls the citation apart and keeps the case name that precedes it", () => {
    const [c] = extractCitations("See Roe v. Wade, 410 U.S. 113, 153 (1973).");
    expect(c.volume).toBe("410");
    expect(c.reporter).toBe("U.S.");
    expect(c.page).toBe("113");
    expect(c.claimedCase).toBe("Roe v. Wade");
  });

  it("drops prose that runs into the case name", () => {
    const cases: [string, string][] = [
      ["That principle was reaffirmed in Miranda v. Arizona, 384 U.S. 436.", "Miranda v. Arizona"],
      ["See also Thompson v. Whitfield Industries, 410 U.S. 113.", "Thompson v. Whitfield Industries"],
      ["as explained in Smith v. Jones, 999 F.4th 1234.", "Smith v. Jones"],
      ["Accord United States v. Nixon, 418 U.S. 683.", "United States v. Nixon"],
      ["compare Brown v. Board of Education, 347 U.S. 483.", "Brown v. Board of Education"],
    ];
    for (const [text, expected] of cases) {
      expect(extractCitations(text)[0].claimedCase, text).toBe(expected);
    }
  });

  it("prefers the longer reporter when two could match", () => {
    expect(extractCitations("512 F. Supp. 3d 884")[0].reporter).toBe("F. Supp. 3d");
    expect(extractCitations("998 F.3d 1122")[0].reporter).toBe("F.3d");
  });

  it("finds every citation in a multi-citation brief", () => {
    const found = extractCitations(
      "Iqbal, 556 U.S. 662; Twombly, 550 U.S. 544; and 999 F.4th 1234.",
    );
    expect(found.map((c) => c.raw)).toEqual([
      "556 U.S. 662",
      "550 U.S. 544",
      "999 F.4th 1234",
    ]);
  });
});

describe("namesDisagree", () => {
  it("flags a citation pinned to an unrelated case", () => {
    expect(namesDisagree("Coleman v. Ridgeway Partners", "Miranda v. Arizona")).toBe(true);
  });

  it("stays quiet when the names share a party, however abbreviated", () => {
    expect(namesDisagree("Bell Atlantic Corp. v. Twombly", "Bell Atlantic Corp v. Twombly")).toBe(false);
    expect(namesDisagree("Brown v. Board of Education", "Brown v. Board of Education of Topeka")).toBe(false);
  });

  it("stays quiet when only boilerplate words are left to compare", () => {
    expect(namesDisagree("United States v. State", "City of Boerne v. Flores")).toBe(false);
  });
});

describe("slugToCaseName", () => {
  it("rebuilds a readable case name from a CourtListener slug", () => {
    expect(slugToCaseName("brown-v-board-of-education")).toBe("Brown v. Board of Education");
    expect(slugToCaseName("roe-v-wade")).toBe("Roe v. Wade");
  });
});

describe("reporterSlug", () => {
  it("matches the Caselaw Access Project naming", () => {
    expect(reporterSlug("U.S.")).toBe("us");
    expect(reporterSlug("F.3d")).toBe("f3d");
    expect(reporterSlug("F. Supp. 2d")).toBe("f-supp-2d");
  });
});

describe("relevantExcerpt", () => {
  it("surfaces the passage that shares words with the claim", () => {
    const opinion =
      "a".repeat(1200) +
      "The right of privacy is broad enough to encompass a woman's decision.".padEnd(1200, " ") +
      "b".repeat(1200);
    const excerpt = relevantExcerpt(opinion, "right of privacy encompass decision", 1);
    expect(excerpt).toContain("broad enough to encompass");
  });
});

import { describe, expect, it } from "vitest";
import { shortNames, treatmentQuery } from "./treatment";

describe("shortNames", () => {
  it("keeps the party a case is named after", () => {
    expect(shortNames("Roe v. Wade")).toEqual(["Roe", "Wade"]);
    expect(shortNames("Lemon v. Kurtzman")).toEqual(["Lemon", "Kurtzman"]);
  });

  // "overruled State" would match a large slice of the reporter.
  it("drops parties that name nobody in particular", () => {
    expect(shortNames("United States v. Nixon")).toEqual(["Nixon"]);
    expect(shortNames("State v. Jones")).toEqual(["Jones"]);
    expect(shortNames("Brown v. Board of Education")).toEqual(["Brown"]);
  });

  it("takes the last word of a long party name", () => {
    expect(shortNames("Bell Atlantic Corp. v. Twombly")).toEqual(["Twombly"]);
  });
});

describe("treatmentQuery", () => {
  const q = treatmentQuery("108713", ["Roe"]);

  it("only counts phrases that name the case", () => {
    expect(q).toContain('"overruled Roe"');
    expect(q).toContain("cites:(108713)");
    // A bare "overruled" matched 11,215 of the 30,407 opinions citing Miranda.
    expect(q).not.toMatch(/\(overruled OR/);
  });

  it("excludes the case name used as an adjective", () => {
    expect(q).toContain('NOT ("overruled Roe objection"');
  });
});

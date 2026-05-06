import { describe, it, expect } from "vitest";
import { computeExcerpts, reconstructFullFile } from "./excerpt-helpers.ts";

const sampleFile = [
  "line0",
  "# START A",
  "  content A1",
  "  content A2",
  "# END A",
  "between",
  "# START B",
  "    content B1",
  "    content B2",
  "    content B3",
  "# END B",
  "trailing",
].join("\n");

describe("computeExcerpts", () => {
  it("extracts a single excerpt between markers", () => {
    const { excerptedText, intervals } = computeExcerpts(sampleFile, [
      [/# START A/, /# END A/],
    ]);
    expect(excerptedText).toBe("  content A1\n  content A2");
    expect(intervals).toEqual([{ start: 2, end: 3 }]);
  });

  it("extracts multiple excerpts with … separator", () => {
    const { excerptedText, intervals } = computeExcerpts(sampleFile, [
      [/# START A/, /# END A/],
      [/# START B/, /# END B/],
    ]);
    expect(excerptedText).toBe(
      "  content A1\n  content A2\n    …\n    content B1\n    content B2\n    content B3",
    );
    expect(intervals).toEqual([
      { start: 2, end: 3 },
      { start: 7, end: 9 },
    ]);
  });

  it("single pair matches multiple times", () => {
    const file = [
      "header",
      "# START",
      "  A1",
      "  A2",
      "# END",
      "gap",
      "# START",
      "    B1",
      "# END",
      "footer",
    ].join("\n");
    const { excerptedText, intervals } = computeExcerpts(file, [
      [/# START/, /# END/],
    ]);
    expect(excerptedText).toBe("  A1\n  A2\n    …\n    B1");
    expect(intervals).toEqual([
      { start: 2, end: 3 },
      { start: 7, end: 7 },
    ]);
  });

  it("returns full text when no regexes match", () => {
    const { excerptedText, intervals } = computeExcerpts(sampleFile, [
      [/NOPE/, /ALSO NOPE/],
    ]);
    expect(excerptedText).toBe(sampleFile);
    expect(intervals).toEqual([{ start: 0, end: 11 }]);
  });

  it("skips pairs where end is not found", () => {
    const { excerptedText, intervals } = computeExcerpts(sampleFile, [
      [/# START A/, /MISSING END/],
    ]);
    expect(excerptedText).toBe(sampleFile);
    expect(intervals).toEqual([{ start: 0, end: 11 }]);
  });
});

describe("reconstructFullFile", () => {
  it("reconstructs with a single edited excerpt", () => {
    const intervals = [{ start: 2, end: 3 }];
    const editedText = "  EDITED A1\n  EDITED A2";
    const result = reconstructFullFile(sampleFile, editedText, intervals);
    const lines = result.split("\n");
    expect(lines[0]).toBe("line0");
    expect(lines[1]).toBe("# START A");
    expect(lines[2]).toBe("  EDITED A1");
    expect(lines[3]).toBe("  EDITED A2");
    expect(lines[4]).toBe("# END A");
    expect(lines[5]).toBe("between");
  });

  it("reconstructs with multiple edited excerpts", () => {
    const intervals = [
      { start: 2, end: 3 },
      { start: 7, end: 9 },
    ];
    const editedText =
      "  EDITED A1\n  EDITED A2\n    …\n    EDITED B1\n    EDITED B2\n    EDITED B3";
    const result = reconstructFullFile(sampleFile, editedText, intervals);
    const lines = result.split("\n");
    expect(lines[0]).toBe("line0");
    expect(lines[1]).toBe("# START A");
    expect(lines[2]).toBe("  EDITED A1");
    expect(lines[3]).toBe("  EDITED A2");
    expect(lines[4]).toBe("# END A");
    expect(lines[5]).toBe("between");
    expect(lines[6]).toBe("# START B");
    expect(lines[7]).toBe("    EDITED B1");
    expect(lines[8]).toBe("    EDITED B2");
    expect(lines[9]).toBe("    EDITED B3");
    expect(lines[10]).toBe("# END B");
    expect(lines[11]).toBe("trailing");
  });

  it("throws when … separators are missing", () => {
    const intervals = [
      { start: 2, end: 3 },
      { start: 7, end: 9 },
    ];
    const editedText = "  EDITED A1\n  EDITED A2\n    EDITED B1";
    expect(() =>
      reconstructFullFile(sampleFile, editedText, intervals),
    ).toThrow("Expected 1 … separator(s) but found 0");
  });

  it("throws when extra … separators are added", () => {
    const intervals = [{ start: 2, end: 3 }];
    const editedText = "  line1\n  …\n  line2";
    expect(() =>
      reconstructFullFile(sampleFile, editedText, intervals),
    ).toThrow("Expected 0 … separator(s) but found 1");
  });

  it("round-trips: computeExcerpts then reconstructFullFile yields original", () => {
    const { excerptedText, intervals } = computeExcerpts(sampleFile, [
      [/# START A/, /# END A/],
      [/# START B/, /# END B/],
    ]);
    const result = reconstructFullFile(sampleFile, excerptedText, intervals);
    expect(result).toBe(sampleFile);
  });
});

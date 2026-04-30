import { describe, it, expect } from "vitest";
import {
  parseHighlightLine,
  parseCodeHighlights,
  hasHighlights,
} from "./highlight.ts";

describe("parseHighlightLine", () => {
  it("highlights a line with a single trailing marker and strips one space", () => {
    expect(parseHighlightLine("x = 1   //HL")).toEqual({
      text: "x = 1  ",
      highlight: true,
    });
  });

  it("does not highlight a line without a marker", () => {
    expect(parseHighlightLine("x = 1")).toEqual({
      text: "x = 1",
      highlight: false,
    });
  });

  it("repeats append `HL`: //HLHL is n=2, not highlighted, leaves one //HL literal", () => {
    expect(parseHighlightLine("x = 1//HLHL")).toEqual({
      text: "x = 1//HL",
      highlight: false,
    });
  });

  it("//HLHLHL is n=3, highlighted, leaves //HLHL literal", () => {
    expect(parseHighlightLine("x = 1//HLHLHL")).toEqual({
      text: "x = 1//HLHL",
      highlight: true,
    });
  });

  it("nests: highlight `code //HL` via space-separated trailing marker", () => {
    expect(parseHighlightLine("code //HL //HL")).toEqual({
      text: "code //HL",
      highlight: true,
    });
  });

  it("nests: render literal `code //HL` un-highlighted via //HLHL", () => {
    expect(parseHighlightLine("code //HLHL")).toEqual({
      text: "code //HL",
      highlight: false,
    });
  });

  it("nests two levels: highlight `code //HL //HL`", () => {
    expect(parseHighlightLine("code //HL //HL //HL")).toEqual({
      text: "code //HL //HL",
      highlight: true,
    });
  });

  it("nests two levels: render `code //HL //HL` un-highlighted via trailing HL", () => {
    expect(parseHighlightLine("code //HL //HLHL")).toEqual({
      text: "code //HL //HL",
      highlight: false,
    });
  });

  it("supports the #HL marker with the same repeat scheme", () => {
    expect(parseHighlightLine("x = 1 #HL")).toEqual({
      text: "x = 1",
      highlight: true,
    });
    expect(parseHighlightLine("x = 1 #HLHL")).toEqual({
      text: "x = 1 #HL",
      highlight: false,
    });
    expect(parseHighlightLine("x = 1 #HLHLHL")).toEqual({
      text: "x = 1 #HLHL",
      highlight: true,
    });
  });

  it("does not treat a non-trailing marker as a marker", () => {
    expect(parseHighlightLine('s = "//HL" + foo')).toEqual({
      text: 's = "//HL" + foo',
      highlight: false,
    });
  });

  it("handles a line that is only a marker", () => {
    expect(parseHighlightLine("//HL")).toEqual({ text: "", highlight: true });
  });

  it("does not extend a run across a fresh //HL", () => {
    // //HL//HL: trailing run is just the last //HL (n=1), since extension requires HL not //HL
    expect(parseHighlightLine("x//HL//HL")).toEqual({
      text: "x//HL",
      highlight: true,
    });
  });
});

describe("parseCodeHighlights", () => {
  it("processes each line independently", () => {
    const out = parseCodeHighlights("a //HL\nb\nc //HLHL");
    expect(out).toEqual([
      { text: "a", highlight: true },
      { text: "b", highlight: false },
      { text: "c //HL", highlight: false },
    ]);
  });
});

describe("highlight detection (parity across escape variants)", () => {
  // [input line, visible output text, highlighted?]
  const cases: ReadonlyArray<readonly [string, string, boolean]> = [
    // Plain
    ["x = 1", "x = 1", false],
    ["", "", false],
    // Single trailing marker (one preceding whitespace stripped)
    ["x = 1 //HL", "x = 1", true],
    ["x = 1 #HL", "x = 1", true],
    ["//HL", "", true],
    ["#HL", "", true],
    // Even runs: escaped, literal //HL emitted, not highlighted
    ["x //HLHL", "x //HL", false],
    ["x #HLHL", "x #HL", false],
    ["x //HLHLHLHL", "x //HLHLHL", false], // n=4
    // Odd runs > 1: escape that IS highlighted
    ["x //HLHLHL", "x //HLHL", true], // n=3
    ["x //HLHLHLHLHL", "x //HLHLHLHL", true], // n=5
    // Nesting via space: fresh //HL after whitespace = new run of 1
    ["code //HL //HL", "code //HL", true],
    ["code //HL //HLHL", "code //HL //HL", false],
    ["code //HL //HL //HL", "code //HL //HL", true],
    ["code //HL //HL //HLHL", "code //HL //HL //HL", false],
    ["code //HL //HL //HL //HL", "code //HL //HL //HL", true],
    // Adjacent //HL//HL: trailing run is just the last //HL (n=1)
    ["x//HL//HL", "x//HL", true],
    ["x #HL#HL", "x #HL", true],
    // Mid-line markers don't count
    ['s = "//HL" + foo', 's = "//HL" + foo', false],
    ["a //HL b", "a //HL b", false],
    ["// HL trailing comment", "// HL trailing comment", false],
    ["x //hl", "x //hl", false], // case sensitive
    // Tabs and multi-space before marker: only one whitespace stripped
    ["x\t//HL", "x", true],
    ["x   //HL", "x  ", true],
  ];

  for (const [input, expectedText, expectedHl] of cases) {
    it(`${expectedHl ? "highlights" : "does not highlight"} ${JSON.stringify(input)} → ${JSON.stringify(expectedText)}`, () => {
      expect(parseHighlightLine(input)).toEqual({
        text: expectedText,
        highlight: expectedHl,
      });
    });
  }
});

describe("hasHighlights", () => {
  it("returns false for plain code with no markers", () => {
    expect(hasHighlights("a\nb\nc")).toBe(false);
  });

  it("returns true if any line is highlighted", () => {
    expect(hasHighlights("a\nb //HL\nc")).toBe(true);
  });

  it("returns false when every marker is escaped", () => {
    expect(hasHighlights("a //HLHL\nb #HLHL\nc //HL //HLHL")).toBe(false);
  });

  it("returns true when at least one nested form lands on odd parity", () => {
    expect(hasHighlights("a //HLHL\nb //HL //HL\nc //HLHL")).toBe(true);
  });

  it("returns false for empty input", () => {
    expect(hasHighlights("")).toBe(false);
  });
});

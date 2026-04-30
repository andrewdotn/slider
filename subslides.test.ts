import { describe, it, expect } from "vitest";
import {
  parseWhen,
  countSubSlides,
  transformForSubSlide,
  normalizeIndentedCode,
} from "./subslides.tsx";

describe("parseWhen", () => {
  it("matches a single number", () => {
    const w = parseWhen("2");
    expect(w.match(1)).toBe(false);
    expect(w.match(2)).toBe(true);
    expect(w.match(3)).toBe(false);
    expect(w.upperBound()).toBe(2);
  });

  it("matches an open-ended range", () => {
    const w = parseWhen("3-");
    expect(w.match(2)).toBe(false);
    expect(w.match(3)).toBe(true);
    expect(w.match(99)).toBe(true);
    expect(w.upperBound()).toBe(3);
  });

  it("matches a closed range", () => {
    const w = parseWhen("2-4");
    expect(w.match(1)).toBe(false);
    expect(w.match(2)).toBe(true);
    expect(w.match(4)).toBe(true);
    expect(w.match(5)).toBe(false);
    expect(w.upperBound()).toBe(4);
  });

  it("matches a left-open range", () => {
    const w = parseWhen("-2");
    expect(w.match(1)).toBe(true);
    expect(w.match(2)).toBe(true);
    expect(w.match(3)).toBe(false);
    expect(w.upperBound()).toBe(2);
  });

  it("matches a comma list", () => {
    const w = parseWhen("1-3,5");
    expect(w.match(1)).toBe(true);
    expect(w.match(3)).toBe(true);
    expect(w.match(4)).toBe(false);
    expect(w.match(5)).toBe(true);
    expect(w.match(6)).toBe(false);
    expect(w.upperBound()).toBe(5);
  });
});

describe("countSubSlides", () => {
  it("returns 1 for a slide with no overlay tags", () => {
    expect(countSubSlides("# Hi\n\nplain text\n")).toBe(1);
  });

  it("counts Sl.Pause markers", () => {
    const src = `# A\n\n- one\n<Sl.Pause/>\n- two\n<Sl.Pause/>\n- three\n`;
    expect(countSubSlides(src)).toBe(3);
  });

  it("respects Sl.Span when ranges", () => {
    const src = `# A\n\n<Sl.Span when="3">x</Sl.Span>\n`;
    expect(countSubSlides(src)).toBe(3);
  });

  it("advances pause firing past preceding when bounds", () => {
    // when=2 reveal first, then Pause fires at 3, then when=4
    const src =
      `# A\n\n- adv\n<Sl.Span when="2">- fast</Sl.Span>\n` +
      `<Sl.Pause/>\n- dis\n<Sl.Span when="4">- complicated</Sl.Span>\n`;
    expect(countSubSlides(src)).toBe(4);
  });

  it("accepts unquoted attribute values", () => {
    const src = `# A\n\n<Sl.Span when=3->x</Sl.Span>\n`;
    expect(countSubSlides(src)).toBe(3);
  });
});

describe("transformForSubSlide", () => {
  it("elides everything past an unfired pause", () => {
    const src = `# A\n\n- one\n<Sl.Pause/>\n- two\n`;
    const s1 = transformForSubSlide(src, 1);
    expect(s1).toContain("- one");
    expect(s1).not.toContain("- two");
    expect(s1).not.toContain("<Sl.Pause");
  });

  it("shows everything when n exceeds the pause count", () => {
    const src = `# A\n\n- one\n<Sl.Pause/>\n- two\n`;
    const s2 = transformForSubSlide(src, 2);
    expect(s2).toContain("- one");
    expect(s2).toContain("- two");
    expect(s2).not.toContain("<Sl.Pause");
  });

  it("strips Sl.Span tags but keeps inner content when when matches", () => {
    const src = `- Advantages\n\n  <Sl.Span when="2">\n  - Fast\n  </Sl.Span>\n`;
    const s = transformForSubSlide(src, 2);
    expect(s).toContain("- Fast");
    expect(s).not.toContain("<Sl.Span");
    expect(s).not.toContain("</Sl.Span>");
  });

  it("removes a Sl.Span entirely when when does not match", () => {
    const src = `- Advantages\n\n  <Sl.Span when="2">\n  - Fast\n  </Sl.Span>\n`;
    const s = transformForSubSlide(src, 1);
    expect(s).toContain("- Advantages");
    expect(s).not.toContain("- Fast");
    expect(s).not.toContain("<Sl.Span");
  });

  it("handles the spec example variant by variant", () => {
    const src =
      `## Slide 2\n\n  - Advantages\n\n` +
      `      <Sl.Span when="2">\n      - Fast\n      </Sl.Span>\n\n` +
      `  <Sl.Pause/>\n\n  - Disadvantages\n\n` +
      `  <Sl.Span when="4">\n      - Complicated\n  </Sl.Span>\n`;

    const v1 = transformForSubSlide(src, 1);
    expect(v1).toContain("- Advantages");
    expect(v1).not.toContain("- Fast");
    expect(v1).not.toContain("- Disadvantages");
    expect(v1).not.toContain("- Complicated");

    const v2 = transformForSubSlide(src, 2);
    expect(v2).toContain("- Advantages");
    expect(v2).toContain("- Fast");
    expect(v2).not.toContain("- Disadvantages");
    expect(v2).not.toContain("- Complicated");

    const v3 = transformForSubSlide(src, 3);
    expect(v3).toContain("- Advantages");
    expect(v3).not.toContain("- Fast");
    expect(v3).toContain("- Disadvantages");
    expect(v3).not.toContain("- Complicated");

    const v4 = transformForSubSlide(src, 4);
    expect(v4).toContain("- Advantages");
    expect(v4).not.toContain("- Fast");
    expect(v4).toContain("- Disadvantages");
    expect(v4).toContain("- Complicated");
  });

  it("preserves indentation of bullets inside a matched span", () => {
    const src = `- Disadvantages\n\n<Sl.Span when="4">\n    - Complicated\n</Sl.Span>\n`;
    const s = transformForSubSlide(src, 4);
    expect(s).toMatch(/^    - Complicated/m);
  });
});

describe("normalizeIndentedCode", () => {
  it("rewrites indented code blocks to fenced ones", () => {
    const src = `# Code

Here:

    int main() {
      return 0;
    }
`;
    const out = normalizeIndentedCode(src);
    expect(out).toContain("```");
    expect(out).toContain("int main() {");
    expect(out).not.toMatch(/^    int main/m);
  });

  it("leaves fenced code blocks alone", () => {
    const src = "```\nx = 1\n```\n";
    expect(normalizeIndentedCode(src)).toBe(src);
  });
});

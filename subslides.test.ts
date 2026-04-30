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

  it("counts Pause markers", () => {
    const src = `# A\n\n- one\n<Pause/>\n- two\n<Pause/>\n- three\n`;
    expect(countSubSlides(src)).toBe(3);
  });

  it("respects SubSlide when ranges", () => {
    const src = `# A\n\n<SubSlide when="3">x</SubSlide>\n`;
    expect(countSubSlides(src)).toBe(3);
  });

  it("combines Pause and SubSlide bounds", () => {
    const src = `# A\n\n- one\n<Pause/>\n- two\n\n<SubSlide when="4">late</SubSlide>\n`;
    expect(countSubSlides(src)).toBe(4);
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

  it("does not corrupt indented JSX inside list items", () => {
    const src = `- Advantages\n\n  <SubSlide when="2">\n  - Fast\n  </SubSlide>\n`;
    const out = normalizeIndentedCode(src);
    expect(out).toBe(src);
  });
});

describe("transformForSubSlide", () => {
  it("hides content after the n-th Pause", () => {
    const src = `# A\n\n- one\n<Pause/>\n- two\n`;
    const s1 = transformForSubSlide(src, 1);
    expect(s1).toContain("- one");
    expect(s1).toContain('<div style={{visibility: "hidden"}}>');
    expect(s1).toContain("- two");
    expect(s1).not.toContain("<Pause/>");
  });

  it("shows everything when n exceeds the Pause count", () => {
    const src = `# A\n\n- one\n<Pause/>\n- two\n`;
    const s2 = transformForSubSlide(src, 2);
    expect(s2).toContain("- one");
    expect(s2).toContain("- two");
    expect(s2).not.toContain("<Pause/>");
    expect(s2).not.toContain("visibility");
  });

  it("leaves SubSlide tags in source for the component to handle", () => {
    const src = `# A\n\n<SubSlide when="2">x</SubSlide>\n`;
    const s = transformForSubSlide(src, 1);
    expect(s).toContain('<SubSlide when="2">');
  });
});

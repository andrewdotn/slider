import { describe, it, expect } from "vitest";
import { slugify, parseTalk } from "./slides.ts";

describe("slugify", () => {
  it("lowercases and replaces spaces with hyphens", () => {
    expect(slugify("Getting Started")).toBe("getting-started");
  });

  it("removes question marks", () => {
    expect(slugify("Why TypeScript?")).toBe("why-typescript");
  });

  it("removes other special characters", () => {
    expect(slugify("What's next! (for real)")).toBe("whats-next-for-real");
  });

  it("collapses multiple hyphens", () => {
    expect(slugify("foo  --  bar")).toBe("foo-bar");
  });

  it("trims leading and trailing hyphens", () => {
    expect(slugify("?hello?")).toBe("hello");
  });
});

describe("parseTalk duplicate slugs", () => {
  it("appends suffix to duplicate slide titles", () => {
    const md = `# Talk Title

## Summary

First summary

## Details

Some details

## Summary

Second summary`;

    const slides = parseTalk(md);
    const slugs = slides.map((s) => s.slug);
    expect(slugs).toEqual(["", "summary", "details", "summary-2"]);
  });

  it("starts a new slide on <Break/>", () => {
    const md = `# Talk

## Summary

First half

<Break/>

Second half`;

    const slides = parseTalk(md);
    expect(slides).toHaveLength(3);
    expect(slides[1].slug).toBe("summary");
    expect(slides[1].content).toContain("First half");
    expect(slides[1].content).not.toContain("<Break/>");
    expect(slides[2].slug).toBe("summary-2");
    expect(slides[2].content).toContain("Second half");
    expect(slides[2].level).toBe(slides[1].level);
  });

  it("supports multiple <Break/> tags within one section", () => {
    const md = `# Talk

## Intro

a

<Break/>

b

<Break/>

c`;

    const slides = parseTalk(md);
    expect(slides.map((s) => s.slug)).toEqual([
      "",
      "intro",
      "intro-2",
      "intro-3",
    ]);
  });

  it("uses 'slide' as fallback slug when <Break/> appears before any heading", () => {
    const md = `intro paragraph

<Break/>

after`;

    const slides = parseTalk(md);
    expect(slides.map((s) => s.slug)).toEqual(["", "slide"]);
  });

  it("handles three duplicate titles", () => {
    const md = `# Talk

## Intro

a

## Intro

b

## Intro

c`;

    const slides = parseTalk(md);
    const slugs = slides.map((s) => s.slug);
    expect(slugs).toEqual(["", "intro", "intro-2", "intro-3"]);
  });
});

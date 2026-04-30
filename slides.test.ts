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

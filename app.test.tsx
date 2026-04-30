import { describe, it, expect } from "vitest";
import { evaluate } from "@mdx-js/mdx";
import * as runtime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { parseTalk } from "./slides.ts";
import {
  normalizeIndentedCode,
  transformForSubSlide,
} from "./subslides.tsx";

async function renderMdx(mdx: string, subIdx: number = 1): Promise<string> {
  const transformed = transformForSubSlide(
    normalizeIndentedCode(mdx),
    subIdx,
  );
  const { default: Content } = await evaluate(transformed, {
    ...(runtime as any),
  });
  return renderToStaticMarkup(<Content components={{}} />);
}

describe("MDX rendering", () => {
  it("renders a heading", async () => {
    const html = await renderMdx("# Hello");
    expect(html).to.contain("<h1>Hello</h1>");
  });

  it("renders emphasis", async () => {
    const html = await renderMdx("Here is *the code*");
    expect(html).to.contain("<em>the code</em>");
  });

  it("renders a list", async () => {
    const html = await renderMdx("- Reason 1\n- Reason 2");
    expect(html).to.contain("<li>Reason 1</li>");
    expect(html).to.contain("<li>Reason 2</li>");
  });

  it("renders slide content from parsed talk", async () => {
    const markdown = "# My Talk\n\nIntro\n\n## Details\n\nSome details";
    const slides = parseTalk(markdown);
    expect(slides).to.have.length(2);

    const html1 = await renderMdx(slides[0].content);
    expect(html1).to.contain("<h1>My Talk</h1>");
    expect(html1).to.contain("Intro");

    const html2 = await renderMdx(slides[1].content);
    expect(html2).to.contain("<h2>Details</h2>");
    expect(html2).to.contain("Some details");
  });

  it("renders Sl.Pause sub-slides cumulatively", async () => {
    const src = "# A\n\n- one\n<Sl.Pause/>\n- two\n";
    const html1 = await renderMdx(src, 1);
    expect(html1).toContain("one");
    expect(html1).not.toContain("two");

    const html2 = await renderMdx(src, 2);
    expect(html2).toContain("one");
    expect(html2).toContain("two");
  });

  it("renders Sl.Span tags using the when predicate", async () => {
    const src = '# A\n\n<Sl.Span when="2">later</Sl.Span>\n';
    const html1 = await renderMdx(src, 1);
    expect(html1).not.toContain("later");
    const html2 = await renderMdx(src, 2);
    expect(html2).toContain("later");
  });

  it("preserves curly braces in indented code blocks", async () => {
    const src = "# Code\n\n    int main() {\n      return 0;\n    }\n";
    const html = await renderMdx(src);
    expect(html).toContain("int main()");
    expect(html).toContain("{");
    expect(html).toContain("}");
  });

  it("renders Font tag as a scoped style element", async () => {
    const Font = ({ size }: { size: string }) => (
      <style>{`.slides article.current > * { zoom: ${size}; }`}</style>
    );
    const transformed = transformForSubSlide(
      normalizeIndentedCode('# A\n\n<Font size="70%"/>\n\nbody\n'),
      1,
    );
    const { default: Content } = await evaluate(transformed, {
      ...(runtime as any),
    });
    const html = renderToStaticMarkup(<Content components={{ Font }} />);
    expect(html).toContain("zoom: 70%");
    expect(html).toContain(".slides article.current");
    expect(html).toContain("body");
  });

  it("renders the sample-talk1 slides as MDX", async () => {
    const fs = await import("node:fs/promises");
    const markdown = await fs.readFile("sample-talk1.md", "utf-8");
    const slides = parseTalk(markdown);

    const html0 = await renderMdx(slides[0].content);
    expect(html0).to.contain("<h1>Sample talk</h1>");

    const motivation = slides.find((s) => s.slug === "motivation")!;
    const html1 = await renderMdx(motivation.content);
    expect(html1).to.contain("<h2>Motivation</h2>");
    expect(html1).to.contain("Reason 1");

    const gettingStarted = slides.find((s) => s.slug === "getting-started")!;
    const html2 = await renderMdx(gettingStarted.content);
    expect(html2).to.contain("<h2>Getting started</h2>");
    expect(html2).to.contain("<em>the code</em>");
  });
});

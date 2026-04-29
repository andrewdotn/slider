import { describe, it, expect } from "vitest";
import { evaluate } from "@mdx-js/mdx";
import * as runtime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { parseTalk } from "./slides.ts";

async function renderMdx(mdx: string): Promise<string> {
  const { default: Content } = await evaluate(mdx, {
    ...(runtime as any),
    format: "md",
  });
  return renderToStaticMarkup(<Content />);
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

  it("renders the sample-talk1 slides as MDX", async () => {
    const fs = await import("node:fs/promises");
    const markdown = await fs.readFile("sample-talk1.md", "utf-8");
    const slides = parseTalk(markdown);

    const html0 = await renderMdx(slides[0].content);
    expect(html0).to.contain("<h1>Sample talk</h1>");

    const html1 = await renderMdx(slides[1].content);
    expect(html1).to.contain("<h2>Motivation</h2>");
    expect(html1).to.contain("<li>Reason 1</li>");

    const html2 = await renderMdx(slides[2].content);
    expect(html2).to.contain("<h2>Getting started</h2>");
    expect(html2).to.contain("<em>the code</em>");
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render } from "vitest-browser-react";
import { App } from "./app";

const markdown =
  '# Slide 1\n\n<FileExcerpt src="hello/hello.c" lineHighlights={[/world/]} />\n';

const helloC = 'int main() {\n  printf("hello world\\n");\n  return 0;\n}\n';

beforeEach(() => {
  vi.restoreAllMocks();
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.endsWith("/talks-static/sample-talk1.md")) {
      return {
        ok: true,
        text: () => Promise.resolve(markdown),
      } as any;
    }
    if (url.endsWith("/talks-static/hello/hello.c")) {
      return {
        ok: true,
        text: () => Promise.resolve(helloC),
      } as any;
    }
    return { ok: false, status: 404, text: () => Promise.resolve("") } as any;
  }) as any;
});

describe("FileExcerpt", () => {
  it("loads the file and highlights matching lines", async () => {
    window.history.pushState({}, "", "/talks/sample-talk1/");
    const screen = await render(<App />);

    await expect.element(screen.getByText("hello world")).toBeVisible();

    // Locate the highlighted line via class.
    await expect
      .poll(() => document.querySelectorAll(".file-excerpt-hl").length)
      .toBeGreaterThan(0);

    const hl = document.querySelector(".file-excerpt-hl");
    expect(hl?.textContent).toContain("hello world");
  });

  it("renders read-only without a Run button when runMethod is omitted", async () => {
    window.history.pushState({}, "", "/talks/sample-talk1/");
    const screen = await render(<App />);

    await expect.element(screen.getByText("hello world")).toBeVisible();
    expect(document.querySelector(".file-excerpt-run")).toBeNull();
  });
});

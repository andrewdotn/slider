import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render } from "vitest-browser-react";
import { App } from "./app";

const markdown = `# Slide

Hello

<SubSlide when=4>
World
</SubSlide>
`;

beforeEach(() => {
  vi.restoreAllMocks();
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: true,
    text: () => Promise.resolve(markdown),
  }) as any;
});

describe("MDX errors", () => {
  it("displays the error in the page when MDX fails to compile", async () => {
    window.history.pushState({}, "", "/talks/sample-talk1/");
    const screen = await render(<App />);

    await expect.element(screen.getByText(/Unexpected character/i)).toBeVisible();
    await expect.element(screen.getByText(/Line 5/)).toBeVisible();
    await expect.element(screen.getByText(/SubSlide when=4/)).toBeVisible();
  });
});

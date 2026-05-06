import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render } from "vitest-browser-react";
import { userEvent } from "vitest/browser";
import { App } from "./app";

const markdown =
  "# Slide 1\n\nintro\n\n# Slide 2\n\nfirst\n<Sl.Pause/>\nsecond\n<Sl.Pause/>\nthird\n";

beforeEach(() => {
  vi.restoreAllMocks();
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: true,
    text: () => Promise.resolve(markdown),
  }) as any;
});

describe("Slide number indicator", () => {
  it("shows the slide number on the first slide", async () => {
    window.history.pushState({}, "", "/talks/sample-talk1/");
    const screen = await render(<App />);
    await expect.element(screen.getByText("Slide 1")).toBeVisible();
    const el = document.querySelector(".slide-number");
    expect(el?.textContent).toBe("1");
  });

  it("shows just the slide number on the first sub-slide", async () => {
    window.history.pushState({}, "", "/talks/sample-talk1/slide-2");
    const screen = await render(<App />);
    await expect.element(screen.getByText("Slide 2")).toBeVisible();
    const el = document.querySelector(".slide-number");
    expect(el?.textContent).toBe("2");
  });

  it("shows N.k for additional sub-slides", async () => {
    window.history.pushState({}, "", "/talks/sample-talk1/slide-2#2");
    const screen = await render(<App />);
    await expect.element(screen.getByText("Slide 2")).toBeVisible();
    const el = document.querySelector(".slide-number");
    expect(el?.textContent).toBe("2.2");

    window.history.pushState({}, "", "/talks/sample-talk1/slide-2#3");
    window.dispatchEvent(new PopStateEvent("popstate"));
    await userEvent.keyboard("");
    await new Promise((r) => setTimeout(r, 50));
    expect(document.querySelector(".slide-number")?.textContent).toBe("2.3");
  });
});

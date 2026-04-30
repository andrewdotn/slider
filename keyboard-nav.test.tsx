import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render } from "vitest-browser-react";
import { userEvent } from "vitest/browser";
import { App } from "./app";

const markdown = "# Slide 1\n\n---\n\n# Slide 2";

beforeEach(() => {
  vi.restoreAllMocks();
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: true,
    text: () => Promise.resolve(markdown),
  }) as any;
});

describe("Keyboard Navigation", () => {
  it("should navigate to next slide on ArrowRight", async () => {
    window.history.pushState({}, "", "/talks/sample-talk1/");
    const screen = await render(<App />);

    await expect.element(screen.getByText("Slide 1")).toBeVisible();

    const pushStateSpy = vi.spyOn(window.history, "pushState");
    await userEvent.keyboard("{ArrowRight}");

    expect(pushStateSpy).toHaveBeenCalledWith(
      expect.anything(),
      "",
      "/talks/sample-talk1/slide-2",
    );
  });

  it("should navigate to next same-level slide on ArrowDown", async () => {
    window.history.pushState({}, "", "/talks/sample-talk1/");
    const screen = await render(<App />);

    await expect.element(screen.getByText("Slide 1")).toBeVisible();

    const pushStateSpy = vi.spyOn(window.history, "pushState");
    await userEvent.keyboard("{ArrowDown}");

    expect(pushStateSpy).toHaveBeenCalledWith(
      expect.anything(),
      "",
      "/talks/sample-talk1/slide-2",
    );
  });

  it("should navigate to previous slide on ArrowLeft", async () => {
    window.history.pushState({}, "", "/talks/sample-talk1/slide-2");
    const screen = await render(<App />);

    await expect.element(screen.getByText("Slide 2")).toBeVisible();

    const pushStateSpy = vi.spyOn(window.history, "pushState");
    await userEvent.keyboard("{ArrowLeft}");

    expect(pushStateSpy).toHaveBeenCalledWith(
      expect.anything(),
      "",
      "/talks/sample-talk1/",
    );
  });
});

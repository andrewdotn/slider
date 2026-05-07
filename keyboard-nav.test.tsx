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

  it("should not navigate when focus is inside a CodeMirror editor", async () => {
    window.history.pushState({}, "", "/talks/sample-talk1/");
    const screen = await render(<App />);

    await expect.element(screen.getByText("Slide 1")).toBeVisible();

    const cm = document.createElement("div");
    cm.className = "cm-editor";
    const input = document.createElement("input");
    cm.appendChild(input);
    document.body.appendChild(cm);
    input.focus();

    const pushStateSpy = vi.spyOn(window.history, "pushState");
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
    );

    expect(pushStateSpy).not.toHaveBeenCalled();
    document.body.removeChild(cm);
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

  it("toggles laser mode on 'l'", async () => {
    window.history.pushState({}, "", "/talks/sample-talk1/");
    const screen = await render(<App />);

    await expect.element(screen.getByText("Slide 1")).toBeVisible();

    expect(document.querySelector('[data-testid="laser-overlay"]')).toBeNull();

    await userEvent.keyboard("l");

    await expect
      .element(screen.getByTestId("laser-overlay"))
      .toBeInTheDocument();

    await userEvent.keyboard("l");
    expect(document.querySelector('[data-testid="laser-overlay"]')).toBeNull();
  });

  it("laser overlay captures pointer events so it tracks above iframes", async () => {
    window.history.pushState({}, "", "/talks/sample-talk1/");
    const screen = await render(<App />);

    await expect.element(screen.getByText("Slide 1")).toBeVisible();
    await userEvent.keyboard("l");

    const overlay = document.querySelector(
      '[data-testid="laser-overlay"]',
    ) as HTMLElement | null;
    expect(overlay).not.toBeNull();
    expect(overlay!.style.pointerEvents).toBe("auto");
  });

  it("forwards clicks through the laser overlay to elements beneath", async () => {
    window.history.pushState({}, "", "/talks/sample-talk1/");
    const screen = await render(<App />);

    await expect.element(screen.getByText("Slide 1")).toBeVisible();

    const btn = document.createElement("button");
    btn.textContent = "underneath";
    btn.style.position = "fixed";
    btn.style.left = "100px";
    btn.style.top = "100px";
    btn.style.width = "80px";
    btn.style.height = "30px";
    btn.style.zIndex = "1";
    const onClick = vi.fn();
    btn.addEventListener("click", onClick);
    document.body.appendChild(btn);

    await userEvent.keyboard("l");

    const overlay = document.querySelector(
      '[data-testid="laser-overlay"]',
    ) as HTMLElement | null;
    expect(overlay).not.toBeNull();

    overlay!.dispatchEvent(
      new MouseEvent("click", {
        bubbles: true,
        clientX: 140,
        clientY: 115,
      }),
    );

    expect(onClick).toHaveBeenCalled();
    document.body.removeChild(btn);
  });

  it("toggles fullscreen on 'f'", async () => {
    window.history.pushState({}, "", "/talks/sample-talk1/");
    const screen = await render(<App />);

    await expect.element(screen.getByText("Slide 1")).toBeVisible();

    const requestFullscreen = vi
      .fn()
      .mockImplementation(function (this: Element) {
        Object.defineProperty(document, "fullscreenElement", {
          value: this,
          configurable: true,
        });
        return Promise.resolve();
      });
    const exitFullscreen = vi.fn().mockImplementation(() => {
      Object.defineProperty(document, "fullscreenElement", {
        value: null,
        configurable: true,
      });
      return Promise.resolve();
    });
    document.documentElement.requestFullscreen = requestFullscreen;
    document.exitFullscreen = exitFullscreen;
    Object.defineProperty(document, "fullscreenElement", {
      value: null,
      configurable: true,
    });

    await userEvent.keyboard("f");
    expect(requestFullscreen).toHaveBeenCalled();

    await userEvent.keyboard("f");
    expect(exitFullscreen).toHaveBeenCalled();
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render } from "vitest-browser-react";
import { userEvent } from "vitest/browser";
import { App } from "./app";

const markdown =
  '# Slide 1\n\n<Frame src="https://example.org/" fallback="sample-img.png" />\n';

beforeEach(() => {
  vi.restoreAllMocks();
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.endsWith("/talks-static/sample-talk1.md")) {
      return { ok: true, text: () => Promise.resolve(markdown) } as any;
    }
    return { ok: false, status: 404, text: () => Promise.resolve("") } as any;
  }) as any;
});

describe("Frame", () => {
  it("renders a sandboxed iframe by default", async () => {
    window.history.pushState({}, "", "/talks/sample-talk1/");
    await render(<App />);

    await expect
      .poll(() => document.querySelector("iframe.frame-iframe"))
      .not.toBeNull();

    const iframe = document.querySelector(
      "iframe.frame-iframe",
    ) as HTMLIFrameElement;
    expect(iframe.getAttribute("src")).toBe("https://example.org/");
    // Empty sandbox attribute = maximally restricted (no permissions).
    expect(iframe.getAttribute("sandbox")).toBe("");
    // Must NOT grant same-origin access — slide JS runs as the user.
    expect(iframe.getAttribute("sandbox") ?? "").not.toContain(
      "allow-same-origin",
    );
  });

  it("renders a QR code for the frame's source URL", async () => {
    window.history.pushState({}, "", "/talks/sample-talk1/");
    await render(<App />);

    await expect
      .poll(() => document.querySelector("img.frame-qr"))
      .not.toBeNull();
    const qr = document.querySelector("img.frame-qr") as HTMLImageElement;
    expect(qr.getAttribute("src") ?? "").toMatch(/^data:image\/png/);
    expect(qr.getAttribute("alt")).toContain("https://example.org/");
  });

  it("shows the fallback image when offline mode is on", async () => {
    window.history.pushState({}, "", "/talks/sample-talk1/");
    await render(<App />);

    await expect
      .poll(() => document.querySelector("iframe.frame-iframe"))
      .not.toBeNull();
    expect(document.querySelector("img.frame-fallback")).toBeNull();

    await userEvent.keyboard("o");

    await expect
      .poll(() => document.querySelector("img.frame-fallback"))
      .not.toBeNull();
    const img = document.querySelector(
      "img.frame-fallback",
    ) as HTMLImageElement;
    expect(img.getAttribute("src")).toBe("/talks-static/sample-img.png");
    expect(document.querySelector("iframe.frame-iframe")).toBeNull();

    // Toggle off — iframe returns.
    await userEvent.keyboard("o");
    await expect
      .poll(() => document.querySelector("iframe.frame-iframe"))
      .not.toBeNull();
  });
});

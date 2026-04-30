import { describe } from "vitest";
import { test } from "./server.test.ts";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { chromium } from "playwright";

async function waitForText(
  page: import("playwright").Page,
  selector: string,
  text: string,
  timeout = 10000,
) {
  await page.waitForFunction(
    ({ selector, text }) => {
      const el = document.querySelector(selector);
      return el?.textContent?.includes(text) ?? false;
    },
    { selector, text },
    { timeout },
  );
}

describe("live reload", () => {
  test("browser updates when md file changes via direct write", { timeout: 30000 }, async ({
    tmpdirBrowserServer,
  }) => {
    const {
      server: { url },
      tmpdir,
    } = await tmpdirBrowserServer;

    const talkFile = path.join(tmpdir, "live-test.md");
    await fs.writeFile(talkFile, "# Live Test\n\nOriginal content");

    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      await page.goto(`${url}/talks/live-test/`);
      await waitForText(page, ".slide", "Original content");

      await fs.writeFile(talkFile, "# Live Test\n\nUpdated content");

      await waitForText(page, ".slide", "Updated content");
    } finally {
      await browser.close();
    }
  });

  test("browser updates when md file is renamed into place (vim-style atomic write)", { timeout: 30000 }, async ({
    tmpdirBrowserServer,
  }) => {
    const {
      server: { url },
      tmpdir,
    } = await tmpdirBrowserServer;

    const talkFile = path.join(tmpdir, "vim-test.md");
    await fs.writeFile(talkFile, "# Vim Test\n\nBefore edit");

    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      await page.goto(`${url}/talks/vim-test/`);
      await waitForText(page, ".slide", "Before edit");

      // Simulate vim's atomic write: write to temp file, then rename into place
      const tempFile = path.join(tmpdir, "vim-test.md.tmp");
      await fs.writeFile(tempFile, "# Vim Test\n\nAfter edit");
      await fs.rename(tempFile, talkFile);

      await waitForText(page, ".slide", "After edit");
    } finally {
      await browser.close();
    }
  });
});

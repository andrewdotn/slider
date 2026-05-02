import { describe, expect } from "vitest";
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
  test(
    "browser refetches images when image files change",
    { timeout: 30000 },
    async ({ tmpdirBrowserServer }) => {
      const {
        server: { url },
        tmpdir,
      } = await tmpdirBrowserServer;

      // Two distinct 1x1 PNGs so we can verify the byte content actually
      // changed in the browser.
      const redPng = Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
        "base64",
      );
      const bluePng = Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
        "base64",
      );

      const imgFile = path.join(tmpdir, "live-img.png");
      await fs.writeFile(imgFile, redPng);
      await fs.writeFile(
        path.join(tmpdir, "img-test.md"),
        "# Image Test\n\n![](live-img.png)\n",
      );

      const browser = await chromium.launch();
      try {
        const page = await browser.newPage();
        await page.goto(`${url}/talks/img-test/`);
        await page.waitForSelector("article.current img");

        const initialSrc = await page.$eval(
          "article.current img",
          (el) => (el as HTMLImageElement).getAttribute("src") ?? "",
        );
        expect(initialSrc).toContain("/talks-static/live-img.png");

        await fs.writeFile(imgFile, bluePng);

        await page.waitForFunction(
          (initial) => {
            const el = document.querySelector(
              "article.current img",
            ) as HTMLImageElement | null;
            const src = el?.getAttribute("src") ?? "";
            return src !== initial && src.includes("/talks-static/live-img.png");
          },
          initialSrc,
          { timeout: 10000 },
        );
      } finally {
        await browser.close();
      }
    },
  );

  test(
    "browser updates when md file changes via direct write",
    { timeout: 30000 },
    async ({ tmpdirBrowserServer }) => {
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
        await waitForText(page, "article.current","Original content");

        await fs.writeFile(talkFile, "# Live Test\n\nUpdated content");

        await waitForText(page, "article.current","Updated content");
      } finally {
        await browser.close();
      }
    },
  );

  test(
    "browser updates when md file is renamed into place (vim-style atomic write)",
    { timeout: 30000 },
    async ({ tmpdirBrowserServer }) => {
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
        await waitForText(page, "article.current","Before edit");

        // Simulate vim's atomic write: write to temp file, then rename into place
        const tempFile = path.join(tmpdir, "vim-test.md.tmp");
        await fs.writeFile(tempFile, "# Vim Test\n\nAfter edit");
        await fs.rename(tempFile, talkFile);

        await waitForText(page, "article.current","After edit");
      } finally {
        await browser.close();
      }
    },
  );
});

import { describe } from "vitest";
import { test } from "./server.test.ts";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { chromium } from "playwright";

async function waitForText(
  page: import("playwright").Page,
  selector: string,
  text: string,
  timeout = 15000,
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

describe("FileExcerpt end-to-end", () => {
  test(
    "loads a file, runs Make, streams output, and edits flow into the temp dir",
    { timeout: 60000 },
    async ({ tmpdirBrowserServer }) => {
      const {
        server: { url },
        tmpdir,
      } = await tmpdirBrowserServer;

      const helloDir = path.join(tmpdir, "eval-hello");
      await fs.mkdir(helloDir, { recursive: true });
      await fs.writeFile(
        path.join(helloDir, "hello.c"),
        'int main(){ printf("hello world\\n"); }\n',
      );
      await fs.writeFile(
        path.join(helloDir, "Makefile"),
        "all:\n\t@cat hello.c\n\nclean:\n\t@true\n",
      );

      const md = [
        "# Demo",
        "",
        "## Run",
        "",
        '<FileExcerpt src="eval-hello/hello.c" lineHighlights={[/world/]} runMethod="Makefile" />',
        "",
      ].join("\n");
      await fs.writeFile(path.join(tmpdir, "demo.md"), md);

      const browser = await chromium.launch();
      try {
        const page = await browser.newPage();
        page.on("console", (msg) => {
          if (msg.type() === "error") {
            // surface browser errors in test output for easier debugging
            console.error("[browser]", msg.text());
          }
        });

        await page.goto(`${url}/talks/demo/run`);
        await waitForText(page, ".file-excerpt", "hello world");

        // The /world/ line should be highlighted.
        await page.waitForSelector(".file-excerpt-hl");
        const hlText = await page.$eval(
          ".file-excerpt-hl",
          (el) => el.textContent ?? "",
        );
        if (!hlText.includes("hello world")) {
          throw new Error(`expected highlight to include hello world, got: ${hlText}`);
        }

        // Edit the file content via CodeMirror.
        await page.click(".cm-content");
        await page.keyboard.press("Control+A");
        await page.keyboard.press("Delete");
        await page.keyboard.type('int main(){ printf("EDITED LINE\\n"); }\n');

        // Click Run.
        await page.click(".file-excerpt-run");

        // Wait for output to contain the edited content (Makefile cats hello.c).
        await waitForText(page, ".file-excerpt-output", "EDITED LINE");

        // Wait for run to finish.
        await page.waitForFunction(
          () => {
            const header = document.querySelector(
              ".file-excerpt-popup-header",
            );
            return header?.textContent?.includes("done") ?? false;
          },
          { timeout: 15000 },
        );

        // Open Manage menu and click Re-run; output is reset and rebuilt.
        await page.click('.file-excerpt-popup-header button:has-text("Manage")');
        await page.click(
          '.file-excerpt-menu button:has-text("Re-run")',
        );

        // Wait for output to clear, then to contain EDITED LINE again.
        await page.waitForFunction(
          () => {
            const out = document.querySelector(".file-excerpt-output");
            return (out?.textContent ?? "").trim() === "";
          },
          { timeout: 5000 },
        );
        await waitForText(page, ".file-excerpt-output", "EDITED LINE");
      } finally {
        await browser.close();
      }
    },
  );

  test(
    "without runMethod the excerpt is read-only and has no Run button",
    { timeout: 30000 },
    async ({ tmpdirBrowserServer }) => {
      const {
        server: { url },
        tmpdir,
      } = await tmpdirBrowserServer;

      const dir = path.join(tmpdir, "ro");
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, "x.c"), "int x = 1;\n");

      const md = [
        "# Demo",
        "",
        "## Show",
        "",
        '<FileExcerpt src="ro/x.c" lineHighlights={[/x/]} />',
        "",
      ].join("\n");
      await fs.writeFile(path.join(tmpdir, "ronly.md"), md);

      const browser = await chromium.launch();
      try {
        const page = await browser.newPage();
        await page.goto(`${url}/talks/ronly/show`);
        await waitForText(page, ".file-excerpt", "int x = 1");
        const hasRun = await page.$(".file-excerpt-run");
        if (hasRun) throw new Error("expected no Run button");
      } finally {
        await browser.close();
      }
    },
  );
});

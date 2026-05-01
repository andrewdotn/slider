import { describe } from "vitest";
import { test } from "./server.test.ts";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { chromium } from "playwright";

// CodeMirror's defaultKeymap binds Mod-a (Cmd on macOS, Ctrl elsewhere) to
// selectAll, while Ctrl-a on macOS is bound to cursorLineStart. Pick the
// modifier that matches the host the chromium browser inherits.
const selectAllShortcut = process.platform === "darwin" ? "Meta+A" : "Control+A";

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
        await page.keyboard.press(selectAllShortcut);
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
    "edits in CodeMirror persist across slide navigation until reload",
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
        "## First",
        "",
        '<FileExcerpt src="eval-hello/hello.c" runMethod="Makefile" />',
        "",
        "## Second",
        "",
        "Other slide.",
        "",
      ].join("\n");
      await fs.writeFile(path.join(tmpdir, "persist.md"), md);

      const browser = await chromium.launch();
      try {
        const page = await browser.newPage();
        page.on("console", (msg) => {
          if (msg.type() === "error") {
            console.error("[browser]", msg.text());
          }
        });

        await page.goto(`${url}/talks/persist/first`);
        await waitForText(page, ".file-excerpt", "hello world");

        // Edit the file content via CodeMirror.
        await page.click(".cm-content");
        await page.keyboard.press(selectAllShortcut);
        await page.keyboard.press("Delete");
        await page.keyboard.type('int main(){ printf("PERSISTED EDIT\\n"); }');
        await waitForText(page, ".cm-content", "PERSISTED EDIT");

        // SPA-navigate to the second slide, then back to the first.
        await page.evaluate(() => {
          history.pushState({}, "", "/talks/persist/second");
          window.dispatchEvent(new PopStateEvent("popstate"));
        });
        await page.waitForFunction(
          () => document.body.textContent?.includes("Other slide.") ?? false,
          { timeout: 10000 },
        );
        // Editor should be unmounted on the second slide.
        const cmOnSecond = await page.$(".cm-content");
        if (cmOnSecond) {
          throw new Error("expected no CodeMirror editor on second slide");
        }

        await page.evaluate(() => {
          history.pushState({}, "", "/talks/persist/first");
          window.dispatchEvent(new PopStateEvent("popstate"));
        });
        await waitForText(page, ".cm-content", "PERSISTED EDIT");

        // The original file content should not be visible in the editor.
        const cmText = await page.$eval(
          ".cm-content",
          (el) => el.textContent ?? "",
        );
        if (cmText.includes("hello world")) {
          throw new Error(
            `expected edits to persist; editor still shows original: ${cmText}`,
          );
        }

        // After a full page reload, the cache is cleared and original returns.
        await page.reload();
        await waitForText(page, ".cm-content", "hello world");
        const afterReload = await page.$eval(
          ".cm-content",
          (el) => el.textContent ?? "",
        );
        if (afterReload.includes("PERSISTED EDIT")) {
          throw new Error(
            `expected reload to clear edits; editor still shows: ${afterReload}`,
          );
        }
      } finally {
        await browser.close();
      }
    },
  );

  test(
    "streams output incrementally and shows elapsed time when done",
    { timeout: 60000 },
    async ({ tmpdirBrowserServer }) => {
      const {
        server: { url },
        tmpdir,
      } = await tmpdirBrowserServer;

      const dir = path.join(tmpdir, "incr");
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, "src.txt"), "x\n");
      await fs.writeFile(
        path.join(dir, "Makefile"),
        "all:\n\t@echo 1; sleep 0.05; echo 2; sleep 0.05; echo 3\nclean:\n\t@true\n",
      );

      const md = [
        "# Demo",
        "",
        "## Run",
        "",
        '<FileExcerpt src="incr/src.txt" runMethod="Makefile" />',
        "",
      ].join("\n");
      await fs.writeFile(path.join(tmpdir, "incr.md"), md);

      const browser = await chromium.launch();
      try {
        const page = await browser.newPage();
        page.on("console", (msg) => {
          if (msg.type() === "error")
            console.error("[browser]", msg.text());
        });

        await page.goto(`${url}/talks/incr/run`);
        await waitForText(page, ".file-excerpt", "x");
        await page.click(".file-excerpt-run");

        // As soon as "1" appears, "3" should not yet be present (proves
        // we're rendering before the process exits).
        await page.waitForFunction(
          () => {
            const out = document.querySelector(".file-excerpt-output");
            return (out?.textContent ?? "").includes("1");
          },
          { timeout: 5000 },
        );
        const earlyText = await page.$eval(
          ".file-excerpt-output",
          (el) => el.textContent ?? "",
        );
        if (earlyText.includes("3")) {
          throw new Error(
            `output not incremental — saw "3" before run finished: ${earlyText}`,
          );
        }

        await waitForText(page, ".file-excerpt-output", "3");

        // Header should show "done (exit 0) in N.NNNs".
        await page.waitForFunction(
          () => {
            const h = document.querySelector(".file-excerpt-popup-header");
            return /done \(exit 0\) in \d+\.\d{1,3}s/.test(
              h?.textContent ?? "",
            );
          },
          { timeout: 10000 },
        );
      } finally {
        await browser.close();
      }
    },
  );

  test(
    "Manage menu toggles per-line timestamp prefixes",
    { timeout: 60000 },
    async ({ tmpdirBrowserServer }) => {
      const {
        server: { url },
        tmpdir,
      } = await tmpdirBrowserServer;

      const dir = path.join(tmpdir, "tsdir");
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, "src.txt"), "x\n");
      await fs.writeFile(
        path.join(dir, "Makefile"),
        "all:\n\t@echo 1; sleep 0.05; echo 2; sleep 0.05; echo 3\nclean:\n\t@true\n",
      );

      const md = [
        "# Demo",
        "",
        "## Run",
        "",
        '<FileExcerpt src="tsdir/src.txt" runMethod="Makefile" />',
        "",
      ].join("\n");
      await fs.writeFile(path.join(tmpdir, "tsdemo.md"), md);

      const browser = await chromium.launch();
      try {
        const page = await browser.newPage();
        await page.goto(`${url}/talks/tsdemo/run`);
        await waitForText(page, ".file-excerpt", "x");
        await page.click(".file-excerpt-run");
        await waitForText(page, ".file-excerpt-output", "3");
        await page.waitForFunction(
          () =>
            document
              .querySelector(".file-excerpt-popup-header")
              ?.textContent?.includes("done") ?? false,
          { timeout: 10000 },
        );

        // Toggle on.
        await page.click(
          '.file-excerpt-popup-header button:has-text("Manage")',
        );
        await page.click(
          '.file-excerpt-menu button:has-text("Show timestamps")',
        );
        await page.waitForFunction(
          () => {
            const out = document.querySelector(".file-excerpt-output");
            return /^\+0\.\d{3}s\s+1/m.test(out?.textContent ?? "");
          },
          { timeout: 5000 },
        );

        // Toggle off.
        await page.click(
          '.file-excerpt-popup-header button:has-text("Manage")',
        );
        await page.click(
          '.file-excerpt-menu button:has-text("Hide timestamps")',
        );
        await page.waitForFunction(
          () => {
            const out = document.querySelector(".file-excerpt-output");
            const txt = out?.textContent ?? "";
            return txt.includes("1") && !/\+0\.\d{3}s/.test(txt);
          },
          { timeout: 5000 },
        );
      } finally {
        await browser.close();
      }
    },
  );

  test(
    "make clean failure surfaces in the popup with exit code and duration",
    { timeout: 60000 },
    async ({ tmpdirBrowserServer }) => {
      const {
        server: { url },
        tmpdir,
      } = await tmpdirBrowserServer;

      const dir = path.join(tmpdir, "broken");
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, "src.txt"), "x\n");
      await fs.writeFile(
        path.join(dir, "Makefile"),
        "clean:\n\t@echo cleaning failed >&2\n\t@exit 7\nall:\n\t@true\n",
      );

      const md = [
        "# Demo",
        "",
        "## Run",
        "",
        '<FileExcerpt src="broken/src.txt" runMethod="Makefile" />',
        "",
      ].join("\n");
      await fs.writeFile(path.join(tmpdir, "broken.md"), md);

      const browser = await chromium.launch();
      try {
        const page = await browser.newPage();
        await page.goto(`${url}/talks/broken/run`);
        await waitForText(page, ".file-excerpt", "x");
        await page.click(".file-excerpt-run");

        await waitForText(page, ".file-excerpt-output", "cleaning failed");
        await page.waitForFunction(
          () => {
            const h = document.querySelector(".file-excerpt-popup-header");
            const m = /done \(exit (\d+)\) in \d+\.\d{1,3}s/.exec(
              h?.textContent ?? "",
            );
            return m !== null && m[1] !== "0";
          },
          { timeout: 10000 },
        );
      } finally {
        await browser.close();
      }
    },
  );

  test(
    "Manage menu can show captured make clean output and switch back",
    { timeout: 60000 },
    async ({ tmpdirBrowserServer }) => {
      const {
        server: { url },
        tmpdir,
      } = await tmpdirBrowserServer;

      const dir = path.join(tmpdir, "cleanok");
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, "src.txt"), "x\n");
      await fs.writeFile(
        path.join(dir, "Makefile"),
        "all:\n\t@echo built\nclean:\n\t@echo CLEANED\n",
      );

      const md = [
        "# Demo",
        "",
        "## Run",
        "",
        '<FileExcerpt src="cleanok/src.txt" runMethod="Makefile" />',
        "",
      ].join("\n");
      await fs.writeFile(path.join(tmpdir, "cleanok.md"), md);

      const browser = await chromium.launch();
      try {
        const page = await browser.newPage();
        await page.goto(`${url}/talks/cleanok/run`);
        await waitForText(page, ".file-excerpt", "x");
        await page.click(".file-excerpt-run");
        await waitForText(page, ".file-excerpt-output", "built");
        await page.waitForFunction(
          () =>
            document
              .querySelector(".file-excerpt-popup-header")
              ?.textContent?.includes("done") ?? false,
          { timeout: 10000 },
        );

        // make clean output should NOT appear in live output.
        const liveText = await page.$eval(
          ".file-excerpt-output",
          (el) => el.textContent ?? "",
        );
        if (liveText.includes("CLEANED")) {
          throw new Error(
            `make clean output leaked into live stream: ${liveText}`,
          );
        }

        // Open menu and switch to make-clean view.
        await page.click(
          '.file-excerpt-popup-header button:has-text("Manage")',
        );
        await page.click(
          '.file-excerpt-menu button:has-text("Show `make clean` output")',
        );
        await page.waitForFunction(
          () =>
            (
              document.querySelector("textarea.file-excerpt-output") as
                | HTMLTextAreaElement
                | null
            )?.value?.includes("CLEANED") ?? false,
          { timeout: 5000 },
        );

        // Switch back.
        await page.click(
          '.file-excerpt-popup-header button:has-text("Manage")',
        );
        await page.click(
          '.file-excerpt-menu button:has-text("Show `make` output")',
        );
        await page.waitForFunction(
          () =>
            !!document.querySelector("pre.file-excerpt-output") &&
            !document.querySelector("textarea.file-excerpt-output"),
          { timeout: 5000 },
        );
      } finally {
        await browser.close();
      }
    },
  );

  test(
    "popup toolbar exposes play/stop and font-size buttons with tooltips",
    { timeout: 60000 },
    async ({ tmpdirBrowserServer }) => {
      const {
        server: { url },
        tmpdir,
      } = await tmpdirBrowserServer;

      const dir = path.join(tmpdir, "tb");
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, "src.txt"), "x\n");
      await fs.writeFile(
        path.join(dir, "Makefile"),
        "all:\n\t@echo hi\nclean:\n\t@true\n",
      );

      const md = [
        "# Demo",
        "",
        "## Run",
        "",
        '<FileExcerpt src="tb/src.txt" runMethod="Makefile" />',
        "",
      ].join("\n");
      await fs.writeFile(path.join(tmpdir, "tbdemo.md"), md);

      const browser = await chromium.launch();
      try {
        const page = await browser.newPage();
        await page.goto(`${url}/talks/tbdemo/run`);
        await waitForText(page, ".file-excerpt", "x");
        await page.click(".file-excerpt-run");
        await waitForText(page, ".file-excerpt-output", "hi");
        await page.waitForFunction(
          () =>
            document
              .querySelector(".file-excerpt-popup-header")
              ?.textContent?.includes("done") ?? false,
          { timeout: 10000 },
        );

        // Toolbar buttons exist with tooltips.
        for (const title of ["Re-run", "Increase font size", "Decrease font size"]) {
          const sel = `.file-excerpt-popup-header button[title="${title}"]`;
          const found = await page.$(sel);
          if (!found) throw new Error(`expected toolbar button: ${title}`);
        }

        // Initial output font-size is 12px.
        const initial = await page.$eval(
          "pre.file-excerpt-output",
          (el) => (el as HTMLElement).style.fontSize,
        );
        if (initial !== "12px") {
          throw new Error(`expected initial font-size 12px, got ${initial}`);
        }

        // A+ increases.
        await page.click(
          '.file-excerpt-popup-header button[title="Increase font size"]',
        );
        await page.waitForFunction(
          () =>
            (document.querySelector("pre.file-excerpt-output") as HTMLElement)
              ?.style.fontSize === "14px",
          { timeout: 2000 },
        );

        // A- decreases.
        await page.click(
          '.file-excerpt-popup-header button[title="Decrease font size"]',
        );
        await page.waitForFunction(
          () =>
            (document.querySelector("pre.file-excerpt-output") as HTMLElement)
              ?.style.fontSize === "12px",
          { timeout: 2000 },
        );
      } finally {
        await browser.close();
      }
    },
  );

  test(
    "play toolbar button toggles to stop while running and re-runs when idle",
    { timeout: 60000 },
    async ({ tmpdirBrowserServer }) => {
      const {
        server: { url },
        tmpdir,
      } = await tmpdirBrowserServer;

      const dir = path.join(tmpdir, "pl");
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, "src.txt"), "x\n");
      await fs.writeFile(
        path.join(dir, "Makefile"),
        "all:\n\t@echo START; sleep 5; echo END\nclean:\n\t@true\n",
      );

      const md = [
        "# Demo",
        "",
        "## Run",
        "",
        '<FileExcerpt src="pl/src.txt" runMethod="Makefile" />',
        "",
      ].join("\n");
      await fs.writeFile(path.join(tmpdir, "pldemo.md"), md);

      const browser = await chromium.launch();
      try {
        const page = await browser.newPage();
        await page.goto(`${url}/talks/pldemo/run`);
        await waitForText(page, ".file-excerpt", "x");
        await page.click(".file-excerpt-run");
        await waitForText(page, ".file-excerpt-output", "START");

        // While running, toolbar's play button shows Stop.
        await page.waitForSelector(
          '.file-excerpt-popup-header button[title="Stop"]',
          { timeout: 5000 },
        );
        await page.click(
          '.file-excerpt-popup-header button[title="Stop"]',
        );

        // After kill, header shows done and button reverts to Re-run.
        await page.waitForFunction(
          () =>
            document
              .querySelector(".file-excerpt-popup-header")
              ?.textContent?.includes("done") ?? false,
          { timeout: 10000 },
        );
        await page.waitForSelector(
          '.file-excerpt-popup-header button[title="Re-run"]',
          { timeout: 5000 },
        );
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

import { describe } from "vitest";
import { test } from "./server.test.ts";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { chromium, webkit } from "playwright";

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

describe.concurrent("FileExcerpt end-to-end", () => {
  test.concurrent(
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

  test.concurrent(
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

  test.concurrent(
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

  test.concurrent(
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

  test.concurrent(
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

  test.concurrent(
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

  test.concurrent(
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

  test.concurrent(
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

  test.concurrent(
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

  test.concurrent(
    "clicking outside the editable area releases CodeMirror focus so arrows navigate (webkit)",
    { timeout: 60000 },
    async ({ tmpdirBrowserServer }) => {
      const {
        server: { url },
        tmpdir,
      } = await tmpdirBrowserServer;

      const dir = path.join(tmpdir, "blur");
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, "hello.c"), "int x = 1;\n");
      await fs.writeFile(
        path.join(dir, "Makefile"),
        "all:\n\t@true\nclean:\n\t@true\n",
      );

      const md = [
        "# Demo",
        "",
        "## First",
        "",
        '<FileExcerpt src="blur/hello.c" runMethod="Makefile" />',
        "",
        "## Second",
        "",
        "Other slide.",
        "",
      ].join("\n");
      await fs.writeFile(path.join(tmpdir, "blur.md"), md);

      const browser = await webkit.launch();
      try {
        const page = await browser.newPage();
        await page.setViewportSize({ width: 1280, height: 720 });
        page.on("console", (msg) => {
          if (msg.type() === "error") console.error("[browser]", msg.text());
        });

        await page.goto(`${url}/talks/blur/first`);
        await waitForText(page, ".file-excerpt", "int x = 1");

        // Focus CodeMirror.
        await page.click(".cm-content");
        const focusedAfterCmClick = await page.evaluate(
          () => !!document.activeElement?.closest(".cm-editor"),
        );
        if (!focusedAfterCmClick) throw new Error("CM did not take focus");

        // ArrowRight inside CM must not navigate.
        const urlBefore = page.url();
        await page.keyboard.press("ArrowRight");
        if (page.url() !== urlBefore) {
          throw new Error("Arrow key navigated while CM had focus");
        }

        // Click in the file-excerpt's bottom padding (outside the editor).
        const padPoint = await page.evaluate(() => {
          const fe = document.querySelector(".file-excerpt") as HTMLElement;
          const r = fe.getBoundingClientRect();
          return { x: r.left + r.width / 2, y: r.bottom - 2 };
        });
        await page.mouse.click(padPoint.x, padPoint.y);
        await page.waitForFunction(
          () => !document.activeElement?.closest(".cm-editor"),
          { timeout: 2000 },
        );

        // Now ArrowRight should navigate to the next slide.
        await page.keyboard.press("ArrowRight");
        await page.waitForFunction(
          () => location.pathname.endsWith("/second"),
          { timeout: 5000 },
        );

        // Re-focus and click the article's margin below the file-excerpt.
        await page.evaluate(() => {
          history.pushState({}, "", "/talks/blur/first");
          window.dispatchEvent(new PopStateEvent("popstate"));
        });
        await waitForText(page, ".cm-content", "int x = 1");
        await page.click(".cm-content");
        const articlePoint = await page.evaluate(() => {
          const fe = document.querySelector(".file-excerpt") as HTMLElement;
          const article = document.querySelector(
            "article.current",
          ) as HTMLElement;
          const fr = fe.getBoundingClientRect();
          const ar = article.getBoundingClientRect();
          return {
            x: fr.left + fr.width / 2,
            y: Math.min(fr.bottom + 30, ar.bottom - 5),
          };
        });
        await page.mouse.click(articlePoint.x, articlePoint.y);
        await page.waitForFunction(
          () => !document.activeElement?.closest(".cm-editor"),
          { timeout: 2000 },
        );

        // After clicking padding, focus should be off the editor.
        await page.waitForFunction(
          () => !document.activeElement?.closest(".cm-editor"),
          { timeout: 2000 },
        );

        // Now ArrowRight should navigate to the next slide.
        await page.keyboard.press("ArrowRight");
        await page.waitForFunction(
          () => location.pathname.endsWith("/second"),
          { timeout: 5000 },
        );
      } finally {
        await browser.close();
      }
    },
  );

  test.concurrent(
    "Run button is visible at the bottom of short file excerpts",
    { timeout: 30000 },
    async ({ tmpdirBrowserServer }) => {
      const {
        server: { url },
        tmpdir,
      } = await tmpdirBrowserServer;

      const dir = path.join(tmpdir, "short");
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, "s.c"), "int x = 1;\n");
      await fs.writeFile(
        path.join(dir, "Makefile"),
        "all:\n\t@echo done\n\nclean:\n\t@true\n",
      );

      const md = [
        "# Demo",
        "",
        "## Short",
        "",
        '<FileExcerpt src="short/s.c" runMethod="Makefile" />',
        "",
      ].join("\n");
      await fs.writeFile(path.join(tmpdir, "short-talk.md"), md);

      const browser = await chromium.launch();
      try {
        const page = await browser.newPage();
        await page.setViewportSize({ width: 1280, height: 720 });
        await page.goto(`${url}/talks/short-talk/short`);
        await waitForText(page, ".file-excerpt", "int x = 1");

        // The Run button must lie within the file-excerpt's box (not clipped
        // by overflow:hidden) and within the article's visible area.
        const ok = await page.evaluate(() => {
          const fe = document.querySelector(".file-excerpt") as HTMLElement;
          const a = document.querySelector("article.current") as HTMLElement;
          const b = document.querySelector(".file-excerpt-run") as HTMLElement;
          if (!fe || !a || !b) return false;
          const fr = fe.getBoundingClientRect();
          const ar = a.getBoundingClientRect();
          const br = b.getBoundingClientRect();
          return (
            br.bottom <= fr.bottom + 1 &&
            br.top >= fr.top - 1 &&
            br.bottom <= ar.bottom + 1 &&
            br.width > 0 &&
            br.height > 0
          );
        });
        if (!ok) throw new Error("Run button not visible inside short excerpt");
      } finally {
        await browser.close();
      }
    },
  );

  test.concurrent(
    "Run button and output popup stay in the visible portion of an overflowing slide",
    { timeout: 60000 },
    async ({ tmpdirBrowserServer }) => {
      const {
        server: { url },
        tmpdir,
      } = await tmpdirBrowserServer;

      const dir = path.join(tmpdir, "tall");
      await fs.mkdir(dir, { recursive: true });
      // A long file so the FileExcerpt overflows the slide vertically.
      const lines = Array.from({ length: 200 }, (_, i) => `int v${i} = ${i};`);
      await fs.writeFile(path.join(dir, "tall.c"), lines.join("\n") + "\n");
      await fs.writeFile(
        path.join(dir, "Makefile"),
        "all:\n\t@echo done\n\nclean:\n\t@true\n",
      );

      const md = [
        "# Demo",
        "",
        "## Tall",
        "",
        '<FileExcerpt src="tall/tall.c" runMethod="Makefile" />',
        "",
      ].join("\n");
      await fs.writeFile(path.join(tmpdir, "tall-talk.md"), md);

      const browser = await chromium.launch();
      try {
        const page = await browser.newPage();
        await page.setViewportSize({ width: 1280, height: 720 });
        await page.goto(`${url}/talks/tall-talk/tall`);
        await waitForText(page, ".file-excerpt", "v0 = 0");

        // Sanity: the article should actually be scrollable here.
        const scrollable = await page.evaluate(() => {
          const a = document.querySelector("article.current") as HTMLElement;
          return a ? a.scrollHeight > a.clientHeight + 5 : false;
        });
        if (!scrollable) throw new Error("expected article to overflow vertically");

        // The Run button should be inside the visible portion of the article
        // before any scrolling.
        const runVisibleBefore = await page.evaluate(() => {
          const a = document.querySelector("article.current") as HTMLElement;
          const b = document.querySelector(".file-excerpt-run") as HTMLElement;
          if (!a || !b) return null;
          const ar = a.getBoundingClientRect();
          const br = b.getBoundingClientRect();
          return br.bottom <= ar.bottom + 1 && br.top >= ar.top - 1;
        });
        if (!runVisibleBefore) throw new Error("Run button not visible before scroll");

        // Scroll the article to the bottom — the Run button should still be
        // inside the visible portion (not clipped at the bottom of content).
        await page.evaluate(() => {
          const a = document.querySelector("article.current") as HTMLElement;
          a.scrollTop = a.scrollHeight;
        });
        // Allow scroll handler to run.
        await page.waitForFunction(() => {
          const a = document.querySelector("article.current") as HTMLElement;
          const b = document.querySelector(".file-excerpt-run") as HTMLElement;
          if (!a || !b) return false;
          const ar = a.getBoundingClientRect();
          const br = b.getBoundingClientRect();
          return br.bottom <= ar.bottom + 1 && br.top >= ar.top - 1;
        }, { timeout: 5000 });

        // Open the popup; it should also be inside the visible portion.
        await page.click(".file-excerpt-run");
        await page.waitForSelector(".file-excerpt-popup");
        await page.waitForFunction(() => {
          const a = document.querySelector("article.current") as HTMLElement;
          const p = document.querySelector(".file-excerpt-popup") as HTMLElement;
          if (!a || !p) return false;
          const ar = a.getBoundingClientRect();
          const pr = p.getBoundingClientRect();
          return pr.bottom <= ar.bottom + 1 && pr.top >= ar.top - 1;
        }, { timeout: 5000 });

        // Scroll back to top — popup should still be in view.
        await page.evaluate(() => {
          const a = document.querySelector("article.current") as HTMLElement;
          a.scrollTop = 0;
        });
        await page.waitForFunction(() => {
          const a = document.querySelector("article.current") as HTMLElement;
          const p = document.querySelector(".file-excerpt-popup") as HTMLElement;
          if (!a || !p) return false;
          const ar = a.getBoundingClientRect();
          const pr = p.getBoundingClientRect();
          return pr.bottom <= ar.bottom + 1 && pr.top >= ar.top - 1;
        }, { timeout: 5000 });
      } finally {
        await browser.close();
      }
    },
  );

  test.concurrent(
    "Manage menu is visible on a large viewport",
    { timeout: 60000 },
    async ({ tmpdirBrowserServer }) => {
      const {
        server: { url },
        tmpdir,
      } = await tmpdirBrowserServer;

      const dir = path.join(tmpdir, "bigvp");
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, "src.txt"), "x\n");
      await fs.writeFile(
        path.join(dir, "Makefile"),
        "all:\n\t@echo done\nclean:\n\t@true\n",
      );
      const md = [
        "# Demo",
        "",
        "## Run",
        "",
        '<FileExcerpt src="bigvp/src.txt" runMethod="Makefile" />',
        "",
      ].join("\n");
      await fs.writeFile(path.join(tmpdir, "bigvp.md"), md);

      const browser = await chromium.launch();
      try {
        const page = await browser.newPage();
        await page.setViewportSize({ width: 2500, height: 1500 });
        await page.goto(`${url}/talks/bigvp/run`);
        await waitForText(page, ".file-excerpt", "x");
        await page.click(".file-excerpt-run");
        await page.waitForSelector(".file-excerpt-popup");
        await page.click(
          '.file-excerpt-popup-header button:has-text("Manage")',
        );
        const info = await page.evaluate(() => {
          const m = document.querySelector(
            ".file-excerpt-menu",
          ) as HTMLElement | null;
          if (!m) return { found: false } as const;
          const r = m.getBoundingClientRect();
          return {
            found: true,
            rect: { top: r.top, left: r.left, w: r.width, h: r.height },
            viewport: {
              w: window.innerWidth,
              h: window.innerHeight,
            },
          } as const;
        });
        if (!info.found) throw new Error("menu not in DOM");
        const r = info.rect;
        const v = info.viewport;
        // Menu must fit entirely within the viewport (and have nonzero size).
        if (
          r.w <= 0 ||
          r.h <= 0 ||
          r.top < 0 ||
          r.top + r.h > v.h + 1 ||
          r.left < 0 ||
          r.left + r.w > v.w + 1
        ) {
          throw new Error(
            "menu not fully visible on large viewport: " + JSON.stringify(info),
          );
        }
        // Also: the menu must be inside the popup so overflow:hidden doesn't
        // clip its bottom items.
        const popup = await page.evaluate(() => {
          const p = document.querySelector(
            ".file-excerpt-popup",
          ) as HTMLElement;
          const pr = p.getBoundingClientRect();
          return { top: pr.top, bottom: pr.bottom };
        });
        if (r.top + r.h > popup.bottom + 1) {
          throw new Error(
            "menu clipped by popup: " +
              JSON.stringify({ menu: info, popup }),
          );
        }
      } finally {
        await browser.close();
      }
    },
  );

  test.concurrent(
    "Manage menu remains visible after the window is resized wider",
    { timeout: 60000 },
    async ({ tmpdirBrowserServer }) => {
      const {
        server: { url },
        tmpdir,
      } = await tmpdirBrowserServer;

      const dir = path.join(tmpdir, "resz");
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, "src.txt"), "x\n");
      await fs.writeFile(
        path.join(dir, "Makefile"),
        "all:\n\t@echo done\nclean:\n\t@true\n",
      );
      await fs.writeFile(
        path.join(tmpdir, "resz.md"),
        [
          "# Demo",
          "",
          "## Run",
          "",
          '<FileExcerpt src="resz/src.txt" runMethod="Makefile" />',
          "",
        ].join("\n"),
      );

      const browser = await chromium.launch();
      try {
        const page = await browser.newPage();
        await page.setViewportSize({ width: 1400, height: 900 });
        await page.goto(`${url}/talks/resz/run`);
        await waitForText(page, ".file-excerpt", "x");
        await page.click(".file-excerpt-run");
        await page.waitForSelector(".file-excerpt-popup");
        await page.click(
          '.file-excerpt-popup-header button:has-text("Manage")',
        );
        await page.waitForSelector(".file-excerpt-menu");

        // Resize across the user-reported boundary; menu must stay visible
        // and repositioned (right-aligned to the Manage button) at every step.
        for (const w of [1500, 1700, 1900, 2200]) {
          await page.setViewportSize({ width: w, height: 900 });
          // Allow resize listeners and a layout tick.
          await page.waitForFunction(
            (vw) => window.innerWidth === vw,
            w,
            { timeout: 2000 },
          );
          // Let resize listeners flush and React commit the new menu position.
          await page.waitForTimeout(50);
          const info = await page.evaluate(() => {
            const m = document.querySelector(
              ".file-excerpt-menu",
            ) as HTMLElement | null;
            const btn = document.querySelector(
              '.file-excerpt-popup-header button[ref], .file-excerpt-popup-header button',
            );
            // Find Manage button by text.
            const manage = Array.from(
              document.querySelectorAll(".file-excerpt-popup-header button"),
            ).find((b) => b.textContent?.includes("Manage")) as HTMLElement;
            if (!m || !manage) return null;
            const mr = m.getBoundingClientRect();
            const br = manage.getBoundingClientRect();
            return {
              menu: { top: mr.top, right: mr.right, w: mr.width, h: mr.height },
              btn: { bottom: br.bottom, right: br.right },
              vp: { w: window.innerWidth, h: window.innerHeight },
              parent: m.parentElement?.tagName ?? null,
            };
          });
          if (!info) throw new Error(`menu missing at width ${w}`);
          if (info.menu.w <= 0 || info.menu.h <= 0) {
            throw new Error(
              `menu not visible at width ${w}: ${JSON.stringify(info)}`,
            );
          }
          // Menu's right edge should track the Manage button's right edge.
          if (Math.abs(info.menu.right - info.btn.right) > 2) {
            throw new Error(
              `menu right edge did not follow button at width ${w}: ` +
                JSON.stringify(info),
            );
          }
          // Menu should be portaled out of the popup so the popup's
          // overflow:hidden can't clip it (and Safari's scaled-ancestor
          // paint bug can't hide it).
          if (info.parent !== "BODY") {
            throw new Error(
              `expected menu portaled to <body>, got <${info.parent}> at width ${w}`,
            );
          }
        }
      } finally {
        await browser.close();
      }
    },
  );
});

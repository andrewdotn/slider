import { describe, expect } from "vitest";
import { test } from "./server.test.ts";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { chromium, type Page } from "playwright";

async function setupAndOpenShell(page: Page, url: string, tmpdir: string) {
  const helloDir = path.join(tmpdir, "eval-hello");
  await fs.mkdir(helloDir, { recursive: true });
  await fs.writeFile(
    path.join(helloDir, "hello.c"),
    'int main(){ printf("hi\\n"); }\n',
  );
  await fs.writeFile(
    path.join(helloDir, "Makefile"),
    "all:\n\t@cat hello.c\n",
  );
  const md = [
    "# Demo",
    "",
    "## Run",
    "",
    '<FileExcerpt src="eval-hello/hello.c" runMethod="Makefile" />',
    "",
  ].join("\n");
  await fs.writeFile(path.join(tmpdir, "demo.md"), md);

  await page.goto(`${url}/talks/demo/run`);
  await page.waitForSelector(".file-excerpt-run", { timeout: 15000 });
  await page.click(".file-excerpt-run");
  await page.waitForSelector(".file-excerpt-popup", { timeout: 15000 });
  await page.waitForFunction(
    () => {
      const h = document.querySelector(".file-excerpt-popup-header");
      return h?.textContent?.includes("done") ?? false;
    },
    { timeout: 15000 },
  );
  await page.click('.file-excerpt-popup-header button:has-text("Manage")');
  await page.click('.file-excerpt-menu button:has-text("Shell")');
  await page.waitForSelector(".file-excerpt-shell .xterm");
  await page.waitForTimeout(1500);
}

async function fillRulerAndProbe(page: Page) {
  await page.click(".file-excerpt-shell");
  // Print one char per column, width-aware. The output should fill exactly
  // one row before wrapping.
  await page.keyboard.type(
    "clear; cols=$(tput cols); printf 'COLS=%d\\n' $cols; for i in $(seq 1 $cols); do printf '%d' $((i % 10)); done; printf 'END\\n'\n",
  );
  await page.waitForTimeout(1000);

  return await page.evaluate(() => {
    const popup = document.querySelector(
      ".file-excerpt-popup",
    ) as HTMLElement | null;
    const shell = document.querySelector(
      ".file-excerpt-shell",
    ) as HTMLElement | null;
    const xterm = document.querySelector(
      ".file-excerpt-shell .xterm",
    ) as HTMLElement | null;
    const screen = document.querySelector(
      ".file-excerpt-shell .xterm-screen",
    ) as HTMLElement | null;
    const rows = Array.from(
      document.querySelectorAll(".file-excerpt-shell .xterm-rows > div"),
    ).map((d) => (d as HTMLElement).textContent ?? "");

const canvas = document.querySelector(
      ".file-excerpt-shell canvas",
    ) as HTMLCanvasElement | null;

    return {
      hasCanvas: !!canvas,
      canvasRect: canvas?.getBoundingClientRect().toJSON() ?? null,
      popupRect: popup?.getBoundingClientRect().toJSON(),
      shellRect: shell?.getBoundingClientRect().toJSON(),
      xtermRect: xterm?.getBoundingClientRect().toJSON(),
      screenRect: screen?.getBoundingClientRect().toJSON(),
      rows: rows.slice(0, 6),
      slideScale:
        getComputedStyle(document.documentElement).getPropertyValue(
          "--slide-scale",
        ) || null,
    };
  });
}

describe("shell terminal lifecycle", () => {
  test(
    "hide shell does not crash the page",
    { timeout: 60000 },
    async ({ tmpdirBrowserServer }) => {
      const {
        server: { url },
        tmpdir,
      } = await tmpdirBrowserServer;
      const browser = await chromium.launch();
      try {
        const page = await browser.newPage({
          viewport: { width: 1400, height: 900 },
        });
        const errors: string[] = [];
        page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
        page.on("console", (m) => {
          if (m.type() === "error") errors.push(`console: ${m.text()}`);
        });
        await setupAndOpenShell(page, url, tmpdir);
        // toggle Hide shell via Manage menu
        await page.click('.file-excerpt-popup-header button:has-text("Manage")');
        await page.click('.file-excerpt-menu button:has-text("Hide shell")');
        await page.waitForTimeout(500);
        // popup should still be alive — clicking Manage again should work
        await page.click('.file-excerpt-popup-header button:has-text("Manage")');
        await page.waitForSelector(".file-excerpt-menu", { timeout: 2000 });
        if (errors.length) {
          throw new Error("page errors:\n" + errors.join("\n"));
        }
      } finally {
        await browser.close();
      }
    },
  );
});

describe.concurrent("shell terminal width", () => {
  for (const vp of [
    { width: 1400, height: 900 },
    { width: 1920, height: 1080 },
    { width: 2560, height: 1440 },
    { width: 1024, height: 768 },
  ]) {
    test.concurrent(
      `fills popup width at viewport ${vp.width}x${vp.height}`,
      { timeout: 60000 },
      async ({ tmpdirBrowserServer }) => {
        const {
          server: { url },
          tmpdir,
        } = await tmpdirBrowserServer;

        const browser = await chromium.launch();
        try {
          const page = await browser.newPage({ viewport: vp });
          page.on("console", (m) => {
            if (m.type() === "error") console.error("[browser]", m.text());
          });

          await setupAndOpenShell(page, url, tmpdir);
          const probe = await fillRulerAndProbe(page);

          const writeArtifacts = async () => {
            const shotPath = path.join(
              process.cwd(),
              `shell-clip-${vp.width}x${vp.height}.png`,
            );
            const popupEl = await page.$(".file-excerpt-popup");
            if (popupEl) await popupEl.screenshot({ path: shotPath });
            await fs.writeFile(
              path.join(
                process.cwd(),
                `shell-clip-${vp.width}x${vp.height}.json`,
              ),
              JSON.stringify(probe, null, 2),
            );
          };

          // The terminal's render canvas should fill the popup width within
          // a small tolerance — otherwise either chars are clipped (canvas
          // wider than popup) or the terminal is under-filling (gap on the
          // right). The buffer should also contain the full ruler line
          // without truncation.
          expect(probe.hasCanvas).toBe(true);
          const popup = probe.popupRect as DOMRectInit & {
            right: number;
            left: number;
            width: number;
          };
          const canvas = probe.canvasRect as DOMRectInit & {
            right: number;
            left: number;
            width: number;
          };
          const overflow = canvas.right - popup.right;
          const underfill = popup.right - canvas.right;
          const tolerance = Math.max(20, popup.width * 0.04);
          if (overflow > tolerance) {
            await writeArtifacts();
            throw new Error(
              `canvas overflows popup right by ${overflow}px (tolerance ${tolerance}px); see shell-clip-${vp.width}x${vp.height}.{png,json}`,
            );
          }
          if (underfill > tolerance) {
            await writeArtifacts();
            throw new Error(
              `canvas under-fills popup, gap on right = ${underfill}px (tolerance ${tolerance}px); see shell-clip-${vp.width}x${vp.height}.{png,json}`,
            );
          }
          // Buffer row 1 (after COLS=N) should match printed ruler length.
          const colsLine = probe.rows[0] ?? "";
          const m = /COLS=(\d+)/.exec(colsLine);
          if (m) {
            const expected = parseInt(m[1], 10);
            const ruler = probe.rows[1] ?? "";
            expect(ruler.length).toBe(expected);
          }
        } finally {
          await browser.close();
        }
      },
    );
  }
});

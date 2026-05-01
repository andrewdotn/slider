import { describe, expect } from "vitest";
import { test } from "./server.test.ts";
import * as fs from "node:fs/promises";
import * as path from "node:path";

async function setupHelloTalk(tmpdir: string) {
  const helloDir = path.join(tmpdir, "hello");
  await fs.mkdir(helloDir, { recursive: true });
  await fs.writeFile(path.join(tmpdir, "demo.md"), "# Demo\n");
  await fs.writeFile(
    path.join(helloDir, "hello.c"),
    'int main(){ printf("hello world\\n"); }\n',
  );
  await fs.writeFile(
    path.join(helloDir, "Makefile"),
    "all:\n\t@echo built hello world\n\nclean:\n\t@true\n",
  );
}

async function readSse(
  url: string,
): Promise<{ chunks: { stream: string; text: string }[]; end: any }> {
  const res = await fetch(url);
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  const chunks: { stream: string; text: string }[] = [];
  let end: any = null;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const events = buf.split("\n\n");
    buf = events.pop() ?? "";
    for (const evt of events) {
      const lines = evt.split("\n");
      let event = "message";
      let data = "";
      for (const line of lines) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) data += line.slice(5).trim();
      }
      if (!data) continue;
      if (event === "end") {
        end = JSON.parse(data);
        return { chunks, end };
      }
      try {
        chunks.push(JSON.parse(data));
      } catch {
        // ignore
      }
    }
  }
  return { chunks, end };
}

describe("eval", () => {
  test("runs make and streams output", async ({ tmpdirServer }) => {
    const { server, tmpdir } = await tmpdirServer;
    await setupHelloTalk(tmpdir);

    const runRes = await fetch(
      `${server.url}/eval/demo/intro/cb1/run`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ src: "hello/hello.c" }),
      },
    );
    expect(runRes.status).to.equal(200);
    const { runId, tempDir } = await runRes.json();
    expect(runId).to.be.a("string");
    expect(tempDir).to.contain("temp-eval");

    const { chunks, end } = await readSse(
      `${server.url}/eval/demo/intro/cb1/output/${runId}`,
    );
    expect(end.exitCode).to.equal(0);
    const all = chunks.map((c) => c.text).join("");
    expect(all).to.contain("built hello world");

    // temp dir should still exist with copied files
    const files = await fs.readdir(tempDir);
    expect(files.sort()).to.deep.equal(["Makefile", "hello.c"]);
  });

  test("user edits override files in the temp dir", async ({ tmpdirServer }) => {
    const { server, tmpdir } = await tmpdirServer;
    await setupHelloTalk(tmpdir);

    const runRes = await fetch(
      `${server.url}/eval/demo/intro/cb1/run`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          src: "hello/hello.c",
          files: { "hello.c": "EDITED CONTENT" },
        }),
      },
    );
    const { tempDir } = await runRes.json();
    const written = await fs.readFile(path.join(tempDir, "hello.c"), "utf-8");
    expect(written).to.equal("EDITED CONTENT");
  });

  test("make clean failure surfaces buffered output", async ({
    tmpdirServer,
  }) => {
    const { server, tmpdir } = await tmpdirServer;
    const brokenDir = path.join(tmpdir, "broken");
    await fs.mkdir(brokenDir, { recursive: true });
    await fs.writeFile(path.join(tmpdir, "demo.md"), "# Demo\n");
    await fs.writeFile(path.join(brokenDir, "src.txt"), "x");
    await fs.writeFile(
      path.join(brokenDir, "Makefile"),
      "clean:\n\t@echo cleaning failed >&2\n\t@exit 7\nall:\n\t@true\n",
    );

    const runRes = await fetch(
      `${server.url}/eval/demo/intro/cb1/run`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ src: "broken/src.txt" }),
      },
    );
    const { runId } = await runRes.json();
    const { chunks, end } = await readSse(
      `${server.url}/eval/demo/intro/cb1/output/${runId}`,
    );
    expect(end.exitCode).to.not.equal(0);
    const all = chunks.map((c) => c.text).join("");
    expect(all).to.contain("cleaning failed");
  });

  test("LRU keeps only last 5 dirs per codeblock", async ({
    tmpdirServer,
  }) => {
    const { server, tmpdir } = await tmpdirServer;
    await setupHelloTalk(tmpdir);

    const runOnce = async () => {
      const r = await fetch(
        `${server.url}/eval/demo/intro/cb1/run`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ src: "hello/hello.c" }),
        },
      );
      const { runId } = await r.json();
      // wait for completion
      await readSse(`${server.url}/eval/demo/intro/cb1/output/${runId}`);
    };
    for (let i = 0; i < 7; i++) await runOnce();

    const tempEval = path.join(tmpdir, "temp-eval");
    const dirs = await fs.readdir(tempEval);
    const cb1Dirs = dirs.filter((d) => d.startsWith("demo-intro-cb1-"));
    expect(cb1Dirs.length).to.equal(5);
  });

  test("path traversal rejected", async ({ tmpdirServer }) => {
    const { server, tmpdir } = await tmpdirServer;
    await fs.writeFile(path.join(tmpdir, "demo.md"), "# Demo\n");

    const runRes = await fetch(
      `${server.url}/eval/demo/intro/cb1/run`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ src: "../../../etc/passwd" }),
      },
    );
    expect(runRes.status).to.equal(400);
  });

  test("close removes temp-eval dir", async ({ tmpdir }) => {
    const { Server } = await import("./server.ts");
    const server = new Server({ baseDir: tmpdir, isTest: true });
    await server.serve();
    const port = (server.listeningServer!.address() as any).port;
    await setupHelloTalk(tmpdir);
    const r = await fetch(
      `http://localhost:${port}/eval/demo/intro/cb1/run`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ src: "hello/hello.c" }),
      },
    );
    const { runId } = await r.json();
    await readSse(
      `http://localhost:${port}/eval/demo/intro/cb1/output/${runId}`,
    );

    const tempEval = path.join(tmpdir, "temp-eval");
    expect((await fs.readdir(tempEval)).length).to.be.greaterThan(0);

    await server.close();

    let exists = true;
    try {
      await fs.stat(tempEval);
    } catch {
      exists = false;
    }
    expect(exists).to.equal(false);
  });

  test("make-clean output endpoint returns clean output with ansi stripped", async ({ tmpdirServer }) => {
    const { server, tmpdir } = await tmpdirServer;
    const ansiDir = path.join(tmpdir, "ansi");
    await fs.mkdir(ansiDir, { recursive: true });
    await fs.writeFile(path.join(tmpdir, "demo.md"), "# Demo\n");
    await fs.writeFile(path.join(ansiDir, "x.txt"), "x");
    await fs.writeFile(
      path.join(ansiDir, "Makefile"),
      "all:\n\t@echo built\nclean:\n\t@printf '\\x1b[31mcleaning\\x1b[0m done\\n'\n",
    );

    const runRes = await fetch(
      `${server.url}/eval/demo/intro/cb1/run`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ src: "ansi/x.txt" }),
      },
    );
    const { runId } = await runRes.json();
    const { chunks } = await readSse(
      `${server.url}/eval/demo/intro/cb1/output/${runId}`,
    );

    // make clean output is NOT emitted to the live stream on success.
    const live = chunks.map((c) => c.text).join("");
    expect(live).to.not.contain("cleaning");
    expect(live).to.contain("built");

    const cleanRes = await fetch(
      `${server.url}/eval/demo/intro/cb1/output/${runId}/make-clean`,
    );
    const text = await cleanRes.text();
    expect(text).to.contain("cleaning done");
    expect(text).to.not.contain("\x1b");
  });
});

import { describe, it, expect, test as baseTest } from "vitest";
import { Server } from "./server.ts";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { i } from "./util/i.ts";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

async function createTestServer({
  baseDir,
  isTest,
  onCleanup,
}: {
  baseDir?: string;
  isTest?: boolean;
  onCleanup: (cb: () => void) => void;
}) {
  const server = new Server({ baseDir, isTest });
  const listeningServer = await server.serve();

  onCleanup(async () => {
    await server.close();
  });

  const address = listeningServer.address();
  if (address !== null && typeof address === "object") {
    const { port } = address;
    return { port, url: `http://localhost:${port}` };
  }
  throw new Error(i`unsure how to get port out of ${address}`);
}

export const test = baseTest
  .extend("tmpdir", async ({}, { onCleanup }) => {
    const tmpdir = await fs.mkdtemp(path.join(os.tmpdir(), "slider-test-"));
    onCleanup(async () => {
      await fs.rm(tmpdir, { recursive: true, force: true });
    });
    return tmpdir;
  })
  .extend("server", async ({}, { onCleanup }) => {
    return createTestServer({ onCleanup });
  })
  .extend("tmpdirServer", async ({ tmpdir }, { onCleanup }) => {
    const server = await createTestServer({ baseDir: tmpdir, onCleanup });
    return { server, tmpdir };
  })
  .extend("tmpdirBrowserServer", async ({ tmpdir }, { onCleanup }) => {
    const server = await createTestServer({
      baseDir: tmpdir,
      isTest: false,
      onCleanup,
    });
    return { server, tmpdir };
  });

describe("tsgo", () => {
  it("typechecks cleanly", async () => {
    const { stdout, stderr } = await promisify(execFile)(
      "node_modules/.bin/tsgo",
    );
    expect(stderr).to.equal("");
  });
});

describe("slider", () => {
  test("hello world", async ({ server }) => {
    expect(server.port).to.be.a("number");

    const res = await fetch(`${server.url}/hello`);
    expect(res.status).to.equal(200);
    const body = await res.text();
    expect(body).to.equal("Hello World!");
  });

  test("index lists md files", async ({ server }) => {
    const res = await fetch(`${server.url}/`);
    expect(res.status).to.equal(200);
    const body = await res.text();
    expect(body).to.contain("<ul>");
    expect(body).to.contain('<a href="/talks/sample-talk1/">sample-talk1</a>');
  });

  test("sample-talk1 slide 1 serves html page", async ({ server }) => {
    const res = await fetch(`${server.url}/talks/sample-talk1/`);
    expect(res.status).to.equal(200);
    expect(res.headers.get("content-type")).to.contain("text/html");
    const body = await res.text();
    expect(body).to.contain('<div id="root"></div>');
    expect(body).to.contain("/index.tsx");
  });

  test("sample-talk1 slide 2 serves html page", async ({ server }) => {
    const res = await fetch(`${server.url}/talks/sample-talk1/motivation`);
    expect(res.status).to.equal(200);
    expect(res.headers.get("content-type")).to.contain("text/html");
    const body = await res.text();
    expect(body).to.contain('<div id="root"></div>');
  });

  test("sample-talk1 slide 3 serves html page", async ({ server }) => {
    const res = await fetch(`${server.url}/talks/sample-talk1/getting-started`);
    expect(res.status).to.equal(200);
    const body = await res.text();
    expect(body).to.contain('<div id="root"></div>');
  });

  test("nonexistent talk returns 404", async ({ server }) => {
    const res = await fetch(`${server.url}/nonexistent/`);
    expect(res.status).to.equal(404);
  });

  test("nonexistent slide returns 404", async ({ server }) => {
    const res = await fetch(`${server.url}/talks/sample-talk1/no-such-slide`);
    expect(res.status).to.equal(404);
  });

  test("sample-talk1.md is served as static file", async ({ server }) => {
    const res = await fetch(`${server.url}/talks-static/sample-talk1.md`);
    expect(res.status).to.equal(200);
    const body = await res.text();
    expect(body).to.contain("# Sample talk");
    expect(body).to.contain("## Motivation");
  });

  test("listing slides with custom basedir", async ({ tmpdirServer }) => {
    const {
      server: { url },
      tmpdir,
    } = await tmpdirServer;
    const talkName = "test-talk";
    const talkContent = "# Test Talk\n\n## Slide 1\n\nhello";
    await fs.writeFile(path.join(tmpdir, `${talkName}.md`), talkContent);

    const res = await fetch(`${url}/`);
    const body = await res.text();
    expect(body).to.contain(talkName);
    // Ensure it's not showing files from the current directory
    expect(body).to.not.contain("sample-talk1");

    const resSlide = await fetch(`${url}/talks/${talkName}/`);
    expect(resSlide.status).to.equal(200);
    const slideBody = await resSlide.text();
    expect(slideBody).to.contain('<div id="root"></div>');

    const resStatic = await fetch(`${url}/talks-static/${talkName}.md`);
    expect(resStatic.status).to.equal(200);
    const staticBody = await resStatic.text();
    expect(staticBody).to.equal(talkContent);
  });
});

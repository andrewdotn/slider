import { describe, it, expect } from "vitest";

import { test as baseTest } from "vitest";
import { Server } from "./server.ts";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { i } from "./util/i.ts";

export const test = baseTest.extend("server", async ({}, { onCleanup }) => {
  const server = new Server();
  const listeningServer = await server.serve();

  onCleanup(async () => {
    const address = listeningServer.address();
    if (server.vite) await server.vite.close();
    await promisify(listeningServer.close.bind(listeningServer))();
    console.log(i`${address} server stopped`);
  });

  const address = listeningServer.address();
  if (address !== null && typeof address === "object") {
    const { port } = address;
    return { port, url: `http://localhost:${port}` };
  }
  throw new Error(i`unsure how to get port out of ${address}`);
});

describe("tsgo", () => {
  it("typechecks cleanly", async () => {
    const { stdout, stderr } = await promisify(execFile)("tsgo");
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
    expect(body).to.contain('<a href="/sample-talk1/">sample-talk1</a>');
  });

  test("sample-talk1 slide 1 serves html page", async ({ server }) => {
    const res = await fetch(`${server.url}/sample-talk1/`);
    expect(res.status).to.equal(200);
    expect(res.headers.get("content-type")).to.contain("text/html");
    const body = await res.text();
    expect(body).to.contain('<div id="root"></div>');
    expect(body).to.contain("/main.tsx");
  });

  test("sample-talk1 slide 2 serves html page", async ({ server }) => {
    const res = await fetch(`${server.url}/sample-talk1/motivation`);
    expect(res.status).to.equal(200);
    expect(res.headers.get("content-type")).to.contain("text/html");
    const body = await res.text();
    expect(body).to.contain('<div id="root"></div>');
  });

  test("sample-talk1 slide 3 serves html page", async ({ server }) => {
    const res = await fetch(`${server.url}/sample-talk1/getting-started`);
    expect(res.status).to.equal(200);
    const body = await res.text();
    expect(body).to.contain('<div id="root"></div>');
  });

  test("nonexistent talk returns 404", async ({ server }) => {
    const res = await fetch(`${server.url}/nonexistent/`);
    expect(res.status).to.equal(404);
  });

  test("nonexistent slide returns 404", async ({ server }) => {
    const res = await fetch(`${server.url}/sample-talk1/no-such-slide`);
    expect(res.status).to.equal(404);
  });

  test("sample-talk1.md is served as static file", async ({ server }) => {
    const res = await fetch(`${server.url}/sample-talk1.md`);
    expect(res.status).to.equal(200);
    const body = await res.text();
    expect(body).to.contain("# Sample talk");
    expect(body).to.contain("## Motivation");
  });
});

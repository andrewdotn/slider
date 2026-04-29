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

  test("sample-talk1 slide 1", async ({ server }) => {
    const res = await fetch(`${server.url}/sample-talk1/`);
    expect(res.status).to.equal(200);
    const body = await res.text();
    expect(body).to.contain("<!-- Slide -->");
    expect(body).to.contain("<!-- /Slide -->");
    expect(body).to.contain("# Sample talk");
    expect(body).not.to.contain("Previous");
    expect(body).to.contain('<a href="/sample-talk1/motivation">Next</a>');
  });

  test("sample-talk1 slide 2", async ({ server }) => {
    const res = await fetch(`${server.url}/sample-talk1/motivation`);
    expect(res.status).to.equal(200);
    const body = await res.text();
    expect(body).to.contain("## Motivation");
    expect(body).to.contain('<a href="/sample-talk1/">Previous</a>');
    expect(body).to.contain('<a href="/sample-talk1/getting-started">Next</a>');
  });

  test("sample-talk1 slide 3", async ({ server }) => {
    const res = await fetch(`${server.url}/sample-talk1/getting-started`);
    expect(res.status).to.equal(200);
    const body = await res.text();
    expect(body).to.contain("## Getting started");
    expect(body).to.contain('<a href="/sample-talk1/motivation">Previous</a>');
    expect(body).not.to.contain("Next");
  });
});

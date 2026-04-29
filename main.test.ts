import { describe, it, expect } from "vitest";

import { test as baseTest } from "vitest";
import { Server } from "./server.ts";
import { promisify } from "node:util";
import { i } from "./util/i.ts";

export const test = baseTest.extend("server", async ({}, { onCleanup }) => {
  const server = new Server();
  const listeningServer = await server.serve();

  onCleanup(async () => {
    await promisify(listeningServer.close)();
    console.log("server stopped");
  });

  const address = listeningServer.address();
  if (address !== null && typeof address === "object") {
    const { port } = address;
    return { port, url: `http://localhost:${port}/` };
  }
  throw new Error(i`unsure how to get port out of ${address}`);
});

describe("slider", () => {
  test("works", async ({ server }) => {
    expect(server.port).to.be.a("number");

    const res = await fetch(server.url);
    expect(res.status).to.equal(200);
    const body = await res.text();
    expect(body).to.equal("Hello World!");
  });
});

import express, { type Express } from "express";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { fileURLToPath } from "node:url";
import { i } from "./util/i.ts";
import * as http from "http";

export class Server {
  app: Express;

  constructor() {
    const app = express();

    app.get("/", (req, res) => {
      res.send("Hello World!");
    });

    this.app = app;
  }

  async serve({ port }: { port?: number } = {}): Promise<http.Server> {
    const listenMaybeWithPort = (cb: () => void) => {
      if (port !== undefined) {
        return this.app.listen(port, cb);
      } else {
        return this.app.listen(cb);
      }
    };

    return new Promise((resolve) => {
      const server = listenMaybeWithPort(() => {
        console.log(i`now listening on ${server.address()}`);
        resolve(server);
      });
    });
  }
}

type ArgvOptions = {
  port?: number;
};

function main() {
  const argv = yargs(hideBin(process.argv))
    .strict()
    .option("port", { type: "number" }).argv as ArgvOptions;
  new Server().serve({ port: argv.port });
}

if (import.meta?.url && process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}

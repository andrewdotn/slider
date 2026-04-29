import express, { type Express } from "express";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { fileURLToPath } from "node:url";
import { createServer as createViteServer, type ViteDevServer } from "vite";
import { i } from "./util/i.ts";
import * as http from "http";
import * as fs from "node:fs/promises";
import { promisify } from "node:util";

import * as path from "node:path";
import { parseTalk } from "./slides.ts";

export class Server {
  app: Express;
  vite: ViteDevServer | null = null;
  listeningServer: http.Server | null = null;
  baseDir: string = ".";

  constructor() {
    this.app = express();

    this.app.get("/hello", (req, res) => {
      res.send("Hello World!");
    });

    this.app.get("/", async (req, res) => {
      const files = await fs.readdir(this.baseDir);
      const mdFiles = files
        .filter((f) => f.endsWith(".md"))
        .map((f) => f.replace(/\.md$/, ""));
      const items = mdFiles
        .map((name) => `<li><a href="/${name}/">${name}</a></li>`)
        .join("\n");
      res.send(`<ul>\n${items}\n</ul>`);
    });
  }

  private async talkExists(
    talkName: string,
    slideSlug: string,
  ): Promise<boolean> {
    if (
      talkName.includes("/") ||
      talkName.includes("\\") ||
      talkName.startsWith(".")
    ) {
      return false;
    }

    let markdown: string;
    try {
      markdown = await fs.readFile(
        path.join(this.baseDir, `${talkName}.md`),
        "utf-8",
      );
    } catch {
      return false;
    }

    const slides = parseTalk(markdown);
    return slides.some((s) => s.slug === slideSlug);
  }

  async serve({
    port,
    baseDir,
  }: {
    port?: number;
    baseDir?: string;
  } = {}): Promise<http.Server> {
    if (baseDir) {
      this.baseDir = baseDir;
    }
    const isTest = process.env.NODE_ENV === "test";
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: isTest ? false : undefined,
        ws: isTest ? false : undefined,
      },
      optimizeDeps: { noDiscovery: isTest },
      appType: "custom",
    });
    this.vite = vite;

    this.app.use(vite.middlewares);

    const indexHtml = await fs.readFile("index.html", "utf-8");

    const serveSlide = async (
      req: express.Request,
      res: express.Response,
      talkName: string,
      slideSlug: string,
    ) => {
      if (!(await this.talkExists(talkName, slideSlug))) {
        return res.status(404).send("Not found");
      }
      const html = await vite.transformIndexHtml(req.originalUrl, indexHtml);
      res.status(200).set({ "Content-Type": "text/html" }).end(html);
    };

    this.app.get("/:talk/", async (req, res) => {
      await serveSlide(req, res, req.params.talk, "");
    });

    this.app.get("/:talk/:slide", async (req, res) => {
      await serveSlide(req, res, req.params.talk, req.params.slide);
    });

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
        this.listeningServer = server;
        resolve(server);
      });
    });
  }

  async close(): Promise<void> {
    const listeningServer = this.listeningServer;
    const vite = this.vite;
    this.listeningServer = null;
    this.vite = null;

    if (listeningServer) {
      const address = listeningServer.address();
      await promisify(listeningServer.close.bind(listeningServer))();
      console.log(i`${address} server stopped`);
    }
    if (vite) {
      await vite.close();
    }
  }
}

type ArgvOptions = {
  port?: number;
  baseDir?: string;
};

function main() {
  const argv = yargs(hideBin(process.argv))
    .strict()
    .option("port", { type: "number" })
    .option("base-dir", { type: "string" }).argv as ArgvOptions;
  new Server().serve({ port: argv.port, baseDir: argv.baseDir});
}

if (import.meta?.url && process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}

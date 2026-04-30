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
import morgan from "morgan";
import { watch, type FSWatcher } from "node:fs";

export class Server {
  app: Express;
  vite?: ViteDevServer;
  listeningServer?: http.Server;
  baseDir?: string;
  private watcher?: FSWatcher;
  private sseClients = new Set<express.Response>();

  private isTest: boolean;

  constructor({ baseDir, isTest }: { baseDir?: string; isTest?: boolean } = {}) {
    this.baseDir = baseDir;
    this.isTest = isTest ?? process.env.NODE_ENV === "test";
    const app = express();

    app.use(morgan('dev'));

    app.get("/hello", (req, res) => {
      res.send("Hello World!");
    });

    app.get("/", async (req, res) => {
      const files = await fs.readdir(this._relativePath("."));
      const mdFiles = files
        .filter((f) => f.endsWith(".md"))
        .map((f) => f.replace(/\.md$/, ""));
      const items = mdFiles
        .map((name) => `<li><a href="/talks/${name}/">${name}</a></li>`)
        .join("\n");
      res.send(`<ul>\n${items}\n</ul>`);
    });

    app.get("/talks/:talk/", async (req, res) => {
      await this.serveSlide(req, res, req.params.talk, "");
    });

    app.get("/talks/:talk/:slide", async (req, res) => {
      await this.serveSlide(req, res, req.params.talk, req.params.slide);
    });

    app.use('/talks-static/', express.static(this.baseDir ?? "."));

    app.get("/events", (req, res) => {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      res.write(":\n\n");
      this.sseClients.add(res);
      req.on("close", () => {
        this.sseClients.delete(res);
      });
    });

    this.app = app;
  }

  private async _installViteMiddleware() {
    const vite = await createViteServer({
      base: '/vite',
      server: {
        middlewareMode: true,
        hmr: this.isTest ? false : undefined,
        ws: this.isTest ? false : undefined,
      },
      optimizeDeps: { noDiscovery: this.isTest },
      appType: "custom",
    });
    this.vite = vite;

    this.app.use('/vite', vite.middlewares);
  }

  private _relativePath(p: string) {
    if (this.baseDir) {
      return path.join(this.baseDir, p);
    }
    return p;
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
        this._relativePath(`${talkName}.md`),
        "utf-8",
      );
    } catch (e) {
      console.error(i`error reading ${talkName}: ${e}`);
      return false;
    }

    const slides = parseTalk(markdown);
    return slides.some((s) => s.slug === slideSlug);
  }

  private async serveSlide(
      req: express.Request,
      res: express.Response,
      talkName: string,
      slideSlug: string,
  ) {
    const indexHtml = await fs.readFile("index.html", "utf-8");

    if (!(await this.talkExists(talkName, slideSlug))) {
      return res.status(404).send("Not found");
    }

    const html = await this.vite!.transformIndexHtml(req.originalUrl, indexHtml);
    res.status(200).set({ "Content-Type": "text/html" }).end(html);
  };

  private _startWatching() {
    const dir = this.baseDir ?? ".";
    // Debounce per-file to coalesce rapid events (e.g. vim atomic writes
    // which trigger multiple rename/change events, or macOS FSEvents
    // which may fire duplicate events for a single rename-into-place).
    const pending = new Map<string, ReturnType<typeof setTimeout>>();
    this.watcher = watch(dir, (eventType, filename) => {
      if (!filename || !filename.endsWith(".md")) return;
      const talk = filename.replace(/\.md$/, "");
      if (pending.has(talk)) clearTimeout(pending.get(talk));
      pending.set(
        talk,
        setTimeout(() => {
          pending.delete(talk);
          this._notifyClients(talk);
        }, 50),
      );
    });
  }

  private _notifyClients(talk: string) {
    const data = `data: ${JSON.stringify({ talk })}\n\n`;
    for (const client of this.sseClients) {
      client.write(data);
    }
  }

  async serve({
    port,
  }: {
    port?: number;
  } = {}): Promise<http.Server> {
    await this._installViteMiddleware();
    this._startWatching();

    const server = http.createServer(this.app);

    return new Promise((resolve, reject) => {
      server.on("error", reject);
      server.on("listening", () => {
        console.log(i`now listening on ${server.address()}`);
        this.listeningServer = server;
        resolve(server);
      });
      if (port !== undefined) {
        server.listen(port);
      } else {
        server.listen();
      }
    });
  }

  async close(): Promise<void> {
    const listeningServer = this.listeningServer;
    const vite = this.vite;
    const watcher = this.watcher;
    this.listeningServer = undefined;
    this.vite = undefined;
    this.watcher = undefined;

    for (const client of this.sseClients) {
      client.end();
    }
    this.sseClients.clear();

    if (watcher) {
      watcher.close();
    }
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
  new Server({ baseDir: argv.baseDir }).serve({ port: argv.port });
}

if (import.meta?.url && process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}

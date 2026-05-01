import express, { type Express } from "express";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { fileURLToPath } from "node:url";
import { createServer as createViteServer, type ViteDevServer } from "vite";
import { i } from "./util/i.ts";
import * as http from "http";
import * as net from "node:net";
import * as fs from "node:fs/promises";
import { promisify } from "node:util";

import * as path from "node:path";
import { parseTalk } from "./slides.ts";
import morgan from "morgan";
import { watch, type FSWatcher } from "node:fs";
import { EvalManager } from "./eval.ts";
import { WebSocketServer } from "ws";
import { spawn as childSpawn, type ChildProcess } from "node:child_process";
import { Writable } from "node:stream";

const PTY_HELPER = fileURLToPath(new URL("./pty_helper.py", import.meta.url));

function pickFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, () => {
      const addr = srv.address();
      if (addr && typeof addr === "object") {
        const { port } = addr;
        srv.close(() => resolve(port));
      } else {
        srv.close(() => reject(new Error("could not pick free port")));
      }
    });
  });
}

export function scriptArgs(platform: NodeJS.Platform): string[] {
  // BSD `script` (macOS) takes `script [-Fq] file [command ...]`; it has
  // no -c flag and no -e flag. -F flushes after each write.
  if (platform === "darwin") {
    return ["-Fq", "/dev/null", "bash", "--login"];
  }
  // util-linux `script`: -q quiet, -f flush, -e propagate exit status,
  // -c CMD run a command. Typescript log goes to /dev/null.
  return ["-qfec", "bash --login", "/dev/null"];
}

export class Server {
  app: Express;
  vite?: ViteDevServer;
  listeningServer?: http.Server;
  baseDir?: string;
  private watcher?: FSWatcher;
  private sseClients = new Set<express.Response>();
  private evalManager: EvalManager;
  private wss?: WebSocketServer;
  private ptys = new Set<ChildProcess>();

  private isTest: boolean;

  constructor({
    baseDir,
    isTest,
  }: { baseDir?: string; isTest?: boolean } = {}) {
    this.baseDir = baseDir;
    this.isTest = isTest ?? process.env.NODE_ENV === "test";
    this.evalManager = new EvalManager(baseDir ?? ".");
    const app = express();

    app.use(morgan("dev"));
    app.use(express.json({ limit: "5mb" }));

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

    app.use("/talks-static/", express.static(this.baseDir ?? "."));
    app.use(
      "/fonts/",
      express.static(path.join(path.dirname(fileURLToPath(import.meta.url)), "fonts"), {
        maxAge: "1d",
        immutable: true,
      }),
    );

    app.post(
      "/eval/:talk/:slide/:codeblockId/run",
      async (req, res) => {
        try {
          const { talk, slide, codeblockId } = req.params;
          const { src, files } = req.body ?? {};
          if (typeof src !== "string") {
            return res.status(400).json({ error: "src required" });
          }
          if (!this.evalManager.resolveSrc(talk, src)) {
            return res.status(400).json({ error: "invalid src" });
          }
          const result = await this.evalManager.run({
            talk,
            slide,
            codeblockId,
            src,
            files: files ?? {},
          });
          res.json(result);
        } catch (err) {
          res.status(400).json({ error: (err as Error).message });
        }
      },
    );

    app.get(
      "/eval/:talk/:slide/:codeblockId/output/:runId",
      (req, res) => {
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        });
        res.write(":\n\n");
        const cancel = this.evalManager.subscribe(req.params.runId, {
          onChunk: (c) => {
            res.write(`data: ${JSON.stringify(c)}\n\n`);
          },
          onEnd: (e) => {
            res.write(`event: end\ndata: ${JSON.stringify(e)}\n\n`);
            res.end();
          },
        });
        if (!cancel) {
          res.write(`event: end\ndata: ${JSON.stringify({ exitCode: null, signal: null, error: "unknown runId" })}\n\n`);
          return res.end();
        }
        req.on("close", () => cancel());
      },
    );

    app.get(
      "/eval/:talk/:slide/:codeblockId/output/:runId/make-clean",
      (req, res) => {
        const out = this.evalManager.getMakeCleanOutput(req.params.runId);
        if (out === null) return res.status(404).send("not found");
        res.set("Content-Type", "text/plain; charset=utf-8").send(out);
      },
    );

    app.post(
      "/eval/:talk/:slide/:codeblockId/kill/:runId",
      (req, res) => {
        const ok = this.evalManager.kill(req.params.runId);
        res.json({ killed: ok });
      },
    );

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
    const hmrPort = this.isTest ? false : await pickFreePort();
    const vite = await createViteServer({
      base: "/vite",
      server: {
        middlewareMode: true,
        hmr: hmrPort === false ? false : { port: hmrPort },
        ws: this.isTest ? false : undefined,
      },
      optimizeDeps: { noDiscovery: this.isTest },
      cacheDir: this.baseDir
        ? path.join(this.baseDir, ".vite-cache")
        : undefined,
      appType: "custom",
    });
    this.vite = vite;

    this.app.use("/vite", vite.middlewares);
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
    if (slideSlug === "") return slides.length > 0;
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

    const html = await this.vite!.transformIndexHtml(
      req.originalUrl,
      indexHtml,
    );
    res.status(200).set({ "Content-Type": "text/html" }).end(html);
  }

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

  private _installShellWs(server: http.Server) {
    const wss = new WebSocketServer({ noServer: true });
    this.wss = wss;
    const re = /^\/eval\/[^/]+\/[^/]+\/[^/]+\/shell\/([^/?]+)/;
    server.on("upgrade", (req, socket, head) => {
      const url = req.url ?? "";
      const m = re.exec(url);
      if (!m) {
        socket.destroy();
        return;
      }
      const runId = decodeURIComponent(m[1]);
      const cwd = this.evalManager.getTempDir(runId);
      if (!cwd) {
        socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        // pty_helper.py forks bash inside a real pty and exposes a side
        // channel on FD 3 for resize commands ("rows cols\n"), which it
        // applies via ioctl(TIOCSWINSZ).
        const pty = childSpawn("python3", [PTY_HELPER, "bash", "--login"], {
          cwd,
          env: {
            ...process.env,
            TERM: "xterm-256color",
          },
          stdio: ["pipe", "pipe", "pipe", "pipe"],
        });
        const ctrl = pty.stdio[3] as Writable | null;
        // If the pty is torn down while the websocket is still open,
        // subsequent writes to stdin produce EPIPE. Without a listener
        // node turns it into an unhandled 'error' and crashes the process.
        pty.stdin.on("error", () => {});
        pty.on("error", () => {});
        ctrl?.on("error", () => {});
        this.ptys.add(pty);
        pty.stdout?.on("data", (d: Buffer) => {
          try {
            ws.send(d);
          } catch {
            // ignore
          }
        });
        pty.stderr?.on("data", (d: Buffer) => {
          try {
            ws.send(d);
          } catch {
            // ignore
          }
        });
        pty.on("exit", () => {
          this.ptys.delete(pty);
          try {
            ws.close();
          } catch {
            // ignore
          }
        });
        ws.on("message", (data) => {
          let text: string;
          if (typeof data === "string") text = data;
          else text = data.toString("utf-8");
          if (text.startsWith("\x1b[8;")) {
            const m = /^\x1b\[8;(\d+);(\d+)t/.exec(text);
            if (m) {
              const rows = parseInt(m[1], 10);
              const cols = parseInt(m[2], 10);
              try {
                ctrl?.write(`${rows} ${cols}\n`);
              } catch {
                // ignore
              }
              return;
            }
          }
          pty.stdin?.write(text);
        });
        ws.on("close", () => {
          try {
            pty.kill("SIGHUP");
          } catch {
            // ignore
          }
          this.ptys.delete(pty);
        });
      });
    });
  }

  async serve({
    port,
  }: {
    port?: number;
  } = {}): Promise<http.Server> {
    await this._installViteMiddleware();
    this._startWatching();

    const server = http.createServer(this.app);
    this._installShellWs(server);

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
    for (const pty of this.ptys) {
      try {
        pty.kill("SIGHUP");
      } catch {
        // ignore
      }
    }
    this.ptys.clear();
    if (this.wss) {
      this.wss.close();
      this.wss = undefined;
    }
    if (listeningServer) {
      const address = listeningServer.address();
      await promisify(listeningServer.close.bind(listeningServer))();
      console.log(i`${address} server stopped`);
    }
    if (vite) {
      await vite.close();
    }
    await this.evalManager.close();
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

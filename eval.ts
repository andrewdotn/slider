import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";

// Force make etc to stream output if possible. Probe with `stdbuf -oL true`,
// which works on both GNU coreutils (Linux) and BSD stdbuf (macOS); the
// older `--help` probe exits 1 on BSD which has no long options.
export function detectStdbuf(): boolean {
  try {
    const r = spawnSync("stdbuf", ["-oL", "true"], { stdio: "ignore" });
    return r.status === 0;
  } catch {
    return false;
  }
}

function lineBuffered(
  cmd: string,
  args: string[],
  hasStdbuf: boolean,
): { cmd: string; args: string[] } {
  if (hasStdbuf) return { cmd: "stdbuf", args: ["-oL", "-eL", cmd, ...args] };
  return { cmd, args };
}

const MAX_DIRS_PER_CODEBLOCK = 5;

export type RunRequest = {
  talk: string;
  slide: string;
  codeblockId: string;
  src: string;
  files?: Record<string, string>;
};

type OutputChunk = { stream: "stdout" | "stderr"; text: string; t: number };

export type EndEvent = {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  durationMs: number;
};

type Listener = {
  onChunk: (chunk: OutputChunk) => void;
  onEnd: (end: EndEvent) => void;
};

type Run = {
  runId: string;
  codeblockKey: string;
  tempDir: string;
  proc: ChildProcess | null;
  chunks: OutputChunk[];
  cleanChunks: OutputChunk[];
  exited: EndEvent | null;
  listeners: Set<Listener>;
  startedAt: number;
};

const ANSI_RE =
  // eslint-disable-next-line no-control-regex
  /\x1B\[[0-?]*[ -/]*[@-~]|\x1B\][^\x07]*\x07|\x1B[@-Z\\-_]/g;

export function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, "");
}

function safeJoinUnder(root: string, rel: string): string | null {
  const resolved = path.resolve(root, rel);
  const rootResolved = path.resolve(root);
  if (resolved !== rootResolved && !resolved.startsWith(rootResolved + path.sep)) {
    return null;
  }
  return resolved;
}

function isSafeSegment(s: string): boolean {
  return s.length > 0 && !s.includes("/") && !s.includes("\\") && !s.startsWith(".");
}

export class EvalManager {
  private baseDir: string;
  private tempRoot: string;
  private dirsByCodeblock = new Map<string, string[]>();
  private runs = new Map<string, Run>();
  private nextRunId = 1;

  constructor(baseDir: string) {
    this.baseDir = path.resolve(baseDir);
    this.tempRoot = path.join(this.baseDir, "temp-eval");
  }

  private codeblockKey(talk: string, slide: string, codeblockId: string): string {
    return `${talk}/${slide}/${codeblockId}`;
  }

  /**
   * Validate request and resolve `src` to an absolute path under
   * `<baseDir>/`. Returns null if invalid (e.g. path traversal).
   */
  resolveSrc(talk: string, src: string): string | null {
    if (!isSafeSegment(talk)) return null;
    return safeJoinUnder(this.baseDir, src);
  }

  async run(req: RunRequest): Promise<{ runId: string; tempDir: string }> {
    const { talk, slide, codeblockId, src, files = {} } = req;
    if (!isSafeSegment(talk) || !isSafeSegment(codeblockId)) {
      throw new Error("invalid talk or codeblockId");
    }
    const slideSeg = slide === "" ? "_" : slide;
    if (!isSafeSegment(slideSeg)) throw new Error("invalid slide");

    const absSrc = this.resolveSrc(talk, src);
    if (!absSrc) throw new Error("src escapes baseDir");
    const srcDir = path.dirname(absSrc);

    await fs.mkdir(this.tempRoot, { recursive: true });
    const ts = Date.now().toString(36) + "-" + (this.nextRunId++).toString(36);
    const tempDir = path.join(
      this.tempRoot,
      `${talk}-${slideSeg}-${codeblockId}-${ts}`,
    );

    await fs.cp(srcDir, tempDir, { recursive: true });

    for (const [name, content] of Object.entries(files)) {
      if (!isSafeSegment(name)) continue;
      await fs.writeFile(path.join(tempDir, name), content);
    }

    const key = this.codeblockKey(talk, slideSeg, codeblockId);
    const list = this.dirsByCodeblock.get(key) ?? [];
    list.push(tempDir);
    while (list.length > MAX_DIRS_PER_CODEBLOCK) {
      const oldest = list.shift()!;
      fs.rm(oldest, { recursive: true, force: true }).catch(() => {});
    }
    this.dirsByCodeblock.set(key, list);

    const runId = `r${ts}`;
    const run: Run = {
      runId,
      codeblockKey: key,
      tempDir,
      proc: null,
      chunks: [],
      cleanChunks: [],
      exited: null,
      listeners: new Set(),
      startedAt: Date.now(),
    };
    this.runs.set(runId, run);

    // Run `make clean` then `make`. `make clean` output is captured on the
    // run for retrieval via getMakeCleanOutput, and is also emitted to the
    // live stream when `make clean` itself fails.
    void this.execSequence(run);

    return { runId, tempDir };
  }

  private emit(run: Run, chunk: OutputChunk) {
    run.chunks.push(chunk);
    for (const l of run.listeners) l.onChunk(chunk);
  }

  private finish(run: Run, end: EndEvent) {
    run.exited = end;
    run.proc = null;
    for (const l of run.listeners) l.onEnd(end);
    run.listeners.clear();
  }

  private spawnStep(
    run: Run,
    cmd: string,
    args: string[],
    hasStdbuf: boolean,
    opts: { live?: boolean } = {},
  ): Promise<{ code: number | null; signal: NodeJS.Signals | null; chunks: OutputChunk[] }> {
    return new Promise((resolve) => {
      const chunks: OutputChunk[] = [];
      const wrapped = lineBuffered(cmd, args, hasStdbuf);
      const banner: OutputChunk = {
        stream: "stdout",
        text: `$ ${[wrapped.cmd, ...wrapped.args].join(" ")}\n`,
        t: Date.now(),
      };
      chunks.push(banner);
      if (opts.live) this.emit(run, banner);
      const proc = spawn(wrapped.cmd, wrapped.args, { cwd: run.tempDir });
      run.proc = proc;
      proc.stdout.setEncoding("utf8");
      proc.stderr.setEncoding("utf8");
      const onData = (stream: "stdout" | "stderr") => (text: string) => {
        const chunk: OutputChunk = { stream, text, t: Date.now() };
        chunks.push(chunk);
        if (opts.live) this.emit(run, chunk);
      };
      proc.stdout.on("data", onData("stdout"));
      proc.stderr.on("data", onData("stderr"));
      proc.on("error", (err) => {
        const chunk: OutputChunk = {
          stream: "stderr",
          text: `${err.message}\n`,
          t: Date.now(),
        };
        chunks.push(chunk);
        if (opts.live) this.emit(run, chunk);
      });
      proc.on("close", (code, signal) => {
        resolve({ code, signal, chunks });
      });
    });
  }

  private duration(run: Run): number {
    return Date.now() - run.startedAt;
  }

  private async execSequence(run: Run) {
    try {
      const hasStdbuf = detectStdbuf();
      if (!hasStdbuf) {
        this.emit(run, {
          stream: "stderr",
          text: "warning: stdbuf not found on $PATH, it’s in gnu coreutils",
          t: Date.now(),
        });
      }
      const cleanResult = await this.spawnStep(run, "make", ["clean"], hasStdbuf);
      run.cleanChunks = cleanResult.chunks;
      if (cleanResult.code !== 0) {
        // Surface clean output only on failure.
        for (const c of cleanResult.chunks) this.emit(run, c);
        this.finish(run, {
          exitCode: cleanResult.code,
          signal: cleanResult.signal,
          durationMs: this.duration(run),
        });
        return;
      }
      const buildResult = await this.spawnStep(run, "make", [], hasStdbuf, { live: true });
      this.finish(run, {
        exitCode: buildResult.code,
        signal: buildResult.signal,
        durationMs: this.duration(run),
      });
    } catch (err) {
      this.emit(run, {
        stream: "stderr",
        text: `${(err as Error).message}\n`,
        t: Date.now(),
      });
      this.finish(run, {
        exitCode: null,
        signal: null,
        durationMs: this.duration(run),
      });
    }
  }

  subscribe(runId: string, listener: Listener): (() => void) | null {
    const run = this.runs.get(runId);
    if (!run) return null;
    for (const c of run.chunks) listener.onChunk(c);
    if (run.exited) {
      listener.onEnd(run.exited);
      return () => {};
    }
    run.listeners.add(listener);
    return () => run.listeners.delete(listener);
  }

  getMakeCleanOutput(runId: string): string | null {
    const run = this.runs.get(runId);
    if (!run) return null;
    return stripAnsi(run.cleanChunks.map((c) => c.text).join(""));
  }

  getTempDir(runId: string): string | null {
    return this.runs.get(runId)?.tempDir ?? null;
  }

  kill(runId: string): boolean {
    const run = this.runs.get(runId);
    if (!run || !run.proc) return false;
    run.proc.kill("SIGTERM");
    return true;
  }


  async close(): Promise<void> {
    for (const run of this.runs.values()) {
      if (run.proc) {
        try {
          run.proc.kill("SIGKILL");
        } catch {
          // ignore
        }
      }
      run.listeners.clear();
    }
    this.runs.clear();
    this.dirsByCodeblock.clear();
    await fs.rm(this.tempRoot, { recursive: true, force: true });
  }
}

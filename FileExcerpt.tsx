import React, { useEffect, useMemo, useRef, useState } from "react";
import { EditorView, keymap, Decoration, type DecorationSet } from "@codemirror/view";
import { EditorState, StateField, RangeSetBuilder, type Extension } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { syntaxHighlighting, defaultHighlightStyle } from "@codemirror/language";
import { cpp } from "@codemirror/lang-cpp";
import { go } from "@codemirror/lang-go";
import { python } from "@codemirror/lang-python";
import { javascript } from "@codemirror/lang-javascript";
import { Terminal } from "@xterm/xterm";
import { CanvasAddon } from "@xterm/addon-canvas";
import "@xterm/xterm/css/xterm.css";

function languageForExt(src: string): Extension | null {
  const ext = src.toLowerCase().split(".").pop() ?? "";
  switch (ext) {
    case "c":
    case "h":
    case "cc":
    case "cpp":
    case "hpp":
      return cpp();
    case "go":
      return go();
    case "py":
      return python();
    case "js":
    case "jsx":
    case "ts":
    case "tsx":
      return javascript({ jsx: ext === "jsx" || ext === "tsx", typescript: ext === "ts" || ext === "tsx" });
    default:
      return null;
  }
}

function highlightExtension(regexes: RegExp[]): Extension {
  const lineDeco = Decoration.line({ class: "file-excerpt-hl" });
  function compute(state: EditorState): DecorationSet {
    const builder = new RangeSetBuilder<Decoration>();
    const doc = state.doc;
    for (let i = 1; i <= doc.lines; i++) {
      const line = doc.line(i);
      if (regexes.some((re) => re.test(line.text))) {
        builder.add(line.from, line.from, lineDeco);
      }
    }
    return builder.finish();
  }
  return StateField.define<DecorationSet>({
    create: compute,
    update: (deco, tr) => (tr.docChanged ? compute(tr.state) : deco),
    provide: (f) => EditorView.decorations.from(f),
  });
}

type Props = {
  src: string;
  lineHighlights?: RegExp[];
  runMethod?: "Makefile";
  talk: string;
  slideSlug: string;
};

function codeblockIdFor(src: string): string {
  return src
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "cb";
}

type EvalEnd = {
  exitCode: number | null;
  signal: string | null;
  durationMs: number;
};

type OutputChunk = { stream: "stdout" | "stderr"; text: string; t: number };

function formatOffset(ms: number): string {
  const s = ms / 1000;
  return `+${s.toFixed(3)}s`;
}

function formatSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(3)}s`;
}

function renderWithTimestamps(
  chunks: OutputChunk[],
  startT: number,
): string {
  let out = "";
  let atLineStart = true;
  for (const c of chunks) {
    const text = c.text;
    let i = 0;
    while (i < text.length) {
      if (atLineStart) {
        out += formatOffset(c.t - startT).padEnd(10);
        atLineStart = false;
      }
      const nl = text.indexOf("\n", i);
      if (nl === -1) {
        out += text.slice(i);
        i = text.length;
      } else {
        out += text.slice(i, nl + 1);
        i = nl + 1;
        atLineStart = true;
      }
    }
  }
  return out;
}

// Module-level cache of edited code-block contents, keyed by `${talk}|${src}`,
// so edits survive slide navigation within the SPA. A page reload clears it.
const editedCache = new Map<string, string>();

// FitAddon under-fills when the host is inside a CSS scale() transform.
// We use xterm's own cellWidth (so the rendered screen width matches
// cols * cellWidth exactly) but divide the host's getComputedStyle width
// (CSS pixels), bypassing the bookkeeping that loses CSS pixels to
// xterm-internal padding the FitAddon subtracts conservatively.
function customFit(term: Terminal, host: HTMLElement) {
  const core = (term as unknown as { _core?: any })._core;
  const cell = core?._renderService?.dimensions?.css?.cell;
  if (!cell?.width || !cell?.height) return;

  const cs = getComputedStyle(host);
  const hostW = parseFloat(cs.width);
  const hostH = parseFloat(cs.height);
  const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
  const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
  const availW =
    (cs.boxSizing === "border-box" ? hostW - padX : hostW);
  const availH =
    (cs.boxSizing === "border-box" ? hostH - padY : hostH);
  if (!(availW > 0) || !(availH > 0)) return;

  const cols = Math.max(2, Math.floor(availW / cell.width));
  const rows = Math.max(1, Math.floor(availH / cell.height));
  if (cols !== term.cols || rows !== term.rows) {
    try {
      term.resize(cols, rows);
    } catch {
      // ignore
    }
  }
}

function ShellTerminal({
  talk,
  slideSeg,
  codeblockId,
  runId,
  size,
  onExit,
}: {
  talk: string;
  slideSeg: string;
  codeblockId: string;
  runId: string;
  size: { width: number; height: number };
  onExit: () => void;
}) {
  const host = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const onExitRef = useRef(onExit);
  onExitRef.current = onExit;

  useEffect(() => {
    if (!host.current) return;
    let cancelled = false;
    let term: Terminal | null = null;
    let ws: WebSocket | null = null;
    let dataDispose: (() => void) | null = null;

    // xterm measures cell width at open() and caches it. If we open before
    // Ubuntu Mono is loaded, xterm uses the fallback's narrower metrics and
    // the rightmost columns clip once the real font swaps in. Wait for the
    // font first.
    const fontsApi = (document as unknown as { fonts?: FontFaceSet }).fonts;
    const fontReady: Promise<unknown> = fontsApi?.load
      ? fontsApi.load('12px "Ubuntu Mono"').catch(() => undefined)
      : Promise.resolve();

    fontReady.then(() => {
      if (cancelled || !host.current) return;
      term = new Terminal({
        fontFamily: '"Ubuntu Mono", "Courier New", monospace',
        fontSize: 12,
        cursorBlink: true,
        convertEol: false,
      });
      term.open(host.current);
      // Canvas renderer paints glyphs at exact cell coordinates, avoiding
      // the DOM renderer's natural-text-flow overflow when xterm's rounded
      // cellWidth doesn't match the font's actual glyph width.
      try {
        term.loadAddon(new CanvasAddon());
      } catch {
        // ignore — fall back to DOM renderer
      }
      customFit(term, host.current);
      termRef.current = term;

      const proto = location.protocol === "https:" ? "wss:" : "ws:";
      ws = new WebSocket(
        `${proto}//${location.host}/eval/${talk}/${slideSeg}/${codeblockId}/shell/${runId}`,
      );
      wsRef.current = ws;
      ws.binaryType = "arraybuffer";
      ws.onopen = () => {
        if (!term || !ws) return;
        const { cols, rows } = term;
        ws.send(`\x1b[8;${rows};${cols}t`);
        term.focus();
      };
      ws.onmessage = (ev) => {
        if (!term) return;
        if (typeof ev.data === "string") term.write(ev.data);
        else term.write(new Uint8Array(ev.data));
      };
      ws.onclose = () => {
        onExitRef.current();
      };
      const disp = term.onData((d) => {
        if (ws && ws.readyState === WebSocket.OPEN) ws.send(d);
      });
      dataDispose = () => disp.dispose();
    });

    return () => {
      cancelled = true;
      try {
        dataDispose?.();
      } catch {
        // ignore
      }
      if (ws) {
        // Drop handlers first so the close doesn't re-enter onExit during
        // unmount.
        ws.onopen = null;
        ws.onmessage = null;
        ws.onclose = null;
        ws.onerror = null;
        try {
          ws.close();
        } catch {
          // ignore
        }
      }
      try {
        term?.dispose();
      } catch {
        // ignore — canvas/webgl addons can throw during teardown
      }
      termRef.current = null;
      wsRef.current = null;
    };
  }, [talk, slideSeg, codeblockId, runId]);

  useEffect(() => {
    const term = termRef.current;
    const ws = wsRef.current;
    const h = host.current;
    if (!term || !h) return;
    customFit(term, h);
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(`\x1b[8;${term.rows};${term.cols}t`);
    }
  }, [size.width, size.height]);

  return <div className="file-excerpt-shell" ref={host} />;
}

export function FileExcerpt({
  src,
  lineHighlights = [],
  runMethod,
  talk,
  slideSlug,
}: Props) {
  const editorHost = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const editedRef = useRef<string>("");
  const [original, setOriginal] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [runId, setRunId] = useState<string | null>(null);
  const [tempDir, setTempDir] = useState<string | null>(null);
  const [chunks, setChunks] = useState<OutputChunk[]>([]);
  const [running, setRunning] = useState(false);
  const [end, setEnd] = useState<EvalEnd | null>(null);
  const [popupOpen, setPopupOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [cleanText, setCleanText] = useState<string | null>(null);
  const [shellOpen, setShellOpen] = useState(false);
  const [popupSize, setPopupSize] = useState({ width: 600, height: 320 });
  const [outputFontSize, setOutputFontSize] = useState(12);
  const [showTimestamps, setShowTimestamps] = useState(false);
  const [runStartT, setRunStartT] = useState<number | null>(null);
  const [, setTick] = useState(0);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!running || runStartT === null) return;
    const id = setInterval(() => setTick((n) => n + 1), 100);
    return () => clearInterval(id);
  }, [running, runStartT]);

  const output = showTimestamps && runStartT !== null
    ? renderWithTimestamps(chunks, runStartT)
    : chunks.map((c) => c.text).join("");

  const codeblockId = useMemo(() => codeblockIdFor(src), [src]);
  const slideSeg = slideSlug || "_";
  const cacheKey = `${talk}|${src}`;

  useEffect(() => {
    let cancelled = false;
    fetch(`/talks-static/${src}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.text();
      })
      .then((text) => {
        if (cancelled) return;
        setOriginal(text);
        editedRef.current = editedCache.get(cacheKey) ?? text;
      })
      .catch((e) => !cancelled && setLoadError(String(e.message ?? e)));
    return () => {
      cancelled = true;
    };
  }, [talk, src]);

  useEffect(() => {
    if (original === null || !editorHost.current) return;
    const lang = languageForExt(src);
    const exts: Extension[] = [
      history(),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      highlightExtension(lineHighlights),
      EditorView.editable.of(!!runMethod),
      EditorState.readOnly.of(!runMethod),
      EditorView.updateListener.of((u) => {
        if (u.docChanged) {
          const text = u.state.doc.toString();
          editedRef.current = text;
          editedCache.set(cacheKey, text);
        }
      }),
      EditorView.theme({
        "&": { backgroundColor: "transparent", fontSize: "inherit" },
        ".cm-scroller": { fontFamily: "inherit", lineHeight: "inherit" },
        ".cm-content": { padding: "0" },
        ".cm-line": { padding: "0" },
        ".cm-focused": { outline: "none" },
      }),
    ];
    if (lang) exts.push(lang);

    const initialDoc = (editedCache.get(cacheKey) ?? original).replace(
      /\n$/,
      "",
    );
    const view = new EditorView({
      state: EditorState.create({
        doc: initialDoc,
        extensions: exts,
      }),
      parent: editorHost.current,
    });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [original, lineHighlights, runMethod, src]);

  const startRun = async () => {
    setChunks([]);
    setEnd(null);
    setRunning(true);
    setRunStartT(null);
    setPopupOpen(true);
    setMenuOpen(false);
    setCleanText(null);
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }
    const fileName = src.split("/").pop()!;
    const text = editedRef.current.endsWith("\n")
      ? editedRef.current
      : editedRef.current + "\n";
    const body = {
      src,
      files: { [fileName]: text },
    };
    let r: Response;
    try {
      r = await fetch(
        `/eval/${talk}/${slideSeg}/${codeblockId}/run`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
    } catch (e) {
      const t = Date.now();
      setRunStartT((s) => s ?? t);
      setChunks([{ stream: "stderr", text: `fetch failed: ${(e as Error).message}\n`, t }]);
      setRunning(false);
      return;
    }
    if (!r.ok) {
      const t = Date.now();
      setRunStartT((s) => s ?? t);
      setChunks([{ stream: "stderr", text: `run failed: HTTP ${r.status}\n`, t }]);
      setRunning(false);
      return;
    }
    const data = await r.json();
    setRunId(data.runId);
    setTempDir(data.tempDir);

    const es = new EventSource(
      `/eval/${talk}/${slideSeg}/${codeblockId}/output/${data.runId}`,
    );
    esRef.current = es;
    es.onmessage = (ev) => {
      try {
        const chunk = JSON.parse(ev.data) as OutputChunk;
        setRunStartT((s) => s ?? chunk.t);
        setChunks((cs) => [...cs, chunk]);
      } catch {
        // ignore
      }
    };
    es.addEventListener("end", (ev: MessageEvent) => {
      try {
        setEnd(JSON.parse(ev.data));
      } catch {
        setEnd({ exitCode: null, signal: null, durationMs: 0 });
      }
      setRunning(false);
      es.close();
      esRef.current = null;
    });
    es.onerror = () => {
      setRunning(false);
      es.close();
      esRef.current = null;
    };
  };

  const killRun = async () => {
    setMenuOpen(false);
    if (!runId) return;
    await fetch(
      `/eval/${talk}/${slideSeg}/${codeblockId}/kill/${runId}`,
      { method: "POST" },
    );
  };

  const viewMakeClean = async () => {
    setMenuOpen(false);
    if (!runId) return;
    const r = await fetch(
      `/eval/${talk}/${slideSeg}/${codeblockId}/output/${runId}/make-clean`,
    );
    setCleanText(await r.text());
  };

  const viewMake = () => {
    setMenuOpen(false);
    setCleanText(null);
  };

  const copyPath = async () => {
    setMenuOpen(false);
    if (tempDir) {
      try {
        await navigator.clipboard.writeText(tempDir);
      } catch {
        // ignore
      }
    }
  };

  const openShell = () => {
    setMenuOpen(false);
    if (!runId) return;
    setCleanText(null);
    setShellOpen(true);
  };

  const exitShell = () => {
    setMenuOpen(false);
    setShellOpen(false);
  };

  const onResizeMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startY = e.clientY;
    const startW = popupSize.width;
    const startH = popupSize.height;
    const scaleStr = getComputedStyle(
      document.documentElement,
    ).getPropertyValue("--slide-scale");
    const scale = parseFloat(scaleStr) || 1;
    const onMove = (ev: MouseEvent) => {
      // Handle at upper-left; popup anchored at the slide's lower-right, so
      // dragging up-and-left grows the box up-and-left.
      const dx = (startX - ev.clientX) / scale;
      const dy = (startY - ev.clientY) / scale;
      setPopupSize({
        width: Math.max(200, Math.min(880, startW + dx)),
        height: Math.max(80, Math.min(540, startH + dy)),
      });
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const closePopup = () => {
    setPopupOpen(false);
    setMenuOpen(false);
    setCleanText(null);
    setShellOpen(false);
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }
  };

  if (loadError) {
    return <pre className="mdx-error">Failed to load {src}: {loadError}</pre>;
  }

  return (
    <div className="file-excerpt">
      <div className="file-excerpt-editor" ref={editorHost} />
      {runMethod && !popupOpen && (
        <button
          type="button"
          className="file-excerpt-run"
          onClick={startRun}
          disabled={running}
        >
          ▶ Run
        </button>
      )}
      {popupOpen && (
        <div
          className="file-excerpt-popup"
          style={{ width: popupSize.width, height: popupSize.height }}
        >
          <div
            className="file-excerpt-popup-resize"
            onMouseDown={onResizeMouseDown}
            title="Drag to resize"
          />
          <div className="file-excerpt-popup-header">
            <span>
              {running
                ? `running…${
                    runStartT !== null
                      ? ` (${formatSeconds(Date.now() - runStartT)})`
                      : ""
                  }`
                : end
                ? `done (exit ${end.exitCode ?? "?"}) in ${formatSeconds(end.durationMs)}`
                : "ready"}
            </span>
            <div className="file-excerpt-popup-buttons">
              <button
                type="button"
                className="file-excerpt-toolbar-btn"
                onClick={running ? killRun : startRun}
                title={running ? "Stop" : "Re-run"}
                aria-label={running ? "Stop" : "Re-run"}
              >
                {running ? "■" : "▶"}
              </button>
              <button
                type="button"
                className="file-excerpt-toolbar-btn"
                onClick={() => setOutputFontSize((s) => Math.min(48, s + 2))}
                title="Increase font size"
                aria-label="Increase font size"
              >
                A+
              </button>
              <button
                type="button"
                className="file-excerpt-toolbar-btn"
                onClick={() => setOutputFontSize((s) => Math.max(8, s - 2))}
                title="Decrease font size"
                aria-label="Decrease font size"
              >
                A−
              </button>
              <button type="button" onClick={() => setMenuOpen((v) => !v)}>
                Manage ▾
              </button>
              <button
                type="button"
                className="file-excerpt-popup-close"
                onClick={closePopup}
                title="Close"
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            {menuOpen && (
              <ul className="file-excerpt-menu">
                <li>
                  {cleanText !== null ? (
                    <button type="button" onClick={viewMake}>
                      Show `make` output
                    </button>
                  ) : (
                    <button type="button" onClick={viewMakeClean}>
                      Show `make clean` output
                    </button>
                  )}
                </li>
                <li>
                  <button type="button" onClick={copyPath}>
                    Copy path
                  </button>
                </li>
                <li>
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      setShowTimestamps((v) => !v);
                    }}
                  >
                    {showTimestamps ? "Hide timestamps" : "Show timestamps"}
                  </button>
                </li>
                <li>
                  {shellOpen ? (
                    <button type="button" onClick={exitShell}>
                      Hide shell
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={openShell}
                      disabled={!runId}
                    >
                      Shell
                    </button>
                  )}
                </li>
                <li>
                  <button type="button" onClick={startRun}>
                    Re-run
                  </button>
                </li>
                <li>
                  <button type="button" onClick={killRun} disabled={!running}>
                    Kill
                  </button>
                </li>
                <li>
                  <button type="button" onClick={closePopup}>
                    Close
                  </button>
                </li>
              </ul>
            )}
          </div>
          {shellOpen && runId ? (
            <ShellTerminal
              talk={talk}
              slideSeg={slideSeg}
              codeblockId={codeblockId}
              runId={runId}
              size={popupSize}
              onExit={() => setShellOpen(false)}
            />
          ) : cleanText !== null ? (
            <textarea
              className="file-excerpt-output"
              readOnly
              value={cleanText}
              style={{ fontSize: outputFontSize }}
            />
          ) : (
            <pre
              className="file-excerpt-output"
              style={{ fontSize: outputFontSize }}
            >
              {output}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

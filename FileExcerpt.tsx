import React, { useEffect, useMemo, useRef, useState } from "react";
import { EditorView, keymap, Decoration, type DecorationSet } from "@codemirror/view";
import { EditorState, StateField, RangeSetBuilder, type Extension } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { syntaxHighlighting, defaultHighlightStyle } from "@codemirror/language";
import { cpp } from "@codemirror/lang-cpp";
import { go } from "@codemirror/lang-go";
import { python } from "@codemirror/lang-python";
import { javascript } from "@codemirror/lang-javascript";

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

type EvalEnd = { exitCode: number | null; signal: string | null };

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
  const [output, setOutput] = useState<string>("");
  const [running, setRunning] = useState(false);
  const [end, setEnd] = useState<EvalEnd | null>(null);
  const [popupOpen, setPopupOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [cleanText, setCleanText] = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);

  const codeblockId = useMemo(() => codeblockIdFor(src), [src]);
  const slideSeg = slideSlug || "_";

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
        editedRef.current = text;
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
        if (u.docChanged) editedRef.current = u.state.doc.toString();
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

    const view = new EditorView({
      state: EditorState.create({ doc: original, extensions: exts }),
      parent: editorHost.current,
    });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [original, lineHighlights, runMethod, src]);

  const startRun = async () => {
    setOutput("");
    setEnd(null);
    setRunning(true);
    setPopupOpen(true);
    setCleanText(null);
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }
    const fileName = src.split("/").pop()!;
    const body = {
      src,
      files: { [fileName]: editedRef.current },
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
      setOutput(`fetch failed: ${(e as Error).message}\n`);
      setRunning(false);
      return;
    }
    if (!r.ok) {
      setOutput(`run failed: HTTP ${r.status}\n`);
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
        const chunk = JSON.parse(ev.data) as { stream: string; text: string };
        setOutput((s) => s + chunk.text);
      } catch {
        // ignore
      }
    };
    es.addEventListener("end", (ev: MessageEvent) => {
      try {
        setEnd(JSON.parse(ev.data));
      } catch {
        setEnd({ exitCode: null, signal: null });
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
    if (!runId) return;
    await fetch(
      `/eval/${talk}/${slideSeg}/${codeblockId}/kill/${runId}`,
      { method: "POST" },
    );
  };

  const viewClean = async () => {
    if (!runId) return;
    const r = await fetch(
      `/eval/${talk}/${slideSeg}/${codeblockId}/output/${runId}/clean`,
    );
    setCleanText(await r.text());
  };

  const copyPath = async () => {
    if (tempDir) {
      try {
        await navigator.clipboard.writeText(tempDir);
      } catch {
        // ignore
      }
    }
  };

  const closePopup = () => {
    setPopupOpen(false);
    setMenuOpen(false);
    setCleanText(null);
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
      {runMethod && (
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
        <div className="file-excerpt-popup">
          <div className="file-excerpt-popup-header">
            <span>
              {running
                ? "running…"
                : end
                ? `done (exit ${end.exitCode ?? "?"})`
                : "ready"}
            </span>
            <button type="button" onClick={() => setMenuOpen((v) => !v)}>
              Manage ▾
            </button>
            {menuOpen && (
              <ul className="file-excerpt-menu">
                <li>
                  <button type="button" onClick={viewClean}>
                    View clean output
                  </button>
                </li>
                <li>
                  <button type="button" onClick={copyPath}>
                    Copy path
                  </button>
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
          {cleanText !== null ? (
            <textarea
              className="file-excerpt-output"
              readOnly
              value={cleanText}
            />
          ) : (
            <pre className="file-excerpt-output">{output}</pre>
          )}
        </div>
      )}
    </div>
  );
}

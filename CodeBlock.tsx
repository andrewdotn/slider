import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import hljs from "highlight.js";
import { parseCodeHighlights } from "./highlight.ts";

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

interface DetectInfo {
  applied: string | null;
  override: string | null;
  auto: { language: string | null; relevance: number };
}

function detect(text: string, lang: string | undefined): DetectInfo {
  const auto = text.trim()
    ? (() => {
        const r = hljs.highlightAuto(text);
        return { language: r.language ?? null, relevance: r.relevance };
      })()
    : { language: null, relevance: 0 };

  if (lang) {
    const key = lang.toLowerCase();
    const applied = hljs.getLanguage(key) ? key : null;
    return { applied, override: lang, auto };
  }
  const applied = auto.language && auto.relevance >= 5 ? auto.language : null;
  return { applied, override: null, auto };
}

let debugMode = false;
const debugSubs = new Set<() => void>();
export function toggleCodeBlockDebug() {
  debugMode = !debugMode;
  debugSubs.forEach((s) => s());
}
function useDebugMode(): boolean {
  const [, setN] = useState(0);
  useEffect(() => {
    const sub = () => setN((n) => n + 1);
    debugSubs.add(sub);
    return () => {
      debugSubs.delete(sub);
    };
  }, []);
  return debugMode;
}

function LangPicker({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (v: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(
    null,
  );
  const ref = useRef<HTMLSpanElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLSpanElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const all = useMemo(() => hljs.listLanguages().sort(), []);
  const filtered = useMemo(() => {
    const f = filter.trim().toLowerCase();
    if (!f) return all;
    return all.filter((l) => l.toLowerCase().includes(f));
  }, [all, filter]);

  useEffect(() => {
    if (!open) return;
    const onDocDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t)) return;
      if (menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDocDown);
    return () => document.removeEventListener("mousedown", onDocDown);
  }, [open]);

  useEffect(() => {
    if (!open) {
      setMenuPos(null);
      return;
    }
    const update = () => {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (rect) setMenuPos({ top: rect.bottom + 2, left: rect.right - 180 });
    };
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [open]);

  useEffect(() => {
    if (open && menuPos) inputRef.current?.focus();
  }, [open, menuPos]);

  return (
    <span className="code-block-debug-picker" ref={ref}>
      <button
        ref={buttonRef}
        type="button"
        className="code-block-debug-picker-button"
        onClick={() => {
          setFilter("");
          setOpen((o) => !o);
        }}
      >
        override: {value ?? "auto"} ▾
      </button>
      {open && menuPos && createPortal(
        <span
          ref={menuRef}
          className="code-block-debug-picker-menu"
          style={{ top: menuPos.top, left: menuPos.left }}
        >
          <input
            ref={inputRef}
            type="text"
            value={filter}
            placeholder="filter…"
            onChange={(e) => setFilter(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Escape") setOpen(false);
              if (e.key === "Enter" && filtered.length > 0) {
                onChange(filtered[0]);
                setOpen(false);
              }
            }}
          />
          <span className="code-block-debug-picker-list">
            <button
              type="button"
              className={value === null ? "is-current" : undefined}
              onClick={() => {
                onChange(null);
                setOpen(false);
              }}
            >
              (auto)
            </button>
            {filtered.map((l) => (
              <button
                key={l}
                type="button"
                className={value === l ? "is-current" : undefined}
                onClick={() => {
                  onChange(l);
                  setOpen(false);
                }}
              >
                {l}
              </button>
            ))}
          </span>
        </span>,
        document.body,
      )}
    </span>
  );
}

function CandidatesDropdown({
  candidates,
  label,
  onSelect,
}: {
  candidates: { language: string; relevance: number }[];
  label: string;
  onSelect: (language: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLSpanElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    const f = filter.trim().toLowerCase();
    if (!f) return candidates;
    return candidates.filter((c) => c.language.toLowerCase().includes(f));
  }, [candidates, filter]);

  useEffect(() => {
    if (!open) return;
    const onDocDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (buttonRef.current?.contains(t)) return;
      if (menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDocDown);
    return () => document.removeEventListener("mousedown", onDocDown);
  }, [open]);

  useEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const update = () => {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (rect) setPos({ top: rect.bottom + 2, left: rect.right - 180 });
    };
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [open]);

  useEffect(() => {
    if (open && pos) inputRef.current?.focus();
  }, [open, pos]);

  return (
    <span className="code-block-debug-picker">
      <button
        ref={buttonRef}
        type="button"
        className="code-block-debug-picker-button"
        onClick={() => {
          setFilter("");
          setOpen((o) => !o);
        }}
        disabled={candidates.length === 0}
      >
        {label} ▾
      </button>
      {open && pos && createPortal(
        <span
          ref={menuRef}
          className="code-block-debug-picker-menu"
          style={{ top: pos.top, left: pos.left }}
        >
          <input
            ref={inputRef}
            type="text"
            value={filter}
            placeholder="filter…"
            onChange={(e) => setFilter(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Escape") setOpen(false);
              if (e.key === "Enter" && filtered.length > 0) {
                onSelect(filtered[0].language);
                setOpen(false);
              }
            }}
          />
          <span className="code-block-debug-picker-list">
            {filtered.map((c) => (
              <button
                key={c.language}
                type="button"
                onClick={() => {
                  onSelect(c.language);
                  setOpen(false);
                }}
              >
                {c.language}: {c.relevance.toFixed(1)}
              </button>
            ))}
          </span>
        </span>,
        document.body,
      )}
    </span>
  );
}

export function CodeBlock({ code, lang }: { code: string; lang?: string }) {
  const lines = parseCodeHighlights(code);
  const debug = useDebugMode();
  const [debugOverride, setDebugOverride] = useState<string | null>(null);

  const effectiveLang = debugOverride ?? lang;
  const text = lines.map((l) => l.text).join("\n");
  const info = detect(text, effectiveLang);
  const language = info.applied;

  const candidates = useMemo(() => {
    if (!debug || !text.trim()) return [];
    return hljs
      .listLanguages()
      .map((l) => ({
        language: l,
        relevance: hljs.highlight(text, { language: l, ignoreIllegals: true })
          .relevance,
      }))
      .filter((c) => c.relevance > 0)
      .sort((a, b) => b.relevance - a.relevance);
  }, [debug, text]);

  return (
    <>
      <code className={`hljs language-${language ?? "plaintext"}`}>
        {lines.map((line, i) => {
          const html = language
            ? hljs.highlight(line.text, { language, ignoreIllegals: true }).value
            : escapeHtml(line.text);
          return (
            <span
              key={i}
              className={line.highlight ? "hl" : undefined}
              dangerouslySetInnerHTML={{ __html: html || "&nbsp;" }}
            />
          );
        })}
      </code>
      {debug && (
        <span className="code-block-debug">
          <span>auto</span>
          <CandidatesDropdown
            candidates={candidates}
            label={`${info.auto.language ?? "none"} rel=${info.auto.relevance.toFixed(1)}`}
            onSelect={setDebugOverride}
          />
          <span>minRel=5</span>
          <LangPicker value={debugOverride} onChange={setDebugOverride} />
          <span>
            applied: {info.applied ?? "plaintext"}
            {lang != null && <> · markdown lang: {lang}</>}
          </span>
        </span>
      )}
    </>
  );
}

import React from "react";
import hljs from "highlight.js";
import { parseCodeHighlights } from "./highlight.ts";

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function detect(text: string, lang: string | undefined): string | null {
  if (lang) {
    const key = lang.toLowerCase();
    return hljs.getLanguage(key) ? key : null;
  }
  if (!text.trim()) return null;
  const result = hljs.highlightAuto(text);
  return result.language && result.relevance >= 5 ? result.language : null;
}

export function CodeBlock({ code, lang }: { code: string; lang?: string }) {
  const lines = parseCodeHighlights(code);
  const language = detect(lines.map((l) => l.text).join("\n"), lang);
  return (
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
  );
}

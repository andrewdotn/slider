import React, { useMemo, useState } from "react";

type Props = {
  rows: number;
  data: Record<string, string>;
  fontSize?: string | number;
};

function lcsKeep(
  a: string,
  b: string,
): { keepA: boolean[]; keepB: boolean[] } {
  const n = a.length;
  const m = b.length;
  const dp: Uint16Array = new Uint16Array((n + 1) * (m + 1));
  const w = m + 1;
  for (let i = 1; i <= n; i++) {
    const ai = a.charCodeAt(i - 1);
    for (let j = 1; j <= m; j++) {
      if (ai === b.charCodeAt(j - 1)) {
        dp[i * w + j] = dp[(i - 1) * w + (j - 1)] + 1;
      } else {
        const up = dp[(i - 1) * w + j];
        const left = dp[i * w + (j - 1)];
        dp[i * w + j] = up >= left ? up : left;
      }
    }
  }
  const keepA = new Array<boolean>(n).fill(false);
  const keepB = new Array<boolean>(m).fill(false);
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    if (a.charCodeAt(i - 1) === b.charCodeAt(j - 1)) {
      keepA[i - 1] = true;
      keepB[j - 1] = true;
      i--;
      j--;
    } else if (dp[(i - 1) * w + j] >= dp[i * w + (j - 1)]) {
      i--;
    } else {
      j--;
    }
  }
  return { keepA, keepB };
}

function renderDiff(
  text: string,
  keep: boolean[],
  className: string,
): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let buf = "";
  let inDiff = false;
  let key = 0;
  const flush = () => {
    if (!buf) return;
    if (inDiff) {
      out.push(
        <span key={key++} className={className}>
          {buf}
        </span>,
      );
    } else {
      out.push(buf);
    }
    buf = "";
  };
  for (let k = 0; k < text.length; k++) {
    const ch = text[k];
    // Treat newlines as always "kept" so diff highlight doesn't span lines.
    const diff = ch !== "\n" && !keep[k];
    if (diff !== inDiff) {
      flush();
      inDiff = diff;
    }
    buf += ch;
  }
  flush();
  return out;
}

function trimBlock(s: string): string {
  return s.replace(/^\n/, "").replace(/\n$/, "");
}

export function NUpDiff({ rows, data, fontSize }: Props) {
  const entries = useMemo(
    () =>
      Object.entries(data).map(([label, raw]) => ({
        label,
        text: trimBlock(raw),
      })),
    [data],
  );
  const cols = Math.max(1, Math.ceil(entries.length / Math.max(1, rows)));
  const [hovered, setHovered] = useState<number | null>(null);

  const fontSizeCss =
    fontSize == null
      ? undefined
      : typeof fontSize === "number"
        ? `${fontSize}px`
        : fontSize;

  const hoveredText = hovered != null ? entries[hovered].text : null;
  const hoveredRow = hovered != null ? Math.floor(hovered / cols) : -1;

  const { peerKeep, hoveredKeep } = useMemo(() => {
    const peerKeep: (boolean[] | null)[] = entries.map(() => null);
    let hoveredKeep: boolean[] | null = null;
    if (hoveredText == null) return { peerKeep, hoveredKeep };
    // Aggregate: a char in hovered is "kept" only if it's matched in EVERY
    // peer's LCS. If any peer drops it, mark it as differing (yellow).
    const agg = new Array<boolean>(hoveredText.length).fill(true);
    let anyPeer = false;
    for (let i = 0; i < entries.length; i++) {
      if (i === hovered) continue;
      if (Math.floor(i / cols) !== hoveredRow) continue;
      const { keepA, keepB } = lcsKeep(hoveredText, entries[i].text);
      peerKeep[i] = keepB;
      anyPeer = true;
      for (let k = 0; k < agg.length; k++) {
        if (!keepA[k]) agg[k] = false;
      }
    }
    if (anyPeer) hoveredKeep = agg;
    return { peerKeep, hoveredKeep };
  }, [entries, hovered, hoveredText, hoveredRow, cols]);

  return (
    <div
      className="nup-grid"
      style={{ gridTemplateColumns: `repeat(${cols}, max-content)` }}
    >
      {entries.map((entry, i) => {
        const isHovered = i === hovered;
        const keep = isHovered ? hoveredKeep : peerKeep[i];
        const className = isHovered ? "nup-self-diff" : "nup-diff";
        return (
          <div
            key={entry.label}
            className="nup-cell"
            onMouseEnter={() => setHovered(i)}
            onMouseLeave={() =>
              setHovered((cur) => (cur === i ? null : cur))
            }
          >
            <div className="nup-cell-label">{entry.label}</div>
            <pre
              style={
                fontSizeCss
                  ? { fontSize: fontSizeCss, lineHeight: 1.2 }
                  : undefined
              }
            >{keep ? renderDiff(entry.text, keep, className) : entry.text}</pre>
          </div>
        );
      })}
    </div>
  );
}

export const HIGHLIGHT_MARKERS = ["//HL", "#HL"] as const;

export interface HighlightedLine {
  text: string;
  highlight: boolean;
}

export function parseHighlightLine(line: string): HighlightedLine {
  for (const marker of HIGHLIGHT_MARKERS) {
    const re = new RegExp(`${escapeRegex(marker)}(HL)*$`);
    const match = line.match(re);
    if (!match) continue;

    const runText = match[0];
    const extraHLs = (runText.length - marker.length) / 2;
    const n = 1 + extraHLs;

    let stripped: string;
    if (n === 1) {
      stripped = line.slice(0, line.length - marker.length);
      if (stripped.length > 0 && /\s/.test(stripped[stripped.length - 1])) {
        stripped = stripped.slice(0, -1);
      }
    } else {
      stripped = line.slice(0, line.length - 2);
    }

    return { text: stripped, highlight: n % 2 === 1 };
  }
  return { text: line, highlight: false };
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function parseCodeHighlights(code: string): HighlightedLine[] {
  return code.split("\n").map(parseHighlightLine);
}

export function hasHighlights(code: string): boolean {
  return parseCodeHighlights(code).some((line) => line.highlight);
}

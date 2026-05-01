import { unified } from "unified";
import remarkParse from "remark-parse";
import type { Root } from "mdast";

export interface WhenSpec {
  match(n: number): boolean;
  upperBound(): number | null;
}

export function parseWhen(spec: string): WhenSpec {
  const parts = spec
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const ranges: Array<[number | null, number | null]> = parts.map((part) => {
    const dash = part.indexOf("-");
    if (dash === -1) {
      const n = Number(part);
      return [n, n];
    }
    const left = part.slice(0, dash).trim();
    const right = part.slice(dash + 1).trim();
    const lo = left === "" ? null : Number(left);
    const hi = right === "" ? null : Number(right);
    return [lo, hi];
  });
  return {
    match(n: number) {
      return ranges.some(([lo, hi]) => {
        if (lo !== null && n < lo) return false;
        if (hi !== null && n > hi) return false;
        return true;
      });
    },
    upperBound() {
      let best: number | null = 0;
      for (const [lo, hi] of ranges) {
        if (hi === null) {
          if (lo !== null && (best === null || lo > best)) best = lo;
        } else {
          if (best === null || hi > best) best = hi;
        }
      }
      return best === 0 ? null : best;
    },
  };
}

const SYNTAX_COMMENT_RE = /^<!--\s*syntax:\s*(\S+)\s*-->\s*$/;

export function normalizeIndentedCode(src: string): string {
  const tree = unified().use(remarkParse).parse(src) as Root;
  const replacements: Array<{ start: number; end: number; text: string }> = [];

  function processChildren(parent: any) {
    const children = parent.children;
    if (!children) return;
    for (let i = 0; i < children.length; i++) {
      const node = children[i];
      if (node.type === "code") {
        const start = node.position?.start?.offset;
        const end = node.position?.end?.offset;
        if (start !== undefined && end !== undefined) {
          const original = src.slice(start, end);
          if (!original.startsWith("```") && !original.startsWith("~~~")) {
            let lang: string = node.lang ?? "";
            const prev = children[i - 1];
            if (prev && prev.type === "html") {
              const m = (prev.value ?? "").match(SYNTAX_COMMENT_RE);
              if (m) {
                lang = m[1];
                const ps = prev.position?.start?.offset;
                const pe = prev.position?.end?.offset;
                if (ps !== undefined && pe !== undefined) {
                  replacements.push({ start: ps, end: pe, text: "" });
                }
              }
            }
            const value: string = node.value ?? "";
            const fenced = "```" + lang + "\n" + value + "\n```";
            replacements.push({ start, end, text: fenced });
          }
        }
      }
      processChildren(node);
    }
  }
  processChildren(tree);

  replacements.sort((a, b) => b.start - a.start);
  let out = src;
  for (const r of replacements) {
    out = out.slice(0, r.start) + r.text + out.slice(r.end);
  }
  return out;
}

type PauseEvent = {
  kind: "pause";
  start: number;
  end: number;
  firesAt: number;
};
type SpanEvent = {
  kind: "span";
  openStart: number;
  openEnd: number;
  closeStart: number;
  closeEnd: number;
  when: string;
};
type Event = PauseEvent | SpanEvent;

const SPAN_CLOSE = "</Sl.Span>";

function scan(src: string): Event[] {
  const events: Event[] = [];

  const pauseRe = /<Sl\.Pause\s*\/>/g;
  let m: RegExpExecArray | null;
  while ((m = pauseRe.exec(src)) !== null) {
    events.push({
      kind: "pause",
      start: m.index,
      end: m.index + m[0].length,
      firesAt: 0,
    });
  }

  const spanOpenRe = /<Sl\.Span\b([^>]*)>/g;
  while ((m = spanOpenRe.exec(src)) !== null) {
    const openStart = m.index;
    const openEnd = m.index + m[0].length;
    const attrs = m[1];
    const whenMatch = attrs.match(
      /when\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/,
    );
    if (!whenMatch) {
      throw new Error(
        `<Sl.Span> at offset ${openStart} is missing a when= attribute`,
      );
    }
    const when = whenMatch[1] ?? whenMatch[2] ?? whenMatch[3];
    const closeIdx = src.indexOf(SPAN_CLOSE, openEnd);
    if (closeIdx === -1) {
      throw new Error(
        `<Sl.Span> at offset ${openStart} has no matching </Sl.Span>`,
      );
    }
    events.push({
      kind: "span",
      openStart,
      openEnd,
      closeStart: closeIdx,
      closeEnd: closeIdx + SPAN_CLOSE.length,
      when,
    });
  }

  events.sort((a, b) => startOf(a) - startOf(b));

  let maxSoFar = 1;
  for (const ev of events) {
    if (ev.kind === "pause") {
      ev.firesAt = maxSoFar + 1;
      maxSoFar = ev.firesAt;
    } else {
      const ub = parseWhen(ev.when).upperBound();
      if (ub !== null && ub > maxSoFar) maxSoFar = ub;
    }
  }
  return events;
}

function startOf(ev: Event): number {
  return ev.kind === "pause" ? ev.start : ev.openStart;
}

export function countSubSlides(src: string): number {
  const events = scan(src);
  if (events.length === 0) return 1;
  let maxSoFar = 1;
  for (const ev of events) {
    if (ev.kind === "pause") {
      maxSoFar = ev.firesAt;
    } else {
      const ub = parseWhen(ev.when).upperBound();
      if (ub !== null && ub > maxSoFar) maxSoFar = ub;
    }
  }
  return maxSoFar;
}

export function transformForSubSlide(src: string, n: number): string {
  const events = scan(src);

  let cutoff = src.length;
  for (const ev of events) {
    if (ev.kind === "pause" && ev.firesAt > n) {
      cutoff = ev.start;
      break;
    }
  }

  const edits: Array<{ start: number; end: number }> = [];
  for (const ev of events) {
    if (ev.kind === "pause") {
      if (ev.start >= cutoff) break;
      edits.push({ start: ev.start, end: ev.end });
    } else {
      if (ev.openStart >= cutoff) continue;
      if (parseWhen(ev.when).match(n)) {
        edits.push({ start: ev.openStart, end: ev.openEnd });
        edits.push({ start: ev.closeStart, end: ev.closeEnd });
      } else {
        edits.push({ start: ev.openStart, end: ev.closeEnd });
      }
    }
  }

  edits.sort((a, b) => b.start - a.start);
  let body = src.slice(0, cutoff);
  for (const e of edits) {
    body = body.slice(0, e.start) + body.slice(e.end);
  }
  return body;
}

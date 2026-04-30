import React, { createContext, useContext } from "react";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkMdx from "remark-mdx";
import { visit } from "unist-util-visit";
import type { Root } from "mdast";

export const SubSlideContext = createContext<number>(1);

export function Pause(): null {
  return null;
}

export function SubSlide({
  when,
  children,
}: {
  when?: string | number;
  children?: React.ReactNode;
}): React.ReactElement {
  const n = useContext(SubSlideContext);
  const spec = when === undefined ? "1-" : String(when);
  const visible = parseWhen(spec).match(n);
  if (visible) {
    return <>{children}</>;
  }
  return <span style={{ visibility: "hidden" }}>{children}</span>;
}

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

function parseLite(src: string): Root {
  return unified().use(remarkParse).parse(src) as Root;
}

function parseMdx(src: string): Root {
  return unified().use(remarkParse).use(remarkMdx).parse(src) as Root;
}

export function normalizeIndentedCode(src: string): string {
  const tree = parseLite(src);
  const replacements: Array<{ start: number; end: number; text: string }> = [];
  visit(tree, "code", (node: any) => {
    const start = node.position?.start?.offset;
    const end = node.position?.end?.offset;
    if (start === undefined || end === undefined) return;
    const original = src.slice(start, end);
    if (original.startsWith("```") || original.startsWith("~~~")) return;
    const lang = node.lang ?? "";
    const value: string = node.value ?? "";
    const fenced = "```" + lang + "\n" + value + "\n```";
    replacements.push({ start, end, text: fenced });
  });
  replacements.sort((a, b) => b.start - a.start);
  let out = src;
  for (const r of replacements) {
    out = out.slice(0, r.start) + r.text + out.slice(r.end);
  }
  return out;
}

function findPauseAndSubSlides(tree: Root) {
  const pauses: Array<{ start: number; end: number }> = [];
  let maxSubSlide = 0;
  visit(tree, (node: any) => {
    if (
      node.type !== "mdxJsxFlowElement" &&
      node.type !== "mdxJsxTextElement"
    ) {
      return;
    }
    const pos = node.position;
    if (!pos) return;
    if (node.name === "Pause") {
      pauses.push({ start: pos.start.offset, end: pos.end.offset });
    } else if (node.name === "SubSlide") {
      const attr = (node.attributes ?? []).find(
        (a: any) => a.type === "mdxJsxAttribute" && a.name === "when",
      );
      const whenValue =
        typeof attr?.value === "string"
          ? attr.value
          : (attr?.value?.value ?? "1-");
      const ub = parseWhen(String(whenValue)).upperBound();
      if (ub !== null && ub > maxSubSlide) maxSubSlide = ub;
    }
  });
  pauses.sort((a, b) => a.start - b.start);
  return { pauses, maxSubSlide };
}

export function countSubSlides(src: string): number {
  const tree = parseMdx(normalizeIndentedCode(src));
  const { pauses, maxSubSlide } = findPauseAndSubSlides(tree);
  return Math.max(1 + pauses.length, maxSubSlide || 1);
}

function stripRanges(
  src: string,
  ranges: Array<{ start: number; end: number }>,
): string {
  const sorted = [...ranges].sort((a, b) => b.start - a.start);
  let out = src;
  for (const r of sorted) {
    out = out.slice(0, r.start) + out.slice(r.end);
  }
  return out;
}

export function transformForSubSlide(src: string, n: number): string {
  const normalized = normalizeIndentedCode(src);
  const tree = parseMdx(normalized);
  const { pauses } = findPauseAndSubSlides(tree);

  if (pauses.length === 0 || n > pauses.length) {
    return stripRanges(normalized, pauses);
  }

  const cutPoint = pauses[n - 1].start;
  const visiblePart = stripRanges(
    normalized.slice(0, cutPoint),
    pauses
      .filter((p) => p.end <= cutPoint)
      .map((p) => ({ start: p.start, end: p.end })),
  );
  const hiddenPart = stripRanges(
    normalized.slice(cutPoint),
    pauses
      .filter((p) => p.start >= cutPoint)
      .map((p) => ({ start: p.start - cutPoint, end: p.end - cutPoint })),
  );

  return (
    visiblePart +
    '\n\n<div style={{visibility: "hidden"}}>\n\n' +
    hiddenPart +
    "\n\n</div>\n\n"
  );
}

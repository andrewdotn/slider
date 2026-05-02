import { visit, SKIP } from "unist-util-visit";

// Convert bare URLs in text nodes (e.g. `https://example.com`) into link
// nodes so they render as clickable hyperlinks. CommonMark's `<url>` autolink
// syntax is unusable here because MDX parses `<` as the start of a JSX tag.
const BARE_URL_RE = /\bhttps?:\/\/[^\s<>()\[\]'"`]+/g;

export function remarkAutolinkBareUrls() {
  return (tree: unknown) => {
    visit(
      tree as never,
      "text",
      (
        node: { type: "text"; value: string },
        index: number | null,
        parent: { type: string; children: unknown[] } | null,
      ) => {
        if (!parent || index === null) return;
        if (parent.type === "link" || parent.type === "linkReference") return;
        const value = node.value;
        if (!value || !/https?:\/\//.test(value)) return;

        const children: unknown[] = [];
        let last = 0;
        BARE_URL_RE.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = BARE_URL_RE.exec(value)) !== null) {
          let url = m[0];
          let trailing = "";
          // Strip trailing punctuation that's likely sentence punctuation,
          // not part of the URL.
          const trailMatch = url.match(/[.,;:!?]+$/);
          if (trailMatch) {
            trailing = trailMatch[0];
            url = url.slice(0, -trailing.length);
          }
          const start = m.index;
          if (start > last) {
            children.push({ type: "text", value: value.slice(last, start) });
          }
          children.push({
            type: "link",
            url,
            title: null,
            children: [{ type: "text", value: url }],
          });
          if (trailing) {
            children.push({ type: "text", value: trailing });
          }
          last = start + m[0].length;
        }
        if (children.length === 0) return;
        if (last < value.length) {
          children.push({ type: "text", value: value.slice(last) });
        }
        parent.children.splice(index, 1, ...children);
        return [SKIP, index + children.length];
      },
    );
  };
}

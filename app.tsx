import React, { useEffect, useMemo, useState } from "react";
import { evaluate } from "@mdx-js/mdx";
import * as runtime from "react/jsx-runtime";
import { visit } from "unist-util-visit";
import { parseTalk, slideHeading, type Slide } from "./slides.ts";

// Rewrite relative image URLs in slide markdown so they resolve to the
// /talks-static/ asset route rather than the slide page URL. When an asset
// has a known version (bumped by a hot-reload event), append a cache-busting
// query so the browser refetches the changed image.
function makeRemarkRewriteAssetUrls(assetVersions: Map<string, number>) {
  return function remarkRewriteAssetUrls() {
    return (tree: unknown) => {
      visit(tree as never, "image", (node: { url?: string }) => {
        const url = node.url;
        if (!url) return;
        if (/^(?:[a-z][a-z0-9+.-]*:|\/|#|data:)/i.test(url)) return;
        const v = assetVersions.get(url);
        const suffix = v ? `?v=${v}` : "";
        node.url = `/talks-static/${url}${suffix}`;
      });
    };
  };
}
import { remarkAutolinkBareUrls } from "./remark-autolink-bare-urls.ts";
import {
  countSubSlides,
  normalizeIndentedCode,
  transformForSubSlide,
} from "./subslides.tsx";
import { CodeBlock, toggleCodeBlockDebug } from "./CodeBlock.tsx";
import { FileExcerpt } from "./FileExcerpt.tsx";
import { Laser } from "./Laser.tsx";

type MDXContent = (props: Record<string, unknown>) => React.JSX.Element;

function extractCodeText(node: React.ReactNode): string {
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractCodeText).join("");
  if (React.isValidElement<{ children?: React.ReactNode }>(node)) {
    return extractCodeText(node.props.children);
  }
  return "";
}

function Font({ size }: { size: string }) {
  return (
    <style>{`.slides article.current > * { zoom: ${size}; }`}</style>
  );
}

function Pre(props: React.HTMLAttributes<HTMLPreElement>) {
  const child = React.Children.only(props.children) as React.ReactElement<{
    children?: React.ReactNode;
    className?: string;
  }>;
  const raw = extractCodeText(child.props.children).replace(/\n$/, "");
  const langMatch = child.props.className?.match(/language-(\S+)/);
  const lang = langMatch?.[1];
  return (
    <pre>
      <CodeBlock code={raw} lang={lang} />
    </pre>
  );
}

function formatError(err: unknown, source?: string): string {
  const e = err as {
    reason?: string;
    message?: string;
    line?: number;
    column?: number;
    place?: { start?: { line?: number; column?: number } };
    stack?: string;
  } | null;

  const line = e?.line ?? e?.place?.start?.line;
  const column = e?.column ?? e?.place?.start?.column;
  const reason = e?.reason ?? e?.message ?? String(err);

  let header = reason;
  if (line != null) {
    header = `Line ${line}${column != null ? `:${column}` : ""}: ${reason}`;
  }

  if (source && line != null) {
    const lines = source.split("\n");
    const idx = line - 1;
    const start = Math.max(0, idx - 2);
    const end = Math.min(lines.length, idx + 3);
    const width = String(end).length;
    const excerpt: string[] = [];
    for (let i = start; i < end; i++) {
      const num = String(i + 1).padStart(width, " ");
      const marker = i === idx ? ">" : " ";
      excerpt.push(`${marker} ${num} | ${lines[i]}`);
      if (i === idx && column != null) {
        excerpt.push(
          `${" ".repeat(width + 4)}${" ".repeat(Math.max(0, column - 1))}^`,
        );
      }
    }
    return `${header}\n\n${excerpt.join("\n")}`;
  }

  return header;
}

function parseSubIdx(hash: string): number {
  const m = hash.match(/^#(\d+)$/);
  if (!m) return 1;
  const n = Number(m[1]);
  return n >= 1 ? n : 1;
}

function hrefFor(talk: string, slug: string, subIdx: number): string {
  const path = slug ? `/talks/${talk}/${slug}` : `/talks/${talk}/`;
  return subIdx > 1 ? `${path}#${subIdx}` : path;
}

function navigateTo(href: string) {
  window.history.pushState({}, "", href);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

function useSlides(): {
  talk: string;
  slides: Slide[];
  idx: number;
  subIdx: number;
  assetVersions: Map<string, number>;
} | null {
  const [data, setData] = useState<{
    talk: string;
    slides: Slide[];
    idx: number;
  } | null>(null);
  const [assetVersions, setAssetVersions] = useState<Map<string, number>>(
    () => new Map(),
  );

  const [path, setPath] = useState(window.location.pathname);
  const [hash, setHash] = useState(window.location.hash);

  useEffect(() => {
    const handlePopState = () => {
      setPath(window.location.pathname);
      setHash(window.location.hash);
    };
    window.addEventListener("popstate", handlePopState);
    window.addEventListener("hashchange", handlePopState);
    return () => {
      window.removeEventListener("popstate", handlePopState);
      window.removeEventListener("hashchange", handlePopState);
    };
  }, []);

  const fetchTalk = async (talk: string, slideSlug: string) => {
    const res = await fetch(`/talks-static/${talk}.md`);
    if (!res.ok) throw new Error("Not found");
    const markdown = await res.text();
    const slides = parseTalk(markdown);
    let idx = slides.findIndex((s) => s.slug === slideSlug);
    if (idx === -1 && slideSlug === "" && slides.length > 0) idx = 0;
    if (idx !== -1) {
      setData({ talk, slides, idx });
    }
  };

  useEffect(() => {
    const parts = path.split("/").filter(Boolean);
    if (parts.length === 0) return;

    const talk = parts[1];
    const slideSlug = parts[2] ?? "";

    if (data && data.talk === talk) {
      let idx = data.slides.findIndex((s) => s.slug === slideSlug);
      if (idx === -1 && slideSlug === "" && data.slides.length > 0) idx = 0;
      if (idx !== -1) {
        setData({ ...data, idx });
      }
      return;
    }

    fetchTalk(talk, slideSlug);
  }, [path]);

  useEffect(() => {
    const es = new EventSource("/events");
    es.onmessage = (event) => {
      const msg = JSON.parse(event.data) as { talk?: string; asset?: string };
      if (msg.talk && data && data.talk === msg.talk) {
        const currentSlug = data.slides[data.idx]?.slug ?? "";
        fetchTalk(msg.talk, currentSlug);
      } else if (msg.asset) {
        setAssetVersions((prev) => {
          const next = new Map(prev);
          next.set(msg.asset!, (prev.get(msg.asset!) ?? 0) + 1);
          return next;
        });
      }
    };
    return () => es.close();
  }, [data?.talk, data?.idx]);

  if (!data) return null;
  return { ...data, subIdx: parseSubIdx(hash), assetVersions };
}

function SlideView({
  talk,
  slides,
  idx,
  subIdx,
  assetVersions,
}: {
  talk: string;
  slides: Slide[];
  idx: number;
  subIdx: number;
  assetVersions: Map<string, number>;
}) {
  const [Content, setContent] = useState<MDXContent | null>(null);
  const [error, setError] = useState<string | null>(null);

  const slide = slides[idx];
  const { subCount, parseError } = useMemo(() => {
    try {
      return {
        subCount: countSubSlides(slide.content),
        parseError: null as string | null,
      };
    } catch (err) {
      return {
        subCount: 1,
        parseError: formatError(err, normalizeIndentedCode(slide.content)),
      };
    }
  }, [slide.content]);
  const clampedSub = Math.min(Math.max(1, subIdx), subCount);

  useEffect(() => {
    if (parseError) {
      setError(parseError);
      return;
    }
    let cancelled = false;
    const normalized = normalizeIndentedCode(slide.content);
    const transformed = transformForSubSlide(normalized, clampedSub);
    (async () => {
      try {
        const mod = await evaluate(transformed, {
          ...(runtime as any),
          remarkPlugins: [
            makeRemarkRewriteAssetUrls(assetVersions),
            remarkAutolinkBareUrls,
          ],
        });
        if (cancelled) return;
        setError(null);
        setContent(() => mod.default);
      } catch (err) {
        if (cancelled) return;
        setError(formatError(err, transformed));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slide.content, clampedSub, parseError, assetVersions]);

  const TableOfContents = useMemo(
    () =>
      ({
        minDepth = 1,
        maxDepth = 3,
        skipCurrentSlide = true,
      }: {
        minDepth?: number;
        maxDepth?: number;
        skipCurrentSlide?: boolean;
      }) => {
        type Node = { slide: Slide; title: string; children: Node[] };
        const roots: Node[] = [];
        const stack: { depth: number; siblings: Node[] }[] = [
          { depth: minDepth - 1, siblings: roots },
        ];
        for (let i = 0; i < slides.length; i++) {
          if (skipCurrentSlide && i === idx) continue;
          const s = slides[i];
          const h = slideHeading(s.content);
          if (!h || h.depth < minDepth || h.depth > maxDepth) continue;
          while (stack[stack.length - 1].depth >= h.depth) stack.pop();
          const node: Node = { slide: s, title: h.title, children: [] };
          stack[stack.length - 1].siblings.push(node);
          stack.push({ depth: h.depth, siblings: node.children });
        }
        const renderList = (nodes: Node[]): React.ReactElement => (
          <ul className="toc">
            {nodes.map(({ slide, title, children }) => {
              const href = hrefFor(talk, slide.slug, 1);
              return (
                <li key={slide.slug || title}>
                  <a
                    href={href}
                    onClick={(e) => {
                      e.preventDefault();
                      navigateTo(href);
                    }}
                  >
                    {title}
                  </a>
                  {children.length > 0 && renderList(children)}
                </li>
              );
            })}
          </ul>
        );
        return renderList(roots);
      },
    [talk, slides, idx],
  );

  const FileExcerptForSlide = useMemo(
    () =>
      (props: {
        src: string;
        lineHighlights?: RegExp[];
        runMethod?: "Makefile";
        makefileName?: string;
      }) => <FileExcerpt {...props} talk={talk} slideSlug={slide.slug} />,
    [talk, slide.slug],
  );
  const mdxComponents = useMemo(
    () => ({
      TableOfContents,
      Font,
      pre: Pre,
      FileExcerpt: FileExcerptForSlide,
    }),
    [TableOfContents, FileExcerptForSlide],
  );

  const prevSlide = idx > 0 ? slides[idx - 1] : null;
  const nextSlide = idx < slides.length - 1 ? slides[idx + 1] : null;

  let prevHref: string | null = null;
  if (clampedSub > 1) {
    prevHref = hrefFor(talk, slide.slug, clampedSub - 1);
  } else if (prevSlide) {
    const prevSubCount = countSubSlides(prevSlide.content);
    prevHref = hrefFor(talk, prevSlide.slug, prevSubCount);
  }

  let nextHref: string | null = null;
  if (clampedSub < subCount) {
    nextHref = hrefFor(talk, slide.slug, clampedSub + 1);
  } else if (nextSlide) {
    nextHref = hrefFor(talk, nextSlide.slug, 1);
  }

  const navigate = (e: React.MouseEvent<HTMLAnchorElement>, href: string) => {
    e.preventDefault();
    navigateTo(href);
  };

  return (
    <>
      <div className="slides">
        <article className="current">
          {error ? (
            <pre className="mdx-error">{error}</pre>
          ) : Content ? (
            <Content components={mdxComponents} />
          ) : null}
        </article>
      </div>
      {prevHref && (
        <a
          className="nav-arrow nav-prev"
          href={prevHref}
          aria-label="Previous"
          onClick={(e) => navigate(e, prevHref!)}
        >
          ‹
        </a>
      )}
      {nextHref && (
        <a
          className="nav-arrow nav-next"
          href={nextHref}
          aria-label="Next"
          onClick={(e) => navigate(e, nextHref!)}
        >
          ›
        </a>
      )}
    </>
  );
}

export function App() {
  const data = useSlides();
  const [laser, setLaser] = useState(false);

  useEffect(() => {
    if (!data) return;
    const { talk, slides, idx, subIdx } = data;
    const slide = slides[idx];
    let subCount = 1;
    try {
      subCount = countSubSlides(slide.content);
    } catch {
      // Slide MDX is broken; SlideView will render the error.
    }
    const clampedSub = Math.min(Math.max(1, subIdx), subCount);
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as Element | null;
      if (target && target.closest(".cm-editor")) return;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          (target as HTMLElement).isContentEditable)
      )
        return;
      let href: string | null = null;
      if (e.key === "ArrowRight") {
        if (clampedSub < subCount) {
          href = hrefFor(talk, slide.slug, clampedSub + 1);
        } else if (idx < slides.length - 1) {
          href = hrefFor(talk, slides[idx + 1].slug, 1);
        }
      } else if (e.key === "ArrowLeft") {
        if (clampedSub > 1) {
          href = hrefFor(talk, slide.slug, clampedSub - 1);
        } else if (idx > 0) {
          const prev = slides[idx - 1];
          let prevCount = 1;
          try {
            prevCount = countSubSlides(prev.content);
          } catch {
            // ignore
          }
          href = hrefFor(talk, prev.slug, prevCount);
        }
      } else if (e.key === "ArrowDown") {
        if (idx < slides.length - 1) {
          href = hrefFor(talk, slides[idx + 1].slug, 1);
        }
      } else if (e.key === "ArrowUp") {
        if (idx > 0) {
          href = hrefFor(talk, slides[idx - 1].slug, 1);
        }
      } else if (e.key === "d" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        toggleCodeBlockDebug();
      } else if (e.key === "l" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        setLaser((v) => !v);
      } else if (e.key === "f" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        if (document.fullscreenElement) {
          document.exitFullscreen();
        } else {
          document.documentElement.requestFullscreen();
        }
      }
      if (href) navigateTo(href);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [data]);

  if (!data) {
    return <div>Loading...</div>;
  }

  return (
    <>
      <SlideView
        talk={data.talk}
        slides={data.slides}
        idx={data.idx}
        subIdx={data.subIdx}
        assetVersions={data.assetVersions}
      />
      <Laser active={laser} />
    </>
  );
}

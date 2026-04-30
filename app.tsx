import React, { useEffect, useState } from "react";
import { evaluate } from "@mdx-js/mdx";
import * as runtime from "react/jsx-runtime";
import { parseTalk, type Slide } from "./slides.ts";

type MDXContent = (props: Record<string, unknown>) => React.JSX.Element;

function useSlides(): {
  talk: string;
  slides: Slide[];
  idx: number;
} | null {
  const [data, setData] = useState<{
    talk: string;
    slides: Slide[];
    idx: number;
  } | null>(null);

  const [path, setPath] = useState(window.location.pathname);

  useEffect(() => {
    const handlePopState = () => {
      setPath(window.location.pathname);
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    const parts = path.split("/").filter(Boolean);
    if (parts.length === 0) return;

    const talk = parts[1];
    const slideSlug = parts[2] ?? "";

    if (data && data.talk === talk) {
      const idx = data.slides.findIndex((s) => s.slug === slideSlug);
      if (idx !== -1) {
        setData({ ...data, idx });
      }
      return;
    }

    fetch(`/talks-static/${talk}.md`)
      .then((res) => {
        if (!res.ok) throw new Error("Not found");
        return res.text();
      })
      .then((markdown) => {
        const slides = parseTalk(markdown);
        const idx = slides.findIndex((s) => s.slug === slideSlug);
        if (idx !== -1) {
          setData({ talk, slides, idx });
        }
      });
  }, [path]);

  return data;
}

function SlideView({
  talk,
  slides,
  idx,
}: {
  talk: string;
  slides: Slide[];
  idx: number;
}) {
  const [Content, setContent] = useState<MDXContent | null>(null);

  const slide = slides[idx];

  useEffect(() => {
    evaluate(slide.content, {
      ...(runtime as any),
      format: "md",
    }).then((mod) => {
      setContent(() => mod.default);
    });
  }, [slide.content]);

  const prevSlide = idx > 0 ? slides[idx - 1] : null;
  const nextSlide = idx < slides.length - 1 ? slides[idx + 1] : null;

  const prevHref = prevSlide
    ? prevSlide.slug
      ? `/talks/${talk}/${prevSlide.slug}`
      : `/talks/${talk}/`
    : null;
  const nextHref = nextSlide
    ? nextSlide.slug
      ? `/talks/${talk}/${nextSlide.slug}`
      : `/talks/${talk}/`
    : null;

  const navigate = (e: React.MouseEvent<HTMLAnchorElement>, href: string) => {
    e.preventDefault();
    window.history.pushState({}, "", href);
    window.dispatchEvent(new PopStateEvent("popstate"));
  };

  return (
    <div>
      <div className="slide">{Content ? <Content /> : null}</div>
      <nav>
        {prevHref && (
          <a href={prevHref} onClick={(e) => navigate(e, prevHref)}>
            Previous
          </a>
        )}
        {nextHref && (
          <a href={nextHref} onClick={(e) => navigate(e, nextHref)}>
            Next
          </a>
        )}
      </nav>
    </div>
  );
}

export function App() {
  const data = useSlides();

  useEffect(() => {
    if (!data) return;
    const { talk, slides, idx } = data;
    const handleKeyDown = (e: KeyboardEvent) => {
      let target: Slide | null = null;
      if (e.key === "ArrowRight" && idx < slides.length - 1) {
        target = slides[idx + 1];
      } else if (e.key === "ArrowLeft" && idx > 0) {
        target = slides[idx - 1];
      }
      if (target) {
        const href = target.slug ? `/talks/${talk}/${target.slug}` : `/talks/${talk}/`;
        window.history.pushState({}, "", href);
        window.dispatchEvent(new PopStateEvent("popstate"));
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [data]);

  if (!data) {
    return <div>Loading...</div>;
  }

  return <SlideView talk={data.talk} slides={data.slides} idx={data.idx} />;
}

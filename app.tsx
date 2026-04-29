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

  useEffect(() => {
    const parts = window.location.pathname.split("/").filter(Boolean);
    if (parts.length === 0) return;

    const talk = parts[0];
    const slideSlug = parts[1] ?? "";

    fetch(`/${talk}.md`)
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
  }, []);

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
      ? `/${talk}/${prevSlide.slug}`
      : `/${talk}/`
    : null;
  const nextHref = nextSlide
    ? nextSlide.slug
      ? `/${talk}/${nextSlide.slug}`
      : `/${talk}/`
    : null;

  return (
    <div>
      <div className="slide">{Content ? <Content /> : null}</div>
      <nav>
        {prevHref && <a href={prevHref}>Previous</a>}
        {nextHref && <a href={nextHref}>Next</a>}
      </nav>
    </div>
  );
}

export function App() {
  const data = useSlides();

  if (!data) {
    return <div>Loading...</div>;
  }

  return <SlideView talk={data.talk} slides={data.slides} idx={data.idx} />;
}

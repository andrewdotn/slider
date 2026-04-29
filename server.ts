import express, { type Express } from "express";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { fileURLToPath } from "node:url";
import { i } from "./util/i.ts";
import * as http from "http";
import * as fs from "node:fs/promises";

interface Slide {
  slug: string;
  content: string;
}

function slugify(title: string): string {
  return title.toLowerCase().replace(/\s+/g, "-");
}

function parseTalk(markdown: string): Slide[] {
  const lines = markdown.split("\n");
  const slides: Slide[] = [];
  let currentContent: string[] = [];
  let currentSlug = "";

  for (const line of lines) {
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      if (currentContent.length > 0 || slides.length > 0) {
        slides.push({ slug: currentSlug, content: currentContent.join("\n") });
      }
      const title = headingMatch[2].trim();
      if (slides.length === 0 && headingMatch[1] === "#") {
        currentSlug = "";
        currentContent = [line];
      } else {
        currentSlug = slugify(title);
        currentContent = [line];
      }
    } else {
      currentContent.push(line);
    }
  }

  if (currentContent.length > 0 || slides.length === 0) {
    slides.push({ slug: currentSlug, content: currentContent.join("\n") });
  }

  return slides;
}

function renderSlide(talkName: string, slides: Slide[], idx: number): string {
  const slide = slides[idx];
  let html = `<!-- Slide -->\n${slide.content}\n<!-- /Slide -->`;

  if (idx > 0) {
    const prevSlide = slides[idx - 1];
    const prevHref = prevSlide.slug
      ? `/${talkName}/${prevSlide.slug}`
      : `/${talkName}/`;
    html += `\n<a href="${prevHref}">Previous</a>`;
  }

  if (idx < slides.length - 1) {
    const nextSlide = slides[idx + 1];
    const nextHref = nextSlide.slug
      ? `/${talkName}/${nextSlide.slug}`
      : `/${talkName}/`;
    html += `\n<a href="${nextHref}">Next</a>`;
  }

  return html;
}

export class Server {
  app: Express;

  constructor() {
    const app = express();

    app.get("/hello", (req, res) => {
      res.send("Hello World!");
    });

    app.get("/", async (req, res) => {
      const files = await fs.readdir(".");
      const mdFiles = files
        .filter((f) => f.endsWith(".md"))
        .map((f) => f.replace(/\.md$/, ""));
      const items = mdFiles
        .map((name) => `<li><a href="/${name}/">${name}</a></li>`)
        .join("\n");
      res.send(`<ul>\n${items}\n</ul>`);
    });

    app.get("/:talk/", async (req, res) => {
      const result = await this.loadSlide(req.params.talk, "");
      if (!result) return res.status(404).send("Not found");
      res.send(result);
    });

    app.get("/:talk/:slide", async (req, res) => {
      const result = await this.loadSlide(req.params.talk, req.params.slide);
      if (!result) return res.status(404).send("Not found");
      res.send(result);
    });

    this.app = app;
  }

  private async loadSlide(
    talkName: string,
    slideSlug: string,
  ): Promise<string | null> {
    if (
      talkName.includes("/") ||
      talkName.includes("\\") ||
      talkName.startsWith(".")
    ) {
      return null;
    }

    let markdown: string;
    try {
      markdown = await fs.readFile(`${talkName}.md`, "utf-8");
    } catch {
      return null;
    }

    const slides = parseTalk(markdown);
    const idx = slides.findIndex((s) => s.slug === slideSlug);
    if (idx === -1) return null;

    return renderSlide(talkName, slides, idx);
  }

  async serve({ port }: { port?: number } = {}): Promise<http.Server> {
    const listenMaybeWithPort = (cb: () => void) => {
      if (port !== undefined) {
        return this.app.listen(port, cb);
      } else {
        return this.app.listen(cb);
      }
    };

    return new Promise((resolve) => {
      const server = listenMaybeWithPort(() => {
        console.log(i`now listening on ${server.address()}`);
        resolve(server);
      });
    });
  }
}

type ArgvOptions = {
  port?: number;
};

function main() {
  const argv = yargs(hideBin(process.argv))
    .strict()
    .option("port", { type: "number" }).argv as ArgvOptions;
  new Server().serve({ port: argv.port });
}

if (import.meta?.url && process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}

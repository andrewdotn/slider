export interface Slide {
  slug: string;
  content: string;
}

function slugify(title: string): string {
  return title.toLowerCase().replace(/\s+/g, "-");
}

export function parseTalk(markdown: string): Slide[] {
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

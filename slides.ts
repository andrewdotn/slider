export interface Slide {
  slug: string;
  content: string;
}

export function slideHeading(
  content: string,
): { depth: number; title: string } | null {
  const firstLine = content.split("\n", 1)[0] ?? "";
  const m = firstLine.match(/^(#{1,6})\s+(.+)$/);
  if (!m) return null;
  return { depth: m[1].length, title: m[2].trim() };
}

export function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export function parseTalk(markdown: string): Slide[] {
  const lines = markdown.split("\n");
  const slides: Slide[] = [];
  let currentContent: string[] = [];
  let currentSlug = "";
  const slugCounts = new Map<string, number>();

  function dedupeSlug(slug: string): string {
    if (slug === "") return slug;
    const count = slugCounts.get(slug) ?? 0;
    slugCounts.set(slug, count + 1);
    return count === 0 ? slug : `${slug}-${count + 1}`;
  }

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
        currentSlug = dedupeSlug(slugify(title));
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

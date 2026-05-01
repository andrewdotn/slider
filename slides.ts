export interface Slide {
  slug: string;
  content: string;
  level: number;
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
  let currentLevel = 1;
  let baseSlug = "";
  const slugCounts = new Map<string, number>();
  const breakRe = /^\s*<Break\s*\/>\s*$/;

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
        slides.push({
          slug: currentSlug,
          content: currentContent.join("\n"),
          level: currentLevel,
        });
      }
      const title = headingMatch[2].trim();
      currentLevel = headingMatch[1].length;
      if (slides.length === 0 && headingMatch[1] === "#") {
        currentSlug = "";
        baseSlug = "";
        currentContent = [line];
      } else {
        baseSlug = slugify(title);
        currentSlug = dedupeSlug(baseSlug);
        currentContent = [line];
      }
    } else if (breakRe.test(line)) {
      if (currentContent.length > 0 || slides.length > 0) {
        slides.push({
          slug: currentSlug,
          content: currentContent.join("\n"),
          level: currentLevel,
        });
      }
      currentSlug = dedupeSlug(baseSlug || "slide");
      currentContent = [];
    } else {
      currentContent.push(line);
    }
  }

  if (currentContent.length > 0 || slides.length === 0) {
    slides.push({
      slug: currentSlug,
      content: currentContent.join("\n"),
      level: currentLevel,
    });
  }

  return slides;
}

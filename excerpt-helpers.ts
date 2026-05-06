export type ExcerptInterval = { start: number; end: number };

export function computeExcerpts(
  text: string,
  regexes: [RegExp, RegExp][],
): { excerptedText: string; intervals: ExcerptInterval[] } {
  const lines = text.split("\n");
  const intervals: ExcerptInterval[] = [];
  const sections: string[][] = [];
  let cursor = 0;

  for (const [startRe, endRe] of regexes) {
    while (cursor < lines.length) {
      let startIdx = -1;
      for (let i = cursor; i < lines.length; i++) {
        if (startRe.test(lines[i])) {
          startIdx = i;
          break;
        }
      }
      if (startIdx === -1) break;

      let endIdx = -1;
      for (let i = startIdx + 1; i < lines.length; i++) {
        if (endRe.test(lines[i])) {
          endIdx = i;
          break;
        }
      }
      if (endIdx === -1) break;

      const excerptLines = lines.slice(startIdx + 1, endIdx);
      intervals.push({ start: startIdx + 1, end: endIdx - 1 });
      sections.push(excerptLines);
      cursor = endIdx + 1;
    }
  }

  if (sections.length === 0) {
    return { excerptedText: text, intervals: [{ start: 0, end: lines.length - 1 }] };
  }

  const parts: string[] = [];
  for (let i = 0; i < sections.length; i++) {
    if (i > 0) {
      const nextFirst = sections[i][0] ?? "";
      const indent = nextFirst.match(/^(\s*)/)?.[1] ?? "";
      parts.push(indent + "…");
    }
    parts.push(...sections[i]);
  }
  return { excerptedText: parts.join("\n"), intervals };
}

export function reconstructFullFile(
  originalText: string,
  editedText: string,
  intervals: ExcerptInterval[],
): string {
  const originalLines = originalText.split("\n");
  const editedLines = editedText.split("\n");

  // Split edited text on … separator lines
  const segments: string[][] = [];
  let current: string[] = [];
  for (const line of editedLines) {
    if (/^\s*…\s*$/.test(line)) {
      segments.push(current);
      current = [];
    } else {
      current.push(line);
    }
  }
  segments.push(current);

  if (segments.length !== intervals.length) {
    throw new Error(
      `Expected ${intervals.length - 1} … separator(s) but found ${segments.length - 1}`,
    );
  }

  // Build result by replacing intervals
  const result: string[] = [];
  let lastEnd = -1;
  for (let i = 0; i < intervals.length; i++) {
    const { start, end } = intervals[i];
    // Copy lines before this interval (from after last interval end to before this start)
    for (let j = lastEnd + 1; j < start; j++) {
      result.push(originalLines[j]);
    }
    // Insert edited segment
    if (i < segments.length) {
      result.push(...segments[i]);
    }
    lastEnd = end;
  }
  // Copy remaining lines after last interval
  for (let j = lastEnd + 1; j < originalLines.length; j++) {
    result.push(originalLines[j]);
  }
  return result.join("\n");
}

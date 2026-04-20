import matter from "gray-matter";

export type FrontmatterValue =
  | string
  | number
  | boolean
  | null
  | FrontmatterValue[]
  | { [key: string]: FrontmatterValue };

export interface ParsedFrontmatter {
  frontmatterRaw: string;
  frontmatterData: Record<string, FrontmatterValue>;
  body: string;
}

const LEADING_FRONTMATTER_RE =
  /^(?:\n+)?---[ \t]*\n([\s\S]*?)\n---[ \t]*(?:\n|$)([\s\S]*)$/;
const FALLBACK_SUMMARY_KEYS = new Set([
  "name",
  "description",
  "description_zh",
  "description_en",
  "version",
]);

function normalizeFrontmatterInput(markdown: string): string {
  return markdown
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .replace(/^(?:\u200B|\u200C|\u200D|\u2060)+/, "");
}

function extractLeadingFrontmatter(markdown: string) {
  const match = markdown.match(LEADING_FRONTMATTER_RE);
  if (!match) {
    return null;
  }

  return {
    frontmatterRaw: match[1],
    body: match[2].trimStart(),
  };
}

function unquoteFrontmatterValue(value: string) {
  const trimmed = value.trim();
  if (trimmed.length >= 2) {
    const quote = trimmed[0];
    if ((quote === `"` || quote === `'`) && trimmed.at(-1) === quote) {
      return trimmed.slice(1, -1).trim();
    }
  }
  return trimmed;
}

function foldBlockScalarLines(lines: string[], style: ">" | "|") {
  if (style === "|") {
    return lines.join("\n").trim();
  }
  return lines
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ")
    .trim();
}

function extractFallbackFrontmatterData(frontmatterRaw: string): Record<string, FrontmatterValue> {
  const lines = frontmatterRaw.split("\n");
  const extracted: Record<string, FrontmatterValue> = {};

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!match) {
      continue;
    }

    const [, key, rawValue] = match;
    if (!FALLBACK_SUMMARY_KEYS.has(key) || extracted[key] !== undefined) {
      continue;
    }

    const normalizedValue = rawValue.trim();

    if (/^[>|][+-]?$/.test(normalizedValue)) {
      const style = normalizedValue[0] as ">" | "|";
      const blockLines: string[] = [];
      let cursor = index + 1;

      while (cursor < lines.length) {
        const nextLine = lines[cursor];
        if (/^( {2,}|\t+)/.test(nextLine)) {
          blockLines.push(nextLine.replace(/^[ \t]+/, ""));
          cursor += 1;
          continue;
        }

        if (!nextLine.trim()) {
          blockLines.push("");
          cursor += 1;
          continue;
        }

        break;
      }

      extracted[key] = foldBlockScalarLines(blockLines, style);
      index = cursor - 1;
      continue;
    }

    extracted[key] = unquoteFrontmatterValue(normalizedValue);
  }

  if (typeof extracted.description !== "string" || !extracted.description.trim()) {
    const localizedDescription =
      (typeof extracted.description_zh === "string" && extracted.description_zh.trim())
      || (typeof extracted.description_en === "string" && extracted.description_en.trim())
      || null;

    if (localizedDescription) {
      extracted.description = localizedDescription;
    }
  }

  return Object.fromEntries(
    Object.entries(extracted).filter(([, value]) => typeof value !== "string" || value.trim())
  );
}

export function parseFrontmatter(markdown: string): ParsedFrontmatter {
  if (!markdown.trim()) {
    return {
      frontmatterRaw: "",
      frontmatterData: {},
      body: markdown,
    };
  }

  const normalizedMarkdown = normalizeFrontmatterInput(markdown);
  const extracted = extractLeadingFrontmatter(normalizedMarkdown);

  try {
    const parsed = matter(normalizedMarkdown);

    return {
      frontmatterRaw: extracted?.frontmatterRaw ?? parsed.matter,
      frontmatterData: (parsed.data ?? {}) as Record<string, FrontmatterValue>,
      body: parsed.content.trimStart(),
    };
  } catch {
    if (extracted) {
      const fallbackData = extractFallbackFrontmatterData(extracted.frontmatterRaw);
      return {
        frontmatterRaw: extracted.frontmatterRaw,
        frontmatterData: fallbackData,
        body: extracted.body,
      };
    }

    return {
      frontmatterRaw: "",
      frontmatterData: {},
      body: normalizedMarkdown,
    };
  }
}

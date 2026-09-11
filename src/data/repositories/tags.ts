/**
 * Tag normalisation and the JSON codec for the `tags` column.
 *
 * Tags are stored as a JSON array of strings. Parsing is defensive: a corrupt
 * or hand-edited value degrades to "no tags" rather than breaking the row.
 */

/** Trim, drop blanks, and de-duplicate case-insensitively (first spelling wins). */
export function normalizeTags(tags: readonly string[] | undefined): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of tags ?? []) {
    const tag = raw.trim();
    if (tag === '') continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(tag);
  }
  return result;
}

/** Read the `tags` column; never throws. */
export function parseTags(text: string | null | undefined): string[] {
  if (!text) return [];
  try {
    const parsed: unknown = JSON.parse(text);
    if (!Array.isArray(parsed)) return [];
    return normalizeTags(parsed.filter((tag): tag is string => typeof tag === 'string'));
  } catch {
    return [];
  }
}

export function serializeTags(tags: readonly string[]): string {
  return JSON.stringify(normalizeTags(tags));
}

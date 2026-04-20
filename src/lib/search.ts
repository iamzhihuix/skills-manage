export function normalizeSearchQuery(value: string) {
  return value.trim().toLowerCase();
}

export function buildSearchText(parts: Array<string | null | undefined>) {
  return parts
    .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
    .join(" ")
    .toLowerCase();
}

export function scoreSearchMatch(
  query: string,
  labelText: string,
  descriptionText: string,
  searchText: string
) {
  if (!query) return 0;
  if (labelText.startsWith(query)) return 0;
  if (labelText.includes(query)) return 1;
  if (descriptionText.startsWith(query)) return 2;
  if (descriptionText.includes(query)) return 3;
  if (searchText.includes(query)) return 4;
  return Number.POSITIVE_INFINITY;
}

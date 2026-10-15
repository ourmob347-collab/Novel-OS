/** Curated genre chips for New Manuscript - keep the list short and hybrid-friendly. */
export const GENRE_OPTIONS = [
  "Фэнтези",
  "Романтика",
  "Триллер",
  "Детектив",
  "Научная фантастика",
  "Литература",
  "Хоррор",
  "Историческое",
  "Подростковое",
  "Взрослое",
  "Тёмное",
  "Юмор",
  "Приключения",
  "Современное",
] as const;

/** Merge chip selections + Other into the genres array sent to the API. */
export function mergeGenres(selected: string[], other: string): string[] {
  const out = [...selected];
  const t = other.trim();
  if (t && !out.some((s) => s.toLowerCase() === t.toLowerCase())) out.push(t);
  return out;
}

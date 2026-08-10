// For download filenames (Content-Disposition), not stored paths — folds
// accented Latin letters to their plain form (á->a, ñ->n, ...) instead of
// just dropping them, so "Árbol genealógico" degrades to "Arbol_genealogico"
// rather than "rbol_genealgico".
export function downloadFilename(label: string, fallback: string): string {
  const cleaned = label
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9 _-]/g, "")
    .trim()
    .replace(/\s+/g, "_");
  return cleaned || fallback;
}

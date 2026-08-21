export const THEMES = ["light", "dark"] as const;
export type Theme = (typeof THEMES)[number];

const STORAGE_KEY = "familytree.theme";

export function getTheme(): Theme {
  const stored = localStorage.getItem(STORAGE_KEY);
  return THEMES.includes(stored as Theme) ? (stored as Theme) : "light";
}

// Writes data-theme onto <html> — App.css's `:root[data-theme="dark"]`
// block is the only thing that reads it. Applied via plain DOM (not React
// state/context) since the whole app is meant to react to it purely
// through CSS custom properties, the same way i18n.ts drives translated
// text without a ThemeProvider wrapping the tree.
export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
}

export function setTheme(theme: Theme) {
  localStorage.setItem(STORAGE_KEY, theme);
  applyTheme(theme);
}

// Runs once at import time (see main.tsx, imported before <App/> renders)
// so the right theme is already on <html> before React paints anything —
// avoids a flash of the wrong theme on load.
applyTheme(getTheme());

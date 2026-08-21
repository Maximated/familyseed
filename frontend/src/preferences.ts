// Per-device UI preferences set from Settings — plain localStorage, same
// pattern as i18n.ts/theme.ts, not synced server-side: these are about how
// this browser displays the app, not data that should follow the account
// across devices.

export type TreeOrientation = "vertical" | "horizontal";

const ORIENTATION_KEY = "familytree.defaultOrientation";

// Read once when a tree first opens (see TreeView.tsx's orientation
// useState) — not reactive, since changing the default in Settings isn't
// meant to yank the orientation out from under a tree you already have open.
export function getDefaultOrientation(): TreeOrientation {
  return localStorage.getItem(ORIENTATION_KEY) === "horizontal" ? "horizontal" : "vertical";
}

export function setDefaultOrientation(orientation: TreeOrientation) {
  localStorage.setItem(ORIENTATION_KEY, orientation);
}

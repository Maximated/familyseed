// Checked once, not reactively — the input method a session started with is
// what its interactions should match for its whole lifetime, and a live
// media-query listener would only add complexity for the edge case of
// switching mid-session (e.g. plugging in a mouse on a tablet). Shared by
// SwipeRow (desktop hover-reveal vs touch swipe-reveal) and TreeView (the
// tree canvas's own touch-specific card actions and PWA layout).
export const isHoverCapable =
  typeof window !== "undefined" && window.matchMedia("(hover: hover) and (pointer: fine)").matches;

import type { UnionInfo, UnionStatus, UnionType } from "./api";

// Replaced the old Unicode dingbats (⚭ marriage, ✝ death, ⚮ divorce/
// separation/annulment all sharing one glyph, …) with real icons — several
// mobile browsers/OSes substitute their own emoji-presentation glyph for
// bare dingbat characters like ✝, so the "ended by death" mark was
// literally showing up as a cross emoji instead of the app's own mark,
// inconsistently per platform. These are plain stroke paths (same
// currentColor/stroke-width convention as every other icon in Icons.tsx),
// so they render identically everywhere and can be recolored the same way
// text could. Path data copied from Images/new_icons/*.svg.
// UNKNOWN still gets its own icon rather than nothing — it's a common,
// permanent state (every family attachParent auto-creates when linking a
// parent to a child defaults to it, since there's no union info to record
// at that point), not a rare edge case; a blank mark previously made those
// unions render invisibly on the canvas — see the "ya existe esa relación"
// bug report.
export const UNION_TYPE_ICON_PATHS: Record<UnionType, string> = {
  MARRIAGE: '<circle cx="14" cy="12" r="6"/><circle cx="10" cy="12" r="6"/>',
  PARTNERSHIP: '<path d="M8 7 v10"/><path d="M16 7 v10"/><path d="M8 12 h8"/>',
  EXTRAMARITAL:
    '<circle cx="9" cy="12" r="3.5"/><circle cx="15" cy="12" r="3.5"/><circle cx="20" cy="7" r="2.5"/><path d="M15 8 l3 -1"/>',
  UNKNOWN: '<circle cx="12" cy="12" r="8"/>',
};

// No ONGOING entry — that status never got a mark of its own (nothing to
// add beside the union-type icon when nothing's ended), same as the old
// symbol table's empty string.
export const UNION_STATUS_ICON_PATHS: Partial<Record<UnionStatus, string>> = {
  ENDED_BY_DEATH: '<path d="M12 4 v16"/><path d="M6 9 h12"/>',
  DIVORCED: '<path d="M8 6 a6 6 0 0 1 0 12"/><path d="M16 6 a6 6 0 0 0 0 12"/><path d="M12 6 v2"/><path d="M12 16 v2"/>',
  SEPARATED: '<path d="M7 5 l-2 14"/><path d="M17 5 l2 14"/><path d="M9 12 h6" stroke-dasharray="1 3"/>',
  ANNULLED: '<circle cx="12" cy="12" r="8"/><path d="M7 17 l10 -10"/>',
};

// Canvas-only sizing — the React-rendered version (UnionMarkIcon below)
// sizes itself independently via its own `size` prop.
const CANVAS_ICON_SIZE = 22;
const CANVAS_ICON_GAP = 3;

function svgIcon(paths: string, x: number, y: number): string {
  return `<svg x="${x}" y="${y}" width="${CANVAS_ICON_SIZE}" height="${CANVAS_ICON_SIZE}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
}

// The actual on-canvas mark: the union-type icon, an optional status icon
// beside it (nothing when ONGOING), and an optional small "2nd (or later)
// union with this person" number badge — built as raw SVG markup (not
// JSX) since this gets injected via a real SVG <g>'s innerHTML in
// TreeView.tsx's wireCardAndUnionClicks, not rendered by React
// (family-chart owns that part of the DOM, the same way cardTemplate's own
// icon constants do for the card corners). Centered on (0, 0) — the
// parent g.link-text's own transform does the actual positioning.
export function unionMarkMarkup(union: UnionInfo): string {
  const statusPaths = UNION_STATUS_ICON_PATHS[union.unionStatus];
  const iconPaths = [UNION_TYPE_ICON_PATHS[union.unionType], ...(statusPaths ? [statusPaths] : [])];
  const totalWidth = iconPaths.length * CANVAS_ICON_SIZE + (iconPaths.length - 1) * CANVAS_ICON_GAP;
  const startX = -totalWidth / 2;
  const icons = iconPaths
    .map((paths, i) => svgIcon(paths, startX + i * (CANVAS_ICON_SIZE + CANVAS_ICON_GAP), -CANVAS_ICON_SIZE / 2))
    .join("");
  const orderBadge =
    union.order >= 2
      ? `<text class="union-mark-order" x="${startX + CANVAS_ICON_SIZE - 3}" y="${-CANVAS_ICON_SIZE / 2 + 9}" font-size="12" font-weight="700">${union.order}</text>`
      : "";
  return `${icons}${orderBadge}`;
}

// A single icon, as JSX — reused for both the union-type and (optionally)
// status half of UnionMarkIcon below, and directly by Legend.tsx's rows
// (which only ever need one icon at a time, never a pair).
export function UnionIconSvg({ paths, size = 20 }: { paths: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      // Safe here: `paths` only ever comes from the fixed constants above,
      // never user input.
      dangerouslySetInnerHTML={{ __html: paths }}
    />
  );
}

// Same icon pair as the canvas mark, but as real JSX for InfoPanel's
// header badge (see TreeView.tsx's buildUnionInfoPanel) — reuses the same
// path-data constants above rather than keeping a second, JSX-only copy of
// the same paths to drift out of sync with the canvas version. No order
// badge — the header's own subtitle already spells out "2ª unión" in
// words (see buildUnionInfoPanel's subtitle).
export function UnionMarkIcon({ unionType, unionStatus }: { unionType: UnionType; unionStatus: UnionStatus }) {
  const statusPaths = UNION_STATUS_ICON_PATHS[unionStatus];
  return (
    <span className="union-mark-icon-group">
      <UnionIconSvg paths={UNION_TYPE_ICON_PATHS[unionType]} />
      {statusPaths && <UnionIconSvg paths={statusPaths} />}
    </span>
  );
}

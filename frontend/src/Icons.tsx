// Small stroke-icon set (Lucide glyphs, MIT) used for the icon-only header
// buttons — kept as plain React components rather than a dependency since
// we only need a handful.
type IconProps = { size?: number };

function Svg({ size = 18, children }: { size?: number; children: React.ReactNode }) {
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
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export function ArrowLeftIcon({ size }: IconProps) {
  return (
    <Svg size={size}>
      <path d="m12 19-7-7 7-7" />
      <path d="M19 12H5" />
    </Svg>
  );
}

export function PencilIcon({ size }: IconProps) {
  return (
    <Svg size={size}>
      <path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .622.622l4.353-1.321a2 2 0 0 0 .83-.497Z" />
      <path d="m15 5 4 4" />
    </Svg>
  );
}

export function Trash2Icon({ size }: IconProps) {
  return (
    <Svg size={size}>
      <path d="M3 6h18" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </Svg>
  );
}

export function UserPlusIcon({ size }: IconProps) {
  return (
    <Svg size={size}>
      <path d="M2 21a8 8 0 0 1 13.292-6" />
      <circle cx="10" cy="8" r="5" />
      <path d="M19 16v6" />
      <path d="M22 19h-6" />
    </Svg>
  );
}

// Trunk splitting into branches — stands in for "lineages" without
// needing a literal tree glyph (which would be confusable with the
// genealogy tree itself).
export function GitBranchIcon({ size }: IconProps) {
  return (
    <Svg size={size}>
      <line x1="6" y1="3" x2="6" y2="15" />
      <circle cx="18" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M18 9a9 9 0 0 1-9 9" />
    </Svg>
  );
}

export function UserIcon({ size }: IconProps) {
  return (
    <Svg size={size}>
      <path d="M20 21a8 8 0 0 0-16 0" />
      <circle cx="12" cy="7" r="4" />
    </Svg>
  );
}

export function GlobeIcon({ size }: IconProps) {
  return (
    <Svg size={size}>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
      <path d="M2 12h20" />
    </Svg>
  );
}

export function FileTextIcon({ size }: IconProps) {
  return (
    <Svg size={size}>
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4" />
      <path d="M10 9H8" />
      <path d="M16 13H8" />
      <path d="M16 17H8" />
    </Svg>
  );
}

export function ArrowUpDownIcon({ size }: IconProps) {
  return (
    <Svg size={size}>
      <path d="m21 16-4 4-4-4" />
      <path d="M17 20V4" />
      <path d="m3 8 4-4 4 4" />
      <path d="M7 4v16" />
    </Svg>
  );
}

export function SearchIcon({ size }: IconProps) {
  return (
    <Svg size={size}>
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </Svg>
  );
}

export function HomeIcon({ size }: IconProps) {
  return (
    <Svg size={size}>
      <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <path d="M9 22V12h6v10" />
    </Svg>
  );
}

// Two overlapping circles — reads as "duplicates" (a Venn-diagram-style
// overlap) rather than any of Lucide's literal "merge" glyphs, which lean
// too heavily on a git-branch metaphor to make sense here.
export function DuplicatesIcon({ size }: IconProps) {
  return (
    <Svg size={size}>
      <circle cx="9" cy="12" r="7" />
      <circle cx="15" cy="12" r="7" />
    </Svg>
  );
}

export function ShareIcon({ size }: IconProps) {
  return (
    <Svg size={size}>
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
      <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
    </Svg>
  );
}

// Two interlocking rings — reused as the "link two existing people" glyph:
// literally a pair of rings, and reads as "connect" without redrawing
// DuplicatesIcon's flat Venn overlap.
export function LinkIcon({ size }: IconProps) {
  return (
    <Svg size={size}>
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </Svg>
  );
}

// Three horizontal bars stacked — shown when the tree currently flows
// top-to-bottom, to mean "switch to left-to-right" (the icon reads as the
// layout you'd get after pressing it, like a grid/list view toggle).
export function RowsIcon({ size }: IconProps) {
  return (
    <Svg size={size}>
      <rect x="3" y="4" width="18" height="4" rx="1" />
      <rect x="3" y="10" width="18" height="4" rx="1" />
      <rect x="3" y="16" width="18" height="4" rx="1" />
    </Svg>
  );
}

// Three vertical bars side by side — shown when the tree currently flows
// left-to-right, to mean "switch back to top-to-bottom".
export function ColumnsIcon({ size }: IconProps) {
  return (
    <Svg size={size}>
      <rect x="4" y="3" width="4" height="18" rx="1" />
      <rect x="10" y="3" width="4" height="18" rx="1" />
      <rect x="16" y="3" width="4" height="18" rx="1" />
    </Svg>
  );
}

// A question mark in a circle — reused for "people with no relationships
// yet" (e.g. right after an import that got interrupted), since each is an
// open question about how they connect to the rest of the tree, unlike a
// duplicate pair (DuplicatesIcon) or an already-chosen pair (LinkIcon).
export function UnresolvedIcon({ size }: IconProps) {
  return (
    <Svg size={size}>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
      <path d="M12 17h.01" />
    </Svg>
  );
}

export function MenuIcon({ size }: IconProps) {
  return (
    <Svg size={size}>
      <line x1="4" y1="6" x2="20" y2="6" />
      <line x1="4" y1="12" x2="20" y2="12" />
      <line x1="4" y1="18" x2="20" y2="18" />
    </Svg>
  );
}

export function MaximizeIcon({ size }: IconProps) {
  return (
    <Svg size={size}>
      <path d="M8 3H5a2 2 0 0 0-2 2v3" />
      <path d="M21 8V5a2 2 0 0 0-2-2h-3" />
      <path d="M3 16v3a2 2 0 0 0 2 2h3" />
      <path d="M16 21h3a2 2 0 0 0 2-2v-3" />
    </Svg>
  );
}

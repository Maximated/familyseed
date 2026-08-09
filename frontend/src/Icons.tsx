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

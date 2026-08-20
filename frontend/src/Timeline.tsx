import { useEffect, useMemo, useRef, useState } from "react";
import i18n from "./i18n";
import type { TreePerson } from "./api";

type Bucket = {
  start: number;
  end: number;
  label: string;
  title: string;
  count: number;
};

const DECADE_THRESHOLD = 5;
const ROMAN_ONES = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX"];
const ROMAN_TENS = ["", "X", "XX", "XXX"];

function toRoman(n: number): string {
  return ROMAN_TENS[Math.floor(n / 10)] + ROMAN_ONES[n % 10];
}

// Compresses sparse old ranges into whole-century buckets and expands dense
// recent ranges into decades — reused here purely to pick a reasonable,
// data-density-aware set of intermediate year markers (see `pickTicks`
// below), the same judgment call the old trunk-and-branch design used it
// for.
export function computeBuckets(birthYears: number[], currentYear: number): Bucket[] {
  if (birthYears.length === 0) return [];

  const minYear = Math.min(...birthYears);
  const startCentury = Math.floor(minYear / 100) * 100;
  const buckets: Bucket[] = [];

  for (let century = startCentury; century <= currentYear; century += 100) {
    const centuryEnd = Math.min(century + 100, currentYear + 1);
    const countInCentury = birthYears.filter((y) => y >= century && y < centuryEnd).length;
    if (countInCentury === 0) continue;

    if (countInCentury < DECADE_THRESHOLD) {
      buckets.push({
        start: century,
        end: centuryEnd - 1,
        label: i18n.t("timeline.century", { roman: toRoman(century / 100 + 1) }),
        title: `${century}–${centuryEnd - 1}`,
        count: countInCentury,
      });
      continue;
    }

    for (let decade = century; decade < centuryEnd; decade += 10) {
      const decadeEnd = Math.min(decade + 10, centuryEnd);
      const countInDecade = birthYears.filter((y) => y >= decade && y < decadeEnd).length;
      if (countInDecade === 0) continue;
      buckets.push({
        start: decade,
        end: decadeEnd - 1,
        label: `${decade}`,
        title: `${decade}–${decadeEnd - 1}`,
        count: countInDecade,
      });
    }
  }

  return buckets;
}

// Prefer someone actually *born* in this bucket's range — that's what a
// user clicking "2000" expects to land on. Falling back to "alive at some
// point during the bucket" (sorted oldest-first) without that preference
// would always favor a much older ancestor who simply lived long enough to
// still be alive then, over anyone actually born in the clicked era.
function pickRepresentative(people: TreePerson[], bucket: Bucket): string | null {
  const born = people
    .filter((p) => p.data.birthYear !== undefined)
    .filter((p) => (p.data.birthYear as number) >= bucket.start && (p.data.birthYear as number) <= bucket.end)
    .sort((a, b) => (a.data.birthYear as number) - (b.data.birthYear as number));
  if (born.length > 0) return born[0].id;

  const alive = people
    .filter((p) => p.data.birthYear !== undefined)
    .filter((p) => {
      const birth = p.data.birthYear as number;
      const death = p.data.deathYear;
      return birth <= bucket.end && (death === undefined || death >= bucket.start);
    })
    .sort((a, b) => (a.data.birthYear as number) - (b.data.birthYear as number));

  return alive[0]?.id ?? null;
}

type Orientation = "vertical" | "horizontal";

type Marker = {
  year: number;
  label: string;
  title: string;
  personId: string | null;
  endpoint: boolean;
};

const MAX_INTERMEDIATE_TICKS = 6;
const MIN_TICK_GAP_PX = 26;
const EDGE_PAD = 16;
// The two orientations have genuinely different cross-axis budgets — the
// vertical sidebar is a narrow 132px (--timeline-width), the horizontal
// bottom strip a taller 170px — so the SVG's cross-axis size and where the
// line sits within it are picked per orientation rather than shared,
// giving the (much taller, Bebas-Neue-sized) year labels enough room below
// the line without the SVG's own edge clipping them.
const CROSS_EXTENT_VERTICAL = 120;
const CROSS_EXTENT_HORIZONTAL = 150;
const LINE_ACROSS_VERTICAL = 96;
const LINE_ACROSS_HORIZONTAL = 40;

// Downsamples to at most `max` entries, always keeping the first and last,
// evenly spaced across the index range in between.
function downsample<T>(items: T[], max: number): T[] {
  if (items.length <= max) return items;
  const step = (items.length - 1) / (max - 1);
  const picked: T[] = [];
  for (let i = 0; i < max; i++) {
    picked.push(items[Math.round(i * step)]);
  }
  return picked.filter((item, i) => i === 0 || item !== picked[i - 1]);
}

// Builds the marker list: the exact oldest/youngest birth years as the two
// endpoints (each pointing straight at that specific person, not a bucket
// range), plus a handful of intermediate era markers reusing computeBuckets'
// existing decade/century density judgment so there's still something to
// click/scrub through between the ends on a tree that spans centuries.
function buildMarkers(people: TreePerson[]): Marker[] {
  const withYears = people.filter((p): p is TreePerson & { data: { birthYear: number } } => p.data.birthYear !== undefined);
  if (withYears.length === 0) return [];

  const minYear = Math.min(...withYears.map((p) => p.data.birthYear));
  const maxYear = Math.max(...withYears.map((p) => p.data.birthYear));

  const oldest = withYears.filter((p) => p.data.birthYear === minYear).sort((a, b) => a.id.localeCompare(b.id))[0];
  const youngest = withYears.filter((p) => p.data.birthYear === maxYear).sort((a, b) => a.id.localeCompare(b.id))[0];

  const markers: Marker[] = [
    { year: minYear, label: `${minYear}`, title: `${minYear}`, personId: oldest.id, endpoint: true },
  ];

  if (maxYear !== minYear) {
    const buckets = computeBuckets(
      withYears.map((p) => p.data.birthYear),
      new Date().getFullYear(),
    );
    const middleBuckets = buckets.filter((b) => b.start > minYear && b.start < maxYear);
    for (const bucket of downsample(middleBuckets, MAX_INTERMEDIATE_TICKS)) {
      const personId = pickRepresentative(people, bucket);
      if (personId) markers.push({ year: bucket.start, label: bucket.label, title: bucket.title, personId, endpoint: false });
    }
    markers.push({ year: maxYear, label: `${maxYear}`, title: `${maxYear}`, personId: youngest.id, endpoint: true });
  }

  return markers;
}

function toScreen(along: number, orientation: Orientation): { x: number; y: number } {
  const lineAcross = orientation === "horizontal" ? LINE_ACROSS_HORIZONTAL : LINE_ACROSS_VERTICAL;
  return orientation === "horizontal" ? { x: along, y: lineAcross } : { x: lineAcross, y: along };
}

type Props = {
  people: TreePerson[];
  orientation: Orientation;
  onNavigate: (personId: string) => void;
};

export default function Timeline({ people, orientation, onNavigate }: Props) {
  const draggingRef = useRef(false);
  const lastMarkerIndexRef = useRef<number | null>(null);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [containerLength, setContainerLength] = useState(0);
  // A callback ref (not useRef+useEffect([])) because the container only
  // starts existing once `markers` is non-empty (see the early return
  // below) — a plain ref's mount effect would fire once with a null node
  // and never re-arm when the div actually shows up later.
  const [container, setContainer] = useState<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!container) return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect) return;
      const length = orientation === "horizontal" ? rect.width : rect.height;
      if (length) setContainerLength(length);
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [container, orientation]);

  const markers = useMemo(() => buildMarkers(people), [people]);

  // Positions every marker by true chronological proportion between the
  // oldest and youngest year — an honest date range, not the old design's
  // artificial recency weighting. Then thins out any intermediate marker
  // that lands too close (in pixels) to the one before it, so labels at
  // the new larger size don't overlap when a lot of the data clusters into
  // a narrow span of years; the two endpoints are always kept regardless.
  const positioned = useMemo(() => {
    if (markers.length === 0 || containerLength === 0) return [];
    const minYear = markers[0].year;
    const maxYear = markers[markers.length - 1].year;
    // Insets both endpoints from the container's edges so the larger
    // endpoint labels (vertically centered on their tick) have room to
    // render without getting clipped by the strip's top/bottom.
    const usable = Math.max(containerLength - 2 * EDGE_PAD, 0);
    const withAlong = markers.map((marker) => ({
      marker,
      along: EDGE_PAD + (maxYear === minYear ? usable / 2 : ((marker.year - minYear) / (maxYear - minYear)) * usable),
    }));

    // An endpoint always wins over a too-close preceding intermediate tick
    // (evicting it), rather than the reverse — the exact oldest/youngest
    // birth year is the one thing the redesign specifically promises.
    const kept: typeof withAlong = [];
    for (const entry of withAlong) {
      const last = kept[kept.length - 1];
      if (entry.marker.endpoint) {
        if (last && !last.marker.endpoint && entry.along - last.along < MIN_TICK_GAP_PX) kept.pop();
        kept.push(entry);
        continue;
      }
      if (!last || entry.along - last.along >= MIN_TICK_GAP_PX) kept.push(entry);
    }
    return kept;
  }, [markers, containerLength]);

  function activateMarker(index: number) {
    const entry = positioned[index];
    if (!entry?.marker.personId) return;
    lastMarkerIndexRef.current = index;
    setActiveIndex(index);
    onNavigate(entry.marker.personId);
  }

  function activateAtPoint(clientX: number, clientY: number) {
    const el = document.elementFromPoint(clientX, clientY);
    const markerEl = el?.closest("[data-marker-index]");
    if (!markerEl) return;
    const index = Number(markerEl.getAttribute("data-marker-index"));
    if (index === lastMarkerIndexRef.current) return;
    activateMarker(index);
  }

  function handlePointerDown(e: React.PointerEvent) {
    draggingRef.current = true;
    lastMarkerIndexRef.current = null;
    activateAtPoint(e.clientX, e.clientY);
  }

  function handlePointerMove(e: React.PointerEvent) {
    if (!draggingRef.current) return;
    activateAtPoint(e.clientX, e.clientY);
  }

  function handlePointerUp() {
    draggingRef.current = false;
  }

  if (markers.length === 0) return null;

  const contentLength = Math.max(containerLength, 1);
  const crossExtent = orientation === "horizontal" ? CROSS_EXTENT_HORIZONTAL : CROSS_EXTENT_VERTICAL;
  const svgWidth = orientation === "horizontal" ? contentLength : crossExtent;
  const svgHeight = orientation === "horizontal" ? crossExtent : contentLength;
  const lineStart = toScreen(0, orientation);
  const lineEnd = toScreen(contentLength, orientation);

  return (
    <div
      ref={setContainer}
      className={`timeline timeline-${orientation}`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
    >
      {containerLength > 0 && (
        <svg className="timeline-svg" width={svgWidth} height={svgHeight}>
          <line x1={lineStart.x} y1={lineStart.y} x2={lineEnd.x} y2={lineEnd.y} className="timeline-line" />
          {positioned.map(({ marker, along }, index) => {
            const point = toScreen(along, orientation);
            const isActive = index === activeIndex;
            const hitArea =
              orientation === "horizontal"
                ? { x: point.x - 18, y: 0, width: 36, height: crossExtent }
                : { x: 0, y: point.y - 12, width: crossExtent, height: 24 };

            return (
              <g
                key={`${marker.year}-${marker.label}`}
                data-marker-index={index}
                className={`timeline-marker-group${isActive ? " timeline-marker-active" : ""}`}
              >
                <title>{marker.title}</title>
                <rect x={hitArea.x} y={hitArea.y} width={hitArea.width} height={hitArea.height} className="timeline-hit-area" />
                <text
                  x={orientation === "horizontal" ? point.x : point.x - 10}
                  y={orientation === "horizontal" ? point.y + 22 : point.y}
                  textAnchor={orientation === "horizontal" ? "middle" : "end"}
                  dominantBaseline="middle"
                  className={`timeline-year${marker.endpoint ? " timeline-year-endpoint" : ""}`}
                >
                  {marker.label}
                </text>
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}

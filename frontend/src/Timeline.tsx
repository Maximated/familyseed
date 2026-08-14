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
// recent ranges into decades, so the sidebar stays a fixed, evenly-clickable
// strip no matter how far back the data goes — a family with ancestors from
// the 1700s and a boom of records after 1950 gets a handful of century
// blocks up top and real decade granularity where the data actually is.
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

function pickRepresentative(people: TreePerson[], bucket: Bucket): string | null {
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

// Every geometry function below works in an orientation-agnostic (along,
// across) space instead of (x, y): "along" is the position along the
// trunk's own length — the chronological axis, oldest era at 0 and today
// at the far end — and "across" is the perpendicular distance from the
// trunk's centerline (0 = on the trunk, positive = out toward a branch's
// leaves/label). toScreen is the only place that decides which becomes x
// and which becomes y, so the vertical (trunk running top-to-bottom,
// branches reaching right) and horizontal (trunk running left-to-right,
// branches reaching down) modes share every other calculation — matching
// the same oldest→today direction the tree canvas itself now reads in.
function toScreen(along: number, across: number, orientation: Orientation): { x: number; y: number } {
  return orientation === "horizontal"
    ? { x: along, y: TRUNK_ACROSS + across }
    : { x: TRUNK_ACROSS + across, y: along };
}

// Visual layout constants for the branch drawing — an organic tapered
// trunk (thick at the root/oldest era, thin at the newest growth/today)
// with a curved twig per bucket ending in a pair of small leaves and a
// date label. Oldest is drawn first (top in vertical mode, left in
// horizontal) and today last — matching the family tree canvas itself,
// where ancestors sit above/before descendants. Branches get bigger and
// more spread out toward today regardless of which end that lands on;
// the falloff is keyed to chronological recency, not to display position.
const TRUNK_ACROSS = 18;
const TRUNK_THIN_HALF = 1.5;
const TRUNK_THICK_HALF = 5.5;
const ACROSS_EXTENT = 128;
const WEIGHT_DECAY = 0.78;
const MIN_SLICE_LENGTH = 20;
const BRANCH_LEN_MIN = 14;
const BRANCH_LEN_MAX = 24;
const RISE_MIN = 2;
const RISE_MAX = 12;
const LEAF_SCALE_MIN = 0.65;
const LEAF_SCALE_MAX = 1.3;

const LEAF_PATH = "M0,0 C1.6,-1.4 1.6,-4.2 0,-5.6 C-1.6,-4.2 -1.6,-1.4 0,0 Z";

function lerp(min: number, max: number, t: number): number {
  return min + (max - min) * t;
}

// The trunk is drawn as a filled tapered shape (not a stroked line) so its
// width can grow from a thick base at the oldest recorded era down to a
// thin tip at today — like a trunk widening toward its root.
function trunkPath(totalLength: number, orientation: Orientation): string {
  const points = [
    toScreen(0, -TRUNK_THICK_HALF, orientation),
    toScreen(totalLength, -TRUNK_THIN_HALF, orientation),
    toScreen(totalLength, TRUNK_THIN_HALF, orientation),
    toScreen(0, TRUNK_THICK_HALF, orientation),
  ];
  return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y} L ${points[2].x} ${points[2].y} L ${points[3].x} ${points[3].y} Z`;
}

function trunkHalfWidthAt(along: number, totalLength: number): number {
  const t = totalLength > 0 ? along / totalLength : 0;
  return lerp(TRUNK_THICK_HALF, TRUNK_THIN_HALF, t);
}

function branchPath(edgeAcross: number, mid: number, tipAcross: number, tipAlong: number, orientation: Orientation): string {
  const midAcross = (edgeAcross + tipAcross) / 2;
  const controlAlong = Math.min(mid, tipAlong) - 4;
  const start = toScreen(mid, edgeAcross, orientation);
  const control = toScreen(controlAlong, midAcross, orientation);
  const tip = toScreen(tipAlong, tipAcross, orientation);
  return `M ${start.x} ${start.y} Q ${control.x} ${control.y}, ${tip.x} ${tip.y}`;
}

type Props = {
  people: TreePerson[];
  orientation: Orientation;
  onNavigate: (personId: string) => void;
};

export default function Timeline({ people, orientation, onNavigate }: Props) {
  const draggingRef = useRef(false);
  const lastBucketIndexRef = useRef<number | null>(null);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [containerLength, setContainerLength] = useState(0);
  // A callback ref (not useRef+useEffect([])) because the container only
  // starts existing once `buckets` is non-empty (see the early return
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

  const buckets = useMemo(() => {
    const years = people.map((p) => p.data.birthYear).filter((y): y is number => y !== undefined);
    return computeBuckets(years, new Date().getFullYear());
  }, [people]);

  // buckets is oldest→newest, and displayOrder renders in that same order
  // along the trunk — oldest era first (top in vertical mode, left in
  // horizontal), today last — matching the tree canvas's own direction.
  // Branch size still falls off by chronological recency (today's bucket
  // biggest), computed separately from display position so flipping which
  // end is "first" doesn't also flip which era gets the most visual weight.
  const slices = useMemo(() => {
    if (buckets.length === 0 || containerLength === 0) return [];

    const displayOrder = buckets.map((_, i) => i);
    const weights = displayOrder.map((bucketIndex) => Math.pow(WEIGHT_DECAY, buckets.length - 1 - bucketIndex));
    const totalWeight = weights.reduce((sum, w) => sum + w, 0);
    const lengths = weights.map((w) => Math.max((w / totalWeight) * containerLength, MIN_SLICE_LENGTH));

    let cursor = 0;
    return displayOrder.map((bucketIndex, displayIdx) => {
      const length = lengths[displayIdx];
      const mid = cursor + length / 2;
      cursor += length;
      return { bucketIndex, mid, weight: weights[displayIdx] };
    });
  }, [buckets, containerLength]);

  const contentLength = Math.max(
    containerLength,
    slices.length ? slices[slices.length - 1].mid + MIN_SLICE_LENGTH / 2 : 0,
  );

  function activateBucket(index: number) {
    const bucket = buckets[index];
    if (!bucket) return;
    lastBucketIndexRef.current = index;
    const personId = pickRepresentative(people, bucket);
    if (personId) {
      setActiveIndex(index);
      onNavigate(personId);
    }
  }

  function activateAtPoint(clientX: number, clientY: number) {
    const el = document.elementFromPoint(clientX, clientY);
    const bucketEl = el?.closest("[data-bucket-index]");
    if (!bucketEl) return;
    const index = Number(bucketEl.getAttribute("data-bucket-index"));
    if (index === lastBucketIndexRef.current) return;
    activateBucket(index);
  }

  function handlePointerDown(e: React.PointerEvent) {
    draggingRef.current = true;
    lastBucketIndexRef.current = null;
    activateAtPoint(e.clientX, e.clientY);
  }

  function handlePointerMove(e: React.PointerEvent) {
    if (!draggingRef.current) return;
    activateAtPoint(e.clientX, e.clientY);
  }

  function handlePointerUp() {
    draggingRef.current = false;
  }

  if (buckets.length === 0) return null;

  const svgWidth = orientation === "horizontal" ? contentLength : ACROSS_EXTENT;
  const svgHeight = orientation === "horizontal" ? ACROSS_EXTENT : contentLength;
  const leafRotationOffset = orientation === "horizontal" ? 90 : 0;

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
          <path d={trunkPath(contentLength, orientation)} className="timeline-trunk" />
          {slices.map(({ bucketIndex, mid, weight }) => {
            const bucket = buckets[bucketIndex];
            const edgeAcross = trunkHalfWidthAt(mid, contentLength);
            const branchLen = lerp(BRANCH_LEN_MIN, BRANCH_LEN_MAX, weight);
            const rise = lerp(RISE_MIN, RISE_MAX, weight);
            const tipAcross = edgeAcross + branchLen;
            const tipAlong = mid - rise;
            const leafScale = lerp(LEAF_SCALE_MIN, LEAF_SCALE_MAX, weight);
            const isActive = bucketIndex === activeIndex;
            const tip = toScreen(tipAlong, tipAcross, orientation);
            const hitArea = orientation === "horizontal"
              ? { x: mid - Math.abs(mid - tipAlong) - 10, y: TRUNK_ACROSS + edgeAcross - 2, width: Math.abs(mid - tipAlong) * 2 + 20, height: ACROSS_EXTENT - edgeAcross + 2 }
              : { x: TRUNK_ACROSS + edgeAcross - 2, y: Math.min(mid, tipAlong) - 10, width: ACROSS_EXTENT - edgeAcross + 2, height: Math.abs(mid - tipAlong) + 20 };

            return (
              <g
                key={bucketIndex}
                data-bucket-index={bucketIndex}
                className={`timeline-branch-group${isActive ? " timeline-branch-active" : ""}`}
              >
                <title>{bucket.title}</title>
                <rect x={hitArea.x} y={hitArea.y} width={hitArea.width} height={hitArea.height} className="timeline-hit-area" />
                <path d={branchPath(edgeAcross, mid, tipAcross, tipAlong, orientation)} className="timeline-branch" />
                <path
                  d={LEAF_PATH}
                  className="timeline-leaf"
                  transform={`translate(${tip.x}, ${tip.y}) rotate(${-28 + leafRotationOffset}) scale(${leafScale})`}
                />
                <path
                  d={LEAF_PATH}
                  className="timeline-leaf"
                  transform={`translate(${tip.x}, ${tip.y}) rotate(${22 + leafRotationOffset}) scale(${leafScale})`}
                />
                <text
                  x={tip.x + (orientation === "horizontal" ? 0 : 7)}
                  y={tip.y + (orientation === "horizontal" ? 14 : 3)}
                  textAnchor={orientation === "horizontal" ? "middle" : "start"}
                  className="timeline-label"
                >
                  {bucket.label}
                </text>
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}

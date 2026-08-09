import { useEffect, useMemo, useRef, useState } from "react";
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
        label: `S. ${toRoman(century / 100 + 1)}`,
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

// Visual layout constants for the branch drawing — an organic tapered
// trunk (thick at the root/past, thin at the newest growth/today) with a
// curved twig per bucket ending in a pair of small leaves and a date
// label. Branches get bigger, longer and more spread out toward today
// (top) and compress toward the past (bottom); the falloff is index-based
// (display order), independent of the bucket density logic above.
const TRUNK_X = 18;
const TRUNK_TOP_HALF = 1.5;
const TRUNK_BOTTOM_HALF = 5.5;
const SVG_WIDTH = 128;
const WEIGHT_DECAY = 0.78;
const MIN_SLICE_HEIGHT = 20;
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
// width can grow from a thin tip at today down to a thick base at the
// oldest recorded era — like a trunk widening toward its root.
function trunkPath(totalHeight: number): string {
  return `M ${TRUNK_X - TRUNK_TOP_HALF} 0
    L ${TRUNK_X - TRUNK_BOTTOM_HALF} ${totalHeight}
    L ${TRUNK_X + TRUNK_BOTTOM_HALF} ${totalHeight}
    L ${TRUNK_X + TRUNK_TOP_HALF} 0 Z`;
}

function trunkHalfWidthAt(y: number, totalHeight: number): number {
  const t = totalHeight > 0 ? y / totalHeight : 0;
  return lerp(TRUNK_TOP_HALF, TRUNK_BOTTOM_HALF, t);
}

function branchPath(edgeX: number, mid: number, tipX: number, tipY: number): string {
  const midX = (edgeX + tipX) / 2;
  const controlY = Math.min(mid, tipY) - 4;
  return `M ${edgeX} ${mid} Q ${midX} ${controlY}, ${tipX} ${tipY}`;
}

type Props = {
  people: TreePerson[];
  onNavigate: (personId: string) => void;
};

export default function Timeline({ people, onNavigate }: Props) {
  const draggingRef = useRef(false);
  const lastBucketIndexRef = useRef<number | null>(null);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [containerHeight, setContainerHeight] = useState(0);
  // A callback ref (not useRef+useEffect([])) because the container only
  // starts existing once `buckets` is non-empty (see the early return
  // below) — a plain ref's mount effect would fire once with a null node
  // and never re-arm when the div actually shows up later.
  const [container, setContainer] = useState<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!container) return;
    const observer = new ResizeObserver((entries) => {
      const height = entries[0]?.contentRect.height;
      if (height) setContainerHeight(height);
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [container]);

  const buckets = useMemo(() => {
    const years = people.map((p) => p.data.birthYear).filter((y): y is number => y !== undefined);
    return computeBuckets(years, new Date().getFullYear());
  }, [people]);

  // buckets is oldest→newest; the branch drawing renders newest (today) at
  // the top, so displayOrder walks it back to front while keeping each
  // entry's original index (what activateBucket/pickRepresentative index by).
  const slices = useMemo(() => {
    if (buckets.length === 0 || containerHeight === 0) return [];

    const displayOrder = buckets.map((_, i) => i).reverse();
    const weights = displayOrder.map((_, displayIdx) => Math.pow(WEIGHT_DECAY, displayIdx));
    const totalWeight = weights.reduce((sum, w) => sum + w, 0);
    const heights = weights.map((w) => Math.max((w / totalWeight) * containerHeight, MIN_SLICE_HEIGHT));

    let cursor = 0;
    return displayOrder.map((bucketIndex, displayIdx) => {
      const height = heights[displayIdx];
      const mid = cursor + height / 2;
      cursor += height;
      return { bucketIndex, mid, weight: weights[displayIdx] };
    });
  }, [buckets, containerHeight]);

  const contentHeight = Math.max(containerHeight, slices.length ? slices[slices.length - 1].mid + MIN_SLICE_HEIGHT / 2 : 0);

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

  return (
    <div
      ref={setContainer}
      className="timeline"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
    >
      {containerHeight > 0 && (
        <svg className="timeline-svg" width={SVG_WIDTH} height={contentHeight}>
          <path d={trunkPath(contentHeight)} className="timeline-trunk" />
          {slices.map(({ bucketIndex, mid, weight }) => {
            const bucket = buckets[bucketIndex];
            const edgeX = TRUNK_X + trunkHalfWidthAt(mid, contentHeight);
            const branchLen = lerp(BRANCH_LEN_MIN, BRANCH_LEN_MAX, weight);
            const rise = lerp(RISE_MIN, RISE_MAX, weight);
            const tipX = edgeX + branchLen;
            const tipY = mid - rise;
            const leafScale = lerp(LEAF_SCALE_MIN, LEAF_SCALE_MAX, weight);
            const isActive = bucketIndex === activeIndex;

            return (
              <g
                key={bucketIndex}
                data-bucket-index={bucketIndex}
                className={`timeline-branch-group${isActive ? " timeline-branch-active" : ""}`}
              >
                <title>{bucket.title}</title>
                <rect
                  x={edgeX - 2}
                  y={Math.min(mid, tipY) - 10}
                  width={SVG_WIDTH - edgeX + 2}
                  height={Math.abs(mid - tipY) + 20}
                  className="timeline-hit-area"
                />
                <path d={branchPath(edgeX, mid, tipX, tipY)} className="timeline-branch" />
                <path
                  d={LEAF_PATH}
                  className="timeline-leaf"
                  transform={`translate(${tipX}, ${tipY}) rotate(-28) scale(${leafScale})`}
                />
                <path
                  d={LEAF_PATH}
                  className="timeline-leaf"
                  transform={`translate(${tipX}, ${tipY}) rotate(22) scale(${leafScale})`}
                />
                <text x={tipX + 7} y={tipY + 3} className="timeline-label">
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

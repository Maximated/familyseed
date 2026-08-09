import { useMemo, useRef, useState } from "react";
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

type Props = {
  people: TreePerson[];
  onNavigate: (personId: string) => void;
};

export default function Timeline({ people, onNavigate }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const lastBucketIndexRef = useRef<number | null>(null);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  const buckets = useMemo(() => {
    const years = people.map((p) => p.data.birthYear).filter((y): y is number => y !== undefined);
    return computeBuckets(years, new Date().getFullYear());
  }, [people]);

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
    const bucketEl = el?.closest<HTMLElement>("[data-bucket-index]");
    if (!bucketEl) return;
    const index = Number(bucketEl.dataset.bucketIndex);
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
      ref={containerRef}
      className="timeline"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
    >
      {buckets.map((bucket, index) => (
        <div
          key={`${bucket.start}-${bucket.end}`}
          data-bucket-index={index}
          className={`timeline-bucket${index === activeIndex ? " timeline-bucket-active" : ""}`}
          title={bucket.title}
        >
          {bucket.label}
        </div>
      ))}
    </div>
  );
}

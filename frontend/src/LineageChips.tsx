import type { Lineage } from "./api";

type Props = {
  lineages: Lineage[];
  // A single active lineage at a time, not multi-select — clicking one
  // jumps the selection to its eldest member and widens the view to the
  // whole lineage (or, if everyone's already visible, just pins the
  // highlight/dim treatment instead); clicking the already-active one turns
  // it back off. See TreeView.tsx's handleLineageClick for the actual
  // behavior — this component only renders the chip row.
  activeId: string | null;
  onSelect: (id: string) => void;
};

export default function LineageChips({ lineages, activeId, onSelect }: Props) {
  if (lineages.length === 0) return null;

  return (
    <div className="lineage-list">
      {lineages.map((lineage, index) => {
        const active = activeId === lineage.id;
        return (
          <button
            key={lineage.id}
            type="button"
            className={`lineage-list-item${active ? " lineage-list-item-active" : ""}`}
            style={{ animationDelay: `${index * 45}ms` }}
            onClick={() => onSelect(lineage.id)}
            aria-pressed={active}
          >
            {lineage.name}
          </button>
        );
      })}
    </div>
  );
}

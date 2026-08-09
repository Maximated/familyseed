import type { Lineage } from "./api";

type Props = {
  lineages: Lineage[];
  selectedIds: Set<string>;
  onChange: (selectedIds: Set<string>) => void;
};

export default function LineageChips({ lineages, selectedIds, onChange }: Props) {
  if (lineages.length === 0) return null;

  function toggle(id: string) {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(next);
  }

  return (
    <div className="lineage-chips">
      {lineages.map((lineage) => {
        const active = selectedIds.has(lineage.id);
        return (
          <button
            key={lineage.id}
            type="button"
            className={`lineage-chip${active ? " lineage-chip-active" : ""}`}
            style={{ "--chip-color": lineage.color ?? "#888" } as React.CSSProperties}
            onClick={() => toggle(lineage.id)}
            aria-pressed={active}
          >
            <span className="lineage-chip-dot" />
            {lineage.name}
          </button>
        );
      })}
      {selectedIds.size > 0 && (
        <button type="button" className="lineage-chip lineage-chip-clear" onClick={() => onChange(new Set())}>
          Limpiar
        </button>
      )}
    </div>
  );
}

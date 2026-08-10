import { useTranslation } from "react-i18next";
import type { Lineage } from "./api";

type Props = {
  lineages: Lineage[];
  selectedIds: Set<string>;
  onChange: (selectedIds: Set<string>) => void;
};

export default function LineageChips({ lineages, selectedIds, onChange }: Props) {
  const { t } = useTranslation();
  if (lineages.length === 0) return null;

  function toggle(id: string) {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(next);
  }

  return (
    <div className="lineage-list">
      {lineages.map((lineage, index) => {
        const active = selectedIds.has(lineage.id);
        return (
          <button
            key={lineage.id}
            type="button"
            className={`lineage-list-item${active ? " lineage-list-item-active" : ""}`}
            style={{ animationDelay: `${index * 45}ms` }}
            onClick={() => toggle(lineage.id)}
            aria-pressed={active}
          >
            {lineage.name}
          </button>
        );
      })}
      {selectedIds.size > 0 && (
        <button
          type="button"
          className="lineage-list-clear"
          style={{ animationDelay: `${lineages.length * 45}ms` }}
          onClick={() => onChange(new Set())}
        >
          {t("lineageChips.clear")}
        </button>
      )}
    </div>
  );
}

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { fetchIndividuals, type Individual } from "./api";

type Props = {
  treeId: string;
  selectedName: string | null;
  onSelect: (person: Individual) => void;
};

function personLine(p: Individual): string {
  const surname = [p.surname1, p.surname2].filter(Boolean).join(" ");
  const year = p.birthDateText ? ` (${p.birthDateText})` : "";
  return `${[p.givenNames, surname].filter(Boolean).join(" ")}${year}`;
}

// A minimal search-and-pick box — reused wherever a home-screen action
// (PDF report, GEDCOM export) needs "which person" before it can proceed,
// since outside a tree there's no "currently centered person" to default to.
export default function PersonPicker({ treeId, selectedName, onSelect }: Props) {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<Individual[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!search.trim()) {
      setResults([]);
      return;
    }
    let cancelled = false;
    const timeout = setTimeout(() => {
      fetchIndividuals(treeId, { search: search.trim() })
        .then((people) => {
          if (!cancelled) setResults(people);
        })
        .catch(() => {
          // A failed search just shows no results — not fatal to the modal.
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [treeId, search]);

  if (selectedName && !open) {
    return (
      <p className="person-picker-selected">
        {selectedName}{" "}
        <button type="button" className="person-picker-change" onClick={() => setOpen(true)}>
          {t("personPicker.change")}
        </button>
      </p>
    );
  }

  return (
    <div className="person-picker">
      <input
        type="text"
        placeholder={t("personPicker.placeholder")}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        autoFocus
      />
      {search.trim() && (
        <ul className="person-picker-results">
          {results.length === 0 ? (
            <li className="person-picker-empty">{t("personPicker.noResults")}</li>
          ) : (
            results.map((person) => (
              <li key={person.id}>
                <button
                  type="button"
                  onClick={() => {
                    onSelect(person);
                    setSearch("");
                    setOpen(false);
                  }}
                >
                  {personLine(person)}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}

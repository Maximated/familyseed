import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { searchPlaces, type PlaceSuggestion, type PlaceValue } from "./api";
import { MapPinIcon } from "./Icons";

type Props = {
  treeId: string;
  value: PlaceValue;
  onChange: (value: PlaceValue) => void;
  placeholder?: string;
};

// A place text field with geocoded suggestions (places already used in this
// tree first, then OpenStreetMap via the backend's Photon proxy). Picking a
// suggestion stores its coordinates for the tree map; typing over it drops
// them again, since the text may no longer name that same point. Free text
// is always allowed — plenty of historical places can't be geocoded.
export default function PlaceInput({ treeId, value, onChange, placeholder }: Props) {
  const { t } = useTranslation();
  const listId = useId();
  // Only set once the user actually types — a prefilled value (editing an
  // existing person) shouldn't pop a suggestion list open on load.
  const [query, setQuery] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  useEffect(() => {
    const trimmed = query?.trim() ?? "";
    if (trimmed.length < 2) {
      setSuggestions([]);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      setLoading(true);
      searchPlaces(treeId, trimmed, controller.signal)
        .then((results) => {
          setSuggestions(results);
          setActiveIndex(-1);
        })
        .catch(() => {
          // No suggestions is fine — the field still takes free text.
          if (!controller.signal.aborted) setSuggestions([]);
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 300);
    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [treeId, query]);

  function handleTextChange(text: string) {
    onChange({ text, lat: null, lng: null });
    setQuery(text);
    setOpen(true);
  }

  function handleSelect(suggestion: PlaceSuggestion) {
    onChange({ text: suggestion.label, lat: suggestion.lat, lng: suggestion.lng });
    setQuery(null);
    setSuggestions([]);
    setOpen(false);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || suggestions.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((i) => (i + 1) % suggestions.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
    } else if (event.key === "Enter" && activeIndex >= 0) {
      // Picks the highlighted place instead of submitting the whole form.
      event.preventDefault();
      handleSelect(suggestions[activeIndex]);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
    }
  }

  const located = value.lat !== null && value.lng !== null;
  const showList = open && (query?.trim().length ?? 0) >= 2 && (suggestions.length > 0 || !loading);

  return (
    <div className="place-input">
      <input
        type="text"
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
        autoComplete="off"
        placeholder={placeholder}
        value={value.text}
        onChange={(e) => handleTextChange(e.target.value)}
        onKeyDown={handleKeyDown}
        onFocus={() => query !== null && setOpen(true)}
        onBlur={() => setOpen(false)}
      />
      {value.text.trim() && (
        <span
          className={`place-input-status${located ? " is-located" : ""}`}
          title={located ? t("place.located") : t("place.notLocated")}
          aria-label={located ? t("place.located") : t("place.notLocated")}
          role="img"
        >
          <MapPinIcon size={16} />
        </span>
      )}
      {showList && (
        <ul className="place-input-results" id={listId} role="listbox">
          {suggestions.length === 0 ? (
            <li className="place-input-empty">{t("place.noResults")}</li>
          ) : (
            suggestions.map((suggestion, index) => (
              <li
                key={`${suggestion.source}-${suggestion.label}-${suggestion.lat}`}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={index === activeIndex}
                className={index === activeIndex ? "is-active" : undefined}
                // mousedown (not click) + preventDefault: keeps the input
                // focused, so its onBlur doesn't close the list before the
                // pick registers.
                onMouseDown={(e) => {
                  e.preventDefault();
                  handleSelect(suggestion);
                }}
              >
                <span>{suggestion.label}</span>
                {suggestion.source === "tree" && <span className="place-input-tag">{t("place.inThisTree")}</span>}
              </li>
            ))
          )}
          <li className="place-input-attribution" aria-hidden="true">
            © OpenStreetMap
          </li>
        </ul>
      )}
    </div>
  );
}

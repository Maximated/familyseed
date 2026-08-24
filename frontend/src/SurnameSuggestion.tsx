import { useTranslation } from "react-i18next";

type Props = {
  suggestion: string;
  onAccept: () => void;
};

// A small accept-or-ignore pill shown under an empty surname field once a
// selected parent makes a guess possible (see surnameSuggestions.ts) —
// click to accept, or press Enter while the field is focused and still
// empty (wired by the caller's own onKeyDown, since this pill isn't itself
// focused most of the time the user would want it).
export default function SurnameSuggestion({ suggestion, onAccept }: Props) {
  const { t } = useTranslation();
  return (
    <button type="button" className="surname-suggestion-pill" onClick={onAccept}>
      {t("personFields.surnameSuggestion", { value: suggestion })}
    </button>
  );
}

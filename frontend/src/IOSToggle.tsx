type Props = {
  checked: boolean;
  onChange: () => void;
  label: string;
  // Default (false): a mutually-exclusive radio option (LinkPeopleModal's
  // "A is B's parent / B is A's parent / partner" choice) — visually a
  // toggle, but semantically "select this one": clicking it calls onChange
  // to make it the active option, same as a radio button would, rather
  // than toggling independently of the others.
  // true: a genuine independent on/off switch (AddPersonForm's relation
  // checkboxes, which can be combined) — same visuals, but announced as a
  // checkbox rather than a radio so it's not misread as one of a
  // mutually-exclusive group.
  multi?: boolean;
};

export default function IOSToggle({ checked, onChange, label, multi }: Props) {
  return (
    <button
      type="button"
      role={multi ? "checkbox" : "radio"}
      aria-checked={checked}
      className="ios-toggle-row"
      onClick={onChange}
    >
      <span>{label}</span>
      <span className={`ios-toggle${checked ? " ios-toggle-on" : ""}`} aria-hidden="true">
        <span className="ios-toggle-knob" />
      </span>
    </button>
  );
}

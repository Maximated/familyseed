type Props = {
  checked: boolean;
  onChange: () => void;
  label: string;
};

// A single row styled as an iOS switch, used as a mutually-exclusive radio
// option (LinkPeopleModal's "A is B's parent / B is A's parent / partner"
// choice) — visually a toggle, but semantically "select this one": clicking
// it calls onChange to make it the active option, same as a radio button
// would, rather than toggling independently of the others.
export default function IOSToggle({ checked, onChange, label }: Props) {
  return (
    <button type="button" role="radio" aria-checked={checked} className="ios-toggle-row" onClick={onChange}>
      <span>{label}</span>
      <span className={`ios-toggle${checked ? " ios-toggle-on" : ""}`} aria-hidden="true">
        <span className="ios-toggle-knob" />
      </span>
    </button>
  );
}

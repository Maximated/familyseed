import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import i18n, { SUPPORTED_LANGUAGES, type SupportedLanguage } from "./i18n";
import { GlobeIcon } from "./Icons";

// Native, untranslated names — a language switcher lists each language in
// its own tongue, not translated into whichever language is active.
const LANGUAGE_LABEL: Record<SupportedLanguage, string> = {
  es: "Español",
  en: "English",
  pl: "Polski",
};

export default function LanguageSwitcher() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: PointerEvent) {
      if (anchorRef.current && !anchorRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  return (
    <div className="popover-anchor" ref={anchorRef}>
      <button
        type="button"
        className="icon-button"
        onClick={() => setOpen((v) => !v)}
        aria-label={t("app.language")}
        aria-expanded={open}
        title={t("app.language")}
      >
        <GlobeIcon />
      </button>
      {open && (
        <div className="popover language-popover">
          {SUPPORTED_LANGUAGES.map((lang) => (
            <button
              key={lang}
              type="button"
              className={`language-popover-item${i18n.language === lang ? " language-popover-item-active" : ""}`}
              onClick={() => {
                i18n.changeLanguage(lang);
                setOpen(false);
              }}
              aria-pressed={i18n.language === lang}
            >
              {LANGUAGE_LABEL[lang]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

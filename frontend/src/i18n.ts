import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import es from "./locales/es.json";
import en from "./locales/en.json";
import pl from "./locales/pl.json";

export const SUPPORTED_LANGUAGES = ["es", "en", "pl"] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

const STORAGE_KEY = "familytree.lang";

function storedLanguage(): SupportedLanguage {
  const stored = localStorage.getItem(STORAGE_KEY);
  return SUPPORTED_LANGUAGES.includes(stored as SupportedLanguage) ? (stored as SupportedLanguage) : "es";
}

// Only Spanish is fully translated for now — en/pl fall back to es for any
// missing key, so the app stays usable while those locales are filled in
// incrementally rather than all at once.
i18n.use(initReactI18next).init({
  resources: {
    es: { translation: es },
    en: { translation: en },
    pl: { translation: pl },
  },
  lng: storedLanguage(),
  fallbackLng: "es",
  interpolation: { escapeValue: false },
});

i18n.on("languageChanged", (lng) => {
  localStorage.setItem(STORAGE_KEY, lng);
});

export default i18n;

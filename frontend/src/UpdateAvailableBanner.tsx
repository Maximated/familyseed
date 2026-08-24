import { useTranslation } from "react-i18next";
import { useRegisterSW } from "virtual:pwa-register/react";

// Registers the service worker ourselves (see vite.config.ts's
// injectRegister: null) instead of letting the plugin's own auto-injected
// script force a reload the instant a new version takes control — that
// reload could land mid-interaction (reported: right after using search),
// with no warning and no way to finish whatever you were doing first. This
// surfaces a small dismissible-by-ignoring banner instead; the reload only
// happens when the user actually taps it.
export default function UpdateAvailableBanner() {
  const { t } = useTranslation();
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({ immediate: true });

  if (!needRefresh) return null;

  return (
    <div className="update-banner">
      <span>{t("pwa.updateAvailable")}</span>
      <button type="button" onClick={() => updateServiceWorker(true)}>
        {t("pwa.updateAction")}
      </button>
    </div>
  );
}

import { useTranslation } from "react-i18next";
import { useRegisterSW } from "virtual:pwa-register/react";

// Registers the service worker ourselves (see vite.config.ts's
// registerType: 'prompt' + injectRegister: null) so a new version never
// reloads the page on its own — that reload used to land mid-interaction
// (reported: right after using search, and twice while filling in a
// person form), with no warning and no way to finish first. The new
// worker just waits; this surfaces a small dismissible-by-ignoring banner
// and the reload only happens when the user actually taps it.
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

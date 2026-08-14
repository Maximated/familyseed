import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { fetchAuthConfig, googleLoginUrl } from "./api";

// Renders nothing until we know the backend actually has Google OAuth
// configured (GOOGLE_CLIENT_ID/SECRET set) — a self-hosted install with
// no Google Cloud project just never shows this.
export default function GoogleAuthButton() {
  const { t } = useTranslation();
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    fetchAuthConfig()
      .then((config) => setEnabled(config.googleEnabled))
      .catch(() => setEnabled(false));
  }, []);

  if (!enabled) return null;

  return (
    <>
      <div className="auth-divider">{t("auth.orDivider")}</div>
      <a className="auth-google-button" href={googleLoginUrl()}>
        <svg viewBox="0 0 18 18" width="18" height="18" aria-hidden="true">
          <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.9c1.7-1.57 2.7-3.88 2.7-6.62z" />
          <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.9-2.26c-.8.54-1.84.86-3.06.86-2.35 0-4.34-1.59-5.05-3.72H.96v2.33A9 9 0 0 0 9 18z" />
          <path fill="#FBBC05" d="M3.95 10.7A5.4 5.4 0 0 1 3.67 9c0-.59.1-1.17.28-1.7V4.97H.96A9 9 0 0 0 0 9c0 1.45.35 2.83.96 4.03z" />
          <path fill="#EA4335" d="M9 3.58c1.32 0 2.51.45 3.44 1.35l2.58-2.58A8.5 8.5 0 0 0 9 0 9 9 0 0 0 .96 4.97l2.99 2.33C4.66 5.17 6.65 3.58 9 3.58z" />
        </svg>
        {t("auth.continueWithGoogle")}
      </a>
    </>
  );
}

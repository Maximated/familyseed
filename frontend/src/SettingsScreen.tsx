import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { mediaUrl, updateProfile, uploadUserAvatar } from "./api";
import { useAuth } from "./AuthContext";
import { convertHeicIfNeeded } from "./heic";
import { resizeImage } from "./media";
import i18n, { SUPPORTED_LANGUAGES, type SupportedLanguage } from "./i18n";
import { getTheme, setTheme as persistTheme, type Theme } from "./theme";
import { getDefaultOrientation, setDefaultOrientation, type TreeOrientation } from "./preferences";
import PhotoCropModal from "./PhotoCropModal";
import PhotoDropzone from "./PhotoDropzone";
import IOSToggle from "./IOSToggle";
import { ArrowLeftIcon, UserIcon } from "./Icons";

// Native, untranslated names — same as LanguageSwitcher.
const LANGUAGE_LABEL: Record<SupportedLanguage, string> = {
  es: "Español",
  en: "English",
  pl: "Polski",
};

export default function SettingsScreen() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user, setUser } = useAuth();

  const [cropSource, setCropSource] = useState<File | null>(null);
  const [convertingPhoto, setConvertingPhoto] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);

  const [name, setName] = useState(user?.name ?? "");
  const [savingName, setSavingName] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);

  const [language, setLanguage] = useState<SupportedLanguage>(i18n.language as SupportedLanguage);
  const [theme, setThemeState] = useState<Theme>(getTheme());
  const [orientation, setOrientationState] = useState<TreeOrientation>(getDefaultOrientation());

  async function handleAvatarFile(file: File) {
    setConvertingPhoto(true);
    setAvatarError(null);
    try {
      setCropSource(await convertHeicIfNeeded(file));
    } catch {
      setAvatarError(t("personFields.heicError"));
    } finally {
      setConvertingPhoto(false);
    }
  }

  async function handleAvatarCropped(cropped: File) {
    setCropSource(null);
    setUploadingAvatar(true);
    setAvatarError(null);
    try {
      const resized = await resizeImage(cropped, 500, 0.85);
      const updated = await uploadUserAvatar(resized, cropped.name);
      setUser(updated);
    } catch (err) {
      setAvatarError((err as Error).message);
    } finally {
      setUploadingAvatar(false);
    }
  }

  async function handleSaveName(event: React.FormEvent) {
    event.preventDefault();
    setSavingName(true);
    setNameError(null);
    try {
      const updated = await updateProfile(name.trim());
      setUser(updated);
    } catch (err) {
      setNameError((err as Error).message);
    } finally {
      setSavingName(false);
    }
  }

  function handleLanguageChange(lang: SupportedLanguage) {
    i18n.changeLanguage(lang);
    setLanguage(lang);
  }

  function handleThemeChange(next: Theme) {
    persistTheme(next);
    setThemeState(next);
  }

  function handleOrientationChange(next: TreeOrientation) {
    setDefaultOrientation(next);
    setOrientationState(next);
  }

  const nameDirty = name.trim() !== (user?.name ?? "");

  return (
    <div className="home-screen">
      <header className="home-header">
        <div className="home-brand">
          <button type="button" className="icon-button" onClick={() => navigate("/")} aria-label={t("app.back")} title={t("app.back")}>
            <ArrowLeftIcon />
          </button>
          <div>
            <p className="home-brand-name">FamilySeed</p>
            <h1>{t("settings.title")}</h1>
          </div>
        </div>
      </header>

      <div className="settings-sections">
        <fieldset className="settings-section">
          <legend>{t("settings.avatarLegend")}</legend>
          <div className="settings-avatar-row">
            {user?.avatarUrl ? (
              <img src={mediaUrl(user.avatarUrl)} alt="" className="settings-avatar-preview" />
            ) : (
              <div className="settings-avatar-preview settings-avatar-placeholder">
                <UserIcon size={40} />
              </div>
            )}
            <div className="settings-avatar-dropzone">
              <PhotoDropzone
                onFile={handleAvatarFile}
                disabled={convertingPhoto || uploadingAvatar}
                busyHint={convertingPhoto ? t("personFields.convertingPhoto") : uploadingAvatar ? t("settings.uploadingAvatar") : undefined}
              />
            </div>
          </div>
          {avatarError && <p className="status status-error">{avatarError}</p>}
        </fieldset>

        <fieldset className="settings-section">
          <legend>{t("settings.nameLegend")}</legend>
          <form onSubmit={handleSaveName} className="settings-name-form">
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder={user?.email ?? ""} />
            {nameDirty && (
              <button type="submit" disabled={savingName}>
                {t("common.save")}
              </button>
            )}
          </form>
          {nameError && <p className="status status-error">{nameError}</p>}
        </fieldset>

        <fieldset className="settings-section">
          <legend>{t("settings.languageLegend")}</legend>
          {SUPPORTED_LANGUAGES.map((lang) => (
            <IOSToggle key={lang} checked={language === lang} onChange={() => handleLanguageChange(lang)} label={LANGUAGE_LABEL[lang]} />
          ))}
        </fieldset>

        <fieldset className="settings-section">
          <legend>{t("settings.themeLegend")}</legend>
          <IOSToggle checked={theme === "light"} onChange={() => handleThemeChange("light")} label={t("settings.themeLight")} />
          <IOSToggle checked={theme === "dark"} onChange={() => handleThemeChange("dark")} label={t("settings.themeDark")} />
        </fieldset>

        <fieldset className="settings-section">
          <legend>{t("settings.orientationLegend")}</legend>
          <IOSToggle
            checked={orientation === "vertical"}
            onChange={() => handleOrientationChange("vertical")}
            label={t("settings.orientationVertical")}
          />
          <IOSToggle
            checked={orientation === "horizontal"}
            onChange={() => handleOrientationChange("horizontal")}
            label={t("settings.orientationHorizontal")}
          />
        </fieldset>
      </div>

      {cropSource && <PhotoCropModal file={cropSource} onCropped={handleAvatarCropped} onCancel={() => setCropSource(null)} />}
    </div>
  );
}

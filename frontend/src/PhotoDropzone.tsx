import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";

type Props = {
  onFile: (file: File) => void;
  disabled?: boolean;
  busyHint?: string;
};

// Same drag-and-drop-or-click-to-browse pattern as the CSV/GEDCOM importer
// (.gedcom-dropzone) — the profile-photo picker used to be a bare
// `<input type="file">`, the one control left in these forms that didn't
// follow the app's own button/dropzone styling.
export default function PhotoDropzone({ onFile, disabled, busyHint }: Props) {
  const { t } = useTranslation();
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    if (disabled) return;
    const file = event.dataTransfer.files?.[0];
    if (file) onFile(file);
  }

  function handleInputChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) onFile(file);
  }

  return (
    <>
      <div
        className={`gedcom-dropzone${dragging ? " gedcom-dropzone-active" : ""}${disabled ? " gedcom-dropzone-disabled" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        onClick={() => !disabled && fileInputRef.current?.click()}
      >
        <p>{disabled && busyHint ? busyHint : t("personFields.photoDropHint")}</p>
        {!disabled && <p className="field-hint">{t("personFields.photoDropHintOrBrowse")}</p>}
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,.heic,.heif"
        onChange={handleInputChange}
        disabled={disabled}
        style={{ display: "none" }}
      />
    </>
  );
}

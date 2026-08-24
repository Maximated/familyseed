import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { resizeImage } from "./media";
import { convertHeicIfNeeded } from "./heic";
import PhotoLightbox from "./PhotoLightbox";
import type { PersonMediaType } from "./api";

// `blob`/`name` rather than a plain `File` — resizeImage returns a bare
// Blob (it loses the original filename), same reason PersonMediaTab's own
// upload call passes the original file's name alongside the resized blob.
export type StagedMediaItem = { blob: Blob; name: string; previewUrl?: string };

type Props = {
  type: PersonMediaType;
  items: StagedMediaItem[];
  onChange: (items: StagedMediaItem[]) => void;
};

// PersonMediaTab's counterpart for the create-person form, where there's no
// personId yet to upload against — same look and the same add/remove
// affordances, but held as plain local File objects and only actually
// uploaded once the person is created (see AddPersonForm's handleSubmit),
// the same way the single profile-photo dropzone already worked before
// this existed. Kept as its own component rather than adding a "local
// mode" to PersonMediaTab itself: that component's every action (add,
// delete) is a real API call by design, and threading a staged/local path
// through it would mean an editable-but-not-really flag on almost every
// handler.
export default function StagedMediaTab({ type, items, onChange }: Props) {
  const { t } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [converting, setConverting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setError(null);
    if (type === "PHOTO") {
      setConverting(true);
      try {
        const resized = await resizeImage(await convertHeicIfNeeded(file), 900, 0.85);
        onChange([...items, { blob: resized, name: file.name, previewUrl: URL.createObjectURL(resized) }]);
      } catch {
        setError(t("personFields.heicError"));
      } finally {
        setConverting(false);
      }
    } else {
      onChange([...items, { blob: file, name: file.name }]);
    }
  }

  function handleRemove(index: number) {
    const item = items[index];
    if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
    onChange(items.filter((_, i) => i !== index));
  }

  return (
    <div className="person-media-tab">
      {error && <p className="status status-error">{error}</p>}

      {type === "PHOTO" ? (
        <div className="media-photo-grid">
          {items.map((item, index) => (
            <div className="media-photo-item" key={item.previewUrl ?? index}>
              <img
                src={item.previewUrl}
                alt={item.name}
                onClick={() => item.previewUrl && setLightboxUrl(item.previewUrl)}
                style={{ cursor: "zoom-in" }}
              />
              <button
                type="button"
                className="media-delete-button"
                onClick={() => handleRemove(index)}
                aria-label={t("media.deletePhoto")}
                title={t("media.deletePhoto")}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      ) : (
        <ul className="media-doc-list">
          {items.map((item, index) => (
            <li key={index}>
              <span>{item.name}</span>
              <button
                type="button"
                className="media-delete-button"
                onClick={() => handleRemove(index)}
                aria-label={t("media.deleteDocument")}
                title={t("media.deleteDocument")}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      {items.length === 0 && (
        <p className="field-hint">{type === "PHOTO" ? t("media.noPhotos") : t("media.noDocuments")}</p>
      )}

      <button
        type="button"
        className="media-upload-button"
        onClick={() => fileInputRef.current?.click()}
        disabled={converting}
      >
        {converting ? t("media.uploading") : type === "PHOTO" ? t("media.addPhoto") : t("media.addDocument")}
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept={type === "PHOTO" ? "image/*,.heic,.heif" : undefined}
        onChange={handleFileChange}
        style={{ display: "none" }}
      />
      {lightboxUrl && <PhotoLightbox src={lightboxUrl} onClose={() => setLightboxUrl(null)} />}
    </div>
  );
}

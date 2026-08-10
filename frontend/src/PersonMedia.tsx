import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  deletePersonMedia,
  fetchPersonMedia,
  mediaUrl,
  uploadPersonMedia,
  type PersonMediaItem,
  type PersonMediaType,
} from "./api";
import { resizeImage } from "./media";

type Props = {
  treeId: string;
  personId: string;
  type: PersonMediaType;
};

export default function PersonMediaTab({ treeId, personId, type }: Props) {
  const { t } = useTranslation();
  const [items, setItems] = useState<PersonMediaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchPersonMedia(treeId, personId)
      .then((all) => {
        if (!cancelled) setItems(all.filter((m) => m.type === type));
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [treeId, personId, type]);

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setUploading(true);
    setError(null);
    try {
      const upload = type === "PHOTO" ? await resizeImage(file, 900, 0.85) : file;
      const created = await uploadPersonMedia(treeId, personId, upload, file.name);
      setItems((prev) => [created, ...prev]);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(mediaId: string) {
    try {
      await deletePersonMedia(treeId, personId, mediaId);
      setItems((prev) => prev.filter((m) => m.id !== mediaId));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="person-media-tab">
      {error && <p className="status status-error">{error}</p>}

      {loading ? (
        <p className="status">{t("common.loading")}</p>
      ) : type === "PHOTO" ? (
        <div className="media-photo-grid">
          {items.map((item) => (
            <div className="media-photo-item" key={item.id}>
              <img src={mediaUrl(item.url)} alt={item.filename} />
              <button
                type="button"
                className="media-delete-button"
                onClick={() => handleDelete(item.id)}
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
          {items.map((item) => (
            <li key={item.id}>
              <a href={mediaUrl(item.url)} target="_blank" rel="noreferrer">
                {item.filename}
              </a>
              <button
                type="button"
                className="media-delete-button"
                onClick={() => handleDelete(item.id)}
                aria-label={t("media.deleteDocument")}
                title={t("media.deleteDocument")}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      {!loading && items.length === 0 && (
        <p className="field-hint">{type === "PHOTO" ? t("media.noPhotos") : t("media.noDocuments")}</p>
      )}

      <button
        type="button"
        className="media-upload-button"
        onClick={() => fileInputRef.current?.click()}
        disabled={uploading}
      >
        {uploading ? t("media.uploading") : type === "PHOTO" ? t("media.addPhoto") : t("media.addDocument")}
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept={type === "PHOTO" ? "image/*" : undefined}
        onChange={handleFileChange}
        style={{ display: "none" }}
      />
    </div>
  );
}

import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import Cropper, { type Area } from "react-easy-crop";

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("No se pudo leer la imagen"));
    img.src = src;
  });
}

async function cropToBlob(imageSrc: string, area: Area): Promise<Blob> {
  const image = await loadImage(imageSrc);
  const canvas = document.createElement("canvas");
  canvas.width = area.width;
  canvas.height = area.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No se pudo procesar la imagen");
  ctx.drawImage(image, area.x, area.y, area.width, area.height, 0, 0, area.width, area.height);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("No se pudo procesar la imagen"))), "image/jpeg", 0.92);
  });
}

type Props = {
  file: File;
  onCropped: (file: File) => void;
  onCancel: () => void;
};

// Square (avatar) crop for a just-selected photo — lets the user pan/zoom
// to pick which part of the photo to keep before it's resized and uploaded,
// so a group photo or an off-center shot doesn't just get squashed as-is.
export default function PhotoCropModal({ file, onCropped, onCancel }: Props) {
  const { t } = useTranslation();
  const [imageUrl] = useState(() => URL.createObjectURL(file));
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCropComplete = useCallback((_: Area, pixels: Area) => {
    setCroppedAreaPixels(pixels);
  }, []);

  // Revoked here (and on cancel below) rather than in a mount/unmount
  // effect — StrictMode's dev-only double-invoke of that cleanup would
  // revoke the URL right after creating it, before the image ever loads.
  function handleCancel() {
    URL.revokeObjectURL(imageUrl);
    onCancel();
  }

  async function handleConfirm() {
    if (!croppedAreaPixels) return;
    setProcessing(true);
    setError(null);
    try {
      const blob = await cropToBlob(imageUrl, croppedAreaPixels);
      URL.revokeObjectURL(imageUrl);
      onCropped(new File([blob], file.name, { type: "image/jpeg" }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setProcessing(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={handleCancel}>
      <div className="modal-panel photo-crop-panel" onClick={(e) => e.stopPropagation()}>
        <h2>{t("photoCrop.title")}</h2>
        <div className="photo-crop-area">
          <Cropper
            image={imageUrl}
            crop={crop}
            zoom={zoom}
            aspect={1}
            cropShape="round"
            showGrid={false}
            onCropChange={setCrop}
            onZoomChange={setZoom}
            onCropComplete={handleCropComplete}
          />
        </div>
        <label className="photo-crop-zoom">
          {t("photoCrop.zoom")}
          <input
            type="range"
            min={1}
            max={3}
            step={0.01}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
          />
        </label>
        {error && <p className="status status-error">{error}</p>}
        <div className="modal-actions">
          <button type="button" onClick={handleCancel} disabled={processing}>
            {t("common.cancel")}
          </button>
          <button type="button" className="btn-primary" onClick={handleConfirm} disabled={processing || !croppedAreaPixels}>
            {processing ? t("common.saving") : t("photoCrop.confirm")}
          </button>
        </div>
      </div>
    </div>
  );
}

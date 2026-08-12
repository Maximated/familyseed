import { useTranslation } from "react-i18next";

type Props = {
  src: string;
  alt?: string;
  // "circle" keeps the avatar's own round crop and scale/fade-zooms it in
  // place — reads as the same photo growing, not a jump to a generic
  // full-screen image viewer. Used for card avatars, the info panel photo,
  // and merge-review comparisons. "rect" (default) is for full uploaded
  // photos in the media gallery, which aren't circular to begin with —
  // forcing a circular crop there would hide most of the image.
  shape?: "circle" | "rect";
  onClose: () => void;
};

// A click-to-enlarge overlay for any small photo thumbnail in the app —
// dark backdrop, closes on click anywhere or the × button.
export default function PhotoLightbox({ src, alt, shape = "rect", onClose }: Props) {
  const { t } = useTranslation();
  return (
    <div className="photo-lightbox-backdrop" onClick={onClose}>
      <img
        className={`photo-lightbox-image${shape === "circle" ? " photo-lightbox-image-circle" : ""}`}
        src={src}
        alt={alt ?? ""}
        onClick={(e) => e.stopPropagation()}
      />
      <button type="button" className="photo-lightbox-close" onClick={onClose} aria-label={t("common.close")}>
        ×
      </button>
    </div>
  );
}

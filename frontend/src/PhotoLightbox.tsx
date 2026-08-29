import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeftIcon, ArrowRightIcon, XIcon } from "./Icons";

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
  // Only the media gallery (PersonMedia/StagedMediaTab) ever has more than
  // one photo to page through — every other call site (an avatar, a
  // merge-review comparison) opens exactly one fixed image and has nothing
  // to navigate to, so this stays optional rather than forcing every
  // caller to plumb a single-item array through just to satisfy one shape.
  gallery?: {
    total: number;
    index: number;
    onNavigate: (index: number) => void;
  };
};

// A click-to-enlarge overlay for any small photo thumbnail in the app —
// dark backdrop, closes on click anywhere, the × button, or Escape. With a
// `gallery`, doubles as a slideshow: arrow buttons/keys and a left/right
// swipe (touch has no keyboard) page through the set without closing.
export default function PhotoLightbox({ src, alt, shape = "rect", onClose, gallery }: Props) {
  const { t } = useTranslation();
  const touchStartX = useRef<number | null>(null);

  const goPrev = () => gallery && gallery.onNavigate((gallery.index - 1 + gallery.total) % gallery.total);
  const goNext = () => gallery && gallery.onNavigate((gallery.index + 1) % gallery.total);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft") goPrev();
      else if (e.key === "ArrowRight") goNext();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gallery?.index, gallery?.total]);

  function handleTouchStart(e: React.TouchEvent) {
    touchStartX.current = e.touches[0].clientX;
  }
  function handleTouchEnd(e: React.TouchEvent) {
    if (touchStartX.current === null) return;
    const delta = e.changedTouches[0].clientX - touchStartX.current;
    touchStartX.current = null;
    // A real swipe, not an incidental drift while pinching/tapping.
    if (Math.abs(delta) < 50) return;
    if (delta > 0) goPrev();
    else goNext();
  }

  return (
    <div
      className="photo-lightbox-backdrop"
      onClick={onClose}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      <img
        className={`photo-lightbox-image${shape === "circle" ? " photo-lightbox-image-circle" : ""}`}
        src={src}
        alt={alt ?? ""}
        onClick={(e) => e.stopPropagation()}
      />

      {gallery && gallery.total > 1 && (
        <>
          <button
            type="button"
            className="photo-lightbox-nav photo-lightbox-prev"
            onClick={(e) => {
              e.stopPropagation();
              goPrev();
            }}
            aria-label={t("media.previousPhoto")}
          >
            <ArrowLeftIcon size={22} />
          </button>
          <button
            type="button"
            className="photo-lightbox-nav photo-lightbox-next"
            onClick={(e) => {
              e.stopPropagation();
              goNext();
            }}
            aria-label={t("media.nextPhoto")}
          >
            <ArrowRightIcon size={22} />
          </button>
          <div className="photo-lightbox-counter">
            {gallery.index + 1} / {gallery.total}
          </div>
        </>
      )}

      <button type="button" className="photo-lightbox-close" onClick={onClose} aria-label={t("common.close")}>
        <XIcon size={20} />
      </button>
    </div>
  );
}

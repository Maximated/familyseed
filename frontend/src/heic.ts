const HEIC_MIME_TYPES = new Set(["image/heic", "image/heif", "image/heic-sequence", "image/heif-sequence"]);

function looksLikeHeic(file: File): boolean {
  if (HEIC_MIME_TYPES.has(file.type.toLowerCase())) return true;
  return /\.hei[cf]$/i.test(file.name);
}

// HEIC/HEIF (the default photo format on recent iPhones) can't be decoded by
// <img>/canvas in any browser except Safari — every photo pipeline in this
// app (resizeImage, PhotoCropModal) goes through canvas, so without this
// conversion those files fail with a generic "couldn't read image" error.
// heic2any is loaded dynamically since its WASM decoder is sizable and most
// uploads are already JPEG/PNG and never need it.
export async function convertHeicIfNeeded(file: File): Promise<File> {
  if (!looksLikeHeic(file)) return file;
  const heic2any = (await import("heic2any")).default;
  const converted = await heic2any({ blob: file, toType: "image/jpeg", quality: 0.9 });
  const blob = Array.isArray(converted) ? converted[0] : converted;
  return new File([blob], file.name.replace(/\.hei[cf]$/i, ".jpg"), { type: "image/jpeg" });
}

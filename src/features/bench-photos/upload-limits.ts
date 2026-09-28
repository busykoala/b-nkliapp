/** Below the 2 MiB Server Action limit, leaving room for multipart metadata. */
export const PREPARED_PHOTO_MAX_BYTES = 1_600_000;
export const UPLOADED_PHOTO_MAX_BYTES = 1_800_000;

/** Compression ratio is not an image-quality measurement. */
export function isPhotoUploadSize(size: number) {
  return Number.isInteger(size) && size > 0 && size <= UPLOADED_PHOTO_MAX_BYTES;
}

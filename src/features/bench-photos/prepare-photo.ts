import type { Translator } from "@/i18n/types";
import { PREPARED_PHOTO_MAX_BYTES } from "./upload-limits";

function canvasBlob(canvas: HTMLCanvasElement, type: string, quality: number) {
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
}

async function encodePhoto(canvas: HTMLCanvasElement, quality: number, t: Translator) {
  const jpeg = await canvasBlob(canvas, "image/jpeg", quality);
  if (!jpeg || jpeg.type !== "image/jpeg") throw new Error(t("photos.errors.prepare"));
  return jpeg;
}

export async function preparePhoto(file: File, t: Translator) {
  if (file.size > 24_000_000) throw new Error(t("photos.errors.originalTooLarge"));
  let source: CanvasImageSource;
  let width: number;
  let height: number;
  let close: (() => void) | undefined;
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    source = bitmap; width = bitmap.width; height = bitmap.height; close = () => bitmap.close();
  } catch {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    image.src = objectUrl;
    try { await image.decode(); }
    catch { throw new Error(t("photos.errors.decode")); }
    finally { URL.revokeObjectURL(objectUrl); }
    source = image; width = image.naturalWidth; height = image.naturalHeight;
  }
  try {
    if (!width || !height) throw new Error(t("photos.errors.decode"));
    const scale = Math.min(1, 1600 / Math.max(width, height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(width * scale); canvas.height = Math.round(height * scale);
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error(t("photos.errors.prepare"));
    context.fillStyle = "#fff"; context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(source, 0, 0, canvas.width, canvas.height);
    let output = canvas;
    let blob = await encodePhoto(output, .82, t);
    for (const quality of [.7, .58, .46]) {
      if (blob.size <= PREPARED_PHOTO_MAX_BYTES) break;
      blob = await encodePhoto(output, quality, t);
    }
    if (blob.size > PREPARED_PHOTO_MAX_BYTES) {
      const reduced = document.createElement("canvas");
      const reducedScale = Math.min(1, 1280 / Math.max(output.width, output.height));
      reduced.width = Math.round(output.width * reducedScale); reduced.height = Math.round(output.height * reducedScale);
      const reducedContext = reduced.getContext("2d", { alpha: false });
      if (!reducedContext) throw new Error(t("photos.errors.prepare"));
      reducedContext.drawImage(output, 0, 0, reduced.width, reduced.height); output = reduced;
      for (const quality of [.7, .58, .46]) {
        blob = await encodePhoto(output, quality, t);
        if (blob.size <= PREPARED_PHOTO_MAX_BYTES) break;
      }
    }
    if (blob.size > PREPARED_PHOTO_MAX_BYTES) throw new Error(t("photos.errors.tooDetailed"));
    return new File([blob], "baenkli.jpg", { type: "image/jpeg" });
  } finally { close?.(); }
}

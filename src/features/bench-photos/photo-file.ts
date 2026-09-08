const formats = {
  "image/webp": { extension: "webp", matches: (bytes: Uint8Array) => ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP" },
  "image/jpeg": { extension: "jpg", matches: (bytes: Uint8Array) => bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff },
  "image/png": { extension: "png", matches: (bytes: Uint8Array) => [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((value, index) => bytes[index] === value) },
} as const;

function ascii(bytes: Uint8Array, start: number, end: number) {
  return String.fromCharCode(...bytes.slice(start, end));
}

export type BenchPhotoType = keyof typeof formats;

export function validateBenchPhoto(bytes: Uint8Array, declaredType: string) {
  if (!(declaredType in formats)) throw new Error("Bitte verwende ein JPEG-, PNG- oder WebP-Foto.");
  const type = declaredType as BenchPhotoType;
  if (!formats[type].matches(bytes)) throw new Error("Das Bildformat passt nicht zum Foto. Bitte wähle das Bild nochmals.");
  return { type, extension: formats[type].extension };
}

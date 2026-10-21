"use client";
import { useEffect, useRef } from "react";
import { cloudPixels } from "../cloud-field";

// A small shared texture is enough for pigment, not for stars/terrain. Cache one weather state.
let cached: { key: string; pixels: Uint8ClampedArray } | null = null;
const WIDTH = 1024, HEIGHT = 384;
let pigmentPromise: Promise<Uint8ClampedArray> | null = null;

function loadPigment() {
  return pigmentPromise ??= new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement("canvas"); canvas.width = WIDTH; canvas.height = HEIGHT;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) { reject(new Error("Cloud pigment decoding unavailable")); return; }
      context.drawImage(image, 0, 0, WIDTH, HEIGHT);
      resolve(context.getImageData(0, 0, WIDTH, HEIGHT).data);
    };
    image.onerror = reject;
    image.src = "/ui-art/panorama/cloud-pigment.webp";
  });
}

export function PanoramaClouds({ cover, night, sunAltitude }: { cover: number; night: boolean; sunAltitude: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const surface = canvas.current;
    const context = surface?.getContext("2d");
    if (!context) return;
    let active = true;
    surface!.dataset.ready = "false";
    const draw = (pigment?: Uint8ClampedArray) => {
      if (!active) return;
      const key = `${cover}:${night}:${sunAltitude}:${Boolean(pigment)}`;
      if (cached?.key !== key) cached = { key, pixels: cloudPixels(WIDTH, HEIGHT, cover, night, pigment, sunAltitude) };
      const image = context.createImageData(WIDTH, HEIGHT);
      image.data.set(cached.pixels);
      context.putImageData(image, 0, 0);
      surface!.dataset.ready = "true";
    };
    loadPigment().then(draw, () => draw());
    return () => { active = false; };
  }, [cover, night, sunAltitude]);
  return <canvas ref={canvas} width={WIDTH} height={HEIGHT} className="bench-panorama-clouds" aria-hidden="true" />;
}

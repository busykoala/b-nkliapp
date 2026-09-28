"use client";
import { useEffect, useRef } from "react";
import { cloudPixels } from "../cloud-field";

// A small shared texture is enough for pigment, not for stars/terrain. Cache one weather state.
let cached: { key: string; pixels: Uint8ClampedArray } | null = null;
const WIDTH = 1024, HEIGHT = 384;

export function PanoramaClouds({ cover, night }: { cover: number; night: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const context = canvas.current?.getContext("2d");
    if (!context) return;
    const key = `${cover}:${night}`;
    if (cached?.key !== key) cached = { key, pixels: cloudPixels(WIDTH, HEIGHT, cover, night) };
    const image = context.createImageData(WIDTH, HEIGHT);
    image.data.set(cached.pixels);
    context.putImageData(image, 0, 0);
  }, [cover, night]);
  return <canvas ref={canvas} width={WIDTH} height={HEIGHT} className="bench-panorama-clouds" aria-hidden="true" />;
}

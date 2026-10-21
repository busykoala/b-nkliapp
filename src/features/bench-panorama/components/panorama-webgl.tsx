"use client";
/* eslint-disable @next/next/no-img-element -- immutable artifact is the material-mask fallback */

import { useEffect, useRef, useState } from "react";
import { panoramaMaterialHasCoverage, panoramaSnowCoverage, samplePanoramaMaterial, samplePanoramaLight,
  panoramaTextureDimensions, decodePanoramaMaterial, type DecodedPanoramaMaterial } from "@/lib/panorama-material";

type Props = {
  imageUrl: string; materialUrl?: string; lightMapUrl?: string;
  season: "spring" | "summer" | "autumn" | "winter";
  sunAltitude: number; cloudCover: number;
  dayPhase: "night" | "dawn" | "day" | "dusk";
  snowCover: boolean;
  rasterAltitudeRange?: number;
  onError(): void;
  onReady?(): void;
};

const VERTEX = `attribute vec2 position;varying vec2 uv;void main(){uv=vec2((position.x+1.0)*0.5,1.0-(position.y+1.0)*0.5);gl_Position=vec4(position,0.0,1.0);}`;
const FRAGMENT = `precision highp float;
varying vec2 uv;uniform sampler2D painting;uniform sampler2D material;uniform sampler2D lightmap;uniform sampler2D snowmap;
uniform vec2 lightSize;uniform float hasLight;
uniform vec2 materialSize;uniform float season;uniform float sunAltitude;uniform float clouds;uniform float phase;uniform float snow;uniform float modernMaterial;
vec3 continuousAt(vec2 pixel){vec2 point=(pixel+.5)/materialSize;
vec4 facts=texture2D(material,vec2(fract(point.x),clamp(point.y,0.0,1.0)));return vec3(facts.r*facts.a,facts.b*facts.a,facts.a);}
vec3 filteredFacts(vec2 point){vec2 pixel=point*materialSize-.5;vec2 base=floor(pixel);vec2 blend=fract(pixel);
vec3 top=mix(continuousAt(base),continuousAt(base+vec2(1.0,0.0)),blend.x);
vec3 bottom=mix(continuousAt(base+vec2(0.0,1.0)),continuousAt(base+vec2(1.0,1.0)),blend.x);
vec3 value=mix(top,bottom,blend.y);return vec3(value.xy/max(.00001,value.z),value.z);}
float lightAt(vec2 pixel){vec2 point=(pixel+.5)/lightSize;return texture2D(lightmap,vec2(fract(point.x),clamp(point.y,0.0,1.0))).r;}
float filteredLight(vec2 point){vec2 pixel=point*lightSize-.5;vec2 base=floor(pixel);vec2 blend=fract(pixel);
return mix(mix(lightAt(base),lightAt(base+vec2(1.0,0.0)),blend.x),mix(lightAt(base+vec2(0.0,1.0)),lightAt(base+vec2(1.0,1.0)),blend.x),blend.y);}
float snowAt(vec2 pixel){vec2 point=(pixel+.5)/materialSize;return texture2D(snowmap,vec2(fract(point.x),clamp(point.y,0.0,1.0))).r;}
float filteredSnow(vec2 point){vec2 pixel=point*materialSize-.5;vec2 base=floor(pixel);vec2 blend=fract(pixel);
return mix(mix(snowAt(base),snowAt(base+vec2(1.0,0.0)),blend.x),mix(snowAt(base+vec2(0.0,1.0)),snowAt(base+vec2(1.0,1.0)),blend.x),blend.y);}
void main(){vec4 source=texture2D(painting,uv);vec4 facts=texture2D(material,uv);
vec3 continuous=filteredFacts(uv);float depth=mix(facts.r,continuous.x,modernMaterial);
float semantic=floor(facts.g*255.0+.5);float normal=mix(facts.b,continuous.y,modernMaterial);
float modern=modernMaterial;float coverage=mix(1.0,continuous.z,modern);
float land=mix(step(.5,semantic),1.0,modern)*coverage;vec3 colour=source.rgb;
if(season<0.5)colour*=vec3(1.01,1.055,.99);else if(season>2.5)colour=mix(colour,vec3(dot(colour,vec3(.299,.587,.114))),.14)*vec3(.98,1.01,1.055);else if(season>1.5)colour*=vec3(1.075,.985,.88);
float sunStrength=clamp(sin(sunAltitude)*5.0,0.0,1.0);float mappedLight=clamp((filteredLight(uv)*255.0-58.0)/180.0,0.0,1.0);
float direct=mix(max(0.0,sin(sunAltitude)*(.74+normal*.26)),mappedLight*sunStrength,hasLight)*(1.0-clouds*.92)*land;
colour=mix(colour,vec3(.91,.94,.93),depth*depth*.14*land);colour+=vec3(.065,.042,.006)*direct;
colour*=1.0-hasLight*(1.0-mappedLight)*sunStrength*(1.0-clouds*.92)*.09*land;
float plausibleSnow=filteredSnow(uv)*snow*coverage*.7;
colour=mix(colour,vec3(.94,.95,.91),plausibleSnow);
float luminance=dot(colour,vec3(.299,.587,.114));
vec3 nightColour=vec3(luminance*.38+.025,luminance*.48+.038,luminance*.55+.054);
colour=mix(colour,nightColour,phase);gl_FragColor=vec4(colour*land,source.a*land);}`;

function compile(gl: WebGLRenderingContext, type: number, source: string) {
  const value = gl.createShader(type);
  if (!value) throw new Error("WebGL shader unavailable");
  gl.shaderSource(value, source); gl.compileShader(value);
  if (!gl.getShaderParameter(value, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(value) ?? "WebGL compile failed";
    gl.deleteShader(value); throw new Error(message);
  }
  return value;
}

function loadImage(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image(); image.decoding = "async"; image.onload = () => resolve(image); image.onerror = reject; image.src = url;
  });
}

function scaledSource(image: HTMLImageElement, width: number, height: number, smoothing: boolean) {
  if (image.naturalWidth === width && image.naturalHeight === height) return image;
  const surface = document.createElement("canvas"); surface.width = width; surface.height = height;
  const context = surface.getContext("2d");
  if (context) { context.imageSmoothingEnabled = smoothing; context.drawImage(image, 0, 0, width, height); }
  return surface;
}

function readPixels(image: HTMLImageElement) {
  const surface = document.createElement("canvas"); surface.width = image.naturalWidth; surface.height = image.naturalHeight;
  const context = surface.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Material decoding unavailable");
  context.drawImage(image, 0, 0);
  return context.getImageData(0, 0, surface.width, surface.height).data;
}

let materialCache: { key: string; data: DecodedPanoramaMaterial } | null = null;
function readMaterial(image: HTMLImageElement) {
  const key = `${image.src}:${image.naturalWidth}:${image.naturalHeight}`;
  if (materialCache?.key !== key) materialCache = { key,
    data: decodePanoramaMaterial(readPixels(image), image.naturalWidth, image.naturalHeight) };
  return materialCache.data;
}

let snowCache: { key: string; pixels: Uint8ClampedArray } | null = null;
let fallbackCache: { key: string; image: ImageData } | null = null;
function snowField(image: HTMLImageElement, altitudeRange: number, material: DecodedPanoramaMaterial) {
  const { pixels, width, height } = material;
  const key = `${image.src}:${width}:${height}:${altitudeRange}`;
  if (snowCache?.key !== key) snowCache = { key, pixels: panoramaSnowCoverage(pixels, width,
    height, panoramaMaterialHasCoverage(pixels), altitudeRange) };
  return snowCache.pixels;
}

function drawTerrainFallback(canvas: HTMLCanvasElement, painting: HTMLImageElement, material: HTMLImageElement, light: HTMLImageElement | null,
  season: Props["season"], dayPhase: Props["dayPhase"], snowCover: boolean, sunAltitude: number, cloudCover: number, altitudeRange: number) {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return false;
  const key = JSON.stringify([painting.src, material.src, light?.src, canvas.width, canvas.height,
    season, dayPhase, snowCover, sunAltitude, cloudCover, altitudeRange]);
  // Three identical world copies provide horizontal wrapping. Calculate their
  // CPU pixels once; retain only the latest state, bounded by one backing store.
  if (fallbackCache?.key === key) {
    context.putImageData(fallbackCache.image, 0, 0);
    return true;
  }
  context.imageSmoothingEnabled = true;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(painting, 0, 0, canvas.width, canvas.height);
  const colour = context.getImageData(0, 0, canvas.width, canvas.height);
  const materialData = readMaterial(material), facts = materialData.pixels;
  const lightPixels = light ? readPixels(light) : null;
  const snowPixels = snowCover ? snowField(material, altitudeRange, materialData) : null;
  const modern = panoramaMaterialHasCoverage(facts);
  const sun = Math.max(-.1, sunAltitude * Math.PI / 180);
  const phase = dayPhase === "night" ? 1 : dayPhase === "day" ? 0 : .24;
  for (let cursor = 0; cursor < colour.data.length; cursor += 4) {
    const pixel = cursor / 4;
    const [depth, , normal, coverage] = samplePanoramaMaterial(facts, materialData.width, materialData.height,
      (pixel % canvas.width + .5) / canvas.width, (Math.floor(pixel / canvas.width) + .5) / canvas.height, modern);
    if (coverage === 0) { colour.data[cursor + 3] = 0; continue; }
    let r = colour.data[cursor] / 255, g = colour.data[cursor + 1] / 255, b = colour.data[cursor + 2] / 255;
    if (season === "spring") { r *= 1.01; g *= 1.055; b *= .99; }
    else if (season === "autumn") { r *= 1.075; g *= .985; b *= .88; }
    else if (season === "winter") {
      const grey = r * .299 + g * .587 + b * .114;
      r = (r * .86 + grey * .14) * .98; g = (g * .86 + grey * .14) * 1.01; b = (b * .86 + grey * .14) * 1.055;
    }
    const haze = depth * depth * .14 * coverage;
    const sunStrength = Math.max(0, Math.min(1, Math.sin(sun) * 5));
    const mappedLight = lightPixels && light ? Math.max(0, Math.min(1, (samplePanoramaLight(lightPixels, light.naturalWidth,
      light.naturalHeight, (pixel % canvas.width + .5) / canvas.width, (Math.floor(pixel / canvas.width) + .5) / canvas.height) * 255 - 58) / 180)) : null;
    const direct = (mappedLight == null ? Math.max(0, Math.sin(sun) * (.74 + normal * .26)) : mappedLight * sunStrength) * (1 - cloudCover * .92) * coverage;
    r = r * (1 - haze) + .91 * haze + .065 * direct;
    g = g * (1 - haze) + .94 * haze + .042 * direct;
    b = b * (1 - haze) + .93 * haze + .006 * direct;
    const shade = mappedLight == null ? 1 : 1 - (1 - mappedLight) * sunStrength * (1 - cloudCover * .92) * .09 * coverage;
    r *= shade; g *= shade; b *= shade;
    const snow = snowPixels ? coverage * .7 * samplePanoramaLight(snowPixels, materialData.width, materialData.height,
      (pixel % canvas.width + .5) / canvas.width, (Math.floor(pixel / canvas.width) + .5) / canvas.height) : 0;
    r = r * (1 - snow) + .94 * snow; g = g * (1 - snow) + .95 * snow; b = b * (1 - snow) + .91 * snow;
    const luminance = r * .299 + g * .587 + b * .114;
    colour.data[cursor] = (r * (1 - phase) + (luminance * .38 + .025) * phase) * 255;
    colour.data[cursor + 1] = (g * (1 - phase) + (luminance * .48 + .038) * phase) * 255;
    colour.data[cursor + 2] = (b * (1 - phase) + (luminance * .55 + .054) * phase) * 255;
    colour.data[cursor + 3] = Math.round(colour.data[cursor + 3] * coverage);
  }
  context.putImageData(colour, 0, 0);
  fallbackCache = { key, image: colour };
  return true;
}

export function PanoramaWebgl({ imageUrl, materialUrl, lightMapUrl, season, sunAltitude, cloudCover, dayPhase, snowCover, rasterAltitudeRange = 90, onError, onReady }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const fallbackCanvas = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState<{ kind: "webgl" | "fallback"; key: string } | null>(null);
  const [contextRevision, setContextRevision] = useState(0);
  const [displayWidth, setDisplayWidth] = useState(0);
  useEffect(() => {
    const surface = canvas.current;
    if (!surface || !materialUrl) return;
    const observer = new ResizeObserver(() => {
      const width = surface.getBoundingClientRect().width;
      // Cached images can decode before the parent has measured its projection.
      // Do not lock the backing store to the initial 2px seam overlap.
      if (width > 2) setDisplayWidth(2 ** Math.ceil(Math.log2(width)));
    });
    observer.observe(surface);
    return () => observer.disconnect();
  }, [materialUrl]);
  const renderKey = `${imageUrl}\n${materialUrl ?? ""}\n${lightMapUrl ?? ""}\n${season}\n${sunAltitude}\n${cloudCover}\n${dayPhase}\n${snowCover}\n${rasterAltitudeRange}\n${contextRevision}\n${displayWidth}`;
  useEffect(() => {
    let active = true;
    const surface = canvas.current;
    const fallback = fallbackCanvas.current;
    if (!materialUrl || !surface || !fallback || displayWidth === 0) return;
    const gl = surface.getContext("webgl", { alpha: true, antialias: false, depth: false,
      premultipliedAlpha: true, preserveDrawingBuffer: false });
    let paintingImage: HTMLImageElement | null = null;
    let materialImage: HTMLImageElement | null = null;
    let lightImage: HTMLImageElement | null = null;
    let contextLost = false;
    const resources: { textures: WebGLTexture[]; buffer?: WebGLBuffer; program?: WebGLProgram;
      vertex?: WebGLShader; fragment?: WebGLShader } = { textures: [] };
    const prepareSize = (painting: HTMLImageElement) => {
      const dpr = Math.min(3, window.devicePixelRatio || 1);
      const maximum = gl ? gl.getParameter(gl.MAX_TEXTURE_SIZE) as number : 4096;
      const dimensions = panoramaTextureDimensions(painting.naturalWidth, painting.naturalHeight,
        displayWidth, dpr, maximum);
      surface.width = dimensions.width; surface.height = dimensions.height;
      fallback.width = dimensions.width; fallback.height = dimensions.height;
      return dimensions;
    };
    const drawFallback = () => {
      if (!active || !paintingImage || !materialImage) return;
      try {
        const fallbackReady = drawTerrainFallback(fallback, paintingImage, materialImage, lightImage, season, dayPhase, snowCover, sunAltitude, cloudCover, rasterAltitudeRange);
        if (fallbackReady) { setReady({ kind: "fallback", key: renderKey }); onReady?.(); }
        else onError();
      } catch { onError(); }
    };
    const handleContextLost = (event: Event) => {
      event.preventDefault(); contextLost = true; drawFallback();
    };
    const handleContextRestored = () => { if (active) setContextRevision((value) => value + 1); };
    surface.addEventListener("webglcontextlost", handleContextLost);
    surface.addEventListener("webglcontextrestored", handleContextRestored);
    Promise.all([loadImage(imageUrl), loadImage(materialUrl), lightMapUrl ? loadImage(lightMapUrl).catch(() => null) : null]).then(([painting, facts, light]) => {
      if (!active) return;
      paintingImage = painting; materialImage = facts; lightImage = light;
      const dimensions = prepareSize(painting);
      if (!gl || contextLost) { drawFallback(); return; }
      const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX); resources.vertex = vertex;
      const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT); resources.fragment = fragment;
      const program = gl.createProgram(); if (!program) throw new Error("WebGL program unavailable"); resources.program = program;
      gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? "WebGL link failed");
      gl.useProgram(program); const buffer = gl.createBuffer(); resources.buffer = buffer ?? undefined; gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]), gl.STATIC_DRAW);
      const position = gl.getAttribLocation(program, "position"); gl.enableVertexAttribArray(position); gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
      const materialData = readMaterial(facts), factsPixels = materialData.pixels;
      [painting, facts, light].forEach((image, index) => {
        gl.activeTexture(gl.TEXTURE0 + index); const texture = gl.createTexture(); if (!texture) return;
        resources.textures.push(texture); gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, index === 0 ? gl.REPEAT : gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        const filter = index === 0 ? gl.LINEAR : gl.NEAREST;
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
        if (index === 1 && materialData.transport === "opaque-planes-v2") {
          // Upload the reconstructed bytes directly. Sending fractional alpha
          // through another image/canvas would corrupt categorical IDs again.
          gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, materialData.width, materialData.height,
            0, gl.RGBA, gl.UNSIGNED_BYTE, factsPixels);
        } else if (image) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE,
          index === 0 ? scaledSource(image, dimensions.width, dimensions.height, true) : image);
        else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([128, 128, 128, 255]));
      });
      gl.activeTexture(gl.TEXTURE3);
      const snowTexture = gl.createTexture(); if (!snowTexture) throw new Error("Snow texture unavailable");
      resources.textures.push(snowTexture); gl.bindTexture(gl.TEXTURE_2D, snowTexture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      if (snowCover) {
        const values = snowField(facts, rasterAltitudeRange, materialData);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, materialData.width, materialData.height, 0, gl.RGBA, gl.UNSIGNED_BYTE,
          new Uint8Array(values.buffer, values.byteOffset, values.byteLength));
      } else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
      gl.uniform1i(gl.getUniformLocation(program, "painting"), 0); gl.uniform1i(gl.getUniformLocation(program, "material"), 1);
      gl.uniform1i(gl.getUniformLocation(program, "lightmap"), 2);
      gl.uniform1i(gl.getUniformLocation(program, "snowmap"), 3);
      gl.uniform1f(gl.getUniformLocation(program, "hasLight"), light ? 1 : 0);
      gl.uniform2f(gl.getUniformLocation(program, "lightSize"), light?.naturalWidth ?? 1, light?.naturalHeight ?? 1);
      gl.uniform2f(gl.getUniformLocation(program, "materialSize"), materialData.width, materialData.height);
      gl.uniform1f(gl.getUniformLocation(program, "modernMaterial"), panoramaMaterialHasCoverage(factsPixels) ? 1 : 0);
      gl.uniform1f(gl.getUniformLocation(program, "season"), ["spring","summer","autumn","winter"].indexOf(season));
      gl.uniform1f(gl.getUniformLocation(program, "sunAltitude"), Math.max(-.1, sunAltitude * Math.PI / 180));
      gl.uniform1f(gl.getUniformLocation(program, "clouds"), cloudCover); gl.uniform1f(gl.getUniformLocation(program, "phase"), dayPhase === "night" ? 1 : dayPhase === "day" ? 0 : .24);
      gl.uniform1f(gl.getUniformLocation(program, "snow"), snowCover ? 1 : 0);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
      gl.drawArrays(gl.TRIANGLES, 0, 6); setReady({ kind: "webgl", key: renderKey }); onReady?.();
    }).catch(() => {
      if (!active) return;
      if (!paintingImage || !materialImage) onError();
      else drawFallback();
    });
    return () => {
      active = false;
      surface.removeEventListener("webglcontextlost", handleContextLost);
      surface.removeEventListener("webglcontextrestored", handleContextRestored);
      if (gl && !contextLost) {
        resources.textures.forEach((texture) => gl.deleteTexture(texture));
        if (resources.buffer) gl.deleteBuffer(resources.buffer);
        if (resources.program) gl.deleteProgram(resources.program);
        if (resources.vertex) gl.deleteShader(resources.vertex);
        if (resources.fragment) gl.deleteShader(resources.fragment);
      }
    };
  }, [cloudCover, contextRevision, dayPhase, displayWidth, imageUrl, materialUrl, lightMapUrl, onReady, onError, renderKey, season, snowCover, sunAltitude, rasterAltitudeRange]);
  const readyKind = ready?.key === renderKey ? ready.kind : null;
  return <><img className={`bench-panorama-art${materialUrl ? " has-material" : ""}${readyKind ? " is-painted" : ""}`} src={imageUrl} alt="" draggable={false}
    loading="eager" fetchPriority="high" onError={onError} />
    {materialUrl && <><canvas ref={canvas} className={`bench-panorama-art bench-panorama-webgl${readyKind === "webgl" ? " is-ready" : ""}`} />
      <canvas ref={fallbackCanvas} className={`bench-panorama-art bench-panorama-webgl${readyKind === "fallback" ? " is-ready" : ""}`} /></>}</>;
}

"use client";
/* eslint-disable @next/next/no-img-element -- immutable artifact is the material-mask fallback */

import { useEffect, useRef, useState } from "react";

type Props = {
  imageUrl: string; materialUrl?: string;
  season: "spring" | "summer" | "autumn" | "winter";
  sunAltitude: number; cloudCover: number;
  dayPhase: "night" | "dawn" | "day" | "dusk";
  snowCover: boolean;
  onError(): void;
  onReady?(): void;
};

const VERTEX = `attribute vec2 position;varying vec2 uv;void main(){uv=vec2((position.x+1.0)*0.5,1.0-(position.y+1.0)*0.5);gl_Position=vec4(position,0.0,1.0);}`;
const FRAGMENT = `precision mediump float;
varying vec2 uv;uniform sampler2D painting;uniform sampler2D material;
uniform float season;uniform float sunAltitude;uniform float clouds;uniform float phase;uniform float snow;
void main(){vec4 source=texture2D(painting,uv);vec3 facts=texture2D(material,uv).rgb;
float depth=facts.r;float semantic=facts.g;float normal=facts.b;float land=step(0.047,semantic);vec3 colour=source.rgb;
if(season<0.5)colour*=vec3(1.01,1.055,.99);else if(season>2.5)colour=mix(colour,vec3(dot(colour,vec3(.299,.587,.114))),.14)*vec3(.98,1.01,1.055);else if(season>1.5)colour*=vec3(1.075,.985,.88);
float direct=max(0.0,sin(sunAltitude)*(.74+normal*.26))*(1.0-clouds*.92)*land;
colour=mix(colour,vec3(.91,.94,.93),depth*depth*.14*land);colour+=vec3(.065,.042,.006)*direct;
float plausibleSnow=(step(.45,semantic)*(1.0-step(.82,semantic))+step(.94,semantic))*snow;
colour=mix(colour,vec3(.94,.95,.91),plausibleSnow*(.34+normal*.28));
colour*=mix(1.0,.77,phase);gl_FragColor=vec4(colour*land,source.a*land);}`;

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

function scaledSource(image: HTMLImageElement, width: number, height: number) {
  if (image.naturalWidth === width && image.naturalHeight === height) return image;
  const surface = document.createElement("canvas"); surface.width = width; surface.height = height;
  surface.getContext("2d")?.drawImage(image, 0, 0, width, height);
  return surface;
}

function drawTerrainFallback(canvas: HTMLCanvasElement, painting: HTMLImageElement, material: HTMLImageElement,
  season: Props["season"], dayPhase: Props["dayPhase"], snowCover: boolean) {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return false;
  const mask = document.createElement("canvas"); mask.width = canvas.width; mask.height = canvas.height;
  const maskContext = mask.getContext("2d", { willReadFrequently: true });
  if (!maskContext) return false;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(painting, 0, 0, canvas.width, canvas.height);
  maskContext.drawImage(material, 0, 0, canvas.width, canvas.height);
  const colour = context.getImageData(0, 0, canvas.width, canvas.height);
  const facts = maskContext.getImageData(0, 0, canvas.width, canvas.height).data;
  for (let cursor = 0; cursor < colour.data.length; cursor += 4) {
    const semantic = facts[cursor + 1];
    if (semantic < 12) { colour.data[cursor + 3] = 0; continue; }
    const winter = season === "winter" ? .94 : 1;
    const night = dayPhase === "night" ? .77 : dayPhase === "day" ? 1 : .94;
    colour.data[cursor] *= winter * night;
    colour.data[cursor + 1] *= night;
    colour.data[cursor + 2] *= night;
    if (snowCover && ((semantic >= 115 && semantic <= 209) || semantic >= 240)) {
      colour.data[cursor] = colour.data[cursor] * .55 + 240 * .45;
      colour.data[cursor + 1] = colour.data[cursor + 1] * .55 + 242 * .45;
      colour.data[cursor + 2] = colour.data[cursor + 2] * .55 + 232 * .45;
    }
  }
  context.putImageData(colour, 0, 0);
  return true;
}

export function PanoramaWebgl({ imageUrl, materialUrl, season, sunAltitude, cloudCover, dayPhase, snowCover, onError, onReady }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let active = true;
    const surface = canvas.current;
    if (!materialUrl || !surface) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    // WebGL 1 requires power-of-two textures for REPEAT, which is essential
    // for the circular seam. Keep the two bounded tiers POT at both DPRs.
    const width = dpr > 1 ? 2048 : 1024;
    surface.width = width; surface.height = Math.round(width / 4);
    const gl = surface.getContext("webgl", { alpha: true, antialias: false, depth: false,
      premultipliedAlpha: true, preserveDrawingBuffer: false });
    let cleanup = () => {};
    Promise.all([loadImage(imageUrl), loadImage(materialUrl)]).then(([painting, facts]) => {
      if (!active) return;
      if (!gl) {
        const fallbackReady = drawTerrainFallback(surface, painting, facts, season, dayPhase, snowCover);
        setReady(fallbackReady); if (fallbackReady) onReady?.();
        return;
      }
      const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX);
      const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT);
      const program = gl.createProgram(); if (!program) throw new Error("WebGL program unavailable");
      gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? "WebGL link failed");
      gl.useProgram(program); const buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]), gl.STATIC_DRAW);
      const position = gl.getAttribLocation(program, "position"); gl.enableVertexAttribArray(position); gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
      const textures: WebGLTexture[] = [];
      [painting, facts].forEach((image, index) => {
        gl.activeTexture(gl.TEXTURE0 + index); const texture = gl.createTexture(); if (!texture) return;
        textures.push(texture); gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, scaledSource(image, width, surface.height));
      });
      gl.uniform1i(gl.getUniformLocation(program, "painting"), 0); gl.uniform1i(gl.getUniformLocation(program, "material"), 1);
      gl.uniform1f(gl.getUniformLocation(program, "season"), ["spring","summer","autumn","winter"].indexOf(season));
      gl.uniform1f(gl.getUniformLocation(program, "sunAltitude"), Math.max(-.1, sunAltitude * Math.PI / 180));
      gl.uniform1f(gl.getUniformLocation(program, "clouds"), cloudCover); gl.uniform1f(gl.getUniformLocation(program, "phase"), dayPhase === "night" ? 1 : dayPhase === "day" ? 0 : .24);
      gl.uniform1f(gl.getUniformLocation(program, "snow"), snowCover ? 1 : 0);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
      gl.drawArrays(gl.TRIANGLES, 0, 6); setReady(true); onReady?.();
      cleanup = () => {
        textures.forEach((texture) => gl.deleteTexture(texture));
        if (buffer) gl.deleteBuffer(buffer); gl.deleteProgram(program); gl.deleteShader(vertex); gl.deleteShader(fragment);
      };
    }).catch(async () => {
      if (!active) return;
      try {
        const [painting, facts] = await Promise.all([loadImage(imageUrl), loadImage(materialUrl)]);
        if (active) {
          const fallbackReady = drawTerrainFallback(surface, painting, facts, season, dayPhase, snowCover);
          setReady(fallbackReady); if (fallbackReady) onReady?.();
        }
      } catch { if (active) setReady(false); }
    });
    return () => { active = false; cleanup(); };
  }, [cloudCover, dayPhase, imageUrl, materialUrl, onReady, season, snowCover, sunAltitude]);
  return <><img className={`bench-panorama-art${materialUrl ? " has-material" : ""}${ready ? " is-painted" : ""}`} src={imageUrl} alt="" draggable={false}
    loading="eager" fetchPriority="high" onError={onError} />
    {materialUrl && <canvas ref={canvas} className={`bench-panorama-art bench-panorama-webgl${ready ? " is-ready" : ""}`} />}</>;
}

"use client";
/* eslint-disable @next/next/no-img-element -- immutable artifact is the material-mask fallback */

import { useEffect, useRef, useState } from "react";
import { PANORAMA_MATERIAL_IDS, panoramaMaterialIsSnowEligible, panoramaMaterialUsesCoverageAlpha,
  panoramaTextureDimensions } from "@/lib/panorama-material";

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
const FRAGMENT = `precision highp float;
varying vec2 uv;uniform sampler2D painting;uniform sampler2D material;
uniform vec2 materialSize;uniform float season;uniform float sunAltitude;uniform float clouds;uniform float phase;uniform float snow;
float coverageAt(vec2 pixel){vec2 point=(pixel+.5)/materialSize;return texture2D(material,vec2(fract(point.x),clamp(point.y,0.0,1.0))).a;}
float filteredCoverage(vec2 point){vec2 pixel=point*materialSize-.5;vec2 base=floor(pixel);vec2 blend=fract(pixel);
float top=mix(coverageAt(base),coverageAt(base+vec2(1.0,0.0)),blend.x);
float bottom=mix(coverageAt(base+vec2(0.0,1.0)),coverageAt(base+vec2(1.0,1.0)),blend.x);return mix(top,bottom,blend.y);}
float exact(float value,float wanted){return 1.0-step(.5,abs(value-wanted));}
void main(){vec4 source=texture2D(painting,uv);vec4 facts=texture2D(material,uv);
float depth=facts.r;float semantic=floor(facts.g*255.0+.5);float normal=facts.b;
float modern=step(.5,semantic)*step(semantic,9.5);float coverage=mix(1.0,filteredCoverage(uv),modern);
float land=step(.5,semantic)*coverage;vec3 colour=source.rgb;
if(season<0.5)colour*=vec3(1.01,1.055,.99);else if(season>2.5)colour=mix(colour,vec3(dot(colour,vec3(.299,.587,.114))),.14)*vec3(.98,1.01,1.055);else if(season>1.5)colour*=vec3(1.075,.985,.88);
float direct=max(0.0,sin(sunAltitude)*(.74+normal*.26))*(1.0-clouds*.92)*land;
colour=mix(colour,vec3(.91,.94,.93),depth*depth*.14*land);colour+=vec3(.065,.042,.006)*direct;
float modernSnow=exact(semantic,4.0)+exact(semantic,5.0)+exact(semantic,6.0)+exact(semantic,9.0);
float legacySnow=(step(114.5,semantic)*(1.0-step(209.5,semantic))+step(239.5,semantic))*(1.0-modern);
float plausibleSnow=min(1.0,modernSnow+legacySnow)*snow*coverage;
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

function scaledSource(image: HTMLImageElement, width: number, height: number, smoothing: boolean) {
  if (image.naturalWidth === width && image.naturalHeight === height) return image;
  const surface = document.createElement("canvas"); surface.width = width; surface.height = height;
  const context = surface.getContext("2d");
  if (context) { context.imageSmoothingEnabled = smoothing; context.drawImage(image, 0, 0, width, height); }
  return surface;
}

function drawTerrainFallback(canvas: HTMLCanvasElement, painting: HTMLImageElement, material: HTMLImageElement,
  season: Props["season"], dayPhase: Props["dayPhase"], snowCover: boolean) {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return false;
  const mask = document.createElement("canvas"); mask.width = canvas.width; mask.height = canvas.height;
  const maskContext = mask.getContext("2d", { willReadFrequently: true });
  if (!maskContext) return false;
  context.imageSmoothingEnabled = true;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(painting, 0, 0, canvas.width, canvas.height);
  maskContext.imageSmoothingEnabled = false;
  maskContext.drawImage(material, 0, 0, canvas.width, canvas.height);
  const colour = context.getImageData(0, 0, canvas.width, canvas.height);
  const facts = maskContext.getImageData(0, 0, canvas.width, canvas.height).data;
  for (let cursor = 0; cursor < colour.data.length; cursor += 4) {
    const semantic = facts[cursor + 1];
    const coverage = panoramaMaterialUsesCoverageAlpha(semantic) ? facts[cursor + 3] / 255 : 1;
    if (semantic === PANORAMA_MATERIAL_IDS.sky || coverage === 0) { colour.data[cursor + 3] = 0; continue; }
    const winter = season === "winter" ? .94 : 1;
    const night = dayPhase === "night" ? .77 : dayPhase === "day" ? 1 : .94;
    colour.data[cursor] *= winter * night;
    colour.data[cursor + 1] *= night;
    colour.data[cursor + 2] *= night;
    if (snowCover && panoramaMaterialIsSnowEligible(semantic)) {
      colour.data[cursor] = colour.data[cursor] * .55 + 240 * .45;
      colour.data[cursor + 1] = colour.data[cursor + 1] * .55 + 242 * .45;
      colour.data[cursor + 2] = colour.data[cursor + 2] * .55 + 232 * .45;
    }
    colour.data[cursor + 3] = Math.round(colour.data[cursor + 3] * coverage);
  }
  context.putImageData(colour, 0, 0);
  return true;
}

export function PanoramaWebgl({ imageUrl, materialUrl, season, sunAltitude, cloudCover, dayPhase, snowCover, onError, onReady }: Props) {
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
  const renderKey = `${imageUrl}\n${materialUrl ?? ""}\n${season}\n${sunAltitude}\n${cloudCover}\n${dayPhase}\n${snowCover}\n${contextRevision}\n${displayWidth}`;
  useEffect(() => {
    let active = true;
    const surface = canvas.current;
    const fallback = fallbackCanvas.current;
    if (!materialUrl || !surface || !fallback || displayWidth === 0) return;
    const gl = surface.getContext("webgl", { alpha: true, antialias: false, depth: false,
      premultipliedAlpha: true, preserveDrawingBuffer: false });
    let paintingImage: HTMLImageElement | null = null;
    let materialImage: HTMLImageElement | null = null;
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
      const fallbackReady = drawTerrainFallback(fallback, paintingImage, materialImage, season, dayPhase, snowCover);
      if (fallbackReady) { setReady({ kind: "fallback", key: renderKey }); onReady?.(); }
    };
    const handleContextLost = (event: Event) => {
      event.preventDefault(); contextLost = true; drawFallback();
    };
    const handleContextRestored = () => { if (active) setContextRevision((value) => value + 1); };
    surface.addEventListener("webglcontextlost", handleContextLost);
    surface.addEventListener("webglcontextrestored", handleContextRestored);
    Promise.all([loadImage(imageUrl), loadImage(materialUrl)]).then(([painting, facts]) => {
      if (!active) return;
      paintingImage = painting; materialImage = facts;
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
      [painting, facts].forEach((image, index) => {
        gl.activeTexture(gl.TEXTURE0 + index); const texture = gl.createTexture(); if (!texture) return;
        resources.textures.push(texture); gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        const filter = index === 0 ? gl.LINEAR : gl.NEAREST;
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE,
          scaledSource(image, dimensions.width, dimensions.height, index === 0));
      });
      gl.uniform1i(gl.getUniformLocation(program, "painting"), 0); gl.uniform1i(gl.getUniformLocation(program, "material"), 1);
      gl.uniform2f(gl.getUniformLocation(program, "materialSize"), dimensions.width, dimensions.height);
      gl.uniform1f(gl.getUniformLocation(program, "season"), ["spring","summer","autumn","winter"].indexOf(season));
      gl.uniform1f(gl.getUniformLocation(program, "sunAltitude"), Math.max(-.1, sunAltitude * Math.PI / 180));
      gl.uniform1f(gl.getUniformLocation(program, "clouds"), cloudCover); gl.uniform1f(gl.getUniformLocation(program, "phase"), dayPhase === "night" ? 1 : dayPhase === "day" ? 0 : .24);
      gl.uniform1f(gl.getUniformLocation(program, "snow"), snowCover ? 1 : 0);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
      gl.drawArrays(gl.TRIANGLES, 0, 6); setReady({ kind: "webgl", key: renderKey }); onReady?.();
    }).catch(() => {
      if (!active) return;
      drawFallback();
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
  }, [cloudCover, contextRevision, dayPhase, displayWidth, imageUrl, materialUrl, onReady, renderKey, season, snowCover, sunAltitude]);
  const readyKind = ready?.key === renderKey ? ready.kind : null;
  return <><img className={`bench-panorama-art${materialUrl ? " has-material" : ""}${readyKind ? " is-painted" : ""}`} src={imageUrl} alt="" draggable={false}
    loading="eager" fetchPriority="high" onError={onError} />
    {materialUrl && <><canvas ref={canvas} className={`bench-panorama-art bench-panorama-webgl${readyKind === "webgl" ? " is-ready" : ""}`} />
      <canvas ref={fallbackCanvas} className={`bench-panorama-art bench-panorama-webgl${readyKind === "fallback" ? " is-ready" : ""}`} /></>}</>;
}

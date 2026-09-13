"use client";
/* eslint-disable @next/next/no-img-element -- immutable artifact is the WebGL fallback */

import { useEffect, useRef, useState } from "react";

type Props = {
  imageUrl: string; materialUrl?: string;
  season: "spring" | "summer" | "autumn" | "winter";
  sunAltitude: number; cloudCover: number;
  dayPhase: "night" | "dawn" | "day" | "dusk";
  onError(): void;
};

const VERTEX = `attribute vec2 position;varying vec2 uv;void main(){uv=vec2((position.x+1.0)*0.5,1.0-(position.y+1.0)*0.5);gl_Position=vec4(position,0.0,1.0);}`;
const FRAGMENT = `precision mediump float;
varying vec2 uv;uniform sampler2D painting;uniform sampler2D material;
uniform float season;uniform float sunAltitude;uniform float clouds;uniform float phase;
void main(){vec4 source=texture2D(painting,uv);vec3 facts=texture2D(material,uv).rgb;
float depth=facts.r;float normal=facts.b;float land=step(0.003,facts.g);vec3 colour=source.rgb;
if(season<0.5)colour*=vec3(1.01,1.055,.99);else if(season>2.5)colour=mix(colour,vec3(dot(colour,vec3(.299,.587,.114))),.14)*vec3(.98,1.01,1.055);else if(season>1.5)colour*=vec3(1.075,.985,.88);
float direct=max(0.0,sin(sunAltitude)*(.74+normal*.26))*(1.0-clouds*.92)*land;
colour=mix(colour,vec3(.91,.94,.93),depth*depth*.14*land);colour+=vec3(.065,.042,.006)*direct;colour*=mix(1.0,.58,phase);gl_FragColor=vec4(colour,source.a);}`;

function compile(gl: WebGLRenderingContext, type: number, source: string) {
  const value = gl.createShader(type);
  if (!value) throw new Error("WebGL shader unavailable");
  gl.shaderSource(value, source); gl.compileShader(value);
  if (!gl.getShaderParameter(value, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(value) ?? "WebGL compile failed");
  return value;
}

function loadImage(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image(); image.decoding = "async"; image.onload = () => resolve(image); image.onerror = reject; image.src = url;
  });
}

export function PanoramaWebgl({ imageUrl, materialUrl, season, sunAltitude, cloudCover, dayPhase, onError }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let active = true;
    if (!materialUrl || !canvas.current) return;
    const gl = canvas.current.getContext("webgl", { alpha: false, antialias: false, depth: false });
    if (!gl) return;
    Promise.all([loadImage(imageUrl), loadImage(materialUrl)]).then(([painting, facts]) => {
      if (!active) return;
      const program = gl.createProgram(); if (!program) throw new Error("WebGL program unavailable");
      gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX)); gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT));
      gl.linkProgram(program); if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? "WebGL link failed");
      gl.useProgram(program); const buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]), gl.STATIC_DRAW);
      const position = gl.getAttribLocation(program, "position"); gl.enableVertexAttribArray(position); gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
      [painting, facts].forEach((image, index) => { gl.activeTexture(gl.TEXTURE0 + index); const texture = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image); });
      gl.uniform1i(gl.getUniformLocation(program, "painting"), 0); gl.uniform1i(gl.getUniformLocation(program, "material"), 1);
      gl.uniform1f(gl.getUniformLocation(program, "season"), ["spring","summer","autumn","winter"].indexOf(season));
      gl.uniform1f(gl.getUniformLocation(program, "sunAltitude"), Math.max(-.1, sunAltitude * Math.PI / 180));
      gl.uniform1f(gl.getUniformLocation(program, "clouds"), cloudCover); gl.uniform1f(gl.getUniformLocation(program, "phase"), dayPhase === "night" ? 1 : dayPhase === "day" ? 0 : .24);
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight); gl.drawArrays(gl.TRIANGLES, 0, 6); setReady(true);
    }).catch(() => setReady(false));
    return () => { active = false; };
  }, [cloudCover, dayPhase, imageUrl, materialUrl, season, sunAltitude]);
  return <><img className={`bench-panorama-art${ready ? " is-painted" : ""}`} src={imageUrl} alt="" draggable={false} onError={onError} />
    {materialUrl && <canvas ref={canvas} className={`bench-panorama-art bench-panorama-webgl${ready ? " is-ready" : ""}`} width="1024" height="256" />}</>;
}

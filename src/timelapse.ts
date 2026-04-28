// Time-lapse loader: pre-fetches a sequence of GIBS daily composites and
// returns them as ready-to-bind THREE textures. Designed to use a low zoom
// level (1 by default) so memory stays sane even for 30-day reels.

import * as THREE from "three";
import { GIBS_LAYERS, loadGibsComposite, type GibsLayer } from "./tiles";

export type TimelapseFrame = {
  date: string;       // YYYY-MM-DD
  texture: THREE.CanvasTexture;
};

export type TimelapseProgress = (loaded: number, total: number) => void;

export function dateRange(startISO: string, endISO: string): string[] {
  const start = new Date(startISO + "T00:00:00Z");
  const end = new Date(endISO + "T00:00:00Z");
  if (end.getTime() < start.getTime()) return [startISO];
  const out: string[] = [];
  const d = new Date(start);
  for (let i = 0; i < 366; i++) {
    out.push(d.toISOString().slice(0, 10));
    if (d.getTime() >= end.getTime()) break;
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

export function shiftDate(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export async function loadTimelapseFrames(
  layerId: string,
  dates: string[],
  zoom: number,
  signal: AbortSignal | undefined,
  onProgress: TimelapseProgress | undefined,
  fallbackBackground: HTMLImageElement | HTMLCanvasElement | undefined
): Promise<TimelapseFrame[]> {
  const layer: GibsLayer = GIBS_LAYERS[layerId] ?? GIBS_LAYERS.blueMarble;
  const frames: TimelapseFrame[] = [];

  for (let i = 0; i < dates.length; i++) {
    if (signal?.aborted) {
      // Dispose anything we already built before bailing
      for (const f of frames) f.texture.dispose();
      throw new DOMException("aborted", "AbortError");
    }
    const date = dates[i];
    const canvas = await loadGibsComposite(
      layer,
      date,
      zoom,
      signal,
      undefined,           // suppress per-tile progress; report per-frame instead
      fallbackBackground
    );
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.flipY = true;
    tex.needsUpdate = true;
    frames.push({ date, texture: tex });
    onProgress?.(i + 1, dates.length);
  }

  return frames;
}

export function disposeFrames(frames: TimelapseFrame[]) {
  for (const f of frames) f.texture.dispose();
}

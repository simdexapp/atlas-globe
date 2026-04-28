// Real-time weather radar via RainViewer's public tile cache.
// CORS: api.rainviewer.com + tilecache.rainviewer.com both serve `*`.
// Tiles are EPSG:3857 (Web Mercator) — the consumer composites them into a
// square mercator canvas, then a custom sphere-shader remaps to lat/lon
// so they overlay the equirectangular Earth correctly.

const MANIFEST_URL = "https://api.rainviewer.com/public/weather-maps.json";

export type RadarFrame = {
  time: number;       // unix seconds
  path: string;       // e.g. "/v2/radar/2d47621552b0"
};

export type RadarManifest = {
  host: string;       // "https://tilecache.rainviewer.com"
  past: RadarFrame[]; // ~12 entries, 10 min apart, oldest → newest
  nowcast: RadarFrame[]; // forecasts (omit by default — less reliable)
};

export async function fetchRadarManifest(signal?: AbortSignal): Promise<RadarManifest> {
  const res = await fetch(MANIFEST_URL, { signal, cache: "no-store" });
  if (!res.ok) throw new Error(`RainViewer manifest ${res.status}`);
  const json = await res.json();
  return {
    host: json.host || "https://tilecache.rainviewer.com",
    past: (json.radar?.past || []) as RadarFrame[],
    nowcast: (json.radar?.nowcast || []) as RadarFrame[],
  };
}

const TILE_SIZE = 256;
const COLOR_SCHEME = 4;     // 4 = "rainbow" — most readable globally
const OPTIONS = "1_1";      // smoothing on, snow on

function loadImage(url: string, signal?: AbortSignal, timeoutMs = 6000): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    let settled = false;
    let timer: number | null = null;
    const onAbort = () => {
      if (settled) return;
      settled = true;
      if (timer !== null) clearTimeout(timer);
      img.src = "";
      reject(new DOMException("aborted", "AbortError"));
    };
    img.onload = () => {
      if (settled) return;
      settled = true;
      if (timer !== null) clearTimeout(timer);
      signal?.removeEventListener?.("abort", onAbort);
      resolve(img);
    };
    img.onerror = () => {
      if (settled) return;
      settled = true;
      if (timer !== null) clearTimeout(timer);
      signal?.removeEventListener?.("abort", onAbort);
      // Treat tile errors as transparent — common over oceans where there's no radar
      const empty = new Image();
      empty.width = TILE_SIZE;
      empty.height = TILE_SIZE;
      resolve(empty);
    };
    if (signal) {
      if (signal.aborted) { onAbort(); return; }
      signal.addEventListener("abort", onAbort, { once: true });
    }
    timer = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      img.src = "";
      signal?.removeEventListener?.("abort", onAbort);
      // Same fallback: empty/transparent
      const empty = new Image();
      empty.width = TILE_SIZE;
      empty.height = TILE_SIZE;
      resolve(empty);
    }, timeoutMs);
    img.src = url;
  });
}

// Compose a mercator-projected canvas by fetching all tiles at the given zoom.
// At zoom z there are 2^z tiles in each dimension → (2^z * 256) square canvas.
export async function composeRadarFrame(
  manifest: RadarManifest,
  frame: RadarFrame,
  zoom: number,
  signal?: AbortSignal,
  onProgress?: (loaded: number, total: number) => void
): Promise<HTMLCanvasElement> {
  const tilesPerSide = Math.pow(2, zoom);
  const W = tilesPerSide * TILE_SIZE;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = W;
  const ctxOrNull = canvas.getContext("2d");
  if (!ctxOrNull) throw new Error("Could not get 2D context");
  const ctx: CanvasRenderingContext2D = ctxOrNull;

  let loaded = 0;
  const total = tilesPerSide * tilesPerSide;
  const queue: { x: number; y: number }[] = [];
  for (let y = 0; y < tilesPerSide; y++) {
    for (let x = 0; x < tilesPerSide; x++) queue.push({ x, y });
  }

  const CONCURRENCY = 6;
  async function worker() {
    while (queue.length > 0) {
      if (signal?.aborted) return;
      const { x, y } = queue.shift()!;
      const url = `${manifest.host}${frame.path}/${TILE_SIZE}/${zoom}/${x}/${y}/${COLOR_SCHEME}/${OPTIONS}.png`;
      try {
        const img = await loadImage(url, signal);
        if (signal?.aborted) return;
        ctx.drawImage(img, x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
      } catch {
        // already swallowed in loadImage's empty fallback; nothing to do
      }
      loaded += 1;
      onProgress?.(loaded, total);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  return canvas;
}

export function frameLabel(frame: RadarFrame): string {
  const d = new Date(frame.time * 1000);
  const hh = d.getUTCHours().toString().padStart(2, "0");
  const mm = d.getUTCMinutes().toString().padStart(2, "0");
  return `${hh}:${mm} UTC`;
}

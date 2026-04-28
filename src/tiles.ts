// NASA GIBS WMTS tile streaming → composited HTML canvas (used as Earth texture)
// Public, no API key required. https://earthdata.nasa.gov/eosdis/science-system-description/eosdis-components/gibs

const GIBS_BASE = "https://gibs.earthdata.nasa.gov/wmts/epsg4326/best";

export type GibsLayer = {
  id: string;
  apiId: string;            // GIBS layer identifier
  name: string;
  format: "jpg" | "png";
  matrixSet: string;        // tile-matrix-set name (e.g. "250m", "500m", "1km")
  hasTime: boolean;         // whether this layer has time dimension
  earliestDate?: string;    // earliest YYYY-MM-DD available
  description: string;
  swap?: "day" | "night";   // suggests whether this should replace day or night texture
};

export const GIBS_LAYERS: Record<string, GibsLayer> = {
  viirsTrueColor: {
    id: "viirsTrueColor",
    apiId: "VIIRS_SNPP_CorrectedReflectance_TrueColor",
    name: "VIIRS true-color (recommended)",
    format: "jpg",
    matrixSet: "250m",
    hasTime: true,
    earliestDate: "2015-11-24",
    description: "Daily natural-color from VIIRS SNPP — fewer swath gaps than MODIS",
    swap: "day"
  },
  modisTrueColor: {
    id: "modisTrueColor",
    apiId: "MODIS_Terra_CorrectedReflectance_TrueColor",
    name: "MODIS Terra true-color (has swath gaps)",
    format: "jpg",
    matrixSet: "250m",
    hasTime: true,
    earliestDate: "2000-02-24",
    description: "Daily natural-color from NASA Terra/MODIS — note daily orbits leave visible gaps",
    swap: "day"
  },
  blueMarble: {
    id: "blueMarble",
    apiId: "BlueMarble_NextGeneration",
    name: "Blue Marble (static)",
    format: "jpg",
    matrixSet: "500m",
    hasTime: false,
    description: "Classic NASA Blue Marble (no clouds, static)",
    swap: "day"
  },
  blackMarble: {
    id: "blackMarble",
    apiId: "VIIRS_Black_Marble",
    name: "Black Marble (night lights)",
    format: "png",
    matrixSet: "500m",
    hasTime: true,
    earliestDate: "2012-04-03",
    description: "City lights from VIIRS Day/Night Band",
    swap: "night"
  },
  modisAerosol: {
    id: "modisAerosol",
    apiId: "MODIS_Terra_Aerosol",
    name: "MODIS Terra aerosol",
    format: "png",
    matrixSet: "2km",
    hasTime: true,
    description: "Atmospheric aerosol optical depth"
  },
  modisSnowCover: {
    id: "modisSnowCover",
    apiId: "MODIS_Terra_NDSI_Snow_Cover",
    name: "MODIS snow cover",
    format: "png",
    matrixSet: "500m",
    hasTime: true,
    description: "Daily snow & ice coverage"
  },
  modisFires: {
    id: "modisFires",
    apiId: "MODIS_Fires_All",
    name: "MODIS active fires",
    format: "png",
    matrixSet: "1km",
    hasTime: true,
    description: "Active fire detections from MODIS Aqua + Terra"
  },
  seaIce: {
    id: "seaIce",
    apiId: "AMSR2_Sea_Ice_Concentration_12km",
    name: "Sea ice concentration",
    format: "png",
    matrixSet: "2km",
    hasTime: true,
    description: "AMSR2 12km sea-ice concentration"
  }
};

// Default to Blue Marble: gap-free, gorgeous, classic. MODIS Terra is opt-in
// because it has visible satellite-swath gaps in the data.
export const DEFAULT_GIBS_DAY = "blueMarble";
export const DEFAULT_GIBS_NIGHT = "blackMarble";

const TILE_SIZE = 256;

export function todayUTC(): string {
  const d = new Date();
  // GIBS sometimes publishes today's data many hours late and recent days have
  // partial coverage. 2 days back has the most reliable global coverage.
  d.setUTCDate(d.getUTCDate() - 2);
  return d.toISOString().slice(0, 10);
}

export type TileLoadProgress = (loaded: number, total: number) => void;

export async function loadGibsComposite(
  layer: GibsLayer,
  date: string,
  zoom: number,
  signal?: AbortSignal,
  onProgress?: TileLoadProgress,
  fallbackBackground?: HTMLImageElement | HTMLCanvasElement
): Promise<HTMLCanvasElement> {
  const tilesY = Math.pow(2, zoom);
  const tilesX = tilesY * 2; // EPSG:4326 is 2:1 (lon range 360, lat range 180)
  const W = tilesX * TILE_SIZE;
  const H = tilesY * TILE_SIZE;

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctxOrNull = canvas.getContext("2d");
  if (!ctxOrNull) throw new Error("Could not get 2D context");
  const ctx: CanvasRenderingContext2D = ctxOrNull;

  // Background: pre-draw the bundled Blue Marble (or whatever fallback was passed) so
  // tiles that fail to load don't leave black gaps — they show the bundled texture instead.
  // We then draw tiles with composite="lighten" so MODIS swath gaps (which arrive as
  // black/empty pixels in successful tiles) ALSO fall through to the bundled background.
  const useLighten = !!fallbackBackground && layer.format === "jpg";
  if (fallbackBackground) {
    try { ctx.drawImage(fallbackBackground, 0, 0, W, H); } catch { /* draw fail safe */ }
  } else if (layer.format === "jpg") {
    ctx.fillStyle = "#0a1424";
    ctx.fillRect(0, 0, W, H);
  }

  let loaded = 0;
  const total = tilesX * tilesY;
  const queue: { x: number; y: number }[] = [];
  for (let y = 0; y < tilesY; y++) {
    for (let x = 0; x < tilesX; x++) {
      queue.push({ x, y });
    }
  }

  // Concurrency tuned for snappy zoom=3 loads (~128 tiles).
  // 16 parallel keeps it well under typical 6/8 per-domain browser caps but
  // GIBS uses sharded subdomains via WMTS so it scales fine.
  const CONCURRENCY = 16;

  async function worker() {
    while (queue.length > 0) {
      if (signal?.aborted) return;
      const { x, y } = queue.shift()!;
      const url = layer.hasTime
        ? `${GIBS_BASE}/${layer.apiId}/default/${date}/${layer.matrixSet}/${zoom}/${y}/${x}.${layer.format}`
        : `${GIBS_BASE}/${layer.apiId}/default/${layer.matrixSet}/${zoom}/${y}/${x}.${layer.format}`;
      try {
        const img = await loadImage(url, signal);
        if (signal?.aborted) return;
        const prevOp = ctx.globalCompositeOperation;
        if (useLighten) ctx.globalCompositeOperation = "lighten";
        ctx.drawImage(img, x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
        ctx.globalCompositeOperation = prevOp;
      } catch {
        // missing tile or net error — leave the background fill
      }
      loaded += 1;
      onProgress?.(loaded, total);
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

  return canvas;
}

function loadImage(url: string, signal?: AbortSignal): Promise<HTMLImageElement> {
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
      reject(new Error(`Failed to load ${url}`));
    };
    if (signal) {
      if (signal.aborted) { onAbort(); return; }
      signal.addEventListener("abort", onAbort, { once: true });
    }
    // Hard timeout — NASA tiles sometimes hang; never let one tile stall the whole composite.
    timer = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      img.src = "";
      signal?.removeEventListener?.("abort", onAbort);
      reject(new Error(`Timeout: ${url}`));
    }, 5000);
    img.src = url;
  });
}

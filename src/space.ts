// NOAA SWPC space-weather feeds.
// CORS friendly (access-control-allow-origin: *).
//   /products/noaa-planetary-k-index.json   geomagnetic Kp (3hr cadence)
//   /products/solar-wind/plasma-1-day.json  solar wind speed/density (1min cadence)
//   /json/ovation_aurora_latest.json        aurora visibility heatmap (1° grid)

const KP_URL = "https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json";
const SW_URL = "https://services.swpc.noaa.gov/products/solar-wind/plasma-1-day.json";
const AURORA_URL = "https://services.swpc.noaa.gov/json/ovation_aurora_latest.json";

export type SpaceWeather = {
  kpLatest: number;          // most recent Kp (0..9 scale, higher = more active)
  kpAt: number;              // unix ms of latest Kp reading
  swSpeedKmS: number;        // most recent solar wind speed (km/s)
  swDensityCm3: number;      // most recent solar wind density (proton/cm^3)
  swAt: number;              // unix ms of latest solar wind reading
  fetchedAt: number;
};

export type AuroraSnapshot = {
  observationTime: number;   // unix ms
  forecastTime: number;      // unix ms
  // Per-pixel aurora intensity in a (360 x 181) equirectangular grid.
  // grid[y * 360 + x] where x is lon (0..359, 0=180W convention from NOAA),
  // y is lat (0..180, 0=90S, 180=90N). Values 0..100 (clipped).
  grid: Uint8Array;
  width: number;
  height: number;
};

export async function fetchSpaceWeather(signal?: AbortSignal): Promise<SpaceWeather> {
  const [kpRes, swRes] = await Promise.all([
    fetch(KP_URL, { signal, cache: "no-store" }),
    fetch(SW_URL, { signal, cache: "no-store" }),
  ]);
  if (!kpRes.ok) throw new Error(`Kp ${kpRes.status}`);
  if (!swRes.ok) throw new Error(`SW ${swRes.status}`);
  const kpJson = await kpRes.json();
  const swJson = await swRes.json();
  // Kp shape: [{ time_tag, Kp, a_running, station_count }, ...]
  const kpLast = Array.isArray(kpJson) && kpJson.length > 0 ? kpJson[kpJson.length - 1] : null;
  // SW shape: [["time_tag","density","speed","temperature"], ["...", "2.86", "471.9", ...], ...]
  let swLast: any = null;
  if (Array.isArray(swJson) && swJson.length > 1) {
    // Walk back to find a row with valid speed (occasional gaps near the end)
    for (let i = swJson.length - 1; i >= 1; i--) {
      const row = swJson[i];
      if (row && row[2] !== "" && row[2] !== null) { swLast = row; break; }
    }
  }
  return {
    kpLatest: kpLast ? parseFloat(kpLast.Kp) || 0 : 0,
    kpAt: kpLast ? new Date(kpLast.time_tag + "Z").getTime() : Date.now(),
    swSpeedKmS: swLast ? parseFloat(swLast[2]) || 0 : 0,
    swDensityCm3: swLast ? parseFloat(swLast[1]) || 0 : 0,
    swAt: swLast ? new Date(swLast[0].replace(" ", "T") + "Z").getTime() : Date.now(),
    fetchedAt: Date.now(),
  };
}

export async function fetchAuroraSnapshot(signal?: AbortSignal): Promise<AuroraSnapshot> {
  const res = await fetch(AURORA_URL, { signal, cache: "no-store" });
  if (!res.ok) throw new Error(`Aurora ${res.status}`);
  const json = await res.json();
  const coords = (json.coordinates || []) as Array<[number, number, number]>;
  const W = 360;
  const H = 181;
  const grid = new Uint8Array(W * H);
  for (const [lon, lat, value] of coords) {
    const x = ((lon % 360) + 360) % 360;
    const y = lat + 90;  // -90..90 → 0..180
    if (x >= 0 && x < W && y >= 0 && y < H) {
      grid[y * W + x] = Math.min(100, Math.max(0, Math.round(value)));
    }
  }
  return {
    observationTime: new Date(json["Observation Time"]).getTime(),
    forecastTime: new Date(json["Forecast Time"]).getTime(),
    grid,
    width: W,
    height: H,
  };
}

// Map an aurora intensity 0..100 → an RGBA pixel of the overlay texture.
// Low intensity is fully transparent; mid intensity glows green; high turns
// pink/red as in real auroral displays.
export function auroraIntensityToRGBA(v: number): [number, number, number, number] {
  if (v < 4) return [0, 0, 0, 0];
  const t = Math.min(1, v / 100);
  const alpha = Math.min(255, Math.round(t * 220));
  if (t < 0.4) {
    // green
    const k = t / 0.4;
    return [Math.round(60 * k), Math.round(180 + 60 * k), Math.round(120 + 80 * k), alpha];
  }
  if (t < 0.75) {
    // green → pink
    const k = (t - 0.4) / 0.35;
    return [Math.round(60 + 200 * k), Math.round(240 - 110 * k), Math.round(200 - 80 * k), alpha];
  }
  // bright pink-red top
  const k = (t - 0.75) / 0.25;
  return [Math.round(255), Math.round(130 - 90 * k), Math.round(120 - 50 * k), alpha];
}

export function kpScale(kp: number): { label: string; severity: "quiet" | "unsettled" | "active" | "storm" } {
  if (kp < 4)  return { label: "Quiet",      severity: "quiet"     };
  if (kp < 5)  return { label: "Unsettled",  severity: "unsettled" };
  if (kp < 7)  return { label: "Active",     severity: "active"    };
  return         { label: "Geomagnetic Storm", severity: "storm"  };
}

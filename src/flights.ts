// Real-time global aircraft tracking.
//
// OpenSky's /api/states/all sets `Access-Control-Allow-Origin: https://opensky-network.org`
// which blocks any third-party site from reading the response. So we use the
// CORS-friendly community feeders instead. airplanes.live exposes a
// /v2/point/{lat}/{lon}/{dist_nm} endpoint with `access-control-allow-origin: *`.
//
// A single point=(0,0), dist=10000nm sweep returns ~7000 aircraft worldwide,
// covering effectively all current ADS-B-equipped traffic from this network.

const PRIMARY_URL = "https://api.airplanes.live/v2/point/0/0/10000";

export type Aircraft = {
  icao24: string;
  callsign: string;
  country: string;        // registration country (best-effort from `r` prefix)
  registration: string;   // tail number (e.g. "N12345")
  type: string;           // aircraft type code (e.g. "B738")
  category: string;       // ADS-B emitter category
  lon: number;
  lat: number;
  altitudeM: number;       // geo altitude in meters above sea level
  velocityMs: number;      // ground speed
  headingDeg: number;      // 0..360, true track
  verticalRateMs: number;  // positive = climbing
  onGround: boolean;
  squawk: string;
  lastContact: number;     // unix seconds
};

export type FlightSnapshot = {
  source: "airplanes.live";
  fetchedAt: number;       // unix ms
  aircraft: Aircraft[];
};

function parseAircraftJson(json: any): Aircraft[] {
  const list = json?.ac;
  if (!Array.isArray(list)) return [];
  const out: Aircraft[] = [];
  const nowSec = Math.floor(Date.now() / 1000);
  for (const a of list) {
    const lon = typeof a.lon === "number" ? a.lon : null;
    const lat = typeof a.lat === "number" ? a.lat : null;
    if (lon === null || lat === null) continue;
    // Altitudes from this feed are feet, sometimes the literal "ground"
    const onGround = a.alt_baro === "ground" || a.alt_geom === "ground";
    const altFt =
      typeof a.alt_geom === "number" ? a.alt_geom :
      typeof a.alt_baro === "number" ? a.alt_baro : 0;
    const altitudeM = altFt * 0.3048;
    const gsKt = typeof a.gs === "number" ? a.gs : 0;
    out.push({
      icao24: typeof a.hex === "string" ? a.hex : "",
      callsign: typeof a.flight === "string" ? a.flight.trim() : "",
      country: typeof a.country === "string" ? a.country : "",
      registration: typeof a.r === "string" ? a.r : "",
      type: typeof a.t === "string" ? a.t : "",
      category: typeof a.category === "string" ? a.category : "",
      lon,
      lat,
      altitudeM,
      velocityMs: gsKt * 0.514444,
      headingDeg: typeof a.track === "number" ? a.track :
                  typeof a.true_heading === "number" ? a.true_heading : 0,
      verticalRateMs: typeof a.baro_rate === "number" ? a.baro_rate * 0.00508 : 0,
      onGround,
      squawk: typeof a.squawk === "string" ? a.squawk : "",
      lastContact: typeof a.seen === "number" ? Math.floor(nowSec - a.seen) : nowSec,
    });
  }
  return out;
}

export async function fetchAllAircraft(signal?: AbortSignal): Promise<FlightSnapshot> {
  const res = await fetch(PRIMARY_URL, { signal, cache: "no-store" });
  if (!res.ok) throw new Error(`airplanes.live ${res.status}`);
  const json = await res.json();
  const aircraft = parseAircraftJson(json);
  return { source: "airplanes.live", fetchedAt: Date.now(), aircraft };
}

// Color an aircraft instance by altitude (meters → THREE-friendly hex string).
// Low = warm orange, mid = teal, high = bright cyan/white.
export function altitudeColor(altitudeM: number): [number, number, number] {
  if (altitudeM <= 0) return [0.95, 0.55, 0.25];      // ground / unknown — orange
  const ftAlt = altitudeM / 0.3048;
  // 0–10000 ft: orange→yellow
  // 10000–30000: yellow→teal
  // 30000–45000: teal→cyan
  // >45000: white
  if (ftAlt < 10000) {
    const t = ftAlt / 10000;
    return [1.0, 0.55 + 0.4 * t, 0.25 + 0.2 * t];
  }
  if (ftAlt < 30000) {
    const t = (ftAlt - 10000) / 20000;
    return [1.0 - 0.7 * t, 0.95 - 0.25 * t, 0.45 + 0.45 * t];
  }
  if (ftAlt < 45000) {
    const t = (ftAlt - 30000) / 15000;
    return [0.3 + 0.4 * t, 0.7 + 0.25 * t, 0.9 + 0.1 * t];
  }
  return [0.9, 0.95, 1.0];
}

export function altitudeFt(altitudeM: number): number {
  return Math.round(altitudeM / 0.3048);
}

export function knotsFromMs(ms: number): number {
  return Math.round(ms * 1.94384);
}

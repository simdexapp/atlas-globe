// Real-time global aircraft tracking via the OpenSky Network public API.
// /api/states/all returns every ADS-B aircraft seen in the last ~10s worldwide.
// Anonymous polling is rate-limited to one request per ~10s.
// https://opensky-network.org/apidoc/rest.html#all-state-vectors

const OPENSKY_URL = "https://opensky-network.org/api/states/all";

// Public mirror falls back if OpenSky is overloaded (returns 429/503).
const ADSB_FALLBACK = "https://api.adsb.lol/v2/all";

export type Aircraft = {
  icao24: string;
  callsign: string;
  country: string;
  lon: number;
  lat: number;
  altitudeM: number;       // geo altitude in meters above sea level
  velocityMs: number;      // ground speed
  headingDeg: number;      // 0..360, true track
  verticalRateMs: number;  // positive = climbing
  onGround: boolean;
  lastContact: number;     // unix seconds
};

export type FlightSnapshot = {
  source: "opensky" | "adsblol";
  fetchedAt: number;       // unix ms
  aircraft: Aircraft[];
};

function parseOpenSky(json: any): Aircraft[] {
  const states = json?.states;
  if (!Array.isArray(states)) return [];
  const out: Aircraft[] = [];
  for (const s of states) {
    const lon = s[5];
    const lat = s[6];
    if (typeof lon !== "number" || typeof lat !== "number") continue;
    const geoAlt = typeof s[13] === "number" ? s[13] : null;
    const baroAlt = typeof s[7] === "number" ? s[7] : null;
    const altitudeM = geoAlt ?? baroAlt ?? 0;
    const callsignRaw = typeof s[1] === "string" ? s[1].trim() : "";
    out.push({
      icao24: typeof s[0] === "string" ? s[0] : "",
      callsign: callsignRaw,
      country: typeof s[2] === "string" ? s[2] : "",
      lon,
      lat,
      altitudeM,
      velocityMs: typeof s[9] === "number" ? s[9] : 0,
      headingDeg: typeof s[10] === "number" ? s[10] : 0,
      verticalRateMs: typeof s[11] === "number" ? s[11] : 0,
      onGround: !!s[8],
      lastContact: typeof s[4] === "number" ? s[4] : 0,
    });
  }
  return out;
}

function parseAdsbLol(json: any): Aircraft[] {
  const list = json?.ac;
  if (!Array.isArray(list)) return [];
  const out: Aircraft[] = [];
  for (const a of list) {
    const lon = typeof a.lon === "number" ? a.lon : null;
    const lat = typeof a.lat === "number" ? a.lat : null;
    if (lon === null || lat === null) continue;
    // adsb.lol altitudes are in feet; convert to meters
    const altFt = typeof a.alt_geom === "number" ? a.alt_geom :
                   typeof a.alt_baro === "number" ? a.alt_baro : 0;
    const altitudeM = altFt * 0.3048;
    // ground speed in knots → m/s
    const gsKt = typeof a.gs === "number" ? a.gs : 0;
    const velocityMs = gsKt * 0.514444;
    out.push({
      icao24: typeof a.hex === "string" ? a.hex : "",
      callsign: typeof a.flight === "string" ? a.flight.trim() : "",
      country: typeof a.r === "string" ? a.r : "",
      lon,
      lat,
      altitudeM,
      velocityMs,
      headingDeg: typeof a.track === "number" ? a.track : 0,
      verticalRateMs: typeof a.baro_rate === "number" ? a.baro_rate * 0.00508 : 0,
      onGround: a.alt_baro === "ground",
      lastContact: a.seen ? Math.floor(Date.now() / 1000 - a.seen) : Math.floor(Date.now() / 1000),
    });
  }
  return out;
}

export async function fetchAllAircraft(signal?: AbortSignal): Promise<FlightSnapshot> {
  // Try OpenSky first
  try {
    const res = await fetch(OPENSKY_URL, { signal, cache: "no-store" });
    if (res.ok) {
      const json = await res.json();
      const aircraft = parseOpenSky(json);
      if (aircraft.length > 0) {
        return { source: "opensky", fetchedAt: Date.now(), aircraft };
      }
    }
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
  }
  // Fall back to adsb.lol
  const res = await fetch(ADSB_FALLBACK, { signal, cache: "no-store" });
  if (!res.ok) throw new Error(`adsb.lol ${res.status}`);
  const json = await res.json();
  const aircraft = parseAdsbLol(json);
  return { source: "adsblol", fetchedAt: Date.now(), aircraft };
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

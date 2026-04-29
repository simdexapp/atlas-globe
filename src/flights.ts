// Real-time global aircraft tracking.
//
// OpenSky's /api/states/all sets `Access-Control-Allow-Origin: https://opensky-network.org`
// which blocks third-party browsers from reading it directly. So we use the
// CORS-friendly community feeders instead.
//
// Both airplanes.live and adsb.fi run forks of the same readsb codebase and
// expose identical /v2/point/{lat}/{lon}/{dist_nm} JSON. We try them in
// order with a short timeout so one being down doesn't black out the layer.
// Community feeders also accept point=(0,0), dist=10000nm to return ~7000
// aircraft worldwide in a single request.

const FLIGHT_SOURCES: Array<{ name: FlightSource; url: string }> = [
  { name: "airplanes.live", url: "https://api.airplanes.live/v2/point/0/0/10000" },
  { name: "adsb.fi",        url: "https://opendata.adsb.fi/api/v2/lat/0/lon/0/dist/10000" },
];

// How long to wait on each source before falling through to the next.
const PER_SOURCE_TIMEOUT_MS = 8000;

export type FlightSource = "airplanes.live" | "adsb.fi";

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
  source: FlightSource;
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
  const errors: string[] = [];
  for (const src of FLIGHT_SOURCES) {
    // Per-source timeout via a child AbortController so one slow source
    // doesn't block fall-through to the next.
    const ctrl = new AbortController();
    const onParentAbort = () => ctrl.abort();
    signal?.addEventListener("abort", onParentAbort);
    const timer = window.setTimeout(() => ctrl.abort(), PER_SOURCE_TIMEOUT_MS);
    try {
      const res = await fetch(src.url, { signal: ctrl.signal, cache: "no-store" });
      if (!res.ok) {
        errors.push(`${src.name} ${res.status}`);
        continue;
      }
      const json = await res.json();
      const aircraft = parseAircraftJson(json);
      // adsb.fi sometimes returns a near-empty payload during partial outages
      // — treat <50 aircraft as a failure and move on so we don't downgrade
      // the user from 7000 → 20 planes silently.
      if (aircraft.length < 50) {
        errors.push(`${src.name} returned only ${aircraft.length} aircraft`);
        continue;
      }
      return { source: src.name, fetchedAt: Date.now(), aircraft };
    } catch (e) {
      if ((e as Error).name === "AbortError" && signal?.aborted) throw e;
      errors.push(`${src.name} ${(e as Error).message}`);
    } finally {
      window.clearTimeout(timer);
      signal?.removeEventListener("abort", onParentAbort);
    }
  }
  throw new Error(`All flight sources failed: ${errors.join(" · ")}`);
}

// ===== Per-aircraft enrichment via adsbdb.com (free, CORS=*) =====
// /v0/aircraft/{HEX} → manufacturer, model, registration, owner, country, photo
// /v0/callsign/{CALLSIGN} → airline + origin + destination airports

export type AircraftDetail = {
  manufacturer: string;        // "Airbus"
  model: string;               // "A321 211SL"
  icaoType: string;            // "A321"
  registration: string;        // "C-GEZX"
  owner: string;               // "Air Transat"
  ownerCountry: string;        // "Canada"
  photoUrl: string | null;     // small photo if available
};

export type Airport = {
  iata: string;                // "LAX"
  icao: string;                // "KLAX"
  name: string;                // "Los Angeles International Airport"
  city: string;                // "Los Angeles"
  country: string;             // "United States"
  lat: number;
  lon: number;
};

export type FlightRoute = {
  callsignIcao: string;
  callsignIata: string;
  airline: string;             // "United Airlines"
  airlineIata: string;
  airlineCallsign: string;     // "UNITED"
  origin: Airport | null;
  destination: Airport | null;
};

const aircraftDetailCache = new Map<string, AircraftDetail | null>();
const flightRouteCache = new Map<string, FlightRoute | null>();

export async function fetchAircraftDetail(icao24: string, signal?: AbortSignal): Promise<AircraftDetail | null> {
  const key = icao24.toUpperCase();
  if (aircraftDetailCache.has(key)) return aircraftDetailCache.get(key)!;
  try {
    const res = await fetch(`https://api.adsbdb.com/v0/aircraft/${key}`, { signal });
    if (!res.ok) {
      aircraftDetailCache.set(key, null);
      return null;
    }
    const json = await res.json();
    const a = json?.response?.aircraft;
    if (!a) {
      aircraftDetailCache.set(key, null);
      return null;
    }
    const detail: AircraftDetail = {
      manufacturer: a.manufacturer || "",
      model: a.type || "",
      icaoType: a.icao_type || "",
      registration: a.registration || "",
      owner: a.registered_owner || "",
      ownerCountry: a.registered_owner_country_name || "",
      photoUrl: a.url_photo_thumbnail || a.url_photo || null,
    };
    aircraftDetailCache.set(key, detail);
    return detail;
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    aircraftDetailCache.set(key, null);
    return null;
  }
}

export async function fetchFlightRoute(callsign: string, signal?: AbortSignal): Promise<FlightRoute | null> {
  const key = callsign.trim().toUpperCase();
  if (!key) return null;
  if (flightRouteCache.has(key)) return flightRouteCache.get(key)!;
  try {
    const res = await fetch(`https://api.adsbdb.com/v0/callsign/${key}`, { signal });
    if (!res.ok) {
      flightRouteCache.set(key, null);
      return null;
    }
    const json = await res.json();
    const r = json?.response?.flightroute;
    if (!r) {
      flightRouteCache.set(key, null);
      return null;
    }
    const buildAirport = (a: any): Airport | null => {
      if (!a) return null;
      return {
        iata: a.iata_code || "",
        icao: a.icao_code || "",
        name: a.name || "",
        city: a.municipality || "",
        country: a.country_name || "",
        lat: typeof a.latitude === "number" ? a.latitude : 0,
        lon: typeof a.longitude === "number" ? a.longitude : 0,
      };
    };
    const route: FlightRoute = {
      callsignIcao: r.callsign_icao || key,
      callsignIata: r.callsign_iata || "",
      airline: r.airline?.name || "",
      airlineIata: r.airline?.iata || "",
      airlineCallsign: r.airline?.callsign || "",
      origin: buildAirport(r.origin),
      destination: buildAirport(r.destination),
    };
    flightRouteCache.set(key, route);
    return route;
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    flightRouteCache.set(key, null);
    return null;
  }
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

// NASA NeoWS — near-Earth objects feed.
// CORS friendly. DEMO_KEY allows ~1000/hr globally; we cache for 60 min.
// https://api.nasa.gov/

const NEO_URL = "https://api.nasa.gov/neo/rest/v1/feed";

export type NearEarthObject = {
  id: string;
  name: string;
  diameterMin: number;       // km
  diameterMax: number;       // km
  hazard: boolean;           // potentially-hazardous flag
  approachDate: string;      // ISO8601
  missDistanceKm: number;
  velocityKmS: number;
  jplUrl: string;
};

let cache: { fetchedAt: number; data: NearEarthObject[] } | null = null;
const CACHE_MS = 60 * 60 * 1000;

export async function fetchNeoToday(signal?: AbortSignal): Promise<NearEarthObject[]> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_MS) return cache.data;
  const today = new Date().toISOString().slice(0, 10);
  const url = `${NEO_URL}?start_date=${today}&end_date=${today}&api_key=DEMO_KEY`;
  const res = await fetch(url, { signal, cache: "no-store" });
  if (!res.ok) throw new Error(`NeoWS ${res.status}`);
  const json = await res.json();
  const dayBucket = json?.near_earth_objects?.[today] || [];
  const out: NearEarthObject[] = [];
  for (const obj of dayBucket) {
    const ca = obj.close_approach_data?.[0];
    if (!ca) continue;
    out.push({
      id: obj.id,
      name: obj.name?.replace(/[()]/g, "").trim() || obj.id,
      diameterMin: obj.estimated_diameter?.kilometers?.estimated_diameter_min ?? 0,
      diameterMax: obj.estimated_diameter?.kilometers?.estimated_diameter_max ?? 0,
      hazard: !!obj.is_potentially_hazardous_asteroid,
      approachDate: ca.close_approach_date_full || ca.close_approach_date || "",
      missDistanceKm: parseFloat(ca.miss_distance?.kilometers || "0"),
      velocityKmS: parseFloat(ca.relative_velocity?.kilometers_per_second || "0"),
      jplUrl: obj.nasa_jpl_url || "",
    });
  }
  // Sort by closest approach first
  out.sort((a, b) => a.missDistanceKm - b.missDistanceKm);
  cache = { fetchedAt: Date.now(), data: out };
  return out;
}

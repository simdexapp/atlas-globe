// NASA EONET (Earth Observatory Natural Event Tracker) — open natural events
// worldwide: wildfires, severe storms, volcanoes, sea/lake ice, manmade
// emissions, dust/haze, snow, water-color anomalies.
// CORS: access-control-allow-origin: *
// https://eonet.gsfc.nasa.gov/api/v3

const EONET_URL = "https://eonet.gsfc.nasa.gov/api/v3/events";

export type EonetCategory =
  | "wildfires"
  | "severeStorms"
  | "volcanoes"
  | "seaLakeIce"
  | "earthquakes"
  | "drought"
  | "dustHaze"
  | "manmade"
  | "snow"
  | "tempExtremes"
  | "waterColor"
  | "floods"
  | "landslides";

export type EonetEvent = {
  id: string;
  title: string;
  category: EonetCategory;
  categoryTitle: string;
  lat: number;
  lon: number;
  date: number;          // unix ms (most recent geometry timestamp)
  magnitude: number | null;
  magnitudeUnit: string | null;
  link: string;
  sourceUrl: string | null;
};

const CATEGORY_MAP: Record<string, EonetCategory> = {
  wildfires: "wildfires",
  severeStorms: "severeStorms",
  volcanoes: "volcanoes",
  seaLakeIce: "seaLakeIce",
  earthquakes: "earthquakes",
  drought: "drought",
  dustHaze: "dustHaze",
  manmade: "manmade",
  snow: "snow",
  tempExtremes: "tempExtremes",
  waterColor: "waterColor",
  floods: "floods",
  landslides: "landslides",
};

export async function fetchEonetEvents(signal?: AbortSignal): Promise<EonetEvent[]> {
  const url = `${EONET_URL}?status=open&limit=200&days=30`;
  const res = await fetch(url, { signal, cache: "no-store" });
  if (!res.ok) throw new Error(`EONET ${res.status}`);
  const json = await res.json();
  const events = (json.events || []) as any[];
  const out: EonetEvent[] = [];
  for (const e of events) {
    const cat = e.categories?.[0];
    if (!cat) continue;
    // Use the most recent geometry — many storms have a track of multiple
    // points; we render the latest position only (rest could become a future
    // "track" feature).
    const geoms: any[] = e.geometry || [];
    if (geoms.length === 0) continue;
    let latest = geoms[0];
    for (const g of geoms) {
      if (new Date(g.date).getTime() > new Date(latest.date).getTime()) latest = g;
    }
    if (latest.type !== "Point") continue;
    const [lon, lat] = latest.coordinates;
    if (typeof lat !== "number" || typeof lon !== "number") continue;
    const cKey = CATEGORY_MAP[cat.id] || (cat.id as EonetCategory);
    out.push({
      id: e.id,
      title: e.title || "",
      category: cKey,
      categoryTitle: cat.title || cat.id,
      lat,
      lon,
      date: new Date(latest.date).getTime(),
      magnitude: typeof latest.magnitudeValue === "number" ? latest.magnitudeValue : null,
      magnitudeUnit: typeof latest.magnitudeUnit === "string" ? latest.magnitudeUnit : null,
      link: e.link || "",
      sourceUrl: e.sources?.[0]?.url || null,
    });
  }
  return out;
}

export function categoryColor(cat: EonetCategory): string {
  switch (cat) {
    case "wildfires":      return "#ff5a3c";
    case "severeStorms":   return "#a872ff";
    case "volcanoes":      return "#ff9d4d";
    case "seaLakeIce":     return "#7ee0ff";
    case "earthquakes":    return "#ffd66b";
    case "drought":        return "#cc8a3d";
    case "dustHaze":       return "#d4b673";
    case "manmade":        return "#9a9aaa";
    case "snow":           return "#e8eef5";
    case "tempExtremes":   return "#ff7a8a";
    case "waterColor":     return "#5cffb1";
    case "floods":         return "#5cb5ff";
    case "landslides":     return "#a0623c";
    default:               return "#cccccc";
  }
}

export function categoryIconLabel(cat: EonetCategory): string {
  switch (cat) {
    case "wildfires":      return "FIRE";
    case "severeStorms":   return "STRM";
    case "volcanoes":      return "VOLC";
    case "seaLakeIce":     return "ICE";
    case "earthquakes":    return "QUAKE";
    case "drought":        return "DRY";
    case "dustHaze":       return "DUST";
    case "manmade":        return "INDS";
    case "snow":           return "SNOW";
    case "tempExtremes":   return "TEMP";
    case "waterColor":     return "WATR";
    case "floods":         return "FLOOD";
    case "landslides":     return "SLIDE";
    default:               return "EVENT";
  }
}

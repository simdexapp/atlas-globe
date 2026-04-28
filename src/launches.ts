// The Space Devs — Launch Library 2 (LL2). Free, CORS-friendly.
// Use the lldev mirror for unauthenticated higher-throughput access.
// https://thespacedevs.com/llapi

const LAUNCH_URL = "https://lldev.thespacedevs.com/2.2.0/launch/upcoming/?limit=20&format=json";

export type RocketLaunch = {
  id: string;
  name: string;             // e.g. "Falcon Heavy | ViaSat-3 F3"
  rocket: string;           // configuration name e.g. "Falcon Heavy"
  status: string;           // "Go for Launch" / "Launch Successful" / etc.
  statusAbbrev: string;
  netUtc: string;           // ISO8601 net launch time
  netUnixMs: number;
  agency: string;
  padName: string;
  padLat: number;
  padLon: number;
  mission: string;          // mission description (may be long)
  url: string;              // LL2 detail URL
};

let cache: { fetchedAt: number; data: RocketLaunch[] } | null = null;
const CACHE_MS = 30 * 60 * 1000;     // 30 min

export async function fetchUpcomingLaunches(signal?: AbortSignal): Promise<RocketLaunch[]> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_MS) return cache.data;
  const res = await fetch(LAUNCH_URL, { signal, cache: "no-store" });
  if (!res.ok) throw new Error(`LL2 ${res.status}`);
  const json = await res.json();
  const out: RocketLaunch[] = [];
  for (const r of (json.results || []) as any[]) {
    const lat = parseFloat(r?.pad?.latitude ?? "");
    const lon = parseFloat(r?.pad?.longitude ?? "");
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const netMs = r?.net ? new Date(r.net).getTime() : 0;
    out.push({
      id: r.id || crypto.randomUUID(),
      name: r.name || "",
      rocket: r?.rocket?.configuration?.name || "",
      status: r?.status?.name || "",
      statusAbbrev: r?.status?.abbrev || "",
      netUtc: r.net || "",
      netUnixMs: netMs,
      agency: r?.launch_service_provider?.name || "",
      padName: r?.pad?.name || "",
      padLat: lat,
      padLon: lon,
      mission: r?.mission?.description || "",
      url: r?.url || "",
    });
  }
  // Sort by net time ascending
  out.sort((a, b) => a.netUnixMs - b.netUnixMs);
  cache = { fetchedAt: Date.now(), data: out };
  return out;
}

export function timeUntilLaunch(netMs: number): string {
  const diff = netMs - Date.now();
  if (diff < 0) return "in past";
  const min = Math.floor(diff / 60000);
  const hr  = Math.floor(min / 60);
  const day = Math.floor(hr / 24);
  if (day >= 2) return `T-${day}d ${hr % 24}h`;
  if (hr >= 2)  return `T-${hr}h ${min % 60}m`;
  if (min >= 2) return `T-${min}m`;
  const sec = Math.max(0, Math.floor(diff / 1000));
  return `T-${sec}s`;
}

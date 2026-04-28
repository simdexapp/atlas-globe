// Wikipedia REST summary endpoint. CORS=*. Free, no key.
// https://en.wikipedia.org/api/rest_v1/page/summary/{title}

const WIKI_URL = "https://en.wikipedia.org/api/rest_v1/page/summary/";

export type WikiSummary = {
  title: string;
  extract: string;          // plaintext summary, ~1-3 sentences
  thumbnail: string | null;
  pageUrl: string;
};

const cache = new Map<string, WikiSummary | null>();

export async function fetchWikiSummary(title: string, signal?: AbortSignal): Promise<WikiSummary | null> {
  const key = title.trim();
  if (!key) return null;
  if (cache.has(key)) return cache.get(key)!;
  try {
    const res = await fetch(`${WIKI_URL}${encodeURIComponent(key)}`, {
      signal,
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      cache.set(key, null);
      return null;
    }
    const j = await res.json();
    if (j.type === "disambiguation" || j.type === "no-extract") {
      cache.set(key, null);
      return null;
    }
    const out: WikiSummary = {
      title: j.title || key,
      extract: j.extract || "",
      thumbnail: j.thumbnail?.source || null,
      pageUrl: j.content_urls?.desktop?.page || `https://en.wikipedia.org/wiki/${encodeURIComponent(key)}`,
    };
    cache.set(key, out);
    return out;
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    cache.set(key, null);
    return null;
  }
}

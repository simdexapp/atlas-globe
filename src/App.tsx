import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import type { CSSProperties, ComponentType } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, Stars, useTexture } from "@react-three/drei";
import {
  Bookmark,
  BookmarkPlus,
  Camera,
  Cloud,
  Compass,
  Crosshair,
  Eye,
  Globe2,
  Layers,
  Maximize2,
  MousePointer2,
  Mountain,
  Navigation,
  Pause,
  Play,
  RotateCcw,
  Search,
  Share2,
  Sparkles,
  Sun as SunIcon,
  Square,
  Telescope,
  Trash2,
  Wand2,
  X
} from "lucide-react";
import * as THREE from "three";

const SurfaceMode = lazy(() => import("./Surface"));

type IconComponent = ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;
type Mode = "atlas" | "surface";
type InspectorTab = "globe" | "layers" | "bookmarks" | "data";
type RenderMode = "realistic" | "wireframe" | "blueprint";
type RecordingState = "idle" | "recording" | "encoding";

type Pin = {
  id: string;
  lat: number;
  lon: number;
  label: string;
  color: string;
  createdAt: number;
};

type Earthquake = {
  id: string;
  lat: number;
  lon: number;
  depth: number;
  mag: number;
  place: string;
  time: number;
};

type LayerVisibility = {
  clouds: boolean;
  atmosphere: boolean;
  stars: boolean;
  graticule: boolean;
  cardinals: boolean;
  nightLights: boolean;
  iss: boolean;
  borders: boolean;
  earthquakes: boolean;
  timezones: boolean;
  pins: boolean;
};

type GlobeSettings = {
  rotationSpeed: number;
  cloudOpacity: number;
  atmosphereIntensity: number;
  sunAzimuth: number;     // 0..1 → 0..360°
  sunElevation: number;   // 0..1 → -90..90°
  exposure: number;
  timeAnim: boolean;
  timeSpeed: number;
  realTimeSun: boolean;
  renderMode: RenderMode;
  highRes: boolean;
};

type Bookmark = {
  id: string;
  name: string;
  lat: number;
  lon: number;
  altKm: number;
  savedAt: number;
};

type CameraState = {
  lat: number;
  lon: number;
  altKm: number;
};

type FlyToTarget = {
  id: number;
  lat: number;
  lon: number;
  altKm: number;
};

type PersistedState = {
  layers: LayerVisibility;
  globe: GlobeSettings;
  bookmarks: Bookmark[];
  uiTheme: "dark" | "light";
};

const STORAGE_KEY = "atlas-globe-state-v1";
const EARTH_RADIUS_KM = 6371;
const MIN_DISTANCE = 1.05;          // ~333 km (just above surface)
const MAX_DISTANCE = 8;             // far view from space
const SPACE_DISTANCE = 2.6;          // default starting altitude

const defaultLayers: LayerVisibility = {
  clouds: true,
  atmosphere: true,
  stars: true,
  graticule: false,
  cardinals: true,
  nightLights: true,
  iss: false,
  borders: false,
  earthquakes: false,
  timezones: false,
  pins: true
};

const defaultGlobe: GlobeSettings = {
  rotationSpeed: 0.05,
  cloudOpacity: 0.55,
  atmosphereIntensity: 0.85,
  sunAzimuth: 0.18,
  sunElevation: 0.6,
  exposure: 1,
  timeAnim: false,
  timeSpeed: 0.04,
  realTimeSun: false,
  renderMode: "realistic",
  highRes: false
};

const cityBookmarks: Bookmark[] = [
  { id: "tokyo", name: "Tokyo", lat: 35.6762, lon: 139.6503, altKm: 1500, savedAt: 0 },
  { id: "newyork", name: "New York", lat: 40.7128, lon: -74.006, altKm: 1500, savedAt: 0 },
  { id: "london", name: "London", lat: 51.5074, lon: -0.1278, altKm: 1500, savedAt: 0 },
  { id: "sydney", name: "Sydney", lat: -33.8688, lon: 151.2093, altKm: 1500, savedAt: 0 },
  { id: "rio", name: "Rio de Janeiro", lat: -22.9068, lon: -43.1729, altKm: 1500, savedAt: 0 },
  { id: "capetown", name: "Cape Town", lat: -33.9249, lon: 18.4241, altKm: 1500, savedAt: 0 },
  { id: "dubai", name: "Dubai", lat: 25.2048, lon: 55.2708, altKm: 1500, savedAt: 0 },
  { id: "san-francisco", name: "San Francisco", lat: 37.7749, lon: -122.4194, altKm: 1500, savedAt: 0 },
  { id: "everest", name: "Mt. Everest", lat: 27.9881, lon: 86.925, altKm: 800, savedAt: 0 },
  { id: "nile", name: "Nile Delta", lat: 30.8025, lon: 26.8206, altKm: 2200, savedAt: 0 }
];

const initialSearchSuggestions = cityBookmarks.map((c) => c.name);

const KEYBOARD_HINTS = [
  { keys: "R", desc: "Reset view" },
  { keys: "F", desc: "Open search" },
  { keys: "B", desc: "Bookmark current view" },
  { keys: "L", desc: "Toggle layers panel" },
  { keys: "T", desc: "Cycle UI theme" },
  { keys: "H", desc: "Hide / show UI" },
  { keys: "S", desc: "Switch to Surface mode" },
  { keys: "?", desc: "Show shortcuts" },
  { keys: "Drag", desc: "Orbit camera" },
  { keys: "Scroll", desc: "Zoom in / out" }
];

function App() {
  const [mode, setMode] = useState<Mode>("atlas");
  const [layers, setLayers] = useState<LayerVisibility>(defaultLayers);
  const [globe, setGlobe] = useState<GlobeSettings>(defaultGlobe);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>(cityBookmarks);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("globe");
  const [hideUi, setHideUi] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [uiTheme, setUiTheme] = useState<"dark" | "light">("dark");
  const [cameraState, setCameraState] = useState<CameraState>({ lat: 25, lon: 0, altKm: distanceToAltKm(SPACE_DISTANCE) });
  const [flyTo, setFlyTo] = useState<FlyToTarget>({ id: 0, lat: 0, lon: 0, altKm: 0 });
  const [toast, setToast] = useState<{ id: number; text: string } | null>(null);
  const [showFps, setShowFps] = useState(false);
  const [paused, setPaused] = useState(false);
  const [orbiting, setOrbiting] = useState(true);
  const [cesiumToken, setCesiumToken] = useState<string>("");
  const [issPosition, setIssPosition] = useState<{ lat: number; lon: number } | null>(null);
  const [searchResults, setSearchResults] = useState<Bookmark[]>([]);
  const [searching, setSearching] = useState(false);
  const [pins, setPins] = useState<Pin[]>([]);
  const [selectedPin, setSelectedPin] = useState<string | null>(null);
  const [earthquakes, setEarthquakes] = useState<Earthquake[]>([]);
  const [borders, setBorders] = useState<Float32Array | null>(null);
  const [bordersLoading, setBordersLoading] = useState(false);
  const [tourActive, setTourActive] = useState(false);
  const [recordingState, setRecordingState] = useState<RecordingState>("idle");
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [exportProgress] = useState<{ label: string; pct: number } | null>(null);
  const [showCoordInput, setShowCoordInput] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recorderChunksRef = useRef<Blob[]>([]);
  const recorderTimerRef = useRef<number | null>(null);
  const recorderStartRef = useRef(0);
  const tourIntervalRef = useRef<number | null>(null);
  const tourIndexRef = useRef(0);
  const cameraStateRef = useRef<CameraState>({ lat: 25, lon: 0, altKm: SPACE_DISTANCE * EARTH_RADIUS_KM });
  const skipPersistRef = useRef(true);
  const uiHiddenRef = useRef(false);
  uiHiddenRef.current = hideUi;

  // Time-of-day auto-rotate sun
  useEffect(() => {
    if (!globe.timeAnim) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      setGlobe((g) => ({ ...g, sunAzimuth: (g.sunAzimuth + dt * g.timeSpeed) % 1 }));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [globe.timeAnim, globe.timeSpeed]);

  // ISS position polling
  useEffect(() => {
    if (!layers.iss) return;
    let cancelled = false;
    const fetchPos = async () => {
      try {
        const res = await fetch("https://api.wheretheiss.at/v1/satellites/25544");
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) {
          setIssPosition({ lat: data.latitude, lon: data.longitude });
        }
      } catch {
        // ignore
      }
    };
    fetchPos();
    const handle = window.setInterval(fetchPos, 5000);
    return () => { cancelled = true; window.clearInterval(handle); };
  }, [layers.iss]);

  // Persist
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const data = JSON.parse(raw) as Partial<PersistedState>;
        if (data.layers) setLayers({ ...defaultLayers, ...data.layers });
        if (data.globe) setGlobe({ ...defaultGlobe, ...data.globe });
        if (Array.isArray(data.bookmarks)) {
          // merge built-in with user-added (user's win on id collision)
          const ids = new Set(data.bookmarks.map((b) => b.id));
          setBookmarks([...data.bookmarks, ...cityBookmarks.filter((c) => !ids.has(c.id))]);
        }
        if (data.uiTheme) setUiTheme(data.uiTheme);
      }
    } catch {
      // ignore
    }
    try {
      const token = window.localStorage.getItem("cesium-token");
      if (token) setCesiumToken(token);
    } catch {}
    skipPersistRef.current = false;
  }, []);

  useEffect(() => {
    if (skipPersistRef.current) return;
    const payload: PersistedState = { layers, globe, bookmarks, uiTheme };
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload)); } catch {}
  }, [layers, globe, bookmarks, uiTheme]);

  const showToast = useCallback((text: string) => {
    setToast({ id: Date.now() + Math.random(), text });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const handle = window.setTimeout(() => setToast(null), 2400);
    return () => window.clearTimeout(handle);
  }, [toast]);

  const toggleLayer = useCallback((key: keyof LayerVisibility) => {
    setLayers((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const updateGlobe = useCallback((patch: Partial<GlobeSettings>) => {
    setGlobe((prev) => ({ ...prev, ...patch }));
  }, []);

  const resetView = useCallback(() => {
    setFlyTo((current) => ({ id: current.id + 1, lat: 25, lon: 0, altKm: distanceToAltKm(SPACE_DISTANCE) }));
    showToast("View reset");
  }, [showToast]);

  const flyToBookmark = useCallback((b: Bookmark) => {
    setFlyTo((current) => ({ id: current.id + 1, lat: b.lat, lon: b.lon, altKm: b.altKm }));
    showToast(`Flying to ${b.name}`);
  }, [showToast]);

  const saveCurrentBookmark = useCallback(() => {
    const name = window.prompt("Bookmark name:", `View at ${cameraState.lat.toFixed(2)}, ${cameraState.lon.toFixed(2)}`);
    if (!name) return;
    const b: Bookmark = {
      id: `bm-${Date.now()}`,
      name,
      lat: cameraState.lat,
      lon: cameraState.lon,
      altKm: cameraState.altKm,
      savedAt: Date.now()
    };
    setBookmarks((prev) => [b, ...prev]);
    showToast(`Saved: ${name}`);
  }, [cameraState, showToast]);

  const deleteBookmark = useCallback((id: string) => {
    setBookmarks((prev) => prev.filter((b) => b.id !== id));
  }, []);

  const filteredBookmarks = useMemo(() => {
    if (!searchQuery.trim()) return bookmarks;
    const q = searchQuery.toLowerCase();
    return bookmarks.filter((b) => b.name.toLowerCase().includes(q));
  }, [bookmarks, searchQuery]);

  // Nominatim geocoding (debounced)
  useEffect(() => {
    const q = searchQuery.trim();
    if (q.length < 3) { setSearchResults([]); setSearching(false); return; }
    setSearching(true);
    const handle = window.setTimeout(async () => {
      try {
        const res = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=8`, {
          headers: { Accept: "application/json" }
        });
        if (!res.ok) { setSearching(false); return; }
        const data = await res.json() as Array<{ place_id: number; lat: string; lon: string; display_name: string; type: string }>;
        const results: Bookmark[] = data.map((r) => ({
          id: `osm-${r.place_id}`,
          name: r.display_name.split(",").slice(0, 2).join(",").trim(),
          lat: Number(r.lat),
          lon: Number(r.lon),
          altKm: 1500,
          savedAt: 0
        }));
        setSearchResults(results);
      } catch {/* ignore */}
      finally { setSearching(false); }
    }, 280);
    return () => window.clearTimeout(handle);
  }, [searchQuery]);

  const combinedSearchResults = useMemo(() => {
    if (!searchQuery.trim()) return bookmarks;
    return [...filteredBookmarks, ...searchResults.filter((s) => !filteredBookmarks.some((b) => b.name === s.name))];
  }, [bookmarks, filteredBookmarks, searchQuery, searchResults]);

  const switchToSurface = useCallback(() => {
    if (!cesiumToken) {
      const token = window.prompt(
        "Cesium ion access token (free at cesium.com/ion):",
        ""
      );
      if (!token) return;
      window.localStorage.setItem("cesium-token", token);
      setCesiumToken(token);
    }
    setMode("surface");
    showToast("Switched to Surface mode");
  }, [cesiumToken, showToast]);

  const switchToAtlas = useCallback(() => {
    setMode("atlas");
    showToast("Atlas mode");
  }, [showToast]);

  const cycleTheme = useCallback(() => {
    setUiTheme((t) => (t === "dark" ? "light" : "dark"));
  }, []);

  const onCameraChange = useCallback((lat: number, lon: number, altKm: number) => {
    setCameraState({ lat, lon, altKm });
    cameraStateRef.current = { lat, lon, altKm };
  }, []);

  // Click-to-drop-pin
  const onGlobeClick = useCallback((lat: number, lon: number) => {
    const id = `pin-${Date.now()}`;
    const colorChoices = ["#5cb5ff", "#ffd66b", "#ff7be0", "#7cffb1", "#ff8a4d"];
    const color = colorChoices[Math.floor(Math.random() * colorChoices.length)];
    const pin: Pin = {
      id,
      lat,
      lon,
      label: `Pin ${pins.length + 1}`,
      color,
      createdAt: Date.now()
    };
    setPins((prev) => [...prev, pin]);
    setSelectedPin(id);
    showToast(`Pin dropped at ${formatLat(lat)} ${formatLon(lon)}`);
  }, [pins.length, showToast]);

  const deletePin = useCallback((id: string) => {
    setPins((prev) => prev.filter((p) => p.id !== id));
    if (selectedPin === id) setSelectedPin(null);
  }, [selectedPin]);

  const renamePin = useCallback((id: string, label: string) => {
    setPins((prev) => prev.map((p) => p.id === id ? { ...p, label } : p));
  }, []);

  const flyToPin = useCallback((p: Pin) => {
    setFlyTo((current) => ({ id: current.id + 1, lat: p.lat, lon: p.lon, altKm: 1500 }));
  }, []);

  // Earthquake feed (USGS, last 24h)
  useEffect(() => {
    if (!layers.earthquakes) return;
    let cancelled = false;
    const fetchQuakes = async () => {
      try {
        const res = await fetch("https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson");
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        const items: Earthquake[] = (data.features as Array<{ id: string; geometry: { coordinates: [number, number, number] }; properties: { mag: number; place: string; time: number } }>)
          .map((f) => ({
            id: f.id,
            lat: f.geometry.coordinates[1],
            lon: f.geometry.coordinates[0],
            depth: f.geometry.coordinates[2],
            mag: f.properties.mag,
            place: f.properties.place,
            time: f.properties.time
          }))
          .filter((q) => q.mag != null);
        setEarthquakes(items);
        showToast(`${items.length} earthquakes (24h)`);
      } catch {
        // ignore
      }
    };
    fetchQuakes();
    const handle = window.setInterval(fetchQuakes, 5 * 60 * 1000);
    return () => { cancelled = true; window.clearInterval(handle); };
  }, [layers.earthquakes, showToast]);

  // Country borders (lazy-load topojson)
  useEffect(() => {
    if (!layers.borders || borders) return;
    let cancelled = false;
    setBordersLoading(true);
    (async () => {
      try {
        const [{ feature }, atlasModule] = await Promise.all([
          import("topojson-client"),
          import("world-atlas/countries-50m.json").then((m) => m.default ?? m)
        ]);
        if (cancelled) return;
        const topo = atlasModule as any;
        const featureCollection = feature(topo, topo.objects.countries) as any;
        const positions: number[] = [];
        for (const f of featureCollection.features) {
          const geom = f.geometry;
          if (!geom) continue;
          const polys = geom.type === "Polygon" ? [geom.coordinates] : geom.type === "MultiPolygon" ? geom.coordinates : [];
          for (const poly of polys) {
            for (const ring of poly) {
              for (let i = 0; i < ring.length - 1; i++) {
                const [lon1, lat1] = ring[i];
                const [lon2, lat2] = ring[i + 1];
                const a = latLonToVec3(lat1, lon1, 1.002);
                const b = latLonToVec3(lat2, lon2, 1.002);
                positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
              }
            }
          }
        }
        setBorders(new Float32Array(positions));
      } catch (err) {
        showToast("Failed to load country borders");
      } finally {
        setBordersLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [layers.borders, borders, showToast]);

  // Real-time sun position
  useEffect(() => {
    if (!globe.realTimeSun) return;
    const update = () => {
      const { az, el } = solarPositionNow();
      setGlobe((prev) => ({ ...prev, sunAzimuth: az, sunElevation: el }));
    };
    update();
    const handle = window.setInterval(update, 60 * 1000);
    return () => window.clearInterval(handle);
  }, [globe.realTimeSun]);

  // Cinematic auto-tour
  useEffect(() => {
    if (!tourActive) return;
    const tourBookmarks = bookmarks.slice(0, 8);
    if (tourBookmarks.length < 2) return;
    tourIndexRef.current = 0;
    const advance = () => {
      const target = tourBookmarks[tourIndexRef.current % tourBookmarks.length];
      setFlyTo((current) => ({ id: current.id + 1, lat: target.lat, lon: target.lon, altKm: target.altKm }));
      tourIndexRef.current++;
    };
    advance();
    tourIntervalRef.current = window.setInterval(advance, 6000);
    return () => {
      if (tourIntervalRef.current) clearInterval(tourIntervalRef.current);
    };
  }, [tourActive, bookmarks]);

  // Capture frame at scale
  const captureAtScale = useCallback((scale: number) => {
    const canvas = document.querySelector(".globeLayer canvas") as HTMLCanvasElement | null;
    if (!canvas) {
      showToast("Canvas not ready");
      return;
    }
    if (scale === 1) {
      const dataUrl = canvas.toDataURL("image/png");
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = `atlas-${Date.now()}.png`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      showToast(`Captured ${canvas.width}×${canvas.height}`);
      return;
    }
    // Higher-res capture: temporarily rescale renderer
    const r3fState = (canvas as any).__r3f?.fiber?.root?.getState?.();
    if (!r3fState?.gl || !r3fState?.scene || !r3fState?.camera) {
      showToast("Hi-res capture unavailable, falling back to 1×");
      const dataUrl = canvas.toDataURL("image/png");
      const a = document.createElement("a"); a.href = dataUrl; a.download = `atlas-${Date.now()}.png`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      return;
    }
    const { gl, scene, camera, size } = r3fState;
    const oldRatio = gl.getPixelRatio();
    gl.setPixelRatio(scale * window.devicePixelRatio);
    gl.setSize(size.width, size.height, false);
    gl.render(scene, camera);
    const dataUrl = canvas.toDataURL("image/png");
    gl.setPixelRatio(oldRatio);
    gl.setSize(size.width, size.height, false);
    const a = document.createElement("a"); a.href = dataUrl; a.download = `atlas-${scale}x-${Date.now()}.png`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    showToast(`Captured at ${scale}×`);
  }, [showToast]);

  // WebM recording
  const startRecording = useCallback(() => {
    if (recordingState !== "idle") return;
    const canvas = document.querySelector(".globeLayer canvas") as HTMLCanvasElement | null;
    if (!canvas) { showToast("Canvas not ready"); return; }
    try {
      const stream = canvas.captureStream(30);
      let mime = "video/webm;codecs=vp9";
      if (!MediaRecorder.isTypeSupported(mime)) mime = "video/webm;codecs=vp8";
      if (!MediaRecorder.isTypeSupported(mime)) mime = "video/webm";
      const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8_000_000 });
      recorderChunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) recorderChunksRef.current.push(e.data); };
      recorder.onstop = () => {
        setRecordingState("encoding");
        const blob = new Blob(recorderChunksRef.current, { type: "video/webm" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a"); a.href = url; a.download = `atlas-${Date.now()}.webm`;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 500);
        recorderChunksRef.current = [];
        setRecordingState("idle");
        setRecordingSeconds(0);
        showToast("Recording saved");
      };
      recorder.start(500);
      recorderRef.current = recorder;
      recorderStartRef.current = performance.now();
      setRecordingState("recording");
      setRecordingSeconds(0);
      const tick = () => {
        setRecordingSeconds(Math.floor((performance.now() - recorderStartRef.current) / 1000));
        recorderTimerRef.current = window.setTimeout(tick, 500);
      };
      tick();
      showToast("Recording started");
    } catch {
      showToast("Recording failed to start");
    }
  }, [recordingState, showToast]);

  const stopRecording = useCallback(() => {
    if (recordingState !== "recording" || !recorderRef.current) return;
    recorderRef.current.stop();
    if (recorderTimerRef.current) clearTimeout(recorderTimerRef.current);
    recorderTimerRef.current = null;
  }, [recordingState]);

  useEffect(() => () => {
    recorderRef.current?.stop();
    if (recorderTimerRef.current) clearTimeout(recorderTimerRef.current);
  }, []);

  // Share URL with view encoded
  const copyShareWithView = useCallback(async () => {
    const c = cameraStateRef.current;
    const params = new URLSearchParams({
      lat: c.lat.toFixed(4),
      lon: c.lon.toFixed(4),
      alt: c.altKm.toFixed(0)
    });
    const url = `${window.location.origin}${window.location.pathname}#view=${params.toString()}`;
    try {
      await navigator.clipboard.writeText(url);
      window.history.replaceState(null, "", `#view=${params.toString()}`);
      showToast("View URL copied");
    } catch {
      showToast("Could not copy");
    }
  }, [showToast]);

  // Decode #view= on first load
  useEffect(() => {
    const hash = window.location.hash;
    if (!hash.startsWith("#view=")) return;
    try {
      const params = new URLSearchParams(hash.slice("#view=".length));
      const lat = Number(params.get("lat"));
      const lon = Number(params.get("lon"));
      const alt = Number(params.get("alt"));
      if (Number.isFinite(lat) && Number.isFinite(lon) && Number.isFinite(alt)) {
        setFlyTo((current) => ({ id: current.id + 1, lat, lon, altKm: alt }));
      }
    } catch {/* ignore */}
  }, []);

  const onCoordSubmit = useCallback((lat: number, lon: number, altKm: number) => {
    setFlyTo((current) => ({ id: current.id + 1, lat, lon, altKm }));
    setShowCoordInput(false);
    showToast(`Flying to ${formatLat(lat)} ${formatLon(lon)}`);
  }, [showToast]);

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
      if (event.metaKey || event.ctrlKey) return;

      switch (event.key.toLowerCase()) {
        case "escape":
          if (showSearch) setShowSearch(false);
          if (showShortcuts) setShowShortcuts(false);
          if (uiHiddenRef.current) setHideUi(false);
          break;
        case "r":
          event.preventDefault();
          resetView();
          break;
        case "f":
          event.preventDefault();
          setShowSearch((v) => !v);
          break;
        case "b":
          event.preventDefault();
          saveCurrentBookmark();
          break;
        case "l":
          event.preventDefault();
          setInspectorTab("layers");
          break;
        case "t":
          event.preventDefault();
          cycleTheme();
          break;
        case "h":
          event.preventDefault();
          setHideUi((v) => !v);
          break;
        case "s":
          event.preventDefault();
          if (mode === "atlas") switchToSurface();
          else switchToAtlas();
          break;
        case "?":
        case "/":
          if (event.shiftKey || event.key === "?") {
            event.preventDefault();
            setShowShortcuts((v) => !v);
          }
          break;
        default:
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cycleTheme, mode, resetView, saveCurrentBookmark, showSearch, showShortcuts, switchToAtlas, switchToSurface]);

  const rootStyle: CSSProperties = {
    "--accent": "#5cb5ff",
    "--accent-warm": "#ffd66b",
    "--accent-glow": "rgba(92, 181, 255, 0.22)"
  } as CSSProperties;

  return (
    <div className={`atlas${hideUi ? " hideUi" : ""} theme-${uiTheme}`} style={rootStyle}>
      <div className="globeLayer" aria-label="3D viewport">
        {mode === "atlas" ? (
          <GlobeCanvas
            globe={globe}
            layers={layers}
            paused={paused}
            orbiting={orbiting}
            flyTo={flyTo}
            issPosition={issPosition}
            pins={pins}
            earthquakes={earthquakes}
            borders={borders}
            selectedPinId={selectedPin}
            onSelectPin={setSelectedPin}
            onGlobeClick={onGlobeClick}
            onCameraChange={onCameraChange}
          />
        ) : (
          <Suspense fallback={<div className="surfaceLoading">Loading Surface mode (Cesium)…</div>}>
            <SurfaceMode token={cesiumToken} onCameraChange={onCameraChange} flyTo={flyTo} />
          </Suspense>
        )}
      </div>

      {showFps && <FpsOverlay />}

      <header className="atlasHeader">
        <div className="atlasIdentity">
          <span className="brandMark"><Globe2 size={18} /></span>
          <div>
            <h1>Atlas</h1>
            <span>{mode === "atlas" ? "Orbital view" : "Surface detail (Cesium)"}</span>
          </div>
        </div>

        <div className="modeStrip" aria-label="Mode">
          <button className={mode === "atlas" ? "active" : ""} type="button" onClick={switchToAtlas}>
            <Globe2 size={13} /> Atlas
          </button>
          <button className={mode === "surface" ? "active" : ""} type="button" onClick={switchToSurface}>
            <Mountain size={13} /> Surface
          </button>
        </div>

        <div className="searchTrigger">
          <button type="button" onClick={() => setShowSearch(true)}>
            <Search size={14} />
            <span>Search any place…</span>
            <kbd>F</kbd>
          </button>
        </div>

        <div className="topActions">
          <IconAction icon={RotateCcw} label="Reset view (R)" onClick={resetView} />
          <IconAction
            icon={paused ? Play : Pause}
            label={paused ? "Resume" : "Pause rotation"}
            onClick={() => setPaused((p) => !p)}
            active={!paused}
          />
          <IconAction
            icon={orbiting ? Pause : Play}
            label={orbiting ? "Stop auto-orbit" : "Start auto-orbit"}
            onClick={() => setOrbiting((o) => !o)}
            active={orbiting}
          />
          <IconAction icon={BookmarkPlus} label="Bookmark this view (B)" onClick={saveCurrentBookmark} />
          <IconAction icon={Camera} label="Capture frame (1×)" onClick={() => captureAtScale(1)} />
          <IconAction icon={recordingState === "recording" ? Square : Telescope} label={recordingState === "recording" ? "Stop recording" : "Start WebM recording"} onClick={recordingState === "recording" ? stopRecording : startRecording} active={recordingState === "recording"} />
          <IconAction icon={Globe2} label="Coordinate input" onClick={() => setShowCoordInput(true)} />
          <IconAction icon={tourActive ? Pause : Play} label={tourActive ? "Stop auto-tour" : "Start auto-tour"} onClick={() => setTourActive((v) => !v)} active={tourActive} />
          <IconAction icon={SunIcon} label="Cycle UI theme (T)" onClick={cycleTheme} />
          <IconAction icon={Share2} label="Copy share URL with view" onClick={copyShareWithView} />
        </div>
      </header>

      <aside className="atlasRail" aria-label="Tools">
        <RailButton icon={MousePointer2} label="Select" active />
        <RailButton icon={Search} label="Search (F)" onClick={() => setShowSearch(true)} />
        <RailButton icon={Layers} label="Layers (L)" active={inspectorTab === "layers"} onClick={() => setInspectorTab("layers")} />
        <RailButton icon={Bookmark} label="Bookmarks" active={inspectorTab === "bookmarks"} onClick={() => setInspectorTab("bookmarks")} />
        <RailButton icon={Globe2} label="Globe controls" active={inspectorTab === "globe"} onClick={() => setInspectorTab("globe")} />
        <RailButton icon={Crosshair} label="Reset view (R)" onClick={resetView} />
        <RailButton icon={Telescope} label="Show FPS" active={showFps} onClick={() => setShowFps((v) => !v)} />
        <RailButton icon={Maximize2} label="Hide UI (H)" active={hideUi} onClick={() => setHideUi((v) => !v)} />
      </aside>

      <div className="viewportStatus" aria-label="Viewport status">
        <div>
          <span className="dot" />
          <strong>{mode === "atlas" ? "Atlas" : "Surface"}</strong>
          <span>{paused ? "Paused" : "Live"}</span>
        </div>
        <div>
          <span>{formatLat(cameraState.lat)}</span>
          <span>{formatLon(cameraState.lon)}</span>
          <span>{formatAlt(cameraState.altKm)}</span>
        </div>
      </div>

      <aside className="atlasInspector" aria-label="Inspector">
        <div className="inspectorTabs">
          <button className={inspectorTab === "globe" ? "active" : ""} type="button" onClick={() => setInspectorTab("globe")}>Globe</button>
          <button className={inspectorTab === "layers" ? "active" : ""} type="button" onClick={() => setInspectorTab("layers")}>Layers</button>
          <button className={inspectorTab === "bookmarks" ? "active" : ""} type="button" onClick={() => setInspectorTab("bookmarks")}>Saved</button>
          <button className={inspectorTab === "data" ? "active" : ""} type="button" onClick={() => setInspectorTab("data")}>Data</button>
        </div>

        {inspectorTab === "globe" && (
          <GlobePanel globe={globe} onUpdate={updateGlobe} />
        )}
        {inspectorTab === "layers" && (
          <LayersPanel layers={layers} onToggle={toggleLayer} bordersLoading={bordersLoading} />
        )}
        {inspectorTab === "bookmarks" && (
          <BookmarksPanel
            bookmarks={filteredBookmarks}
            onSearch={setSearchQuery}
            search={searchQuery}
            onFly={flyToBookmark}
            onDelete={deleteBookmark}
            onAdd={saveCurrentBookmark}
          />
        )}
        {inspectorTab === "data" && (
          <DataPanel
            pins={pins}
            earthquakes={earthquakes}
            onSelectPin={(id) => setSelectedPin(id)}
            onFlyPin={flyToPin}
            onDeletePin={deletePin}
            onClearPins={() => setPins([])}
            onCapture={captureAtScale}
            onStartRecord={startRecording}
            onStopRecord={stopRecording}
            recordingState={recordingState}
            recordingSeconds={recordingSeconds}
            onCopyShare={copyShareWithView}
            onOpenCoord={() => setShowCoordInput(true)}
          />
        )}
      </aside>

      <footer className="atlasFooter" aria-label="Status bar">
        <div className="footerCoords">
          <Compass size={12} />
          <span>{formatLat(cameraState.lat)}</span>
          <span>{formatLon(cameraState.lon)}</span>
          <span>·</span>
          <span>Alt {formatAlt(cameraState.altKm)}</span>
        </div>
        <ScaleBar altKm={cameraState.altKm} />
        <div className="footerExtra">
          <span>Zoom L{Math.max(1, Math.min(18, Math.round(18 - Math.log2(Math.max(1, cameraState.altKm / 50)))))}</span>
          <button type="button" className="footerLink" onClick={() => setShowShortcuts(true)}>?</button>
        </div>
      </footer>

      {hideUi && (
        <button type="button" className="restoreUi" onClick={() => setHideUi(false)} title="Show UI (H or Esc)">
          <Eye size={13} /> Show UI
        </button>
      )}

      {showSearch && (
        <SearchModal
          query={searchQuery}
          onQuery={setSearchQuery}
          results={combinedSearchResults}
          searching={searching}
          suggestions={initialSearchSuggestions}
          onSelect={(b) => { flyToBookmark(b); setShowSearch(false); }}
          onClose={() => setShowSearch(false)}
        />
      )}

      {showShortcuts && <ShortcutsModal onClose={() => setShowShortcuts(false)} />}

      {showCoordInput && <CoordInputModal onSubmit={onCoordSubmit} onClose={() => setShowCoordInput(false)} />}

      {selectedPin && pins.find((p) => p.id === selectedPin) && (
        <PinInfoCard
          pin={pins.find((p) => p.id === selectedPin)!}
          onClose={() => setSelectedPin(null)}
          onDelete={(id) => deletePin(id)}
          onRename={(id, label) => renamePin(id, label)}
          onFly={flyToPin}
        />
      )}

      {recordingState === "recording" && (
        <div className="atlasRecordIndicator" role="status">
          <span className="atlasRecordDot" /> REC {formatSeconds(recordingSeconds)}
        </div>
      )}

      {exportProgress && (
        <div className="atlasExportProgress" role="status">
          <span>{exportProgress.label}</span>
          <div className="atlasExportProgressBar"><div style={{ width: `${exportProgress.pct * 100}%` }} /></div>
        </div>
      )}

      {pins.length > 0 && layers.pins && <PinsMiniList pins={pins} selectedId={selectedPin} onSelect={(id) => setSelectedPin(id)} onFly={flyToPin} onDelete={deletePin} />}

      {toast && (
        <div className="atlasToast" role="status" key={toast.id}>{toast.text}</div>
      )}
    </div>
  );
}

function IconAction({ icon: Icon, label, onClick, active }: { icon: IconComponent; label: string; onClick: () => void; active?: boolean }) {
  return (
    <button
      type="button"
      className={active ? "atlasIconBtn active" : "atlasIconBtn"}
      onClick={onClick}
      title={label}
      aria-label={label}
    >
      <Icon size={15} />
    </button>
  );
}

function RailButton({ icon: Icon, label, onClick, active }: { icon: IconComponent; label: string; onClick?: () => void; active?: boolean }) {
  return (
    <button
      type="button"
      className={active ? "atlasRailBtn active" : "atlasRailBtn"}
      onClick={onClick}
      title={label}
      aria-label={label}
    >
      <Icon size={17} />
    </button>
  );
}

function GlobePanel({ globe, onUpdate }: { globe: GlobeSettings; onUpdate: (patch: Partial<GlobeSettings>) => void }) {
  return (
    <>
      <PanelSection title="Rotation" icon={RotateCcw}>
        <Slider label="Spin speed" value={globe.rotationSpeed} min={0} max={1} onChange={(v) => onUpdate({ rotationSpeed: v })} />
      </PanelSection>

      <PanelSection title="Sun position" icon={SunIcon}>
        <Slider label="Azimuth" value={globe.sunAzimuth} min={0} max={1} onChange={(v) => onUpdate({ sunAzimuth: v })} suffix="°" formatter={(v) => Math.round(v * 360).toString()} />
        <Slider label="Elevation" value={globe.sunElevation} min={0} max={1} onChange={(v) => onUpdate({ sunElevation: v })} suffix="°" formatter={(v) => `${Math.round((v - 0.5) * 180)}`} />
        <label className="atlasLayerRow" style={{ marginTop: 4 }}>
          <Telescope size={13} />
          <span>Time of day animation</span>
          <input type="checkbox" checked={globe.timeAnim} onChange={(e) => onUpdate({ timeAnim: e.target.checked })} />
        </label>
        {globe.timeAnim && (
          <Slider label="Day speed" value={globe.timeSpeed} min={0.005} max={0.4} onChange={(v) => onUpdate({ timeSpeed: v })} formatter={(v) => `${(1 / Math.max(0.005, v)).toFixed(0)}s/day`} />
        )}
      </PanelSection>

      <PanelSection title="Atmosphere" icon={Sparkles}>
        <Slider label="Glow" value={globe.atmosphereIntensity} min={0} max={2} onChange={(v) => onUpdate({ atmosphereIntensity: v })} formatter={(v) => v.toFixed(2)} />
      </PanelSection>

      <PanelSection title="Clouds" icon={Cloud}>
        <Slider label="Opacity" value={globe.cloudOpacity} min={0} max={1} onChange={(v) => onUpdate({ cloudOpacity: v })} />
      </PanelSection>

      <PanelSection title="Render" icon={Camera}>
        <Slider label="Exposure" value={globe.exposure} min={0.4} max={2.2} onChange={(v) => onUpdate({ exposure: v })} formatter={(v) => v.toFixed(2)} />
        <div className="atlasModeRow">
          {(["realistic", "wireframe", "blueprint"] as const).map((mode) => (
            <button key={mode} type="button" className={globe.renderMode === mode ? "active" : ""} onClick={() => onUpdate({ renderMode: mode })}>{mode}</button>
          ))}
        </div>
        <label className="atlasLayerRow" style={{ marginTop: 4 }}>
          <Wand2 size={13} />
          <span>Real-time sun (UTC)</span>
          <input type="checkbox" checked={globe.realTimeSun} onChange={(e) => onUpdate({ realTimeSun: e.target.checked })} />
        </label>
      </PanelSection>
    </>
  );
}

function LayersPanel({ layers, onToggle, bordersLoading }: { layers: LayerVisibility; onToggle: (key: keyof LayerVisibility) => void; bordersLoading: boolean }) {
  const items: { key: keyof LayerVisibility; label: string; icon: IconComponent; suffix?: string }[] = [
    { key: "clouds", label: "Cloud cover", icon: Cloud },
    { key: "nightLights", label: "City lights (night side)", icon: SunIcon },
    { key: "atmosphere", label: "Atmosphere glow", icon: Sparkles },
    { key: "stars", label: "Background stars", icon: Sparkles },
    { key: "borders", label: "Country borders", icon: Compass, suffix: bordersLoading ? "(loading…)" : undefined },
    { key: "graticule", label: "Lat/lon graticule", icon: Compass },
    { key: "timezones", label: "Time-zone meridians", icon: Compass },
    { key: "cardinals", label: "Cardinal markers", icon: Navigation },
    { key: "pins", label: "Pin markers", icon: Bookmark },
    { key: "earthquakes", label: "Earthquakes (24h, USGS)", icon: Sparkles },
    { key: "iss", label: "Live ISS position", icon: Telescope }
  ];
  return (
    <PanelSection title="Visibility" icon={Layers}>
      <div className="atlasLayerList">
        {items.map(({ key, label, icon: Icon, suffix }) => (
          <label key={key} className="atlasLayerRow">
            <Icon size={13} />
            <span>{label}{suffix ? ` ${suffix}` : ""}</span>
            <input type="checkbox" checked={layers[key]} onChange={() => onToggle(key)} />
          </label>
        ))}
      </div>
    </PanelSection>
  );
}

function DataPanel({ pins, earthquakes, onSelectPin, onFlyPin, onDeletePin, onClearPins, onCapture, onStartRecord, onStopRecord, recordingState, recordingSeconds, onCopyShare, onOpenCoord }: {
  pins: Pin[];
  earthquakes: Earthquake[];
  onSelectPin: (id: string) => void;
  onFlyPin: (p: Pin) => void;
  onDeletePin: (id: string) => void;
  onClearPins: () => void;
  onCapture: (scale: number) => void;
  onStartRecord: () => void;
  onStopRecord: () => void;
  recordingState: RecordingState;
  recordingSeconds: number;
  onCopyShare: () => void;
  onOpenCoord: () => void;
}) {
  return (
    <>
      <PanelSection title={`Pins (${pins.length})`} icon={Bookmark}>
        {pins.length === 0 && <p className="atlasHint">Click anywhere on the globe to drop a pin.</p>}
        {pins.length > 0 && (
          <ul className="atlasBookmarkList">
            {pins.map((p) => (
              <li key={p.id}>
                <button type="button" className="atlasBookmarkRow" onClick={() => onSelectPin(p.id)}>
                  <span className="atlasPinDot" style={{ background: p.color }} />
                  <div>
                    <strong>{p.label}</strong>
                    <span>{formatLat(p.lat)}, {formatLon(p.lon)}</span>
                  </div>
                </button>
                <button type="button" className="atlasIconBtn" onClick={() => onFlyPin(p)} title="Fly to" aria-label="Fly to"><Navigation size={11} /></button>
                <button type="button" className="atlasIconBtn" onClick={() => onDeletePin(p.id)} title="Delete" aria-label="Delete"><Trash2 size={11} /></button>
              </li>
            ))}
          </ul>
        )}
        {pins.length > 0 && (
          <button type="button" className="atlasPrimaryBtn small" style={{ background: "transparent", color: "#ff8a8a" }} onClick={onClearPins}>
            <Trash2 size={12} /> Clear all pins
          </button>
        )}
      </PanelSection>

      <PanelSection title={`Earthquakes (${earthquakes.length})`} icon={Sparkles}>
        {earthquakes.length === 0 && <p className="atlasHint">Enable the Earthquakes layer to see USGS data from the last 24h.</p>}
        {earthquakes.length > 0 && (
          <ul className="atlasBookmarkList">
            {earthquakes.slice(0, 10).sort((a, b) => b.mag - a.mag).map((q) => (
              <li key={q.id}>
                <div className="atlasBookmarkRow" style={{ cursor: "default" }}>
                  <span className="atlasPinDot" style={{ background: q.mag >= 5 ? "#ff5a5a" : q.mag >= 3.5 ? "#ffb84d" : "#ffd66b" }} />
                  <div>
                    <strong>M{q.mag.toFixed(1)} · {q.place}</strong>
                    <span>{formatLat(q.lat)}, {formatLon(q.lon)} · depth {q.depth.toFixed(0)}km</span>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </PanelSection>

      <PanelSection title="Capture" icon={Camera}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <button type="button" className="atlasPrimaryBtn small" onClick={() => onCapture(1)}><Camera size={12} /> 1×</button>
          <button type="button" className="atlasPrimaryBtn small" onClick={() => onCapture(2)}><Camera size={12} /> 2×</button>
          <button type="button" className="atlasPrimaryBtn small" onClick={() => onCapture(4)}><Camera size={12} /> 4×</button>
        </div>
        {recordingState === "recording" ? (
          <button type="button" className="atlasPrimaryBtn small" style={{ background: "#ff4d5d", color: "#fff" }} onClick={onStopRecord}>
            <Square size={12} /> Stop recording ({formatSeconds(recordingSeconds)})
          </button>
        ) : (
          <button type="button" className="atlasPrimaryBtn small" onClick={onStartRecord} disabled={recordingState === "encoding"}>
            <Telescope size={12} /> {recordingState === "encoding" ? "Encoding…" : "Record WebM"}
          </button>
        )}
      </PanelSection>

      <PanelSection title="Tools" icon={Compass}>
        <button type="button" className="atlasPrimaryBtn small" onClick={onOpenCoord}><Navigation size={12} /> Fly to coordinates</button>
        <button type="button" className="atlasPrimaryBtn small" onClick={onCopyShare}><Share2 size={12} /> Copy share URL with view</button>
      </PanelSection>
    </>
  );
}

function BookmarksPanel({
  bookmarks,
  search,
  onSearch,
  onFly,
  onDelete,
  onAdd
}: {
  bookmarks: Bookmark[];
  search: string;
  onSearch: (s: string) => void;
  onFly: (b: Bookmark) => void;
  onDelete: (id: string) => void;
  onAdd: () => void;
}) {
  return (
    <>
      <PanelSection title="Search" icon={Search}>
        <input
          className="atlasSearchInput"
          type="text"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Filter bookmarks…"
          aria-label="Filter bookmarks"
        />
      </PanelSection>

      <PanelSection title={`Locations (${bookmarks.length})`} icon={Bookmark}>
        <button type="button" className="atlasPrimaryBtn small" onClick={onAdd}>
          <BookmarkPlus size={13} /> Bookmark current view
        </button>
        <ul className="atlasBookmarkList">
          {bookmarks.map((b) => (
            <li key={b.id}>
              <button type="button" className="atlasBookmarkRow" onClick={() => onFly(b)}>
                <Navigation size={12} />
                <div>
                  <strong>{b.name}</strong>
                  <span>{formatLat(b.lat)}, {formatLon(b.lon)} · {formatAlt(b.altKm)}</span>
                </div>
              </button>
              <button type="button" className="atlasIconBtn" onClick={() => onDelete(b.id)} title="Delete bookmark" aria-label="Delete bookmark">
                <Trash2 size={12} />
              </button>
            </li>
          ))}
        </ul>
      </PanelSection>
    </>
  );
}

function PanelSection({ title, icon: Icon, children }: { title: string; icon: IconComponent; children: React.ReactNode }) {
  return (
    <section className="atlasPanelSection">
      <div className="atlasSectionTitle"><Icon size={13} /> {title}</div>
      {children}
    </section>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  onChange,
  formatter,
  suffix
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  formatter?: (v: number) => string;
  suffix?: string;
}) {
  const display = formatter ? formatter(value) : Math.round(((value - min) / (max - min)) * 100).toString();
  return (
    <label className="atlasSliderRow">
      <span>
        {label}
        <strong>{display}{suffix ?? ""}</strong>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={(max - min) / 100}
        value={value}
        aria-label={`${label} ${display}${suffix ?? ""}`}
        style={{ "--value": (value - min) / (max - min) } as CSSProperties}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}

function ScaleBar({ altKm }: { altKm: number }) {
  // approximate: at this altitude, how many km does a 100px span represent?
  const kmPerPx = altKm * 0.0014; // rough heuristic
  const span = Math.max(1, Math.round(100 * kmPerPx));
  return (
    <div className="atlasScaleBar">
      <span className="atlasScaleLine" />
      <span>≈ {span.toLocaleString()} km</span>
    </div>
  );
}

function FpsOverlay() {
  const [fps, setFps] = useState(0);
  useEffect(() => {
    let raf = 0;
    let frames = 0;
    let last = performance.now();
    const tick = (time: number) => {
      frames++;
      if (time - last >= 500) {
        setFps(Math.round((frames * 1000) / (time - last)));
        frames = 0;
        last = time;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return <div className="atlasFps">{fps} fps</div>;
}

function SearchModal({
  query,
  onQuery,
  results,
  searching,
  onSelect,
  onClose
}: {
  query: string;
  onQuery: (s: string) => void;
  results: Bookmark[];
  searching: boolean;
  suggestions: string[];
  onSelect: (b: Bookmark) => void;
  onClose: () => void;
}) {
  return (
    <div className="atlasModalShade" onClick={onClose} role="dialog" aria-modal="true">
      <div className="atlasSearchModal" onClick={(e) => e.stopPropagation()}>
        <div className="atlasSearchHead">
          <Search size={16} />
          <input
            type="text"
            autoFocus
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder="Search any place on Earth…"
            aria-label="Search a place"
          />
          {searching && <span className="atlasSearchSpinner" aria-hidden />}
          <button type="button" className="atlasIconBtn" onClick={onClose} aria-label="Close"><X size={14} /></button>
        </div>
        <ul className="atlasSearchResults">
          {results.length === 0 && !searching && <li className="atlasSearchEmpty">{query.trim().length < 3 ? "Type at least 3 characters…" : "No matches."}</li>}
          {results.map((r) => (
            <li key={r.id}>
              <button type="button" onClick={() => onSelect(r)}>
                <Navigation size={12} />
                <div>
                  <strong>{r.name}</strong>
                  <span>{formatLat(r.lat)}, {formatLon(r.lon)}</span>
                </div>
              </button>
            </li>
          ))}
        </ul>
        <div className="atlasSearchFoot">Powered by OpenStreetMap Nominatim</div>
      </div>
    </div>
  );
}

function CoordInputModal({ onSubmit, onClose }: { onSubmit: (lat: number, lon: number, altKm: number) => void; onClose: () => void }) {
  const [lat, setLat] = useState("");
  const [lon, setLon] = useState("");
  const [alt, setAlt] = useState("1500");
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const la = Number(lat);
    const lo = Number(lon);
    const al = Number(alt);
    if (!Number.isFinite(la) || !Number.isFinite(lo) || !Number.isFinite(al)) return;
    onSubmit(la, lo, al);
  };
  return (
    <div className="atlasModalShade" onClick={onClose} role="dialog" aria-modal="true">
      <form className="atlasShortcutsModal" style={{ maxWidth: 380 }} onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="atlasModalHead">
          <strong>Fly to coordinates</strong>
          <button type="button" className="atlasIconBtn" onClick={onClose} aria-label="Close"><X size={14} /></button>
        </div>
        <div className="atlasCoordGrid">
          <label><span>Latitude</span><input autoFocus type="text" inputMode="decimal" value={lat} onChange={(e) => setLat(e.target.value)} placeholder="-90 to 90" /></label>
          <label><span>Longitude</span><input type="text" inputMode="decimal" value={lon} onChange={(e) => setLon(e.target.value)} placeholder="-180 to 180" /></label>
          <label><span>Altitude (km)</span><input type="text" inputMode="decimal" value={alt} onChange={(e) => setAlt(e.target.value)} /></label>
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 12, justifyContent: "flex-end" }}>
          <button type="button" className="atlasPrimaryBtn small" style={{ background: "transparent", color: "#9aa5b8" }} onClick={onClose}>Cancel</button>
          <button type="submit" className="atlasPrimaryBtn small">Fly there</button>
        </div>
      </form>
    </div>
  );
}

function PinInfoCard({ pin, onClose, onDelete, onRename, onFly }: { pin: Pin; onClose: () => void; onDelete: (id: string) => void; onRename: (id: string, label: string) => void; onFly: (p: Pin) => void }) {
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(pin.label);
  useEffect(() => { setLabel(pin.label); }, [pin.label]);
  const localTimeMs = Date.now() + (pin.lon / 15) * 3600 * 1000;
  const localTime = new Date(localTimeMs).toUTCString().split(" ").slice(4, 5)[0];
  const copy = (text: string) => navigator.clipboard?.writeText(text);
  return (
    <div className="atlasPinCard" role="dialog">
      <div className="atlasPinCardHead">
        <span className="atlasPinDot" style={{ background: pin.color }} />
        {editing ? (
          <input
            autoFocus
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            onBlur={() => { onRename(pin.id, label || pin.label); setEditing(false); }}
            onKeyDown={(e) => { if (e.key === "Enter") { onRename(pin.id, label || pin.label); setEditing(false); } if (e.key === "Escape") { setLabel(pin.label); setEditing(false); } }}
          />
        ) : (
          <strong onClick={() => setEditing(true)}>{pin.label}</strong>
        )}
        <button type="button" className="atlasIconBtn" onClick={onClose} aria-label="Close"><X size={12} /></button>
      </div>
      <div className="atlasPinMeta">
        <div><span>Lat</span><strong>{formatLat(pin.lat)}</strong></div>
        <div><span>Lon</span><strong>{formatLon(pin.lon)}</strong></div>
        <div><span>Local</span><strong>{localTime} (approx)</strong></div>
      </div>
      <div className="atlasPinActions">
        <button type="button" className="atlasPrimaryBtn small" onClick={() => onFly(pin)}><Navigation size={11} /> Fly</button>
        <button type="button" className="atlasPrimaryBtn small" style={{ background: "transparent" }} onClick={() => copy(`${pin.lat}, ${pin.lon}`)}><Bookmark size={11} /> Copy</button>
        <button type="button" className="atlasPrimaryBtn small" style={{ background: "transparent", color: "#ff8a8a" }} onClick={() => onDelete(pin.id)}><Trash2 size={11} /> Delete</button>
      </div>
    </div>
  );
}

function PinsMiniList({ pins, selectedId, onSelect, onFly, onDelete }: { pins: Pin[]; selectedId: string | null; onSelect: (id: string) => void; onFly: (p: Pin) => void; onDelete: (id: string) => void }) {
  // Show distance/bearing readout when 2+ pins exist
  const lastTwo = pins.slice(-2);
  const distance = lastTwo.length === 2 ? haversineKm(lastTwo[0].lat, lastTwo[0].lon, lastTwo[1].lat, lastTwo[1].lon) : 0;
  const bearing = lastTwo.length === 2 ? bearingDeg(lastTwo[0].lat, lastTwo[0].lon, lastTwo[1].lat, lastTwo[1].lon) : 0;
  return (
    <div className="atlasPinsMini">
      <div className="atlasPinsMiniHead">
        <span>Pins ({pins.length})</span>
        {lastTwo.length === 2 && (
          <span className="atlasPinsMeasurement">{distance.toLocaleString(undefined, { maximumFractionDigits: 0 })} km · {bearing.toFixed(0)}°</span>
        )}
      </div>
      <div className="atlasPinsMiniList">
        {pins.slice(-6).reverse().map((p) => (
          <div key={p.id} className={`atlasPinsMiniRow${p.id === selectedId ? " selected" : ""}`}>
            <span className="atlasPinDot" style={{ background: p.color }} />
            <button type="button" className="atlasPinsMiniLabel" onClick={() => onSelect(p.id)}>{p.label}</button>
            <button type="button" className="atlasIconBtn" onClick={() => onFly(p)} title="Fly to" aria-label="Fly to"><Navigation size={11} /></button>
            <button type="button" className="atlasIconBtn" onClick={() => onDelete(p.id)} title="Delete" aria-label="Delete"><Trash2 size={11} /></button>
          </div>
        ))}
      </div>
    </div>
  );
}

function formatSeconds(seconds: number) {
  const m = Math.floor(seconds / 60).toString().padStart(2, "0");
  const s = (seconds % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = EARTH_RADIUS_KM;
  const toRad = (d: number) => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function bearingDeg(lat1: number, lon1: number, lat2: number, lon2: number) {
  const toRad = (d: number) => d * Math.PI / 180;
  const φ1 = toRad(lat1), φ2 = toRad(lat2);
  const λ1 = toRad(lon1), λ2 = toRad(lon2);
  const y = Math.sin(λ2 - λ1) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(λ2 - λ1);
  const θ = Math.atan2(y, x);
  return (θ * 180 / Math.PI + 360) % 360;
}

function ShortcutsModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="atlasModalShade" onClick={onClose} role="dialog" aria-modal="true">
      <div className="atlasShortcutsModal" onClick={(e) => e.stopPropagation()}>
        <div className="atlasModalHead">
          <strong>Keyboard shortcuts</strong>
          <button type="button" className="atlasIconBtn" onClick={onClose} aria-label="Close"><X size={14} /></button>
        </div>
        <ul className="atlasShortcutList">
          {KEYBOARD_HINTS.map((s) => (
            <li key={s.keys}><kbd>{s.keys}</kbd><span>{s.desc}</span></li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// ============= 3D scene =============

function GlobeCanvas({
  globe,
  layers,
  paused,
  orbiting,
  flyTo,
  issPosition,
  pins,
  earthquakes,
  borders,
  selectedPinId,
  onSelectPin,
  onGlobeClick,
  onCameraChange
}: {
  globe: GlobeSettings;
  layers: LayerVisibility;
  paused: boolean;
  orbiting: boolean;
  flyTo: FlyToTarget;
  issPosition: { lat: number; lon: number } | null;
  pins: Pin[];
  earthquakes: Earthquake[];
  borders: Float32Array | null;
  selectedPinId: string | null;
  onSelectPin: (id: string | null) => void;
  onGlobeClick: (lat: number, lon: number) => void;
  onCameraChange: (lat: number, lon: number, altKm: number) => void;
}) {
  const sunDirection = useMemo(() => {
    const [x, y, z] = sunPosition(globe.sunAzimuth, globe.sunElevation, 1);
    return new THREE.Vector3(x, y, z);
  }, [globe.sunAzimuth, globe.sunElevation]);

  return (
    <Canvas
      dpr={[1, Math.min(window.devicePixelRatio, 2)]}
      camera={{ position: [0, 0, SPACE_DISTANCE], fov: 55, near: 0.01, far: 1000 }}
      gl={{ antialias: true, powerPreference: "high-performance", preserveDrawingBuffer: true }}
    >
      <color attach="background" args={["#04060c"]} />
      <Suspense fallback={null}>
        <ExposureBridge exposure={globe.exposure} />
        <ambientLight intensity={0.05} />
        <SunLight azimuth={globe.sunAzimuth} elevation={globe.sunElevation} />
        <EarthGroup globe={globe} paused={paused}>
          <Earth globe={globe} layers={layers} sunDirection={sunDirection} onClick={onGlobeClick} />
          {layers.borders && borders && <Borders positions={borders} />}
          {layers.graticule && <Graticule />}
          {layers.cardinals && <Cardinals />}
          {layers.timezones && <TimeZoneBands />}
          {layers.earthquakes && <EarthquakeMarkers data={earthquakes} />}
          {layers.pins && <PinMarkers pins={pins} selectedId={selectedPinId} onSelect={onSelectPin} />}
        </EarthGroup>
        {layers.atmosphere && <Atmosphere intensity={globe.atmosphereIntensity} />}
        {layers.clouds && <Clouds opacity={globe.cloudOpacity} paused={paused} />}
        {layers.stars && <Stars radius={120} depth={50} count={4500} factor={4} saturation={0} fade speed={0.5} />}
        {layers.iss && issPosition && <ISSMarker lat={issPosition.lat} lon={issPosition.lon} />}
        <GlobeControls flyTo={flyTo} onCameraChange={onCameraChange} autoOrbit={orbiting && !paused} />
      </Suspense>
    </Canvas>
  );
}

function EarthGroup({ globe, paused, children }: { globe: GlobeSettings; paused: boolean; children: React.ReactNode }) {
  const ref = useRef<THREE.Group>(null);
  useFrame((_, delta) => {
    if (ref.current && !paused) {
      ref.current.rotation.y += delta * globe.rotationSpeed * 0.4;
    }
  });
  return (
    <group ref={ref} rotation={[0, 0, THREE.MathUtils.degToRad(-23.4)]}>
      {children}
    </group>
  );
}

function ISSMarker({ lat, lon }: { lat: number; lon: number }) {
  // ISS orbital altitude ~408 km → at globe-radius=1, that's 1 + 408/6371
  const altitude = 1 + 408 / EARTH_RADIUS_KM;
  const pos = useMemo(() => latLonToVec3(lat, lon, altitude), [lat, lon, altitude]);
  const ring = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (ring.current) {
      const t = clock.elapsedTime;
      ring.current.scale.setScalar(1 + Math.sin(t * 3) * 0.15);
    }
  });
  return (
    <group position={pos}>
      <mesh>
        <sphereGeometry args={[0.012, 16, 16]} />
        <meshBasicMaterial color="#ffd66b" />
      </mesh>
      <mesh ref={ring} rotation={[Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.022, 0.028, 32]} />
        <meshBasicMaterial color="#ffd66b" transparent opacity={0.6} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

function ExposureBridge({ exposure }: { exposure: number }) {
  const { gl } = useThree();
  useEffect(() => {
    gl.toneMapping = THREE.ACESFilmicToneMapping;
    gl.toneMappingExposure = exposure;
  }, [gl, exposure]);
  return null;
}

function sunPosition(azimuth: number, elevation: number, distance = 60): [number, number, number] {
  const az = azimuth * Math.PI * 2;
  const el = (elevation - 0.5) * Math.PI;
  return [
    Math.cos(az) * Math.cos(el) * distance,
    Math.sin(el) * distance,
    Math.sin(az) * Math.cos(el) * distance
  ];
}

function SunLight({ azimuth, elevation }: { azimuth: number; elevation: number }) {
  return (
    <directionalLight position={sunPosition(azimuth, elevation)} intensity={2.2} color="#ffffff" />
  );
}

const EARTH_VERTEX = `
  varying vec3 vWorldNormal;
  varying vec2 vUv;
  varying vec3 vWorldPosition;
  void main() {
    vUv = uv;
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPos.xyz;
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

const EARTH_FRAGMENT = `
  uniform sampler2D uDayMap;
  uniform sampler2D uNightMap;
  uniform sampler2D uSpecularMap;
  uniform vec3 uSunDirection;
  uniform float uExposure;
  uniform float uNightStrength;
  varying vec3 vWorldNormal;
  varying vec2 vUv;
  varying vec3 vWorldPosition;

  void main() {
    vec3 N = normalize(vWorldNormal);
    vec3 L = normalize(uSunDirection);
    float ndotl = dot(N, L);
    float diffuse = max(0.0, ndotl);
    float terminator = smoothstep(-0.08, 0.16, ndotl);

    vec3 dayColor = texture2D(uDayMap, vUv).rgb;
    vec3 nightColor = texture2D(uNightMap, vUv).rgb;
    float spec = texture2D(uSpecularMap, vUv).r;

    // Water specular highlight (fake — adds shimmer to oceans on day side)
    vec3 viewDir = normalize(cameraPosition - vWorldPosition);
    vec3 H = normalize(L + viewDir);
    float specHighlight = pow(max(0.0, dot(N, H)), 64.0) * spec * diffuse * 0.6;

    vec3 lit = dayColor * (0.06 + diffuse * 1.08) + vec3(specHighlight);
    vec3 night = nightColor * uNightStrength * (1.0 - terminator);
    vec3 color = mix(night, lit, terminator);

    // Atmospheric tint near terminator
    float twilight = 1.0 - abs(ndotl);
    twilight = pow(twilight, 5.0);
    color += vec3(0.10, 0.07, 0.03) * twilight * 0.7;

    gl_FragColor = vec4(color * uExposure, 1.0);
  }
`;

function Earth({
  globe,
  layers,
  sunDirection,
  onClick
}: {
  globe: GlobeSettings;
  layers: LayerVisibility;
  sunDirection: THREE.Vector3;
  onClick: (lat: number, lon: number) => void;
}) {
  const ref = useRef<THREE.Mesh>(null);
  const matRef = useRef<THREE.ShaderMaterial>(null);
  const [day, night, specular] = useTexture([
    `${import.meta.env.BASE_URL}textures/earth_day.jpg`,
    `${import.meta.env.BASE_URL}textures/earth_night.jpg`,
    `${import.meta.env.BASE_URL}textures/earth_specular.jpg`
  ]);

  useEffect(() => {
    [day, night, specular].forEach((tex) => {
      tex.anisotropy = 8;
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.ClampToEdgeWrapping;
    });
    day.colorSpace = THREE.SRGBColorSpace;
    night.colorSpace = THREE.SRGBColorSpace;
    specular.colorSpace = THREE.NoColorSpace;
  }, [day, night, specular]);

  const uniforms = useMemo(() => ({
    uDayMap: { value: day },
    uNightMap: { value: night },
    uSpecularMap: { value: specular },
    uSunDirection: { value: sunDirection.clone() },
    uExposure: { value: globe.exposure },
    uNightStrength: { value: layers.nightLights ? 2.0 : 0 }
  }), [day, night, specular]);

  useFrame(() => {
    if (matRef.current) {
      const u = matRef.current.uniforms;
      u.uSunDirection.value.copy(sunDirection);
      u.uExposure.value = globe.exposure;
      u.uNightStrength.value = layers.nightLights ? 2.0 : 0;
    }
  });

  const handlePointerDown = (event: any) => {
    if (event.button !== undefined && event.button !== 0) return;
    if (!ref.current) return;
    event.stopPropagation();
    const local = event.point.clone();
    ref.current.worldToLocal(local);
    const { lat, lon } = pointToLatLon(local);
    onClick(lat, lon);
  };

  if (globe.renderMode === "wireframe") {
    return (
      <mesh ref={ref} onPointerDown={handlePointerDown}>
        <sphereGeometry args={[1, 64, 64]} />
        <meshBasicMaterial color="#5cb5ff" wireframe transparent opacity={0.45} />
      </mesh>
    );
  }
  if (globe.renderMode === "blueprint") {
    return (
      <mesh ref={ref} onPointerDown={handlePointerDown}>
        <sphereGeometry args={[1, 96, 96]} />
        <meshBasicMaterial color="#0c1e3a" />
      </mesh>
    );
  }

  return (
    <mesh ref={ref} onPointerDown={handlePointerDown}>
      <sphereGeometry args={[1, 128, 128]} />
      <shaderMaterial
        ref={matRef}
        vertexShader={EARTH_VERTEX}
        fragmentShader={EARTH_FRAGMENT}
        uniforms={uniforms}
      />
    </mesh>
  );
}

function PinMarkers({ pins, selectedId, onSelect }: { pins: Pin[]; selectedId: string | null; onSelect: (id: string | null) => void }) {
  return (
    <group>
      {pins.map((pin) => (
        <PinMarker key={pin.id} pin={pin} selected={pin.id === selectedId} onSelect={onSelect} />
      ))}
    </group>
  );
}

function PinMarker({ pin, selected, onSelect }: { pin: Pin; selected: boolean; onSelect: (id: string | null) => void }) {
  const ringRef = useRef<THREE.Mesh>(null);
  const pos = useMemo(() => latLonToVec3(pin.lat, pin.lon, 1.005), [pin.lat, pin.lon]);
  const stalkPos = useMemo(() => latLonToVec3(pin.lat, pin.lon, 1.04), [pin.lat, pin.lon]);
  const lookAtRef = useRef<THREE.Vector3>(new THREE.Vector3(pos.x * 2, pos.y * 2, pos.z * 2));
  useFrame(({ clock }) => {
    if (ringRef.current && selected) {
      const t = clock.elapsedTime;
      ringRef.current.scale.setScalar(1 + Math.sin(t * 4) * 0.2);
    }
  });
  return (
    <group>
      <mesh position={pos} onPointerDown={(e) => { e.stopPropagation(); onSelect(pin.id); }}>
        <sphereGeometry args={[0.011, 16, 16]} />
        <meshBasicMaterial color={pin.color} />
      </mesh>
      <mesh position={stalkPos} lookAt={lookAtRef.current}>
        <coneGeometry args={[0.008, 0.04, 8]} />
        <meshBasicMaterial color={pin.color} />
      </mesh>
      {selected && (
        <mesh ref={ringRef} position={pos} lookAt={lookAtRef.current}>
          <ringGeometry args={[0.018, 0.024, 32]} />
          <meshBasicMaterial color={pin.color} side={THREE.DoubleSide} transparent opacity={0.7} />
        </mesh>
      )}
    </group>
  );
}

function EarthquakeMarkers({ data }: { data: Earthquake[] }) {
  const groupRef = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (!groupRef.current) return;
    const t = clock.elapsedTime;
    groupRef.current.children.forEach((child, i) => {
      const phase = (t + i * 0.13) % 2;
      child.scale.setScalar(1 + Math.max(0, 1 - phase) * 1.2);
    });
  });
  return (
    <group ref={groupRef}>
      {data.map((q) => {
        const pos = latLonToVec3(q.lat, q.lon, 1.003);
        const size = 0.003 + Math.max(0, q.mag) * 0.0035;
        const color = q.mag >= 5 ? "#ff5a5a" : q.mag >= 3.5 ? "#ffb84d" : "#ffd66b";
        return (
          <mesh key={q.id} position={pos}>
            <sphereGeometry args={[size, 12, 12]} />
            <meshBasicMaterial color={color} transparent opacity={0.85} />
          </mesh>
        );
      })}
    </group>
  );
}

function Borders({ positions }: { positions: Float32Array }) {
  const geom = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    return g;
  }, [positions]);
  useEffect(() => () => geom.dispose(), [geom]);
  return (
    <lineSegments geometry={geom}>
      <lineBasicMaterial color="#ffd66b" transparent opacity={0.45} depthWrite={false} />
    </lineSegments>
  );
}

function TimeZoneBands() {
  const lines = useMemo(() => {
    const arr: number[] = [];
    for (let zone = 0; zone < 24; zone++) {
      const lon = -180 + zone * 15;
      for (let lat = -90; lat <= 90; lat += 5) {
        const a = latLonToVec3(lat, lon, 1.001);
        const b = latLonToVec3(lat + 5, lon, 1.001);
        arr.push(a.x, a.y, a.z, b.x, b.y, b.z);
      }
    }
    return new Float32Array(arr);
  }, []);
  const geom = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(lines, 3));
    return g;
  }, [lines]);
  useEffect(() => () => geom.dispose(), [geom]);
  return (
    <lineSegments geometry={geom}>
      <lineBasicMaterial color="#5cb5ff" transparent opacity={0.18} depthWrite={false} />
    </lineSegments>
  );
}

function Clouds({ opacity, paused }: { opacity: number; paused: boolean }) {
  const ref = useRef<THREE.Mesh>(null);
  const tex = useTexture(`${import.meta.env.BASE_URL}textures/earth_clouds.png`);

  useEffect(() => {
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
  }, [tex]);

  useFrame((_, delta) => {
    if (ref.current && !paused) {
      ref.current.rotation.y += delta * 0.012;
    }
  });

  return (
    <mesh ref={ref} scale={1.012}>
      <sphereGeometry args={[1, 64, 64]} />
      <meshStandardMaterial
        map={tex}
        transparent
        opacity={opacity}
        depthWrite={false}
      />
    </mesh>
  );
}

function Atmosphere({ intensity }: { intensity: number }) {
  const ref = useRef<THREE.ShaderMaterial>(null);
  useFrame(() => {
    if (ref.current) {
      ref.current.uniforms.uIntensity.value = intensity;
    }
  });
  const uniforms = useMemo(() => ({
    uIntensity: { value: intensity },
    uColor: { value: new THREE.Color("#5cb5ff") }
  }), [intensity]);
  const vertexShader = `
    varying vec3 vNormal;
    void main() {
      vNormal = normalize(normalMatrix * normal);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `;
  const fragmentShader = `
    uniform float uIntensity;
    uniform vec3 uColor;
    varying vec3 vNormal;
    void main() {
      float fresnel = pow(1.0 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 3.5);
      gl_FragColor = vec4(uColor * fresnel * uIntensity * 1.5, fresnel * uIntensity);
    }
  `;
  return (
    <mesh scale={1.07}>
      <sphereGeometry args={[1, 48, 48]} />
      <shaderMaterial
        ref={ref}
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        uniforms={uniforms}
        side={THREE.BackSide}
        transparent
        blending={THREE.AdditiveBlending}
        depthWrite={false}
      />
    </mesh>
  );
}

function Graticule() {
  const lines = useMemo(() => {
    const segments: THREE.Vector3[][] = [];
    // Latitude rings (parallels)
    for (let lat = -75; lat <= 75; lat += 15) {
      const points: THREE.Vector3[] = [];
      const phi = THREE.MathUtils.degToRad(90 - lat);
      const r = Math.sin(phi);
      const y = Math.cos(phi);
      for (let lon = 0; lon <= 360; lon += 4) {
        const t = THREE.MathUtils.degToRad(lon);
        points.push(new THREE.Vector3(Math.cos(t) * r, y, Math.sin(t) * r).multiplyScalar(1.001));
      }
      segments.push(points);
    }
    // Longitude meridians
    for (let lon = 0; lon < 360; lon += 30) {
      const points: THREE.Vector3[] = [];
      for (let lat = -90; lat <= 90; lat += 4) {
        const phi = THREE.MathUtils.degToRad(90 - lat);
        const t = THREE.MathUtils.degToRad(lon);
        points.push(new THREE.Vector3(Math.cos(t) * Math.sin(phi), Math.cos(phi), Math.sin(t) * Math.sin(phi)).multiplyScalar(1.001));
      }
      segments.push(points);
    }
    return segments;
  }, []);

  return (
    <group>
      {lines.map((points, i) => (
        <line key={i}>
          <bufferGeometry attach="geometry" onUpdate={(g) => g.setFromPoints(points)} />
          <lineBasicMaterial color="#5cb5ff" transparent opacity={0.32} depthWrite={false} />
        </line>
      ))}
    </group>
  );
}

function Cardinals() {
  // Faint dots at N/S poles + 0/90/180/270 longitude on equator
  const positions: { p: [number, number, number]; c: string }[] = [
    { p: [0, 1.05, 0], c: "#ffd66b" },     // N pole
    { p: [0, -1.05, 0], c: "#5cb5ff" },    // S pole
    { p: [1.05, 0, 0], c: "#5cb5ff" },     // 0E
    { p: [-1.05, 0, 0], c: "#5cb5ff" },    // 180
    { p: [0, 0, 1.05], c: "#5cb5ff" },     // 90E
    { p: [0, 0, -1.05], c: "#5cb5ff" }     // 90W
  ];
  return (
    <group>
      {positions.map((d, i) => (
        <mesh key={i} position={d.p}>
          <sphereGeometry args={[0.012, 16, 16]} />
          <meshBasicMaterial color={d.c} />
        </mesh>
      ))}
    </group>
  );
}

function GlobeControls({
  flyTo,
  onCameraChange,
  autoOrbit
}: {
  flyTo: FlyToTarget;
  onCameraChange: (lat: number, lon: number, altKm: number) => void;
  autoOrbit: boolean;
}) {
  const { camera } = useThree();
  const controlsRef = useRef<any>(null);
  const lastIdRef = useRef(0);
  const tweenRef = useRef<{ from: THREE.Vector3; to: THREE.Vector3; start: number; duration: number } | null>(null);
  const lastEmitRef = useRef(0);

  // Fly-to handling
  useEffect(() => {
    if (flyTo.id === lastIdRef.current) return;
    lastIdRef.current = flyTo.id;
    if (flyTo.id === 0) return;
    const distance = altKmToDistance(flyTo.altKm);
    const target = latLonToVec3(flyTo.lat, flyTo.lon, distance);
    tweenRef.current = {
      from: camera.position.clone(),
      to: target,
      start: performance.now(),
      duration: 1200
    };
  }, [camera, flyTo]);

  useFrame((_, delta) => {
    // Tween the camera to flyTo target
    if (tweenRef.current) {
      const t = Math.min(1, (performance.now() - tweenRef.current.start) / tweenRef.current.duration);
      const eased = t * t * (3 - 2 * t);
      camera.position.lerpVectors(tweenRef.current.from, tweenRef.current.to, eased);
      camera.lookAt(0, 0, 0);
      if (t >= 1) tweenRef.current = null;
    } else if (autoOrbit && controlsRef.current) {
      controlsRef.current.autoRotate = true;
      controlsRef.current.autoRotateSpeed = 0.45;
    } else if (controlsRef.current) {
      controlsRef.current.autoRotate = false;
    }

    if (controlsRef.current) controlsRef.current.update(delta);

    // Emit camera state ~10/sec
    const now = performance.now();
    if (now - lastEmitRef.current > 100) {
      lastEmitRef.current = now;
      const pos = camera.position;
      const distance = pos.length();
      const altKm = distanceToAltKm(distance);
      const lat = THREE.MathUtils.radToDeg(Math.asin(pos.y / distance));
      const lon = THREE.MathUtils.radToDeg(Math.atan2(pos.z, pos.x));
      onCameraChange(lat, lon, altKm);
    }
  });

  return (
    <OrbitControls
      ref={controlsRef}
      enableDamping
      dampingFactor={0.08}
      enablePan={false}
      rotateSpeed={0.45}
      zoomSpeed={0.7}
      minDistance={MIN_DISTANCE}
      maxDistance={MAX_DISTANCE}
      makeDefault
    />
  );
}

// ============= utils =============

function distanceToAltKm(distance: number) {
  return Math.max(0, (distance - 1) * EARTH_RADIUS_KM);
}

function altKmToDistance(altKm: number) {
  return 1 + Math.max(0, altKm) / EARTH_RADIUS_KM;
}

function latLonToVec3(lat: number, lon: number, distance: number) {
  const phi = THREE.MathUtils.degToRad(90 - lat);
  const theta = THREE.MathUtils.degToRad(lon);
  return new THREE.Vector3(
    distance * Math.sin(phi) * Math.cos(theta),
    distance * Math.cos(phi),
    distance * Math.sin(phi) * Math.sin(theta)
  );
}

function formatLat(lat: number) {
  const dir = lat >= 0 ? "N" : "S";
  return `${Math.abs(lat).toFixed(2)}° ${dir}`;
}

function formatLon(lon: number) {
  const norm = ((lon + 540) % 360) - 180;
  const dir = norm >= 0 ? "E" : "W";
  return `${Math.abs(norm).toFixed(2)}° ${dir}`;
}

function formatAlt(altKm: number) {
  if (altKm > 1000) return `${(altKm / 1000).toFixed(1)}k km`;
  return `${altKm.toFixed(0)} km`;
}

function solarPositionNow(): { az: number; el: number } {
  const now = new Date();
  const start = Date.UTC(now.getUTCFullYear(), 0, 0);
  const dayOfYear = Math.floor((now.getTime() - start) / 86400000);
  // Declination of the sun, simplified (Spencer's formula approx)
  const decl = 23.45 * Math.sin((360 / 365) * (dayOfYear - 81) * Math.PI / 180);
  // Sun azimuth from UTC hour (sun roughly above 0° lon at 12 UTC)
  const utcHours = now.getUTCHours() + now.getUTCMinutes() / 60 + now.getUTCSeconds() / 3600;
  // sunAzimuth uniform: 0..1 → 0..360, where ~0.5 puts the sun on +Z (lon 0 facing camera/sun)
  // We map UTC noon → azimuth ~0.25 (so the sun is over lon 0 at noon UTC)
  const az = ((24 - utcHours) / 24 + 0.25) % 1;
  // Elevation: 0..1 maps to -90..+90, our sun shader uses sin((el-0.5)*PI)
  // Map declination directly: decl=0 → el=0.5; decl=23.45 → el ≈ 0.63
  const el = 0.5 + decl / 180;
  return { az, el };
}

function pointToLatLon(point: THREE.Vector3): { lat: number; lon: number } {
  const r = point.length();
  const lat = THREE.MathUtils.radToDeg(Math.asin(point.y / r));
  const lon = THREE.MathUtils.radToDeg(Math.atan2(point.z, point.x));
  return { lat, lon };
}

export default App;

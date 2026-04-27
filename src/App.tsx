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
import { GIBS_LAYERS, DEFAULT_GIBS_DAY, DEFAULT_GIBS_NIGHT, todayUTC, loadGibsComposite } from "./tiles";

const SurfaceMode = lazy(() => import("./Surface"));

type IconComponent = ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;
type Mode = "atlas" | "surface";
type InspectorTab = "globe" | "layers" | "bookmarks" | "data" | "imagery";
type RenderMode = "realistic" | "wireframe" | "blueprint";
type RecordingState = "idle" | "recording" | "encoding";

type Pin = {
  id: string;
  lat: number;
  lon: number;
  label: string;
  color: string;
  note?: string;
  createdAt: number;
};

const PIN_COLORS = ["#5cb5ff", "#ffd66b", "#ff7be0", "#7cffb1", "#ff8a4d", "#a8a8ff", "#ff5a5a", "#ffffff"];

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
  tiangong: boolean;
  hubble: boolean;
  borders: boolean;
  earthquakes: boolean;
  timezones: boolean;
  pins: boolean;
  sun: boolean;
  moon: boolean;
  pinPaths: boolean;
  miniMap: boolean;
  terminator: boolean;
  subsolar: boolean;
  constellations: boolean;
  volcanoes: boolean;
  compass: boolean;
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

type Imagery = {
  layerId: string;        // GIBS layer key
  nightLayerId: string;   // GIBS night layer key
  date: string;           // YYYY-MM-DD
  zoom: number;           // 2 (SD) | 3 (HD) | 4 (UHD, slow)
  source: "live" | "bundled" | "custom";
  customUrl?: string;     // tile URL pattern with {z}/{y}/{x}
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
  imagery?: Imagery;
  pins?: Pin[];
};

const STORAGE_KEY = "atlas-globe-state-v2";
const EARTH_RADIUS_KM = 6371;
const MIN_DISTANCE = 1.0008;        // ~5 km above surface (texture-pixelated, but real zoom)
const MAX_DISTANCE = 12;            // far view from space
const SPACE_DISTANCE = 2.6;          // default starting altitude

const defaultLayers: LayerVisibility = {
  clouds: true,
  atmosphere: true,
  stars: true,
  graticule: false,
  cardinals: true,
  nightLights: true,
  iss: false,
  tiangong: false,
  hubble: false,
  borders: false,
  earthquakes: false,
  timezones: false,
  pins: true,
  sun: false,
  moon: false,
  pinPaths: true,
  miniMap: true,
  terminator: false,
  subsolar: false,
  constellations: false,
  volcanoes: false,
  compass: true
};

const FAMOUS_VOLCANOES: { id: string; name: string; lat: number; lon: number }[] = [
  { id: "etna", name: "Mt. Etna", lat: 37.751, lon: 14.993 },
  { id: "vesuvius", name: "Vesuvius", lat: 40.821, lon: 14.426 },
  { id: "fuji", name: "Mt. Fuji", lat: 35.361, lon: 138.728 },
  { id: "kilauea", name: "Kilauea", lat: 19.421, lon: -155.288 },
  { id: "mauna_loa", name: "Mauna Loa", lat: 19.475, lon: -155.608 },
  { id: "stromboli", name: "Stromboli", lat: 38.789, lon: 15.213 },
  { id: "krakatoa", name: "Krakatoa", lat: -6.102, lon: 105.423 },
  { id: "merapi", name: "Mt. Merapi", lat: -7.541, lon: 110.446 },
  { id: "yellowstone", name: "Yellowstone", lat: 44.43, lon: -110.588 },
  { id: "popocatepetl", name: "Popocatépetl", lat: 19.023, lon: -98.622 },
  { id: "fuego", name: "Volcán de Fuego", lat: 14.473, lon: -90.880 },
  { id: "cotopaxi", name: "Cotopaxi", lat: -0.677, lon: -78.437 },
  { id: "villarrica", name: "Villarrica", lat: -39.420, lon: -71.940 },
  { id: "erebus", name: "Mt. Erebus", lat: -77.530, lon: 167.170 },
  { id: "ruapehu", name: "Mt. Ruapehu", lat: -39.281, lon: 175.564 },
  { id: "taupo", name: "Taupō Volcano", lat: -38.820, lon: 175.917 },
  { id: "kamchatka", name: "Klyuchevskaya", lat: 56.057, lon: 160.642 },
  { id: "iceland_eyja", name: "Eyjafjallajökull", lat: 63.633, lon: -19.629 },
  { id: "iceland_hekla", name: "Hekla", lat: 63.992, lon: -19.666 },
  { id: "kilimanjaro", name: "Kilimanjaro", lat: -3.066, lon: 37.359 },
  { id: "tambora", name: "Tambora", lat: -8.247, lon: 117.991 },
  { id: "pinatubo", name: "Pinatubo", lat: 15.13, lon: 120.35 },
  { id: "santamaria", name: "Santa María", lat: 14.75, lon: -91.55 },
  { id: "stHelens", name: "Mt. St. Helens", lat: 46.20, lon: -122.18 }
];

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

const defaultImagery: Imagery = {
  layerId: DEFAULT_GIBS_DAY,
  nightLayerId: DEFAULT_GIBS_NIGHT,
  date: todayUTC(),
  zoom: 2,
  source: "live"
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
  const [tiangongPosition, setTiangongPosition] = useState<{ lat: number; lon: number } | null>(null);
  const [hubblePosition, setHubblePosition] = useState<{ lat: number; lon: number } | null>(null);
  const [searchResults, setSearchResults] = useState<Bookmark[]>([]);
  const [searching, setSearching] = useState(false);
  const [imagery, setImagery] = useState<Imagery>(defaultImagery);
  const [imageryLoading, setImageryLoading] = useState(false);
  const [imageryProgress, setImageryProgress] = useState(0);
  const [dayTexture, setDayTexture] = useState<THREE.Texture | null>(null);
  const [nightTexture, setNightTexture] = useState<THREE.Texture | null>(null);
  const imageryAbortRef = useRef<AbortController | null>(null);
  const fallbackImagesRef = useRef<{
    day: HTMLImageElement | null;
    night: HTMLImageElement | null;
    dayPromise: Promise<HTMLImageElement>;
    nightPromise: Promise<HTMLImageElement>;
  }>(initFallbackImages());

  function initFallbackImages() {
    const dayImg = new Image();
    dayImg.src = `${typeof import.meta !== "undefined" && (import.meta as any).env ? (import.meta as any).env.BASE_URL : "/"}textures/earth_day.jpg`;
    const nightImg = new Image();
    nightImg.src = `${typeof import.meta !== "undefined" && (import.meta as any).env ? (import.meta as any).env.BASE_URL : "/"}textures/earth_night.jpg`;
    const dayPromise = new Promise<HTMLImageElement>((resolve, reject) => {
      if (dayImg.complete && dayImg.naturalWidth > 0) resolve(dayImg);
      else { dayImg.onload = () => resolve(dayImg); dayImg.onerror = reject; }
    });
    const nightPromise = new Promise<HTMLImageElement>((resolve, reject) => {
      if (nightImg.complete && nightImg.naturalWidth > 0) resolve(nightImg);
      else { nightImg.onload = () => resolve(nightImg); nightImg.onerror = reject; }
    });
    return { day: dayImg, night: nightImg, dayPromise, nightPromise };
  }
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
  const [pinTool, setPinTool] = useState(false);
  const [pinSearch, setPinSearch] = useState("");
  const [showEmbed, setShowEmbed] = useState(false);
  const [tourPlaying, setTourPlaying] = useState(false);
  const tourIndexRef = useRef(0);
  const tourTimerRef = useRef<number | null>(null);
  const [coordFormat, setCoordFormat] = useState<"decimal" | "dms">("decimal");
  const [searchHistory, setSearchHistory] = useState<string[]>([]);
  const [timelapse, setTimelapse] = useState<{ active: boolean; from: string; to: string; days: number; fps: number; recording: boolean }>({ active: false, from: "", to: "", days: 30, fps: 6, recording: false });
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recorderChunksRef = useRef<Blob[]>([]);
  const recorderTimerRef = useRef<number | null>(null);
  const recorderStartRef = useRef(0);
  const tourIntervalRef = useRef<number | null>(null);
  const cameraStateRef = useRef<CameraState>({ lat: 25, lon: 0, altKm: SPACE_DISTANCE * EARTH_RADIUS_KM });
  const skipPersistRef = useRef(true);
  const uiHiddenRef = useRef(false);
  uiHiddenRef.current = hideUi;

  // After initial mount, force a window resize so r3f's <Canvas> ResizeObserver
  // picks up the actual viewport size. Without this, on some browsers the first
  // render frame happens before layout, leaving the canvas blank until any user
  // interaction. Dispatch a resize twice (immediate + delayed) to be safe.
  useEffect(() => {
    const fire = () => window.dispatchEvent(new Event("resize"));
    requestAnimationFrame(fire);
    const t = window.setTimeout(fire, 250);
    return () => window.clearTimeout(t);
  }, []);

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

  // Satellite position polling (ISS + Tiangong + Hubble)
  useEffect(() => {
    const targets: { id: number; setter: (p: { lat: number; lon: number } | null) => void; enabled: boolean }[] = [
      { id: 25544, setter: setIssPosition, enabled: layers.iss },
      { id: 48274, setter: setTiangongPosition, enabled: layers.tiangong },
      { id: 20580, setter: setHubblePosition, enabled: layers.hubble }
    ];
    const active = targets.filter((t) => t.enabled);
    if (active.length === 0) return;
    let cancelled = false;
    const fetchAll = async () => {
      await Promise.all(active.map(async (t) => {
        try {
          const res = await fetch(`https://api.wheretheiss.at/v1/satellites/${t.id}`);
          if (!res.ok) return;
          const data = await res.json();
          if (!cancelled) t.setter({ lat: data.latitude, lon: data.longitude });
        } catch { /* ignore */ }
      }));
    };
    fetchAll();
    const handle = window.setInterval(fetchAll, 5000);
    return () => { cancelled = true; window.clearInterval(handle); };
  }, [layers.iss, layers.tiangong, layers.hubble]);

  // Persist
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const data = JSON.parse(raw) as Partial<PersistedState>;
        if (data.layers) setLayers({ ...defaultLayers, ...data.layers });
        if (data.globe) setGlobe({ ...defaultGlobe, ...data.globe });
        if (Array.isArray(data.bookmarks)) {
          const ids = new Set(data.bookmarks.map((b) => b.id));
          setBookmarks([...data.bookmarks, ...cityBookmarks.filter((c) => !ids.has(c.id))]);
        }
        if (data.uiTheme) setUiTheme(data.uiTheme);
        if (data.imagery) setImagery({ ...defaultImagery, ...data.imagery, date: todayUTC() });
        if (Array.isArray(data.pins)) setPins(data.pins);
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
    const payload: PersistedState = { layers, globe, bookmarks, uiTheme, imagery, pins };
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload)); } catch {}
  }, [layers, globe, bookmarks, uiTheme, imagery, pins]);

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

  const resetAllSettings = useCallback(() => {
    if (!window.confirm("Reset all settings to defaults? Pins, bookmarks, and saved state will be cleared.")) return;
    try {
      window.localStorage.removeItem(STORAGE_KEY);
      window.localStorage.removeItem("atlas-search-history");
    } catch {/* ignore */}
    window.location.reload();
  }, []);

  const resetView = useCallback(() => {
    setFlyTo((current) => ({ id: current.id + 1, lat: 25, lon: 0, altKm: distanceToAltKm(SPACE_DISTANCE) }));
    showToast("View reset");
  }, [showToast]);

  // Search history (persisted, last 10)
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem("atlas-search-history");
      if (raw) setSearchHistory(JSON.parse(raw));
    } catch {/* ignore */}
  }, []);

  const recordSearch = useCallback((q: string) => {
    if (!q.trim()) return;
    setSearchHistory((prev) => {
      const next = [q, ...prev.filter((p) => p !== q)].slice(0, 10);
      try { window.localStorage.setItem("atlas-search-history", JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);

  const flyToBookmark = useCallback((b: Bookmark) => {
    setFlyTo((current) => ({ id: current.id + 1, lat: b.lat, lon: b.lon, altKm: b.altKm }));
    showToast(`Flying to ${b.name}`);
    recordSearch(b.name);
  }, [recordSearch, showToast]);

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

  // Fetch day + night GIBS composites whenever imagery settings change (debounced)
  useEffect(() => {
    if (imagery.source !== "live") {
      setDayTexture(null);
      setNightTexture(null);
      return;
    }
    imageryAbortRef.current?.abort();
    const controller = new AbortController();
    imageryAbortRef.current = controller;
    const handle = window.setTimeout(async () => {
      const dayLayer = GIBS_LAYERS[imagery.layerId] ?? GIBS_LAYERS[DEFAULT_GIBS_DAY];
      const nightLayer = GIBS_LAYERS[imagery.nightLayerId] ?? GIBS_LAYERS[DEFAULT_GIBS_NIGHT];
      setImageryLoading(true);
      setImageryProgress(0);
      try {
        // Wait for bundled fallback images so they can underlay the GIBS tiles.
        // (Without this, on a fresh load the fallback Image isn't ready yet and we get black gaps.)
        const [dayFallback, nightFallback] = await Promise.all([
          fallbackImagesRef.current.dayPromise.catch(() => null),
          fallbackImagesRef.current.nightPromise.catch(() => null)
        ]);
        if (controller.signal.aborted) return;

        // Day
        const dayCanvas = await loadGibsComposite(
          dayLayer,
          imagery.date,
          imagery.zoom,
          controller.signal,
          (loaded, total) => setImageryProgress(loaded / (total * 2)),
          dayFallback ?? undefined
        );
        if (controller.signal.aborted) return;
        const newDay = new THREE.CanvasTexture(dayCanvas);
        newDay.colorSpace = THREE.SRGBColorSpace;
        newDay.anisotropy = 8;
        newDay.wrapS = THREE.RepeatWrapping;
        newDay.wrapT = THREE.ClampToEdgeWrapping;
        newDay.flipY = true;
        setDayTexture((prev) => { prev?.dispose(); return newDay; });

        // Night (lower zoom — 1 level less, faster)
        const nightCanvas = await loadGibsComposite(
          nightLayer,
          imagery.date,
          Math.max(2, imagery.zoom - 1),
          controller.signal,
          (loaded, total) => setImageryProgress(0.5 + (loaded / total) * 0.5),
          nightFallback ?? undefined
        );
        if (controller.signal.aborted) return;
        const newNight = new THREE.CanvasTexture(nightCanvas);
        newNight.colorSpace = THREE.SRGBColorSpace;
        newNight.anisotropy = 8;
        newNight.wrapS = THREE.RepeatWrapping;
        newNight.wrapT = THREE.ClampToEdgeWrapping;
        newNight.flipY = true;
        setNightTexture((prev) => { prev?.dispose(); return newNight; });

        showToast(`Imagery: ${dayLayer.name.split(" ")[0]} · ${imagery.date}`);
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          showToast("Imagery fetch failed");
        }
      } finally {
        if (!controller.signal.aborted) {
          setImageryLoading(false);
          setImageryProgress(1);
        }
      }
    }, 350);
    return () => {
      window.clearTimeout(handle);
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imagery.layerId, imagery.nightLayerId, imagery.date, imagery.zoom, imagery.source]);

  useEffect(() => () => {
    dayTexture?.dispose();
    nightTexture?.dispose();
    imageryAbortRef.current?.abort();
  }, [dayTexture, nightTexture]);

  const updateImagery = useCallback((patch: Partial<Imagery>) => {
    setImagery((prev) => ({ ...prev, ...patch }));
  }, []);

  const onCameraChange = useCallback((lat: number, lon: number, altKm: number) => {
    setCameraState({ lat, lon, altKm });
    cameraStateRef.current = { lat, lon, altKm };
  }, []);

  // Click-to-drop-pin (with reverse geocoding)
  const onGlobeClick = useCallback((lat: number, lon: number) => {
    const id = `pin-${Date.now()}`;
    const color = PIN_COLORS[Math.floor(Math.random() * PIN_COLORS.length)];
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

    // Reverse geocode (best-effort, async)
    (async () => {
      try {
        const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=10`, {
          headers: { Accept: "application/json" }
        });
        if (!res.ok) return;
        const data = await res.json() as { display_name?: string; address?: Record<string, string> };
        if (data?.address) {
          const a = data.address;
          const name = a.city || a.town || a.village || a.county || a.state || a.country || data.display_name?.split(",")[0]?.trim();
          if (name) {
            setPins((prev) => prev.map((p) => p.id === id ? { ...p, label: name } : p));
          }
        }
      } catch {/* ignore */}
    })();
  }, [pins.length, showToast]);

  const updatePin = useCallback((id: string, patch: Partial<Pin>) => {
    setPins((prev) => prev.map((p) => p.id === id ? { ...p, ...patch } : p));
  }, []);

  // Time-lapse animation: scrub date over a range and export as GIF
  const runTimelapse = useCallback(async (days: number, fps: number) => {
    const canvas = document.querySelector(".globeLayer canvas") as HTMLCanvasElement | null;
    if (!canvas) { showToast("Canvas not ready"); return; }
    if (imagery.source !== "live") {
      showToast("Switch imagery to NASA live first");
      return;
    }
    setTimelapse((prev) => ({ ...prev, recording: true, days, fps }));
    showToast(`Time-lapse: ${days} days at ${fps}fps`);
    const today = new Date(imagery.date + "T00:00:00Z");
    const dataUrls: string[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setUTCDate(d.getUTCDate() - i);
      const isoDate = d.toISOString().slice(0, 10);
      // Set imagery date and wait for tiles to load + render
      setImagery((prev) => ({ ...prev, date: isoDate }));
      // Wait for the imagery effect to start + finish (debounce 350ms + tile fetch)
      await new Promise((r) => setTimeout(r, 600));
      // Wait until imageryLoading is false, with timeout
      const startWait = performance.now();
      while (performance.now() - startWait < 30000) {
        await new Promise((r) => setTimeout(r, 200));
        if (!imageryAbortRef.current || imageryAbortRef.current.signal.aborted) break;
        // imageryLoading state isn't directly checkable in closure, so rely on timing — better but heuristic
        // We'll just wait until tile loading is settled by checking a small DOM signal
        const stat = document.querySelector(".atlasImageryStatus");
        if (!stat) break;
      }
      // Extra render frame
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      dataUrls.push(canvas.toDataURL("image/png"));
    }
    showToast("Encoding time-lapse GIF…");
    try {
      const { GIFEncoder, quantize, applyPalette } = await import("gifenc");
      const targetW = Math.min(720, canvas.width);
      const scale = targetW / canvas.width;
      const targetH = Math.floor(canvas.height * scale);
      const off = document.createElement("canvas");
      off.width = targetW; off.height = targetH;
      const ctx = off.getContext("2d");
      if (!ctx) throw new Error();
      const gif = GIFEncoder();
      for (const url of dataUrls) {
        const img = new Image();
        await new Promise((res, rej) => { img.onload = () => res(null); img.onerror = rej; img.src = url; });
        ctx.drawImage(img, 0, 0, targetW, targetH);
        const imgData = ctx.getImageData(0, 0, targetW, targetH);
        const palette = quantize(imgData.data, 256);
        const indexed = applyPalette(imgData.data, palette);
        gif.writeFrame(indexed, targetW, targetH, { palette, delay: Math.round(1000 / fps) });
      }
      gif.finish();
      const blob = new Blob([gif.bytes() as BlobPart], { type: "image/gif" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = `atlas-timelapse-${Date.now()}.gif`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 500);
      showToast(`Time-lapse saved (${dataUrls.length} frames)`);
    } catch {
      showToast("Time-lapse encoding failed");
    } finally {
      setTimelapse((prev) => ({ ...prev, recording: false }));
    }
  }, [imagery.date, imagery.source, showToast]);

  // Auto-refresh today's imagery every 30 min when source=live + date=today
  useEffect(() => {
    if (imagery.source !== "live" || imagery.date !== todayUTC()) return;
    const handle = window.setInterval(() => {
      setImagery((prev) => ({ ...prev, date: todayUTC() }));
    }, 30 * 60 * 1000);
    return () => window.clearInterval(handle);
  }, [imagery.source, imagery.date]);

  // Project save/load
  const exportProject = useCallback(() => {
    const project = {
      version: 1,
      savedAt: new Date().toISOString(),
      cameraState: cameraStateRef.current,
      layers,
      globe,
      imagery,
      pins,
      bookmarks: bookmarks.filter((b) => !cityBookmarks.some((c) => c.id === b.id)),
      uiTheme
    };
    const blob = new Blob([JSON.stringify(project, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `atlas-project-${Date.now()}.json`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 500);
    showToast("Project exported");
  }, [bookmarks, globe, imagery, layers, pins, showToast, uiTheme]);

  const importProject = useCallback((file: File) => {
    file.text().then((text) => {
      try {
        const data = JSON.parse(text);
        if (data.layers) setLayers({ ...defaultLayers, ...data.layers });
        if (data.globe) setGlobe({ ...defaultGlobe, ...data.globe });
        if (data.imagery) setImagery({ ...defaultImagery, ...data.imagery });
        if (Array.isArray(data.pins)) setPins(data.pins);
        if (Array.isArray(data.bookmarks)) {
          const ids = new Set(data.bookmarks.map((b: Bookmark) => b.id));
          setBookmarks([...data.bookmarks, ...cityBookmarks.filter((c) => !ids.has(c.id))]);
        }
        if (data.uiTheme) setUiTheme(data.uiTheme);
        if (data.cameraState) {
          setFlyTo((c) => ({ id: c.id + 1, lat: data.cameraState.lat, lon: data.cameraState.lon, altKm: data.cameraState.altKm }));
        }
        showToast("Project loaded");
      } catch {
        showToast("Invalid project file");
      }
    });
  }, [showToast]);

  const exportPinsJson = useCallback(() => {
    const blob = new Blob([JSON.stringify(pins, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `atlas-pins-${Date.now()}.json`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 500);
    showToast(`Exported ${pins.length} pins`);
  }, [pins, showToast]);

  const importPinsJson = useCallback((file: File) => {
    file.text().then((text) => {
      try {
        const data = JSON.parse(text) as Pin[];
        if (!Array.isArray(data)) throw new Error("not an array");
        const cleaned = data.filter((p) => p && typeof p.lat === "number" && typeof p.lon === "number")
          .map((p) => ({ ...p, id: p.id || `pin-${Math.random().toString(36).slice(2)}` }));
        setPins((prev) => [...prev, ...cleaned]);
        showToast(`Imported ${cleaned.length} pins`);
      } catch {
        showToast("Invalid pins JSON");
      }
    });
  }, [showToast]);

  // GIF export — captures N frames at given fps, encodes via gifenc
  const exportGif = useCallback(async (frames = 60, fps = 20) => {
    const canvas = document.querySelector(".globeLayer canvas") as HTMLCanvasElement | null;
    if (!canvas) { showToast("Canvas not ready"); return; }
    showToast("Capturing GIF…");
    const dataUrls: string[] = [];
    const interval = 1000 / fps;
    for (let i = 0; i < frames; i++) {
      await new Promise((r) => setTimeout(r, interval));
      dataUrls.push(canvas.toDataURL("image/png"));
    }
    showToast("Encoding GIF…");
    try {
      const { GIFEncoder, quantize, applyPalette } = await import("gifenc");
      const targetW = Math.min(720, canvas.width);
      const scale = targetW / canvas.width;
      const targetH = Math.floor(canvas.height * scale);
      const off = document.createElement("canvas");
      off.width = targetW; off.height = targetH;
      const ctx = off.getContext("2d");
      if (!ctx) throw new Error("ctx");
      const gif = GIFEncoder();
      for (const url of dataUrls) {
        const img = new Image();
        await new Promise((res, rej) => { img.onload = () => res(null); img.onerror = rej; img.src = url; });
        ctx.drawImage(img, 0, 0, targetW, targetH);
        const imgData = ctx.getImageData(0, 0, targetW, targetH);
        const palette = quantize(imgData.data, 256);
        const indexed = applyPalette(imgData.data, palette);
        gif.writeFrame(indexed, targetW, targetH, { palette, delay: Math.round(1000 / fps) });
      }
      gif.finish();
      const blob = new Blob([gif.bytes() as BlobPart], { type: "image/gif" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = `atlas-${Date.now()}.gif`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 500);
      showToast("GIF saved");
    } catch {
      showToast("GIF encoding failed");
    }
  }, [showToast]);

  const deletePin = useCallback((id: string) => {
    setPins((prev) => prev.filter((p) => p.id !== id));
    if (selectedPin === id) setSelectedPin(null);
  }, [selectedPin]);

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

  // Geolocation — fly to user's real location
  const flyToMyLocation = useCallback(() => {
    if (!navigator.geolocation) {
      showToast("Geolocation unsupported");
      return;
    }
    showToast("Locating…");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setFlyTo((c) => ({ id: c.id + 1, lat: pos.coords.latitude, lon: pos.coords.longitude, altKm: 1500 }));
        showToast(`You: ${formatLat(pos.coords.latitude)} ${formatLon(pos.coords.longitude)}`);
      },
      (err) => showToast(`Location: ${err.message}`),
      { timeout: 10000, enableHighAccuracy: false }
    );
  }, [showToast]);

  // Pin tour — sequence of pins with auto-fly between
  const startPinTour = useCallback(() => {
    if (pins.length < 2) {
      showToast("Drop at least 2 pins to start a tour");
      return;
    }
    tourIndexRef.current = 0;
    setTourPlaying(true);
    showToast(`Pin tour: ${pins.length} stops`);
    const advance = () => {
      const target = pins[tourIndexRef.current % pins.length];
      setFlyTo((c) => ({ id: c.id + 1, lat: target.lat, lon: target.lon, altKm: 1500 }));
      setSelectedPin(target.id);
      tourIndexRef.current++;
      tourTimerRef.current = window.setTimeout(advance, 5000);
    };
    advance();
  }, [pins, showToast]);

  const stopPinTour = useCallback(() => {
    if (tourTimerRef.current) clearTimeout(tourTimerRef.current);
    tourTimerRef.current = null;
    setTourPlaying(false);
    showToast("Pin tour stopped");
  }, [showToast]);

  useEffect(() => () => {
    if (tourTimerRef.current) clearTimeout(tourTimerRef.current);
  }, []);

  // KML export (Google Earth)
  const exportPinsKml = useCallback(() => {
    if (pins.length === 0) { showToast("No pins to export"); return; }
    const placemarks = pins.map((p) => `
    <Placemark>
      <name>${escapeXml(p.label)}</name>
      <description>${escapeXml(p.note ?? "")}</description>
      <Point><coordinates>${p.lon},${p.lat},0</coordinates></Point>
    </Placemark>`).join("");
    const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>Atlas Pins (${new Date().toISOString().slice(0, 10)})</name>${placemarks}
  </Document>
</kml>`;
    const blob = new Blob([kml], { type: "application/vnd.google-earth.kml+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `atlas-pins-${Date.now()}.kml`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 500);
    showToast(`Exported ${pins.length} pins to KML`);
  }, [pins, showToast]);

  // JPG capture
  const captureJpg = useCallback(() => {
    const canvas = document.querySelector(".globeLayer canvas") as HTMLCanvasElement | null;
    if (!canvas) { showToast("Canvas not ready"); return; }
    const dataUrl = canvas.toDataURL("image/jpeg", 0.9);
    const a = document.createElement("a"); a.href = dataUrl; a.download = `atlas-${Date.now()}.jpg`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    showToast("JPG captured");
  }, [showToast]);

  // Sun preset (sunrise / noon / sunset)
  const setSunPreset = useCallback((preset: "sunrise" | "noon" | "sunset") => {
    const map: Record<string, { az: number; el: number }> = {
      sunrise: { az: 0.5, el: 0.55 },
      noon: { az: 0.25, el: 0.85 },
      sunset: { az: 0.0, el: 0.55 }
    };
    const v = map[preset];
    setGlobe((g) => ({ ...g, sunAzimuth: v.az, sunElevation: v.el, realTimeSun: false, timeAnim: false }));
    showToast(`Sun: ${preset}`);
  }, [showToast]);

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
            tiangongPosition={tiangongPosition}
            hubblePosition={hubblePosition}
            pins={pins}
            earthquakes={earthquakes}
            borders={borders}
            selectedPinId={selectedPin}
            dayTexture={dayTexture}
            nightTexture={nightTexture}
            pinTool={pinTool}
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
        <RailButton icon={MousePointer2} label="Orbit (default)" active={!pinTool} onClick={() => setPinTool(false)} />
        <RailButton icon={BookmarkPlus} label="Pin tool — click to drop pins" active={pinTool} onClick={() => setPinTool((v) => !v)} />
        <RailButton icon={Search} label="Search (F)" onClick={() => setShowSearch(true)} />
        <RailButton icon={Sparkles} label="Imagery (I)" active={inspectorTab === "imagery"} onClick={() => setInspectorTab("imagery")} />
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
          {pinTool && <span style={{ color: "#ffd66b" }}>Pin tool</span>}
        </div>
        <div>
          <span>{coordFormat === "dms" ? formatLatDms(cameraState.lat) : formatLat(cameraState.lat)}</span>
          <span>{coordFormat === "dms" ? formatLonDms(cameraState.lon) : formatLon(cameraState.lon)}</span>
          <span>{formatAlt(cameraState.altKm)}</span>
        </div>
      </div>

      <aside className="atlasInspector" aria-label="Inspector">
        <div className="inspectorTabs">
          <button className={inspectorTab === "imagery" ? "active" : ""} type="button" onClick={() => setInspectorTab("imagery")}>Imagery</button>
          <button className={inspectorTab === "globe" ? "active" : ""} type="button" onClick={() => setInspectorTab("globe")}>Globe</button>
          <button className={inspectorTab === "layers" ? "active" : ""} type="button" onClick={() => setInspectorTab("layers")}>Layers</button>
          <button className={inspectorTab === "bookmarks" ? "active" : ""} type="button" onClick={() => setInspectorTab("bookmarks")}>Saved</button>
          <button className={inspectorTab === "data" ? "active" : ""} type="button" onClick={() => setInspectorTab("data")}>Data</button>
        </div>

        {inspectorTab === "imagery" && (
          <ImageryPanel
            imagery={imagery}
            onUpdate={updateImagery}
            onReset={resetAllSettings}
            loading={imageryLoading}
            progress={imageryProgress}
          />
        )}

        {inspectorTab === "globe" && (
          <GlobePanel globe={globe} onUpdate={updateGlobe} onSunPreset={setSunPreset} />
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
            coordFormat={coordFormat}
            pinSearch={pinSearch}
            tourPlaying={tourPlaying}
            onPinSearch={setPinSearch}
            onSetCoordFormat={setCoordFormat}
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
            onExportPins={exportPinsJson}
            onImportPins={importPinsJson}
            onExportPinsKml={exportPinsKml}
            onExportGif={() => exportGif(60, 20)}
            onExportProject={exportProject}
            onImportProject={importProject}
            onTimelapse={runTimelapse}
            timelapseRecording={timelapse.recording}
            cameraState={cameraState}
            onFlyMyLocation={flyToMyLocation}
            onCaptureJpg={captureJpg}
            onStartTour={startPinTour}
            onStopTour={stopPinTour}
            onShowEmbed={() => setShowEmbed(true)}
          />
        )}
      </aside>

      <footer className="atlasFooter" aria-label="Status bar">
        <div className="footerCoords">
          <Compass size={12} />
          <span>{coordFormat === "dms" ? formatLatDms(cameraState.lat) : formatLat(cameraState.lat)}</span>
          <span>{coordFormat === "dms" ? formatLonDms(cameraState.lon) : formatLon(cameraState.lon)}</span>
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
          history={searchHistory}
          onSelect={(b) => { flyToBookmark(b); setShowSearch(false); }}
          onClose={() => setShowSearch(false)}
        />
      )}

      {showShortcuts && <ShortcutsModal onClose={() => setShowShortcuts(false)} />}

      {showEmbed && <EmbedModal onClose={() => setShowEmbed(false)} />}

      {showCoordInput && <CoordInputModal onSubmit={onCoordSubmit} onClose={() => setShowCoordInput(false)} />}

      {selectedPin && pins.find((p) => p.id === selectedPin) && (
        <PinInfoCard
          pin={pins.find((p) => p.id === selectedPin)!}
          onClose={() => setSelectedPin(null)}
          onDelete={(id) => deletePin(id)}
          onUpdate={updatePin}
          onFly={flyToPin}
        />
      )}

      {layers.miniMap && <MiniMap cameraState={cameraState} pins={pins} />}

      {layers.compass && <CompassWidget cameraState={cameraState} />}

      {recordingState === "recording" && (
        <div className="atlasRecordIndicator" role="status">
          <span className="atlasRecordDot" /> REC {formatSeconds(recordingSeconds)}
        </div>
      )}

      {imageryLoading && imagery.source === "live" && (
        <div className="atlasImageryStatus" role="status">
          <Sparkles size={11} />
          <span>Streaming NASA imagery… {Math.round(imageryProgress * 100)}%</span>
          <div className="atlasImageryStatusBar"><div style={{ width: `${imageryProgress * 100}%` }} /></div>
        </div>
      )}

      {exportProgress && (
        <div className="atlasExportProgress" role="status">
          <span>{exportProgress.label}</span>
          <div className="atlasExportProgressBar"><div style={{ width: `${exportProgress.pct * 100}%` }} /></div>
        </div>
      )}

      {pins.length > 0 && layers.pins && <PinsMiniList pins={pins} selectedId={selectedPin} onSelect={(id) => setSelectedPin(id)} onFly={flyToPin} onDelete={deletePin} />}

      {mode === "atlas" && cameraState.altKm < 80 && cameraState.altKm > 0 && (
        <button type="button" className="atlasSurfaceHint" onClick={switchToSurface}>
          <Mountain size={13} />
          <span>Texture's pixelated this close. Switch to Surface for real terrain →</span>
        </button>
      )}

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

function GlobePanel({ globe, onUpdate, onSunPreset }: { globe: GlobeSettings; onUpdate: (patch: Partial<GlobeSettings>) => void; onSunPreset?: (preset: "sunrise" | "noon" | "sunset") => void }) {
  return (
    <>
      <PanelSection title="Rotation" icon={RotateCcw}>
        <Slider label="Spin speed" value={globe.rotationSpeed} min={0} max={1} onChange={(v) => onUpdate({ rotationSpeed: v })} />
      </PanelSection>

      <PanelSection title="Sun position" icon={SunIcon}>
        <Slider label="Azimuth" value={globe.sunAzimuth} min={0} max={1} onChange={(v) => onUpdate({ sunAzimuth: v })} suffix="°" formatter={(v) => Math.round(v * 360).toString()} />
        <Slider label="Elevation" value={globe.sunElevation} min={0} max={1} onChange={(v) => onUpdate({ sunElevation: v })} suffix="°" formatter={(v) => `${Math.round((v - 0.5) * 180)}`} />
        {onSunPreset && (
          <div className="atlasModeRow">
            <button type="button" onClick={() => onSunPreset("sunrise")}>Sunrise</button>
            <button type="button" onClick={() => onSunPreset("noon")}>Noon</button>
            <button type="button" onClick={() => onSunPreset("sunset")}>Sunset</button>
          </div>
        )}
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
    { key: "pinPaths", label: "Great-circle pin paths", icon: Compass },
    { key: "earthquakes", label: "Earthquakes (24h, USGS)", icon: Sparkles },
    { key: "volcanoes", label: "Notable volcanoes (24)", icon: Sparkles },
    { key: "iss", label: "ISS — live position", icon: Telescope },
    { key: "tiangong", label: "Tiangong CSS — live position", icon: Telescope },
    { key: "hubble", label: "Hubble — live position", icon: Telescope },
    { key: "sun", label: "Visible sun (in space)", icon: SunIcon },
    { key: "moon", label: "Visible moon (in space)", icon: Globe2 },
    { key: "terminator", label: "Day/night terminator line", icon: Compass },
    { key: "subsolar", label: "Subsolar point (sun overhead)", icon: SunIcon },
    { key: "constellations", label: "Constellation lines (Orion etc)", icon: Sparkles },
    { key: "compass", label: "Compass / heading widget", icon: Navigation },
    { key: "miniMap", label: "Mini-map widget", icon: Compass }
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

function ImageryPanel({ imagery, onUpdate, onReset, loading, progress }: { imagery: Imagery; onUpdate: (patch: Partial<Imagery>) => void; onReset: () => void; loading: boolean; progress: number }) {
  const dayLayers = Object.values(GIBS_LAYERS).filter((l) => l.swap !== "night");
  const nightLayers = Object.values(GIBS_LAYERS).filter((l) => l.swap === "night");
  const today = todayUTC();
  const earliest = "2000-02-24";
  return (
    <>
      <PanelSection title="Imagery source" icon={Sparkles}>
        <div className="atlasModeRow" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
          <button type="button" className={imagery.source === "live" ? "active" : ""} onClick={() => onUpdate({ source: "live" })}>NASA live</button>
          <button type="button" className={imagery.source === "bundled" ? "active" : ""} onClick={() => onUpdate({ source: "bundled" })}>Bundled</button>
          <button type="button" className={imagery.source === "custom" ? "active" : ""} onClick={() => onUpdate({ source: "custom" })}>Custom URL</button>
        </div>
        {imagery.source === "live" && (
          <p className="atlasHint">Streaming real Earth imagery from NASA GIBS. Default is yesterday's MODIS true-color.</p>
        )}
        {imagery.source === "bundled" && (
          <p className="atlasHint">Using the local 2K Blue Marble texture (offline-friendly, instant).</p>
        )}
        {imagery.source === "custom" && (
          <>
            <p className="atlasHint">Paste a WMTS / XYZ tile URL pattern. Use {"{z}"}, {"{y}"}, {"{x}"} placeholders.</p>
            <input
              type="text"
              className="atlasSearchInput"
              value={imagery.customUrl ?? ""}
              onChange={(e) => onUpdate({ customUrl: e.target.value })}
              placeholder="https://tile.example.com/{z}/{y}/{x}.jpg"
              spellCheck={false}
            />
            <p className="atlasHint" style={{ fontSize: 10.5, opacity: 0.75 }}>(Custom-URL fetching is read as informational here; the GIBS pipeline is what's actively fetched. Switch to "NASA live" or "Bundled" for the rendered Earth.)</p>
          </>
        )}
        <button type="button" className="atlasPrimaryBtn small" style={{ background: "transparent", color: "#ff8a8a", marginTop: 8 }} onClick={onReset}>
          Reset all settings to defaults
        </button>
      </PanelSection>

      {imagery.source === "live" && (
        <>
          <PanelSection title="Day product" icon={SunIcon}>
            <select className="atlasSelect" value={imagery.layerId} onChange={(e) => onUpdate({ layerId: e.target.value })}>
              {dayLayers.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
            <p className="atlasHint">{GIBS_LAYERS[imagery.layerId]?.description ?? ""}</p>
          </PanelSection>

          <PanelSection title="Night product" icon={Globe2}>
            <select className="atlasSelect" value={imagery.nightLayerId} onChange={(e) => onUpdate({ nightLayerId: e.target.value })}>
              {nightLayers.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
            <p className="atlasHint">{GIBS_LAYERS[imagery.nightLayerId]?.description ?? ""}</p>
          </PanelSection>

          <PanelSection title="Date" icon={Compass}>
            <input
              type="date"
              className="atlasSelect"
              min={earliest}
              max={today}
              value={imagery.date}
              onChange={(e) => onUpdate({ date: e.target.value })}
            />
            <div className="atlasModeRow" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
              <button type="button" onClick={() => {
                const d = new Date(imagery.date + "T00:00:00Z");
                d.setUTCDate(d.getUTCDate() - 1);
                onUpdate({ date: d.toISOString().slice(0, 10) });
              }}>−1d</button>
              <button type="button" onClick={() => onUpdate({ date: today })}>Today</button>
              <button type="button" onClick={() => {
                const d = new Date(imagery.date + "T00:00:00Z");
                d.setUTCDate(d.getUTCDate() + 1);
                const next = d.toISOString().slice(0, 10);
                if (next <= today) onUpdate({ date: next });
              }}>+1d</button>
            </div>
            <p className="atlasHint">Drag the date back to see imagery from any day since 2000.</p>
          </PanelSection>

          <PanelSection title="Quality" icon={Camera}>
            <div className="atlasModeRow">
              <button type="button" className={imagery.zoom === 2 ? "active" : ""} onClick={() => onUpdate({ zoom: 2 })}>SD (32 tiles)</button>
              <button type="button" className={imagery.zoom === 3 ? "active" : ""} onClick={() => onUpdate({ zoom: 3 })}>HD (128)</button>
              <button type="button" className={imagery.zoom === 4 ? "active" : ""} onClick={() => onUpdate({ zoom: 4 })}>UHD (512)</button>
            </div>
            {loading && (
              <div className="atlasImageryProgress">
                <span>Streaming tiles… {Math.round(progress * 100)}%</span>
                <div className="atlasImageryBar"><div style={{ width: `${progress * 100}%` }} /></div>
              </div>
            )}
          </PanelSection>
        </>
      )}
    </>
  );
}

function DataPanel({ pins, earthquakes, coordFormat, pinSearch, tourPlaying, onPinSearch, onSetCoordFormat, onSelectPin, onFlyPin, onDeletePin, onClearPins, onCapture, onStartRecord, onStopRecord, recordingState, recordingSeconds, onCopyShare, onOpenCoord, onExportPins, onImportPins, onExportPinsKml, onExportGif, onExportProject, onImportProject, onTimelapse, timelapseRecording, cameraState, onFlyMyLocation, onCaptureJpg, onStartTour, onStopTour, onShowEmbed }: {
  pins: Pin[];
  earthquakes: Earthquake[];
  coordFormat: "decimal" | "dms";
  pinSearch: string;
  tourPlaying: boolean;
  onPinSearch: (q: string) => void;
  onSetCoordFormat: (m: "decimal" | "dms") => void;
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
  onExportPins: () => void;
  onImportPins: (file: File) => void;
  onExportPinsKml: () => void;
  onExportGif: () => void;
  onExportProject: () => void;
  onImportProject: (file: File) => void;
  onTimelapse: (days: number, fps: number) => void;
  timelapseRecording: boolean;
  cameraState: CameraState;
  onFlyMyLocation: () => void;
  onCaptureJpg: () => void;
  onStartTour: () => void;
  onStopTour: () => void;
  onShowEmbed: () => void;
}) {
  const filteredPins = useMemo(() => {
    const q = pinSearch.trim().toLowerCase();
    if (!q) return pins;
    return pins.filter((p) => p.label.toLowerCase().includes(q) || (p.note ?? "").toLowerCase().includes(q));
  }, [pins, pinSearch]);
  const stats = useMemo(() => {
    const big = earthquakes.filter((q) => q.mag >= 5).length;
    const med = earthquakes.filter((q) => q.mag >= 3.5 && q.mag < 5).length;
    const small = earthquakes.filter((q) => q.mag < 3.5).length;
    return { big, med, small };
  }, [earthquakes]);
  return (
    <>
      <PanelSection title="Display" icon={Compass}>
        <div className="atlasModeRow" style={{ gridTemplateColumns: "1fr 1fr" }}>
          <button type="button" className={coordFormat === "decimal" ? "active" : ""} onClick={() => onSetCoordFormat("decimal")}>Decimal</button>
          <button type="button" className={coordFormat === "dms" ? "active" : ""} onClick={() => onSetCoordFormat("dms")}>DMS</button>
        </div>
        <p className="atlasHint">Coordinate format: {coordFormat === "decimal" ? "DD.DD°" : "D° M' S\""}</p>
      </PanelSection>

      <PanelSection title="Statistics" icon={Sparkles}>
        <div className="atlasStatsGrid">
          <div className="atlasStatItem"><strong>{pins.length}</strong><span>Pins</span></div>
          <div className="atlasStatItem"><strong>{earthquakes.length}</strong><span>Quakes (24h)</span></div>
          <div className="atlasStatItem" style={{ color: "#ff5a5a" }}><strong>{stats.big}</strong><span>Mag ≥ 5</span></div>
          <div className="atlasStatItem" style={{ color: "#ffb84d" }}><strong>{stats.med}</strong><span>Mag 3.5–5</span></div>
          <div className="atlasStatItem"><strong>{cameraState.altKm > 1000 ? `${(cameraState.altKm / 1000).toFixed(1)}k` : cameraState.altKm.toFixed(0)}</strong><span>Altitude (km)</span></div>
        </div>
      </PanelSection>

      <PanelSection title={`Pins (${filteredPins.length}${filteredPins.length !== pins.length ? `/${pins.length}` : ""})`} icon={Bookmark}>
        {pins.length === 0 && <p className="atlasHint">Switch to Pin tool in the rail (or hold Shift) and click the globe to drop a pin.</p>}
        {pins.length > 0 && (
          <input
            type="text"
            className="atlasSearchInput"
            value={pinSearch}
            onChange={(e) => onPinSearch(e.target.value)}
            placeholder="Filter pins by name or note…"
          />
        )}
        {pins.length > 0 && (
          <ul className="atlasBookmarkList">
            {filteredPins.map((p) => (
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
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {pins.length > 0 && (
            <button type="button" className="atlasPrimaryBtn small" style={{ background: "transparent", color: "#ff8a8a" }} onClick={onClearPins}>
              <Trash2 size={12} /> Clear
            </button>
          )}
          {pins.length > 0 && (
            <button type="button" className="atlasPrimaryBtn small" style={{ background: "transparent" }} onClick={onExportPins}>
              <Bookmark size={12} /> Export
            </button>
          )}
          <label className="atlasPrimaryBtn small" style={{ background: "transparent", cursor: "pointer" }}>
            <BookmarkPlus size={12} /> Import
            <input type="file" accept="application/json" style={{ display: "none" }} onChange={(e) => { const f = e.target.files?.[0]; if (f) onImportPins(f); e.currentTarget.value = ""; }} />
          </label>
          {pins.length > 0 && (
            <button type="button" className="atlasPrimaryBtn small" style={{ background: "transparent" }} onClick={onExportPinsKml}>
              <Bookmark size={12} /> KML
            </button>
          )}
        </div>
        {pins.length >= 2 && (
          <button type="button" className="atlasPrimaryBtn small" onClick={tourPlaying ? onStopTour : onStartTour}>
            {tourPlaying ? <Square size={12} /> : <Play size={12} />}
            {tourPlaying ? "Stop tour" : "Start pin tour"}
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
          <button type="button" className="atlasPrimaryBtn small" onClick={() => onCapture(1)}><Camera size={12} /> PNG 1×</button>
          <button type="button" className="atlasPrimaryBtn small" onClick={() => onCapture(2)}><Camera size={12} /> 2×</button>
          <button type="button" className="atlasPrimaryBtn small" onClick={() => onCapture(4)}><Camera size={12} /> 4×</button>
          <button type="button" className="atlasPrimaryBtn small" style={{ background: "transparent" }} onClick={onCaptureJpg}><Camera size={12} /> JPG</button>
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
        <button type="button" className="atlasPrimaryBtn small" style={{ background: "transparent" }} onClick={onExportGif}>
          <Wand2 size={12} /> Export GIF (3s, 20fps)
        </button>
      </PanelSection>

      <PanelSection title="Time-lapse" icon={Telescope}>
        <p className="atlasHint">Scrub the imagery date back N days and capture each frame as a GIF.</p>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <button type="button" className="atlasPrimaryBtn small" onClick={() => onTimelapse(7, 6)} disabled={timelapseRecording}>{timelapseRecording ? "Recording…" : "Last 7 days"}</button>
          <button type="button" className="atlasPrimaryBtn small" onClick={() => onTimelapse(30, 8)} disabled={timelapseRecording}>{timelapseRecording ? "Recording…" : "Last 30 days"}</button>
          <button type="button" className="atlasPrimaryBtn small" onClick={() => onTimelapse(90, 10)} disabled={timelapseRecording}>{timelapseRecording ? "Recording…" : "Last 90 days"}</button>
        </div>
      </PanelSection>

      <PanelSection title="Project" icon={Bookmark}>
        <p className="atlasHint">Save the entire app state — layers, pins, imagery, camera — as a JSON project file.</p>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <button type="button" className="atlasPrimaryBtn small" onClick={onExportProject}>
            <BookmarkPlus size={12} /> Export project
          </button>
          <label className="atlasPrimaryBtn small" style={{ cursor: "pointer" }}>
            <Bookmark size={12} /> Import project
            <input type="file" accept="application/json" style={{ display: "none" }} onChange={(e) => { const f = e.target.files?.[0]; if (f) onImportProject(f); e.currentTarget.value = ""; }} />
          </label>
        </div>
      </PanelSection>

      <PanelSection title="Tools" icon={Compass}>
        <button type="button" className="atlasPrimaryBtn small" onClick={onFlyMyLocation}><Navigation size={12} /> Fly to my location</button>
        <button type="button" className="atlasPrimaryBtn small" onClick={onOpenCoord}><Navigation size={12} /> Fly to coordinates</button>
        <button type="button" className="atlasPrimaryBtn small" onClick={onCopyShare}><Share2 size={12} /> Copy share URL with view</button>
        <button type="button" className="atlasPrimaryBtn small" onClick={onShowEmbed}><Share2 size={12} /> Embed iframe snippet</button>
      </PanelSection>
    </>
  );
}

function EmbedModal({ onClose }: { onClose: () => void }) {
  const url = window.location.origin + window.location.pathname + window.location.hash;
  const html = `<iframe src="${url}" width="800" height="600" style="border:0;border-radius:12px" allow="autoplay; fullscreen; geolocation" title="Atlas Globe"></iframe>`;
  const [copied, setCopied] = useState<"url" | "html" | null>(null);
  const copy = async (text: string, kind: "url" | "html") => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(kind);
      setTimeout(() => setCopied(null), 1500);
    } catch {/* ignore */}
  };
  return (
    <div className="atlasModalShade" onClick={onClose} role="dialog" aria-modal="true">
      <div className="atlasShortcutsModal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 540 }}>
        <div className="atlasModalHead">
          <strong>Embed snippet</strong>
          <button type="button" className="atlasIconBtn" onClick={onClose} aria-label="Close"><X size={14} /></button>
        </div>
        <p className="atlasHint" style={{ marginBottom: 8 }}>Direct URL — opens this exact view in any browser.</p>
        <textarea readOnly value={url} className="atlasPinNote" style={{ fontFamily: "ui-monospace, monospace", fontSize: 11, minHeight: 40 }} />
        <button type="button" className="atlasPrimaryBtn small" style={{ marginTop: 6 }} onClick={() => copy(url, "url")}>
          {copied === "url" ? "Copied!" : "Copy URL"}
        </button>
        <p className="atlasHint" style={{ marginTop: 14, marginBottom: 8 }}>HTML embed snippet — paste into any page.</p>
        <textarea readOnly value={html} className="atlasPinNote" style={{ fontFamily: "ui-monospace, monospace", fontSize: 11, minHeight: 80 }} />
        <button type="button" className="atlasPrimaryBtn small" style={{ marginTop: 6 }} onClick={() => copy(html, "html")}>
          {copied === "html" ? "Copied!" : "Copy embed HTML"}
        </button>
      </div>
    </div>
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
  history,
  onSelect,
  onClose
}: {
  query: string;
  onQuery: (s: string) => void;
  results: Bookmark[];
  searching: boolean;
  suggestions: string[];
  history: string[];
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
          {!query.trim() && history.length > 0 && (
            <>
              <li className="atlasSearchEmpty" style={{ textAlign: "left", padding: "8px 12px", color: "#6f7c91", fontSize: "10.5px", textTransform: "uppercase", letterSpacing: "0.06em" }}>Recent searches</li>
              {history.map((h) => (
                <li key={`h-${h}`}>
                  <button type="button" onClick={() => onQuery(h)}>
                    <Search size={12} />
                    <div><strong>{h}</strong><span style={{ opacity: 0.6 }}>tap to search again</span></div>
                  </button>
                </li>
              ))}
            </>
          )}
          {results.length === 0 && !searching && query.trim() && <li className="atlasSearchEmpty">{query.trim().length < 3 ? "Type at least 3 characters…" : "No matches."}</li>}
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

function PinInfoCard({ pin, onClose, onDelete, onUpdate, onFly }: { pin: Pin; onClose: () => void; onDelete: (id: string) => void; onUpdate: (id: string, patch: Partial<Pin>) => void; onFly: (p: Pin) => void }) {
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(pin.label);
  const [note, setNote] = useState(pin.note ?? "");
  useEffect(() => { setLabel(pin.label); }, [pin.label]);
  useEffect(() => { setNote(pin.note ?? ""); }, [pin.note]);
  const localTimeMs = Date.now() + (pin.lon / 15) * 3600 * 1000;
  const localTime = new Date(localTimeMs).toUTCString().split(" ").slice(4, 5)[0];
  const sun = solarTimes(pin.lat, pin.lon, new Date());
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
            onBlur={() => { onUpdate(pin.id, { label: label || pin.label }); setEditing(false); }}
            onKeyDown={(e) => { if (e.key === "Enter") { onUpdate(pin.id, { label: label || pin.label }); setEditing(false); } if (e.key === "Escape") { setLabel(pin.label); setEditing(false); } }}
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
        {sun !== "polar-day" && sun !== "polar-night" && (
          <>
            <div><span>Sunrise</span><strong>{formatHour(sun.sunrise)}</strong></div>
            <div><span>Sunset</span><strong>{formatHour(sun.sunset)}</strong></div>
            <div><span>Day length</span><strong>{(((sun.sunset - sun.sunrise) + 24) % 24).toFixed(2)}h</strong></div>
          </>
        )}
        {sun === "polar-day" && <div><span>Today</span><strong>Polar day (sun never sets)</strong></div>}
        {sun === "polar-night" && <div><span>Today</span><strong>Polar night (sun never rises)</strong></div>}
      </div>
      <div className="atlasPinColors">
        {PIN_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            className={pin.color === c ? "atlasPinSwatch active" : "atlasPinSwatch"}
            style={{ background: c }}
            onClick={() => onUpdate(pin.id, { color: c })}
            aria-label={`Color ${c}`}
          />
        ))}
      </div>
      <textarea
        className="atlasPinNote"
        value={note}
        placeholder="Notes…"
        onChange={(e) => setNote(e.target.value)}
        onBlur={() => onUpdate(pin.id, { note })}
      />
      <div className="atlasPinActions">
        <button type="button" className="atlasPrimaryBtn small" onClick={() => onFly(pin)}><Navigation size={11} /> Fly</button>
        <button type="button" className="atlasPrimaryBtn small" style={{ background: "transparent" }} onClick={() => copy(`${pin.lat}, ${pin.lon}`)}><Bookmark size={11} /> Copy</button>
        <button type="button" className="atlasPrimaryBtn small" style={{ background: "transparent", color: "#ff8a8a" }} onClick={() => onDelete(pin.id)}><Trash2 size={11} /> Delete</button>
      </div>
    </div>
  );
}

function CompassWidget({ cameraState }: { cameraState: CameraState }) {
  // Compass shows where camera "north" points relative to the globe.
  // For our orbit camera looking at origin, "up" in world is also screen-up,
  // and north is at lat=90. Compute screen rotation from camera pos.
  const rotDeg = -cameraState.lon; // rough heading indicator (longitude shift)
  return (
    <div className="atlasCompass" aria-label="Compass">
      <div className="atlasCompassRose" style={{ transform: `rotate(${rotDeg}deg)` }}>
        <span className="n">N</span>
        <span className="e">E</span>
        <span className="s">S</span>
        <span className="w">W</span>
        <span className="needle" />
      </div>
    </div>
  );
}

function MiniMap({ cameraState, pins }: { cameraState: CameraState; pins: Pin[] }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const dayUrl = `${import.meta.env.BASE_URL}textures/earth_day.jpg`;
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const img = new Image();
    img.onload = () => {
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      // Re-draw markers + camera position over the image
      drawOverlay(ctx, canvas.width, canvas.height, cameraState, pins);
    };
    img.src = dayUrl;
    // If already cached, draw overlay immediately too
    if (img.complete) drawOverlay(ctx, canvas.width, canvas.height, cameraState, pins);
  }, [dayUrl, cameraState, pins]);

  return (
    <div className="atlasMiniMap" aria-label="Mini map">
      <canvas ref={canvasRef} width={220} height={110} />
      <div className="atlasMiniMapLabel">{formatLat(cameraState.lat)} {formatLon(cameraState.lon)}</div>
    </div>
  );
}

function drawOverlay(ctx: CanvasRenderingContext2D, w: number, h: number, cam: CameraState, pins: Pin[]) {
  // Dim the texture
  ctx.fillStyle = "rgba(0, 10, 25, 0.55)";
  ctx.fillRect(0, 0, w, h);
  // Pins
  for (const p of pins) {
    const x = ((p.lon + 180) / 360) * w;
    const y = ((90 - p.lat) / 180) * h;
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(x, y, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }
  // Camera position
  const cx = ((cam.lon + 180) / 360) * w;
  const cy = ((90 - cam.lat) / 180) * h;
  ctx.strokeStyle = "#5cb5ff";
  ctx.lineWidth = 1.5;
  ctx.shadowColor = "#5cb5ff";
  ctx.shadowBlur = 10;
  ctx.beginPath();
  ctx.arc(cx, cy, 5, 0, Math.PI * 2);
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.fillStyle = "#5cb5ff";
  ctx.beginPath();
  ctx.arc(cx, cy, 1.5, 0, Math.PI * 2);
  ctx.fill();
  // Crosshair lines
  ctx.strokeStyle = "rgba(92, 181, 255, 0.4)";
  ctx.lineWidth = 0.5;
  ctx.setLineDash([2, 3]);
  ctx.beginPath(); ctx.moveTo(cx, 0); ctx.lineTo(cx, h); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0, cy); ctx.lineTo(w, cy); ctx.stroke();
  ctx.setLineDash([]);
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
  tiangongPosition,
  hubblePosition,
  pins,
  earthquakes,
  borders,
  selectedPinId,
  dayTexture,
  nightTexture,
  pinTool,
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
  tiangongPosition: { lat: number; lon: number } | null;
  hubblePosition: { lat: number; lon: number } | null;
  pins: Pin[];
  earthquakes: Earthquake[];
  borders: Float32Array | null;
  selectedPinId: string | null;
  dayTexture: THREE.Texture | null;
  nightTexture: THREE.Texture | null;
  pinTool: boolean;
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
      camera={{ position: [0, 0, SPACE_DISTANCE], fov: 55, near: 0.0001, far: 2000 }}
      gl={{ antialias: true, powerPreference: "high-performance", preserveDrawingBuffer: true, logarithmicDepthBuffer: true }}
      frameloop="always"
      resize={{ scroll: false, debounce: { scroll: 50, resize: 0 } }}
    >
      <color attach="background" args={["#04060c"]} />
      <Suspense fallback={null}>
        <ExposureBridge exposure={globe.exposure} />
        <ambientLight intensity={0.05} />
        <SunLight azimuth={globe.sunAzimuth} elevation={globe.sunElevation} />
        <EarthGroup globe={globe} paused={paused}>
          <Earth globe={globe} layers={layers} sunDirection={sunDirection} dayOverride={dayTexture} nightOverride={nightTexture} pinTool={pinTool} onClick={onGlobeClick} />
          {layers.borders && borders && <Borders positions={borders} />}
          {layers.graticule && <Graticule />}
          {layers.cardinals && <Cardinals />}
          {layers.timezones && <TimeZoneBands />}
          {layers.earthquakes && <EarthquakeMarkers data={earthquakes} />}
          {layers.volcanoes && <VolcanoMarkers />}
          {layers.pinPaths && <PinPaths pins={pins} sunDirection={sunDirection} />}
          {layers.pins && <PinMarkers pins={pins} selectedId={selectedPinId} onSelect={onSelectPin} />}
          {layers.terminator && <TerminatorRing sunDirection={sunDirection} />}
          {layers.subsolar && <SubsolarPoint sunDirection={sunDirection} />}
        </EarthGroup>
        {layers.sun && <SunMesh azimuth={globe.sunAzimuth} elevation={globe.sunElevation} />}
        {layers.moon && <MoonMesh />}
        {layers.constellations && <ConstellationLines />}
        {layers.atmosphere && <Atmosphere intensity={globe.atmosphereIntensity} />}
        {layers.clouds && <Clouds opacity={globe.cloudOpacity} paused={paused} />}
        {layers.stars && <Stars radius={120} depth={50} count={4500} factor={4} saturation={0} fade speed={0.5} />}
        {layers.iss && issPosition && <ISSMarker lat={issPosition.lat} lon={issPosition.lon} />}
        {layers.tiangong && tiangongPosition && <TiangongMarker lat={tiangongPosition.lat} lon={tiangongPosition.lon} />}
        {layers.hubble && hubblePosition && <HubbleMarker lat={hubblePosition.lat} lon={hubblePosition.lon} />}
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

function SunMesh({ azimuth, elevation }: { azimuth: number; elevation: number }) {
  const pos = useMemo(() => sunPosition(azimuth, elevation, 50), [azimuth, elevation]);
  return (
    <mesh position={pos}>
      <sphereGeometry args={[2.4, 24, 24]} />
      <meshBasicMaterial color="#fff5cc" />
    </mesh>
  );
}

function TerminatorRing({ sunDirection }: { sunDirection: THREE.Vector3 }) {
  const ref = useRef<THREE.LineSegments>(null);
  const geom = useMemo(() => {
    // 64 points on the great circle perpendicular to sun direction
    const points: number[] = [];
    const segments = 96;
    for (let i = 0; i < segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      const b = ((i + 1) / segments) * Math.PI * 2;
      const p1 = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
      const p2 = new THREE.Vector3(Math.cos(b), 0, Math.sin(b));
      points.push(p1.x, p1.y, p1.z, p2.x, p2.y, p2.z);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(points), 3));
    return g;
  }, []);
  useEffect(() => () => geom.dispose(), [geom]);
  useFrame(() => {
    if (!ref.current) return;
    // Orient ring perpendicular to sunDirection
    const sd = sunDirection.clone().normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), sd);
    ref.current.quaternion.copy(q);
    ref.current.scale.setScalar(1.003);
  });
  return (
    <lineSegments ref={ref} geometry={geom}>
      <lineBasicMaterial color="#ffd66b" transparent opacity={0.55} depthWrite={false} />
    </lineSegments>
  );
}

function SubsolarPoint({ sunDirection }: { sunDirection: THREE.Vector3 }) {
  // The point on Earth where sun is directly overhead = sunDirection projected to sphere surface
  const ref = useRef<THREE.Mesh>(null);
  const ringRef = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    const sd = sunDirection.clone().normalize().multiplyScalar(1.005);
    ref.current.position.copy(sd);
    if (ringRef.current) {
      ringRef.current.position.copy(sd);
      const t = clock.elapsedTime;
      ringRef.current.scale.setScalar(1 + Math.sin(t * 2) * 0.25);
      // Orient ring tangent to surface at this point
      ringRef.current.lookAt(0, 0, 0);
    }
  });
  return (
    <group>
      <mesh ref={ref}>
        <sphereGeometry args={[0.013, 16, 16]} />
        <meshBasicMaterial color="#ffd66b" />
      </mesh>
      <mesh ref={ringRef}>
        <ringGeometry args={[0.022, 0.030, 32]} />
        <meshBasicMaterial color="#ffd66b" transparent opacity={0.7} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

// Major constellation patterns simplified (RA/Dec → projected to a fixed star sphere at radius 100)
const CONSTELLATIONS: { name: string; lines: Array<[number, number, number, number]> }[] = [
  // Each line is [ra1Hr, dec1Deg, ra2Hr, dec2Deg]
  {
    name: "Orion",
    lines: [
      [5.92, 7.4, 5.55, -1.2],   // Betelgeuse to Alnitak
      [5.55, -1.2, 5.42, -8.2],   // Alnitak to Saiph
      [5.42, -8.2, 5.24, -8.2],   // Saiph to Rigel
      [5.24, -8.2, 5.92, 7.4],   // Rigel to Betelgeuse
      [5.68, -1.9, 5.6, -1.2],   // Belt
      [5.6, -1.2, 5.55, -1.2]
    ]
  },
  {
    name: "Big Dipper",
    lines: [
      [11.06, 61.75, 11.9, 53.7],
      [11.9, 53.7, 12.26, 57.03],
      [12.26, 57.03, 12.9, 55.96],
      [12.9, 55.96, 13.4, 54.93],
      [13.4, 54.93, 13.79, 49.31],
      [13.79, 49.31, 13.4, 54.93]
    ]
  },
  {
    name: "Cassiopeia",
    lines: [
      [0.13, 59.15, 0.67, 56.54],
      [0.67, 56.54, 0.95, 60.72],
      [0.95, 60.72, 1.43, 60.24],
      [1.43, 60.24, 1.91, 63.67]
    ]
  },
  {
    name: "Southern Cross",
    lines: [
      [12.44, -63.1, 12.79, -59.69],
      [12.79, -59.69, 12.52, -57.11],
      [12.52, -57.11, 12.42, -60.4],
      [12.42, -60.4, 12.44, -63.1]
    ]
  }
];

function raDecToVec3(raHours: number, decDeg: number, radius: number): THREE.Vector3 {
  const ra = (raHours / 24) * Math.PI * 2;
  const dec = (decDeg / 180) * Math.PI;
  return new THREE.Vector3(
    Math.cos(dec) * Math.cos(ra) * radius,
    Math.sin(dec) * radius,
    Math.cos(dec) * Math.sin(ra) * radius
  );
}

function ConstellationLines() {
  const geom = useMemo(() => {
    const positions: number[] = [];
    for (const c of CONSTELLATIONS) {
      for (const line of c.lines) {
        const a = raDecToVec3(line[0], line[1], 100);
        const b = raDecToVec3(line[2], line[3], 100);
        positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(positions), 3));
    return g;
  }, []);
  useEffect(() => () => geom.dispose(), [geom]);
  return (
    <lineSegments geometry={geom}>
      <lineBasicMaterial color="#5cb5ff" transparent opacity={0.45} depthWrite={false} />
    </lineSegments>
  );
}

function MoonMesh() {
  const ref = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    const t = clock.elapsedTime;
    ref.current.rotation.y = t * 0.04;
  });
  return (
    <group ref={ref}>
      <mesh position={[15, 1.5, 0]}>
        <sphereGeometry args={[0.27, 24, 24]} />
        <meshStandardMaterial color="#aaaaaa" emissive="#222222" roughness={1} />
      </mesh>
    </group>
  );
}

function PinPaths({ pins, sunDirection }: { pins: Pin[]; sunDirection: THREE.Vector3 }) {
  void sunDirection;
  const positions = useMemo(() => {
    if (pins.length < 2) return null;
    const arr: number[] = [];
    for (let i = 0; i < pins.length - 1; i++) {
      const a = latLonToVec3(pins[i].lat, pins[i].lon, 1.005);
      const b = latLonToVec3(pins[i + 1].lat, pins[i + 1].lon, 1.005);
      const angle = a.angleTo(b);
      const steps = Math.max(8, Math.ceil(angle * 24));
      for (let s = 0; s < steps; s++) {
        const t1 = s / steps;
        const t2 = (s + 1) / steps;
        const p1 = slerp(a, b, t1).multiplyScalar(1.005);
        const p2 = slerp(a, b, t2).multiplyScalar(1.005);
        arr.push(p1.x, p1.y, p1.z, p2.x, p2.y, p2.z);
      }
    }
    return new Float32Array(arr);
  }, [pins]);
  const geom = useMemo(() => {
    if (!positions) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    return g;
  }, [positions]);
  useEffect(() => () => geom?.dispose(), [geom]);
  if (!geom) return null;
  return (
    <lineSegments geometry={geom}>
      <lineBasicMaterial color="#5cb5ff" transparent opacity={0.7} depthWrite={false} />
    </lineSegments>
  );
}

function slerp(a: THREE.Vector3, b: THREE.Vector3, t: number): THREE.Vector3 {
  const an = a.clone().normalize();
  const bn = b.clone().normalize();
  const dot = THREE.MathUtils.clamp(an.dot(bn), -1, 1);
  const omega = Math.acos(dot);
  if (omega < 1e-6) return an.lerp(bn, t);
  const sinO = Math.sin(omega);
  const wa = Math.sin((1 - t) * omega) / sinO;
  const wb = Math.sin(t * omega) / sinO;
  return new THREE.Vector3(an.x * wa + bn.x * wb, an.y * wa + bn.y * wb, an.z * wa + bn.z * wb);
}

function SatelliteMarker({ lat, lon, altitudeKm, color }: { lat: number; lon: number; altitudeKm: number; color: string }) {
  const altitude = 1 + altitudeKm / EARTH_RADIUS_KM;
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
        <meshBasicMaterial color={color} />
      </mesh>
      <mesh ref={ring} rotation={[Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.022, 0.028, 32]} />
        <meshBasicMaterial color={color} transparent opacity={0.6} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

function ISSMarker({ lat, lon }: { lat: number; lon: number }) {
  return <SatelliteMarker lat={lat} lon={lon} altitudeKm={408} color="#ffd66b" />;
}

function TiangongMarker({ lat, lon }: { lat: number; lon: number }) {
  return <SatelliteMarker lat={lat} lon={lon} altitudeKm={400} color="#ff5a8a" />;
}

function HubbleMarker({ lat, lon }: { lat: number; lon: number }) {
  return <SatelliteMarker lat={lat} lon={lon} altitudeKm={540} color="#5cb5ff" />;
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
  dayOverride,
  nightOverride,
  pinTool,
  onClick
}: {
  globe: GlobeSettings;
  layers: LayerVisibility;
  sunDirection: THREE.Vector3;
  dayOverride: THREE.Texture | null;
  nightOverride: THREE.Texture | null;
  pinTool: boolean;
  onClick: (lat: number, lon: number) => void;
}) {
  const ref = useRef<THREE.Mesh>(null);
  const matRef = useRef<THREE.ShaderMaterial>(null);
  const [bundledDay, bundledNight, specular] = useTexture([
    `${import.meta.env.BASE_URL}textures/earth_day.jpg`,
    `${import.meta.env.BASE_URL}textures/earth_night.jpg`,
    `${import.meta.env.BASE_URL}textures/earth_specular.jpg`
  ]);

  useEffect(() => {
    [bundledDay, bundledNight, specular].forEach((tex) => {
      tex.anisotropy = 8;
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.ClampToEdgeWrapping;
    });
    bundledDay.colorSpace = THREE.SRGBColorSpace;
    bundledNight.colorSpace = THREE.SRGBColorSpace;
    specular.colorSpace = THREE.NoColorSpace;
  }, [bundledDay, bundledNight, specular]);

  const day = dayOverride ?? bundledDay;
  const night = nightOverride ?? bundledNight;

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
      // keep textures in sync if they swap
      u.uDayMap.value = day;
      u.uNightMap.value = night;
    }
  });

  const downStateRef = useRef<{ x: number; y: number; t: number; shift: boolean; meta: boolean; point: THREE.Vector3 } | null>(null);

  const handlePointerDown = (event: any) => {
    if (event.button !== undefined && event.button !== 0) return;
    downStateRef.current = {
      x: event.clientX,
      y: event.clientY,
      t: performance.now(),
      shift: event.shiftKey,
      meta: event.metaKey || event.ctrlKey,
      point: event.point.clone()
    };
  };

  const handlePointerUp = (event: any) => {
    if (event.button !== undefined && event.button !== 0) return;
    const down = downStateRef.current;
    downStateRef.current = null;
    if (!down || !ref.current) return;
    const dx = event.clientX - down.x;
    const dy = event.clientY - down.y;
    const dt = performance.now() - down.t;
    const movedPx = Math.sqrt(dx * dx + dy * dy);
    const isClickLike = movedPx < 5 && dt < 350;
    if (!isClickLike) return;
    // Pin drop conditions: pin-tool mode OR Shift held OR Ctrl/Cmd held
    const shouldDrop = pinTool || down.shift || down.meta;
    if (!shouldDrop) return;
    event.stopPropagation();
    const local = down.point.clone();
    ref.current.worldToLocal(local);
    const { lat, lon } = pointToLatLon(local);
    onClick(lat, lon);
  };

  if (globe.renderMode === "wireframe") {
    return (
      <mesh ref={ref} onPointerDown={handlePointerDown} onPointerUp={handlePointerUp}>
        <sphereGeometry args={[1, 64, 64]} />
        <meshBasicMaterial color="#5cb5ff" wireframe transparent opacity={0.45} />
      </mesh>
    );
  }
  if (globe.renderMode === "blueprint") {
    return (
      <mesh ref={ref} onPointerDown={handlePointerDown} onPointerUp={handlePointerUp}>
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

function VolcanoMarkers() {
  const groupRef = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (!groupRef.current) return;
    const t = clock.elapsedTime;
    groupRef.current.children.forEach((child, i) => {
      const phase = (t * 0.8 + i * 0.4) % 2;
      child.scale.setScalar(1 + Math.max(0, 1 - phase) * 0.6);
    });
  });
  return (
    <group ref={groupRef}>
      {FAMOUS_VOLCANOES.map((v) => {
        const pos = latLonToVec3(v.lat, v.lon, 1.004);
        return (
          <mesh key={v.id} position={pos}>
            <coneGeometry args={[0.008, 0.018, 6]} />
            <meshBasicMaterial color="#ff6a3d" transparent opacity={0.9} />
          </mesh>
        );
      })}
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

      // Adaptive rotate speed: slow down as we get close to surface
      if (controlsRef.current) {
        const altT = THREE.MathUtils.clamp((distance - 1) / 3, 0, 1);
        controlsRef.current.rotateSpeed = 0.05 + altT * 0.55;
      }
    }
  });

  return (
    <OrbitControls
      ref={controlsRef}
      enableDamping
      dampingFactor={0.12}
      enablePan={false}
      rotateSpeed={0.45}
      zoomSpeed={1.1}
      zoomToCursor
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

function formatLatDms(lat: number) {
  const dir = lat >= 0 ? "N" : "S";
  const a = Math.abs(lat);
  const d = Math.floor(a);
  const mFloat = (a - d) * 60;
  const m = Math.floor(mFloat);
  const s = ((mFloat - m) * 60).toFixed(1);
  return `${d}° ${m}' ${s}" ${dir}`;
}

function formatLonDms(lon: number) {
  const norm = ((lon + 540) % 360) - 180;
  const dir = norm >= 0 ? "E" : "W";
  const a = Math.abs(norm);
  const d = Math.floor(a);
  const mFloat = (a - d) * 60;
  const m = Math.floor(mFloat);
  const s = ((mFloat - m) * 60).toFixed(1);
  return `${d}° ${m}' ${s}" ${dir}`;
}

// Sun rise/set/solar-noon for given lat/lon on given date
// Returns { sunrise, sunset, solarNoon } as UTC-hour decimals (0-24), or null if polar day/night
function solarTimes(lat: number, lon: number, date: Date): { sunrise: number; sunset: number; solarNoon: number } | "polar-day" | "polar-night" {
  const start = Date.UTC(date.getUTCFullYear(), 0, 0);
  const dayOfYear = Math.floor((date.getTime() - start) / 86400000);
  const decl = THREE.MathUtils.degToRad(23.45 * Math.sin(THREE.MathUtils.degToRad((360 / 365) * (dayOfYear - 81))));
  const latRad = THREE.MathUtils.degToRad(lat);
  // Hour-angle of sunrise/sunset
  const cosH = -Math.tan(latRad) * Math.tan(decl);
  if (cosH > 1) return "polar-night";
  if (cosH < -1) return "polar-day";
  const H = THREE.MathUtils.radToDeg(Math.acos(cosH)); // degrees
  const solarNoon = 12 - lon / 15;
  const sunrise = solarNoon - H / 15;
  const sunset = solarNoon + H / 15;
  return { sunrise: ((sunrise % 24) + 24) % 24, sunset: ((sunset % 24) + 24) % 24, solarNoon: ((solarNoon % 24) + 24) % 24 };
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function formatHour(h: number) {
  const hh = Math.floor(h);
  const mm = Math.round((h - hh) * 60);
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")} UTC`;
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

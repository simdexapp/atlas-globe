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
  Film,
  Globe2,
  Layers,
  Maximize2,
  MousePointer2,
  Mountain,
  Navigation,
  Pause,
  Plane,
  Play,
  RotateCcw,
  Search,
  Share2,
  Sparkles,
  SkipBack,
  SkipForward,
  Sun as SunIcon,
  Square,
  Telescope,
  Trash2,
  Wand2,
  X
} from "lucide-react";
import * as THREE from "three";
import { GIBS_LAYERS, DEFAULT_GIBS_DAY, DEFAULT_GIBS_NIGHT, todayUTC, loadGibsComposite } from "./tiles";
import { fetchAllAircraft, altitudeColor, altitudeFt, knotsFromMs, fetchAircraftDetail, fetchFlightRoute, type Aircraft, type FlightSnapshot, type AircraftDetail, type FlightRoute } from "./flights";
import { dateRange, shiftDate, loadTimelapseFrames, disposeFrames, type TimelapseFrame } from "./timelapse";
import { fetchRadarManifest, composeRadarFrame, frameLabel, type RadarManifest, type RadarFrame } from "./weather";
import { fetchEonetEvents, categoryColor, categoryIconLabel, type EonetEvent } from "./eonet";
import { fetchSpaceWeather, fetchAuroraSnapshot, auroraIntensityToRGBA, kpScale, type SpaceWeather, type AuroraSnapshot } from "./space";
import { fetchNeoToday, type NearEarthObject } from "./nearEarthObjects";
import { fetchUpcomingLaunches, timeUntilLaunch, type RocketLaunch } from "./launches";
import { fetchWikiSummary } from "./wiki";
import { MAJOR_CITIES } from "./cities";
import { LANDMARKS } from "./landmarks";
import { AIRPORTS } from "./airports";
import { COUNTRY_CENTROIDS } from "./countries";
import { aircraftTypeName } from "./aircraftTypes";

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
  aircraft: boolean;
  weather: boolean;
  eonet: boolean;
  aurora: boolean;
  neoWatch: boolean;
  timeClock: boolean;
  dayInfo: boolean;
  launches: boolean;
  worldDigest: boolean;
  noonMeridian: boolean;
  buildings3D: boolean;
  storms: boolean;
  landmarks: boolean;
  airports: boolean;
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
  uiTheme: "dark" | "light" | "oled" | "cyber" | "solar" | "mono";
  imagery?: Imagery;
  pins?: Pin[];
};

// Bumped from v15 → v16 to invalidate persisted layer state. Users
// who had `buildings3D: true` from before the OSM Buildings tear-fix
// would otherwise keep loading the tileset and seeing dark olive
// boxes covering the imagery at low altitudes.
const STORAGE_KEY = "atlas-globe-state-v16";
const EARTH_RADIUS_KM = 6371;
const MIN_DISTANCE = 1.0008;        // ~5 km above surface (texture-pixelated, but real zoom)
const MAX_DISTANCE = 12;            // far view from space
const SPACE_DISTANCE = 2.6;          // default starting altitude

// Mobile / low-end detection. Used to gate expensive features (high MSAA,
// 3D buildings, full aircraft fleet, frequent polling). One-shot at module
// scope so it's stable across renders.
const IS_MOBILE = (() => {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  if (/iphone|ipad|ipod|android|mobile/i.test(ua)) return true;
  if (typeof window !== "undefined" && window.matchMedia && window.matchMedia("(pointer: coarse)").matches) {
    if (window.innerWidth < 900) return true;
  }
  return false;
})();

const IS_LOW_END = (() => {
  if (typeof navigator === "undefined") return false;
  const dm = (navigator as any).deviceMemory;
  if (typeof dm === "number" && dm <= 4) return true;
  const cores = (navigator as any).hardwareConcurrency;
  if (typeof cores === "number" && cores <= 4) return true;
  return IS_MOBILE;
})();

// Aircraft cap on phones. Full ADS-B feed is ~12k planes — rendering that
// at 5fps is brutal on a phone. We sample to 1500 (still visually dense),
// preferring high-altitude commercial flights (visible from far out).
const MOBILE_AIRCRAFT_CAP = 1500;

const defaultLayers: LayerVisibility = {
  // Mobile: clouds is a rotating shaded sphere, atmosphere is a Fresnel
  // postprocess-style pass — both are expensive shaders. Default off on
  // phones; user can re-enable via the layers panel if they want the
  // cinematic look.
  clouds: !IS_LOW_END,
  atmosphere: !IS_LOW_END,
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
  compass: true,
  aircraft: false,
  weather: false,
  eonet: false,
  aurora: false,
  neoWatch: false,
  timeClock: false,
  dayInfo: false,
  launches: false,
  worldDigest: false,
  noonMeridian: false,
  // 3D OSM Buildings tileset is heavy and renders with edge outlines
  // that disable imagery draping underneath, painting the screen with
  // dark olive boxes at low altitudes (the user's tear repro). Off by
  // default everywhere; user can opt in via Cmd+K when they want it.
  buildings3D: false,
  // Active tropical cyclones (NOAA NHC). Cheap to render (handful of
  // points), so on by default.
  storms: true,
  // Famous landmarks (~35 sites). Cheap, on by default in Surface.
  landmarks: true,
  // Major IATA hub airports (~80). Off by default — they overlap city
  // labels at typical zooms.
  airports: false
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
  rotationSpeed: 0,
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
  // zoom=3 = 128 tiles, ~4MB total, sharp enough for moderate fly-to.
  // For ground-level detail (<200km altitude), the UI nudges the user to
  // Surface mode (Cesium) which has proper streaming LOD.
  zoom: 3,
  // Bundled by default = instant beautiful Earth, no loading bar, no swath gaps.
  // Users opt into NASA live imagery via the Imagery panel when they want today's data.
  source: "bundled"
};

// Bookmark seed list: top 52 major metropolitan areas (auto-built from
// MAJOR_CITIES) plus a handful of natural-wonder bookmarks. Stable IDs are
// derived from the city name so user-imported state from older versions
// continues to work.
const cityBookmarks: Bookmark[] = [
  ...MAJOR_CITIES.map((c) => ({
    id: c.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    name: c.name,
    lat: c.lat,
    lon: c.lon,
    altKm: 1500,
    savedAt: 0,
  })),
  // Hand-curated natural-wonder bookmarks
  { id: "everest", name: "Mt. Everest", lat: 27.9881, lon: 86.925, altKm: 80, savedAt: 0 },
  { id: "grand-canyon", name: "Grand Canyon", lat: 36.0544, lon: -112.1401, altKm: 60, savedAt: 0 },
  { id: "kilimanjaro", name: "Mt. Kilimanjaro", lat: -3.0674, lon: 37.3556, altKm: 60, savedAt: 0 },
  { id: "uluru", name: "Uluru", lat: -25.3444, lon: 131.0369, altKm: 30, savedAt: 0 },
  { id: "niagara", name: "Niagara Falls", lat: 43.0962, lon: -79.0377, altKm: 25, savedAt: 0 },
  { id: "amazon", name: "Amazon Basin", lat: -3.4653, lon: -62.2159, altKm: 1500, savedAt: 0 },
  { id: "sahara", name: "Sahara Desert", lat: 23.4162, lon: 25.6628, altKm: 2000, savedAt: 0 },
  { id: "great-barrier-reef", name: "Great Barrier Reef", lat: -18.2871, lon: 147.6992, altKm: 600, savedAt: 0 },
  { id: "gobi", name: "Gobi Desert", lat: 42.7951, lon: 105.0324, altKm: 1500, savedAt: 0 },
  { id: "andes", name: "Andes Range", lat: -32.6532, lon: -70.0109, altKm: 800, savedAt: 0 },
  { id: "north-pole", name: "North Pole", lat: 89.99, lon: 0, altKm: 800, savedAt: 0 },
  { id: "south-pole", name: "South Pole", lat: -89.99, lon: 0, altKm: 800, savedAt: 0 },
  { id: "antimeridian", name: "Antimeridian (Pacific)", lat: 0, lon: 180, altKm: 5000, savedAt: 0 },
  { id: "san-francisco", name: "San Francisco", lat: 37.7749, lon: -122.4194, altKm: 1500, savedAt: 0 },
  { id: "nile", name: "Nile Delta", lat: 30.8025, lon: 26.8206, altKm: 2200, savedAt: 0 },
];

const initialSearchSuggestions = cityBookmarks.map((c) => c.name);

const KEYBOARD_HINTS = [
  { keys: "⌘K / Ctrl+K", desc: "Command palette (search every action / layer / setting)" },
  { keys: "F", desc: "Open place search" },
  { keys: "R", desc: "Reset view" },
  { keys: "B", desc: "Bookmark current view" },
  { keys: "L", desc: "Toggle Layers panel" },
  { keys: "T", desc: "Cycle UI theme" },
  { keys: "H", desc: "Hide / show all UI" },
  { keys: "S", desc: "Switch to Surface mode" },
  { keys: "?", desc: "Show shortcuts" },
  { keys: "Drag", desc: "Orbit camera" },
  { keys: "Scroll", desc: "Zoom in / out" },
  { keys: "Shift / Ctrl + click", desc: "Drop a pin without pin tool" },
  { keys: "Click an aircraft", desc: "Open flight info card" },
  { keys: "Click an event", desc: "Open EONET / quake / volcano / launch info" },
  { keys: "Esc", desc: "Close any open modal / palette" },
];

function App() {
  // Surface (Cesium) is the default now — better data visualization at every
  // zoom, photo-realistic ground imagery, 3D buildings, real terrain.
  // First-run users land in Surface; can switch to Atlas via the mode strip
  // for the cinematic shader globe.
  const [mode, setMode] = useState<Mode>("surface");
  const [layers, setLayers] = useState<LayerVisibility>(defaultLayers);
  const [globe, setGlobe] = useState<GlobeSettings>(defaultGlobe);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>(cityBookmarks);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("globe");
  const [hideUi, setHideUi] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [uiTheme, setUiTheme] = useState<"dark" | "light" | "oled" | "cyber" | "solar" | "mono">("dark");
  // Apply uiTheme to <html data-theme=...> so the CSS overrides take effect.
  useEffect(() => {
    document.documentElement.dataset.theme = uiTheme;
  }, [uiTheme]);
  const [cameraState, setCameraState] = useState<CameraState>({ lat: 25, lon: 0, altKm: distanceToAltKm(SPACE_DISTANCE) });
  // Initial flyTo: if the URL hash contains an `@lat,lon,altKm` token,
  // fly there on mount. Format: `#@29.9,-90.07,8.5km`. Same convention
  // as Google Maps so it's familiar.
  const [flyTo, setFlyTo] = useState<FlyToTarget>(() => {
    if (typeof window === "undefined") return { id: 0, lat: 0, lon: 0, altKm: 0 };
    const m = window.location.hash.match(/^#@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)(km)?$/);
    if (!m) return { id: 0, lat: 0, lon: 0, altKm: 0 };
    return { id: 1, lat: parseFloat(m[1]), lon: parseFloat(m[2]), altKm: parseFloat(m[3]) };
  });
  const [toast, setToast] = useState<{ id: number; text: string } | null>(null);
  const [showFps, setShowFps] = useState(false);
  const [paused, setPaused] = useState(false);
  const [orbiting, setOrbiting] = useState(false);
  const [cesiumToken, setCesiumToken] = useState<string>("");
  const [issPosition, setIssPosition] = useState<{ lat: number; lon: number } | null>(null);
  const [tiangongPosition, setTiangongPosition] = useState<{ lat: number; lon: number } | null>(null);
  const [hubblePosition, setHubblePosition] = useState<{ lat: number; lon: number } | null>(null);
  const [aircraftSnapshot, setAircraftSnapshot] = useState<FlightSnapshot | null>(null);
  const [aircraftLoading, setAircraftLoading] = useState(false);
  const [aircraftError, setAircraftError] = useState<string | null>(null);
  const [aircraftMinAltFt, setAircraftMinAltFt] = useState(0);
  const [aircraftMaxAltFt, setAircraftMaxAltFt] = useState(50000);
  const [aircraftCategory, setAircraftCategory] = useState<"all" | "commercial" | "private" | "military" | "heli">("all");
  // Optional callsign-prefix filter on top of category. e.g. 'UAL' = United,
  // 'AAL' = American, 'DAL' = Delta. Empty = all airlines.
  const [aircraftAirlinePrefix, setAircraftAirlinePrefix] = useState("");
  const [hoveredAircraftId, setHoveredAircraftId] = useState<string | null>(null);
  const [hoverPos, setHoverPos] = useState<{ x: number; y: number } | null>(null);

  // Measure tool: when on, the next two clicks set point A and point B,
  // and we render the great-circle distance + bearing between them.
  const [measureMode, setMeasureMode] = useState(false);
  const [measurePoints, setMeasurePoints] = useState<Array<{ lat: number; lon: number }>>([]);

  // When on, automatically transition Atlas → Surface at low altitudes and
  // Surface → Atlas at high ones, so the user gets the right engine for the
  // zoom level without thinking about modes.
  const [autoModeSwitch, setAutoModeSwitch] = useState(false);
  const [surfaceImagery, setSurfaceImagery] = useState<"bing" | "esri" | "osm">("bing");
  const [surfaceTilt, setSurfaceTilt] = useState<{ id: number; pitchDeg: number } | null>(null);
  const [surfaceTerrainExag, setSurfaceTerrainExag] = useState(1);
  const [surfaceFog, setSurfaceFog] = useState(true);
  const [surfaceManualHour, setSurfaceManualHour] = useState<number | null>(null);
  const [surfaceScreenshotCmd, setSurfaceScreenshotCmd] = useState<{ id: number } | null>(null);
  // Lock Cesium camera onto the currently selected aircraft.
  const [followSelectedAircraft, setFollowSelectedAircraft] = useState(false);
  // Cinematic camera modes for selected aircraft. "off" disables.
  const [aircraftCameraMode, setAircraftCameraMode] = useState<"off" | "chase" | "cockpit" | "wing">("off");
  // Cesium-side day/night terminator polyline overlay. Independent of
  // the Atlas-mode terminator layer so users can have it on per-mode.
  const [surfaceTerminator, setSurfaceTerminator] = useState(false);
  // Cesium globe-lighting override. undefined = use auto (off on mobile,
  // on otherwise). User can flip via Cmd+K.
  const [surfaceGlobeLighting, setSurfaceGlobeLighting] = useState<boolean | undefined>(undefined);
  // Cesium camera auto-orbit. Continuously rotates around the globe.
  const [surfaceAutoOrbit, setSurfaceAutoOrbit] = useState(false);
  // Per-aircraft altitude bar overlay (vertical line from ground to billboard).
  const [surfaceAltBars, setSurfaceAltBars] = useState(false);
  // Reset-heading command (bumped by Cmd+K).
  const [resetHeadingCmd, setResetHeadingCmd] = useState<{ id: number } | null>(null);
  // GeoJSON drag-import state — set by the body-level dragdrop listener.
  const [geoJsonImport, setGeoJsonImport] = useState<any | null>(null);

  // Body-level drag-and-drop import for GeoJSON files. Drop a .json/.geojson
  // anywhere on the page to render its features as Cesium entities.
  // Toast feedback is logged-only here because showToast is defined further
  // down the component body — calling it pre-declaration is a TS error and
  // a runtime closure-capture pitfall.
  useEffect(() => {
    const onDragOver = (e: DragEvent) => { e.preventDefault(); };
    const onDrop = async (e: DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer?.files?.[0];
      if (!file) return;
      if (!/\.(json|geojson)$/i.test(file.name)) return;
      try {
        const text = await file.text();
        const parsed = JSON.parse(text);
        setGeoJsonImport(parsed);
      } catch {
        // silent — invalid GeoJSON
      }
    };
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("drop", onDrop);
    };
  }, []);

  // Per-aircraft history: last 12 polled positions (~2.4 minutes) so the
  // selected plane can render a fading trail behind it. Stored in a ref so
  // we don't re-render every poll. We bump aircraftHistoryTick once per
  // successful poll so the AircraftTrail component re-renders with fresh
  // history, while the rest of the tree doesn't.
  const aircraftHistoryRef = useRef<Map<string, Array<{ lat: number; lon: number; alt: number; t: number }>>>(new Map());
  // The tick counter is set-only; its purpose is purely to trigger re-renders
  // of components that read aircraftHistoryRef on each successful poll.
  const [, setAircraftHistoryTick] = useState(0);

  // auroraSnapshot's grid is only used inside the texture-build effect; we
  // hold it in a ref to avoid a state-only-set-never-read TS warning.
  const [, setAuroraSnapshot] = useState<AuroraSnapshot | null>(null);
  const [spaceWeather, setSpaceWeather] = useState<SpaceWeather | null>(null);
  const [auroraTexture, setAuroraTexture] = useState<THREE.CanvasTexture | null>(null);

  const [neoToday, setNeoToday] = useState<NearEarthObject[]>([]);
  // Tick once per second so the timezone clock displays update; only used
  // when timeClock layer is on.
  const [, setClockTick] = useState(0);

  const [launches, setLaunches] = useState<RocketLaunch[]>([]);
  const [selectedLaunchId, setSelectedLaunchId] = useState<string | null>(null);
  const [selectedEarthquakeId, setSelectedEarthquakeId] = useState<string | null>(null);
  const [selectedVolcanoId, setSelectedVolcanoId] = useState<string | null>(null);

  const [eonetEvents, setEonetEvents] = useState<EonetEvent[]>([]);
  const [eonetLoading, setEonetLoading] = useState(false);
  const [selectedEonetId, setSelectedEonetId] = useState<string | null>(null);
  // Disabled categories (lowercased EonetCategory). Empty = show all.
  const [eonetHidden, setEonetHidden] = useState<Set<string>>(new Set());

  const visibleEonetEvents = useMemo(() => {
    if (eonetHidden.size === 0) return eonetEvents;
    return eonetEvents.filter((e) => !eonetHidden.has(e.category));
  }, [eonetEvents, eonetHidden]);

  // NOAA NHC active tropical cyclones — public CurrentStorms.json. Empty
  // outside hurricane season; populated 0-6 entries during active season.
  type ActiveStorm = {
    id: string;
    name: string;
    classification: string;       // Hurricane / Tropical Storm / etc.
    intensityKph: number | null;  // sustained wind speed
    pressureMb: number | null;
    lat: number;
    lon: number;
    movementDir: number | null;   // degrees
    movementKph: number | null;
    lastUpdate: string;           // ISO timestamp
  };
  const [activeStorms, setActiveStorms] = useState<ActiveStorm[]>([]);

  // USGS volcano alert color codes (key: lowercase volcano name → color code).
  // Refresh every 10 min. Used to tint markers in VolcanoMarkers when the
  // volcano is currently at elevated alert.
  const [volcanoAlerts, setVolcanoAlerts] = useState<Map<string, string>>(new Map());

  const [radarManifest, setRadarManifest] = useState<RadarManifest | null>(null);
  const [radarTexture, setRadarTexture] = useState<THREE.CanvasTexture | null>(null);
  const [radarFrameIndex, setRadarFrameIndex] = useState(-1);   // -1 = latest
  const [radarLoading, setRadarLoading] = useState(false);
  const [radarOpacity, setRadarOpacity] = useState(0.7);
  const radarAbortRef = useRef<AbortController | null>(null);

  const filteredAircraft = useMemo(() => {
    const list = aircraftSnapshot?.aircraft ?? [];
    if (list.length === 0) return list;
    const minM = aircraftMinAltFt * 0.3048;
    const maxM = aircraftMaxAltFt * 0.3048;
    const prefix = aircraftAirlinePrefix.trim().toUpperCase();
    const passed = list.filter((a) => {
      if (a.altitudeM < minM || a.altitudeM > maxM) return false;
      // Airline filter is independent of category — applies on top.
      if (prefix && !(a.callsign || "").toUpperCase().startsWith(prefix)) return false;
      if (aircraftCategory === "all") return true;
      // ADS-B category codes:
      //   A1-A3 = light/medium/heavy commercial fixed-wing
      //   A4-A5 = high-vortex/large transport
      //   A7 = rotorcraft (helicopter)
      //   B0-B7 = balloon/glider/UAV/etc (private)
      //   C0-C7 = surface/emergency vehicles (filter out)
      //   military: prefer registration prefix or callsign hints (RCH/PAT/etc), but the
      //   feed sets dbFlags: 1 for military — we pass that through as `category` only
      //   when it's the ADS-B category. So heuristic: callsign starts with known mil prefixes.
      const cat = a.category || "";
      const callsignPrefix = a.callsign.slice(0, 3).toUpperCase();
      const milPrefixes = ["RCH", "PAT", "REA", "SAM", "MAGMA", "VENOM", "DUKE", "EAGL", "ARMY", "NAVY", "USAF"];
      const isMilByCallsign = milPrefixes.some((p) => callsignPrefix.startsWith(p.slice(0, 3)));
      switch (aircraftCategory) {
        case "commercial": return /^A[1-5]/.test(cat);
        case "heli":       return cat === "A7";
        case "military":   return isMilByCallsign;
        case "private":    return /^A[0-3]/.test(cat) || /^B/.test(cat);
        default:           return true;
      }
    });
    // Mobile cap — keep the most visually-relevant subset. Sort by altitude
    // descending (high-altitude airliners are visible from the most zoom
    // levels) and slice to MOBILE_AIRCRAFT_CAP. Avoids visible "missing
    // planes" at globe view since those are mostly low-alt regional flights.
    if (IS_LOW_END && passed.length > MOBILE_AIRCRAFT_CAP) {
      return [...passed].sort((a, b) => b.altitudeM - a.altitudeM).slice(0, MOBILE_AIRCRAFT_CAP);
    }
    return passed;
  }, [aircraftSnapshot, aircraftMinAltFt, aircraftMaxAltFt, aircraftCategory, aircraftAirlinePrefix]);
  const [selectedAircraftId, setSelectedAircraftId] = useState<string | null>(null);
  const [timelapseOpen, setTimelapseOpen] = useState(false);
  const [timelapseFrames, setTimelapseFrames] = useState<TimelapseFrame[]>([]);
  const [timelapseLoading, setTimelapseLoading] = useState(false);
  const [timelapseLoadProgress, setTimelapseLoadProgress] = useState(0);
  const [timelapsePlaying, setTimelapsePlaying] = useState(false);
  const [timelapseFps, setTimelapseFps] = useState(4);
  const [timelapseIndex, setTimelapseIndex] = useState(0);
  const [timelapseLayerId, setTimelapseLayerId] = useState<string>("modisTrueColor");
  const [timelapseStartDate, setTimelapseStartDate] = useState<string>(() => shiftDate(todayUTC(), -7));
  const [timelapseEndDate, setTimelapseEndDate] = useState<string>(() => todayUTC());
  const timelapseAbortRef = useRef<AbortController | null>(null);
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
  // GeoJSON FeatureCollection of country borders, computed alongside the
  // Float32Array borders. Cesium can render this via GeoJsonDataSource so
  // we don't need to re-walk the topojson per mode.
  const [bordersGeoJson, setBordersGeoJson] = useState<any | null>(null);
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
    // ISS/Tiangong/Hubble move ~7.7 km/s — even 15s of stale position is
    // visually fine at globe scale, and on mobile 5s polls were noticeable.
    const handle = window.setInterval(fetchAll, IS_LOW_END ? 15000 : 5000);
    return () => { cancelled = true; window.clearInterval(handle); };
  }, [layers.iss, layers.tiangong, layers.hubble]);

  // Global aircraft polling. Reliability strategy:
  //   - Poll airplanes.live every 12s
  //   - On any error, KEEP the previous snapshot visible (don't clear) and just
  //     bump aircraftError so the pill can surface the failure
  //   - Show staleness in the pill ("28s ago") so the user knows when data
  //     stopped refreshing without losing all the planes from the last good fetch
  useEffect(() => {
    if (!layers.aircraft) {
      setAircraftSnapshot(null);
      setAircraftError(null);
      setSelectedAircraftId(null);
      return;
    }
    let cancelled = false;
    let abort: AbortController | null = null;
    let consecutiveFailures = 0;
    const tick = async () => {
      abort?.abort();
      abort = new AbortController();
      setAircraftLoading(true);
      try {
        const snap = await fetchAllAircraft(abort.signal);
        if (cancelled) return;
        setAircraftSnapshot(snap);
        setAircraftError(null);
        consecutiveFailures = 0;
        // Maintain rolling per-aircraft history (last 12 polls).
        const map = aircraftHistoryRef.current;
        const HISTORY_CAP = 12;
        const seen = new Set<string>();
        for (const a of snap.aircraft) {
          seen.add(a.icao24);
          let arr = map.get(a.icao24);
          if (!arr) { arr = []; map.set(a.icao24, arr); }
          arr.push({ lat: a.lat, lon: a.lon, alt: a.altitudeM, t: snap.fetchedAt });
          if (arr.length > HISTORY_CAP) arr.shift();
        }
        // Garbage-collect history for aircraft we haven't seen this poll.
        for (const k of map.keys()) if (!seen.has(k)) map.delete(k);
        setAircraftHistoryTick((t) => t + 1);
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
        if (!cancelled) {
          consecutiveFailures += 1;
          // Don't clobber the previous snapshot — keep showing what we have.
          setAircraftError(`${(e as Error).message} (retry #${consecutiveFailures})`);
        }
      } finally {
        if (!cancelled) setAircraftLoading(false);
      }
    };
    tick();
    // Mobile: 25s between polls (was 12s) — halves bandwidth + render churn.
    const handle = window.setInterval(tick, IS_LOW_END ? 25000 : 12000);
    return () => {
      cancelled = true;
      abort?.abort();
      window.clearInterval(handle);
    };
  }, [layers.aircraft]);

  // Upcoming rocket launches (Launch Library 2). Cached 30 min in module.
  useEffect(() => {
    if (!layers.launches) {
      setLaunches([]);
      setSelectedLaunchId(null);
      return;
    }
    let cancelled = false;
    const tick = async () => {
      try {
        const list = await fetchUpcomingLaunches();
        if (!cancelled) setLaunches(list);
      } catch { /* silent */ }
    };
    tick();
    const handle = window.setInterval(tick, 5 * 60 * 1000);
    return () => { cancelled = true; window.clearInterval(handle); };
  }, [layers.launches]);

  // USGS elevated volcanoes — refresh while the volcanoes layer is on.
  useEffect(() => {
    if (!layers.volcanoes) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch("https://volcanoes.usgs.gov/hans-public/api/volcano/getElevatedVolcanoes");
        if (!res.ok) return;
        const arr = await res.json() as Array<{ volcano_name: string; color_code: string }>;
        if (cancelled) return;
        const map = new Map<string, string>();
        for (const v of arr) {
          if (v?.volcano_name && v?.color_code) {
            map.set(v.volcano_name.toLowerCase(), v.color_code.toLowerCase());
          }
        }
        setVolcanoAlerts(map);
      } catch { /* silent */ }
    };
    tick();
    const handle = window.setInterval(tick, 10 * 60 * 1000);
    return () => { cancelled = true; window.clearInterval(handle); };
  }, [layers.volcanoes]);

  // NEO (asteroid) feed when widget is on; cached 60 min in module-scope
  useEffect(() => {
    if (!layers.neoWatch) return;
    let cancelled = false;
    fetchNeoToday().then((d) => { if (!cancelled) setNeoToday(d); }).catch(() => {});
    return () => { cancelled = true; };
  }, [layers.neoWatch]);

  // 1Hz tick for the timezone clock
  useEffect(() => {
    if (!layers.timeClock) return;
    const handle = window.setInterval(() => setClockTick((t) => t + 1), 1000);
    return () => window.clearInterval(handle);
  }, [layers.timeClock]);

  // NOAA SWPC space weather (Kp index + solar wind) — refresh every 5 min
  // when aurora layer or any space-weather UI is on. Always fetched if aurora
  // is on so the pill shows the current geomagnetic state.
  useEffect(() => {
    if (!layers.aurora) {
      setSpaceWeather(null);
      return;
    }
    let cancelled = false;
    const tick = async () => {
      try {
        const sw = await fetchSpaceWeather();
        if (!cancelled) setSpaceWeather(sw);
      } catch { /* silent */ }
    };
    tick();
    const handle = window.setInterval(tick, 5 * 60 * 1000);
    return () => { cancelled = true; window.clearInterval(handle); };
  }, [layers.aurora]);

  // OVATION aurora forecast — refresh every 10 min, compose into a 720x361
  // equirect canvas with NOAA's lon=0..359 indexing remapped so canvas-left
  // matches lon=-180 (the convention our Earth texture uses).
  useEffect(() => {
    if (!layers.aurora) {
      setAuroraSnapshot(null);
      setAuroraTexture((prev) => { prev?.dispose(); return null; });
      return;
    }
    let cancelled = false;
    const tick = async () => {
      try {
        const snap = await fetchAuroraSnapshot();
        if (cancelled) return;
        setAuroraSnapshot(snap);
        // Build canvas: canvas-left = lon=-180.
        const W = snap.width;
        const H = snap.height;
        const cv = document.createElement("canvas");
        cv.width = W;
        cv.height = H;
        const ctx = cv.getContext("2d");
        if (!ctx) return;
        const img = ctx.createImageData(W, H);
        for (let y = 0; y < H; y++) {
          for (let xRaw = 0; xRaw < W; xRaw++) {
            const v = snap.grid[y * W + xRaw];
            const [r, g, b, a] = auroraIntensityToRGBA(v);
            // Shift x by 180 so canvas-left (xCanvas=0) corresponds to
            // NOAA's lon=180 (which is the antimeridian in -180..180 terms).
            // Then UV.x=0 on the sphere shows lon=-180 — matching the Earth texture.
            const xCanvas = (xRaw + W / 2) % W;
            // Canvas y=0 is top = north, but NOAA data has lat=-90 at y=0.
            // Flip vertically.
            const yCanvas = H - 1 - y;
            const idx = (yCanvas * W + xCanvas) * 4;
            img.data[idx] = r;
            img.data[idx + 1] = g;
            img.data[idx + 2] = b;
            img.data[idx + 3] = a;
          }
        }
        ctx.putImageData(img, 0, 0);
        const tex = new THREE.CanvasTexture(cv);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.flipY = true;
        tex.minFilter = THREE.LinearFilter;
        tex.magFilter = THREE.LinearFilter;
        tex.needsUpdate = true;
        setAuroraTexture((prev) => { prev?.dispose(); return tex; });
      } catch { /* silent */ }
    };
    tick();
    const handle = window.setInterval(tick, 10 * 60 * 1000);
    return () => { cancelled = true; window.clearInterval(handle); };
  }, [layers.aurora]);

  // NASA EONET — global natural events (wildfires, severe storms, volcanoes,
  // sea ice, dust/haze, drought, snow, temp extremes, water-color anomalies,
  // floods, landslides, manmade emissions). Refresh every 10 min.
  useEffect(() => {
    if (!layers.eonet) {
      setEonetEvents([]);
      setSelectedEonetId(null);
      return;
    }
    let cancelled = false;
    let abort: AbortController | null = null;
    const tick = async () => {
      abort?.abort();
      abort = new AbortController();
      setEonetLoading(true);
      try {
        const events = await fetchEonetEvents(abort.signal);
        if (!cancelled) setEonetEvents(events);
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
        // Silent failure — pill stays in loading state; the user toggle off
        // and on again to retry. Toast queue isn't accessible at this point
        // in the component init order.
      } finally {
        if (!cancelled) setEonetLoading(false);
      }
    };
    tick();
    const handle = window.setInterval(tick, 10 * 60 * 1000);
    return () => {
      cancelled = true;
      abort?.abort();
      window.clearInterval(handle);
    };
  }, [layers.eonet]);

  // NOAA NHC active tropical cyclones. Refresh every 30 min — storm
  // positions are updated 4×/day during active storms but the feed itself
  // is cached. Empty array out-of-season; render nothing in that case.
  useEffect(() => {
    if (!layers.storms) {
      setActiveStorms([]);
      return;
    }
    let cancelled = false;
    const tick = async () => {
      try {
        // NOAA NHC doesn't send Access-Control-Allow-Origin, so direct
        // fetches from a browser fail with CORS. Use the public CORS
        // proxy r.jina.ai which returns the JSON body with permissive
        // headers. (Free, no auth, ~100ms overhead.)
        const res = await fetch("https://r.jina.ai/https://www.nhc.noaa.gov/CurrentStorms.json", { cache: "no-store" });
        if (!res.ok) return;
        // jina.ai returns the response body as text wrapped in markdown;
        // strip the wrapper if present.
        const text = await res.text();
        const jsonStart = text.indexOf("{");
        const jsonEnd = text.lastIndexOf("}");
        if (jsonStart < 0 || jsonEnd < 0) return;
        const data = JSON.parse(text.slice(jsonStart, jsonEnd + 1));
        if (cancelled) return;
        const storms: ActiveStorm[] = (data.activeStorms || []).map((s: any) => ({
          id: s.id || s.binNumber || crypto.randomUUID(),
          name: s.name || "Unnamed",
          classification: s.classification || "Tropical System",
          intensityKph: s.intensityKPH ? Number(s.intensityKPH) : null,
          pressureMb: s.pressure ? Number(s.pressure) : null,
          lat: typeof s.latitudeNumeric === "number" ? s.latitudeNumeric : 0,
          lon: typeof s.longitudeNumeric === "number" ? s.longitudeNumeric : 0,
          movementDir: s.movementDir ? Number(s.movementDir) : null,
          movementKph: s.movementKPH ? Number(s.movementKPH) : null,
          lastUpdate: s.lastUpdate || "",
        }));
        setActiveStorms(storms);
      } catch { /* CORS / network — silent */ }
    };
    tick();
    const handle = window.setInterval(tick, 30 * 60 * 1000);
    return () => { cancelled = true; window.clearInterval(handle); };
  }, [layers.storms]);

  // Weather radar — fetch the manifest once when the layer turns on, then refresh every 5 min
  useEffect(() => {
    if (!layers.weather) {
      setRadarManifest(null);
      setRadarTexture((prev) => { prev?.dispose(); return null; });
      return;
    }
    let cancelled = false;
    const tick = async () => {
      try {
        const m = await fetchRadarManifest();
        if (!cancelled) setRadarManifest(m);
      } catch (e) {
        if (!cancelled) showToast(`Weather: ${(e as Error).message}`);
      }
    };
    tick();
    const handle = window.setInterval(tick, 5 * 60 * 1000);
    return () => { cancelled = true; window.clearInterval(handle); };
  }, [layers.weather]);

  // Compose the requested radar frame into a CanvasTexture whenever the
  // manifest or selected frame index changes.
  useEffect(() => {
    if (!layers.weather || !radarManifest) {
      setRadarTexture((prev) => { prev?.dispose(); return null; });
      return;
    }
    const past = radarManifest.past;
    if (past.length === 0) return;
    const frame: RadarFrame = radarFrameIndex < 0 ? past[past.length - 1] : past[Math.min(radarFrameIndex, past.length - 1)];

    radarAbortRef.current?.abort();
    const controller = new AbortController();
    radarAbortRef.current = controller;
    setRadarLoading(true);
    composeRadarFrame(radarManifest, frame, 2, controller.signal)
      .then((canvas) => {
        if (controller.signal.aborted) return;
        const tex = new THREE.CanvasTexture(canvas);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.flipY = false;
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.ClampToEdgeWrapping;
        tex.needsUpdate = true;
        setRadarTexture((prev) => { prev?.dispose(); return tex; });
      })
      .catch(() => {})
      .finally(() => {
        if (!controller.signal.aborted) setRadarLoading(false);
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layers.weather, radarManifest, radarFrameIndex]);

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
      // Production deploys bake VITE_CESIUM_TOKEN at build time. Use it if no
      // user token is in localStorage.
      const envToken = (import.meta as any).env?.VITE_CESIUM_TOKEN as string | undefined;
      if (token) setCesiumToken(token);
      else if (envToken) setCesiumToken(envToken);
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

  const flyToBookmark = useCallback((b: Bookmark, opts?: { dropPin?: boolean }) => {
    setFlyTo((current) => ({ id: current.id + 1, lat: b.lat, lon: b.lon, altKm: b.altKm }));
    showToast(`Flying to ${b.name}`);
    recordSearch(b.name);
    // Address-search hits get a pin dropped automatically — that's
    // the whole point of typing an address: see it land, see the
    // marker, click around. Saved bookmarks just fly without pinning.
    if (opts?.dropPin) {
      const pin: Pin = {
        id: `pin-${Date.now()}`,
        lat: b.lat,
        lon: b.lon,
        label: b.name,
        color: PIN_COLORS[Math.floor(Math.random() * PIN_COLORS.length)],
        createdAt: Date.now(),
      };
      setPins((prev) => [...prev, pin]);
      setSelectedPin(pin.id);
    }
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
    const envToken = (import.meta as any).env?.VITE_CESIUM_TOKEN as string | undefined;
    const effectiveToken = cesiumToken || envToken || "";
    if (!effectiveToken) {
      const token = window.prompt(
        "Cesium ion access token (free at cesium.com/ion):",
        ""
      );
      if (!token) return;
      window.localStorage.setItem("cesium-token", token);
      setCesiumToken(token);
    } else if (!cesiumToken && envToken) {
      // Lift the env token into state so Surface.tsx receives it as a prop
      setCesiumToken(envToken);
    }
    setMode("surface");
    showToast("Switched to Surface mode");
  }, [cesiumToken, showToast]);

  const switchToAtlas = useCallback(() => {
    setMode("atlas");
    showToast("Atlas mode");
  }, [showToast]);

  const cycleTheme = useCallback(() => {
    // Cycle through all available presets so the existing T shortcut still
    // works as a "next theme" toggle.
    const order: Array<"dark" | "light" | "oled" | "cyber" | "solar" | "mono"> =
      ["dark", "light", "oled", "cyber", "solar", "mono"];
    setUiTheme((t) => order[(order.indexOf(t) + 1) % order.length]);
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

        // Day — show progressive previews at 25/50/75% so the user sees the
        // continents fill in as tiles arrive instead of staring at the bundled
        // fallback for the whole load. Each setDayTexture call disposes the
        // previous one, so earlier progressive textures don't leak.
        const dayCanvas = await loadGibsComposite(
          dayLayer,
          imagery.date,
          imagery.zoom,
          controller.signal,
          (loaded, total) => setImageryProgress(loaded / (total * 2)),
          dayFallback ?? undefined,
          (canvas) => {
            if (controller.signal.aborted) return;
            const t = new THREE.CanvasTexture(canvas);
            t.colorSpace = THREE.SRGBColorSpace;
            t.anisotropy = 8;
            t.wrapS = THREE.RepeatWrapping;
            t.wrapT = THREE.ClampToEdgeWrapping;
            t.flipY = true;
            t.needsUpdate = true;
            setDayTexture((prev) => { prev?.dispose(); return t; });
          }
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

  // Time-lapse: load N daily composites at low zoom into ready-to-bind textures.
  const loadTimelapse = useCallback(async () => {
    timelapseAbortRef.current?.abort();
    const controller = new AbortController();
    timelapseAbortRef.current = controller;
    setTimelapseLoading(true);
    setTimelapseLoadProgress(0);
    setTimelapsePlaying(false);
    setTimelapseIndex(0);
    // Dispose any previous frames
    setTimelapseFrames((prev) => { disposeFrames(prev); return []; });
    try {
      const dates = dateRange(timelapseStartDate, timelapseEndDate);
      // Cap to 30 frames to keep memory under control on mobile
      const cappedDates = dates.length > 30 ? dates.slice(-30) : dates;
      const dayFallback = await fallbackImagesRef.current.dayPromise.catch(() => null);
      if (controller.signal.aborted) return;
      const frames = await loadTimelapseFrames(
        timelapseLayerId,
        cappedDates,
        1,
        controller.signal,
        (loaded, total) => setTimelapseLoadProgress(loaded / total),
        dayFallback ?? undefined
      );
      if (controller.signal.aborted) { disposeFrames(frames); return; }
      setTimelapseFrames(frames);
      setTimelapseLoadProgress(1);
      showToast(`Time-lapse ready: ${frames.length} frames`);
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        showToast(`Time-lapse failed: ${(e as Error).message}`);
      }
    } finally {
      if (!controller.signal.aborted) setTimelapseLoading(false);
    }
  }, [timelapseStartDate, timelapseEndDate, timelapseLayerId]);

  const closeTimelapse = useCallback(() => {
    timelapseAbortRef.current?.abort();
    setTimelapsePlaying(false);
    setTimelapseFrames((prev) => { disposeFrames(prev); return []; });
    setTimelapseOpen(false);
  }, []);

  // Frame ticker — advances index at the requested FPS while playing
  useEffect(() => {
    if (!timelapsePlaying || timelapseFrames.length === 0) return;
    const ms = 1000 / Math.max(1, timelapseFps);
    const handle = window.setInterval(() => {
      setTimelapseIndex((i) => (i + 1) % timelapseFrames.length);
    }, ms);
    return () => window.clearInterval(handle);
  }, [timelapsePlaying, timelapseFps, timelapseFrames.length]);

  // Cleanup any timelapse frames on unmount
  useEffect(() => () => {
    timelapseAbortRef.current?.abort();
    setTimelapseFrames((prev) => { disposeFrames(prev); return []; });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Camera-change handler — fires on every Cesium/Three.js camera percent
  // change, so we throttle the React state update. The status bar / mini
  // map / coord readout consumers don't need sub-100ms accuracy. The ref
  // (cameraStateRef) is always updated synchronously so internal logic
  // (auto-mode-switch, follow-mode) sees the latest value.
  const cameraEmitDeadlineRef = useRef(0);
  const hashUpdateDeadlineRef = useRef(0);
  const onCameraChange = useCallback((lat: number, lon: number, altKm: number) => {
    cameraStateRef.current = { lat, lon, altKm };
    // 200ms on desktop, 400ms on mobile — phones can't redraw the status
    // bar 5× per second cheaply anyway.
    const throttleMs = IS_LOW_END ? 400 : 200;
    const now = performance.now();
    if (now < cameraEmitDeadlineRef.current) return;
    cameraEmitDeadlineRef.current = now + throttleMs;
    setCameraState({ lat, lon, altKm });
    // Live URL hash update — throttled to 1s so we don't spam history.
    // Uses replaceState so the back button doesn't fill with intermediate
    // positions. Lets the user copy the URL at any moment to share a
    // permalink to exactly where they're looking.
    if (now > hashUpdateDeadlineRef.current) {
      hashUpdateDeadlineRef.current = now + 1000;
      const newHash = `#@${lat.toFixed(4)},${lon.toFixed(4)},${altKm.toFixed(1)}km`;
      if (window.location.hash !== newHash) {
        try {
          window.history.replaceState(null, "", newHash);
        } catch { /* some sandboxes block replaceState — ignore */ }
      }
    }
  }, []);

  // Click-on-globe handler. Three modes based on user state:
  //   1. Measure mode → record A/B endpoints, no pin.
  //   2. Pin tool active OR shift-click → drop a pin (legacy behavior).
  //   3. Default → info-only: show coords + reverse-geocoded place name
  //      as a toast. The user reported that auto-dropping pins on every
  //      click made it impossible to just look around. Now you have to
  //      opt in to pinning via the Pin Tool button or shift-click.
  const onGlobeClick = useCallback((lat: number, lon: number, modifiers?: { shift?: boolean }) => {
    if (measureMode) {
      // Multi-segment path. Each click appends a new vertex; the toast
      // shows the leg distance + cumulative total so the user can build
      // up a route (NYC → London → Tokyo round-the-world style).
      // To start a new measurement, exit and re-enter measure mode.
      setMeasurePoints((prev) => {
        const next = [...prev, { lat, lon }];
        if (next.length === 1) {
          showToast(`Measure: vertex 1 at ${formatLat(lat)} ${formatLon(lon)}. Keep clicking to extend.`);
        } else {
          const a = next[next.length - 2];
          const leg = haversineKm(a.lat, a.lon, lat, lon);
          // Total distance = sum of all leg lengths.
          let total = 0;
          for (let i = 1; i < next.length; i++) {
            total += haversineKm(next[i - 1].lat, next[i - 1].lon, next[i].lat, next[i].lon);
          }
          const b = bearingDeg(a.lat, a.lon, lat, lon);
          showToast(`Leg ${next.length - 1}: ${leg.toLocaleString(undefined, { maximumFractionDigits: 0 })} km · bearing ${b.toFixed(0)}° · total ${total.toLocaleString(undefined, { maximumFractionDigits: 0 })} km`);
        }
        return next;
      });
      return;
    }

    const wantsPin = pinTool || modifiers?.shift === true;

    if (!wantsPin) {
      // Info-only path. Toast the coords immediately so feedback is fast,
      // then upgrade to a place-name toast when reverse geocode resolves.
      showToast(`${formatLat(lat)} ${formatLon(lon)}`);
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
            if (name) showToast(`📍 ${name} · ${formatLat(lat)} ${formatLon(lon)}`);
          }
        } catch {/* ignore */}
      })();
      return;
    }

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

    // Reverse geocode (best-effort, async) — upgrades the pin label to
    // the place name once Nominatim responds.
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
  }, [pins.length, showToast, measureMode, pinTool]);

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

  // Export pins as a downloadable GeoJSON file. Each pin becomes a Point
  // feature with name + color + createdAt properties so it round-trips
  // via the matching importer below.
  const exportPinsAsGeoJSON = useCallback(() => {
    if (pins.length === 0) { showToast("No pins to export"); return; }
    const fc = {
      type: "FeatureCollection",
      features: pins.map((p) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [p.lon, p.lat] },
        properties: { name: p.label, color: p.color, createdAt: p.createdAt },
      })),
    };
    const blob = new Blob([JSON.stringify(fc, null, 2)], { type: "application/geo+json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `atlas-pins-${new Date().toISOString().slice(0, 10)}.geojson`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 500);
    showToast(`Exported ${pins.length} pin${pins.length === 1 ? "" : "s"}`);
  }, [pins, showToast]);

  // Export pins as KML — opens directly in Google Earth / Maps.
  const exportPinsAsKML = useCallback(() => {
    if (pins.length === 0) { showToast("No pins to export"); return; }
    const placemarks = pins.map((p) => `
    <Placemark>
      <name>${escapeXml(p.label)}</name>
      <Point><coordinates>${p.lon},${p.lat},0</coordinates></Point>
    </Placemark>`).join("");
    const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>Atlas pins (${pins.length})</name>${placemarks}
  </Document>
</kml>`;
    const blob = new Blob([kml], { type: "application/vnd.google-earth.kml+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `atlas-pins-${new Date().toISOString().slice(0, 10)}.kml`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 500);
    showToast(`Exported ${pins.length} pin${pins.length === 1 ? "" : "s"} as KML`);
  }, [pins, showToast]);

  // Wipe all pins after a confirm. Cmd+K command — handy when the
  // user has accidentally peppered the globe testing the click handler.
  const deleteAllPins = useCallback(() => {
    if (pins.length === 0) { showToast("Already empty"); return; }
    if (!window.confirm(`Delete all ${pins.length} pin${pins.length === 1 ? "" : "s"}? This can't be undone.`)) return;
    setPins([]);
    setSelectedPin(null);
    showToast("All pins deleted");
  }, [pins, showToast]);

  // Drop a pin from text on the clipboard. Accepts:
  //   "37.77, -122.42"
  //   "37.77,-122.42"
  //   "37° 46' N, 122° 25' W"   (basic dms)
  //   any line ending with two numbers separated by comma
  const pinFromClipboard = useCallback(async () => {
    if (!navigator.clipboard?.readText) { showToast("Clipboard not available"); return; }
    let text = "";
    try { text = await navigator.clipboard.readText(); }
    catch { showToast("Could not read clipboard"); return; }
    text = text.trim();
    if (!text) { showToast("Clipboard empty"); return; }
    // Match a "lat, lon" pair (decimal degrees).
    const m = text.match(/(-?\d+(?:\.\d+)?)\s*[,\s]\s*(-?\d+(?:\.\d+)?)/);
    if (!m) { showToast(`No coords in clipboard: "${text.slice(0, 40)}"`); return; }
    const lat = parseFloat(m[1]);
    const lon = parseFloat(m[2]);
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) { showToast(`Out of range: ${lat}, ${lon}`); return; }
    onGlobeClick(lat, lon, { shift: true });
  }, [onGlobeClick, showToast]);

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
        // Stash the FeatureCollection so Cesium Surface mode can render
        // the same outlines via GeoJsonDataSource.
        setBordersGeoJson(featureCollection);
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

  // Auto-mode-switch: Atlas → Surface when zoom is too high for Atlas's
  // single texture sphere to look good; Surface → Atlas when pulled back to
  // orbital view (Atlas atmospheric shading is more cinematic from far away).
  useEffect(() => {
    if (!autoModeSwitch) return;
    if (mode === "atlas" && cameraState.altKm > 0 && cameraState.altKm < 600) {
      switchToSurface();
    } else if (mode === "surface" && cameraState.altKm > 6000) {
      switchToAtlas();
    }
  }, [autoModeSwitch, mode, cameraState.altKm, switchToSurface, switchToAtlas]);

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

  // Konami code easter egg detector. Up Up Down Down Left Right Left
  // Right B A — fires a celebratory action (auto-tour all bookmarks
  // with a confetti toast).
  useEffect(() => {
    const seq = ["ArrowUp","ArrowUp","ArrowDown","ArrowDown","ArrowLeft","ArrowRight","ArrowLeft","ArrowRight","b","a"];
    let pos = 0;
    const onKey = (e: KeyboardEvent) => {
      const expected = seq[pos];
      if (e.key === expected || e.key.toLowerCase() === expected) {
        pos++;
        if (pos === seq.length) {
          showToast("🎮 KONAMI CODE — UNLOCKED! Cycling all themes…");
          // Visual fanfare: cycle through all themes 1.5s apart.
          const themes: Array<"dark"|"light"|"oled"|"cyber"|"solar"|"mono"> = ["cyber","solar","oled","light","mono","dark"];
          themes.forEach((t, i) => setTimeout(() => setUiTheme(t), i * 1500));
          pos = 0;
        }
      } else {
        pos = 0;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showToast]);

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      // Cmd/Ctrl+K opens command palette even from inside inputs
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandPaletteOpen((v) => !v);
        return;
      }
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
      if (event.metaKey || event.ctrlKey) return;

      switch (event.key.toLowerCase()) {
        case "escape":
          if (commandPaletteOpen) setCommandPaletteOpen(false);
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
        case "1":
          event.preventDefault();
          // Quick-toggle: aircraft layer
          setLayers((l) => ({ ...l, aircraft: !l.aircraft }));
          showToast(layers.aircraft ? "Aircraft hidden" : "Aircraft shown");
          break;
        case "2":
          event.preventDefault();
          setLayers((l) => ({ ...l, weather: !l.weather }));
          showToast(layers.weather ? "Weather radar hidden" : "Weather radar shown");
          break;
        case "3":
          event.preventDefault();
          setLayers((l) => ({ ...l, eonet: !l.eonet }));
          showToast(layers.eonet ? "EONET hidden" : "EONET events shown");
          break;
        case "4":
          event.preventDefault();
          setLayers((l) => ({ ...l, earthquakes: !l.earthquakes }));
          showToast(layers.earthquakes ? "Earthquakes hidden" : "Earthquakes shown");
          break;
        case "5":
          event.preventDefault();
          setLayers((l) => ({ ...l, volcanoes: !l.volcanoes }));
          showToast(layers.volcanoes ? "Volcanoes hidden" : "Volcanoes shown");
          break;
        case "6":
          event.preventDefault();
          setLayers((l) => ({ ...l, launches: !l.launches }));
          showToast(layers.launches ? "Launches hidden" : "Launches shown");
          break;
        case "7":
          event.preventDefault();
          setLayers((l) => ({ ...l, iss: !l.iss }));
          showToast(layers.iss ? "ISS hidden" : "ISS shown");
          break;
        case "8":
          event.preventDefault();
          setLayers((l) => ({ ...l, borders: !l.borders }));
          showToast(layers.borders ? "Borders hidden" : "Borders shown");
          break;
        case "9":
          event.preventDefault();
          setLayers((l) => ({ ...l, aurora: !l.aurora }));
          showToast(layers.aurora ? "Aurora hidden" : "Aurora shown");
          break;
        case "0":
          event.preventDefault();
          setLayers((l) => ({ ...l, storms: !l.storms }));
          showToast(layers.storms ? "Storms hidden" : "Storms shown");
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
            aircraft={filteredAircraft}
            selectedAircraftId={selectedAircraftId}
            radarTexture={radarTexture}
            radarOpacity={radarOpacity}
            eonetEvents={visibleEonetEvents}
            selectedEonetId={selectedEonetId}
            onSelectEonet={setSelectedEonetId}
            launchList={launches}
            selectedLaunchId={selectedLaunchId}
            onSelectLaunch={setSelectedLaunchId}
            selectedEarthquakeId={selectedEarthquakeId}
            onSelectEarthquake={setSelectedEarthquakeId}
            selectedVolcanoId={selectedVolcanoId}
            onSelectVolcano={setSelectedVolcanoId}
            auroraTexture={auroraTexture}
            aircraftHistory={aircraftHistoryRef.current}
            volcanoAlerts={volcanoAlerts}
            onAircraftHover={(id, p) => { setHoveredAircraftId(id); setHoverPos(p); }}
            pins={pins}
            earthquakes={earthquakes}
            borders={borders}
            selectedPinId={selectedPin}
            dayTexture={timelapsePlaying && timelapseFrames[timelapseIndex] ? timelapseFrames[timelapseIndex].texture : dayTexture}
            nightTexture={nightTexture}
            pinTool={pinTool}
            onSelectPin={setSelectedPin}
            onSelectAircraft={setSelectedAircraftId}
            onGlobeClick={onGlobeClick}
            onCameraChange={onCameraChange}
          />
        ) : (
          <Suspense fallback={<div className="surfaceLoading">Loading Surface mode (Cesium)…</div>}>
            <SurfaceMode
              token={cesiumToken}
              onCameraChange={onCameraChange}
              onPickLocation={onGlobeClick}
              flyTo={flyTo}
              pins={pins.map((p) => ({ id: p.id, lat: p.lat, lon: p.lon, label: p.label, color: p.color }))}
              aircraft={layers.aircraft ? filteredAircraft.map((a) => ({ icao24: a.icao24, callsign: a.callsign, lat: a.lat, lon: a.lon, altitudeM: a.altitudeM, headingDeg: a.headingDeg, squawk: a.squawk, velocityMs: a.velocityMs, verticalRateMs: a.verticalRateMs })) : []}
              realTimeSun={globe.realTimeSun}
              initialCamera={cameraState}
              eonet={layers.eonet ? visibleEonetEvents.map((e) => ({ id: e.id, title: e.title, lat: e.lat, lon: e.lon, category: e.category, color: categoryColor(e.category) })) : []}
              earthquakes={layers.earthquakes ? earthquakes.map((q) => ({ id: q.id, lat: q.lat, lon: q.lon, mag: q.mag, depth: q.depth, place: q.place, timeUnixMs: q.time })) : []}
              volcanoes={layers.volcanoes ? FAMOUS_VOLCANOES.map((v) => {
                const c = volcanoAlerts.get(v.name.toLowerCase());
                const alertColor = c === "red" ? "#ff3a3a" : c === "orange" ? "#ff8a3a" : c === "yellow" ? "#ffd66b" : c === "green" ? "#7cffb1" : "#ff6a3d";
                return { id: v.id, name: v.name, lat: v.lat, lon: v.lon, alertColor, elevated: !!c && c !== "green" };
              }) : []}
              launches={layers.launches ? launches.map((l) => {
                const hoursOut = Math.max(0, (l.netUnixMs - Date.now()) / 3_600_000);
                return { id: l.id, name: l.name, lat: l.padLat, lon: l.padLon, imminent: hoursOut < 1, soon: hoursOut < 24 };
              }) : []}
              weatherTilePath={layers.weather && radarManifest && radarManifest.past.length > 0
                ? (radarFrameIndex < 0
                    ? radarManifest.past[radarManifest.past.length - 1].path
                    : radarManifest.past[Math.min(radarFrameIndex, radarManifest.past.length - 1)].path)
                : undefined}
              weatherOpacity={radarOpacity}
              show3DBuildings={layers.buildings3D !== false}
              imageryStyle={surfaceImagery}
              tiltCommand={surfaceTilt}
              terrainExaggeration={surfaceTerrainExag}
              fogEnabled={surfaceFog}
              manualUtcHour={surfaceManualHour ?? undefined}
              screenshotCommand={surfaceScreenshotCmd}
              measurePoints={measureMode ? measurePoints : undefined}
              geoJson={geoJsonImport ?? undefined}
              onScreenshot={(blob) => {
                // Trigger a download
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `atlas-surface-${Date.now()}.png`;
                document.body.appendChild(a);
                a.click();
                a.remove();
                URL.revokeObjectURL(url);
                showToast("Screenshot saved");
              }}
              selectedAircraft={selectedAircraftId && aircraftSnapshot ? (() => {
                const a = aircraftSnapshot.aircraft.find((x) => x.icao24 === selectedAircraftId);
                return a ? { icao24: a.icao24, callsign: a.callsign, lat: a.lat, lon: a.lon, altitudeM: a.altitudeM, headingDeg: a.headingDeg, velocityMs: a.velocityMs } : null;
              })() : null}
              selectedAircraftHistory={selectedAircraftId ? (aircraftHistoryRef.current.get(selectedAircraftId) ?? []).map((p) => ({ lat: p.lat, lon: p.lon, alt: p.alt })) : undefined}
              onSelectAircraft={(id) => {
                setSelectedAircraftId(id);
                // Deselecting clears follow mode automatically.
                if (!id) setFollowSelectedAircraft(false);
              }}
              followSelectedAircraft={followSelectedAircraft}
              aircraftCameraMode={aircraftCameraMode}
              showTerminator={surfaceTerminator}
              enableGlobeLighting={surfaceGlobeLighting}
              issPosition={layers.iss ? issPosition : null}
              tiangongPosition={layers.tiangong ? tiangongPosition : null}
              hubblePosition={layers.hubble ? hubblePosition : null}
              storms={layers.storms ? activeStorms.map((s) => ({ id: s.id, name: s.name, classification: s.classification, intensityKph: s.intensityKph, lat: s.lat, lon: s.lon, movementDir: s.movementDir })) : []}
              auroraKp={layers.aurora && spaceWeather ? spaceWeather.kpLatest : null}
              autoOrbit={surfaceAutoOrbit}
              aircraftAltitudeBars={surfaceAltBars}
              bordersGeoJson={layers.borders ? bordersGeoJson : null}
              resetHeadingCommand={resetHeadingCmd}
              showLandmarks={layers.landmarks}
              showAirports={layers.airports}
            />
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
          <button type="button" onClick={() => setCommandPaletteOpen(true)}>
            <Search size={14} />
            <span>Search places, layers, settings…</span>
            <kbd>⌘K</kbd>
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
        <RailButton icon={Plane} label="Live aircraft (toggle)" active={layers.aircraft} onClick={() => toggleLayer("aircraft")} />
        <RailButton icon={Film} label="Time-lapse" active={timelapseOpen} onClick={() => setTimelapseOpen(true)} />
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
          {/* Earth's geometric horizon distance: sqrt(2Rh + h²) at altitude h.
              Useful at low altitudes where you might wonder how far you can see. */}
          {cameraState.altKm > 0 && cameraState.altKm < 5000 && (() => {
            const h = cameraState.altKm;
            const horizonKm = Math.sqrt(2 * EARTH_RADIUS_KM * h + h * h);
            return <span title="Geometric horizon distance — how far you'd see from this altitude on a smooth Earth">↻ {Math.round(horizonKm).toLocaleString()} km horizon</span>;
          })()}
          <span>Zoom L{Math.max(1, Math.min(18, Math.round(18 - Math.log2(Math.max(1, cameraState.altKm / 50)))))}</span>
          <button type="button" className="footerLink" onClick={() => setShowShortcuts(true)}>?</button>
        </div>
      </footer>

      {hideUi && (
        <button type="button" className="restoreUi" onClick={() => setHideUi(false)} title="Show UI (H or Esc)">
          <Eye size={13} /> Show UI
        </button>
      )}

      {/* Atlas-mode texture-wrapped sphere can't compete with Cesium's quadtree
          streaming at ground level. Below 200km altitude we surface a hint to
          switch into Surface mode for proper Google-Earth-style detail. */}
      {mode === "atlas" && cameraState.altKm < 800 && cameraState.altKm > 0 && (
        <div className="atlasLowAltHint" role="note">
          <Mountain size={13} />
          <div>
            <strong>Zoom past LEO altitude?</strong>
            <span>Surface mode streams quadtree LOD tiles like Google Earth — true city-level detail. Atlas can't match that with a single texture.</span>
          </div>
          <button type="button" className="atlasPrimaryBtn small" onClick={() => switchToSurface()}>Switch to Surface</button>
          <button type="button" className="atlasIconBtn" onClick={() => setFlyTo((c) => ({ id: c.id + 1, lat: cameraState.lat, lon: cameraState.lon, altKm: 1500 }))} title="Pull back" aria-label="Pull back">
            <X size={12} />
          </button>
        </div>
      )}

      {showSearch && (
        <SearchModal
          query={searchQuery}
          onQuery={setSearchQuery}
          results={combinedSearchResults}
          searching={searching}
          suggestions={initialSearchSuggestions}
          history={searchHistory}
          onSelect={(b) => {
            // Nominatim hits (id prefixed "osm-") are search results — drop
            // a pin automatically so the user sees where they landed. Saved
            // bookmarks just fly.
            const isSearchResult = b.id.startsWith("osm-");
            flyToBookmark(b, { dropPin: isSearchResult });
            setShowSearch(false);
          }}
          onClose={() => setShowSearch(false)}
        />
      )}

      {commandPaletteOpen && (
        <CommandPalette
          onClose={() => setCommandPaletteOpen(false)}
          onGeocodeAndFly={async (q) => {
            // Geocode via Nominatim, fly to the first hit, drop a pin.
            // Optimistic toast so the user knows we heard them.
            showToast(`Searching for "${q}"…`);
            try {
              const res = await fetch(
                `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=1`,
                { headers: { Accept: "application/json" } }
              );
              if (!res.ok) { showToast("Geocode failed"); return; }
              const data = await res.json() as Array<{ lat: string; lon: string; display_name: string }>;
              if (data.length === 0) { showToast(`No matches for "${q}"`); return; }
              const hit = data[0];
              const lat = Number(hit.lat);
              const lon = Number(hit.lon);
              const name = hit.display_name.split(",").slice(0, 2).join(",").trim();
              flyToBookmark({ id: `osm-${Date.now()}`, name, lat, lon, altKm: 5, savedAt: 0 }, { dropPin: true });
            } catch {
              showToast("Geocode failed (network)");
            }
          }}
          items={[
            // Tools
            { id: "search", label: "Search a place…", group: "Tools", icon: Search, hint: "F", run: () => setShowSearch(true) },
            { id: "shortcuts", label: "Show keyboard shortcuts", group: "Tools", icon: Wand2, hint: "?", run: () => setShowShortcuts(true) },
            { id: "embed", label: "Embed snippet", group: "Tools", icon: Share2, run: () => setShowEmbed(true) },
            { id: "about", label: "About / data sources", group: "Tools", icon: Sparkles, run: () => setShowAbout(true) },
            { id: "timelapse", label: "Open time-lapse studio", group: "Tools", icon: Film, run: () => setTimelapseOpen(true) },
            // View
            { id: "reset", label: "Reset view", group: "View", icon: Crosshair, hint: "R", run: () => resetView() },
            { id: "toggleHide", label: hideUi ? "Show UI" : "Hide UI", group: "View", icon: Eye, hint: "H", run: () => setHideUi((v) => !v) },
            // Direct theme picks. The existing T shortcut cycles, these
            // jump directly so power users don't have to count taps.
            { id: "themeDark",  label: "Theme: Dark (default)",  group: "View", icon: SunIcon, run: () => setUiTheme("dark") },
            { id: "themeLight", label: "Theme: Light",            group: "View", icon: SunIcon, run: () => setUiTheme("light") },
            { id: "themeOled",  label: "Theme: OLED (true black)", group: "View", icon: SunIcon, run: () => setUiTheme("oled") },
            { id: "themeCyber", label: "Theme: Cyber (magenta)",   group: "View", icon: SunIcon, run: () => setUiTheme("cyber") },
            { id: "themeSolar", label: "Theme: Solar (warm orange)", group: "View", icon: SunIcon, run: () => setUiTheme("solar") },
            { id: "themeMono",  label: "Theme: Mono (grayscale)",   group: "View", icon: SunIcon, run: () => setUiTheme("mono") },
            { id: "toggleFps", label: showFps ? "Hide FPS overlay" : "Show FPS overlay", group: "View", icon: Telescope, run: () => setShowFps((v) => !v) },
            { id: "togglePin", label: pinTool ? "Exit pin tool" : "Pin tool", group: "View", icon: BookmarkPlus, run: () => setPinTool((v) => !v) },
            { id: "toggleMeasure", label: measureMode ? "Exit measure tool" : "Measure distance (multi-segment path)", group: "View", icon: Compass, run: () => { setMeasureMode((v) => !v); setMeasurePoints([]); } },
            // Clear path while staying in measure mode (drop the
            // accumulated points but keep accepting clicks).
            ...(measureMode && measurePoints.length > 0 ? [{
              id: "measureClear" as const,
              label: `Clear measurement path (${measurePoints.length} point${measurePoints.length === 1 ? "" : "s"})`,
              group: "View" as const,
              icon: Compass,
              run: () => setMeasurePoints([]),
            }] : []),
            // Export measure path as GeoJSON LineString — round-trips
            // through any GeoJSON viewer.
            ...(measureMode && measurePoints.length >= 2 ? [{
              id: "measureExportGeoJSON" as const,
              label: `Export measure path as GeoJSON (${measurePoints.length} vertices)`,
              group: "Tools" as const,
              icon: Compass,
              run: () => {
                const fc = {
                  type: "FeatureCollection",
                  features: [{
                    type: "Feature",
                    geometry: {
                      type: "LineString",
                      coordinates: measurePoints.map(p => [p.lon, p.lat]),
                    },
                    properties: {
                      vertexCount: measurePoints.length,
                      totalKm: (() => {
                        let total = 0;
                        for (let i = 1; i < measurePoints.length; i++) {
                          total += haversineKm(measurePoints[i-1].lat, measurePoints[i-1].lon, measurePoints[i].lat, measurePoints[i].lon);
                        }
                        return Math.round(total);
                      })(),
                    },
                  }],
                };
                const blob = new Blob([JSON.stringify(fc, null, 2)], { type: "application/geo+json" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `atlas-path-${Date.now()}.geojson`;
                document.body.appendChild(a);
                a.click();
                a.remove();
                setTimeout(() => URL.revokeObjectURL(url), 500);
                showToast(`Exported path with ${measurePoints.length} vertices`);
              },
            }, {
              id: "measureCopyCoords" as const,
              label: `Copy measure path coordinates as JSON`,
              group: "Tools" as const,
              icon: Compass,
              run: () => {
                const text = JSON.stringify(measurePoints, null, 2);
                navigator.clipboard?.writeText(text).then(
                  () => showToast(`Copied ${measurePoints.length} points`),
                  () => showToast(text.length > 60 ? text.slice(0, 57) + "..." : text)
                );
              },
            }] : []),
            // Compute spherical-excess area when the path has 3+ vertices —
            // we close the polygon by joining the last vertex back to the
            // first. Useful for area of a state/lake/island.
            ...(measureMode && measurePoints.length >= 3 ? [{
              id: "measureArea" as const,
              label: `Show area enclosed by ${measurePoints.length} vertices`,
              group: "View" as const,
              icon: Compass,
              run: () => {
                // Spherical polygon area via the L'Huilier-style sum of
                // signed wedge angles. Returns km² assuming WGS84 mean
                // radius. Sufficient for typical user-drawn polygons.
                const R = 6371;
                const toRad = (d: number) => d * Math.PI / 180;
                let sum = 0;
                const n = measurePoints.length;
                for (let i = 0; i < n; i++) {
                  const a = measurePoints[i];
                  const b = measurePoints[(i + 1) % n];
                  sum += toRad(b.lon - a.lon) * (2 + Math.sin(toRad(a.lat)) + Math.sin(toRad(b.lat)));
                }
                const areaKm2 = Math.abs(sum * R * R / 2);
                showToast(`Enclosed area: ${areaKm2.toLocaleString(undefined, { maximumFractionDigits: 0 })} km²`);
              },
            }] : []),
            { id: "toggleAutoMode", label: autoModeSwitch ? "Disable auto Atlas/Surface switching" : "Enable auto Atlas/Surface switching", group: "View", icon: Mountain, run: () => setAutoModeSwitch((v) => !v) },
            { id: "dayNightCycle", label: globe.timeAnim ? "Stop day/night cycle" : "Start day/night cycle (24h time-lapse)", group: "View", icon: SunIcon, run: () => updateGlobe({ timeAnim: !globe.timeAnim }) },
            { id: "togglePause", label: paused ? "Resume animation" : "Pause animation", group: "View", icon: paused ? Play : Pause, run: () => setPaused((p) => !p) },
            { id: "tour", label: tourPlaying ? "Stop bookmark tour" : "Start bookmark tour (cycle through pins)", group: "View", icon: Play, run: () => tourPlaying ? stopPinTour() : startPinTour() },
            { id: "saveBookmark", label: "Bookmark current view", group: "View", icon: BookmarkPlus, hint: "B", run: () => saveCurrentBookmark() },
            { id: "myLoc", label: "Fly to my location", group: "View", icon: Navigation, run: () => flyToMyLocation() },
            { id: "flyISS", label: issPosition ? "Fly to ISS (live position)" : "ISS position not loaded yet", group: "View", icon: Telescope, run: () => issPosition && setFlyTo((c) => ({ id: c.id + 1, lat: issPosition.lat, lon: issPosition.lon, altKm: 600 })) },
            { id: "flyTiangong", label: tiangongPosition ? "Fly to Tiangong (live position)" : "Tiangong position not loaded yet", group: "View", icon: Telescope, run: () => tiangongPosition && setFlyTo((c) => ({ id: c.id + 1, lat: tiangongPosition.lat, lon: tiangongPosition.lon, altKm: 600 })) },
            { id: "flyHubble", label: hubblePosition ? "Fly to Hubble (live position)" : "Hubble position not loaded yet", group: "View", icon: Telescope, run: () => hubblePosition && setFlyTo((c) => ({ id: c.id + 1, lat: hubblePosition.lat, lon: hubblePosition.lon, altKm: 800 })) },
            { id: "flyGround", label: "Fly to ground level at current view", group: "View", icon: Mountain, run: () => setFlyTo((c) => ({ id: c.id + 1, lat: cameraState.lat, lon: cameraState.lon, altKm: 0.5 })) },
            { id: "flyOrbit", label: "Pull back to orbital view", group: "View", icon: Globe2, run: () => setFlyTo((c) => ({ id: c.id + 1, lat: cameraState.lat, lon: cameraState.lon, altKm: 12000 })) },
            { id: "flyHome", label: "Fly home (Atlantic, full Earth)", group: "View", icon: Globe2, run: () => setFlyTo((c) => ({ id: c.id + 1, lat: 25, lon: 0, altKm: 12000 })) },
            { id: "flyAmericas", label: "Fly to the Americas hemisphere", group: "View", icon: Globe2, run: () => setFlyTo((c) => ({ id: c.id + 1, lat: 15, lon: -80, altKm: 12000 })) },
            { id: "flyAsia", label: "Fly to the Asia/Pacific hemisphere", group: "View", icon: Globe2, run: () => setFlyTo((c) => ({ id: c.id + 1, lat: 20, lon: 110, altKm: 12000 })) },
            { id: "flyLEO", label: "Fly to LEO altitude (400km)", group: "View", icon: Telescope, run: () => setFlyTo((c) => ({ id: c.id + 1, lat: cameraState.lat, lon: cameraState.lon, altKm: 400 })) },
            { id: "randomPlace", label: "Fly to a random place on Earth", group: "View", icon: Sparkles, run: () => {
              // Pick a uniformly distributed point on the sphere (using inverse CDF on lat
              // so we don't cluster at the poles), biased toward landmasses by retrying
              // up to ~6 times until we hit a non-ocean cell. Fallback to whatever we got.
              const land: [number, number, number][] = [
                // Approximate land bbox centroids — most attempts hit one of these regions
                [40, -100, 30],   // North America
                [-15, -55, 20],   // South America
                [50, 10, 25],     // Europe
                [10, 25, 35],     // Africa
                [40, 80, 35],     // Asia
                [-25, 135, 12],   // Australia
              ];
              const r = land[Math.floor(Math.random() * land.length)];
              const lat = r[0] + (Math.random() - 0.5) * r[2];
              const lon = r[1] + (Math.random() - 0.5) * r[2] * 1.4;
              setFlyTo((c) => ({ id: c.id + 1, lat, lon, altKm: 1500 }));
            }},
            { id: "randomTrueRandom", label: "Fly to anywhere on Earth (uniform random)", group: "View", icon: Sparkles, run: () => {
              const u = Math.random() * 2 - 1;
              const lat = Math.asin(u) * 180 / Math.PI;
              const lon = Math.random() * 360 - 180;
              setFlyTo((c) => ({ id: c.id + 1, lat, lon, altKm: 1500 }));
            }},
            // Layers
            { id: "layerAircraft", label: layers.aircraft ? "Hide aircraft" : "Show live aircraft", group: "Layers", icon: Plane, run: () => toggleLayer("aircraft") },
            { id: "layerWeather", label: layers.weather ? "Hide weather radar" : "Show live weather radar", group: "Layers", icon: Cloud, run: () => toggleLayer("weather") },
            { id: "layerEonet", label: layers.eonet ? "Hide natural-events overlay" : "Show natural events (NASA EONET)", group: "Layers", icon: Sparkles, run: () => toggleLayer("eonet") },
            { id: "layerAurora", label: layers.aurora ? "Hide aurora forecast" : "Show aurora forecast (NOAA OVATION)", group: "Layers", icon: Sparkles, run: () => toggleLayer("aurora") },
            { id: "layerLaunches", label: layers.launches ? "Hide rocket launches" : "Show upcoming rocket launches", group: "Layers", icon: Telescope, run: () => toggleLayer("launches") },
            { id: "layerNoon", label: layers.noonMeridian ? "Hide solar-noon meridian" : "Show solar-noon meridian", group: "Layers", icon: SunIcon, run: () => toggleLayer("noonMeridian") },
            { id: "layerBuildings", label: layers.buildings3D ? "Hide 3D buildings (Surface)" : "Show 3D buildings (Surface)", group: "Layers", icon: Mountain, run: () => toggleLayer("buildings3D") },
            { id: "layerTerminator", label: layers.terminator ? "Hide day/night terminator" : "Show day/night terminator", group: "Layers", icon: Compass, run: () => toggleLayer("terminator") },
            { id: "layerSubsolar", label: layers.subsolar ? "Hide subsolar point" : "Show subsolar point (sun overhead)", group: "Layers", icon: SunIcon, run: () => toggleLayer("subsolar") },
            { id: "widgetNeo", label: layers.neoWatch ? "Hide asteroid watch" : "Show asteroid watch (NASA NeoWS)", group: "Widgets", icon: Telescope, run: () => toggleLayer("neoWatch") },
            { id: "widgetClock", label: layers.timeClock ? "Hide world-clock widget" : "Show world-clock widget", group: "Widgets", icon: Compass, run: () => toggleLayer("timeClock") },
            { id: "widgetDayInfo", label: layers.dayInfo ? "Hide sunrise/sunset widget" : "Show sunrise/sunset for camera location", group: "Widgets", icon: SunIcon, run: () => toggleLayer("dayInfo") },
            { id: "widgetDigest", label: layers.worldDigest ? "Hide world-digest widget" : "Show 'what's happening on Earth' digest", group: "Widgets", icon: Sparkles, run: () => toggleLayer("worldDigest") },
            { id: "layerClouds", label: layers.clouds ? "Hide clouds" : "Show clouds", group: "Layers", icon: Cloud, run: () => toggleLayer("clouds") },
            { id: "layerNight", label: layers.nightLights ? "Hide city lights" : "Show city lights", group: "Layers", icon: SunIcon, run: () => toggleLayer("nightLights") },
            { id: "layerAtm", label: layers.atmosphere ? "Hide atmosphere" : "Show atmosphere", group: "Layers", icon: Sparkles, run: () => toggleLayer("atmosphere") },
            { id: "layerStars", label: layers.stars ? "Hide stars" : "Show stars", group: "Layers", icon: Sparkles, run: () => toggleLayer("stars") },
            { id: "layerBorders", label: layers.borders ? "Hide country borders" : "Show country borders", group: "Layers", icon: Compass, run: () => toggleLayer("borders") },
            { id: "layerEarthquakes", label: layers.earthquakes ? "Hide earthquakes" : "Show earthquakes (24h)", group: "Layers", icon: Sparkles, run: () => toggleLayer("earthquakes") },
            { id: "layerVolcanoes", label: layers.volcanoes ? "Hide volcanoes" : "Show notable volcanoes", group: "Layers", icon: Mountain, run: () => toggleLayer("volcanoes") },
            { id: "layerISS", label: layers.iss ? "Hide ISS" : "Show ISS (live)", group: "Layers", icon: Telescope, run: () => toggleLayer("iss") },
            { id: "layerHubble", label: layers.hubble ? "Hide Hubble" : "Show Hubble (live)", group: "Layers", icon: Telescope, run: () => toggleLayer("hubble") },
            { id: "layerGraticule", label: layers.graticule ? "Hide graticule" : "Show lat/lon graticule", group: "Layers", icon: Compass, run: () => toggleLayer("graticule") },
            { id: "layerPinPaths", label: layers.pinPaths ? "Hide pin paths" : "Show great-circle pin paths", group: "Layers", icon: Compass, run: () => toggleLayer("pinPaths") },
            // Imagery
            { id: "imgBundled", label: "Imagery: Bundled (offline)", group: "Imagery", icon: Sparkles, run: () => updateImagery({ source: "bundled" }) },
            { id: "surfBing", label: "Surface imagery: Bing Aerial", group: "Imagery", icon: Mountain, run: () => setSurfaceImagery("bing") },
            { id: "surfEsri", label: "Surface imagery: ESRI World Imagery", group: "Imagery", icon: Mountain, run: () => setSurfaceImagery("esri") },
            { id: "surfOsm", label: "Surface imagery: OpenStreetMap", group: "Imagery", icon: Mountain, run: () => setSurfaceImagery("osm") },
            { id: "surfTiltTop", label: "Surface camera: top-down (90°)", group: "Imagery", icon: Mountain, run: () => setSurfaceTilt((c) => ({ id: (c?.id ?? 0) + 1, pitchDeg: 90 })) },
            { id: "surfTilt45", label: "Surface camera: oblique (45°)", group: "Imagery", icon: Mountain, run: () => setSurfaceTilt((c) => ({ id: (c?.id ?? 0) + 1, pitchDeg: 45 })) },
            { id: "surfTilt30", label: "Surface camera: low oblique (30°)", group: "Imagery", icon: Mountain, run: () => setSurfaceTilt((c) => ({ id: (c?.id ?? 0) + 1, pitchDeg: 30 })) },
            { id: "surfTiltHorizon", label: "Surface camera: horizon view (10°)", group: "Imagery", icon: Mountain, run: () => setSurfaceTilt((c) => ({ id: (c?.id ?? 0) + 1, pitchDeg: 10 })) },
            { id: "surfAutoOrbit", label: surfaceAutoOrbit ? "Stop auto-orbit (Surface)" : "Start auto-orbit (Surface)", group: "View", icon: RotateCcw, run: () => setSurfaceAutoOrbit((v) => !v) },
            { id: "surfResetHeading", label: "Surface camera: reset heading to north", group: "View", icon: Navigation, run: () => setResetHeadingCmd((c) => ({ id: (c?.id ?? 0) + 1 })) },
            // Open-Meteo current weather at camera-center lat/lon. Free,
            // no auth. Returns temp/wind/wind-dir.
            { id: "currentWeather", label: "Show current weather at this view (Open-Meteo)", group: "Tools", icon: Cloud, run: async () => {
              const c = cameraStateRef.current;
              if (!c) return;
              try {
                const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${c.lat}&longitude=${c.lon}&current=temperature_2m,wind_speed_10m,wind_direction_10m,relative_humidity_2m,weather_code`, { cache: "no-store" });
                const j = await r.json();
                const cur = j?.current;
                if (!cur) { showToast("Weather: no data"); return; }
                showToast(`☁ ${cur.temperature_2m}°C · wind ${cur.wind_speed_10m} kph @ ${Math.round(cur.wind_direction_10m)}° · RH ${cur.relative_humidity_2m}%`);
              } catch { showToast("Weather: fetch failed"); }
            }},
            // Open-Meteo air quality at camera-center. Returns PM2.5/10 + EU AQI.
            // Closest aircraft to the camera-center point. Useful for
            // identifying "what's that plane right above me" — set the
            // camera to your location, run this command, get a list.
            // Pick a random live aircraft and follow it.
            { id: "randomAircraft", label: "Pick a random live aircraft to follow", group: "Tools", icon: Plane, run: () => {
              if (!aircraftSnapshot || aircraftSnapshot.aircraft.length === 0) {
                showToast("Aircraft layer not loaded — turn it on first");
                return;
              }
              const list = aircraftSnapshot.aircraft.filter((a) => a.altitudeM > 5000);
              const a = list[Math.floor(Math.random() * list.length)];
              if (!a) return;
              setSelectedAircraftId(a.icao24);
              setFlyTo((p) => ({ id: p.id + 1, lat: a.lat, lon: a.lon, altKm: 100 }));
              showToast(`✈ Following ${(a.callsign || a.icao24.toUpperCase()).trim()} at ${Math.round(a.altitudeM/0.3048).toLocaleString()} ft`);
            }},
            // Compute the airport with the most live aircraft within
            // 50km — a rough proxy for "busiest right now". O(N*M) but
            // both N (aircraft, ~12k) and M (airports, ~80) are bounded.
            { id: "busiestAirport", label: "Find busiest airport right now (live ADS-B)", group: "Tools", icon: Plane, run: () => {
              if (!aircraftSnapshot || aircraftSnapshot.aircraft.length === 0) {
                showToast("Aircraft layer not loaded — turn it on first");
                return;
              }
              let bestCount = 0;
              let best: typeof AIRPORTS[0] | null = null;
              for (const ap of AIRPORTS) {
                let count = 0;
                for (const a of aircraftSnapshot.aircraft) {
                  if (haversineKm(ap.lat, ap.lon, a.lat, a.lon) < 50) count++;
                }
                if (count > bestCount) { bestCount = count; best = ap; }
              }
              if (!best) { showToast("No traffic visible near any major airport"); return; }
              setFlyTo((p) => ({ id: p.id + 1, lat: best!.lat, lon: best!.lon, altKm: 30 }));
              showToast(`🏆 ${best.iata} (${best.city}) — ${bestCount} aircraft within 50km`);
            }},
            // Closest airport / landmark to camera-center.
            { id: "closestAirport", label: "Show closest major airport to this view", group: "Tools", icon: Plane, run: () => {
              const c = cameraStateRef.current;
              if (!c) return;
              const ranked = AIRPORTS
                .map((ap) => ({ ap, d: haversineKm(c.lat, c.lon, ap.lat, ap.lon) }))
                .sort((x, y) => x.d - y.d)
                .slice(0, 3);
              const list = ranked.map(({ ap, d }) => `${ap.iata} (${d.toFixed(0)}km)`).join(" · ");
              showToast(`✈ Nearest airports: ${list}`);
            }},
            { id: "closestLandmark", label: "Show closest famous landmark to this view", group: "Tools", icon: Mountain, run: () => {
              const c = cameraStateRef.current;
              if (!c) return;
              const ranked = LANDMARKS
                .map((lm) => ({ lm, d: haversineKm(c.lat, c.lon, lm.lat, lm.lon) }))
                .sort((x, y) => x.d - y.d)
                .slice(0, 3);
              const list = ranked.map(({ lm, d }) => `${lm.emoji} ${lm.name} (${d.toFixed(0)}km)`).join(" · ");
              showToast(list);
            }},
            { id: "closestAircraft", label: "Show closest aircraft to this view", group: "Tools", icon: Plane, run: () => {
              const c = cameraStateRef.current;
              if (!c || !aircraftSnapshot || aircraftSnapshot.aircraft.length === 0) {
                showToast("No aircraft loaded — turn the layer on first");
                return;
              }
              const ranked = aircraftSnapshot.aircraft
                .map((a) => ({ a, d: haversineKm(c.lat, c.lon, a.lat, a.lon) }))
                .sort((x, y) => x.d - y.d)
                .slice(0, 5);
              const list = ranked.map(({ a, d }) => `${(a.callsign || a.icao24.toUpperCase()).trim()}@${Math.round(a.altitudeM/0.3048).toLocaleString()}ft (${d.toFixed(0)}km)`).join(" · ");
              showToast(`✈ ${list}`);
            }},
            { id: "currentAQ", label: "Show air quality at this view (Open-Meteo)", group: "Tools", icon: Cloud, run: async () => {
              const c = cameraStateRef.current;
              if (!c) return;
              try {
                const r = await fetch(`https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${c.lat}&longitude=${c.lon}&current=european_aqi,pm10,pm2_5`, { cache: "no-store" });
                const j = await r.json();
                const cur = j?.current;
                if (!cur) { showToast("AQ: no data"); return; }
                const aqi = cur.european_aqi ?? "—";
                const tier = typeof aqi === "number"
                  ? (aqi < 20 ? "good" : aqi < 40 ? "fair" : aqi < 60 ? "moderate" : aqi < 80 ? "poor" : aqi < 100 ? "very poor" : "extremely poor")
                  : "—";
                showToast(`🌫 EU AQI ${aqi} (${tier}) · PM2.5 ${cur.pm2_5} · PM10 ${cur.pm10} µg/m³`);
              } catch { showToast("AQ: fetch failed"); }
            }},
            { id: "surfAltBars", label: surfaceAltBars ? "Hide aircraft altitude bars" : "Show aircraft altitude bars", group: "Layers", icon: Plane, run: () => setSurfaceAltBars((v) => !v) },
            { id: "exag1", label: "Terrain exaggeration: 1× (real)", group: "Imagery", icon: Mountain, run: () => setSurfaceTerrainExag(1) },
            { id: "exag15", label: "Terrain exaggeration: 1.5×", group: "Imagery", icon: Mountain, run: () => setSurfaceTerrainExag(1.5) },
            { id: "exag2", label: "Terrain exaggeration: 2× (dramatic)", group: "Imagery", icon: Mountain, run: () => setSurfaceTerrainExag(2) },
            { id: "exag3", label: "Terrain exaggeration: 3× (extreme)", group: "Imagery", icon: Mountain, run: () => setSurfaceTerrainExag(3) },
            { id: "toggleFog", label: surfaceFog ? "Hide atmospheric fog" : "Show atmospheric fog", group: "Imagery", icon: Cloud, run: () => setSurfaceFog((v) => !v) },
            { id: "toggleTerminator", label: surfaceTerminator ? "Hide day/night terminator (Surface)" : "Show day/night terminator (Surface)", group: "Layers", icon: SunIcon, run: () => setSurfaceTerminator((v) => !v) },
            { id: "toggleGlobeLighting", label: surfaceGlobeLighting === false ? "Enable Cesium globe lighting (sun-shaded)" : "Disable Cesium globe lighting (flat)", group: "Imagery", icon: SunIcon, run: () => setSurfaceGlobeLighting((v) => v === false ? true : false) },
            // Computes local solar info for the camera-center lat/lon —
            // sunrise / sunset / day length / current sun elevation. No
            // pinning needed; the user just navigates to a place and runs
            // this command from Cmd+K. Math is NOAA-style hour-angle
            // approximation (within ~1 minute of the official table).
            // Encodes camera lat/lon/altKm into the URL's hash and copies
            // it to the clipboard. Pasting the URL in another tab lands
            // the user at the same view.
            // Fly to the antipodal point (opposite side of the globe).
            // For the curious — drop a pen through the center of the
            // earth, this is where it would come out the other side.
            { id: "antipode", label: "Fly to antipode of current view", group: "View", icon: Navigation, run: () => {
              const c = cameraStateRef.current;
              if (!c) return;
              const antiLat = -c.lat;
              const antiLon = c.lon > 0 ? c.lon - 180 : c.lon + 180;
              setFlyTo((p) => ({ id: p.id + 1, lat: antiLat, lon: antiLon, altKm: c.altKm }));
              showToast(`Antipode: ${formatLat(antiLat)} ${formatLon(antiLon)}`);
            }},
            // Random bookmarked place — useful for exploring the globe
            // without a destination in mind.
            { id: "randomFlyTo", label: "Fly to a random place", group: "View", icon: Navigation, run: () => {
              if (bookmarks.length === 0) return;
              const b = bookmarks[Math.floor(Math.random() * bookmarks.length)];
              setFlyTo((p) => ({ id: p.id + 1, lat: b.lat, lon: b.lon, altKm: 5 }));
              showToast(`✈ Surprise: ${b.name}`);
            }},
            // Pole quick-views.
            { id: "viewNorthPole", label: "View North Pole", group: "View", icon: Navigation, run: () => setFlyTo((p) => ({ id: p.id + 1, lat: 89.99, lon: 0, altKm: 4500 })) },
            { id: "viewSouthPole", label: "View South Pole", group: "View", icon: Navigation, run: () => setFlyTo((p) => ({ id: p.id + 1, lat: -89.99, lon: 0, altKm: 4500 })) },
            // Quick zoom shortcuts that preserve lat/lon and just change altitude.
            { id: "zoomIn2x", label: "Zoom in 2× (halve altitude)", group: "View", icon: Maximize2, run: () => {
              const c = cameraStateRef.current;
              if (c) setFlyTo((p) => ({ id: p.id + 1, lat: c.lat, lon: c.lon, altKm: Math.max(0.05, c.altKm / 2) }));
            }},
            { id: "zoomOut2x", label: "Zoom out 2× (double altitude)", group: "View", icon: Maximize2, run: () => {
              const c = cameraStateRef.current;
              if (c) setFlyTo((p) => ({ id: p.id + 1, lat: c.lat, lon: c.lon, altKm: Math.min(50000, c.altKm * 2) }));
            }},
            { id: "fitGlobe", label: "Fit globe in view (orbital)", group: "View", icon: Globe2, run: () => {
              const c = cameraStateRef.current;
              if (c) setFlyTo((p) => ({ id: p.id + 1, lat: c.lat, lon: c.lon, altKm: 12000 }));
            }},
            { id: "lookHorizon", label: "Pull camera to horizon level", group: "View", icon: Mountain, run: () => {
              const c = cameraStateRef.current;
              if (c) setFlyTo((p) => ({ id: p.id + 1, lat: c.lat, lon: c.lon, altKm: 1.5 }));
            }},
            // Quick equator hop — useful for showing the curvature of the
            // earth without traveling round-trip.
            { id: "viewEquator", label: "Center on equator at this longitude", group: "View", icon: Navigation, run: () => {
              const c = cameraStateRef.current;
              if (c) setFlyTo((p) => ({ id: p.id + 1, lat: 0, lon: c.lon, altKm: c.altKm }));
            }},
            { id: "viewPrimeMeridian", label: "Center on prime meridian at this latitude", group: "View", icon: Navigation, run: () => {
              const c = cameraStateRef.current;
              if (c) setFlyTo((p) => ({ id: p.id + 1, lat: c.lat, lon: 0, altKm: c.altKm }));
            }},
            { id: "viewDateLine", label: "Center on the international date line", group: "View", icon: Navigation, run: () => {
              const c = cameraStateRef.current;
              if (c) setFlyTo((p) => ({ id: p.id + 1, lat: c.lat, lon: 180, altKm: c.altKm }));
            }},
            // Live data summary as a single toast — what's loaded right now.
            { id: "statsSummary", label: "Show live data summary (counts)", group: "Tools", icon: Sparkles, run: () => {
              const parts: string[] = [];
              if (aircraftSnapshot) parts.push(`${aircraftSnapshot.aircraft.length.toLocaleString()} aircraft (${aircraftSnapshot.source})`);
              if (eonetEvents.length > 0) parts.push(`${eonetEvents.length} EONET events`);
              if (earthquakes.length > 0) parts.push(`${earthquakes.length} earthquakes`);
              if (launches.length > 0) parts.push(`${launches.length} upcoming launches`);
              if (activeStorms.length > 0) parts.push(`${activeStorms.length} active storms`);
              if (pins.length > 0) parts.push(`${pins.length} pins`);
              if (bookmarks.length > 0) parts.push(`${bookmarks.length} bookmarks`);
              if (parts.length === 0) showToast("No live data loaded yet");
              else showToast(`Loaded: ${parts.join(" · ")}`);
            }},
            // Flight statistics for the currently-loaded aircraft set.
            { id: "flightStats", label: "Show flight stats (avg / max altitude, top airline)", group: "Tools", icon: Plane, run: () => {
              if (!aircraftSnapshot || aircraftSnapshot.aircraft.length === 0) {
                showToast("Aircraft layer not loaded yet"); return;
              }
              const list = aircraftSnapshot.aircraft.filter(a => !a.onGround);
              const avgAltFt = Math.round(list.reduce((s, a) => s + a.altitudeM / 0.3048, 0) / list.length);
              const maxAltFt = Math.round(Math.max(...list.map(a => a.altitudeM / 0.3048)));
              const fastest = list.reduce((best, a) => a.velocityMs > best.velocityMs ? a : best, list[0]);
              const fastestKt = Math.round(fastest.velocityMs * 1.94384);
              // Tally airline by 3-letter callsign prefix.
              const tally = new Map<string, number>();
              for (const a of list) {
                const p = (a.callsign || "").slice(0, 3).toUpperCase();
                if (p.length === 3 && /[A-Z]{3}/.test(p)) tally.set(p, (tally.get(p) || 0) + 1);
              }
              const sorted = [...tally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
              const top = sorted.map(([k, v]) => `${k}(${v})`).join(", ");
              showToast(`${list.length.toLocaleString()} airborne · avg ${avgAltFt.toLocaleString()} ft · max ${maxAltFt.toLocaleString()} ft · fastest ${fastest.callsign || fastest.icao24} @ ${fastestKt} kt · top: ${top}`);
            }},
            // Distance from current view to a famous landmark ("how far am
            // I from Mt Everest right now"). Iterates the bookmark list +
            // landmarks.
            // Aircraft filter quick-jumps
            { id: "filterAllAircraft", label: "Aircraft filter: all", group: "Tools", icon: Plane, run: () => { setAircraftCategory("all"); setAircraftMinAltFt(0); setAircraftMaxAltFt(50000); setAircraftAirlinePrefix(""); showToast("Showing all aircraft"); } },
            { id: "filterCommercial", label: "Aircraft filter: commercial only", group: "Tools", icon: Plane, run: () => { setAircraftCategory("commercial"); showToast("Filter: commercial"); } },
            { id: "filterMilitary", label: "Aircraft filter: military only (callsign hint)", group: "Tools", icon: Plane, run: () => { setAircraftCategory("military"); showToast("Filter: military"); } },
            { id: "filterHeli", label: "Aircraft filter: helicopters only", group: "Tools", icon: Plane, run: () => { setAircraftCategory("heli"); showToast("Filter: helicopters"); } },
            { id: "filterPrivate", label: "Aircraft filter: private / GA only", group: "Tools", icon: Plane, run: () => { setAircraftCategory("private"); showToast("Filter: private/GA"); } },
            { id: "filterCruise", label: "Aircraft filter: cruise altitude (30k-45k ft)", group: "Tools", icon: Plane, run: () => { setAircraftMinAltFt(30000); setAircraftMaxAltFt(45000); showToast("Filter: 30k-45k ft cruise"); } },
            { id: "filterLow", label: "Aircraft filter: low altitude (<10k ft, departures/arrivals)", group: "Tools", icon: Plane, run: () => { setAircraftMinAltFt(0); setAircraftMaxAltFt(10000); showToast("Filter: <10k ft"); } },
            { id: "filterHigh", label: "Aircraft filter: high altitude (>40k ft, biz jets)", group: "Tools", icon: Plane, run: () => { setAircraftMinAltFt(40000); setAircraftMaxAltFt(50000); showToast("Filter: >40k ft"); } },
            // Quick airline filters by callsign prefix
            { id: "airlineUAL", label: "Airline: United (UAL)", group: "Tools", icon: Plane, run: () => { setAircraftAirlinePrefix("UAL"); showToast("Airline: UAL"); } },
            { id: "airlineAAL", label: "Airline: American (AAL)", group: "Tools", icon: Plane, run: () => { setAircraftAirlinePrefix("AAL"); showToast("Airline: AAL"); } },
            { id: "airlineDAL", label: "Airline: Delta (DAL)", group: "Tools", icon: Plane, run: () => { setAircraftAirlinePrefix("DAL"); showToast("Airline: DAL"); } },
            { id: "airlineBAW", label: "Airline: British Airways (BAW)", group: "Tools", icon: Plane, run: () => { setAircraftAirlinePrefix("BAW"); showToast("Airline: BAW"); } },
            { id: "airlineSWA", label: "Airline: Southwest (SWA)", group: "Tools", icon: Plane, run: () => { setAircraftAirlinePrefix("SWA"); showToast("Airline: SWA"); } },
            { id: "airlineRYR", label: "Airline: Ryanair (RYR)", group: "Tools", icon: Plane, run: () => { setAircraftAirlinePrefix("RYR"); showToast("Airline: RYR"); } },
            { id: "airlineUAE", label: "Airline: Emirates (UAE)", group: "Tools", icon: Plane, run: () => { setAircraftAirlinePrefix("UAE"); showToast("Airline: UAE"); } },
            { id: "airlineQTR", label: "Airline: Qatar (QTR)", group: "Tools", icon: Plane, run: () => { setAircraftAirlinePrefix("QTR"); showToast("Airline: QTR"); } },
            { id: "airlineSIA", label: "Airline: Singapore (SIA)", group: "Tools", icon: Plane, run: () => { setAircraftAirlinePrefix("SIA"); showToast("Airline: SIA"); } },
            { id: "airlineANA", label: "Airline: All Nippon (ANA)", group: "Tools", icon: Plane, run: () => { setAircraftAirlinePrefix("ANA"); showToast("Airline: ANA"); } },
            { id: "airlineAFR", label: "Airline: Air France (AFR)", group: "Tools", icon: Plane, run: () => { setAircraftAirlinePrefix("AFR"); showToast("Airline: AFR"); } },
            { id: "airlineDLH", label: "Airline: Lufthansa (DLH)", group: "Tools", icon: Plane, run: () => { setAircraftAirlinePrefix("DLH"); showToast("Airline: DLH"); } },
            { id: "airlineKLM", label: "Airline: KLM (KLM)", group: "Tools", icon: Plane, run: () => { setAircraftAirlinePrefix("KLM"); showToast("Airline: KLM"); } },
            { id: "airlineCPA", label: "Airline: Cathay Pacific (CPA)", group: "Tools", icon: Plane, run: () => { setAircraftAirlinePrefix("CPA"); showToast("Airline: CPA"); } },
            { id: "airlineFDX", label: "Airline: FedEx (FDX)", group: "Tools", icon: Plane, run: () => { setAircraftAirlinePrefix("FDX"); showToast("Airline: FDX cargo"); } },
            { id: "airlineUPS", label: "Airline: UPS (UPS)", group: "Tools", icon: Plane, run: () => { setAircraftAirlinePrefix("UPS"); showToast("Airline: UPS cargo"); } },
            // Emergency-squawk filter shortcut.
            { id: "filterEmergency", label: "Aircraft filter: emergency squawks (7500/7600/7700)", group: "Tools", icon: Plane, run: () => {
              if (!aircraftSnapshot) { showToast("Aircraft layer not loaded"); return; }
              const emergencies = aircraftSnapshot.aircraft.filter(a => a.squawk === "7500" || a.squawk === "7600" || a.squawk === "7700");
              if (emergencies.length === 0) {
                showToast("✅ No aircraft squawking emergency");
              } else {
                // Fly to the first emergency
                const a = emergencies[0];
                setFlyTo((p) => ({ id: p.id + 1, lat: a.lat, lon: a.lon, altKm: 100 }));
                setSelectedAircraftId(a.icao24);
                showToast(`🚨 ${emergencies.length} emergency squawk${emergencies.length === 1 ? "" : "s"} — flying to ${a.callsign || a.icao24} (${a.squawk})`);
              }
            }},
            // Discovery / random commands — useful for browsing without
            // a destination in mind.
            { id: "randomCity", label: "Fly to a random major city", group: "View", icon: Navigation, run: () => {
              if (MAJOR_CITIES.length === 0) return;
              const c = MAJOR_CITIES[Math.floor(Math.random() * MAJOR_CITIES.length)];
              setFlyTo((p) => ({ id: p.id + 1, lat: c.lat, lon: c.lon, altKm: 30 }));
              showToast(`✈ Random city: ${c.name}, ${c.country}`);
            }},
            { id: "biggestQuake", label: "Fly to today's biggest earthquake", group: "Tools", icon: Sparkles, run: () => {
              if (earthquakes.length === 0) { showToast("Earthquake layer not loaded"); return; }
              const biggest = earthquakes.reduce((max, q) => q.mag > max.mag ? q : max);
              setFlyTo((p) => ({ id: p.id + 1, lat: biggest.lat, lon: biggest.lon, altKm: 100 }));
              showToast(`💥 M${biggest.mag.toFixed(1)} — ${biggest.place}`);
            }},
            { id: "newestEonet", label: "Fly to most recent EONET event", group: "Tools", icon: Sparkles, run: () => {
              if (eonetEvents.length === 0) { showToast("EONET layer not loaded"); return; }
              // EONET events come ordered newest-first.
              const e = eonetEvents[0];
              setFlyTo((p) => ({ id: p.id + 1, lat: e.lat, lon: e.lon, altKm: 200 }));
              showToast(`🌍 ${e.title} (${e.category})`);
            }},
            { id: "nextLaunch", label: "Fly to next rocket launch pad", group: "Tools", icon: Sparkles, run: () => {
              if (launches.length === 0) { showToast("No upcoming launches loaded"); return; }
              const next = launches.find((l) => l.netUnixMs > Date.now()) || launches[0];
              setFlyTo((p) => ({ id: p.id + 1, lat: next.padLat, lon: next.padLon, altKm: 50 }));
              const hours = Math.max(0, (next.netUnixMs - Date.now()) / 3_600_000);
              showToast(`🚀 ${next.name} — T-${hours < 1 ? `${Math.round(hours * 60)} min` : `${hours.toFixed(1)} hr`}`);
            }},
            // Camera-orientation resets
            { id: "headingNorth", label: "Reset heading to true north", group: "View", icon: Compass, run: () => {
              const c = cameraStateRef.current;
              if (c) setFlyTo((p) => ({ id: p.id + 1, lat: c.lat, lon: c.lon, altKm: c.altKm }));
            }},
            // "Where am I" — try the precise navigator.geolocation first
            // (browser permission prompt), fall back to IP-based estimate.
            { id: "myLocation", label: "Fly to my location (GPS or IP)", group: "View", icon: Navigation, run: () => {
              showToast("Getting your location…");
              const flyTo = (lat: number, lon: number, source: string) => {
                setFlyTo((p) => ({ id: p.id + 1, lat, lon, altKm: 30 }));
                onGlobeClick(lat, lon, { shift: true });    // also drop a pin
                showToast(`📍 You are here (${source})`);
              };
              if (navigator.geolocation) {
                navigator.geolocation.getCurrentPosition(
                  (pos) => flyTo(pos.coords.latitude, pos.coords.longitude, "GPS"),
                  async () => {
                    // GPS denied — fallback to IP geolocation
                    try {
                      const r = await fetch("https://ipapi.co/json/", { cache: "no-store" });
                      if (!r.ok) throw new Error(`${r.status}`);
                      const d = await r.json();
                      if (typeof d?.latitude === "number" && typeof d?.longitude === "number") {
                        flyTo(d.latitude, d.longitude, "IP");
                      } else {
                        showToast("Could not determine location");
                      }
                    } catch { showToast("Geolocation failed"); }
                  },
                  { timeout: 10000 }
                );
              } else {
                showToast("Geolocation not supported");
              }
            }},
            // Quick coord-input parser. Pops a prompt() so user can paste
            // any of: "37.77, -122.42", "37.77 -122.42", or just numbers.
            { id: "flyToCoords", label: "Fly to coordinates (prompt for lat/lon)", group: "View", icon: Navigation, run: () => {
              const input = window.prompt("Enter lat, lon (e.g. 37.77, -122.42)");
              if (!input) return;
              const m = input.trim().match(/(-?\d+(?:\.\d+)?)\s*[,\s]\s*(-?\d+(?:\.\d+)?)/);
              if (!m) { showToast("Could not parse coordinates"); return; }
              const lat = parseFloat(m[1]);
              const lon = parseFloat(m[2]);
              if (Math.abs(lat) > 90 || Math.abs(lon) > 180) { showToast("Out of range"); return; }
              setFlyTo((p) => ({ id: p.id + 1, lat, lon, altKm: 30 }));
              showToast(`Flying to ${lat.toFixed(3)}, ${lon.toFixed(3)}`);
            }},
            // Subsolar fly-to: jump to where the sun is directly overhead.
            { id: "flyToSubsolar", label: "Fly to where the sun is overhead right now", group: "Tools", icon: SunIcon, run: () => {
              const now = new Date();
              const start = Date.UTC(now.getUTCFullYear(), 0, 0);
              const doy = Math.floor((now.getTime() - start) / 86400000);
              const declDeg = 23.45 * Math.sin(2 * Math.PI / 365 * (doy - 81));
              const utcHours = now.getUTCHours() + now.getUTCMinutes() / 60 + now.getUTCSeconds() / 3600;
              const subsolarLonDeg = -((utcHours - 12) * 15);
              setFlyTo((p) => ({ id: p.id + 1, lat: declDeg, lon: subsolarLonDeg, altKm: 8000 }));
              showToast(`☀ Subsolar point: ${declDeg.toFixed(2)}° N, ${subsolarLonDeg.toFixed(2)}° E`);
            }},
            // Antisolar fly-to: directly opposite — midnight at this moment.
            { id: "flyToAntisolar", label: "Fly to the antisolar point (midnight, opposite of sun)", group: "Tools", icon: SunIcon, run: () => {
              const now = new Date();
              const start = Date.UTC(now.getUTCFullYear(), 0, 0);
              const doy = Math.floor((now.getTime() - start) / 86400000);
              const declDeg = 23.45 * Math.sin(2 * Math.PI / 365 * (doy - 81));
              const utcHours = now.getUTCHours() + now.getUTCMinutes() / 60 + now.getUTCSeconds() / 3600;
              const subsolarLonDeg = -((utcHours - 12) * 15);
              const antiLat = -declDeg;
              const antiLon = subsolarLonDeg > 0 ? subsolarLonDeg - 180 : subsolarLonDeg + 180;
              setFlyTo((p) => ({ id: p.id + 1, lat: antiLat, lon: antiLon, altKm: 8000 }));
              showToast(`🌑 Antisolar point: ${antiLat.toFixed(2)}° N, ${antiLon.toFixed(2)}° E`);
            }},
            // Lunar phase: percent illumination derived from synodic month.
            { id: "lunarPhase", label: "Show current moon phase", group: "Tools", icon: SunIcon, run: () => {
              // Approximate lunar age. Reference new moon: 2000-01-06 18:14 UTC.
              const refMs = Date.UTC(2000, 0, 6, 18, 14, 0);
              const synodicDays = 29.530588853;
              const ageDays = ((Date.now() - refMs) / 86400000) % synodicDays;
              const phase = ageDays / synodicDays;
              // 0..0.5 = waxing, 0.5..1 = waning
              const illum = Math.round((1 - Math.cos(phase * 2 * Math.PI)) / 2 * 100);
              const name =
                ageDays < 1.0   ? "New Moon" :
                ageDays < 7.0   ? "Waxing Crescent" :
                ageDays < 8.5   ? "First Quarter" :
                ageDays < 14.0  ? "Waxing Gibbous" :
                ageDays < 15.5  ? "Full Moon" :
                ageDays < 22.0  ? "Waning Gibbous" :
                ageDays < 23.5  ? "Last Quarter" :
                                  "Waning Crescent";
              const glyph =
                ageDays < 1.0   ? "🌑" :
                ageDays < 7.0   ? "🌒" :
                ageDays < 8.5   ? "🌓" :
                ageDays < 14.0  ? "🌔" :
                ageDays < 15.5  ? "🌕" :
                ageDays < 22.0  ? "🌖" :
                ageDays < 23.5  ? "🌗" :
                                  "🌘";
              showToast(`${glyph} ${name} · ${illum}% illuminated · age ${ageDays.toFixed(1)} days`);
            }},
            // Solar elongation — angle between sun and moon as seen from earth.
            // Useful for knowing when the moon will be visible at night.
            // Open-Meteo wind & temp at the camera-center.
            { id: "windTemp", label: "Show wind + temperature at this view (Open-Meteo)", group: "Tools", icon: Cloud, run: async () => {
              const c = cameraStateRef.current;
              if (!c) return;
              showToast(`Fetching weather for ${formatLat(c.lat)} ${formatLon(c.lon)}…`);
              try {
                const url = `https://api.open-meteo.com/v1/forecast?latitude=${c.lat.toFixed(3)}&longitude=${c.lon.toFixed(3)}&current=temperature_2m,wind_speed_10m,wind_direction_10m,relative_humidity_2m,weather_code,cloud_cover,pressure_msl&temperature_unit=celsius&wind_speed_unit=kmh`;
                const r = await fetch(url, { cache: "no-store" });
                if (!r.ok) { showToast("Open-Meteo fetch failed"); return; }
                const d = await r.json();
                const cu = d?.current;
                if (!cu) { showToast("No current data"); return; }
                const wcode = cu.weather_code;
                const wname = ({ 0: "clear", 1: "mostly clear", 2: "partly cloudy", 3: "overcast", 45: "fog", 51: "drizzle", 61: "rain", 71: "snow", 95: "thunderstorm" } as Record<number, string>)[wcode] || `code ${wcode}`;
                const dirCardinal = ["N","NE","E","SE","S","SW","W","NW"][Math.round(cu.wind_direction_10m / 45) % 8];
                showToast(`🌡 ${cu.temperature_2m}°C · 💨 ${Math.round(cu.wind_speed_10m)} kph from ${dirCardinal} · ${wname} · ${cu.cloud_cover}% cloud · ${cu.pressure_msl} hPa`);
              } catch { showToast("Weather request failed"); }
            }},
            // Bookmarks export/import
            { id: "exportBookmarks", label: bookmarks.length > 0 ? `Export ${bookmarks.length} bookmarks as JSON` : "Export bookmarks (none yet)", group: "Tools", icon: Bookmark, run: () => {
              if (bookmarks.length === 0) { showToast("No bookmarks to export"); return; }
              const blob = new Blob([JSON.stringify(bookmarks, null, 2)], { type: "application/json" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = `atlas-bookmarks-${new Date().toISOString().slice(0, 10)}.json`;
              document.body.appendChild(a);
              a.click();
              a.remove();
              setTimeout(() => URL.revokeObjectURL(url), 500);
              showToast(`Exported ${bookmarks.length} bookmarks`);
            }},
            // Camera cinematic — slow zoom-out from current view to orbital
            // over ~6 seconds. Animates by stepping flyTo target altitudes.
            { id: "cinematicZoomOut", label: "Cinematic: slow zoom out to orbital view", group: "View", icon: Film, run: () => {
              const c = cameraStateRef.current;
              if (!c) return;
              const startAlt = c.altKm;
              const endAlt = 12000;
              const steps = 20;
              for (let i = 0; i <= steps; i++) {
                const t = i / steps;
                // Ease-in-out cubic
                const eased = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
                const alt = startAlt + (endAlt - startAlt) * eased;
                setTimeout(() => {
                  setFlyTo((p) => ({ id: p.id + 1, lat: c.lat, lon: c.lon, altKm: alt }));
                }, i * 250);
              }
              showToast("🎬 Cinematic zoom-out");
            }},
            { id: "cinematicZoomIn", label: "Cinematic: slow zoom in to street level", group: "View", icon: Film, run: () => {
              const c = cameraStateRef.current;
              if (!c) return;
              const startAlt = c.altKm;
              const endAlt = 0.5;
              const steps = 20;
              for (let i = 0; i <= steps; i++) {
                const t = i / steps;
                const eased = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
                const alt = startAlt * Math.pow(endAlt / startAlt, eased);
                setTimeout(() => {
                  setFlyTo((p) => ({ id: p.id + 1, lat: c.lat, lon: c.lon, altKm: alt }));
                }, i * 250);
              }
              showToast("🎬 Cinematic zoom-in");
            }},
            // Auto 360° spin around current view location.
            // Pin tour: walk through every pin in chronological order with
            // a fly + dwell. Useful for sharing a "here are the places I
            // care about" sequence.
            { id: "tourPins", label: pins.length > 1 ? `Tour all ${pins.length} pins (3s each)` : "Tour pins (need 2+ pins)", group: "View", icon: Film, run: () => {
              if (pins.length < 2) { showToast("Add at least 2 pins to start a tour"); return; }
              showToast(`🎬 Tour: ${pins.length} pins — ${pins.length * 3}s total`);
              pins.forEach((pin, i) => {
                setTimeout(() => {
                  setFlyTo((p) => ({ id: p.id + 1, lat: pin.lat, lon: pin.lon, altKm: 30 }));
                  showToast(`📍 ${i + 1}/${pins.length}: ${pin.label}`);
                }, i * 3000);
              });
            }},
            // Tour bookmarks (saved places).
            { id: "tourBookmarks", label: bookmarks.length > 1 ? `Tour all ${bookmarks.length} bookmarks (3s each)` : "Tour bookmarks (need 2+)", group: "View", icon: Film, run: () => {
              if (bookmarks.length < 2) { showToast("Need at least 2 bookmarks"); return; }
              showToast(`🎬 Tour: ${bookmarks.length} bookmarks`);
              bookmarks.forEach((bm, i) => {
                setTimeout(() => {
                  setFlyTo((p) => ({ id: p.id + 1, lat: bm.lat, lon: bm.lon, altKm: bm.altKm }));
                  showToast(`📍 ${i + 1}/${bookmarks.length}: ${bm.name}`);
                }, i * 3000);
              });
            }},
            // Quick share — copy URL to clipboard for X/Bluesky/etc.
            // Permalink commands — useful since the URL hash live-updates.
            { id: "copyPermalink", label: "Copy permalink to current view", group: "Tools", icon: Share2, run: () => {
              const c = cameraStateRef.current;
              if (!c) return;
              const url = new URL(window.location.href);
              url.hash = `#@${c.lat.toFixed(4)},${c.lon.toFixed(4)},${c.altKm.toFixed(1)}km`;
              navigator.clipboard?.writeText(url.toString()).then(
                () => showToast(`📎 Copied permalink`),
                () => showToast(url.toString())
              );
            }},
            { id: "openShortlink", label: "Open this view via tinyurl-style permalink", group: "Tools", icon: Share2, run: () => {
              const c = cameraStateRef.current;
              if (!c) return;
              const url = new URL(window.location.href);
              url.hash = `#@${c.lat.toFixed(4)},${c.lon.toFixed(4)},${c.altKm.toFixed(1)}km`;
              window.open(`https://tinyurl.com/create.php?url=${encodeURIComponent(url.toString())}`, "_blank");
            }},
            // Open this view in lots of mapping services
            { id: "openInBing", label: "Open in Bing Maps", group: "Tools", icon: Share2, run: () => {
              const c = cameraStateRef.current;
              if (!c) return;
              const lvl = Math.max(1, Math.min(20, Math.round(20 - Math.log2(c.altKm + 1))));
              window.open(`https://www.bing.com/maps?cp=${c.lat}~${c.lon}&lvl=${lvl}`, "_blank");
            }},
            { id: "openInAppleMaps", label: "Open in Apple Maps", group: "Tools", icon: Share2, run: () => {
              const c = cameraStateRef.current;
              if (!c) return;
              window.open(`https://maps.apple.com/?ll=${c.lat},${c.lon}&z=${Math.max(1, Math.min(20, Math.round(20 - Math.log2(c.altKm + 1))))}`, "_blank");
            }},
            { id: "openInGoogleEarth", label: "Open in Google Earth (web)", group: "Tools", icon: Share2, run: () => {
              const c = cameraStateRef.current;
              if (!c) return;
              window.open(`https://earth.google.com/web/@${c.lat},${c.lon},${(c.altKm * 1000).toFixed(0)}a,0d`, "_blank");
            }},
            { id: "openInWindy", label: "Open this view in Windy.com (winds + radar)", group: "Tools", icon: Share2, run: () => {
              const c = cameraStateRef.current;
              if (!c) return;
              const z = Math.max(3, Math.min(15, Math.round(20 - Math.log2(c.altKm + 1))));
              window.open(`https://www.windy.com/?${c.lat},${c.lon},${z}`, "_blank");
            }},
            { id: "openInFlightradar", label: "Open this view in Flightradar24", group: "Tools", icon: Plane, run: () => {
              const c = cameraStateRef.current;
              if (!c) return;
              const z = Math.max(2, Math.min(15, Math.round(20 - Math.log2(c.altKm + 1))));
              window.open(`https://www.flightradar24.com/${c.lat.toFixed(2)},${c.lon.toFixed(2)}/${z}`, "_blank");
            }},
            { id: "openInMarineTraffic", label: "Open this view in MarineTraffic (ships)", group: "Tools", icon: Share2, run: () => {
              const c = cameraStateRef.current;
              if (!c) return;
              const z = Math.max(2, Math.min(17, Math.round(20 - Math.log2(c.altKm + 1))));
              window.open(`https://www.marinetraffic.com/en/ais/home/centerx:${c.lon.toFixed(2)}/centery:${c.lat.toFixed(2)}/zoom:${z}`, "_blank");
            }},
            { id: "openInWeatherUnderground", label: "Open Weather Underground at this view", group: "Tools", icon: Cloud, run: () => {
              const c = cameraStateRef.current;
              if (!c) return;
              window.open(`https://www.wunderground.com/weather/${c.lat.toFixed(3)},${c.lon.toFixed(3)}`, "_blank");
            }},
            // Mode quick-jumps
            { id: "modeAtlas", label: "Switch to Atlas mode (orbital shader globe)", group: "View", icon: Globe2, hint: "S", run: switchToAtlas },
            { id: "modeSurface", label: "Switch to Surface mode (Cesium high-detail)", group: "View", icon: Mountain, hint: "S", run: switchToSurface },
            { id: "toggleAutoMode", label: autoModeSwitch ? "Disable auto Atlas/Surface switching by altitude" : "Enable auto Atlas/Surface switching by altitude", group: "View", icon: Mountain, run: () => setAutoModeSwitch((v) => !v) },
            // Pause / play rotation
            { id: "togglePause", label: paused ? "Resume rotation" : "Pause rotation", group: "View", icon: paused ? Play : Pause, run: () => setPaused((v) => !v) },
            // Hide / show UI
            { id: "toggleUiHide", label: hideUi ? "Show UI panels" : "Hide UI panels (presentation mode)", group: "View", icon: Eye, hint: "H", run: () => setHideUi((v) => !v) },
            // Bulk MAJOR_CITIES fly-to commands (top 50 metros, generated from
            // the same MAJOR_CITIES list used for the Cesium label overlay).
            // Lets users type "shanghai" / "lagos" / etc into the palette
            // and jump immediately.
            ...MAJOR_CITIES.map(city => ({
              id: `cityFly-${city.country}-${city.name.replace(/\s+/g, "")}`,
              label: `Fly to ${city.name}, ${city.country}`,
              group: "View" as const,
              icon: Navigation,
              run: () => {
                setFlyTo((p) => ({ id: p.id + 1, lat: city.lat, lon: city.lon, altKm: 8 }));
                showToast(`✈ ${city.name} (${(city.population / 1_000_000).toFixed(1)}M people)`);
              },
            })),
            // Bulk AIRPORTS fly-to commands. Includes the 25 busiest world
            // airports + a couple of regional standouts, all from the
            // existing AIRPORTS list. Type "LAX" / "JFK" / "Dubai" / etc.
            ...AIRPORTS.map(airport => ({
              id: `airportFly-${airport.iata}`,
              label: `✈ Fly to ${airport.iata} · ${airport.name} (${airport.city})`,
              group: "View" as const,
              icon: Plane,
              run: () => {
                setFlyTo((p) => ({ id: p.id + 1, lat: airport.lat, lon: airport.lon, altKm: 5 }));
                showToast(`✈ ${airport.iata} (${airport.icao}) — ${airport.city}, ${airport.country}`);
              },
            })),
            // Bulk LANDMARKS fly-to commands. Pulls from the curated
            // landmark list with their preferred zoom altitudes.
            ...LANDMARKS.map(lm => ({
              id: `landmarkFly-${lm.id}`,
              label: `${lm.emoji} Fly to ${lm.name}`,
              group: "View" as const,
              icon: Mountain,
              run: () => {
                setFlyTo((p) => ({ id: p.id + 1, lat: lm.lat, lon: lm.lon, altKm: lm.zoomKm }));
                showToast(`${lm.emoji} ${lm.name}`);
              },
            })),
            // Bulk COUNTRY_CENTROIDS commands. Type a country name in the
            // palette and fly to its center at an appropriate altitude.
            ...COUNTRY_CENTROIDS.map(cc => ({
              id: `countryFly-${cc.code}`,
              label: `🌍 Fly to ${cc.name} (centroid)`,
              group: "View" as const,
              icon: Globe2,
              run: () => {
                // Tier-1 countries (huge) get a regional view; tier-2 zoom closer.
                const altKm = cc.tier === 1 ? 3000 : 800;
                setFlyTo((p) => ({ id: p.id + 1, lat: cc.lat, lon: cc.lon, altKm }));
                showToast(`🌍 ${cc.name} (${cc.code})`);
              },
            })),
            // Quick-save: turn the URL hash into a bookmark with auto-naming.
            { id: "saveQuickBookmark", label: "Quick-save current view as bookmark (auto-name)", group: "Tools", icon: BookmarkPlus, run: () => {
              const c = cameraStateRef.current;
              if (!c) return;
              const b: Bookmark = {
                id: `bm-${Date.now()}`,
                name: `${formatLat(c.lat)} ${formatLon(c.lon)}`,
                lat: c.lat,
                lon: c.lon,
                altKm: c.altKm,
                savedAt: Date.now(),
              };
              setBookmarks((prev) => [b, ...prev]);
              showToast(`Quick-saved: ${b.name}`);
            }},
            { id: "shareTwitter", label: "Tweet this view", group: "Tools", icon: Share2, run: () => {
              const c = cameraStateRef.current;
              if (!c) return;
              const url = new URL(window.location.href);
              url.hash = `#@${c.lat.toFixed(4)},${c.lon.toFixed(4)},${c.altKm.toFixed(1)}km`;
              const text = `Check out this view at ${formatLat(c.lat)} ${formatLon(c.lon)}: ${url.toString()}`;
              window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`, "_blank");
            }},
            { id: "shareEmail", label: "Email this view as link", group: "Tools", icon: Share2, run: () => {
              const c = cameraStateRef.current;
              if (!c) return;
              const url = new URL(window.location.href);
              url.hash = `#@${c.lat.toFixed(4)},${c.lon.toFixed(4)},${c.altKm.toFixed(1)}km`;
              window.location.href = `mailto:?subject=${encodeURIComponent("Atlas Globe view")}&body=${encodeURIComponent(`${formatLat(c.lat)} ${formatLon(c.lon)}\n\n${url.toString()}`)}`;
            }},
            // Time machine — jump the Surface clock back N hours.
            { id: "timeBack1h", label: "Time machine: jump 1 hour back", group: "Imagery", icon: SunIcon, run: () => {
              const now = new Date();
              const hr = now.getUTCHours() - 1 + (now.getUTCMinutes() / 60);
              updateGlobe({ realTimeSun: false });
              setSurfaceManualHour((hr + 24) % 24);
              showToast(`⏪ Clock: ${(hr + 24) % 24 | 0}h ago`);
            }},
            { id: "timeBack6h", label: "Time machine: jump 6 hours back", group: "Imagery", icon: SunIcon, run: () => {
              const now = new Date();
              const hr = now.getUTCHours() - 6 + (now.getUTCMinutes() / 60);
              updateGlobe({ realTimeSun: false });
              setSurfaceManualHour((hr + 24) % 24);
              showToast(`⏪ Clock: 6h ago`);
            }},
            { id: "timeFwd6h", label: "Time machine: jump 6 hours forward", group: "Imagery", icon: SunIcon, run: () => {
              const now = new Date();
              const hr = now.getUTCHours() + 6 + (now.getUTCMinutes() / 60);
              updateGlobe({ realTimeSun: false });
              setSurfaceManualHour(hr % 24);
              showToast(`⏩ Clock: 6h ahead`);
            }},
            { id: "timeFwd1h", label: "Time machine: jump 1 hour forward", group: "Imagery", icon: SunIcon, run: () => {
              const now = new Date();
              const hr = now.getUTCHours() + 1 + (now.getUTCMinutes() / 60);
              updateGlobe({ realTimeSun: false });
              setSurfaceManualHour(hr % 24);
              showToast(`⏩ Clock: 1h ahead`);
            }},
            // Time-zone calculator at the camera-center longitude.
            // Layer preset bundles — flip a curated set on/off in one click.
            { id: "presetNatural", label: "Layer preset: Natural disasters (EONET + quakes + volcanoes + storms)", group: "Layers", icon: Layers, run: () => {
              setLayers((l) => ({ ...l, eonet: true, earthquakes: true, volcanoes: true, storms: true, aircraft: false, weather: false }));
              showToast("🌍 Natural disasters preset");
            }},
            { id: "presetTransport", label: "Layer preset: Transport (aircraft + launches + ISS)", group: "Layers", icon: Layers, run: () => {
              setLayers((l) => ({ ...l, aircraft: true, launches: true, iss: true, tiangong: true, hubble: true, eonet: false, earthquakes: false }));
              showToast("✈ Transport preset");
            }},
            { id: "presetWeather", label: "Layer preset: Weather (radar + storms + aurora)", group: "Layers", icon: Layers, run: () => {
              setLayers((l) => ({ ...l, weather: true, storms: true, aurora: true, eonet: false, earthquakes: false, aircraft: false }));
              showToast("⛈ Weather preset");
            }},
            { id: "presetReference", label: "Layer preset: Reference (borders + graticule + cardinals + pins)", group: "Layers", icon: Layers, run: () => {
              setLayers((l) => ({ ...l, borders: true, graticule: true, cardinals: true, pins: true, aircraft: false, eonet: false }));
              showToast("📐 Reference preset");
            }},
            { id: "presetMinimal", label: "Layer preset: Minimal (just the globe)", group: "Layers", icon: Layers, run: () => {
              setLayers((l) => ({ ...l, aircraft: false, weather: false, eonet: false, earthquakes: false, volcanoes: false, launches: false, iss: false, tiangong: false, hubble: false, aurora: false, storms: false, borders: false, graticule: false, timezones: false, neoWatch: false }));
              showToast("🌑 Minimal preset");
            }},
            { id: "presetEverything", label: "Layer preset: Everything (turn ALL data layers on)", group: "Layers", icon: Layers, run: () => {
              setLayers((l) => ({ ...l, aircraft: true, weather: true, eonet: true, earthquakes: true, volcanoes: true, launches: true, iss: true, tiangong: true, hubble: true, aurora: true, storms: true, borders: true, neoWatch: true }));
              showToast("🌐 EVERYTHING preset (might be slow)");
            }},
            // Animated sunrise sequence — chases the sunrise terminator
            // around the globe in 24 1-hour steps, taking ~12 seconds.
            // Pairs with the terminator overlay for a hypnotic visual.
            { id: "sunriseSequence", label: "Animate full 24h sun cycle (auto-step every 0.5s)", group: "Imagery", icon: SunIcon, run: () => {
              updateGlobe({ realTimeSun: false });
              showToast("🎬 24h sun cycle animation starting");
              for (let h = 0; h <= 24; h++) {
                setTimeout(() => {
                  setSurfaceManualHour(h % 24);
                }, h * 500);
              }
            }},
            { id: "sunriseSequenceFast", label: "Animate 24h sun cycle (FAST — 4s)", group: "Imagery", icon: SunIcon, run: () => {
              updateGlobe({ realTimeSun: false });
              showToast("🎬 24h sun cycle FAST");
              for (let h = 0; h <= 24; h++) {
                setTimeout(() => {
                  setSurfaceManualHour(h % 24);
                }, h * 170);
              }
            }},
            // Solar zenith — sun directly overhead at this point exactly
            // when (today). Useful for "what time will the sun be over my
            // head" questions.
            // Fun / discovery commands
            { id: "flyToHome", label: "Fly to Null Island (0°N, 0°E)", group: "View", icon: Navigation, run: () => {
              setFlyTo((p) => ({ id: p.id + 1, lat: 0, lon: 0, altKm: 1500 }));
              showToast("🏝 Welcome to Null Island");
            }},
            { id: "flyToBermudaTriangle", label: "Fly to the Bermuda Triangle", group: "View", icon: Navigation, run: () => {
              setFlyTo((p) => ({ id: p.id + 1, lat: 25.0, lon: -71.0, altKm: 800 }));
              showToast("🔺 Bermuda Triangle — keep an eye on your aircraft");
            }},
            { id: "flyToMtEverest", label: "Fly to Mount Everest summit", group: "View", icon: Mountain, run: () => {
              setFlyTo((p) => ({ id: p.id + 1, lat: 27.9881, lon: 86.9250, altKm: 12 }));
              showToast("🏔 Mt Everest — 8,848 m");
            }},
            { id: "flyToMarianaTrench", label: "Fly to the Mariana Trench", group: "View", icon: Mountain, run: () => {
              setFlyTo((p) => ({ id: p.id + 1, lat: 11.35, lon: 142.2, altKm: 50 }));
              showToast("🌊 Mariana Trench — 10,994 m below sea level");
            }},
            { id: "flyToArea51", label: "Fly to Area 51", group: "View", icon: Navigation, run: () => {
              setFlyTo((p) => ({ id: p.id + 1, lat: 37.235, lon: -115.8111, altKm: 25 }));
              showToast("🛸 Area 51 — Groom Lake, NV");
            }},
            { id: "flyToFour", label: "Fly to the Four Corners (US state intersection)", group: "View", icon: Navigation, run: () => {
              setFlyTo((p) => ({ id: p.id + 1, lat: 36.999, lon: -109.045, altKm: 1 }));
              showToast("🇺🇸 Four Corners — AZ, CO, NM, UT meet");
            }},
            { id: "flyToEquatorAfrica", label: "Fly to Lake Victoria (equator + Africa)", group: "View", icon: Navigation, run: () => {
              setFlyTo((p) => ({ id: p.id + 1, lat: -1, lon: 33, altKm: 800 }));
              showToast("🌍 Lake Victoria — straddles the equator");
            }},
            { id: "flyToChernobyl", label: "Fly to Chernobyl exclusion zone", group: "View", icon: Mountain, run: () => {
              setFlyTo((p) => ({ id: p.id + 1, lat: 51.389, lon: 30.099, altKm: 30 }));
              showToast("☢ Chernobyl — exclusion zone");
            }},
            { id: "flyToHiroshimaPeace", label: "Fly to Hiroshima Peace Park", group: "View", icon: Mountain, run: () => {
              setFlyTo((p) => ({ id: p.id + 1, lat: 34.3955, lon: 132.4536, altKm: 1.5 }));
              showToast("🕊 Hiroshima Peace Memorial");
            }},
            // More iconic places
            { id: "flyToGiza", label: "Fly to Pyramids of Giza", group: "View", icon: Mountain, run: () => { setFlyTo((p) => ({ id: p.id + 1, lat: 29.9792, lon: 31.1342, altKm: 4 })); showToast("🏛 Pyramids of Giza"); } },
            { id: "flyToMachuPicchu", label: "Fly to Machu Picchu", group: "View", icon: Mountain, run: () => { setFlyTo((p) => ({ id: p.id + 1, lat: -13.1631, lon: -72.5450, altKm: 4 })); showToast("🏛 Machu Picchu"); } },
            { id: "flyToTajMahal", label: "Fly to Taj Mahal", group: "View", icon: Mountain, run: () => { setFlyTo((p) => ({ id: p.id + 1, lat: 27.1751, lon: 78.0421, altKm: 1.5 })); showToast("🕌 Taj Mahal"); } },
            { id: "flyToColosseum", label: "Fly to Roman Colosseum", group: "View", icon: Mountain, run: () => { setFlyTo((p) => ({ id: p.id + 1, lat: 41.8902, lon: 12.4922, altKm: 1.5 })); showToast("🏛 Colosseum"); } },
            { id: "flyToGrandCanyon", label: "Fly to the Grand Canyon", group: "View", icon: Mountain, run: () => { setFlyTo((p) => ({ id: p.id + 1, lat: 36.0544, lon: -112.1401, altKm: 12 })); showToast("🏞 Grand Canyon"); } },
            { id: "flyToVesuvius", label: "Fly to Mt Vesuvius (Pompeii)", group: "View", icon: Mountain, run: () => { setFlyTo((p) => ({ id: p.id + 1, lat: 40.8217, lon: 14.4264, altKm: 8 })); showToast("🌋 Mt Vesuvius — Pompeii below"); } },
            { id: "flyToYellowstone", label: "Fly to Yellowstone Caldera", group: "View", icon: Mountain, run: () => { setFlyTo((p) => ({ id: p.id + 1, lat: 44.4280, lon: -110.5885, altKm: 80 })); showToast("🌋 Yellowstone supervolcano"); } },
            { id: "flyToFukushima", label: "Fly to Fukushima Daiichi", group: "View", icon: Mountain, run: () => { setFlyTo((p) => ({ id: p.id + 1, lat: 37.4225, lon: 141.0331, altKm: 12 })); showToast("☢ Fukushima Daiichi"); } },
            { id: "flyToBaikal", label: "Fly to Lake Baikal (deepest lake)", group: "View", icon: Mountain, run: () => { setFlyTo((p) => ({ id: p.id + 1, lat: 53.5587, lon: 108.1650, altKm: 200 })); showToast("🌊 Lake Baikal — 1,642 m deep"); } },
            { id: "flyToSahara", label: "Fly over the Sahara", group: "View", icon: Mountain, run: () => { setFlyTo((p) => ({ id: p.id + 1, lat: 23.4162, lon: 25.6628, altKm: 1500 })); showToast("🏜 Sahara — 9.2 million km²"); } },
            { id: "flyToAmazon", label: "Fly over the Amazon Rainforest", group: "View", icon: Mountain, run: () => { setFlyTo((p) => ({ id: p.id + 1, lat: -3.4653, lon: -62.2159, altKm: 600 })); showToast("🌳 Amazon Rainforest"); } },
            { id: "flyToHimalayas", label: "Fly along the Himalayas", group: "View", icon: Mountain, run: () => { setFlyTo((p) => ({ id: p.id + 1, lat: 28, lon: 86, altKm: 200 })); showToast("🏔 Himalayas"); } },
            { id: "flyToAlaska", label: "Fly to Alaska / Denali", group: "View", icon: Mountain, run: () => { setFlyTo((p) => ({ id: p.id + 1, lat: 63.0692, lon: -151.0070, altKm: 80 })); showToast("🏔 Denali — N America's tallest"); } },
            // World capitals — most-visited cities
            { id: "capWashingtonDC", label: "Fly to Washington DC", group: "View", icon: Navigation, run: () => { setFlyTo((p) => ({ id: p.id + 1, lat: 38.8951, lon: -77.0364, altKm: 8 })); showToast("🇺🇸 Washington DC"); } },
            { id: "capLondon", label: "Fly to London", group: "View", icon: Navigation, run: () => { setFlyTo((p) => ({ id: p.id + 1, lat: 51.5074, lon: -0.1278, altKm: 8 })); showToast("🇬🇧 London"); } },
            { id: "capParis", label: "Fly to Paris", group: "View", icon: Navigation, run: () => { setFlyTo((p) => ({ id: p.id + 1, lat: 48.8566, lon: 2.3522, altKm: 8 })); showToast("🇫🇷 Paris"); } },
            { id: "capBerlin", label: "Fly to Berlin", group: "View", icon: Navigation, run: () => { setFlyTo((p) => ({ id: p.id + 1, lat: 52.5200, lon: 13.4050, altKm: 8 })); showToast("🇩🇪 Berlin"); } },
            { id: "capRome", label: "Fly to Rome", group: "View", icon: Navigation, run: () => { setFlyTo((p) => ({ id: p.id + 1, lat: 41.9028, lon: 12.4964, altKm: 8 })); showToast("🇮🇹 Rome"); } },
            { id: "capMadrid", label: "Fly to Madrid", group: "View", icon: Navigation, run: () => { setFlyTo((p) => ({ id: p.id + 1, lat: 40.4168, lon: -3.7038, altKm: 8 })); showToast("🇪🇸 Madrid"); } },
            { id: "capMoscow", label: "Fly to Moscow", group: "View", icon: Navigation, run: () => { setFlyTo((p) => ({ id: p.id + 1, lat: 55.7558, lon: 37.6173, altKm: 8 })); showToast("🇷🇺 Moscow"); } },
            { id: "capBeijing", label: "Fly to Beijing", group: "View", icon: Navigation, run: () => { setFlyTo((p) => ({ id: p.id + 1, lat: 39.9042, lon: 116.4074, altKm: 8 })); showToast("🇨🇳 Beijing"); } },
            { id: "capTokyo", label: "Fly to Tokyo", group: "View", icon: Navigation, run: () => { setFlyTo((p) => ({ id: p.id + 1, lat: 35.6762, lon: 139.6503, altKm: 8 })); showToast("🇯🇵 Tokyo"); } },
            { id: "capSeoul", label: "Fly to Seoul", group: "View", icon: Navigation, run: () => { setFlyTo((p) => ({ id: p.id + 1, lat: 37.5665, lon: 126.9780, altKm: 8 })); showToast("🇰🇷 Seoul"); } },
            { id: "capDelhi", label: "Fly to Delhi", group: "View", icon: Navigation, run: () => { setFlyTo((p) => ({ id: p.id + 1, lat: 28.7041, lon: 77.1025, altKm: 8 })); showToast("🇮🇳 Delhi"); } },
            { id: "capJakarta", label: "Fly to Jakarta", group: "View", icon: Navigation, run: () => { setFlyTo((p) => ({ id: p.id + 1, lat: -6.2088, lon: 106.8456, altKm: 8 })); showToast("🇮🇩 Jakarta"); } },
            { id: "capCanberra", label: "Fly to Canberra", group: "View", icon: Navigation, run: () => { setFlyTo((p) => ({ id: p.id + 1, lat: -35.2809, lon: 149.1300, altKm: 8 })); showToast("🇦🇺 Canberra"); } },
            { id: "capBrasilia", label: "Fly to Brasília", group: "View", icon: Navigation, run: () => { setFlyTo((p) => ({ id: p.id + 1, lat: -15.8267, lon: -47.9218, altKm: 8 })); showToast("🇧🇷 Brasília"); } },
            { id: "capOttawa", label: "Fly to Ottawa", group: "View", icon: Navigation, run: () => { setFlyTo((p) => ({ id: p.id + 1, lat: 45.4215, lon: -75.6972, altKm: 8 })); showToast("🇨🇦 Ottawa"); } },
            { id: "capMexicoCity", label: "Fly to Mexico City", group: "View", icon: Navigation, run: () => { setFlyTo((p) => ({ id: p.id + 1, lat: 19.4326, lon: -99.1332, altKm: 8 })); showToast("🇲🇽 Mexico City"); } },
            { id: "capCairo", label: "Fly to Cairo", group: "View", icon: Navigation, run: () => { setFlyTo((p) => ({ id: p.id + 1, lat: 30.0444, lon: 31.2357, altKm: 8 })); showToast("🇪🇬 Cairo"); } },
            { id: "capLagos", label: "Fly to Lagos", group: "View", icon: Navigation, run: () => { setFlyTo((p) => ({ id: p.id + 1, lat: 6.5244, lon: 3.3792, altKm: 8 })); showToast("🇳🇬 Lagos"); } },
            { id: "capCapeTown", label: "Fly to Cape Town", group: "View", icon: Navigation, run: () => { setFlyTo((p) => ({ id: p.id + 1, lat: -33.9249, lon: 18.4241, altKm: 8 })); showToast("🇿🇦 Cape Town"); } },
            // Cardinal-direction quick-pans — move camera N/S/E/W by half
            // the current screen (10° at globe view, ~0.5° at 1km alt).
            { id: "panNorth", label: "Pan north (move camera up)", group: "View", icon: Navigation, run: () => {
              const c = cameraStateRef.current;
              if (c) setFlyTo((p) => ({ id: p.id + 1, lat: Math.min(89, c.lat + Math.max(0.5, c.altKm * 0.01)), lon: c.lon, altKm: c.altKm }));
            }},
            { id: "panSouth", label: "Pan south (move camera down)", group: "View", icon: Navigation, run: () => {
              const c = cameraStateRef.current;
              if (c) setFlyTo((p) => ({ id: p.id + 1, lat: Math.max(-89, c.lat - Math.max(0.5, c.altKm * 0.01)), lon: c.lon, altKm: c.altKm }));
            }},
            { id: "panEast", label: "Pan east", group: "View", icon: Navigation, run: () => {
              const c = cameraStateRef.current;
              if (c) {
                let newLon = c.lon + Math.max(0.5, c.altKm * 0.01);
                if (newLon > 180) newLon -= 360;
                setFlyTo((p) => ({ id: p.id + 1, lat: c.lat, lon: newLon, altKm: c.altKm }));
              }
            }},
            { id: "panWest", label: "Pan west", group: "View", icon: Navigation, run: () => {
              const c = cameraStateRef.current;
              if (c) {
                let newLon = c.lon - Math.max(0.5, c.altKm * 0.01);
                if (newLon < -180) newLon += 360;
                setFlyTo((p) => ({ id: p.id + 1, lat: c.lat, lon: newLon, altKm: c.altKm }));
              }
            }},
            // Fun trivia commands
            { id: "trivPlanetSize", label: "Trivia: Earth size & dimensions", group: "Tools", icon: Sparkles, run: () => {
              showToast("🌍 Earth: 12,742 km diameter · 40,075 km equator · 510 million km² surface · 6 sextillion kg");
            }},
            { id: "trivOcean", label: "Trivia: Ocean facts", group: "Tools", icon: Sparkles, run: () => {
              showToast("🌊 Ocean: 71% of surface · 1.3 billion km³ water · avg depth 3,688 m · deepest 10,994 m (Challenger Deep)");
            }},
            { id: "trivAtmosphere", label: "Trivia: Atmosphere layers", group: "Tools", icon: Sparkles, run: () => {
              showToast("☁ Atmosphere: troposphere (0-12km) → stratosphere (12-50km) → mesosphere (50-85km) → thermosphere (ISS!) → exosphere");
            }},
            { id: "trivMoon", label: "Trivia: Moon facts", group: "Tools", icon: Sparkles, run: () => {
              showToast("🌙 Moon: 384,400 km away (avg) · 3,474 km diameter · drifting 3.8 cm/year farther · synodic month 29.5 days");
            }},
            { id: "trivSun", label: "Trivia: Sun facts", group: "Tools", icon: Sparkles, run: () => {
              showToast("☀ Sun: 149.6 million km away · 1.39 million km diameter · 5,778 K surface · 4.6 billion years old · ~5 billion years left");
            }},
            { id: "trivISS", label: "Trivia: ISS facts", group: "Tools", icon: Sparkles, run: () => {
              showToast("🛰 ISS: 400 km altitude · 27,600 km/h · orbits Earth every 92 min · 16 orbits/day · livable since 2000");
            }},
            { id: "trivAviation", label: "Trivia: Cruise altitude facts", group: "Tools", icon: Plane, run: () => {
              showToast("✈ Commercial cruise: 30,000-40,000 ft (9-12 km) · less drag · clear of weather · biz jets up to 51,000 ft");
            }},
            // Hot/cold extremes
            { id: "flyToVostok", label: "Fly to Vostok Station (coldest place on Earth)", group: "View", icon: Mountain, run: () => {
              setFlyTo((p) => ({ id: p.id + 1, lat: -78.464, lon: 106.840, altKm: 100 }));
              showToast("🥶 Vostok Station — recorded -89.2°C (-128.6°F)");
            }},
            { id: "flyToDallol", label: "Fly to Dallol (hottest mean temp on Earth)", group: "View", icon: Mountain, run: () => {
              setFlyTo((p) => ({ id: p.id + 1, lat: 14.241, lon: 40.300, altKm: 30 }));
              showToast("🥵 Dallol, Ethiopia — annual mean 34.4°C, can hit 50°C+");
            }},
            { id: "flyToOymyakon", label: "Fly to Oymyakon (coldest inhabited place)", group: "View", icon: Mountain, run: () => {
              setFlyTo((p) => ({ id: p.id + 1, lat: 63.4625, lon: 142.7872, altKm: 30 }));
              showToast("❄ Oymyakon, Russia — coldest inhabited (-67.7°C lowest)");
            }},
            { id: "flyToFurnaceCreek", label: "Fly to Death Valley", group: "View", icon: Mountain, run: () => {
              setFlyTo((p) => ({ id: p.id + 1, lat: 36.4622, lon: -116.8669, altKm: 30 }));
              showToast("🏜 Death Valley — 56.7°C (134°F) all-time high (1913)");
            }},
            // Faster bookmark / pin tours.
            { id: "tourPinsFast", label: pins.length > 1 ? `Tour all pins (FAST — 1s each)` : "Tour pins (need 2+)", group: "View", icon: Film, run: () => {
              if (pins.length < 2) { showToast("Need 2+ pins"); return; }
              showToast(`🎬 Fast tour: ${pins.length} pins (~${pins.length}s)`);
              pins.forEach((pin, i) => {
                setTimeout(() => {
                  setFlyTo((p) => ({ id: p.id + 1, lat: pin.lat, lon: pin.lon, altKm: 30 }));
                  showToast(`📍 ${i + 1}/${pins.length}: ${pin.label}`);
                }, i * 1000);
              });
            }},
            { id: "tourBookmarksFast", label: bookmarks.length > 1 ? `Tour all bookmarks (FAST — 1s each)` : "Tour bookmarks (need 2+)", group: "View", icon: Film, run: () => {
              if (bookmarks.length < 2) { showToast("Need 2+ bookmarks"); return; }
              showToast(`🎬 Fast tour: ${bookmarks.length} bookmarks`);
              bookmarks.forEach((bm, i) => {
                setTimeout(() => {
                  setFlyTo((p) => ({ id: p.id + 1, lat: bm.lat, lon: bm.lon, altKm: bm.altKm }));
                  showToast(`📍 ${i + 1}/${bookmarks.length}: ${bm.name}`);
                }, i * 1000);
              });
            }},
            // Aircraft "ride along" — pick a random aircraft and switch to chase camera.
            { id: "rideRandomFlight", label: "Ride along: pick random flight + chase camera", group: "View", icon: Plane, run: () => {
              if (!aircraftSnapshot || aircraftSnapshot.aircraft.length === 0) {
                showToast("Aircraft layer not loaded"); return;
              }
              // Prefer high-altitude commercial aircraft
              const highflyers = aircraftSnapshot.aircraft.filter(a =>
                a.altitudeM > 9000 && a.velocityMs > 150 && a.callsign && /^[A-Z]{3}\d/.test(a.callsign)
              );
              const pool = highflyers.length > 0 ? highflyers : aircraftSnapshot.aircraft.filter(a => a.altitudeM > 0);
              if (pool.length === 0) { showToast("No suitable aircraft"); return; }
              const a = pool[Math.floor(Math.random() * pool.length)];
              setSelectedAircraftId(a.icao24);
              setAircraftCameraMode("chase");
              showToast(`✈ Riding along with ${a.callsign || a.icao24} @ ${Math.round(a.altitudeM / 0.3048)} ft`);
            }},
            { id: "rideAircraftCockpit", label: "Switch to cockpit camera (current aircraft)", group: "View", icon: Plane, run: () => {
              if (!selectedAircraftId) { showToast("Select an aircraft first"); return; }
              setAircraftCameraMode("cockpit");
              showToast("🛩 Cockpit camera engaged");
            }},
            { id: "rideAircraftWing", label: "Switch to wing camera (current aircraft)", group: "View", icon: Plane, run: () => {
              if (!selectedAircraftId) { showToast("Select an aircraft first"); return; }
              setAircraftCameraMode("wing");
              showToast("🛩 Wing camera engaged");
            }},
            { id: "exitAircraftCamera", label: "Exit aircraft camera (free orbit)", group: "View", icon: Plane, run: () => {
              setAircraftCameraMode("off");
              showToast("Free camera");
            }},
            // Cycle through visible aircraft — pick the next aircraft in
            // the filtered list. Useful for quickly browsing planes.
            { id: "nextAircraft", label: "Cycle to next visible aircraft", group: "View", icon: Plane, run: () => {
              if (filteredAircraft.length === 0) { showToast("No aircraft visible"); return; }
              const idx = filteredAircraft.findIndex(a => a.icao24 === selectedAircraftId);
              const next = filteredAircraft[(idx + 1) % filteredAircraft.length];
              setSelectedAircraftId(next.icao24);
              showToast(`✈ ${next.callsign || next.icao24} (${idx + 2}/${filteredAircraft.length})`);
            }},
            { id: "prevAircraft", label: "Cycle to previous visible aircraft", group: "View", icon: Plane, run: () => {
              if (filteredAircraft.length === 0) { showToast("No aircraft visible"); return; }
              const idx = filteredAircraft.findIndex(a => a.icao24 === selectedAircraftId);
              const prev = filteredAircraft[(idx - 1 + filteredAircraft.length) % filteredAircraft.length];
              setSelectedAircraftId(prev.icao24);
              showToast(`✈ ${prev.callsign || prev.icao24} (${idx}/${filteredAircraft.length})`);
            }},
            { id: "deselectAircraft", label: "Deselect current aircraft", group: "View", icon: Plane, run: () => {
              setSelectedAircraftId(null);
              setAircraftCameraMode("off");
              showToast("Deselected");
            }},
            // Find slowest / highest / lowest aircraft
            { id: "highestAircraft", label: "Find highest-flying aircraft", group: "Tools", icon: Plane, run: () => {
              if (!aircraftSnapshot || aircraftSnapshot.aircraft.length === 0) { showToast("Aircraft layer not loaded"); return; }
              const a = aircraftSnapshot.aircraft.reduce((max, c) => c.altitudeM > max.altitudeM ? c : max);
              setSelectedAircraftId(a.icao24);
              setFlyTo((p) => ({ id: p.id + 1, lat: a.lat, lon: a.lon, altKm: 100 }));
              showToast(`🚀 ${a.callsign || a.icao24} @ ${Math.round(a.altitudeM / 0.3048).toLocaleString()} ft`);
            }},
            { id: "fastestAircraft", label: "Find fastest aircraft", group: "Tools", icon: Plane, run: () => {
              if (!aircraftSnapshot || aircraftSnapshot.aircraft.length === 0) { showToast("Aircraft layer not loaded"); return; }
              const a = aircraftSnapshot.aircraft.reduce((max, c) => c.velocityMs > max.velocityMs ? c : max);
              setSelectedAircraftId(a.icao24);
              setFlyTo((p) => ({ id: p.id + 1, lat: a.lat, lon: a.lon, altKm: 100 }));
              showToast(`💨 ${a.callsign || a.icao24} @ ${Math.round(a.velocityMs * 1.94384)} kt`);
            }},
            { id: "slowestAircraft", label: "Find slowest moving aircraft (helicopters/floaters)", group: "Tools", icon: Plane, run: () => {
              if (!aircraftSnapshot || aircraftSnapshot.aircraft.length === 0) { showToast("Aircraft layer not loaded"); return; }
              const moving = aircraftSnapshot.aircraft.filter(a => !a.onGround && a.velocityMs > 0);
              if (moving.length === 0) { showToast("No moving aircraft"); return; }
              const a = moving.reduce((min, c) => c.velocityMs < min.velocityMs ? c : min);
              setSelectedAircraftId(a.icao24);
              setFlyTo((p) => ({ id: p.id + 1, lat: a.lat, lon: a.lon, altKm: 50 }));
              showToast(`🐢 ${a.callsign || a.icao24} @ ${Math.round(a.velocityMs * 1.94384)} kt`);
            }},
            // Bookmark management
            { id: "saveBookmark", label: "Save this view as a bookmark…", group: "Tools", icon: BookmarkPlus, hint: "B", run: saveCurrentBookmark },
            { id: "deleteAllBookmarks", label: bookmarks.length > 0 ? `Delete all ${bookmarks.length} bookmarks` : "Delete all bookmarks (none)", group: "Tools", icon: Bookmark, run: () => {
              if (bookmarks.length === 0) { showToast("Nothing to delete"); return; }
              if (!window.confirm(`Delete all ${bookmarks.length} bookmarks?`)) return;
              setBookmarks([]);
              showToast("All bookmarks deleted");
            }},
            { id: "exportBookmarksKml", label: bookmarks.length > 0 ? `Export ${bookmarks.length} bookmarks as KML` : "Export bookmarks (none)", group: "Tools", icon: Bookmark, run: () => {
              if (bookmarks.length === 0) { showToast("No bookmarks"); return; }
              const placemarks = bookmarks.map((b) => `
    <Placemark>
      <name>${escapeXml(b.name)}</name>
      <Point><coordinates>${b.lon},${b.lat},0</coordinates></Point>
    </Placemark>`).join("");
              const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>Atlas bookmarks (${bookmarks.length})</name>${placemarks}
  </Document>
</kml>`;
              const blob = new Blob([kml], { type: "application/vnd.google-earth.kml+xml" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = `atlas-bookmarks-${new Date().toISOString().slice(0, 10)}.kml`;
              document.body.appendChild(a);
              a.click();
              a.remove();
              setTimeout(() => URL.revokeObjectURL(url), 500);
              showToast(`Exported ${bookmarks.length} bookmarks as KML`);
            }},
            // FPS overlay toggle
            { id: "fpsToggle", label: showFps ? "Hide FPS overlay" : "Show FPS overlay", group: "Tools", icon: Sparkles, run: () => setShowFps((v) => !v) },
            // Reset all settings — useful when something gets weird.
            { id: "resetSettings", label: "Reset all settings + clear localStorage (preserves bookmarks)", group: "Tools", icon: RotateCcw, run: () => {
              if (!window.confirm("Reset all settings? Layers, theme, sun position, etc. will return to defaults. Bookmarks and pins are preserved.")) return;
              setLayers(defaultLayers);
              setGlobe(defaultGlobe);
              setUiTheme("dark");
              setAircraftCategory("all");
              setAircraftAirlinePrefix("");
              setAircraftMinAltFt(0);
              setAircraftMaxAltFt(50000);
              showToast("⚙ Settings reset to defaults");
            }},
            { id: "resetEverything", label: "🔥 NUCLEAR RESET (delete everything: settings + pins + bookmarks)", group: "Tools", icon: RotateCcw, run: () => {
              if (!window.confirm("DELETE EVERYTHING? This wipes all bookmarks, pins, settings, and storage.")) return;
              localStorage.removeItem(STORAGE_KEY);
              localStorage.removeItem("atlas-search-history");
              window.location.reload();
            }},
            // Camera lock-on commands
            { id: "lockCameraNorth", label: "Lock camera heading: due north", group: "View", icon: Compass, run: () => {
              const c = cameraStateRef.current;
              if (c) {
                setSurfaceTilt({ id: Date.now(), pitchDeg: 90 });
                setFlyTo((p) => ({ id: p.id + 1, lat: c.lat, lon: c.lon, altKm: c.altKm }));
              }
            }},
            // Open documentation / help
            { id: "openShortcuts", label: "Show keyboard shortcuts cheat sheet", group: "Tools", icon: Wand2, hint: "?", run: () => setShowShortcuts(true) },
            // Page reload (sometimes useful)
            { id: "hardReload", label: "Hard reload page (Cmd+Shift+R equivalent)", group: "Tools", icon: RotateCcw, run: () => window.location.reload() },
            // Per-layer info commands — what does each layer do, where's
            // the data from, how often does it refresh.
            { id: "infoAircraft", label: "About: Aircraft layer", group: "Tools", icon: Plane, run: () => { showToast("✈ Aircraft: real-time ADS-B from airplanes.live (fallback adsb.fi). ~7000 planes globally. Refreshes every 12s desktop / 25s mobile."); } },
            { id: "infoWeather", label: "About: Weather radar layer", group: "Tools", icon: Cloud, run: () => { showToast("⛈ Weather radar: live precipitation from RainViewer. Auto-fades below 250km altitude. Refreshes every 5min."); } },
            { id: "infoEonet", label: "About: EONET layer", group: "Tools", icon: Sparkles, run: () => { showToast("🌍 EONET (NASA): wildfires, floods, severe storms, volcanoes, dust, snow, drought. Refreshes every 10min."); } },
            { id: "infoQuakes", label: "About: Earthquakes layer", group: "Tools", icon: Sparkles, run: () => { showToast("💥 Earthquakes (USGS): all magnitudes from the past 24 hours. Pulse-animated when <60min old."); } },
            { id: "infoVolcanoes", label: "About: Volcanoes layer", group: "Tools", icon: Mountain, run: () => { showToast("🌋 Volcanoes: 24 famous active volcanoes, alert color from USGS feed. Updated every 10 min."); } },
            { id: "infoLaunches", label: "About: Launches layer", group: "Tools", icon: Sparkles, run: () => { showToast("🚀 Launches: upcoming rockets from Launch Library 2 (~30 day forward window). Pad coords."); } },
            { id: "infoISS", label: "About: ISS / Tiangong / Hubble", group: "Tools", icon: Sparkles, run: () => { showToast("🛰 LEO: live positions from wheretheiss.at. ISS / Tiangong / Hubble all polled every 5-15s. Ground tracks from past 90min."); } },
            { id: "infoStorms", label: "About: Storms layer", group: "Tools", icon: Cloud, run: () => { showToast("🌀 Storms: NOAA NHC active tropical cyclones. Saffir-Simpson tinted. Empty out of season."); } },
            { id: "infoAurora", label: "About: Aurora layer", group: "Tools", icon: SunIcon, run: () => { showToast("🌌 Aurora: NOAA SWPC OVATION 30-min forecast + Kp index drives the oval radius (Surface mode)."); } },
            { id: "infoTerminator", label: "About: Terminator layer (Surface mode)", group: "Tools", icon: SunIcon, run: () => { showToast("🌗 Terminator: live great-circle marking the day/night boundary. 60s redraw under requestRenderMode."); } },
            { id: "infoCountries", label: "About: Country labels (Surface)", group: "Tools", icon: Compass, run: () => { showToast("🌍 Country labels: 50 curated centroids with flags. Tier-1 visible to 12,000km, tier-2 to 4,000km. Click to fly."); } },
            { id: "infoBuildings", label: "About: 3D Buildings (Surface)", group: "Tools", icon: Mountain, run: () => { showToast("🏢 3D Buildings: Cesium OSM Buildings tileset. Off by default — heavy. Tinted soft-white when enabled."); } },
            // More dramatic cinematic flights
            { id: "cinematicAroundWorld", label: "Cinematic: tour 7 wonders of the world (~30s)", group: "View", icon: Film, run: () => {
              const wonders: Array<{ name: string; emoji: string; lat: number; lon: number; alt: number }> = [
                { name: "Pyramid of Giza", emoji: "🏛", lat: 29.9792, lon: 31.1342, alt: 4 },
                { name: "Great Wall of China", emoji: "🧱", lat: 40.4319, lon: 116.5704, alt: 8 },
                { name: "Petra, Jordan", emoji: "🏛", lat: 30.3285, lon: 35.4444, alt: 4 },
                { name: "Christ the Redeemer", emoji: "⛪", lat: -22.9519, lon: -43.2105, alt: 2 },
                { name: "Machu Picchu", emoji: "🏛", lat: -13.1631, lon: -72.5450, alt: 4 },
                { name: "Chichen Itza", emoji: "🏛", lat: 20.6843, lon: -88.5678, alt: 4 },
                { name: "Taj Mahal", emoji: "🕌", lat: 27.1751, lon: 78.0421, alt: 1.5 },
                { name: "Roman Colosseum", emoji: "🏛", lat: 41.8902, lon: 12.4922, alt: 1.5 },
              ];
              showToast(`🎬 Tour: 7 Wonders (~${wonders.length * 4}s)`);
              wonders.forEach((w, i) => {
                setTimeout(() => {
                  setFlyTo((p) => ({ id: p.id + 1, lat: w.lat, lon: w.lon, altKm: w.alt }));
                  showToast(`${w.emoji} ${i + 1}/${wonders.length}: ${w.name}`);
                }, i * 4000);
              });
            }},
            { id: "cinematicSeasons", label: "Cinematic: equinox-to-solstice sun arc (4s)", group: "View", icon: Film, run: () => {
              showToast("🌞 Watch the sun move across the seasons");
              const hours = [0, 3, 6, 9, 12, 15, 18, 21];
              hours.forEach((h, i) => {
                setTimeout(() => { updateGlobe({ realTimeSun: false }); setSurfaceManualHour(h); }, i * 500);
              });
            }},
            // Performance / debug
            { id: "perfMode", label: "Toggle performance mode (lower quality, higher FPS)", group: "Tools", icon: Sparkles, run: () => {
              // Cesium quality on/off — Surface mode listens via prop
              setSurfaceFog((v) => !v);
              showToast(`⚡ Performance mode toggled`);
            }},
            // Date / time facts
            { id: "currentDate", label: "Show current date/time (UTC + ISO)", group: "Tools", icon: Compass, run: () => {
              const now = new Date();
              showToast(`🕐 ${now.toUTCString()} · ISO: ${now.toISOString()}`);
            }},
            { id: "dayOfYear", label: "Show day of year + week info", group: "Tools", icon: Compass, run: () => {
              const now = new Date();
              const start = new Date(Date.UTC(now.getUTCFullYear(), 0, 0));
              const doy = Math.floor((now.getTime() - start.getTime()) / 86400000);
              const week = Math.ceil(doy / 7);
              showToast(`📅 Day ${doy} of ${now.getUTCFullYear()} · Week ${week} · ${365 - doy} days remaining`);
            }},
            // Distance comparisons
            { id: "distanceToFamous", label: "Distance from this view to all major cities", group: "Tools", icon: Compass, run: () => {
              const c = cameraStateRef.current;
              if (!c) return;
              const top = MAJOR_CITIES.map(city => ({
                city,
                km: haversineKm(c.lat, c.lon, city.lat, city.lon),
              })).sort((a, b) => a.km - b.km).slice(0, 5);
              const list = top.map(({ city, km }) => `${city.name}: ${Math.round(km)}km`).join(" · ");
              showToast(`🗺 Closest 5 cities: ${list}`);
            }},
            { id: "distanceISS", label: "Distance from this view to the ISS right now", group: "Tools", icon: Plane, run: () => {
              const c = cameraStateRef.current;
              if (!c || !issPosition) { showToast("ISS layer not loaded"); return; }
              const groundKm = haversineKm(c.lat, c.lon, issPosition.lat, issPosition.lon);
              const altKm = 408;
              const slantKm = Math.sqrt(groundKm * groundKm + altKm * altKm);
              const visible = groundKm < 2280;     // ISS visible up to ~22° above horizon = ~2280km ground
              showToast(`🛰 ISS: ${Math.round(slantKm)} km away (${Math.round(groundKm)} km ground) — ${visible ? "above your horizon!" : "below horizon"}`);
            }},
            // Aircraft within radius
            { id: "aircraftNearby", label: "Count aircraft within 500km of this view", group: "Tools", icon: Plane, run: () => {
              const c = cameraStateRef.current;
              if (!c || !aircraftSnapshot) { showToast("Aircraft layer not loaded"); return; }
              const nearby = aircraftSnapshot.aircraft.filter(a => haversineKm(c.lat, c.lon, a.lat, a.lon) < 500);
              if (nearby.length === 0) { showToast("0 aircraft within 500km"); return; }
              const avgAlt = Math.round(nearby.reduce((s, a) => s + a.altitudeM / 0.3048, 0) / nearby.length);
              showToast(`✈ ${nearby.length} aircraft within 500km · avg ${avgAlt.toLocaleString()} ft`);
            }},
            // Population estimate
            // National park fly-tos
            { id: "parkBanff", label: "Fly to Banff National Park", group: "View", icon: Mountain, run: () => { setFlyTo((p) => ({ id: p.id + 1, lat: 51.4968, lon: -115.9281, altKm: 80 })); showToast("🏞 Banff NP — Canadian Rockies"); } },
            { id: "parkYosemite", label: "Fly to Yosemite National Park", group: "View", icon: Mountain, run: () => { setFlyTo((p) => ({ id: p.id + 1, lat: 37.8651, lon: -119.5383, altKm: 80 })); showToast("🏞 Yosemite NP"); } },
            { id: "parkGalapagos", label: "Fly to Galápagos Islands", group: "View", icon: Mountain, run: () => { setFlyTo((p) => ({ id: p.id + 1, lat: -0.7893, lon: -91.0469, altKm: 200 })); showToast("🐢 Galápagos Islands"); } },
            { id: "parkSerengeti", label: "Fly to Serengeti National Park", group: "View", icon: Mountain, run: () => { setFlyTo((p) => ({ id: p.id + 1, lat: -2.3333, lon: 34.8333, altKm: 200 })); showToast("🦁 Serengeti — Tanzania"); } },
            { id: "parkPlitvice", label: "Fly to Plitvice Lakes (Croatia)", group: "View", icon: Mountain, run: () => { setFlyTo((p) => ({ id: p.id + 1, lat: 44.8654, lon: 15.5821, altKm: 30 })); showToast("💦 Plitvice Lakes NP"); } },
            { id: "parkTorres", label: "Fly to Torres del Paine (Patagonia)", group: "View", icon: Mountain, run: () => { setFlyTo((p) => ({ id: p.id + 1, lat: -50.9423, lon: -73.0744, altKm: 80 })); showToast("🏔 Torres del Paine"); } },
            { id: "parkSagarmatha", label: "Fly to Sagarmatha NP (Everest area)", group: "View", icon: Mountain, run: () => { setFlyTo((p) => ({ id: p.id + 1, lat: 27.9881, lon: 86.9250, altKm: 30 })); showToast("🏔 Sagarmatha NP — Mt Everest"); } },
            { id: "parkKakadu", label: "Fly to Kakadu NP (Australia)", group: "View", icon: Mountain, run: () => { setFlyTo((p) => ({ id: p.id + 1, lat: -12.6, lon: 132.6, altKm: 200 })); showToast("🦘 Kakadu NP — Northern Territory"); } },
            // Geographic poles + extremes
            { id: "flyMagneticNorth", label: "Fly to North Magnetic Pole (Ellesmere Island vicinity)", group: "View", icon: Compass, run: () => { setFlyTo((p) => ({ id: p.id + 1, lat: 86, lon: 137, altKm: 1500 })); showToast("🧲 N Magnetic Pole — drifts ~50 km/year"); } },
            { id: "flySouthMagneticPole", label: "Fly to South Magnetic Pole", group: "View", icon: Compass, run: () => { setFlyTo((p) => ({ id: p.id + 1, lat: -64, lon: 137, altKm: 1500 })); showToast("🧲 S Magnetic Pole — Antarctic Ocean off Adélie Land"); } },
            { id: "flyPoleInaccessibility", label: "Fly to oceanic Point Nemo (most isolated point)", group: "View", icon: Navigation, run: () => { setFlyTo((p) => ({ id: p.id + 1, lat: -48.8767, lon: -123.3933, altKm: 5000 })); showToast("🌊 Point Nemo — 2,688 km from any land"); } },
            // Maritime / strait curiosities
            { id: "flyStrait", label: "Fly to Strait of Gibraltar", group: "View", icon: Navigation, run: () => { setFlyTo((p) => ({ id: p.id + 1, lat: 35.97, lon: -5.47, altKm: 50 })); showToast("⚓ Strait of Gibraltar — 14 km wide"); } },
            { id: "flyBosphorus", label: "Fly to Bosphorus Strait (Istanbul)", group: "View", icon: Navigation, run: () => { setFlyTo((p) => ({ id: p.id + 1, lat: 41.06, lon: 29.04, altKm: 50 })); showToast("⚓ Bosphorus — splits Europe & Asia"); } },
            { id: "flySuez", label: "Fly to Suez Canal", group: "View", icon: Navigation, run: () => { setFlyTo((p) => ({ id: p.id + 1, lat: 30.5852, lon: 32.2841, altKm: 100 })); showToast("⚓ Suez Canal — 193 km long"); } },
            { id: "flyPanama", label: "Fly to Panama Canal", group: "View", icon: Navigation, run: () => { setFlyTo((p) => ({ id: p.id + 1, lat: 9.0820, lon: -79.6818, altKm: 50 })); showToast("⚓ Panama Canal — 82 km long"); } },
            { id: "flyEnglishChannel", label: "Fly over the English Channel", group: "View", icon: Navigation, run: () => { setFlyTo((p) => ({ id: p.id + 1, lat: 50.5, lon: 1.0, altKm: 100 })); showToast("⚓ English Channel — Dover-Calais 33 km"); } },
            { id: "flyMagellan", label: "Fly to Strait of Magellan", group: "View", icon: Navigation, run: () => { setFlyTo((p) => ({ id: p.id + 1, lat: -53.5, lon: -71.0, altKm: 200 })); showToast("⚓ Strait of Magellan — Patagonia"); } },
            // Famous bridges + structures
            { id: "flyGoldenGate", label: "Fly to Golden Gate Bridge", group: "View", icon: Mountain, run: () => { setFlyTo((p) => ({ id: p.id + 1, lat: 37.8199, lon: -122.4783, altKm: 2 })); showToast("🌉 Golden Gate Bridge"); } },
            { id: "flyBrooklynBridge", label: "Fly to Brooklyn Bridge", group: "View", icon: Mountain, run: () => { setFlyTo((p) => ({ id: p.id + 1, lat: 40.7061, lon: -73.9969, altKm: 1.5 })); showToast("🌉 Brooklyn Bridge"); } },
            { id: "flyTowerBridge", label: "Fly to Tower Bridge (London)", group: "View", icon: Mountain, run: () => { setFlyTo((p) => ({ id: p.id + 1, lat: 51.5055, lon: -0.0754, altKm: 1.5 })); showToast("🌉 Tower Bridge"); } },
            { id: "flyEiffel", label: "Fly to Eiffel Tower", group: "View", icon: Mountain, run: () => { setFlyTo((p) => ({ id: p.id + 1, lat: 48.8584, lon: 2.2945, altKm: 1.5 })); showToast("🗼 Eiffel Tower"); } },
            { id: "flyBurjKhalifa", label: "Fly to Burj Khalifa (tallest building)", group: "View", icon: Mountain, run: () => { setFlyTo((p) => ({ id: p.id + 1, lat: 25.1972, lon: 55.2744, altKm: 2 })); showToast("🏙 Burj Khalifa — 828 m"); } },
            { id: "flyStatueLiberty", label: "Fly to Statue of Liberty", group: "View", icon: Mountain, run: () => { setFlyTo((p) => ({ id: p.id + 1, lat: 40.6892, lon: -74.0445, altKm: 1.5 })); showToast("🗽 Statue of Liberty"); } },
            { id: "flyChristRedeemer", label: "Fly to Christ the Redeemer", group: "View", icon: Mountain, run: () => { setFlyTo((p) => ({ id: p.id + 1, lat: -22.9519, lon: -43.2105, altKm: 2 })); showToast("⛪ Christ the Redeemer (Rio)"); } },
            { id: "flySydneyOpera", label: "Fly to Sydney Opera House", group: "View", icon: Mountain, run: () => { setFlyTo((p) => ({ id: p.id + 1, lat: -33.8568, lon: 151.2153, altKm: 1.5 })); showToast("🎭 Sydney Opera House"); } },
            { id: "flyStonehenge", label: "Fly to Stonehenge", group: "View", icon: Mountain, run: () => { setFlyTo((p) => ({ id: p.id + 1, lat: 51.1789, lon: -1.8262, altKm: 2 })); showToast("🪨 Stonehenge"); } },
            { id: "flyMoai", label: "Fly to Easter Island Moai", group: "View", icon: Mountain, run: () => { setFlyTo((p) => ({ id: p.id + 1, lat: -27.1212, lon: -109.3676, altKm: 6 })); showToast("🗿 Easter Island Moai"); } },
            // Famous waters
            { id: "flyVictoriaFalls", label: "Fly to Victoria Falls", group: "View", icon: Mountain, run: () => { setFlyTo((p) => ({ id: p.id + 1, lat: -17.9243, lon: 25.8572, altKm: 6 })); showToast("💦 Victoria Falls"); } },
            { id: "flyIguazu", label: "Fly to Iguazu Falls", group: "View", icon: Mountain, run: () => { setFlyTo((p) => ({ id: p.id + 1, lat: -25.6953, lon: -54.4367, altKm: 6 })); showToast("💦 Iguazu Falls"); } },
            { id: "flyNiagara", label: "Fly to Niagara Falls", group: "View", icon: Mountain, run: () => { setFlyTo((p) => ({ id: p.id + 1, lat: 43.0962, lon: -79.0377, altKm: 6 })); showToast("💦 Niagara Falls"); } },
            { id: "flyAngelFalls", label: "Fly to Angel Falls (tallest)", group: "View", icon: Mountain, run: () => { setFlyTo((p) => ({ id: p.id + 1, lat: 5.9694, lon: -62.5358, altKm: 12 })); showToast("💦 Angel Falls — 979 m"); } },
            { id: "flyDeadSea", label: "Fly to Dead Sea (lowest land point)", group: "View", icon: Mountain, run: () => { setFlyTo((p) => ({ id: p.id + 1, lat: 31.5497, lon: 35.4732, altKm: 30 })); showToast("💧 Dead Sea — 430 m below sea level"); } },
            { id: "flyCaspian", label: "Fly over the Caspian Sea (largest lake)", group: "View", icon: Mountain, run: () => { setFlyTo((p) => ({ id: p.id + 1, lat: 41, lon: 51, altKm: 800 })); showToast("🌊 Caspian Sea — largest enclosed body"); } },
            { id: "flyMtFuji", label: "Fly to Mount Fuji", group: "View", icon: Mountain, run: () => { setFlyTo((p) => ({ id: p.id + 1, lat: 35.3606, lon: 138.7274, altKm: 14 })); showToast("🗻 Mt Fuji — 3,776 m"); } },
            { id: "flyMtKilimanjaro", label: "Fly to Mt Kilimanjaro", group: "View", icon: Mountain, run: () => { setFlyTo((p) => ({ id: p.id + 1, lat: -3.0674, lon: 37.3556, altKm: 18 })); showToast("🏔 Kilimanjaro — Africa's tallest"); } },
            { id: "flyMatterhorn", label: "Fly to the Matterhorn", group: "View", icon: Mountain, run: () => { setFlyTo((p) => ({ id: p.id + 1, lat: 45.9763, lon: 7.6586, altKm: 15 })); showToast("🏔 Matterhorn — 4,478 m"); } },
            { id: "flyUluru", label: "Fly to Uluru (Ayers Rock)", group: "View", icon: Mountain, run: () => { setFlyTo((p) => ({ id: p.id + 1, lat: -25.3444, lon: 131.0369, altKm: 8 })); showToast("🪨 Uluru — sandstone monolith"); } },
            { id: "flyGreatBarrier", label: "Fly over the Great Barrier Reef", group: "View", icon: Mountain, run: () => { setFlyTo((p) => ({ id: p.id + 1, lat: -18.2871, lon: 147.6992, altKm: 200 })); showToast("🐠 Great Barrier Reef — 2,300 km"); } },
            { id: "flyAlps", label: "Fly along the Swiss Alps", group: "View", icon: Mountain, run: () => { setFlyTo((p) => ({ id: p.id + 1, lat: 46.5, lon: 8.0, altKm: 100 })); showToast("🏔 Swiss Alps"); } },
            { id: "flyAndes", label: "Fly along the Andes", group: "View", icon: Mountain, run: () => { setFlyTo((p) => ({ id: p.id + 1, lat: -20, lon: -70, altKm: 800 })); showToast("🏔 Andes — 7,000 km long"); } },
            { id: "flyRockies", label: "Fly along the Rockies", group: "View", icon: Mountain, run: () => { setFlyTo((p) => ({ id: p.id + 1, lat: 45, lon: -111, altKm: 800 })); showToast("🏔 Rocky Mountains"); } },
            { id: "populationNearby", label: "Population estimate within 100km of this view", group: "Tools", icon: Compass, run: () => {
              const c = cameraStateRef.current;
              if (!c) return;
              const nearby = MAJOR_CITIES.filter(city => haversineKm(c.lat, c.lon, city.lat, city.lon) < 100);
              if (nearby.length === 0) {
                showToast("🏘 No major metropolitan areas within 100km of this view");
                return;
              }
              const total = nearby.reduce((s, c) => s + c.population, 0);
              const cityList = nearby.map(c => `${c.name} (${(c.population / 1_000_000).toFixed(1)}M)`).join(", ");
              showToast(`🏙 ${(total / 1_000_000).toFixed(1)}M people within 100km · ${cityList}`);
            }},
            { id: "easterEggHelp", label: "Easter eggs hint (Konami code lives here…)", group: "Tools", icon: Sparkles, run: () => {
              showToast("🎮 Try ↑↑↓↓←→←→ B A (anywhere on the page)");
            }},
            // Quick-copy commands — paste-friendly outputs.
            { id: "copyCoords", label: "Copy current coordinates as 'lat, lon'", group: "Tools", icon: Bookmark, run: () => {
              const c = cameraStateRef.current;
              if (!c) return;
              const text = `${c.lat.toFixed(6)}, ${c.lon.toFixed(6)}`;
              navigator.clipboard?.writeText(text).then(
                () => showToast(`Copied: ${text}`),
                () => showToast(text)
              );
            }},
            { id: "copyCoordsDms", label: "Copy current coordinates as DMS (51°30'N 0°7'W)", group: "Tools", icon: Bookmark, run: () => {
              const c = cameraStateRef.current;
              if (!c) return;
              const fmt = (deg: number, ne: string, sw: string) => {
                const sign = deg >= 0 ? ne : sw;
                const abs = Math.abs(deg);
                const d = Math.floor(abs);
                const m = Math.floor((abs - d) * 60);
                const s = Math.round(((abs - d) * 60 - m) * 60);
                return `${d}°${m}'${s}"${sign}`;
              };
              const text = `${fmt(c.lat, "N", "S")} ${fmt(c.lon, "E", "W")}`;
              navigator.clipboard?.writeText(text).then(
                () => showToast(`Copied: ${text}`),
                () => showToast(text)
              );
            }},
            { id: "copyOpenInGoogle", label: "Open this view in Google Maps (new tab)", group: "Tools", icon: Share2, run: () => {
              const c = cameraStateRef.current;
              if (!c) return;
              const zoom = Math.max(1, Math.min(19, Math.round(20 - Math.log2(c.altKm + 1))));
              window.open(`https://www.google.com/maps/@${c.lat},${c.lon},${zoom}z`, "_blank");
            }},
            { id: "copyOpenInOpenStreetMap", label: "Open this view in OpenStreetMap (new tab)", group: "Tools", icon: Share2, run: () => {
              const c = cameraStateRef.current;
              if (!c) return;
              const zoom = Math.max(1, Math.min(19, Math.round(20 - Math.log2(c.altKm + 1))));
              window.open(`https://www.openstreetmap.org/#map=${zoom}/${c.lat}/${c.lon}`, "_blank");
            }},
            { id: "copyOpenInWiki", label: "Search Wikipedia for places near this view", group: "Tools", icon: Share2, run: async () => {
              const c = cameraStateRef.current;
              if (!c) return;
              try {
                const r = await fetch(`https://en.wikipedia.org/w/api.php?action=query&list=geosearch&gsradius=10000&gscoord=${c.lat}|${c.lon}&format=json&origin=*`);
                const d = await r.json();
                const first = d?.query?.geosearch?.[0];
                if (first) {
                  window.open(`https://en.wikipedia.org/wiki/${encodeURIComponent(first.title)}`, "_blank");
                  showToast(`Opening: ${first.title}`);
                } else {
                  showToast("No nearby Wikipedia article");
                }
              } catch { showToast("Wikipedia query failed"); }
            }},
            // Pin recolor — cycle the most recently selected pin through
            // the palette so users can re-color without an inspector edit.
            ...(selectedPin ? [{
              id: "pinRecolor" as const,
              label: "Recolor selected pin (cycle)",
              group: "Tools" as const,
              icon: BookmarkPlus,
              run: () => {
                const idx = PIN_COLORS.findIndex((c) => c === pins.find((p) => p.id === selectedPin)?.color);
                const next = PIN_COLORS[(idx + 1) % PIN_COLORS.length];
                updatePin(selectedPin, { color: next });
                showToast(`🎨 Pin → ${next}`);
              },
            }, {
              id: "pinFlyTo" as const,
              label: "Fly to selected pin",
              group: "View" as const,
              icon: Navigation,
              run: () => {
                const p = pins.find((x) => x.id === selectedPin);
                if (p) flyToPin(p);
              },
            }, {
              id: "pinDelete" as const,
              label: "Delete selected pin",
              group: "Tools" as const,
              icon: BookmarkPlus,
              run: () => deletePin(selectedPin),
            }, {
              id: "pinRename" as const,
              label: "Rename selected pin (prompt)",
              group: "Tools" as const,
              icon: BookmarkPlus,
              run: () => {
                const p = pins.find((x) => x.id === selectedPin);
                if (!p) return;
                const newName = window.prompt("New pin name:", p.label);
                if (newName && newName.trim()) updatePin(selectedPin, { label: newName.trim() });
              },
            }] : []),
            { id: "solarZenithHere", label: "Show solar zenith time (sun directly overhead) for this view", group: "Tools", icon: SunIcon, run: () => {
              const c = cameraStateRef.current;
              if (!c) return;
              const now = new Date();
              const start = Date.UTC(now.getUTCFullYear(), 0, 0);
              const doy = Math.floor((now.getTime() - start) / 86400000);
              const declDeg = 23.45 * Math.sin(2 * Math.PI / 365 * (doy - 81));
              if (Math.abs(c.lat - declDeg) > 23.45) {
                showToast(`🌞 Sun never reaches zenith at ${formatLat(c.lat)} (lat too far from declination ${declDeg.toFixed(2)}°)`);
                return;
              }
              // Solar zenith happens at solar noon at this longitude:
              const zenithUtc = 12 - c.lon / 15;
              const hh = String(Math.floor(((zenithUtc % 24) + 24) % 24)).padStart(2, "0");
              const mm = String(Math.floor((((zenithUtc % 1) + 1) % 1) * 60)).padStart(2, "0");
              showToast(`☀ Sun directly overhead at ${formatLat(c.lat)} ${formatLon(c.lon)}: ${hh}:${mm} UTC today (zenith)`);
            }},
            { id: "timezoneAtView", label: "Show approximate timezone offset at this view", group: "Tools", icon: Compass, run: () => {
              const c = cameraStateRef.current;
              if (!c) return;
              // Mean solar time offset = lon / 15 hours
              const offset = c.lon / 15;
              const sign = offset >= 0 ? "+" : "-";
              const abs = Math.abs(offset);
              const hh = Math.floor(abs);
              const mm = Math.round((abs - hh) * 60);
              showToast(`🕐 Mean solar offset at ${formatLat(c.lat)} ${formatLon(c.lon)}: UTC${sign}${hh}h${mm > 0 ? `${mm}m` : ""}`);
            }},
            { id: "cinematicSpin360", label: "Cinematic: 360° orbit around this point", group: "View", icon: Film, run: () => {
              const c = cameraStateRef.current;
              if (!c) return;
              const steps = 36;
              for (let i = 0; i <= steps; i++) {
                const t = i / steps;
                // Move the camera lon by 360° while keeping lat/alt fixed.
                const lon = ((c.lon + t * 360 + 180) % 360) - 180;
                setTimeout(() => {
                  setFlyTo((p) => ({ id: p.id + 1, lat: c.lat, lon, altKm: c.altKm }));
                }, i * 250);
              }
              showToast("🎬 360° orbit started (~9s)");
            }},
            { id: "importBookmarks", label: "Import bookmarks from JSON file", group: "Tools", icon: Bookmark, run: () => {
              const input = document.createElement("input");
              input.type = "file";
              input.accept = "application/json,.json";
              input.onchange = async () => {
                const file = input.files?.[0];
                if (!file) return;
                try {
                  const text = await file.text();
                  const parsed = JSON.parse(text);
                  if (!Array.isArray(parsed)) { showToast("Not a bookmark array"); return; }
                  const cleaned: Bookmark[] = parsed
                    .filter((b: any) => typeof b?.lat === "number" && typeof b?.lon === "number" && typeof b?.name === "string")
                    .map((b: any) => ({
                      id: typeof b.id === "string" ? b.id : `bm-imp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                      name: b.name,
                      lat: b.lat,
                      lon: b.lon,
                      altKm: typeof b.altKm === "number" ? b.altKm : 1500,
                      savedAt: typeof b.savedAt === "number" ? b.savedAt : Date.now(),
                    }));
                  if (cleaned.length === 0) { showToast("No valid bookmarks in file"); return; }
                  setBookmarks((prev) => [...cleaned, ...prev]);
                  showToast(`Imported ${cleaned.length} bookmarks`);
                } catch { showToast("Invalid JSON file"); }
              };
              input.click();
            }},
            { id: "moonriseUtc", label: "Show approximate moonrise time at this view (UTC)", group: "Tools", icon: SunIcon, run: () => {
              const c = cameraStateRef.current;
              if (!c) return;
              // The moon is visible roughly when it's above the horizon. Its
              // path lags the sun by ~50 min/day. Reference: the moon is at
              // the same RA as the sun at new moon. Crude approximation:
              const refMs = Date.UTC(2000, 0, 6, 18, 14, 0);
              const synodicDays = 29.530588853;
              const ageDays = ((Date.now() - refMs) / 86400000) % synodicDays;
              const moonLagHours = (ageDays / synodicDays) * 24.83;     // hours after sun
              const moonriseHrs = (24 + 6 + moonLagHours - c.lon / 15) % 24;
              const hh = String(Math.floor(moonriseHrs)).padStart(2, "0");
              const mm = String(Math.floor((moonriseHrs % 1) * 60)).padStart(2, "0");
              showToast(`🌙 Approximate moonrise at ${formatLat(c.lat)} ${formatLon(c.lon)}: ${hh}:${mm} UTC (lags sun by ${moonLagHours.toFixed(1)}h today)`);
            }},
            { id: "distanceToLandmark", label: "Show distance from this view to nearest famous landmark", group: "Tools", icon: Compass, run: () => {
              const c = cameraStateRef.current;
              if (!c) return;
              let nearest: { name: string; lat: number; lon: number } | null = null;
              let nearestKm = Infinity;
              for (const b of bookmarks) {
                const d = haversineKm(c.lat, c.lon, b.lat, b.lon);
                if (d < nearestKm) { nearest = { name: b.name, lat: b.lat, lon: b.lon }; nearestKm = d; }
              }
              if (!nearest) { showToast("No bookmarks loaded"); return; }
              const bearing = bearingDeg(c.lat, c.lon, nearest.lat, nearest.lon);
              const compass = ["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"][Math.round(bearing / 22.5) % 16];
              showToast(`Nearest: ${nearest.name} — ${nearestKm.toLocaleString(undefined, { maximumFractionDigits: 0 })} km ${compass}`);
            }},
            // Geolocation — fly camera to user's actual location. Browser
            // prompts for permission. Coarse accuracy is fine since we're
            // viewing at ~30km altitude anyway.
            { id: "flyToMyLocation", label: "Fly to my location (uses geolocation)", group: "View", icon: Crosshair, run: () => {
              if (!navigator.geolocation) { showToast("Geolocation not supported"); return; }
              showToast("Asking browser for your location…");
              navigator.geolocation.getCurrentPosition(
                (pos) => {
                  setFlyTo((p) => ({ id: p.id + 1, lat: pos.coords.latitude, lon: pos.coords.longitude, altKm: 30 }));
                  showToast(`📍 Flying to ${pos.coords.latitude.toFixed(2)}, ${pos.coords.longitude.toFixed(2)} (±${Math.round(pos.coords.accuracy)}m)`);
                },
                (err) => showToast(`Location denied: ${err.message}`),
                { enableHighAccuracy: false, timeout: 8000, maximumAge: 5 * 60_000 }
              );
            }},
            // Pull way back to see Earth as a small disk — "Voyager view".
            { id: "viewMars", label: "Mars-view (Earth as a small disk)", group: "View", icon: Navigation, run: () => setFlyTo((p) => ({ id: p.id + 1, lat: 0, lon: 0, altKm: 100_000 })) },
            // Landmark of the day — deterministic by date so the same
            // suggestion appears for everyone on a given UTC date.
            { id: "landmarkOfDay", label: (() => {
              const d = new Date();
              const idx = (d.getUTCFullYear() * 365 + d.getUTCMonth() * 31 + d.getUTCDate()) % LANDMARKS.length;
              const lm = LANDMARKS[idx];
              return `${lm.emoji} Today's pick: fly to ${lm.name}`;
            })(), group: "View" as const, icon: Navigation, run: () => {
              const d = new Date();
              const idx = (d.getUTCFullYear() * 365 + d.getUTCMonth() * 31 + d.getUTCDate()) % LANDMARKS.length;
              const lm = LANDMARKS[idx];
              setFlyTo((p) => ({ id: p.id + 1, lat: lm.lat, lon: lm.lon, altKm: lm.zoomKm }));
              showToast(`${lm.emoji} ${lm.name}`);
            }},
            // One Cmd+K entry per famous landmark — shows the emoji and
            // name in the palette, flies the camera to its zoom altitude.
            ...LANDMARKS.map((lm) => ({
              id: `landmark-${lm.id}` as const,
              label: `${lm.emoji} Fly to ${lm.name}`,
              group: "View" as const,
              icon: Navigation,
              run: () => setFlyTo((p) => ({ id: p.id + 1, lat: lm.lat, lon: lm.lon, altKm: lm.zoomKm })),
            })),
            // One Cmd+K entry per major airport. Search by IATA code or
            // by the airport name in the palette.
            ...AIRPORTS.map((ap) => ({
              id: `airport-${ap.iata}` as const,
              label: `✈ Fly to ${ap.iata} · ${ap.name} (${ap.city})`,
              group: "View" as const,
              icon: Plane,
              run: () => setFlyTo((p) => ({ id: p.id + 1, lat: ap.lat, lon: ap.lon, altKm: 3 })),
            })),
            // Pull camera up to ISS altitude (~408km) at the camera-center
            // lat/lon. Useful for seeing what the ISS sees right now.
            { id: "viewISSAlt", label: "View at ISS altitude (408km)", group: "View", icon: Navigation, run: () => {
              const c = cameraStateRef.current;
              if (!c) return;
              setFlyTo((p) => ({ id: p.id + 1, lat: c.lat, lon: c.lon, altKm: 408 }));
            }},
            // Drone-view: low + oblique. Combines a fly-to with a tilt set.
            { id: "saveBookmarkNamed", label: "Save this view as a bookmark...", group: "Tools", icon: BookmarkPlus, run: () => saveCurrentBookmark() },
            // Toggle ALL data layers off — helpful for clean screenshots.
            { id: "hideAllLayers", label: "Hide all data layers (clean view)", group: "Layers", icon: Eye, run: () => {
              setLayers((prev) => {
                const next: any = { ...prev };
                for (const k of Object.keys(next)) next[k] = false;
                // Always keep the Earth visible (no layer is for the globe itself).
                return next;
              });
              showToast("All layers hidden");
            }},
            { id: "showAllLayers", label: "Show all data layers", group: "Layers", icon: Eye, run: () => {
              setLayers((prev) => {
                const next: any = { ...prev };
                for (const k of Object.keys(next)) next[k] = true;
                return next;
              });
              showToast("All layers enabled");
            }},
            { id: "resetLayers", label: "Reset layers to defaults", group: "Layers", icon: RotateCcw, run: () => { setLayers(defaultLayers); showToast("Layers reset to defaults"); } },
            { id: "toggleHideUi", label: hideUi ? "Show UI" : "Hide UI (immersive)", group: "View", icon: Eye, run: () => setHideUi((v) => !v) },
            { id: "viewDrone", label: "Drone view (low + oblique)", group: "View", icon: Navigation, run: () => {
              const c = cameraStateRef.current;
              if (!c) return;
              setFlyTo((p) => ({ id: p.id + 1, lat: c.lat, lon: c.lon, altKm: 0.8 }));
              // Apply a 30° pitch shortly after the fly arrives.
              window.setTimeout(() => setSurfaceTilt((cur) => ({ id: (cur?.id ?? 0) + 1, pitchDeg: 30 })), 1800);
            }},
            // Local civil time at the camera center, derived from longitude
            // alone (mean solar time, not zone time). Useful for "what time
            // is it where I'm looking right now" without picking a place.
            // Open the current view in Google Maps in a new tab. Useful
            // when you spot something on the imagery and want street view
            // or business listings.
            // Nominatim search — uses the address bar in lieu of a
            // dedicated search UI. The user can type "Search: <query>"
            // and we'll geocode the rest with OSM Nominatim.
            // Airport fly-to by IATA code. Quick way to get to a specific
            // hub without scrolling the long airport command list.
            // Aircraft near a specified airport — pick by IATA, find the
            // 5 nearest planes from the live ADS-B feed. Useful for
            // "what's coming into JFK right now".
            { id: "trafficNearAirport", label: "Show traffic near airport (by IATA)", group: "Tools", icon: Plane, run: () => {
              const q = window.prompt("Airport IATA for traffic check:");
              if (!q) return;
              const code = q.trim().toUpperCase();
              const ap = AIRPORTS.find((a) => a.iata === code);
              if (!ap) { showToast(`Unknown IATA: ${code}`); return; }
              if (!aircraftSnapshot || aircraftSnapshot.aircraft.length === 0) {
                showToast("Aircraft layer not loaded — turn it on first");
                return;
              }
              const ranked = aircraftSnapshot.aircraft
                .map((a) => ({ a, d: haversineKm(ap.lat, ap.lon, a.lat, a.lon) }))
                .sort((x, y) => x.d - y.d)
                .slice(0, 5);
              const list = ranked.map(({ a, d }) => `${(a.callsign || a.icao24.toUpperCase()).trim()}@${Math.round(a.altitudeM/0.3048).toLocaleString()}ft (${d.toFixed(0)}km)`).join(" · ");
              showToast(`✈ Near ${code}: ${list}`);
            }},
            { id: "iataFlyTo", label: "Fly to airport by IATA code (e.g. JFK, LHR)", group: "Tools", icon: Plane, run: () => {
              const q = window.prompt("Airport IATA code (3 letters):");
              if (!q) return;
              const code = q.trim().toUpperCase();
              const ap = AIRPORTS.find((a) => a.iata === code);
              if (!ap) { showToast(`Unknown IATA: ${code}`); return; }
              setFlyTo((p) => ({ id: p.id + 1, lat: ap.lat, lon: ap.lon, altKm: 3 }));
              showToast(`✈ ${ap.iata} · ${ap.name}, ${ap.city}`);
            }},
            { id: "geocodeSearch", label: "Search for a place by name (Nominatim)", group: "Tools", icon: Search, run: async () => {
              const q = window.prompt("Search for a place (city, landmark, address):");
              if (!q || !q.trim()) return;
              try {
                const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q.trim())}`, { headers: { Accept: "application/json" } });
                const arr = await r.json();
                const hit = Array.isArray(arr) && arr.length > 0 ? arr[0] : null;
                if (!hit) { showToast(`No result for "${q}"`); return; }
                const lat = parseFloat(hit.lat);
                const lon = parseFloat(hit.lon);
                setFlyTo((p) => ({ id: p.id + 1, lat, lon, altKm: 8 }));
                showToast(`✈ ${hit.display_name.length > 60 ? hit.display_name.slice(0, 57) + "..." : hit.display_name}`);
              } catch { showToast("Search failed"); }
            }},
            // Wikipedia summary at camera-center location. Uses the REST
            // API geosearch endpoint for nearest article, then fetches
            // the page summary.
            { id: "wikiHere", label: "Wikipedia summary for this place", group: "Tools", icon: Search, run: async () => {
              const c = cameraStateRef.current;
              if (!c) return;
              try {
                const geoRes = await fetch(`https://en.wikipedia.org/w/api.php?action=query&list=geosearch&gsradius=10000&gscoord=${c.lat}|${c.lon}&gslimit=1&format=json&origin=*`);
                const geo = await geoRes.json();
                const hit = geo?.query?.geosearch?.[0];
                if (!hit) { showToast("No nearby Wikipedia article"); return; }
                const title = hit.title;
                const sumRes = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`);
                const sum = await sumRes.json();
                const extract = sum.extract || sum.description || title;
                const trimmed = extract.length > 240 ? extract.slice(0, 237) + "..." : extract;
                showToast(`📖 ${title} — ${trimmed}`);
              } catch { showToast("Wikipedia: fetch failed"); }
            }},
            { id: "openInGoogleMaps", label: "Open this view in Google Maps", group: "Tools", icon: Navigation, run: () => {
              const c = cameraStateRef.current;
              if (!c) return;
              const zoom = Math.max(2, Math.min(19, Math.round(20 - Math.log2(Math.max(0.5, c.altKm)))));
              window.open(`https://www.google.com/maps/@${c.lat.toFixed(5)},${c.lon.toFixed(5)},${zoom}z`, "_blank", "noopener,noreferrer");
            }},
            // Same idea for OpenStreetMap.
            { id: "openInOSM", label: "Open this view in OpenStreetMap", group: "Tools", icon: Navigation, run: () => {
              const c = cameraStateRef.current;
              if (!c) return;
              const zoom = Math.max(2, Math.min(19, Math.round(20 - Math.log2(Math.max(0.5, c.altKm)))));
              window.open(`https://www.openstreetmap.org/#map=${zoom}/${c.lat.toFixed(5)}/${c.lon.toFixed(5)}`, "_blank", "noopener,noreferrer");
            }},
            { id: "localTime", label: "Show approximate local time at this view", group: "Tools", icon: Compass, run: () => {
              const c = cameraStateRef.current;
              if (!c) return;
              const now = new Date();
              const utcMs = now.getUTCHours() * 3600_000 + now.getUTCMinutes() * 60_000 + now.getUTCSeconds() * 1000;
              const localMs = (utcMs + c.lon / 15 * 3600_000 + 86400_000) % 86400_000;
              const hh = Math.floor(localMs / 3600_000);
              const mm = Math.floor((localMs % 3600_000) / 60_000);
              showToast(`Mean solar time at ${formatLat(c.lat)} ${formatLon(c.lon)}: ${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`);
            }},
            // Pin batch operations
            { id: "pinExportGeoJson", label: pins.length > 0 ? `Export all ${pins.length} pin${pins.length === 1 ? "" : "s"} as GeoJSON` : "Export pins as GeoJSON (no pins yet)", group: "Tools", icon: BookmarkPlus, run: exportPinsAsGeoJSON },
            { id: "pinExportKml", label: pins.length > 0 ? `Export all ${pins.length} pin${pins.length === 1 ? "" : "s"} as KML (Google Earth)` : "Export pins as KML (no pins yet)", group: "Tools", icon: BookmarkPlus, run: exportPinsAsKML },
            { id: "pinDeleteAll", label: pins.length > 0 ? `Delete all ${pins.length} pin${pins.length === 1 ? "" : "s"}` : "Delete all pins (none to delete)", group: "Tools", icon: BookmarkPlus, run: deleteAllPins },
            { id: "pinFromClipboard", label: "Drop pin from clipboard coords", group: "Tools", icon: BookmarkPlus, run: pinFromClipboard },
            { id: "shareView", label: "Copy share-link to current view", group: "Tools", icon: Bookmark, run: () => {
              const c = cameraStateRef.current;
              if (!c) { showToast("Camera position unknown"); return; }
              const url = new URL(window.location.href);
              url.hash = `#@${c.lat.toFixed(4)},${c.lon.toFixed(4)},${c.altKm.toFixed(1)}km`;
              const link = url.toString();
              navigator.clipboard?.writeText(link).then(
                () => showToast(`Copied: ${link.length > 60 ? link.slice(0, 57) + "..." : link}`),
                () => showToast(link)
              );
            }},
            // Fly to the subsolar point — where the sun is directly
            // overhead right now. Earth's noon spot.
            { id: "flyToSubsolar", label: "Fly to subsolar point (where sun is overhead)", group: "View", icon: SunIcon, run: () => {
              const now = new Date();
              const start = Date.UTC(now.getUTCFullYear(), 0, 0);
              const doy = Math.floor((now.getTime() - start) / 86400000);
              const declDeg = 23.45 * Math.sin(2 * Math.PI / 365 * (doy - 81));
              const utcHours = now.getUTCHours() + now.getUTCMinutes() / 60;
              const subsolarLonDeg = -((utcHours - 12) * 15);
              setFlyTo((p) => ({ id: p.id + 1, lat: declDeg, lon: subsolarLonDeg, altKm: 8000 }));
              showToast(`☀ Subsolar point: ${declDeg.toFixed(1)}°, ${subsolarLonDeg.toFixed(1)}°`);
            }},
            // Antisolar — opposite of the subsolar point, where it's
            // local midnight everywhere on the meridian.
            { id: "flyToAntisolar", label: "Fly to antisolar point (midnight zone)", group: "View", icon: Compass, run: () => {
              const now = new Date();
              const start = Date.UTC(now.getUTCFullYear(), 0, 0);
              const doy = Math.floor((now.getTime() - start) / 86400000);
              const declDeg = 23.45 * Math.sin(2 * Math.PI / 365 * (doy - 81));
              const utcHours = now.getUTCHours() + now.getUTCMinutes() / 60;
              const subsolarLonDeg = -((utcHours - 12) * 15);
              const antiLat = -declDeg;
              const antiLon = subsolarLonDeg > 0 ? subsolarLonDeg - 180 : subsolarLonDeg + 180;
              setFlyTo((p) => ({ id: p.id + 1, lat: antiLat, lon: antiLon, altKm: 8000 }));
              showToast(`🌑 Antisolar point: ${antiLat.toFixed(1)}°, ${antiLon.toFixed(1)}°`);
            }},
            { id: "sunInfo", label: "Show local sun info (sunrise/sunset/elevation) for this view", group: "Tools", icon: SunIcon, run: () => {
              const c = cameraStateRef.current;
              if (!c) { showToast("Camera position unknown"); return; }
              const { lat, lon } = c;
              const now = new Date();
              const start = Date.UTC(now.getUTCFullYear(), 0, 0);
              const doy = Math.floor((now.getTime() - start) / 86400000);
              const declRad = 23.45 * Math.PI / 180 * Math.sin(2 * Math.PI / 365 * (doy - 81));
              const latRad = lat * Math.PI / 180;
              // Hour angle in radians for sunrise/sunset:
              //   cos(H) = -tan(lat) tan(decl)
              const cosH = -Math.tan(latRad) * Math.tan(declRad);
              const utcHours = now.getUTCHours() + now.getUTCMinutes() / 60 + now.getUTCSeconds() / 3600;
              const subsolarLon = -((utcHours - 12) * 15);
              // Solar elevation right now:
              //   sin(elev) = sin(lat)sin(decl) + cos(lat)cos(decl)cos(H_now)
              const hNowRad = (lon - subsolarLon) * Math.PI / 180;
              const sinElev = Math.sin(latRad) * Math.sin(declRad) + Math.cos(latRad) * Math.cos(declRad) * Math.cos(hNowRad);
              const elevDeg = Math.asin(Math.max(-1, Math.min(1, sinElev))) * 180 / Math.PI;
              if (cosH > 1) {
                showToast(`At ${formatLat(lat)} ${formatLon(lon)} → polar night (sun stays below horizon today). Current elev ${elevDeg.toFixed(1)}°`);
                return;
              }
              if (cosH < -1) {
                showToast(`At ${formatLat(lat)} ${formatLon(lon)} → polar day (sun never sets today). Current elev ${elevDeg.toFixed(1)}°`);
                return;
              }
              const HhoursHalf = Math.acos(cosH) * 12 / Math.PI;
              const dayLengthH = HhoursHalf * 2;
              // UTC of solar noon at this longitude:
              const solarNoonUtc = 12 - lon / 15;
              const sunriseUtc = solarNoonUtc - HhoursHalf;
              const sunsetUtc = solarNoonUtc + HhoursHalf;
              const fmt = (h: number) => {
                let hh = ((h % 24) + 24) % 24;
                const m = Math.round((hh - Math.floor(hh)) * 60);
                hh = Math.floor(hh);
                return `${String(hh).padStart(2, "0")}:${String(m).padStart(2, "0")} UTC`;
              };
              showToast(`☀ ${formatLat(lat)} ${formatLon(lon)} · sunrise ${fmt(sunriseUtc)} · noon ${fmt(solarNoonUtc)} · sunset ${fmt(sunsetUtc)} · day ${dayLengthH.toFixed(1)}h · elev ${elevDeg.toFixed(1)}°`);
            }},
            // Camera-follow only makes sense when an aircraft is selected
            // and we're in Surface mode. The label changes based on state so
            // users always see whether the toggle would start or stop following.
            ...(mode === "surface" && selectedAircraftId ? [{
              id: "followAircraft" as const,
              label: followSelectedAircraft ? "Stop following selected aircraft" : "Follow selected aircraft (camera lock)",
              group: "Tools" as const,
              icon: Plane,
              run: () => setFollowSelectedAircraft((v) => !v),
            }, {
              id: "cameraChase" as const,
              label: aircraftCameraMode === "chase" ? "Exit chase camera" : "Chase camera (1.5km behind plane)",
              group: "View" as const,
              icon: Plane,
              run: () => setAircraftCameraMode((m) => m === "chase" ? "off" : "chase"),
            }, {
              id: "cameraCockpit" as const,
              label: aircraftCameraMode === "cockpit" ? "Exit cockpit camera" : "Cockpit camera (first-person)",
              group: "View" as const,
              icon: Plane,
              run: () => setAircraftCameraMode((m) => m === "cockpit" ? "off" : "cockpit"),
            }, {
              id: "cameraWing" as const,
              label: aircraftCameraMode === "wing" ? "Exit wing camera" : "Wing camera (off right wingtip)",
              group: "View" as const,
              icon: Plane,
              run: () => setAircraftCameraMode((m) => m === "wing" ? "off" : "wing"),
            }] : []),
            { id: "timeRealTime", label: "Surface clock: real-time UTC", group: "Imagery", icon: SunIcon, run: () => { updateGlobe({ realTimeSun: true }); setSurfaceManualHour(null); } },
            { id: "time06", label: "Surface clock: 06:00 UTC (sunrise over Greenwich)", group: "Imagery", icon: SunIcon, run: () => { updateGlobe({ realTimeSun: false }); setSurfaceManualHour(6); } },
            { id: "time12", label: "Surface clock: 12:00 UTC (noon Greenwich)", group: "Imagery", icon: SunIcon, run: () => { updateGlobe({ realTimeSun: false }); setSurfaceManualHour(12); } },
            { id: "time18", label: "Surface clock: 18:00 UTC (sunset Greenwich)", group: "Imagery", icon: SunIcon, run: () => { updateGlobe({ realTimeSun: false }); setSurfaceManualHour(18); } },
            { id: "time00", label: "Surface clock: 00:00 UTC (midnight Greenwich)", group: "Imagery", icon: SunIcon, run: () => { updateGlobe({ realTimeSun: false }); setSurfaceManualHour(0); } },
            { id: "time03", label: "Surface clock: 03:00 UTC", group: "Imagery", icon: SunIcon, run: () => { updateGlobe({ realTimeSun: false }); setSurfaceManualHour(3); } },
            { id: "time09", label: "Surface clock: 09:00 UTC", group: "Imagery", icon: SunIcon, run: () => { updateGlobe({ realTimeSun: false }); setSurfaceManualHour(9); } },
            { id: "time15", label: "Surface clock: 15:00 UTC", group: "Imagery", icon: SunIcon, run: () => { updateGlobe({ realTimeSun: false }); setSurfaceManualHour(15); } },
            { id: "time21", label: "Surface clock: 21:00 UTC", group: "Imagery", icon: SunIcon, run: () => { updateGlobe({ realTimeSun: false }); setSurfaceManualHour(21); } },
            // Step UTC hour by ±1, wrapping. Skips real-time mode and snaps to manual.
            { id: "timeStepFwd", label: surfaceManualHour !== null ? `Surface clock: step +1h (now ${String(Math.floor(surfaceManualHour)).padStart(2, "0")}:00 UTC)` : "Surface clock: step +1h from now", group: "Imagery", icon: SunIcon, run: () => {
              updateGlobe({ realTimeSun: false });
              setSurfaceManualHour((h) => {
                const cur = h ?? new Date().getUTCHours();
                return (cur + 1) % 24;
              });
            }},
            { id: "timeStepBack", label: surfaceManualHour !== null ? `Surface clock: step -1h (now ${String(Math.floor(surfaceManualHour)).padStart(2, "0")}:00 UTC)` : "Surface clock: step -1h from now", group: "Imagery", icon: SunIcon, run: () => {
              updateGlobe({ realTimeSun: false });
              setSurfaceManualHour((h) => {
                const cur = h ?? new Date().getUTCHours();
                return (cur + 23) % 24;
              });
            }},
            { id: "surfShot", label: "Save Surface screenshot (.png)", group: "Tools", icon: Camera, run: () => setSurfaceScreenshotCmd((c) => ({ id: (c?.id ?? 0) + 1 })) },
            { id: "geoJsonHint", label: geoJsonImport ? `Clear imported GeoJSON (${geoJsonImport.features?.length ?? 0} features)` : "Drag & drop a .geojson onto the page to import", group: "Tools", icon: Sparkles, run: () => setGeoJsonImport(null) },
            { id: "imgViirs", label: "Imagery: NASA Live VIIRS true-color", group: "Imagery", icon: Sparkles, run: () => updateImagery({ source: "live", layerId: "viirsTrueColor" }) },
            { id: "imgModis", label: "Imagery: NASA Live MODIS Terra", group: "Imagery", icon: Sparkles, run: () => updateImagery({ source: "live", layerId: "modisTrueColor" }) },
            { id: "imgFires", label: "Imagery: MODIS active fires overlay", group: "Imagery", icon: Sparkles, run: () => updateImagery({ source: "live", layerId: "modisFires" }) },
            { id: "imgSnow", label: "Imagery: MODIS snow cover", group: "Imagery", icon: Sparkles, run: () => updateImagery({ source: "live", layerId: "modisSnowCover" }) },
            { id: "imgSeaIce", label: "Imagery: AMSR2 sea-ice concentration", group: "Imagery", icon: Sparkles, run: () => updateImagery({ source: "live", layerId: "seaIce" }) },
            // Help
            { id: "openTab", label: "Inspector → Globe", group: "Inspector", icon: Globe2, run: () => setInspectorTab("globe") },
            { id: "openLayers", label: "Inspector → Layers", group: "Inspector", icon: Layers, hint: "L", run: () => setInspectorTab("layers") },
            { id: "openImagery", label: "Inspector → Imagery", group: "Inspector", icon: Sparkles, run: () => setInspectorTab("imagery") },
            { id: "openBookmarks", label: "Inspector → Saved", group: "Inspector", icon: Bookmark, run: () => setInspectorTab("bookmarks") },
            { id: "openData", label: "Inspector → Data", group: "Inspector", icon: Layers, run: () => setInspectorTab("data") },
          ]}
        />
      )}

      {showShortcuts && <ShortcutsModal onClose={() => setShowShortcuts(false)} />}

      {showEmbed && <EmbedModal onClose={() => setShowEmbed(false)} />}

      {showAbout && (
        <div className="atlasModalShade" onClick={() => setShowAbout(false)} role="dialog" aria-modal="true">
          <div className="atlasShortcutsModal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 640 }}>
            <div className="atlasModalHead">
              <strong>Atlas — open data 3D globe</strong>
              <button type="button" className="atlasIconBtn" onClick={() => setShowAbout(false)} aria-label="Close"><X size={14} /></button>
            </div>
            <p className="atlasHint" style={{ marginTop: 0 }}>
              Atlas combines a custom three.js renderer (orbital "Atlas" mode) with a
              Cesium-backed quadtree-streamed view ("Surface" mode) to give you both
              cinematic full-globe shading from space and ground-level photo-realistic
              detail when you zoom in. Every layer uses live, free, public data.
            </p>
            <h3 style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.1em", color: "var(--gray-10)", textTransform: "uppercase", marginTop: 18, marginBottom: 8 }}>Data sources</h3>
            <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 6, fontSize: 12, color: "var(--gray-11)" }}>
              <li><strong>NASA GIBS</strong> — daily satellite imagery (MODIS Terra, VIIRS SNPP, Black Marble, snow cover, fires, sea ice)</li>
              <li><strong>NASA EONET</strong> — global natural events (wildfires, severe storms, volcanoes, sea ice, drought, dust/haze, snow, floods, landslides, manmade emissions)</li>
              <li><strong>NASA NeoWS</strong> — near-Earth asteroid feed</li>
              <li><strong>NOAA SWPC</strong> — Kp index, solar wind, OVATION aurora forecast</li>
              <li><strong>USGS</strong> — last-24h earthquakes; elevated-volcano alert codes</li>
              <li><strong>airplanes.live</strong> — global ADS-B aircraft positions (~7000 live)</li>
              <li><strong>adsbdb.com</strong> — aircraft database (manufacturer, owner, type) + flight routes</li>
              <li><strong>RainViewer</strong> — global precipitation radar mosaic, 2h history</li>
              <li><strong>The Space Devs / Launch Library 2</strong> — upcoming rocket launches</li>
              <li><strong>Cesium ion</strong> — World Imagery (Bing Aerial), World Terrain, OSM Buildings</li>
              <li><strong>OpenStreetMap Nominatim</strong> — place geocoding</li>
              <li><strong>Wikipedia REST</strong> — pin / volcano summaries</li>
              <li><strong>wheretheiss.at</strong> — ISS / Tiangong / Hubble live positions</li>
              <li><strong>world-atlas (Natural Earth)</strong> — country borders TopoJSON</li>
            </ul>
            <p className="atlasHint" style={{ marginTop: 18, fontSize: 10.5 }}>
              All data is fetched directly from these public APIs from your browser; no
              proxy server. Tile imagery is composited client-side. Free and open.
            </p>
          </div>
        </div>
      )}

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

      {hoveredAircraftId && hoverPos && aircraftSnapshot && !selectedAircraftId && (() => {
        const a = aircraftSnapshot.aircraft.find((x) => x.icao24 === hoveredAircraftId);
        if (!a) return null;
        return (
          <div className="atlasHoverTip" style={{ left: hoverPos.x + 14, top: hoverPos.y + 14 }}>
            <strong>{a.callsign || a.icao24.toUpperCase()}</strong>
            <span>{altitudeFt(a.altitudeM).toLocaleString()} ft · {knotsFromMs(a.velocityMs)} kt</span>
            {(a.registration || a.type) && (
              <span className="atlasHoverTipSub">{a.registration} {a.type}</span>
            )}
          </div>
        );
      })()}

      {layers.neoWatch && (
        <div className="atlasNeoWidget" role="status">
          <div className="atlasNeoWidgetHead">
            <Telescope size={12} />
            <strong>Near-Earth objects today</strong>
            <span>NASA NeoWS</span>
          </div>
          {neoToday.length === 0 ? (
            <div className="atlasNeoEmpty">Loading…</div>
          ) : (
            <ul className="atlasNeoList">
              {neoToday.slice(0, 4).map((n) => (
                <li key={n.id} className={n.hazard ? "hazard" : ""}>
                  <a href={n.jplUrl} target="_blank" rel="noreferrer" title={`${n.diameterMin.toFixed(2)}-${n.diameterMax.toFixed(2)} km diameter`}>
                    <span className="atlasNeoName">{n.name}</span>
                    <span className="atlasNeoMiss">{(n.missDistanceKm / 1e6).toFixed(2)} M km</span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {layers.dayInfo && (() => {
        const times = solarTimes(cameraState.lat, cameraState.lon, new Date());
        if (times === "polar-day") {
          return (
            <div className="atlasDayInfoWidget" role="status">
              <div className="atlasDayInfoLabel">{formatLat(cameraState.lat)} · {formatLon(cameraState.lon)}</div>
              <div className="atlasDayInfoPolar">☀ Polar day · sun never sets</div>
            </div>
          );
        }
        if (times === "polar-night") {
          return (
            <div className="atlasDayInfoWidget" role="status">
              <div className="atlasDayInfoLabel">{formatLat(cameraState.lat)} · {formatLon(cameraState.lon)}</div>
              <div className="atlasDayInfoPolar">🌑 Polar night · sun never rises</div>
            </div>
          );
        }
        const fmtUTC = (h: number) => {
          const hh = Math.floor(h);
          const mm = Math.round((h - hh) * 60);
          return `${hh.toString().padStart(2, "0")}:${mm.toString().padStart(2, "0")}`;
        };
        const dayLengthH = ((times.sunset - times.sunrise) + 24) % 24;
        return (
          <div className="atlasDayInfoWidget" role="status">
            <div className="atlasDayInfoLabel">{formatLat(cameraState.lat)} · {formatLon(cameraState.lon)}</div>
            <div className="atlasDayInfoTimes">
              <div><span>SUNRISE</span><strong>{fmtUTC(times.sunrise)} UTC</strong></div>
              <div><span>NOON</span><strong>{fmtUTC(times.solarNoon)} UTC</strong></div>
              <div><span>SUNSET</span><strong>{fmtUTC(times.sunset)} UTC</strong></div>
              <div><span>DAY</span><strong>{Math.floor(dayLengthH)}h {Math.round((dayLengthH % 1) * 60)}m</strong></div>
            </div>
          </div>
        );
      })()}

      {layers.worldDigest && (() => {
        // One-stop dashboard. Pulls from: aircraft snapshot, EONET events,
        // space weather, next rocket launch. Each data source is loaded
        // independently — the digest just reads whichever are populated.
        const aircraftCount = aircraftSnapshot?.aircraft.length;
        const eonetCount = eonetEvents.length;
        const kp = spaceWeather?.kpLatest;
        const sw = spaceWeather?.swSpeedKmS;
        const nextLaunch = launches.find((l) => l.netUnixMs > Date.now());
        // Subsolar point right now: lat = decl, lon = -(utcHours-12)*15
        const now = new Date();
        const utcHours = now.getUTCHours() + now.getUTCMinutes() / 60;
        const decl = 23.45 * Math.sin((360 / 365) * (Math.floor((now.getTime() - Date.UTC(now.getUTCFullYear(), 0, 0)) / 86400000) - 81) * Math.PI / 180);
        const subsolarLat = decl;
        const subsolarLon = -((utcHours - 12) * 15);
        return (
          <div className="atlasDigestWidget" role="status">
            <div className="atlasDigestHead">
              <Sparkles size={12} />
              <strong>Right now on Earth</strong>
              <span>{now.toUTCString().slice(17, 22)} UTC</span>
            </div>
            <div className="atlasDigestGrid">
              {aircraftCount !== undefined && (
                <div>
                  <span>Aircraft</span>
                  <strong>{aircraftCount.toLocaleString()}</strong>
                  <em>tracked globally</em>
                </div>
              )}
              <div>
                <span>EONET events</span>
                <strong>{eonetCount > 0 ? eonetCount.toLocaleString() : "—"}</strong>
                <em>open in last 30d</em>
              </div>
              {kp !== undefined && (
                <div>
                  <span>Geomagnetic Kp</span>
                  <strong>{kp.toFixed(1)}</strong>
                  <em>{kpScale(kp).label.toLowerCase()}</em>
                </div>
              )}
              {sw !== undefined && sw > 0 && (
                <div>
                  <span>Solar wind</span>
                  <strong>{Math.round(sw)} km/s</strong>
                  <em>protons</em>
                </div>
              )}
              {nextLaunch && (
                <div>
                  <span>Next launch</span>
                  <strong>{timeUntilLaunch(nextLaunch.netUnixMs)}</strong>
                  <em>{nextLaunch.rocket}</em>
                </div>
              )}
              <div>
                <span>Subsolar point</span>
                <strong>{formatLat(subsolarLat)}</strong>
                <em>{formatLon(subsolarLon)}</em>
              </div>
            </div>
          </div>
        );
      })()}

      {layers.timeClock && (() => {
        const now = new Date();
        const cities = [
          { label: "UTC", tz: "UTC" },
          { label: "NYC", tz: "America/New_York" },
          { label: "LDN", tz: "Europe/London" },
          { label: "TYO", tz: "Asia/Tokyo" },
        ];
        const fmt = (tz: string) => {
          try {
            return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, timeZone: tz }).format(now);
          } catch { return "—"; }
        };
        return (
          <div className="atlasClockWidget" role="status">
            {cities.map((c) => (
              <div key={c.label} className="atlasClockCell">
                <span>{c.label}</span>
                <strong>{fmt(c.tz)}</strong>
              </div>
            ))}
          </div>
        );
      })()}

      {selectedVolcanoId && (() => {
        const v = FAMOUS_VOLCANOES.find((x) => x.id === selectedVolcanoId);
        if (!v) return null;
        const alertCode = volcanoAlerts.get(v.name.toLowerCase());
        const alertLabel = alertCode === "red" ? "WARNING — eruption imminent or in progress"
                          : alertCode === "orange" ? "WATCH — increased activity"
                          : alertCode === "yellow" ? "ADVISORY — elevated unrest"
                          : alertCode === "green" ? "NORMAL — typical background activity"
                          : "No active USGS alert";
        const alertColor = alertCode === "red" ? "#ff5a5a"
                          : alertCode === "orange" ? "#ff8a3a"
                          : alertCode === "yellow" ? "#ffd66b"
                          : alertCode === "green" ? "#7cffb1"
                          : "#5a6b8a";
        return (
          <VolcanoCard
            volcano={v}
            alertLabel={alertLabel}
            alertColor={alertColor}
            onClose={() => setSelectedVolcanoId(null)}
            onFlyTo={() => setFlyTo((c) => ({ id: c.id + 1, lat: v.lat, lon: v.lon, altKm: 600 }))}
          />
        );
      })()}

      {selectedEarthquakeId && (() => {
        const q = earthquakes.find((x) => x.id === selectedEarthquakeId);
        if (!q) return null;
        const ageHrs = Math.max(0, (Date.now() - q.time) / 3_600_000);
        const ageLabel = ageHrs < 1 ? `${Math.round(ageHrs * 60)} min ago`
                        : ageHrs < 24 ? `${ageHrs.toFixed(1)} hr ago`
                        : `${Math.round(ageHrs / 24)} d ago`;
        const tag = q.mag >= 5 ? "MAJOR" : q.mag >= 3.5 ? "MOD" : "MINOR";
        const tagColor = q.mag >= 5 ? "#ff5a5a" : q.mag >= 3.5 ? "#ffb84d" : "#ffd66b";
        return (
          <div className="atlasEventCard" role="dialog">
            <div className="atlasEventCardHead">
              <div className="atlasEventCardTag" style={{ background: tagColor }}>M{q.mag.toFixed(1)} {tag}</div>
              <div className="atlasEventCardTitle">
                <strong>{q.place}</strong>
                <span>USGS · {ageLabel}</span>
              </div>
              <button className="atlasIconBtn" onClick={() => setSelectedEarthquakeId(null)} aria-label="Close"><X size={14} /></button>
            </div>
            <div className="atlasEventCardBody">
              <div><span>Magnitude</span><b>{q.mag.toFixed(2)} M</b></div>
              <div><span>Depth</span><b>{q.depth.toFixed(1)} km</b></div>
              <div><span>Position</span><b>{formatLat(q.lat)}</b></div>
              <div><span></span><b>{formatLon(q.lon)}</b></div>
            </div>
            <div className="atlasAircraftCardActions">
              <button className="atlasBtn" onClick={() => setFlyTo((c) => ({ id: c.id + 1, lat: q.lat, lon: q.lon, altKm: 600 }))}>Fly to</button>
              <a className="atlasBtn" href={`https://earthquake.usgs.gov/earthquakes/eventpage/${q.id}`} target="_blank" rel="noreferrer">USGS ↗</a>
            </div>
          </div>
        );
      })()}

      {selectedLaunchId && (() => {
        const l = launches.find((x) => x.id === selectedLaunchId);
        if (!l) return null;
        return (
          <div className="atlasEventCard atlasLaunchCard" role="dialog">
            <div className="atlasEventCardHead">
              <div className="atlasEventCardTag" style={{ background: "#5cb5ff" }}>LAUNCH</div>
              <div className="atlasEventCardTitle">
                <strong>{l.name}</strong>
                <span>{l.agency} · {l.padName}</span>
              </div>
              <button className="atlasIconBtn" onClick={() => setSelectedLaunchId(null)} aria-label="Close"><X size={14} /></button>
            </div>
            <div className="atlasEventCardBody">
              <div><span>Status</span><b>{l.status}</b></div>
              <div><span>{l.netUnixMs > Date.now() ? "Lifts off" : "Lifted off"}</span><b>{timeUntilLaunch(l.netUnixMs)}</b></div>
              <div><span>Rocket</span><b>{l.rocket}</b></div>
              <div><span>NET</span><b>{new Date(l.netUtc).toUTCString().slice(5, 22)} UTC</b></div>
              <div className="atlasAircraftCardWide"><span>Pad</span><b>{formatLat(l.padLat)} · {formatLon(l.padLon)}</b></div>
            </div>
            {l.mission && (
              <p className="atlasLaunchMission">{l.mission.length > 280 ? l.mission.slice(0, 277) + "…" : l.mission}</p>
            )}
            <div className="atlasAircraftCardActions">
              <button className="atlasBtn" onClick={() => setFlyTo((c) => ({ id: c.id + 1, lat: l.padLat, lon: l.padLon, altKm: 600 }))}>Fly to pad</button>
              {l.url && <a className="atlasBtn" href={l.url} target="_blank" rel="noreferrer">LL2 ↗</a>}
            </div>
          </div>
        );
      })()}

      {layers.launches && launches.length > 0 && (() => {
        const next = launches.find((l) => l.netUnixMs > Date.now());
        if (!next) return null;
        return (
          <div className="atlasNextLaunchPill" role="status">
            <Telescope size={11} />
            <span><b>Next launch:</b> {next.name.split("|")[0].trim()} · {timeUntilLaunch(next.netUnixMs)}</span>
          </div>
        );
      })()}

      {measureMode && (
        <div className="atlasMeasurePill" role="status">
          <Compass size={11} />
          {measurePoints.length === 0 && <span>Measure: click point A on the globe</span>}
          {measurePoints.length === 1 && <span>Measure: A set at {formatLat(measurePoints[0].lat)} {formatLon(measurePoints[0].lon)}. Click point B.</span>}
          {measurePoints.length === 2 && (() => {
            const d = haversineKm(measurePoints[0].lat, measurePoints[0].lon, measurePoints[1].lat, measurePoints[1].lon);
            const b = bearingDeg(measurePoints[0].lat, measurePoints[0].lon, measurePoints[1].lat, measurePoints[1].lon);
            return <span><b>{d.toLocaleString(undefined, { maximumFractionDigits: 0 })} km</b> · bearing {b.toFixed(0)}° · click again to reset</span>;
          })()}
          <button type="button" className="atlasIconBtn" onClick={() => { setMeasureMode(false); setMeasurePoints([]); }} aria-label="Exit measure"><X size={11} /></button>
        </div>
      )}

      {layers.aurora && spaceWeather && (() => {
        const { kpLatest, swSpeedKmS, swDensityCm3 } = spaceWeather;
        const sev = kpScale(kpLatest);
        return (
          <div className="atlasAuroraPill" role="status" data-severity={sev.severity}>
            <Sparkles size={11} />
            <span>
              <b>Kp {kpLatest.toFixed(1)}</b>
              <span className="atlasFlightMeta"> · {sev.label} · solar wind {Math.round(swSpeedKmS)} km/s · {swDensityCm3.toFixed(1)}/cc</span>
            </span>
          </div>
        );
      })()}

      {layers.eonet && (
        <div className="atlasEonetControls" role="status">
          <div className="atlasEonetPillInline">
            <Sparkles size={11} />
            {eonetLoading && eonetEvents.length === 0 ? (
              <span>Loading natural events…</span>
            ) : (
              <span>
                <b>{visibleEonetEvents.length.toLocaleString()}</b>
                {visibleEonetEvents.length !== eonetEvents.length && (
                  <span className="atlasFlightTotal"> / {eonetEvents.length.toLocaleString()}</span>
                )}
                <span className="atlasFlightMeta"> · NASA EONET · last 30d</span>
              </span>
            )}
          </div>
          {eonetEvents.length > 0 && (() => {
            // Build category counts so we can hide chips for categories with zero events
            const counts = new Map<string, number>();
            for (const e of eonetEvents) counts.set(e.category, (counts.get(e.category) || 0) + 1);
            const chips: Array<{ key: string; label: string; count: number; color: string }> = [];
            for (const [key, count] of counts.entries()) {
              const sample = eonetEvents.find((e) => e.category === key);
              if (!sample) continue;
              chips.push({ key, label: sample.categoryTitle, count, color: categoryColor(sample.category) });
            }
            chips.sort((a, b) => b.count - a.count);
            return (
              <div className="atlasEonetChips">
                {chips.map((c) => {
                  const isHidden = eonetHidden.has(c.key);
                  return (
                    <button
                      key={c.key}
                      type="button"
                      className={isHidden ? "off" : "on"}
                      style={{ borderColor: isHidden ? "transparent" : c.color }}
                      onClick={() => setEonetHidden((prev) => {
                        const next = new Set(prev);
                        if (next.has(c.key)) next.delete(c.key);
                        else next.add(c.key);
                        return next;
                      })}
                      title={`${isHidden ? "Show" : "Hide"} ${c.label}`}
                    >
                      <span className="dot" style={{ background: c.color }} />
                      {c.label} <b>{c.count}</b>
                    </button>
                  );
                })}
              </div>
            );
          })()}
        </div>
      )}

      {selectedEonetId && (() => {
        const ev = eonetEvents.find((x) => x.id === selectedEonetId);
        if (!ev) return null;
        const ageHrs = Math.max(0, (Date.now() - ev.date) / 3_600_000);
        const ageLabel = ageHrs < 1 ? `${Math.round(ageHrs * 60)} min ago`
                        : ageHrs < 48 ? `${Math.round(ageHrs)} hr ago`
                        : `${Math.round(ageHrs / 24)} d ago`;
        return (
          <div className="atlasEventCard" role="dialog">
            <div className="atlasEventCardHead">
              <div className="atlasEventCardTag" style={{ background: categoryColor(ev.category) }}>
                {categoryIconLabel(ev.category)}
              </div>
              <div className="atlasEventCardTitle">
                <strong>{ev.title}</strong>
                <span>{ev.categoryTitle} · {ageLabel}</span>
              </div>
              <button className="atlasIconBtn" onClick={() => setSelectedEonetId(null)} aria-label="Close"><X size={14} /></button>
            </div>
            <div className="atlasEventCardBody">
              <div><span>Position</span><b>{formatLat(ev.lat)} · {formatLon(ev.lon)}</b></div>
              <div><span>Reported</span><b>{new Date(ev.date).toUTCString().slice(5, 22)}</b></div>
              {ev.magnitude !== null && (
                <div><span>Magnitude</span><b>{ev.magnitude.toLocaleString()} {ev.magnitudeUnit || ""}</b></div>
              )}
            </div>
            <div className="atlasAircraftCardActions">
              <button className="atlasBtn" onClick={() => setFlyTo((c) => ({ id: c.id + 1, lat: ev.lat, lon: ev.lon, altKm: 800 }))}>Fly to</button>
              {ev.sourceUrl && <a className="atlasBtn" href={ev.sourceUrl} target="_blank" rel="noreferrer">Source ↗</a>}
            </div>
          </div>
        );
      })()}

      {layers.weather && radarManifest && radarManifest.past.length > 0 && (
        <div className="atlasWeatherControls" role="status">
          <div className="atlasWeatherHead">
            <Cloud size={12} />
            <span>Live precipitation radar</span>
            <span className="atlasWeatherFrame">
              {(() => {
                const idx = radarFrameIndex < 0 ? radarManifest.past.length - 1 : radarFrameIndex;
                return frameLabel(radarManifest.past[idx]);
              })()}
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={radarManifest.past.length - 1}
            value={radarFrameIndex < 0 ? radarManifest.past.length - 1 : radarFrameIndex}
            onChange={(e) => setRadarFrameIndex(parseInt(e.target.value, 10))}
          />
          <div className="atlasWeatherFooter">
            <button type="button" className="atlasBtn small" onClick={() => setRadarFrameIndex(-1)}>Latest</button>
            <label>
              <span>Opacity</span>
              <input
                type="range" min={0.1} max={1} step={0.05}
                value={radarOpacity}
                onChange={(e) => setRadarOpacity(parseFloat(e.target.value))}
              />
            </label>
            {radarLoading && <span className="atlasWeatherLoading">loading…</span>}
          </div>
        </div>
      )}

      {layers.aircraft && (
        <div className="atlasFlightControls" role="status">
          <div className="atlasFlightPillInline">
            <Plane size={11} />
            {aircraftError ? (
              <span>Flights: {aircraftError}</span>
            ) : aircraftSnapshot ? (
              <span>
                <b>{filteredAircraft.length.toLocaleString()}</b>
                {filteredAircraft.length !== aircraftSnapshot.aircraft.length && (
                  <span className="atlasFlightTotal"> / {aircraftSnapshot.aircraft.length.toLocaleString()}</span>
                )}
                <span className="atlasFlightMeta"> · {Math.round((Date.now() - aircraftSnapshot.fetchedAt) / 1000)}s · {aircraftSnapshot.source}</span>
              </span>
            ) : (
              <span>{aircraftLoading ? "Polling…" : "Flights idle"}</span>
            )}
          </div>
          <div className="atlasFlightFilters">
            <div className="atlasFlightChips">
              {(["all", "commercial", "private", "military", "heli"] as const).map((c) => (
                <button
                  key={c}
                  type="button"
                  className={aircraftCategory === c ? "active" : ""}
                  onClick={() => setAircraftCategory(c)}
                >{c}</button>
              ))}
            </div>
            <label className="atlasFlightAlt">
              <span>Alt {aircraftMinAltFt.toLocaleString()}–{aircraftMaxAltFt.toLocaleString()} ft</span>
              <div className="atlasFlightAltRow">
                <input
                  type="range" min={0} max={50000} step={1000}
                  value={aircraftMinAltFt}
                  onChange={(e) => {
                    const v = parseInt(e.target.value, 10);
                    setAircraftMinAltFt(v);
                    if (v > aircraftMaxAltFt) setAircraftMaxAltFt(v);
                  }}
                />
                <input
                  type="range" min={0} max={50000} step={1000}
                  value={aircraftMaxAltFt}
                  onChange={(e) => {
                    const v = parseInt(e.target.value, 10);
                    setAircraftMaxAltFt(v);
                    if (v < aircraftMinAltFt) setAircraftMinAltFt(v);
                  }}
                />
              </div>
            </label>
            <label className="atlasFlightAirline">
              <span>Airline (callsign prefix)</span>
              <input
                type="text"
                className="atlasFlightAirlineInput"
                value={aircraftAirlinePrefix}
                onChange={(e) => setAircraftAirlinePrefix(e.target.value.toUpperCase())}
                placeholder="UAL · AAL · DAL · BAW · …"
                maxLength={6}
              />
            </label>
          </div>
        </div>
      )}

      {selectedAircraftId && aircraftSnapshot && (() => {
        const a = aircraftSnapshot.aircraft.find((x) => x.icao24 === selectedAircraftId);
        if (!a) return null;
        return (
          <AircraftCard
            aircraft={a}
            onClose={() => setSelectedAircraftId(null)}
            onFlyTo={() => setFlyTo((c) => ({ id: c.id + 1, lat: a.lat, lon: a.lon, altKm: 600 }))}
          />
        );
      })()}

      {timelapseOpen && (
        <TimelapseModal
          startDate={timelapseStartDate}
          endDate={timelapseEndDate}
          layerId={timelapseLayerId}
          fps={timelapseFps}
          frames={timelapseFrames}
          loading={timelapseLoading}
          loadProgress={timelapseLoadProgress}
          playing={timelapsePlaying}
          index={timelapseIndex}
          onChangeStart={setTimelapseStartDate}
          onChangeEnd={setTimelapseEndDate}
          onChangeLayer={setTimelapseLayerId}
          onChangeFps={setTimelapseFps}
          onChangeIndex={setTimelapseIndex}
          onLoad={loadTimelapse}
          onPlayPause={() => setTimelapsePlaying((p) => !p)}
          onClose={closeTimelapse}
        />
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
    { key: "aircraft", label: "Aircraft — live (every plane)", icon: Plane },
    { key: "weather", label: "Weather radar — live precipitation (RainViewer)", icon: Cloud },
    { key: "eonet", label: "Natural events — fires/storms/volcanoes (NASA EONET)", icon: Sparkles },
    { key: "aurora", label: "Aurora forecast (NOAA OVATION)", icon: Sparkles },
    { key: "launches", label: "Upcoming rocket launches (Launch Library 2)", icon: Telescope },
    { key: "iss", label: "ISS — live position", icon: Telescope },
    { key: "tiangong", label: "Tiangong CSS — live position", icon: Telescope },
    { key: "hubble", label: "Hubble — live position", icon: Telescope },
    { key: "sun", label: "Visible sun (in space)", icon: SunIcon },
    { key: "moon", label: "Visible moon (in space)", icon: Globe2 },
    { key: "terminator", label: "Day/night terminator line", icon: Compass },
    { key: "noonMeridian", label: "Solar-noon meridian (where sun is overhead)", icon: SunIcon },
    { key: "buildings3D", label: "Cesium 3D buildings (Surface mode)", icon: Mountain },
    { key: "storms", label: "Active tropical cyclones (NOAA NHC)", icon: Cloud },
    { key: "landmarks", label: "Famous landmarks (Cesium Surface)", icon: Mountain },
    { key: "airports", label: "Major airports (Cesium Surface)", icon: Plane },
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
          <button type="button" className={imagery.source === "live" ? "active" : ""} onClick={() => {
            const layer = GIBS_LAYERS[imagery.layerId];
            // Auto-promote bundled→live picks to a time-aware day layer (VIIRS = fewer swath gaps)
            const patch: Partial<Imagery> = { source: "live" };
            if (!layer || !layer.hasTime) patch.layerId = "viirsTrueColor";
            onUpdate(patch);
          }}>NASA live</button>
          <button type="button" className={imagery.source === "bundled" ? "active" : ""} onClick={() => onUpdate({ source: "bundled" })}>Bundled</button>
          <button type="button" className={imagery.source === "custom" ? "active" : ""} onClick={() => onUpdate({ source: "custom" })}>Custom URL</button>
        </div>
        {imagery.source === "live" && (
          <p className="atlasHint">Streaming real Earth imagery from NASA GIBS. VIIRS is recommended (fewer swath gaps than MODIS).</p>
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
        {imagery.source === "live" && imagery.layerId === "modisTrueColor" && (
          <div className="atlasFixHint">
            <Sparkles size={11} />
            <div>
              <strong>Seeing diagonal swath gaps?</strong>
              <span>MODIS Terra has visible orbit gaps. VIIRS is recommended.</span>
            </div>
            <button type="button" className="atlasPrimaryBtn small" onClick={() => onUpdate({ layerId: "viirsTrueColor" })}>Switch to VIIRS</button>
          </div>
        )}
        <button type="button" className="atlasBtn small" style={{ marginTop: 8, color: "var(--danger)", borderColor: "color-mix(in srgb, var(--danger), transparent 60%)" }} onClick={onReset}>
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

function TimelapseModal({
  startDate, endDate, layerId, fps, frames, loading, loadProgress, playing, index,
  onChangeStart, onChangeEnd, onChangeLayer, onChangeFps, onChangeIndex, onLoad, onPlayPause, onClose
}: {
  startDate: string;
  endDate: string;
  layerId: string;
  fps: number;
  frames: TimelapseFrame[];
  loading: boolean;
  loadProgress: number;
  playing: boolean;
  index: number;
  onChangeStart: (s: string) => void;
  onChangeEnd: (s: string) => void;
  onChangeLayer: (s: string) => void;
  onChangeFps: (n: number) => void;
  onChangeIndex: (n: number) => void;
  onLoad: () => void;
  onPlayPause: () => void;
  onClose: () => void;
}) {
  // Only the time-aware day layers make sense for time-lapse
  const candidateLayers = Object.values(GIBS_LAYERS).filter((l) => l.hasTime && (l.swap === "day" || !l.swap));
  const today = todayUTC();
  const totalFrames = frames.length;
  const currentDate = totalFrames > 0 ? frames[index]?.date : "";
  return (
    <div className="atlasModalShade" onClick={onClose} role="dialog" aria-modal="true">
      <div className="atlasShortcutsModal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 580 }}>
        <div className="atlasModalHead">
          <strong>Time-lapse · NASA daily imagery</strong>
          <button type="button" className="atlasIconBtn" onClick={onClose} aria-label="Close"><X size={14} /></button>
        </div>
        <p className="atlasHint" style={{ marginTop: 0, marginBottom: 12 }}>
          Streams a sequence of GIBS daily composites (low-res) and plays them as an animated reel on the globe.
          Up to 30 frames; older dates have better global coverage.
        </p>

        <div className="timelapseGrid">
          <label>
            <span>Layer</span>
            <select value={layerId} onChange={(e) => onChangeLayer(e.target.value)} disabled={loading || playing}>
              {candidateLayers.map((l) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Start date</span>
            <input type="date" value={startDate} max={today} onChange={(e) => onChangeStart(e.target.value)} disabled={loading || playing} />
          </label>
          <label>
            <span>End date</span>
            <input type="date" value={endDate} max={today} onChange={(e) => onChangeEnd(e.target.value)} disabled={loading || playing} />
          </label>
          <label>
            <span>Speed (fps): <b>{fps}</b></span>
            <input type="range" min={1} max={20} step={1} value={fps} onChange={(e) => onChangeFps(parseInt(e.target.value, 10))} />
          </label>
        </div>

        {loading ? (
          <div className="timelapseLoad">
            <div className="atlasImageryStatusBar"><div style={{ width: `${loadProgress * 100}%` }} /></div>
            <span>Loading frames… {Math.round(loadProgress * 100)}%</span>
          </div>
        ) : totalFrames === 0 ? (
          <button type="button" className="atlasPrimaryBtn" style={{ width: "100%" }} onClick={onLoad}>
            Load frames
          </button>
        ) : (
          <>
            <div className="timelapsePlayer">
              <button type="button" className="atlasIconBtn" onClick={() => onChangeIndex(Math.max(0, index - 1))} aria-label="Previous frame"><SkipBack size={14} /></button>
              <button type="button" className="atlasPrimaryBtn small" onClick={onPlayPause}>
                {playing ? (<><Pause size={12} /> Pause</>) : (<><Play size={12} /> Play</>)}
              </button>
              <button type="button" className="atlasIconBtn" onClick={() => onChangeIndex(Math.min(totalFrames - 1, index + 1))} aria-label="Next frame"><SkipForward size={14} /></button>
              <input
                type="range"
                min={0}
                max={totalFrames - 1}
                value={index}
                onChange={(e) => onChangeIndex(parseInt(e.target.value, 10))}
                style={{ flex: 1 }}
              />
              <span className="timelapseFrameLabel">{currentDate}</span>
            </div>
            <p className="atlasHint" style={{ marginTop: 8, marginBottom: 0 }}>
              Frame {index + 1}/{totalFrames} · close this dialog to revert to your normal imagery.
            </p>
            <button type="button" className="atlasBtn small" style={{ marginTop: 10 }} onClick={onLoad}>
              Reload (with current dates)
            </button>
          </>
        )}
      </div>
    </div>
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

type CommandItem = {
  id: string;
  label: string;
  group: string;          // "Layers" | "View" | "Imagery" | "Tools" | "Help"
  hint?: string;          // shown on the right (e.g. shortcut, current state)
  icon: IconComponent;
  run: () => void;
};

function CommandPalette({
  items,
  onClose,
  onGeocodeAndFly,
}: {
  items: CommandItem[];
  onClose: () => void;
  // Optional handler for "treat the query as a place name and fly there"
  // — wired up by the parent when geocoding is supported. Lets the user
  // type an address ("Brooklyn Bridge", "1600 Pennsylvania Ave") and
  // pick a synthetic "Fly to X" item at the bottom of the list.
  onGeocodeAndFly?: (query: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Cap the unfiltered list to 40 items so opening the palette with a
  // 700+ item set doesn't render hundreds of DOM rows. As soon as the
  // user types, we filter the FULL set so any item is reachable.
  const VISIBLE_NO_QUERY = 40;
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let matches: CommandItem[];
    if (!q) {
      matches = items.slice(0, VISIBLE_NO_QUERY);
    } else {
      matches = items.filter((it) =>
        it.label.toLowerCase().includes(q) ||
        it.group.toLowerCase().includes(q) ||
        (it.hint || "").toLowerCase().includes(q)
      );
      // Cap the visible match list at 80 — when more match, the typing-
      // continued behaviour still narrows it down, no DOM-blowup.
      if (matches.length > 80) matches = matches.slice(0, 80);
    }
    // Append a synthetic "Fly to '{query}'" command when the user has
    // typed something — even if there are command matches. This lets
    // them treat the palette as a universal address bar: type the name
    // of any place and hit Enter to geocode + fly + pin.
    if (q && q.length >= 2 && onGeocodeAndFly) {
      const geocodeItem: CommandItem = {
        id: "geocode",
        label: `Fly to "${query.trim()}" (geocode + drop pin)`,
        group: "Geocode",
        icon: Navigation,
        run: () => onGeocodeAndFly(query.trim()),
      };
      matches = [...matches, geocodeItem];
    }
    return matches;
  }, [items, query, onGeocodeAndFly]);
  // For the "X more — keep typing" footer when there's no query.
  const totalCommands = items.length;
  const showMoreHint = !query.trim() && totalCommands > VISIBLE_NO_QUERY;

  // Reset active index when filter changes
  useEffect(() => { setActiveIndex(0); }, [query]);

  // Group filtered items by `group` while preserving original order
  const grouped = useMemo(() => {
    const map = new Map<string, CommandItem[]>();
    for (const it of filtered) {
      if (!map.has(it.group)) map.set(it.group, []);
      map.get(it.group)!.push(it);
    }
    return Array.from(map.entries());
  }, [filtered]);

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(filtered.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const it = filtered[activeIndex];
      if (it) { it.run(); onClose(); }
    }
  };

  // Compute global linear index for highlighting
  let runningIndex = 0;
  return (
    <div className="atlasModalShade" onClick={onClose} role="dialog" aria-modal="true">
      <div className="atlasCmdPalette" onClick={(e) => e.stopPropagation()}>
        <div className="atlasCmdHead">
          <Search size={16} />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Type a command, layer, or setting…"
            aria-label="Command palette"
          />
          <kbd>ESC</kbd>
        </div>
        <div className="atlasCmdBody">
          {filtered.length === 0 ? (
            <div className="atlasCmdEmpty">No matches for "{query}"</div>
          ) : (
            <>
              {grouped.map(([group, list]) => (
                <div key={group} className="atlasCmdGroup">
                  <div className="atlasCmdGroupTitle">{group}</div>
                  {list.map((it) => {
                    const idx = runningIndex++;
                    const isActive = idx === activeIndex;
                    const Icon = it.icon;
                    return (
                      <button
                        key={it.id}
                        type="button"
                        className={isActive ? "atlasCmdItem active" : "atlasCmdItem"}
                        onMouseEnter={() => setActiveIndex(idx)}
                        onClick={() => { it.run(); onClose(); }}
                      >
                        <Icon size={14} />
                        <span>{it.label}</span>
                        {it.hint && <kbd>{it.hint}</kbd>}
                      </button>
                    );
                  })}
                </div>
              ))}
              {showMoreHint && (
                <div className="atlasCmdEmpty" style={{ opacity: 0.55, fontSize: "12px", padding: "8px 16px" }}>
                  + {totalCommands - VISIBLE_NO_QUERY} more commands · type to search any city, airport, country, landmark…
                </div>
              )}
            </>
          )}
        </div>
        <div className="atlasCmdFoot">
          <span><kbd>↑↓</kbd> navigate</span>
          <span><kbd>↵</kbd> select</span>
          <span><kbd>ESC</kbd> close</span>
        </div>
      </div>
    </div>
  );
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

function VolcanoCard({ volcano, alertLabel, alertColor, onClose, onFlyTo }: {
  volcano: { id: string; name: string; lat: number; lon: number };
  alertLabel: string;
  alertColor: string;
  onClose: () => void;
  onFlyTo: () => void;
}) {
  const [wiki, setWiki] = useState<{ title: string; extract: string; pageUrl: string; thumbnail: string | null } | null>(null);
  useEffect(() => {
    let cancelled = false;
    const ac = new AbortController();
    setWiki(null);
    fetchWikiSummary(volcano.name, ac.signal).then((w) => { if (!cancelled && w) setWiki(w); }).catch(() => {});
    return () => { cancelled = true; ac.abort(); };
  }, [volcano.name]);
  return (
    <div className="atlasEventCard" role="dialog">
      <div className="atlasEventCardHead">
        <div className="atlasEventCardTag" style={{ background: alertColor }}>VOLCANO</div>
        <div className="atlasEventCardTitle">
          <strong>{volcano.name}</strong>
          <span style={{ color: alertColor }}>{alertLabel}</span>
        </div>
        <button className="atlasIconBtn" onClick={onClose} aria-label="Close"><X size={14} /></button>
      </div>
      <div className="atlasEventCardBody">
        <div><span>Lat</span><b>{formatLat(volcano.lat)}</b></div>
        <div><span>Lon</span><b>{formatLon(volcano.lon)}</b></div>
      </div>
      {wiki?.extract && (
        <p className="atlasLaunchMission">
          {wiki.extract.length > 240 ? wiki.extract.slice(0, 237) + "…" : wiki.extract}
        </p>
      )}
      <div className="atlasAircraftCardActions">
        <button className="atlasBtn" onClick={onFlyTo}>Fly to</button>
        {wiki && <a className="atlasBtn" href={wiki.pageUrl} target="_blank" rel="noreferrer">Wikipedia ↗</a>}
        <a className="atlasBtn" href={`https://volcano.si.edu/volcano.cfm?vn=${encodeURIComponent(volcano.name)}`} target="_blank" rel="noreferrer">GVP ↗</a>
      </div>
    </div>
  );
}

// Live aircraft info card with lazy-loaded enrichment from adsbdb.com.
// Shows the full picture: operator + manufacturer + model + flight route
// (origin/destination airports + airline) on top of the live ADS-B telemetry.
function AircraftCard({ aircraft, onClose, onFlyTo }: {
  aircraft: Aircraft;
  onClose: () => void;
  onFlyTo: () => void;
}) {
  const [detail, setDetail] = useState<AircraftDetail | null>(null);
  const [route, setRoute] = useState<FlightRoute | null>(null);
  const [enriching, setEnriching] = useState(false);

  // Fetch enrichment when the selected aircraft changes
  useEffect(() => {
    let cancelled = false;
    const ac = new AbortController();
    setDetail(null);
    setRoute(null);
    setEnriching(true);
    Promise.all([
      fetchAircraftDetail(aircraft.icao24, ac.signal).catch(() => null),
      aircraft.callsign ? fetchFlightRoute(aircraft.callsign, ac.signal).catch(() => null) : Promise.resolve(null),
    ]).then(([d, r]) => {
      if (cancelled) return;
      setDetail(d);
      setRoute(r);
      setEnriching(false);
    });
    return () => { cancelled = true; ac.abort(); };
  }, [aircraft.icao24, aircraft.callsign]);

  const a = aircraft;
  return (
    <div className="atlasAircraftCard" role="dialog">
      <div className="atlasAircraftCardHead">
        <div className="atlasAircraftCardTitle">
          <strong>{a.callsign || a.icao24.toUpperCase()}</strong>
          {route?.airline && <span className="atlasAircraftAirline">{route.airline}</span>}
        </div>
        <button className="atlasIconBtn" onClick={onClose} aria-label="Close"><X size={14} /></button>
      </div>

      {(route?.origin || route?.destination) && (
        <div className="atlasAircraftRoute">
          <div className="atlasAircraftAirport">
            <strong>{route.origin?.iata || "—"}</strong>
            <span>{route.origin?.city || (route.origin?.country || "")}</span>
          </div>
          <div className="atlasAircraftRouteArrow" aria-hidden>→</div>
          <div className="atlasAircraftAirport">
            <strong>{route.destination?.iata || "—"}</strong>
            <span>{route.destination?.city || (route.destination?.country || "")}</span>
          </div>
        </div>
      )}

      {detail && (detail.manufacturer || detail.owner) && (
        <div className="atlasAircraftIdent">
          {(detail.manufacturer || detail.icaoType || detail.model) && (
            <span className="atlasAircraftModel">
              {/* Prefer the curated friendly name (e.g. 'Boeing 737 MAX 8')
                  over the ICAO code. Falls back to manufacturer + model. */}
              {aircraftTypeName(detail.icaoType) || `${detail.manufacturer ?? ""} ${detail.model ?? ""}`.trim()}
            </span>
          )}
          {detail.owner && (
            <span className="atlasAircraftOwner">{detail.owner}{detail.ownerCountry ? ` · ${detail.ownerCountry}` : ""}</span>
          )}
        </div>
      )}

      <div className="atlasAircraftCardBody">
        <div><span>ICAO24</span><b>{a.icao24.toUpperCase()}</b></div>
        <div><span>Reg</span><b>{detail?.registration || a.registration || "—"}</b></div>
        <div><span>Squawk</span><b>{a.squawk || "—"}</b></div>
        <div><span>Type</span><b title={detail?.icaoType || a.type || ""}>{aircraftTypeName(detail?.icaoType || a.type) || "—"}</b></div>
        <div><span>Altitude</span><b>{altitudeFt(a.altitudeM).toLocaleString()} ft</b></div>
        <div><span>Speed</span><b>{knotsFromMs(a.velocityMs)} kt</b></div>
        <div><span>Heading</span><b>{Math.round(a.headingDeg)}°</b></div>
        <div><span>Vert.rate</span><b>{a.verticalRateMs > 0 ? "+" : ""}{Math.round(a.verticalRateMs * 196.85)} ft/min</b></div>
        <div className="atlasAircraftCardWide"><span>Position</span><b>{formatLat(a.lat)} · {formatLon(a.lon)}{a.onGround ? " · on ground" : ""}</b></div>
      </div>

      {enriching && !detail && !route && (
        <div className="atlasAircraftEnriching">Loading flight info…</div>
      )}

      <div className="atlasAircraftCardActions">
        <button className="atlasBtn" onClick={onFlyTo}>Fly to</button>
        <a className="atlasBtn" href={`https://globe.airplanes.live/?icao=${a.icao24}`} target="_blank" rel="noreferrer">Track ↗</a>
      </div>
    </div>
  );
}

function PinInfoCard({ pin, onClose, onDelete, onUpdate, onFly }: { pin: Pin; onClose: () => void; onDelete: (id: string) => void; onUpdate: (id: string, patch: Partial<Pin>) => void; onFly: (p: Pin) => void }) {
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(pin.label);
  const [note, setNote] = useState(pin.note ?? "");
  const [wiki, setWiki] = useState<{ title: string; extract: string; pageUrl: string; thumbnail: string | null } | null>(null);
  useEffect(() => { setLabel(pin.label); }, [pin.label]);
  useEffect(() => { setNote(pin.note ?? ""); }, [pin.note]);
  // Lazy-load Wikipedia summary based on the pin's reverse-geocoded label.
  useEffect(() => {
    let cancelled = false;
    setWiki(null);
    if (!pin.label || pin.label.startsWith("Pin ")) return;   // skip default labels
    const ac = new AbortController();
    fetchWikiSummary(pin.label, ac.signal).then((w) => { if (!cancelled && w) setWiki(w); }).catch(() => {});
    return () => { cancelled = true; ac.abort(); };
  }, [pin.label]);
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
      {wiki && wiki.extract && (
        <div className="atlasPinWiki">
          <p>{wiki.extract.length > 200 ? wiki.extract.slice(0, 197) + "…" : wiki.extract}</p>
          <a href={wiki.pageUrl} target="_blank" rel="noreferrer">Wikipedia ↗</a>
        </div>
      )}
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
  // Trip total: walk every consecutive pin pair via great-circle distance.
  const trip = useMemo(() => {
    if (pins.length < 2) return null;
    let total = 0;
    const segments: Array<{ from: Pin; to: Pin; dist: number; bearing: number }> = [];
    for (let i = 0; i < pins.length - 1; i++) {
      const a = pins[i];
      const b = pins[i + 1];
      const d = haversineKm(a.lat, a.lon, b.lat, b.lon);
      total += d;
      segments.push({ from: a, to: b, dist: d, bearing: bearingDeg(a.lat, a.lon, b.lat, b.lon) });
    }
    // Ballpark commercial-jet flight time: 800 km/h cruise + 30 min for taxi/climb/descent overhead
    const flightHrs = total / 800 + 0.5;
    return { total, segments, flightHrs };
  }, [pins]);

  return (
    <div className="atlasPinsMini">
      <div className="atlasPinsMiniHead">
        <span>Pins ({pins.length})</span>
        {trip && (
          <span className="atlasPinsMeasurement" title={`Estimated commercial flight time: ${Math.round(trip.flightHrs)}h`}>
            {trip.total.toLocaleString(undefined, { maximumFractionDigits: 0 })} km · ~{Math.round(trip.flightHrs)}h flight
          </span>
        )}
      </div>
      <div className="atlasPinsMiniList">
        {pins.slice(-6).reverse().map((p, i) => {
          // Show segment distance+bearing for non-last items (i.e. there's
          // a "next" pin in the visual list)
          const reversed = pins.slice(-6).reverse();
          const next = reversed[i + 1];
          const seg = next ? { dist: haversineKm(next.lat, next.lon, p.lat, p.lon), bearing: bearingDeg(next.lat, next.lon, p.lat, p.lon) } : null;
          return (
            <div key={p.id} className={`atlasPinsMiniRow${p.id === selectedId ? " selected" : ""}`}>
              <span className="atlasPinDot" style={{ background: p.color }} />
              <button type="button" className="atlasPinsMiniLabel" onClick={() => onSelect(p.id)}>
                {p.label}
                {seg && <span className="atlasPinSegMeta"> · {Math.round(seg.dist).toLocaleString()} km from prev</span>}
              </button>
              <button type="button" className="atlasIconBtn" onClick={() => onFly(p)} title="Fly to" aria-label="Fly to"><Navigation size={11} /></button>
              <button type="button" className="atlasIconBtn" onClick={() => onDelete(p.id)} title="Delete" aria-label="Delete"><Trash2 size={11} /></button>
            </div>
          );
        })}
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
  aircraft,
  selectedAircraftId,
  radarTexture,
  radarOpacity,
  eonetEvents,
  selectedEonetId,
  onSelectEonet,
  launchList,
  selectedLaunchId,
  onSelectLaunch,
  selectedEarthquakeId,
  onSelectEarthquake,
  selectedVolcanoId,
  onSelectVolcano,
  auroraTexture,
  aircraftHistory,
  volcanoAlerts,
  onAircraftHover,
  pins,
  earthquakes,
  borders,
  selectedPinId,
  dayTexture,
  nightTexture,
  pinTool,
  onSelectPin,
  onSelectAircraft,
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
  aircraft: Aircraft[];
  selectedAircraftId: string | null;
  radarTexture: THREE.Texture | null;
  radarOpacity: number;
  eonetEvents: EonetEvent[];
  selectedEonetId: string | null;
  onSelectEonet: (id: string | null) => void;
  launchList: RocketLaunch[];
  selectedLaunchId: string | null;
  onSelectLaunch: (id: string | null) => void;
  selectedEarthquakeId: string | null;
  onSelectEarthquake: (id: string | null) => void;
  selectedVolcanoId: string | null;
  onSelectVolcano: (id: string | null) => void;
  auroraTexture: THREE.Texture | null;
  aircraftHistory?: Map<string, Array<{ lat: number; lon: number; alt: number; t: number }>>;
  volcanoAlerts: Map<string, string>;
  onAircraftHover: (id: string | null, screen: { x: number; y: number } | null) => void;
  pins: Pin[];
  earthquakes: Earthquake[];
  borders: Float32Array | null;
  selectedPinId: string | null;
  dayTexture: THREE.Texture | null;
  nightTexture: THREE.Texture | null;
  pinTool: boolean;
  onSelectPin: (id: string | null) => void;
  onSelectAircraft: (id: string | null) => void;
  onGlobeClick: (lat: number, lon: number) => void;
  onCameraChange: (lat: number, lon: number, altKm: number) => void;
}) {
  const sunDirection = useMemo(() => {
    const [x, y, z] = sunPosition(globe.sunAzimuth, globe.sunElevation, 1);
    return new THREE.Vector3(x, y, z);
  }, [globe.sunAzimuth, globe.sunElevation]);

  return (
    <Canvas
      // Mobile: cap DPR at 1, disable AA, use 'demand' frameloop so we only
      // re-render when something changes (orbit, layer toggle, etc.) rather
      // than at the display refresh rate. This alone reclaims ~50% on a phone.
      dpr={IS_LOW_END ? 1 : [1, Math.min(window.devicePixelRatio, 2)]}
      camera={{ position: [0, 0, SPACE_DISTANCE], fov: 55, near: 0.0001, far: 2000 }}
      gl={{ antialias: !IS_LOW_END, powerPreference: "high-performance", preserveDrawingBuffer: true, logarithmicDepthBuffer: true }}
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
          {layers.earthquakes && <EarthquakeMarkers data={earthquakes} selectedId={selectedEarthquakeId} onSelect={onSelectEarthquake} />}
          {layers.volcanoes && <VolcanoMarkers alerts={volcanoAlerts} selectedId={selectedVolcanoId} onSelect={onSelectVolcano} />}
          {layers.pinPaths && <PinPaths pins={pins} sunDirection={sunDirection} />}
          {layers.pins && <PinMarkers pins={pins} selectedId={selectedPinId} onSelect={onSelectPin} />}
          {layers.aircraft && aircraft.length > 0 && (
            <AircraftLayer aircraft={aircraft} selectedId={selectedAircraftId} onSelect={onSelectAircraft} onHover={onAircraftHover} aircraftHistory={aircraftHistory} />
          )}
          {layers.weather && radarTexture && (
            <WeatherRadar texture={radarTexture} opacity={radarOpacity} />
          )}
          {layers.eonet && eonetEvents.length > 0 && (
            <EonetMarkers events={eonetEvents} selectedId={selectedEonetId} onSelect={onSelectEonet} />
          )}
          {layers.launches && launchList.length > 0 && (
            <LaunchMarkers launches={launchList} selectedId={selectedLaunchId} onSelect={onSelectLaunch} />
          )}
          {layers.aurora && auroraTexture && (
            <AuroraOverlay texture={auroraTexture} />
          )}
          {layers.terminator && <TerminatorRing sunDirection={sunDirection} />}
          {layers.noonMeridian && <SolarNoonMeridian />}
          {layers.subsolar && <SubsolarPoint sunDirection={sunDirection} />}
        </EarthGroup>
        {layers.sun && <SunMesh azimuth={globe.sunAzimuth} elevation={globe.sunElevation} />}
        {layers.moon && <MoonMesh />}
        {layers.constellations && <ConstellationLines />}
        {layers.atmosphere && <Atmosphere intensity={globe.atmosphereIntensity} sunDirection={sunDirection} />}
        {layers.clouds && <Clouds opacity={globe.cloudOpacity} paused={paused} />}
        {layers.stars && <Stars radius={120} depth={50} count={IS_LOW_END ? 1200 : 4500} factor={4} saturation={0} fade speed={0.5} />}
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

// Solar-noon meridian: the longitude line directly under the sun right now.
// At any instant, half the Earth is in daylight and the meridian where the
// sun is highest overhead is at lon = -(utcHours-12)*15. Draw it as a thin
// gold great-circle curve from north pole to south pole through that lon.
function SolarNoonMeridian() {
  const ref = useRef<THREE.LineSegments>(null);
  const positions = useMemo(() => {
    const pts: number[] = [];
    // Build at lon=0; we'll rotate the line in useFrame so the geometry
    // is allocated once and just orients toward the current subsolar lon.
    const radius = 1.001;
    const segments = 64;
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const lat = 90 - t * 180;     // +90 → -90
      const phi = (90 - lat) * Math.PI / 180;
      const x = radius * Math.sin(phi);
      const y = radius * Math.cos(phi);
      // z=0 because lon=0 in our convention puts +X
      // Build segment pairs (i,i+1) for lineSegments
      pts.push(x, y, 0);
      if (i > 0 && i < segments) pts.push(x, y, 0); // duplicate inner so each segment has 2 points
    }
    return new Float32Array(pts);
  }, []);
  const geom = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    return g;
  }, [positions]);
  useEffect(() => () => geom.dispose(), [geom]);

  // Spin to current subsolar lon every frame.
  useFrame(() => {
    if (!ref.current) return;
    const now = new Date();
    const utcHours = now.getUTCHours() + now.getUTCMinutes() / 60 + now.getUTCSeconds() / 3600;
    const subsolarLon = -((utcHours - 12) * 15);
    // Our latLonToVec3 negates lon, so spin by +lon*π/180 (positive Y rotation)
    // to bring the lon=0 meridian to subsolarLon's actual sphere position.
    const theta = -subsolarLon * Math.PI / 180;
    ref.current.rotation.set(0, theta, 0);
  });

  return (
    <lineSegments ref={ref} geometry={geom}>
      <lineBasicMaterial color="#ffd66b" transparent opacity={0.7} depthWrite={false} />
    </lineSegments>
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

// Render every aircraft worldwide as a single InstancedMesh of textured plane
// silhouettes — top-down airliner shape (fuselage + swept wings + tail), tinted
// by altitude per-instance. Single shared CanvasTexture keeps perf at ~30k aircraft.
function createPlaneSilhouetteTexture(): THREE.CanvasTexture {
  const SIZE = 128;
  const c = document.createElement("canvas");
  c.width = SIZE;
  c.height = SIZE;
  const ctx = c.getContext("2d")!;
  ctx.clearRect(0, 0, SIZE, SIZE);
  ctx.fillStyle = "#ffffff";
  // Soft glow under the plane so it pops over dark continents
  ctx.shadowColor = "rgba(0,0,0,0.6)";
  ctx.shadowBlur = 4;

  const cx = SIZE / 2;
  const cy = SIZE / 2;
  // Nose at canvas top (small Y) → maps to local +Y on the quad → forward direction.
  // Coordinates expressed in pixels, fits nicely inside 128×128.

  // Fuselage — long thin ellipse
  ctx.beginPath();
  ctx.ellipse(cx, cy, 7, 48, 0, 0, Math.PI * 2);
  ctx.fill();

  // Main wings — large swept-back delta
  ctx.beginPath();
  ctx.moveTo(cx - 54, cy + 14);     // left wing tip (back-swept)
  ctx.lineTo(cx - 4, cy - 4);       // left root leading edge
  ctx.lineTo(cx + 4, cy - 4);       // right root leading edge
  ctx.lineTo(cx + 54, cy + 14);     // right wing tip
  ctx.lineTo(cx + 6, cy + 12);      // right root trailing edge
  ctx.lineTo(cx - 6, cy + 12);      // left root trailing edge
  ctx.closePath();
  ctx.fill();

  // Horizontal stabilizers (rear wings)
  ctx.beginPath();
  ctx.moveTo(cx - 22, cy + 38);
  ctx.lineTo(cx - 4, cy + 30);
  ctx.lineTo(cx + 4, cy + 30);
  ctx.lineTo(cx + 22, cy + 38);
  ctx.lineTo(cx + 4, cy + 42);
  ctx.lineTo(cx - 4, cy + 42);
  ctx.closePath();
  ctx.fill();

  // Nose taper (gives a pointed front)
  ctx.beginPath();
  ctx.moveTo(cx - 6, cy - 36);
  ctx.lineTo(cx, cy - 50);
  ctx.lineTo(cx + 6, cy - 36);
  ctx.closePath();
  ctx.fill();

  ctx.shadowBlur = 0;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipMapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

const AIRCRAFT_VERT = `
  // three.js auto-injects \`attribute vec3 instanceColor\` for InstancedMesh
  // when mesh.instanceColor is set. Don't redeclare — that's a compile error.
  varying vec3 vColor;
  varying vec2 vUv;
  varying float vFade;
  uniform float uPxScale;

  void main() {
    vColor = instanceColor;
    vUv = uv;
    vec4 instanceAnchor = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    float distFromCam = distance(cameraPosition, instanceAnchor.xyz);
    // Distance-based scale so on-screen plane size stays consistent at any zoom.
    float scl = uPxScale * distFromCam;
    vec3 scaled = position * scl;
    gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(scaled, 1.0);
    vFade = smoothstep(8.0, 2.0, distFromCam);
  }
`;
const AIRCRAFT_FRAG = `
  precision mediump float;
  uniform sampler2D uPlaneTex;
  varying vec3 vColor;
  varying vec2 vUv;
  varying float vFade;
  void main() {
    vec4 t = texture2D(uPlaneTex, vUv);
    if (t.a < 0.04) discard;
    // Multiply the white silhouette by per-instance altitude color, keep the
    // texture's anti-aliased alpha for clean edges, fade with distance.
    gl_FragColor = vec4(vColor * t.rgb, t.a * (0.65 + 0.35 * vFade));
  }
`;

function AircraftLayer({
  aircraft,
  selectedId,
  onSelect,
  onHover,
  aircraftHistory
}: {
  aircraft: Aircraft[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onHover?: (id: string | null, screen: { x: number; y: number } | null) => void;
  aircraftHistory?: Map<string, Array<{ lat: number; lon: number; alt: number; t: number }>>;
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const haloRef = useRef<THREE.InstancedMesh>(null);

  // Pre-allocate scratch objects (recreated reference each rebuild for clarity)
  const scratch = useMemo(() => ({
    matrix: new THREE.Matrix4(),
    color: new THREE.Color(),
    pos: new THREE.Vector3(),
    normal: new THREE.Vector3(),
    east: new THREE.Vector3(),
    north: new THREE.Vector3(),
    forward: new THREE.Vector3(),
    right: new THREE.Vector3(),
  }), []);

  // 1×1 quad with UVs — shader scales by distance, samples the plane texture,
  // and tints by per-instance altitude color. Local +Y is the nose direction
  // (matches canvas top, which maps to UV.v=1 with flipY).
  const triGeometry = useMemo(() => new THREE.PlaneGeometry(1, 1), []);

  // Halo geometry — ring around the selected plane
  const haloGeometry = useMemo(() => new THREE.RingGeometry(0.55, 0.85, 32), []);

  // Shared plane silhouette texture (allocated once)
  const planeTex = useMemo(() => createPlaneSilhouetteTexture(), []);

  // Custom material with per-instance color + camera-distance scaling.
  // USE_INSTANCING_COLOR define forces three.js to inject `attribute vec3
  // instanceColor` on shader compile — without it, ShaderMaterial doesn't
  // auto-inject (unlike built-in materials), and the first compile fails
  // with "undeclared identifier" before setColorAt triggers a recompile.
  const triMaterial = useMemo(() => {
    return new THREE.ShaderMaterial({
      defines: { USE_INSTANCING_COLOR: "" },
      uniforms: {
        uPxScale: { value: 0.012 },          // ~3x bigger than the old triangle since the silhouette has detail
        uPlaneTex: { value: planeTex }
      },
      vertexShader: AIRCRAFT_VERT,
      fragmentShader: AIRCRAFT_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false
    });
  }, []);

  // Halo uses a similar shader but with a fixed accent color. Slightly bigger
  // than the plane silhouette (0.014 vs 0.012) so the ring sits around the plane.
  const haloMaterial = useMemo(() => {
    return new THREE.ShaderMaterial({
      uniforms: { uPxScale: { value: 0.022 } },
      vertexShader: `
        varying float vFade;
        uniform float uPxScale;
        void main() {
          vec4 anchor = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
          float d = distance(cameraPosition, anchor.xyz);
          vec3 scaled = position * (uPxScale * d);
          gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(scaled, 1.0);
          vFade = smoothstep(8.0, 1.0, d);
        }
      `,
      fragmentShader: `
        varying float vFade;
        void main() {
          gl_FragColor = vec4(0.36, 0.71, 1.0, 0.7 * vFade);
        }
      `,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false
    });
  }, []);

  useEffect(() => {
    return () => {
      triGeometry.dispose();
      haloGeometry.dispose();
      triMaterial.dispose();
      haloMaterial.dispose();
      planeTex.dispose();
    };
  }, [triGeometry, haloGeometry, triMaterial, haloMaterial, planeTex]);

  // Update per-instance matrix + color whenever the data changes.
  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const n = aircraft.length;
    mesh.count = n;
    for (let i = 0; i < n; i++) {
      const a = aircraft[i];
      computeAircraftMatrix(a, scratch);
      mesh.setMatrixAt(i, scratch.matrix);
      const [r, g, b] = altitudeColor(a.altitudeM);
      scratch.color.setRGB(r, g, b);
      mesh.setColorAt(i, scratch.color);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [aircraft, scratch]);

  // Halo for the currently selected aircraft (single instance for simplicity)
  const selectedAircraft = useMemo(() => {
    if (!selectedId) return null;
    return aircraft.find((a) => a.icao24 === selectedId) ?? null;
  }, [selectedId, aircraft]);

  useEffect(() => {
    const halo = haloRef.current;
    if (!halo) return;
    if (!selectedAircraft) { halo.count = 0; halo.instanceMatrix.needsUpdate = true; return; }
    halo.count = 1;
    computeAircraftMatrix(selectedAircraft, scratch);
    halo.setMatrixAt(0, scratch.matrix);
    halo.instanceMatrix.needsUpdate = true;
  }, [selectedAircraft, scratch]);

  // Click → pick instance
  const handleClick = useCallback((e: any) => {
    if (typeof e.instanceId !== "number") return;
    e.stopPropagation();
    const a = aircraft[e.instanceId];
    if (a) onSelect(a.icao24);
  }, [aircraft, onSelect]);

  return (
    <>
      <instancedMesh
        ref={meshRef}
        args={[triGeometry, triMaterial, Math.max(1, aircraft.length)]}
        onPointerDown={handleClick}
        onPointerMove={(e: any) => {
          if (typeof e.instanceId !== "number") return;
          const a = aircraft[e.instanceId];
          if (a && onHover) onHover(a.icao24, { x: e.clientX, y: e.clientY });
        }}
        onPointerOut={() => onHover?.(null, null)}
        frustumCulled={false}
        renderOrder={20}
      />
      <instancedMesh
        ref={haloRef}
        args={[haloGeometry, haloMaterial, 1]}
        frustumCulled={false}
        renderOrder={21}
      />
      {selectedAircraft && (
        <AircraftTrail
          aircraft={selectedAircraft}
          history={aircraftHistory?.get(selectedAircraft.icao24) ?? []}
        />
      )}
    </>
  );
}

// Trail for the selected aircraft: past polled positions (fading from
// transparent at the oldest to bright cyan at the current position) plus a
// 5-minute great-circle prediction ahead.
function AircraftTrail({ aircraft, history }: {
  aircraft: Aircraft;
  history: Array<{ lat: number; lon: number; alt: number; t: number }>;
}) {
  const { positions, colors } = useMemo(() => {
    // ===== past trail (history → bright at current) =====
    const pastPoints: Array<{ lat: number; lon: number; alt: number }> = [];
    if (history.length > 0) {
      // Keep only points distinct enough to be visible (skip duplicates from
      // when an aircraft is parked or polled twice with the same position).
      let last: { lat: number; lon: number } | null = null;
      for (const h of history) {
        if (!last || Math.abs(h.lat - last.lat) > 0.001 || Math.abs(h.lon - last.lon) > 0.001) {
          pastPoints.push({ lat: h.lat, lon: h.lon, alt: h.alt });
          last = h;
        }
      }
    }
    pastPoints.push({ lat: aircraft.lat, lon: aircraft.lon, alt: aircraft.altitudeM });

    // ===== future prediction (current → 5 min ahead) =====
    const futureSegments = 32;
    const minutesAhead = 5;
    const distanceM = aircraft.velocityMs * minutesAhead * 60;
    const distanceRad = distanceM / 1000 / EARTH_RADIUS_KM;
    const lat0 = aircraft.lat * Math.PI / 180;
    const lon0 = aircraft.lon * Math.PI / 180;
    const heading = (aircraft.headingDeg || 0) * Math.PI / 180;
    const futurePoints: Array<{ lat: number; lon: number; alt: number }> = [];
    for (let i = 1; i <= futureSegments; i++) {
      const t = i / futureSegments;
      const d = distanceRad * t;
      const lat2 = Math.asin(
        Math.sin(lat0) * Math.cos(d) + Math.cos(lat0) * Math.sin(d) * Math.cos(heading)
      );
      const lon2 = lon0 + Math.atan2(
        Math.sin(heading) * Math.sin(d) * Math.cos(lat0),
        Math.cos(d) - Math.sin(lat0) * Math.sin(lat2)
      );
      futurePoints.push({
        lat: lat2 * 180 / Math.PI,
        lon: lon2 * 180 / Math.PI,
        alt: aircraft.altitudeM,
      });
    }

    // Helper: lat/lon (deg) + alt (m) → 3D coord matching latLonToVec3.
    const toXYZ = (lat: number, lon: number, alt: number) => {
      const altKm = Math.max(0, alt / 1000);
      const radius = 1 + altKm / EARTH_RADIUS_KM + 0.005;
      const phi = (90 - lat) * Math.PI / 180;
      const theta = -lon * Math.PI / 180;
      return [
        radius * Math.sin(phi) * Math.cos(theta),
        radius * Math.cos(phi),
        radius * Math.sin(phi) * Math.sin(theta),
      ];
    };

    const totalPoints = pastPoints.length + futurePoints.length;
    const pos = new Float32Array(totalPoints * 3);
    const col = new Float32Array(totalPoints * 3);
    let i = 0;
    // Past: fade in from low alpha to full alpha
    const pastN = pastPoints.length;
    for (const p of pastPoints) {
      const t = pastN > 1 ? i / (pastN - 1) : 1;        // 0 = oldest, 1 = current
      const xyz = toXYZ(p.lat, p.lon, p.alt);
      pos[i * 3 + 0] = xyz[0]; pos[i * 3 + 1] = xyz[1]; pos[i * 3 + 2] = xyz[2];
      const alpha = 0.18 + 0.82 * t;                    // dim trail history
      col[i * 3 + 0] = 0.36 * alpha;
      col[i * 3 + 1] = 0.71 * alpha;
      col[i * 3 + 2] = 1.0 * alpha;
      i += 1;
    }
    // Future: fade from full at current → transparent at tip
    for (let f = 0; f < futurePoints.length; f++) {
      const p = futurePoints[f];
      const xyz = toXYZ(p.lat, p.lon, p.alt);
      pos[i * 3 + 0] = xyz[0]; pos[i * 3 + 1] = xyz[1]; pos[i * 3 + 2] = xyz[2];
      const alpha = 1 - (f + 1) / futurePoints.length;
      col[i * 3 + 0] = 1.0 * alpha;     // warmer (yellow→white) for predicted
      col[i * 3 + 1] = 0.85 * alpha;
      col[i * 3 + 2] = 0.45 * alpha;
      i += 1;
    }
    return { positions: pos, colors: col };
  }, [aircraft.lat, aircraft.lon, aircraft.headingDeg, aircraft.velocityMs, aircraft.altitudeM]);

  const trailObject = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    const m = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      linewidth: 2
    });
    const obj = new THREE.Line(g, m);
    obj.renderOrder = 22;
    return obj;
  }, [positions, colors]);

  useEffect(() => {
    return () => {
      trailObject.geometry.dispose();
      (trailObject.material as THREE.Material).dispose();
    };
  }, [trailObject]);

  if (aircraft.velocityMs <= 0) return null;
  return <primitive object={trailObject} />;
}

function computeAircraftMatrix(
  a: Aircraft,
  scratch: {
    matrix: THREE.Matrix4;
    pos: THREE.Vector3;
    normal: THREE.Vector3;
    east: THREE.Vector3;
    north: THREE.Vector3;
    forward: THREE.Vector3;
    right: THREE.Vector3;
  }
) {
  // Aircraft typical altitudes are 0-15km — well under 1% of Earth radius.
  // We add a small visibility bump so they don't z-fight with the surface.
  const altKm = Math.max(0, a.altitudeM / 1000);
  const radius = 1 + altKm / EARTH_RADIUS_KM + 0.005;
  // Mirror the latLonToVec3 convention (lon negated) so planes sit on the same
  // sphere position as a pin/border at the same lat/lon.
  const phi = (90 - a.lat) * Math.PI / 180;
  const theta = -a.lon * Math.PI / 180;
  scratch.pos.set(
    radius * Math.sin(phi) * Math.cos(theta),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta)
  );
  scratch.normal.copy(scratch.pos).normalize();
  // east is ∂pos/∂lon. With theta = -lon*π/180, derivative chain gives
  //   east ∝ (sin(theta), 0, -cos(theta))   (sign on z is the consequence of negation).
  scratch.east.set(Math.sin(theta), 0, -Math.cos(theta));
  // After the lon negation, north = normal × east (NOT east × normal — that
  // would give south because the handedness flipped with theta).
  scratch.north.crossVectors(scratch.normal, scratch.east).normalize();
  // Re-orthogonalize east against (north, normal) so we have a clean tangent
  // frame even at poles where the closed-form east is degenerate.
  scratch.east.crossVectors(scratch.north, scratch.normal).normalize();
  // forward = north * cos(h) + east * sin(h), heading 0=N, 90=E
  const h = (a.headingDeg || 0) * Math.PI / 180;
  scratch.forward.copy(scratch.north).multiplyScalar(Math.cos(h))
    .addScaledVector(scratch.east, Math.sin(h));
  scratch.right.crossVectors(scratch.forward, scratch.normal).normalize();
  // Build basis: plane silhouette's local (X = right, Y = forward, Z = normal/up)
  scratch.matrix.makeBasis(scratch.right, scratch.forward, scratch.normal);
  scratch.matrix.setPosition(scratch.pos);
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

    vec3 viewDir = normalize(cameraPosition - vWorldPosition);
    float fresnel = pow(1.0 - max(0.0, dot(N, viewDir)), 3.5);

    // Water specular: anisotropic ocean shimmer + sun-glint hot-spot.
    vec3 H = normalize(L + viewDir);
    float specBroad  = pow(max(0.0, dot(N, H)),  18.0) * spec * diffuse * 0.20;
    float specSharp  = pow(max(0.0, dot(N, H)), 220.0) * spec * diffuse * 1.40;
    vec3  specColor  = vec3(1.0, 0.95, 0.82);
    vec3  specHighlight = (specBroad + specSharp) * specColor;

    // Slight contrast/saturation lift on the day side — the GIBS/BlueMarble
    // sources are pretty desaturated; this gives oceans more depth without
    // looking artificial.
    vec3 dayLuma = vec3(dot(dayColor, vec3(0.299, 0.587, 0.114)));
    vec3 daySaturated = mix(dayLuma, dayColor, 1.18);
    vec3 lit = daySaturated * (0.06 + diffuse * 1.10) + specHighlight;

    // Night: stronger near terminator, fades smoothly toward deep night where
    // the city lights are most visible.
    vec3 night = nightColor * uNightStrength * (1.0 - terminator);

    vec3 color = mix(night, lit, terminator);

    // Twilight: warm orange ramp at the day/night edge — sky-color science.
    float twilight = 1.0 - abs(ndotl);
    twilight = pow(twilight, 5.0);
    color += vec3(0.16, 0.09, 0.04) * twilight * 0.85;

    // Atmospheric scatter on the disc rim (Rayleigh-ish blue-cyan): subtle
    // limb tint that gets bluer toward the edges, especially on the day side.
    color += vec3(0.32, 0.55, 0.95) * fresnel * (0.18 + 0.55 * diffuse);

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

  // 128² is overkill at globe view — drop to 64² on mobile (still smooth at
  // closer zoom, saves ~32k vertices and a meaningful chunk of fillrate).
  const earthSegs = IS_LOW_END ? 64 : 128;
  return (
    <mesh ref={ref} onPointerDown={handlePointerDown}>
      <sphereGeometry args={[1, earthSegs, earthSegs]} />
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

function VolcanoMarkers({ alerts, selectedId, onSelect }: {
  alerts: Map<string, string>;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const groupRef = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (!groupRef.current) return;
    const t = clock.elapsedTime;
    groupRef.current.children.forEach((child, i) => {
      const isElevated = (child as any).userData?.elevated === true;
      const speed = isElevated ? 1.6 : 0.8;
      const amplitude = isElevated ? 0.9 : 0.4;
      const phase = (t * speed + i * 0.4) % 2;
      child.scale.setScalar(1 + Math.max(0, 1 - phase) * amplitude);
    });
  });
  const tintFor = (vname: string): { color: string; size: number; elevated: boolean } => {
    const c = alerts.get(vname.toLowerCase());
    if (c === "red")    return { color: "#ff3a3a", size: 0.013, elevated: true };
    if (c === "orange") return { color: "#ff8a3a", size: 0.012, elevated: true };
    if (c === "yellow") return { color: "#ffd66b", size: 0.010, elevated: true };
    if (c === "green")  return { color: "#7cffb1", size: 0.008, elevated: false };
    return { color: "#ff6a3d", size: 0.008, elevated: false };
  };
  return (
    <group ref={groupRef}>
      {FAMOUS_VOLCANOES.map((v) => {
        const pos = latLonToVec3(v.lat, v.lon, 1.004);
        const tint = tintFor(v.name);
        const isSelected = v.id === selectedId;
        return (
          <mesh
            key={v.id}
            position={pos}
            userData={{ elevated: tint.elevated }}
            onPointerDown={(e: any) => { e.stopPropagation(); onSelect(v.id); }}
          >
            <coneGeometry args={[isSelected ? tint.size * 1.4 : tint.size, (isSelected ? tint.size * 1.4 : tint.size) * 2.25, 6]} />
            <meshBasicMaterial color={tint.color} transparent opacity={isSelected ? 1 : 0.92} toneMapped={false} />
          </mesh>
        );
      })}
    </group>
  );
}

// Per-event marker size — bigger for high-magnitude wildfires/storms so the
// most consequential events stand out.
function eonetMarkerSize(ev: EonetEvent, isSelected: boolean): number {
  const base =
    ev.category === "severeStorms" ? 0.011 :
    ev.category === "volcanoes"    ? 0.011 :
    ev.category === "wildfires"    ? 0.009 :
    ev.category === "earthquakes"  ? 0.009 :
    0.007;
  let mag = 0;
  if (ev.magnitude !== null) {
    if (ev.magnitudeUnit === "acres") mag = Math.min(0.012, Math.log10(Math.max(1, ev.magnitude)) * 0.0025);
    else if (ev.magnitudeUnit === "kts" || ev.magnitudeUnit === "mph") mag = Math.min(0.010, ev.magnitude * 0.00007);
    else if (ev.magnitudeUnit === "Magnitude") mag = Math.min(0.010, ev.magnitude * 0.0014);
  }
  return (base + mag) * (isSelected ? 1.6 : 1.0);
}

function EonetMarkers({ events, selectedId, onSelect }: {
  events: EonetEvent[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const groupRef = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (!groupRef.current) return;
    const t = clock.elapsedTime;
    // Soft pulse — different speeds per event so they're not all in sync
    groupRef.current.children.forEach((child, i) => {
      const phase = (t * 1.4 + i * 0.21) % 2.5;
      child.scale.setScalar(1 + Math.max(0, 1 - phase / 1.2) * 0.7);
    });
  });
  return (
    <group ref={groupRef}>
      {events.map((ev) => {
        const pos = latLonToVec3(ev.lat, ev.lon, 1.006);
        const color = categoryColor(ev.category);
        const isSelected = ev.id === selectedId;
        const size = eonetMarkerSize(ev, isSelected);
        return (
          <mesh
            key={ev.id}
            position={pos}
            onPointerDown={(e: any) => {
              e.stopPropagation();
              onSelect(ev.id);
            }}
          >
            <sphereGeometry args={[size, 16, 16]} />
            <meshBasicMaterial color={color} transparent opacity={isSelected ? 1 : 0.85} toneMapped={false} />
          </mesh>
        );
      })}
    </group>
  );
}

function LaunchMarkers({ launches, selectedId, onSelect }: {
  launches: RocketLaunch[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const groupRef = useRef<THREE.Group>(null);
  // Pulse imminent launches harder than ones days away.
  useFrame(({ clock }) => {
    if (!groupRef.current) return;
    const t = clock.elapsedTime;
    const now = Date.now();
    groupRef.current.children.forEach((child, i) => {
      const launch = launches[i];
      if (!launch) return;
      const hoursOut = Math.max(0, (launch.netUnixMs - now) / 3_600_000);
      // Imminent (< 6h): bright fast pulse. Far (> 24h): subtle slow pulse.
      const speed = hoursOut < 6 ? 2.5 : hoursOut < 24 ? 1.4 : 0.8;
      const amplitude = hoursOut < 6 ? 1.2 : hoursOut < 24 ? 0.7 : 0.3;
      const phase = (t * speed + i * 0.31) % 2.4;
      child.scale.setScalar(1 + Math.max(0, 1 - phase / 1.2) * amplitude);
    });
  });
  const colorFor = (l: RocketLaunch): string => {
    const hoursOut = Math.max(0, (l.netUnixMs - Date.now()) / 3_600_000);
    if (l.statusAbbrev === "Failure") return "#ff5a7a";
    if (hoursOut < 1)  return "#ffd66b";       // imminent — gold
    if (hoursOut < 24) return "#5cb5ff";       // soon — accent blue
    return "#7a8db5";                           // future — muted
  };
  return (
    <group ref={groupRef}>
      {launches.map((l) => {
        const pos = latLonToVec3(l.padLat, l.padLon, 1.007);
        const isSelected = l.id === selectedId;
        const baseSize = isSelected ? 0.014 : 0.010;
        return (
          <mesh
            key={l.id}
            position={pos}
            onPointerDown={(e: any) => {
              e.stopPropagation();
              onSelect(l.id);
            }}
          >
            <octahedronGeometry args={[baseSize]} />
            <meshBasicMaterial color={colorFor(l)} transparent opacity={0.9} toneMapped={false} />
          </mesh>
        );
      })}
    </group>
  );
}

function EarthquakeMarkers({ data, selectedId, onSelect }: {
  data: Earthquake[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const groupRef = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (!groupRef.current) return;
    const t = clock.elapsedTime;
    groupRef.current.children.forEach((child, i) => {
      const q = data[i];
      // Bigger + faster pulse for stronger quakes
      const intensity = q ? Math.min(1.5, 0.4 + q.mag * 0.18) : 0.6;
      const phase = (t + i * 0.13) % 2;
      child.scale.setScalar(1 + Math.max(0, 1 - phase) * intensity);
    });
  });
  return (
    <group ref={groupRef}>
      {data.map((q) => {
        const pos = latLonToVec3(q.lat, q.lon, 1.003);
        const size = 0.003 + Math.max(0, q.mag) * 0.0035;
        const isSelected = q.id === selectedId;
        const color = q.mag >= 5 ? "#ff5a5a" : q.mag >= 3.5 ? "#ffb84d" : "#ffd66b";
        return (
          <mesh
            key={q.id}
            position={pos}
            onPointerDown={(e: any) => { e.stopPropagation(); onSelect(q.id); }}
          >
            <sphereGeometry args={[isSelected ? size * 1.5 : size, 16, 16]} />
            <meshBasicMaterial color={color} transparent opacity={isSelected ? 1 : 0.85} toneMapped={false} />
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

  // Lower geo subdivision on mobile (32 vs 64) — visually identical at
  // typical zoom but halves vertex count.
  const segments = IS_LOW_END ? 32 : 64;
  return (
    <mesh ref={ref} scale={1.012}>
      <sphereGeometry args={[1, segments, segments]} />
      <meshStandardMaterial
        map={tex}
        transparent
        opacity={opacity}
        depthWrite={false}
      />
    </mesh>
  );
}

// Radar overlay sphere — a thin shell at radius 1.0015 with a custom shader that
// remaps the source mercator texture to the sphere's lat/lon. We can't just slap
// a mercator-tiled canvas onto a UV sphere — the standard equirectangular UV
// would stretch tropics and squish poles incorrectly.
const RADAR_VERT = `
  varying vec3 vWorldNormal;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldNormal = normalize(wp.xyz);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const RADAR_FRAG = `
  precision mediump float;
  uniform sampler2D uTexture;
  uniform float uOpacity;
  varying vec3 vWorldNormal;
  const float PI = 3.14159265358979;

  void main() {
    vec3 n = vWorldNormal;
    float lat = asin(clamp(n.y, -1.0, 1.0));
    // Negate z to match latLonToVec3's negated-lon convention — keeps mercator
    // tiles aligned with the continents the user sees on the Earth texture.
    float lon = atan(-n.z, n.x);
    // Web Mercator clips at ±~85.05113° (mercY = ±1). Skip outside that band.
    if (lat > 1.4835 || lat < -1.4835) discard;
    float u = (lon + PI) / (2.0 * PI);
    float mercY = log(tan(PI / 4.0 + lat / 2.0)) / PI;
    float v = (1.0 - mercY) / 2.0;
    vec4 c = texture2D(uTexture, vec2(u, v));
    // RainViewer's PNGs are antialiased blue-violet for rain — anything truly
    // transparent (no precip) is alpha 0. We boost mid-range alpha for visibility.
    if (c.a < 0.06) discard;
    float a = clamp(c.a * 1.4, 0.0, 1.0) * uOpacity;
    gl_FragColor = vec4(c.rgb, a);
  }
`;

function WeatherRadar({ texture, opacity }: { texture: THREE.Texture; opacity: number }) {
  const material = useMemo(() => {
    return new THREE.ShaderMaterial({
      uniforms: {
        uTexture: { value: texture },
        uOpacity: { value: opacity }
      },
      vertexShader: RADAR_VERT,
      fragmentShader: RADAR_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.FrontSide,
      toneMapped: false
    });
  }, []);
  // Update uniforms when props change
  useEffect(() => { material.uniforms.uTexture.value = texture; material.uniformsNeedUpdate = true; }, [material, texture]);
  useEffect(() => { material.uniforms.uOpacity.value = opacity; }, [material, opacity]);
  useEffect(() => () => material.dispose(), [material]);
  return (
    <mesh renderOrder={5}>
      <sphereGeometry args={[1.005, 96, 64]} />
      <primitive object={material} attach="material" />
    </mesh>
  );
}

// Aurora overlay sphere: an equirect-textured shell at radius 1.018 (above
// clouds at 1.012). Uses the same model-space vUv lookup as the Earth shader
// with the same flipped-x convention so it lines up with the world.
const AURORA_VERT = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const AURORA_FRAG = `
  precision mediump float;
  uniform sampler2D uAurora;
  varying vec2 vUv;
  void main() {
    // Match the Earth shader's u-flip so aurora intensity at lon=L lines up
    // with the continent the texture renders at lon=L.
    vec2 uv = vec2(1.0 - vUv.x, vUv.y);
    vec4 c = texture2D(uAurora, uv);
    if (c.a < 0.01) discard;
    gl_FragColor = vec4(c.rgb, c.a);
  }
`;
function AuroraOverlay({ texture }: { texture: THREE.Texture }) {
  const material = useMemo(() => new THREE.ShaderMaterial({
    uniforms: { uAurora: { value: texture } },
    vertexShader: AURORA_VERT,
    fragmentShader: AURORA_FRAG,
    transparent: true,
    depthWrite: false,
    side: THREE.FrontSide,
    blending: THREE.AdditiveBlending,
    toneMapped: false
  }), []);
  useEffect(() => { material.uniforms.uAurora.value = texture; material.uniformsNeedUpdate = true; }, [material, texture]);
  useEffect(() => () => material.dispose(), [material]);
  return (
    <mesh renderOrder={6}>
      <sphereGeometry args={[1.018, 96, 64]} />
      <primitive object={material} attach="material" />
    </mesh>
  );
}

function Atmosphere({ intensity, sunDirection }: { intensity: number; sunDirection?: THREE.Vector3 }) {
  const ref = useRef<THREE.ShaderMaterial>(null);
  useFrame(() => {
    if (ref.current) {
      ref.current.uniforms.uIntensity.value = intensity;
      if (sunDirection) ref.current.uniforms.uSunDirection.value.copy(sunDirection);
    }
  });
  const uniforms = useMemo(() => ({
    uIntensity: { value: intensity },
    uColor: { value: new THREE.Color("#5cb5ff") },
    uColorWarm: { value: new THREE.Color("#ffa66b") },
    uSunDirection: { value: sunDirection?.clone() ?? new THREE.Vector3(1, 0, 0) }
  }), []); // eslint-disable-line react-hooks/exhaustive-deps
  // Two-tone Rayleigh-style fresnel: cool blue front-lit, warm orange near
  // the terminator, fades out on the night-facing limb. Looks far more like
  // the real Earth-from-orbit atmosphere than a flat fresnel.
  const vertexShader = `
    varying vec3 vWorldNormal;
    varying vec3 vViewDir;
    void main() {
      vWorldNormal = normalize(mat3(modelMatrix) * normal);
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vViewDir = normalize(cameraPosition - wp.xyz);
      gl_Position = projectionMatrix * viewMatrix * wp;
    }
  `;
  const fragmentShader = `
    uniform float uIntensity;
    uniform vec3 uColor;
    uniform vec3 uColorWarm;
    uniform vec3 uSunDirection;
    varying vec3 vWorldNormal;
    varying vec3 vViewDir;
    void main() {
      float rim = 1.0 - max(0.0, dot(vWorldNormal, vViewDir));
      float fresnel = pow(rim, 3.5);
      // Sun proximity: limb pixels facing the sun get a warm tint, those
      // facing away fade into space.
      float sunDot = dot(normalize(uSunDirection), vWorldNormal);
      float warmth = smoothstep(-0.2, 0.6, sunDot);
      vec3  tint = mix(uColorWarm, uColor, warmth);
      // Brightness ramp: bright on the day-facing rim, dim on the night side.
      float brightness = smoothstep(-0.4, 0.5, sunDot);
      gl_FragColor = vec4(tint * fresnel * uIntensity * (0.6 + brightness * 1.6),
                           fresnel * uIntensity * (0.4 + brightness * 0.7));
    }
  `;
  const segs = IS_LOW_END ? 32 : 64;
  return (
    <mesh scale={1.07}>
      <sphereGeometry args={[1, segs, segs]} />
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
    // Latitude rings (parallels) — for the texture-aligned convention, theta = -lon*π/180.
    // For a closed parallel ring we sweep lon 0..360 anyway, so the negation only
    // flips the sweep direction; the same circle gets drawn either way.
    for (let lat = -75; lat <= 75; lat += 15) {
      const points: THREE.Vector3[] = [];
      const phi = THREE.MathUtils.degToRad(90 - lat);
      const r = Math.sin(phi);
      const y = Math.cos(phi);
      for (let lon = 0; lon <= 360; lon += 4) {
        const t = THREE.MathUtils.degToRad(-lon);
        points.push(new THREE.Vector3(Math.cos(t) * r, y, Math.sin(t) * r).multiplyScalar(1.001));
      }
      segments.push(points);
    }
    // Longitude meridians — sweep lat -90..+90 along a fixed lon. Here the negation
    // matters: a 'lon=90E' meridian must sit at the mesh position the texture
    // shows lon=+90 at, which after the latLonToVec3 fix is the -Z hemisphere.
    for (let lon = 0; lon < 360; lon += 30) {
      const points: THREE.Vector3[] = [];
      for (let lat = -90; lat <= 90; lat += 4) {
        const phi = THREE.MathUtils.degToRad(90 - lat);
        const t = THREE.MathUtils.degToRad(-lon);
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
  // Faint dots at N/S poles + 0°/90°E/180°/90°W meridians on the equator.
  // After the lat/lon fix, lon=+90 lands on the -Z axis (and lon=-90 on +Z),
  // matching where the Earth texture renders those meridians.
  const positions: { p: [number, number, number]; c: string }[] = [
    { p: [0, 1.05, 0], c: "#ffd66b" },     // N pole
    { p: [0, -1.05, 0], c: "#5cb5ff" },    // S pole
    { p: [1.05, 0, 0], c: "#5cb5ff" },     // 0°E
    { p: [-1.05, 0, 0], c: "#5cb5ff" },    // 180°
    { p: [0, 0, -1.05], c: "#5cb5ff" },    // 90°E (now at -Z)
    { p: [0, 0, 1.05], c: "#5cb5ff" }      // 90°W (now at +Z)
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

    // Emit camera state ~5/sec — half the React renders for the same
    // visible smoothness in the status bar / mini-map / sun-info widget.
    const now = performance.now();
    if (now - lastEmitRef.current > 200) {
      lastEmitRef.current = now;
      const pos = camera.position;
      const distance = pos.length();
      const altKm = distanceToAltKm(distance);
      const lat = THREE.MathUtils.radToDeg(Math.asin(pos.y / distance));
      const lon = -THREE.MathUtils.radToDeg(Math.atan2(pos.z, pos.x));
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
  // The Earth equirectangular textures (Blue Marble, GIBS daily, VIIRS, etc.)
  // use the standard convention: canvas-left = lon=-180°, canvas-right = +180°.
  // three.js's default sphereGeometry maps that texture so its +Z axis lands
  // at lon=-90°, not +90°. To make every marker layer (borders, pins, aircraft,
  // satellites, volcanoes, earthquakes, weather radar) line up with the visible
  // continent positions, we negate the longitude in the 3D mapping so:
  //   lat=0, lon=0   → +X
  //   lat=0, lon=+90 → -Z   (matches Earth-texture's +90° meridian)
  //   lat=0, lon=-90 → +Z   (matches Earth-texture's -90° meridian)
  const phi = THREE.MathUtils.degToRad(90 - lat);
  const theta = THREE.MathUtils.degToRad(-lon);
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
  // Solar declination via Spencer's approximation: -23.45° (winter solstice)
  // to +23.45° (summer solstice).
  const decl = 23.45 * Math.sin((360 / 365) * (dayOfYear - 81) * Math.PI / 180);
  const utcHours = now.getUTCHours() + now.getUTCMinutes() / 60 + now.getUTCSeconds() / 3600;
  // Subsolar longitude: at 12:00 UTC the sun is over Greenwich; it sweeps 15°/hr
  // westward. So subsolarLon = -(utcHours - 12) * 15. We want sunPosition() to
  // emit a 3D direction that equals latLonToVec3(decl, subsolarLon, dist) under
  // the negated-lon convention. Working backward through both formulas:
  //   az_norm = (utcHours - 12) / 24    (mod 1, then +1 to keep positive)
  // Verifies:
  //   12 UTC → 0     → +X (lon=0, Greenwich) ✓
  //   18 UTC → 0.25  → +Z (lon=-90, Americas at noon) ✓
  //    6 UTC → 0.75  → -Z (lon=+90, Asia at noon)     ✓
  //    0 UTC → 0.5   → -X (lon=180, Pacific at noon)  ✓
  // The previous formula was offset 270° from this, so the day/night terminator
  // never matched the actual UTC time — fixed now.
  const az = ((utcHours - 12) / 24 + 1) % 1;
  // Elevation: 0..1 → -90..+90 via sin((el-0.5)*π) in the sun shader.
  const el = 0.5 + decl / 180;
  return { az, el };
}

function pointToLatLon(point: THREE.Vector3): { lat: number; lon: number } {
  // Inverse of latLonToVec3 — keeps the negation consistent so that
  // pointToLatLon(latLonToVec3(lat, lon, r)) ≈ (lat, lon).
  const r = point.length();
  const lat = THREE.MathUtils.radToDeg(Math.asin(point.y / r));
  const lon = -THREE.MathUtils.radToDeg(Math.atan2(point.z, point.x));
  return { lat, lon };
}

export default App;

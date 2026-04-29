import { useEffect, useRef } from "react";
import * as Cesium from "cesium";
import "cesium/Build/Cesium/Widgets/widgets.css";
import { MAJOR_CITIES } from "./cities";
import { COUNTRY_CENTROIDS } from "./countries";
import { LANDMARKS } from "./landmarks";
import { AIRPORTS } from "./airports";

type FlyToTarget = { id: number; lat: number; lon: number; altKm: number };

export type SurfacePin = {
  id: string;
  lat: number;
  lon: number;
  label: string;
  color: string;
};

export type SurfaceAircraft = {
  icao24: string;
  callsign: string;
  lat: number;
  lon: number;
  altitudeM: number;
  headingDeg: number;
  // ADS-B squawk code. 7500 = hijack, 7600 = radio failure,
  // 7700 = general emergency. We tint these magenta/red and pulse
  // them so they stand out from normal traffic.
  squawk?: string;
  // Ground speed in m/s. Used for frame-by-frame interpolation
  // between polls — without it the planes jump every snapshot.
  velocityMs?: number;
  // Vertical rate in m/s (positive = climbing). Used to interpolate
  // altitude smoothly between polls. Optional; planes without this
  // hold altitude constant.
  verticalRateMs?: number;
};

export type SurfaceEonet = {
  id: string;
  title: string;
  lat: number;
  lon: number;
  category: string;          // EonetCategory string key
  color: string;             // hex
};

export type SurfaceEarthquake = {
  id: string;
  lat: number;
  lon: number;
  mag: number;
  depth: number;
  place: string;
  // Unix ms when the earthquake occurred. Used to pulse fresh quakes
  // (less than ~1h old) so the user can spot recent activity at a
  // glance without having to read magnitudes.
  timeUnixMs?: number;
};

export type SurfaceVolcano = {
  id: string;
  name: string;
  lat: number;
  lon: number;
  alertColor: string;        // computed display tint
  elevated: boolean;
};

export type SurfaceLaunch = {
  id: string;
  name: string;
  lat: number;
  lon: number;
  imminent: boolean;         // <1h
  soon: boolean;             // <24h
};

export type SurfaceStorm = {
  id: string;
  name: string;
  classification: string;
  intensityKph: number | null;
  lat: number;
  lon: number;
  movementDir: number | null;
};

export default function Surface({
  token,
  onCameraChange,
  onPickLocation,
  flyTo,
  pins,
  aircraft,
  realTimeSun,
  initialCamera,
  eonet,
  earthquakes,
  volcanoes,
  launches,
  weatherTilePath,
  weatherOpacity,
  show3DBuildings,
  selectedAircraft,
  selectedAircraftHistory,
  onSelectAircraft,
  imageryStyle,
  tiltCommand,
  terrainExaggeration,
  fogEnabled,
  manualUtcHour,
  screenshotCommand,
  onScreenshot,
  measurePoints,
  geoJson,
  followSelectedAircraft,
  showTerminator,
  enableGlobeLighting,
  issPosition,
  tiangongPosition,
  hubblePosition,
  storms,
  auroraKp,
  autoOrbit,
  aircraftAltitudeBars,
  bordersGeoJson,
  resetHeadingCommand,
  showLandmarks,
  showAirports
}: {
  token: string;
  onCameraChange: (lat: number, lon: number, altKm: number) => void;
  onPickLocation?: (lat: number, lon: number) => void;
  flyTo: FlyToTarget;
  pins?: SurfacePin[];
  aircraft?: SurfaceAircraft[];
  realTimeSun?: boolean;
  initialCamera?: { lat: number; lon: number; altKm: number };
  eonet?: SurfaceEonet[];
  earthquakes?: SurfaceEarthquake[];
  volcanoes?: SurfaceVolcano[];
  launches?: SurfaceLaunch[];
  weatherTilePath?: string;
  weatherOpacity?: number;
  show3DBuildings?: boolean;
  selectedAircraft?: { icao24: string; callsign?: string; lat: number; lon: number; altitudeM: number; headingDeg: number; velocityMs: number } | null;
  // Past polled positions of the selected aircraft (oldest → newest).
  selectedAircraftHistory?: Array<{ lat: number; lon: number; alt: number }>;
  onSelectAircraft?: (icao24: string | null) => void;
  // Base imagery: 'bing' = Bing Aerial (Cesium ion asset 2),
  // 'esri' = ESRI World Imagery (asset 3812), 'osm' = OpenStreetMap.
  imageryStyle?: "bing" | "esri" | "osm";
  tiltCommand?: { id: number; pitchDeg: number } | null;
  // Multiplies real terrain heights — 1 is normal, 2 doubles vertical
  // relief (mountains look twice as tall), 0.5 flattens.
  terrainExaggeration?: number;
  // Toggles Cesium's built-in atmospheric fog (gives distance haze).
  fogEnabled?: boolean;
  // Manual UTC hour-of-day for the Cesium clock (0..24). Only honored when
  // realTimeSun is false; ignored otherwise so the user can switch back to
  // real-time without restarting the viewer.
  manualUtcHour?: number;
  // Trigger a screenshot — Surface captures viewer.scene.canvas to a Blob
  // and emits via onScreenshot. Component handles requestRender first to
  // ensure the latest frame is in the buffer.
  screenshotCommand?: { id: number } | null;
  onScreenshot?: (blob: Blob, dataUrl: string) => void;
  // Live measurement: 1 or 2 points to render as visible polyline + endpoint dots.
  measurePoints?: Array<{ lat: number; lon: number }>;
  // GeoJSON FeatureCollection to render as Cesium entities (drag-drop import).
  geoJson?: any;
  // When true and selectedAircraft is set, the camera locks-on to the plane
  // (Cesium tracked-entity mode). Click "Stop following" or deselect to free.
  followSelectedAircraft?: boolean;
  // Renders a polyline along the day/night terminator that auto-updates
  // with the Cesium clock (real-time or manual hour). Used to visualize
  // the solar limb without baking it into the imagery shader.
  showTerminator?: boolean;
  // Override Cesium's globe.enableLighting (sun-driven shading on
  // imagery). Default behavior auto-degrades on mobile; setting this
  // explicitly lets the user override that.
  enableGlobeLighting?: boolean;
  // Live LEO satellite ground positions (polled in App.tsx). Each is
  // null when the layer is off OR the wheretheiss.at fetch hasn't
  // returned yet, so handle gracefully. Altitude is hard-coded to a
  // representative orbital height since the upstream feed only gives
  // lat/lon (it'd be ~3 lines to add altitude later if needed).
  issPosition?: { lat: number; lon: number } | null;
  tiangongPosition?: { lat: number; lon: number } | null;
  hubblePosition?: { lat: number; lon: number } | null;
  // Active tropical cyclones (NOAA NHC). Each renders as a spinning
  // hurricane glyph at the eye location, with a label below.
  storms?: SurfaceStorm[];
  // Aurora-oval polyline overlay. Pass NOAA SWPC's latest Kp index
  // (0..9 scale) — radius scales with magnetic activity. null hides
  // both ovals.
  auroraKp?: number | null;
  // When true, the Cesium camera auto-orbits the globe at the current
  // altitude. Implemented via scene.preRender to rotate the camera
  // about the local up axis each frame at ~1°/sec.
  autoOrbit?: boolean;
  // Bumping this id snaps Cesium camera heading back to true north,
  // preserving pitch + altitude. Used by the "Reset heading" Cmd+K.
  resetHeadingCommand?: { id: number } | null;
  // Pixel-tall vertical bars from sea-level to each aircraft, so
  // altitude is visible as a height cue in the 3D scene. Off by
  // default; cheap-ish (one polyline per aircraft, glow material).
  aircraftAltitudeBars?: boolean;
  // Country-borders GeoJSON FeatureCollection. Rendered as a thin
  // amber outline if the borders layer is on. Reuses the topojson
  // load that Atlas mode triggers, so it's free once Atlas has been
  // visited at least once.
  bordersGeoJson?: any | null;
  // Toggles the famous-landmark layer. Defaults to true; users can
  // hide it via Cmd+K when they want a clean view.
  showLandmarks?: boolean;
  // Toggles the major-airports layer (~80 hubs).
  showAirports?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Cesium.Viewer | null>(null);
  const lastFlyIdRef = useRef(0);
  // Pin entities and aircraft point-primitives so we can update them
  // efficiently without re-creating the world on every prop change.
  const pinEntitiesRef = useRef<Cesium.Entity[]>([]);
  const aircraftBillboardsRef = useRef<Cesium.BillboardCollection | null>(null);
  const aircraftIconRef = useRef<HTMLCanvasElement | null>(null);
  const aircraftBillboardIndexRef = useRef<Map<Cesium.Billboard, string>>(new Map());
  // icao24 → Billboard for incremental updates (avoid full BillboardCollection rebuild every snapshot).
  const aircraftBillboardByIcaoRef = useRef<Map<string, Cesium.Billboard>>(new Map());
  // Map icao24 → vertical polyline entity from sea-level to billboard.
  // Built only when aircraftAltitudeBars is on.
  const aircraftAltBarByIcaoRef = useRef<Map<string, Cesium.Entity>>(new Map());
  // Per-aircraft sample state captured at each poll. We project forward
  // every render frame using heading + velocity, so planes glide smoothly
  // instead of teleporting every 12-25s. Position units are radians.
  type AircraftSample = {
    latRad: number;
    lonRad: number;
    altM: number;
    headingRad: number;
    velocityMs: number;        // ground speed
    verticalMs: number;        // vertical rate (positive = climb)
    sampleTimeMs: number;      // when this snapshot was taken (performance.now())
  };
  const aircraftSampleByIcaoRef = useRef<Map<string, AircraftSample>>(new Map());
  const aircraftTrailEntityRef = useRef<Cesium.Entity | null>(null);
  const aircraftHistoryEntityRef = useRef<Cesium.Entity | null>(null);
  const aircraftSelectionRingRef = useRef<Cesium.Entity | null>(null);
  const aircraftFollowEntityRef = useRef<Cesium.Entity | null>(null);
  const aircraftCallsignLabelRef = useRef<Cesium.Entity | null>(null);
  // 3D selected-aircraft model. Three Cesium entities at the same
  // position with the same orientation: fuselage (long box along
  // heading), wings (flat box perpendicular), vertical tail
  // (thin tall box at rear). Far cheaper than a glTF model and zero
  // assets shipped. Position + orientation update each frame with
  // the interpolated billboard position.
  const aircraftModelEntitiesRef = useRef<Cesium.Entity[]>([]);
  const countryLabelsRef = useRef<Cesium.Entity[]>([]);
  const buildingsTilesetRef = useRef<Cesium.Cesium3DTileset | null>(null);
  const measureEntitiesRef = useRef<Cesium.Entity[]>([]);
  const geoJsonDataSourceRef = useRef<Cesium.GeoJsonDataSource | null>(null);
  const eonetEntitiesRef = useRef<Cesium.Entity[]>([]);
  const earthquakeEntitiesRef = useRef<Cesium.Entity[]>([]);
  const volcanoEntitiesRef = useRef<Cesium.Entity[]>([]);
  const launchEntitiesRef = useRef<Cesium.Entity[]>([]);
  const stormEntitiesRef = useRef<Cesium.Entity[]>([]);
  const auroraOvalEntitiesRef = useRef<Cesium.Entity[]>([]);
  const bordersDataSourceRef = useRef<Cesium.GeoJsonDataSource | null>(null);
  const landmarkEntitiesRef = useRef<Cesium.Entity[]>([]);
  const airportEntitiesRef = useRef<Cesium.Entity[]>([]);
  const weatherImageryLayerRef = useRef<Cesium.ImageryLayer | null>(null);
  // Latest weather opacity prop, mirrored to a ref so the camera-change
  // listener can read it without the listener being re-installed every
  // time the slider moves. Updated by an effect below.
  const weatherOpacityRef = useRef<number>(0.7);
  const terminatorEntityRef = useRef<Cesium.Entity | null>(null);
  const subsolarEntityRef = useRef<Cesium.Entity | null>(null);
  const issEntityRef = useRef<Cesium.Entity | null>(null);
  const tiangongEntityRef = useRef<Cesium.Entity | null>(null);
  const hubbleEntityRef = useRef<Cesium.Entity | null>(null);
  // Past positions buffer for each LEO sat — used to draw the visible
  // portion of the ground track behind the current spot. Limited to
  // ~90 min worth of polled samples (= ~1 orbit, since one LEO orbit
  // is 92 min).
  const issTrackPositionsRef = useRef<Array<{ lat: number; lon: number; t: number }>>([]);
  const tiangongTrackPositionsRef = useRef<Array<{ lat: number; lon: number; t: number }>>([]);
  const hubbleTrackPositionsRef = useRef<Array<{ lat: number; lon: number; t: number }>>([]);
  const issGroundTrackEntityRef = useRef<Cesium.Entity | null>(null);
  const tiangongGroundTrackEntityRef = useRef<Cesium.Entity | null>(null);
  const hubbleGroundTrackEntityRef = useRef<Cesium.Entity | null>(null);

  // Resolve env token if no prop token. Production deploys bake VITE_CESIUM_TOKEN.
  const env = (import.meta as any).env;
  const tokenToUse = token || env?.VITE_CESIUM_TOKEN || "";

  // ===== one-time viewer setup (re-fires only on token change) =====
  useEffect(() => {
    if (tokenToUse) Cesium.Ion.defaultAccessToken = tokenToUse;
    if (!containerRef.current) return;

    const viewer = new Cesium.Viewer(containerRef.current, {
      // Strip default Cesium chrome — we render our own UI overlay on top.
      animation: false,
      timeline: false,
      baseLayerPicker: false,
      fullscreenButton: false,
      geocoder: false,
      homeButton: false,
      navigationHelpButton: false,
      sceneModePicker: false,
      selectionIndicator: false,
      infoBox: false,
      requestRenderMode: true,
      maximumRenderTimeChange: Infinity,
      // Async base imagery — we'll swap in Cesium World Imagery (Bing Aerial)
      // below once the ion asset resolves. Until then there's a default plane.
      baseLayer: false,
    } as any);

    // ===== Mobile detection — degrade quality automatically =====
    // Phones (small touch screens, low-RAM, no real GPU) need lower MSAA,
    // no HDR, lower resolutionScale, and a more lenient SSE so the GPU
    // isn't asked to render a million sub-pixel terrain triangles.
    const ua = navigator.userAgent || "";
    const isMobile = /iphone|ipad|ipod|android/i.test(ua) || (window.matchMedia && window.matchMedia("(pointer: coarse)").matches);
    const lowMem = (navigator as any).deviceMemory && (navigator as any).deviceMemory <= 4;
    const isLow = isMobile || lowMem;

    // ===== Quality settings (mobile-aware) =====
    // resolutionScale: native pixel ratio on desktop, capped at 1.0 on phones
    // (rendering at 3× DPR on a phone tanks framerate).
    viewer.resolutionScale = isLow ? 1.0 : Math.min(window.devicePixelRatio || 1, 2);
    // FXAA on the main render — reduces "pixel-crawl" on terrain edges.
    // Skip FXAA on low devices (postprocess pass costs ~3-5ms/frame on phones).
    (viewer.scene as any).postProcessStages.fxaa.enabled = !isLow;
    // 4× MSAA where supported. Cesium >= 1.96 supports msaaSamples on Scene.
    // Disabled on mobile — MSAA forces a big GPU framebuffer alloc.
    if ("msaaSamples" in viewer.scene) {
      (viewer.scene as any).msaaSamples = isLow ? 1 : 4;
    }
    // HDR tone-mapping — desktop only. On mobile it's wasted GPU.
    if ("highDynamicRange" in viewer.scene) {
      (viewer.scene as any).highDynamicRange = !isLow;
    }
    // SSE: lower number = sharper terrain but more triangles. Bump up on mobile.
    viewer.scene.globe.maximumScreenSpaceError = isLow ? 3.0 : 1.5;
    // ===== Perf optimizations =====
    // Bigger terrain-tile cache so panning a recently-viewed area doesn't
    // re-fetch. Smaller on mobile to keep RAM in check.
    viewer.scene.globe.tileCacheSize = isLow ? 200 : 1000;
    // Skip tile rendering when the view hasn't changed — saves GPU cycles
    // when the camera is idle. Already on by viewer config, but reaffirm.
    viewer.scene.requestRenderMode = true;
    viewer.scene.maximumRenderTimeChange = Number.POSITIVE_INFINITY;
    // (Tried disabling orderIndependentTranslucency for perf, but in this
    // Cesium build it's a getter-only property — assigning it throws. Skip.)

    // ===== Atmosphere + lighting =====
    // enableLighting samples sun direction per pixel for the day/night
    // terminator. It's pretty but pricey on mobile GPUs — off there.
    viewer.scene.globe.enableLighting = !isLow;
    viewer.scene.fog.enabled = true;
    viewer.scene.fog.density = 0.0001;
    if (viewer.scene.skyAtmosphere) {
      viewer.scene.skyAtmosphere.show = true;
      viewer.scene.skyAtmosphere.hueShift = 0;
      viewer.scene.skyAtmosphere.brightnessShift = 0.05;
      viewer.scene.skyAtmosphere.saturationShift = 0.1;
    }
    // Cesium 1.121's SkyBox doesn't expose a 'show' setter (always on if assigned).
    if (viewer.scene.sun) viewer.scene.sun.show = true;
    if (viewer.scene.moon) viewer.scene.moon.show = true;

    // ===== Async asset loading: terrain + imagery + 3D buildings =====
    if (tokenToUse) {
      // Mobile: skip vertex normals (no shaded relief) and water mask (no
      // shimmer) to halve the per-tile payload. Visual loss is minor at the
      // mobile fillrate ceiling we're operating in.
      Cesium.createWorldTerrainAsync({
        requestVertexNormals: !isLow,
        requestWaterMask: !isLow,
      })
        .then((terrain) => { viewer.terrainProvider = terrain; })
        .catch(() => { /* fallback to ellipsoid */ });

      // Initial imagery is set by the imageryStyle effect below.

      // Cesium OSM Buildings — global 3D building footprints + heights.
      // Only request the tileset when the user actually wants it; on phones
      // we don't even *initiate* the network fetch unless they opt in,
      // which saves the initial ~5MB metadata round-trip alone.
      if (show3DBuildings) {
        Cesium.Cesium3DTileset.fromIonAssetId(96188)
          .then((tileset) => {
            viewer.scene.primitives.add(tileset);
            buildingsTilesetRef.current = tileset;
            tileset.show = true;
          })
          .catch(() => { /* OSM Buildings unavailable on this token tier */ });
      }
    }

    // Initial camera position: if Atlas handed us coordinates, fly there
    // immediately so the mode switch doesn't feel like a hard cut.
    if (initialCamera) {
      viewer.camera.setView({
        destination: Cesium.Cartesian3.fromDegrees(initialCamera.lon, initialCamera.lat, Math.max(500, initialCamera.altKm * 1000)),
        orientation: { heading: 0, pitch: -Cesium.Math.PI_OVER_TWO, roll: 0 },
      });
    }

    viewerRef.current = viewer;

    // ===== city labels (Cesium label entities for major metros) =====
    // Each label has a distance-display condition keyed to population so
    // megacities (>15M) show from far out and smaller ones only when zoomed.
    // Flag emoji from ISO code (regional indicator pair) gives visual hierarchy.
    const cityFlag = (code: string) => {
      const A = 0x41, RI = 0x1F1E6;
      if (code.length !== 2) return "";
      const c1 = code.charCodeAt(0) - A + RI;
      const c2 = code.charCodeAt(1) - A + RI;
      return String.fromCodePoint(c1, c2);
    };
    for (const c of MAJOR_CITIES) {
      // Population-based visibility — bigger cities visible from farther.
      // Tokyo/Delhi (37M, 33M): visible from 8000km+. Madrid/Toronto (~5M): need ~1500km.
      const popRatio = c.population / 1_000_000;        // millions
      const farKm = Math.min(8000, 800 + popRatio * 150);  // 800-8000km range
      const flag = cityFlag(c.country);
      viewer.entities.add({
        position: Cesium.Cartesian3.fromDegrees(c.lon, c.lat, 0),
        label: {
          text: flag ? `${flag} ${c.name}` : c.name,
          font: "11px Inter, sans-serif",
          fillColor: Cesium.Color.WHITE,
          outlineColor: Cesium.Color.fromCssColorString("rgba(0,0,0,0.85)"),
          outlineWidth: 3,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          pixelOffset: new Cesium.Cartesian2(0, -10),
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, farKm * 1000),
          translucencyByDistance: new Cesium.NearFarScalar(50_000, 1.0, farKm * 1000, 0.0),
        },
        point: {
          pixelSize: 4,
          color: Cesium.Color.fromCssColorString("rgba(255, 230, 130, 0.85)"),
          outlineColor: Cesium.Color.WHITE,
          outlineWidth: 1,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, farKm * 1000),
        },
      });
    }

    // ===== continent labels =====
    // Very-far-zoom labels — visible from 100,000km out (Mars-view).
    // Used as the visual entry-point at extreme zoom; fade out by the
    // time country labels start showing (~25,000km).
    const CONTINENTS = [
      { name: "NORTH AMERICA",  lat:  46,   lon: -100 },
      { name: "SOUTH AMERICA",  lat: -16,   lon:  -60 },
      { name: "EUROPE",         lat:  54,   lon:   15 },
      { name: "AFRICA",         lat:   2,   lon:   20 },
      { name: "ASIA",           lat:  46,   lon:   90 },
      { name: "OCEANIA",        lat: -26,   lon:  140 },
      { name: "ANTARCTICA",     lat: -82,   lon:    0 },
    ];
    for (const cn of CONTINENTS) {
      viewer.entities.add({
        position: Cesium.Cartesian3.fromDegrees(cn.lon, cn.lat, 0),
        label: {
          text: cn.name,
          font: "800 16px Inter, sans-serif",
          fillColor: Cesium.Color.fromCssColorString("rgba(255, 230, 195, 0.85)"),
          outlineColor: Cesium.Color.fromCssColorString("rgba(0,0,0,0.95)"),
          outlineWidth: 5,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          verticalOrigin: Cesium.VerticalOrigin.CENTER,
          horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          // Visible from 25,000km..200,000km — pure long-range hierarchy.
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(25_000_000, 200_000_000),
          translucencyByDistance: new Cesium.NearFarScalar(20_000_000, 0.0, 30_000_000, 1.0),
        },
      });
    }

    // ===== country centroid labels =====
    // Tier 1 (huge nations) show from very far out (orbital view).
    // Tier 2 nations only appear once camera < ~6000km altitude.
    // All country labels fade out as you zoom *into* a country, so cities
    // take over without visual clutter. Each label gets the country's
    // flag emoji built from the ISO 3166-1 alpha-2 code (regional
    // indicator pair). Antarctica (AQ) and Greenland (GL) fall back to
    // "🏳️" since they don't have widely-supported flag glyphs.
    const codeToFlag = (code: string) => {
      // AQ = Antarctica (no flag), reserve for special cases below.
      if (code === "AQ") return "🏳️";
      const A = 0x41;
      const RI_BASE = 0x1F1E6;       // 🇦
      const c1 = code.charCodeAt(0) - A + RI_BASE;
      const c2 = code.charCodeAt(1) - A + RI_BASE;
      return String.fromCodePoint(c1, c2);
    };
    for (const country of COUNTRY_CENTROIDS) {
      const farKm = country.tier === 1 ? 25_000 : 6_000;
      const nearKm = 350;            // fade out below ~350km altitude
      const flag = codeToFlag(country.code);
      const labelText = `${flag} ${country.name.toUpperCase()}`;
      const entity = viewer.entities.add({
        position: Cesium.Cartesian3.fromDegrees(country.lon, country.lat, 0),
        // id used by the click handler to detect a country click and fly to it.
        id: `country-${country.code}`,
        properties: { isCountry: true, countryCode: country.code, countryLat: country.lat, countryLon: country.lon },
        label: {
          text: labelText,
          font: country.tier === 1 ? "700 14px Inter, sans-serif" : "600 11px Inter, sans-serif",
          fillColor: Cesium.Color.fromCssColorString(country.tier === 1 ? "rgba(245, 220, 180, 0.95)" : "rgba(220, 220, 235, 0.85)"),
          outlineColor: Cesium.Color.fromCssColorString("rgba(0,0,0,0.95)"),
          outlineWidth: 4,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          verticalOrigin: Cesium.VerticalOrigin.CENTER,
          horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(nearKm * 1000, farKm * 1000),
          translucencyByDistance: new Cesium.NearFarScalar(nearKm * 1000, 0.0, (nearKm + 600) * 1000, 1.0),
        },
      });
      countryLabelsRef.current.push(entity);
    }

    // ===== aircraft billboards =====
    // Build a top-down airliner silhouette canvas once, share across all
    // billboards. Rotation per-instance comes from each aircraft's heading.
    const SIZE = 64;
    const c = document.createElement("canvas");
    c.width = SIZE;
    c.height = SIZE;
    const ctx2 = c.getContext("2d");
    if (ctx2) {
      ctx2.fillStyle = "#ffffff";
      ctx2.shadowColor = "rgba(0,0,0,0.7)";
      ctx2.shadowBlur = 3;
      const cx = SIZE / 2;
      const cy = SIZE / 2;
      // Fuselage
      ctx2.beginPath();
      ctx2.ellipse(cx, cy, 3.5, 24, 0, 0, Math.PI * 2);
      ctx2.fill();
      // Main wings (swept)
      ctx2.beginPath();
      ctx2.moveTo(cx - 26, cy + 7);
      ctx2.lineTo(cx - 2.5, cy - 2);
      ctx2.lineTo(cx + 2.5, cy - 2);
      ctx2.lineTo(cx + 26, cy + 7);
      ctx2.lineTo(cx + 3, cy + 6);
      ctx2.lineTo(cx - 3, cy + 6);
      ctx2.closePath();
      ctx2.fill();
      // Tail stabilizers
      ctx2.beginPath();
      ctx2.moveTo(cx - 11, cy + 19);
      ctx2.lineTo(cx - 2, cy + 15);
      ctx2.lineTo(cx + 2, cy + 15);
      ctx2.lineTo(cx + 11, cy + 19);
      ctx2.lineTo(cx + 2, cy + 21);
      ctx2.lineTo(cx - 2, cy + 21);
      ctx2.closePath();
      ctx2.fill();
      // Nose taper
      ctx2.beginPath();
      ctx2.moveTo(cx - 3, cy - 18);
      ctx2.lineTo(cx, cy - 25);
      ctx2.lineTo(cx + 3, cy - 18);
      ctx2.closePath();
      ctx2.fill();
    }
    aircraftIconRef.current = c;

    aircraftBillboardsRef.current = new Cesium.BillboardCollection({ scene: viewer.scene });
    viewer.scene.primitives.add(aircraftBillboardsRef.current);

    // ===== camera-change emit (status bar lat/lon/alt) =====
    // Mobile: emit at 5% screen movement (was 1%) so we're not React-
    // re-rendering for every pixel of pan. Status bar still updates ~10-20×
    // per pan which is way more than the eye tracks.
    const removeListener = viewer.camera.changed.addEventListener(() => {
      const cartographic = viewer.camera.positionCartographic;
      const lat = Cesium.Math.toDegrees(cartographic.latitude);
      const lon = Cesium.Math.toDegrees(cartographic.longitude);
      const altKm = cartographic.height / 1000;
      onCameraChange(lat, lon, altKm);
      // Auto-hide the weather radar layer when zoomed in close. RainViewer's
      // tile pyramid maxes out around level 5, and below ~80km altitude
      // Cesium upscales those tiles enough that they tile the whole screen
      // with a uniform tan haze. Fade the layer out under that threshold.
      const radarLayer = weatherImageryLayerRef.current;
      if (radarLayer) {
        const baseAlpha = (weatherOpacityRef.current ?? 0.7);
        if (altKm < 80) radarLayer.alpha = 0;
        else if (altKm < 200) radarLayer.alpha = baseAlpha * ((altKm - 80) / 120);
        else radarLayer.alpha = baseAlpha;
      }
    });
    viewer.camera.percentageChanged = isLow ? 0.05 : 0.01;

    // ===== left-click → emit lat/lon =====
    const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    handler.setInputAction((click: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
      // Pick on the actual terrain surface, not the ellipsoid — gives the
      // correct point under the cursor even when zoomed into mountains.
      const ray = viewer.camera.getPickRay(click.position);
      let cartesian: Cesium.Cartesian3 | undefined;
      if (ray) cartesian = viewer.scene.globe.pick(ray, viewer.scene) ?? undefined;
      if (!cartesian) cartesian = viewer.camera.pickEllipsoid(click.position) ?? undefined;
      if (!cartesian) return;
      const cartographic = Cesium.Cartographic.fromCartesian(cartesian);
      const lat = Cesium.Math.toDegrees(cartographic.latitude);
      const lon = Cesium.Math.toDegrees(cartographic.longitude);
      onPickLocation?.(lat, lon);
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

    return () => {
      removeListener?.();
      handler.destroy();
      pinEntitiesRef.current.forEach((e) => viewer.entities.remove(e));
      eonetEntitiesRef.current.forEach((e) => viewer.entities.remove(e));
      earthquakeEntitiesRef.current.forEach((e) => viewer.entities.remove(e));
      volcanoEntitiesRef.current.forEach((e) => viewer.entities.remove(e));
      launchEntitiesRef.current.forEach((e) => viewer.entities.remove(e));
      stormEntitiesRef.current.forEach((e) => viewer.entities.remove(e));
      stormEntitiesRef.current = [];
      auroraOvalEntitiesRef.current.forEach((e) => viewer.entities.remove(e));
      auroraOvalEntitiesRef.current = [];
      if (bordersDataSourceRef.current) {
        viewer.dataSources.remove(bordersDataSourceRef.current, true);
        bordersDataSourceRef.current = null;
      }
      for (const ref of [issGroundTrackEntityRef, tiangongGroundTrackEntityRef, hubbleGroundTrackEntityRef]) {
        if (ref.current) {
          viewer.entities.remove(ref.current);
          ref.current = null;
        }
      }
      countryLabelsRef.current.forEach((e) => viewer.entities.remove(e));
      countryLabelsRef.current = [];
      if (aircraftCallsignLabelRef.current) viewer.entities.remove(aircraftCallsignLabelRef.current);
      aircraftCallsignLabelRef.current = null;
      if (aircraftFollowEntityRef.current) viewer.entities.remove(aircraftFollowEntityRef.current);
      aircraftFollowEntityRef.current = null;
      pinEntitiesRef.current = [];
      eonetEntitiesRef.current = [];
      earthquakeEntitiesRef.current = [];
      volcanoEntitiesRef.current = [];
      launchEntitiesRef.current = [];
      aircraftBillboardsRef.current?.removeAll();
      if (aircraftHistoryEntityRef.current) viewer.entities.remove(aircraftHistoryEntityRef.current);
      if (aircraftTrailEntityRef.current) viewer.entities.remove(aircraftTrailEntityRef.current);
      if (aircraftSelectionRingRef.current) viewer.entities.remove(aircraftSelectionRingRef.current);
      for (const e of measureEntitiesRef.current) viewer.entities.remove(e);
      measureEntitiesRef.current = [];
      if (geoJsonDataSourceRef.current) {
        viewer.dataSources.remove(geoJsonDataSourceRef.current, true);
        geoJsonDataSourceRef.current = null;
      }
      aircraftHistoryEntityRef.current = null;
      aircraftTrailEntityRef.current = null;
      if (weatherImageryLayerRef.current) {
        viewer.imageryLayers.remove(weatherImageryLayerRef.current, true);
        weatherImageryLayerRef.current = null;
      }
      viewer.destroy();
      viewerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tokenToUse]);

  // ===== Base imagery picker =====
  // Replace the base layer when imageryStyle changes. Weather radar (if
  // enabled) is added as a separate layer above, so swapping the base
  // doesn't disturb it — but we re-add radar after to keep it on top.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    const style = imageryStyle || "bing";
    const apply = async () => {
      try {
        let provider: Cesium.ImageryProvider;
        if (style === "osm") {
          provider = new Cesium.OpenStreetMapImageryProvider({ url: "https://tile.openstreetmap.org/" });
        } else if (style === "esri") {
          provider = await Cesium.IonImageryProvider.fromAssetId(3812);
        } else {
          provider = await Cesium.IonImageryProvider.fromAssetId(2);
        }
        // Remove all existing imagery, add the new base.
        const radarLayer = weatherImageryLayerRef.current;
        viewer.imageryLayers.removeAll(false);
        viewer.imageryLayers.addImageryProvider(provider);
        // Re-attach the weather radar layer if it was active so it stays
        // on top of the new base.
        if (radarLayer) {
          // The radar provider stays valid; just re-add it on top.
          viewer.imageryLayers.add(radarLayer);
        }
      } catch {
        // Fall back to OSM
        const osm = new Cesium.OpenStreetMapImageryProvider({ url: "https://tile.openstreetmap.org/" });
        viewer.imageryLayers.removeAll(false);
        viewer.imageryLayers.addImageryProvider(osm);
      }
    };
    apply();
  }, [imageryStyle]);

  // ===== 3D Buildings toggle (lazy-load) =====
  // First time user enables buildings, we initiate the tileset fetch.
  // Subsequent toggles just flip .show on the loaded tileset.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    const want = show3DBuildings !== false;
    const tileset = buildingsTilesetRef.current;
    if (tileset) {
      tileset.show = want;
      return;
    }
    if (!want) return;            // not loaded, not wanted — no-op
    Cesium.Cesium3DTileset.fromIonAssetId(96188)
      .then((ts) => {
        // Guard against the user toggling off before the network resolves.
        if (!viewerRef.current) return;
        viewer.scene.primitives.add(ts);
        buildingsTilesetRef.current = ts;
        ts.show = true;
      })
      .catch(() => { /* OSM Buildings unavailable on this token tier */ });
  }, [show3DBuildings]);

  // ===== Measure-tool overlay =====
  // When the App's measure mode collects 1 or 2 points, render them as
  // dot entities + (if 2) a polyline between with the great-circle distance
  // as a center label.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    for (const e of measureEntitiesRef.current) viewer.entities.remove(e);
    measureEntitiesRef.current = [];
    if (!measurePoints || measurePoints.length === 0) return;
    // Endpoint dots
    for (const p of measurePoints) {
      const dot = viewer.entities.add({
        position: Cesium.Cartesian3.fromDegrees(p.lon, p.lat),
        point: {
          pixelSize: 10,
          color: Cesium.Color.fromCssColorString("#ffd66b"),
          outlineColor: Cesium.Color.WHITE,
          outlineWidth: 2,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });
      measureEntitiesRef.current.push(dot);
    }
    // Connecting line + distance label
    if (measurePoints.length === 2) {
      const a = measurePoints[0];
      const b = measurePoints[1];
      // Great-circle distance via haversine.
      const R = 6371;
      const dLat = (b.lat - a.lat) * Math.PI / 180;
      const dLon = (b.lon - a.lon) * Math.PI / 180;
      const lat1 = a.lat * Math.PI / 180;
      const lat2 = b.lat * Math.PI / 180;
      const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
      const dist = 2 * R * Math.asin(Math.sqrt(h));
      const line = viewer.entities.add({
        polyline: {
          positions: [
            Cesium.Cartesian3.fromDegrees(a.lon, a.lat),
            Cesium.Cartesian3.fromDegrees(b.lon, b.lat),
          ],
          width: 3,
          arcType: Cesium.ArcType.GEODESIC,
          material: new Cesium.PolylineDashMaterialProperty({
            color: Cesium.Color.fromCssColorString("#ffd66b"),
            dashLength: 16,
          }),
          clampToGround: true,
        },
      });
      measureEntitiesRef.current.push(line);
      // Mid-arc label with distance.
      const midLat = (a.lat + b.lat) / 2;
      const midLon = (a.lon + b.lon) / 2;
      const label = viewer.entities.add({
        position: Cesium.Cartesian3.fromDegrees(midLon, midLat),
        label: {
          text: `${dist.toLocaleString(undefined, { maximumFractionDigits: 0 })} km`,
          font: "12px ui-monospace, monospace",
          fillColor: Cesium.Color.fromCssColorString("#ffd66b"),
          outlineColor: Cesium.Color.fromCssColorString("rgba(0,0,0,0.85)"),
          outlineWidth: 4,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          verticalOrigin: Cesium.VerticalOrigin.CENTER,
          horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
          showBackground: true,
          backgroundColor: Cesium.Color.fromCssColorString("rgba(8,14,26,0.92)"),
          backgroundPadding: new Cesium.Cartesian2(8, 4),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });
      measureEntitiesRef.current.push(label);
    }
  }, [measurePoints]);

  // ===== GeoJSON sync =====
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    if (geoJsonDataSourceRef.current) {
      viewer.dataSources.remove(geoJsonDataSourceRef.current, true);
      geoJsonDataSourceRef.current = null;
    }
    if (!geoJson) return;
    Cesium.GeoJsonDataSource.load(geoJson, {
      stroke: Cesium.Color.fromCssColorString("#5cb5ff"),
      fill: Cesium.Color.fromCssColorString("#5cb5ff").withAlpha(0.15),
      strokeWidth: 2,
      clampToGround: true,
    }).then((ds) => {
      viewer.dataSources.add(ds);
      geoJsonDataSourceRef.current = ds;
      viewer.scene.requestRender();
    }).catch(() => { /* malformed GeoJSON — silent */ });
  }, [geoJson]);

  // ===== Selected-aircraft pulse ring =====
  // A separate entity layered on top of the billboard. CallbackProperty
  // returns a pixelSize that breathes 16..28 with time, giving a visible
  // 'this plane is selected' affordance over Cesium's flat billboard.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    if (aircraftSelectionRingRef.current) {
      viewer.entities.remove(aircraftSelectionRingRef.current);
      aircraftSelectionRingRef.current = null;
    }
    if (!selectedAircraft) return;
    const startMs = Date.now();
    aircraftSelectionRingRef.current = viewer.entities.add({
      position: Cesium.Cartesian3.fromDegrees(selectedAircraft.lon, selectedAircraft.lat, Math.max(0, selectedAircraft.altitudeM)),
      point: {
        pixelSize: new Cesium.CallbackProperty(() => {
          const t = (Date.now() - startMs) / 1000;
          return 16 + 12 * (0.5 + 0.5 * Math.sin(t * 3));
        }, false),
        color: Cesium.Color.fromCssColorString("#5cb5ff").withAlpha(0),
        outlineColor: Cesium.Color.fromCssColorString("#5cb5ff").withAlpha(0.85),
        outlineWidth: 2,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });
    return () => {
      if (aircraftSelectionRingRef.current) {
        viewer.entities.remove(aircraftSelectionRingRef.current);
        aircraftSelectionRingRef.current = null;
      }
    };
  }, [selectedAircraft]);

  // ===== Solar terminator polyline =====
  // Computes the day/night great-circle live each frame. Subsolar
  // point is derived from the Cesium clock so manual UTC-hour overrides
  // work too. Uses CallbackProperty on positions so we don't need our
  // own RAF loop — Cesium's render-on-demand picks it up automatically.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    if (terminatorEntityRef.current) {
      viewer.entities.remove(terminatorEntityRef.current);
      terminatorEntityRef.current = null;
    }
    if (subsolarEntityRef.current) {
      viewer.entities.remove(subsolarEntityRef.current);
      subsolarEntityRef.current = null;
    }
    if (!showTerminator) return;

    // Position generator — recomputed every render. Cheap enough (180
    // sin/cos calls per frame) that we don't bother memoizing.
    const computePositions = () => {
      // Pull current time from the Cesium clock (works for both real-time
      // and manual-UTC modes since we sync clock.currentTime in that effect).
      const jd = viewer.clock.currentTime;
      const date = Cesium.JulianDate.toDate(jd);
      // Day-of-year for axial tilt approximation.
      const start = Date.UTC(date.getUTCFullYear(), 0, 0);
      const diff = (date.getTime() - start);
      const doy = Math.floor(diff / 86400000);
      // Solar declination (deg): 23.45° × sin(360°/365 × (doy − 81))
      const declRad = 23.45 * Math.PI / 180 * Math.sin(2 * Math.PI / 365 * (doy - 81));
      // Subsolar longitude: -((UTC hours - 12) × 15°)
      const utcHours = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
      const subsolarLonDeg = -((utcHours - 12) * 15);
      const subsolarLonRad = subsolarLonDeg * Math.PI / 180;
      // Walk the terminator great circle: parameterize by an angle θ ∈ [0,2π].
      // Standard formula: terminator at solar longitude L is the great
      // circle perpendicular to the subsolar direction, parameterized by:
      //   lat(θ) = asin(cos(decl) sin(θ))
      //   lon(θ) = subsolarLon + atan2(-sin(decl) sin(θ), cos(θ)) ± π/2
      // We use the simpler equivalent: walk θ from 0..2π, build a unit
      // vector perpendicular to the subsolar direction, convert to lat/lon.
      const positions: Cesium.Cartesian3[] = [];
      const subX = Math.cos(declRad) * Math.cos(subsolarLonRad);
      const subY = Math.cos(declRad) * Math.sin(subsolarLonRad);
      const subZ = Math.sin(declRad);
      // East and north tangent vectors at the subsolar point.
      const eastX = -Math.sin(subsolarLonRad);
      const eastY =  Math.cos(subsolarLonRad);
      const eastZ = 0;
      const northX = -Math.sin(declRad) * Math.cos(subsolarLonRad);
      const northY = -Math.sin(declRad) * Math.sin(subsolarLonRad);
      const northZ =  Math.cos(declRad);
      const STEPS = 180;
      for (let i = 0; i <= STEPS; i++) {
        const t = (i / STEPS) * 2 * Math.PI;
        // Point on the great circle 90° from subsolar — combine east and
        // north tangents weighted by cos/sin θ.
        const x = eastX * Math.cos(t) + northX * Math.sin(t);
        const y = eastY * Math.cos(t) + northY * Math.sin(t);
        const z = eastZ * Math.cos(t) + northZ * Math.sin(t);
        const lat = Math.asin(z) * 180 / Math.PI;
        const lon = Math.atan2(y, x) * 180 / Math.PI;
        positions.push(Cesium.Cartesian3.fromDegrees(lon, lat, 0));
      }
      // Suppress unused-var warning for subX/subY/subZ — declared for
      // clarity even if not directly used in the position formula.
      void subX; void subY; void subZ;
      return positions;
    };

    terminatorEntityRef.current = viewer.entities.add({
      polyline: {
        positions: new Cesium.CallbackProperty(computePositions, false),
        width: 2,
        material: new Cesium.PolylineDashMaterialProperty({
          color: Cesium.Color.fromCssColorString("#ffd66b").withAlpha(0.85),
          dashLength: 18,
        }),
        clampToGround: true,
      },
    });

    // Subsolar point — the spot on Earth where the sun is directly
    // overhead at this instant. Same math as the terminator, just the
    // single (subsolarLon, declRad) point. Emoji label gives it instant
    // visual identity.
    const computeSubsolar = () => {
      const jd = viewer.clock.currentTime;
      const date = Cesium.JulianDate.toDate(jd);
      const start = Date.UTC(date.getUTCFullYear(), 0, 0);
      const doy = Math.floor((date.getTime() - start) / 86400000);
      const declDeg = 23.45 * Math.sin(2 * Math.PI / 365 * (doy - 81));
      const utcHours = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
      const subsolarLonDeg = -((utcHours - 12) * 15);
      return Cesium.Cartesian3.fromDegrees(subsolarLonDeg, declDeg, 0);
    };
    subsolarEntityRef.current = viewer.entities.add({
      position: new Cesium.CallbackProperty(computeSubsolar, false) as any,
      label: {
        text: "☀",
        font: "700 22px sans-serif",
        fillColor: Cesium.Color.fromCssColorString("#ffd66b"),
        outlineColor: Cesium.Color.fromCssColorString("rgba(0,0,0,0.95)"),
        outlineWidth: 5,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        verticalOrigin: Cesium.VerticalOrigin.CENTER,
        horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      point: {
        pixelSize: 8,
        color: Cesium.Color.fromCssColorString("#ffd66b"),
        outlineColor: Cesium.Color.WHITE,
        outlineWidth: 1,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });

    // requestRenderMode means Cesium only redraws when something marks
    // the scene dirty. The CallbackProperty needs us to nudge it — we
    // force a redraw every 60s, which advances the terminator ~0.25°
    // per step (smooth enough at any reasonable zoom level).
    const tickHandle = window.setInterval(() => {
      viewer.scene.requestRender();
    }, 60_000);

    return () => {
      window.clearInterval(tickHandle);
      if (terminatorEntityRef.current) {
        viewer.entities.remove(terminatorEntityRef.current);
        terminatorEntityRef.current = null;
      }
      if (subsolarEntityRef.current) {
        viewer.entities.remove(subsolarEntityRef.current);
        subsolarEntityRef.current = null;
      }
    };
  }, [showTerminator]);

  // ===== LEO satellite ground tracks (ISS / Tiangong / Hubble) =====
  // Each polled position is appended to a ring buffer; older than 90 min
  // (≈ one orbit) are dropped. Render the buffer as a glowing polyline
  // clamped to the globe surface.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    type Track = {
      pos: { lat: number; lon: number } | null | undefined;
      buf: React.MutableRefObject<Array<{ lat: number; lon: number; t: number }>>;
      entity: React.MutableRefObject<Cesium.Entity | null>;
      color: string;
    };
    const tracks: Track[] = [
      { pos: issPosition,      buf: issTrackPositionsRef,      entity: issGroundTrackEntityRef,      color: "#7cffb1" },
      { pos: tiangongPosition, buf: tiangongTrackPositionsRef, entity: tiangongGroundTrackEntityRef, color: "#ffd66b" },
      { pos: hubblePosition,   buf: hubbleTrackPositionsRef,   entity: hubbleGroundTrackEntityRef,   color: "#5cb5ff" },
    ];
    const now = Date.now();
    const cutoff = now - 90 * 60 * 1000;
    for (const t of tracks) {
      if (!t.pos) {
        if (t.entity.current) {
          viewer.entities.remove(t.entity.current);
          t.entity.current = null;
        }
        t.buf.current = [];
        continue;
      }
      const buf = t.buf.current;
      const last = buf[buf.length - 1];
      if (!last || last.lat !== t.pos.lat || last.lon !== t.pos.lon) {
        buf.push({ lat: t.pos.lat, lon: t.pos.lon, t: now });
      }
      while (buf.length > 0 && buf[0].t < cutoff) buf.shift();
      if (t.entity.current) viewer.entities.remove(t.entity.current);
      if (buf.length < 2) {
        t.entity.current = null;
        continue;
      }
      const positions = buf.map((p) => Cesium.Cartesian3.fromDegrees(p.lon, p.lat, 0));
      t.entity.current = viewer.entities.add({
        polyline: {
          positions,
          width: 2,
          material: new Cesium.PolylineGlowMaterialProperty({
            color: Cesium.Color.fromCssColorString(t.color).withAlpha(0.55),
            glowPower: 0.25,
          }),
          clampToGround: true,
        },
      });
    }
  }, [issPosition, tiangongPosition, hubblePosition]);

  // ===== Live LEO satellite markers (ISS / Tiangong / Hubble) =====
  // Reuses the polled positions from App.tsx. Each satellite is a
  // billboard-and-label entity at a fixed orbital altitude — orbit
  // altitudes vary in reality but at the camera distances Surface mode
  // supports, the visual difference is sub-pixel.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    type SatRender = {
      pos: { lat: number; lon: number } | null | undefined;
      ref: React.MutableRefObject<Cesium.Entity | null>;
      name: string;
      color: string;
      icon: string;
      altKm: number;
    };
    const sats: SatRender[] = [
      { pos: issPosition,      ref: issEntityRef,      name: "ISS",      color: "#7cffb1", icon: "🛰", altKm: 408 },
      { pos: tiangongPosition, ref: tiangongEntityRef, name: "Tiangong", color: "#ffd66b", icon: "🛰", altKm: 380 },
      { pos: hubblePosition,   ref: hubbleEntityRef,   name: "Hubble",   color: "#5cb5ff", icon: "🔭", altKm: 540 },
    ];
    for (const s of sats) {
      // Tear down old.
      if (s.ref.current) {
        viewer.entities.remove(s.ref.current);
        s.ref.current = null;
      }
      if (!s.pos) continue;
      s.ref.current = viewer.entities.add({
        position: Cesium.Cartesian3.fromDegrees(s.pos.lon, s.pos.lat, s.altKm * 1000),
        label: {
          text: `${s.icon} ${s.name}`,
          font: "600 12px Inter, sans-serif",
          fillColor: Cesium.Color.fromCssColorString(s.color),
          outlineColor: Cesium.Color.fromCssColorString("rgba(0,0,0,0.95)"),
          outlineWidth: 4,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
          pixelOffset: new Cesium.Cartesian2(0, -14),
          showBackground: true,
          backgroundColor: Cesium.Color.fromCssColorString("rgba(8, 14, 26, 0.92)"),
          backgroundPadding: new Cesium.Cartesian2(8, 4),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        point: {
          pixelSize: 12,
          color: Cesium.Color.fromCssColorString(s.color),
          outlineColor: Cesium.Color.WHITE,
          outlineWidth: 2,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });
    }
    return () => {
      for (const s of sats) {
        if (s.ref.current) {
          viewer.entities.remove(s.ref.current);
          s.ref.current = null;
        }
      }
    };
  }, [issPosition, tiangongPosition, hubblePosition]);

  // ===== Selected-aircraft 3D model =====
  // Builds a 3D plane shape at the selected aircraft's position by
  // composing three Cesium box entities (fuselage, wings, vertical
  // tail) that all share an orientation derived from the aircraft's
  // heading via headingPitchRollQuaternion. Sized to be visible from
  // about 50km away — at orbital view it'd disappear into the
  // billboard layer underneath, which is fine.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    // Tear down any prior model.
    for (const e of aircraftModelEntitiesRef.current) viewer.entities.remove(e);
    aircraftModelEntitiesRef.current = [];
    if (!selectedAircraft) return;

    // Body-frame box dimensions in meters: (X=length, Y=wingspan, Z=height).
    // After headingPitchRollQuaternion, X aligns with the heading
    // direction so the long fuselage axis points where the plane is going.
    // Sized roughly proportional to a 737 (~38m long, ~35m wingspan).
    const fuselageDims  = new Cesium.Cartesian3(40, 5, 5);
    const wingsDims     = new Cesium.Cartesian3(8, 36, 1.5);
    const tailDims      = new Cesium.Cartesian3(8, 1.5, 6);

    const tint = Cesium.Color.fromCssColorString("#5cb5ff").withAlpha(0.95);
    const tintWings = Cesium.Color.fromCssColorString("#a4d8ff").withAlpha(0.95);

    // Initial position + orientation. The interpolation loop below
    // (extended in this effect's dep) updates these each frame.
    const initialPos = Cesium.Cartesian3.fromDegrees(
      selectedAircraft.lon,
      selectedAircraft.lat,
      Math.max(0, selectedAircraft.altitudeM)
    );
    const hpr0 = new Cesium.HeadingPitchRoll(
      (selectedAircraft.headingDeg || 0) * Math.PI / 180,
      0,
      0
    );
    const initialOrient = Cesium.Transforms.headingPitchRollQuaternion(initialPos, hpr0);

    // Three boxes at the same position. Cesium clones the position
    // value, so each entity holds its own; we'll overwrite all three
    // each interpolation tick.
    const fuselage = viewer.entities.add({
      position: initialPos,
      orientation: initialOrient,
      box: {
        dimensions: fuselageDims,
        material: tint,
        outline: false,
      },
    });
    const wings = viewer.entities.add({
      position: initialPos,
      orientation: initialOrient,
      box: {
        dimensions: wingsDims,
        material: tintWings,
        outline: false,
      },
    });
    const tail = viewer.entities.add({
      position: initialPos,
      orientation: initialOrient,
      box: {
        dimensions: tailDims,
        material: tint,
        outline: false,
      },
    });
    aircraftModelEntitiesRef.current = [fuselage, wings, tail];
  }, [selectedAircraft]);

  // ===== Selected-aircraft callsign label (DOM-overlay style billboard label) =====
  // Floats just above the billboard with the callsign and altitude. Uses an
  // entity label clamped to the aircraft's altitude (not the ground), so it
  // tracks the plane as it moves. Updated on every selectedAircraft change
  // — a position CallbackProperty would be smoother but the prop already
  // refreshes ~every poll cycle so a static position is fine for now.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    if (aircraftCallsignLabelRef.current) {
      viewer.entities.remove(aircraftCallsignLabelRef.current);
      aircraftCallsignLabelRef.current = null;
    }
    if (!selectedAircraft) return;
    const callsign = (selectedAircraft.callsign || selectedAircraft.icao24).trim().toUpperCase();
    const altFt = Math.round(selectedAircraft.altitudeM / 0.3048).toLocaleString();
    aircraftCallsignLabelRef.current = viewer.entities.add({
      position: Cesium.Cartesian3.fromDegrees(
        selectedAircraft.lon,
        selectedAircraft.lat,
        Math.max(0, selectedAircraft.altitudeM)
      ),
      label: {
        text: `${callsign}\n${altFt} ft`,
        font: "600 11px Inter, sans-serif",
        fillColor: Cesium.Color.fromCssColorString("#5cb5ff"),
        outlineColor: Cesium.Color.fromCssColorString("rgba(0,0,0,0.92)"),
        outlineWidth: 4,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
        pixelOffset: new Cesium.Cartesian2(0, -28),
        showBackground: true,
        backgroundColor: Cesium.Color.fromCssColorString("rgba(8, 14, 26, 0.92)"),
        backgroundPadding: new Cesium.Cartesian2(8, 4),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });
  }, [selectedAircraft]);

  // ===== Camera-follow selected aircraft =====
  // Creates a phantom entity whose position is wired to a CallbackProperty
  // that returns the latest selectedAircraft cartesian. Cesium's tracked-
  // entity machinery then keeps the camera locked-on as the prop updates.
  // This avoids manually nudging the camera each frame and gives the proper
  // "Google Earth follow" feel — orbit / zoom still work around the plane.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;

    // Tear down any prior follow setup.
    const tearDown = () => {
      viewer.trackedEntity = undefined;
      if (aircraftFollowEntityRef.current) {
        viewer.entities.remove(aircraftFollowEntityRef.current);
        aircraftFollowEntityRef.current = null;
      }
    };

    if (!followSelectedAircraft || !selectedAircraft) {
      tearDown();
      return;
    }

    // The CallbackProperty resolves at every tick — we re-read the *latest*
    // value of selectedAircraft via a ref-style closure. Since we re-run this
    // effect when selectedAircraft changes, the closure stays current enough
    // for sub-second tracking. Position resolves to lat/lon/alt-meters.
    const positionCallback = new Cesium.CallbackProperty(() => {
      // selectedAircraft is captured at effect-creation time. The aircraft
      // prop polls every few seconds → effect re-fires → fresh closure.
      return Cesium.Cartesian3.fromDegrees(
        selectedAircraft.lon,
        selectedAircraft.lat,
        Math.max(0, selectedAircraft.altitudeM)
      );
    }, false);

    const entity = viewer.entities.add({
      // Use a small invisible point so trackedEntity has a valid bounding sphere.
      position: positionCallback as any,
      point: { pixelSize: 1, color: Cesium.Color.TRANSPARENT },
    });
    aircraftFollowEntityRef.current = entity;
    viewer.trackedEntity = entity;

    return tearDown;
  }, [followSelectedAircraft, selectedAircraft]);

  // ===== Aircraft past-history polyline (selected) =====
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    if (aircraftHistoryEntityRef.current) {
      viewer.entities.remove(aircraftHistoryEntityRef.current);
      aircraftHistoryEntityRef.current = null;
    }
    if (!selectedAircraft || !selectedAircraftHistory || selectedAircraftHistory.length < 2) return;
    const cartesians: Cesium.Cartesian3[] = [];
    for (const p of selectedAircraftHistory) {
      cartesians.push(Cesium.Cartesian3.fromDegrees(p.lon, p.lat, Math.max(0, p.alt)));
    }
    // Append the current aircraft position as the final point so the history
    // joins seamlessly with the predicted-future polyline.
    cartesians.push(Cesium.Cartesian3.fromDegrees(selectedAircraft.lon, selectedAircraft.lat, Math.max(0, selectedAircraft.altitudeM)));
    aircraftHistoryEntityRef.current = viewer.entities.add({
      polyline: {
        positions: cartesians,
        width: 2,
        material: Cesium.Color.fromCssColorString("#5cb5ff").withAlpha(0.55),
        clampToGround: false,
      },
    });
  }, [selectedAircraft, selectedAircraftHistory]);

  // ===== Aircraft trail polyline for selected =====
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    if (aircraftTrailEntityRef.current) {
      viewer.entities.remove(aircraftTrailEntityRef.current);
      aircraftTrailEntityRef.current = null;
    }
    if (!selectedAircraft || selectedAircraft.velocityMs <= 0) return;
    // Build 5-min predicted great-circle path
    const segments = 32;
    const minutesAhead = 5;
    const distanceM = selectedAircraft.velocityMs * minutesAhead * 60;
    const distanceRad = distanceM / 6371000;
    const lat0 = selectedAircraft.lat * Math.PI / 180;
    const lon0 = selectedAircraft.lon * Math.PI / 180;
    const heading = (selectedAircraft.headingDeg || 0) * Math.PI / 180;
    const cartesians: Cesium.Cartesian3[] = [];
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const d = distanceRad * t;
      const lat2 = Math.asin(
        Math.sin(lat0) * Math.cos(d) + Math.cos(lat0) * Math.sin(d) * Math.cos(heading)
      );
      const lon2 = lon0 + Math.atan2(
        Math.sin(heading) * Math.sin(d) * Math.cos(lat0),
        Math.cos(d) - Math.sin(lat0) * Math.sin(lat2)
      );
      cartesians.push(Cesium.Cartesian3.fromDegrees(
        lon2 * 180 / Math.PI,
        lat2 * 180 / Math.PI,
        Math.max(0, selectedAircraft.altitudeM)
      ));
    }
    aircraftTrailEntityRef.current = viewer.entities.add({
      polyline: {
        positions: cartesians,
        width: 3,
        material: new Cesium.PolylineGlowMaterialProperty({
          color: Cesium.Color.fromCssColorString("#5cb5ff"),
          glowPower: 0.25,
        }),
        clampToGround: false,
      },
    });
  }, [selectedAircraft]);

  // ===== Aircraft click → select + hover tooltip =====
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);

    // Build a tooltip DOM element overlaid on the canvas. Cheaper than
    // rendering as a Cesium label (which would require allocating an
    // entity per hover); we just position-update on mouse-move.
    const tooltip = document.createElement("div");
    tooltip.className = "cesiumAircraftTooltip";
    tooltip.style.cssText = "position:absolute;pointer-events:none;padding:6px 10px;border-radius:8px;border:1px solid #2a3349;background:rgba(8,14,26,.95);backdrop-filter:blur(6px);color:#f1f4f8;font:600 11px Inter,sans-serif;box-shadow:0 4px 12px rgba(0,0,0,.35);z-index:99;display:none;white-space:nowrap;letter-spacing:.04em;";
    viewer.container.appendChild(tooltip);

    handler.setInputAction((click: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
      const picked = viewer.scene.pick(click.position);
      // Country label click → fly to centroid at 1500km altitude. Trumps
      // the surface-pick handler so a click on a country label doesn't
      // also drop a pin at the click point underneath.
      if (picked && picked.id instanceof Cesium.Entity && picked.id.properties?.isCountry?.getValue()) {
        const props = picked.id.properties;
        const lon = props.countryLon.getValue();
        const lat = props.countryLat.getValue();
        viewer.camera.flyTo({
          destination: Cesium.Cartesian3.fromDegrees(lon, lat, 1_500_000),
          orientation: { heading: 0, pitch: -Cesium.Math.PI_OVER_TWO, roll: 0 },
          duration: 1.6,
        });
        return;
      }
      // Landmark label click → fly to its zoom altitude.
      if (picked && picked.id instanceof Cesium.Entity && picked.id.properties?.isLandmark?.getValue()) {
        const props = picked.id.properties;
        const lon = props.landmarkLon.getValue();
        const lat = props.landmarkLat.getValue();
        const zoom = props.landmarkZoom.getValue();
        viewer.camera.flyTo({
          destination: Cesium.Cartesian3.fromDegrees(lon, lat, zoom * 1000),
          orientation: { heading: 0, pitch: -Cesium.Math.PI_OVER_TWO, roll: 0 },
          duration: 1.4,
        });
        return;
      }
      // Airport label click → fly to ~3km altitude over the airfield.
      if (picked && picked.id instanceof Cesium.Entity && picked.id.properties?.isAirport?.getValue()) {
        const props = picked.id.properties;
        const lon = props.airportLon.getValue();
        const lat = props.airportLat.getValue();
        viewer.camera.flyTo({
          destination: Cesium.Cartesian3.fromDegrees(lon, lat, 3000),
          orientation: { heading: 0, pitch: -Cesium.Math.PI_OVER_TWO, roll: 0 },
          duration: 1.4,
        });
        return;
      }
      // Aircraft billboard click → select.
      if (picked && picked.primitive instanceof Cesium.Billboard && onSelectAircraft) {
        const icao = aircraftBillboardIndexRef.current.get(picked.primitive);
        if (icao) onSelectAircraft(icao);
      }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

    handler.setInputAction((move: Cesium.ScreenSpaceEventHandler.MotionEvent) => {
      const picked = viewer.scene.pick(move.endPosition);
      if (picked && picked.primitive instanceof Cesium.Billboard) {
        const icao = aircraftBillboardIndexRef.current.get(picked.primitive);
        if (icao && aircraft) {
          const a = aircraft.find((x) => x.icao24 === icao);
          if (a) {
            const altFt = Math.round(a.altitudeM / 0.3048).toLocaleString();
            tooltip.textContent = `${a.callsign || a.icao24.toUpperCase()} · ${altFt} ft`;
            tooltip.style.left = `${move.endPosition.x + 14}px`;
            tooltip.style.top = `${move.endPosition.y + 14}px`;
            tooltip.style.display = "block";
            viewer.scene.canvas.style.cursor = "pointer";
            return;
          }
        }
      }
      tooltip.style.display = "none";
      viewer.scene.canvas.style.cursor = "default";
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

    return () => {
      handler.destroy();
      tooltip.remove();
    };
  }, [onSelectAircraft, aircraft]);

  // ===== Screenshot command =====
  const lastScreenshotIdRef = useRef(0);
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !screenshotCommand || !onScreenshot) return;
    if (screenshotCommand.id === lastScreenshotIdRef.current) return;
    lastScreenshotIdRef.current = screenshotCommand.id;
    if (screenshotCommand.id === 0) return;
    // Force a fresh render so the canvas has the latest frame.
    viewer.scene.requestRender();
    requestAnimationFrame(() => {
      const canvas = viewer.scene.canvas;
      const dataUrl = canvas.toDataURL("image/png");
      canvas.toBlob((blob) => { if (blob) onScreenshot(blob, dataUrl); }, "image/png");
    });
  }, [screenshotCommand, onScreenshot]);

  // ===== Real-time-sun toggle / manual hour =====
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    if (realTimeSun) {
      viewer.clock.shouldAnimate = true;
      viewer.clock.multiplier = 1;
      viewer.clock.currentTime = Cesium.JulianDate.now();
    } else if (typeof manualUtcHour === "number") {
      // Snap clock to today at the requested UTC hour.
      const now = new Date();
      const target = new Date(Date.UTC(
        now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(),
        Math.floor(manualUtcHour), Math.round((manualUtcHour % 1) * 60), 0, 0
      ));
      viewer.clock.shouldAnimate = false;
      viewer.clock.currentTime = Cesium.JulianDate.fromDate(target);
      viewer.scene.requestRender();
    } else {
      viewer.clock.shouldAnimate = false;
    }
  }, [realTimeSun, manualUtcHour]);

  // ===== Pin sync =====
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    // Remove old
    for (const e of pinEntitiesRef.current) viewer.entities.remove(e);
    pinEntitiesRef.current = [];
    if (!pins) return;
    for (const p of pins) {
      const entity = viewer.entities.add({
        position: Cesium.Cartesian3.fromDegrees(p.lon, p.lat),
        point: {
          pixelSize: 14,
          color: Cesium.Color.fromCssColorString(p.color),
          outlineColor: Cesium.Color.WHITE,
          outlineWidth: 2,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        label: {
          text: p.label,
          font: "12px Inter, sans-serif",
          fillColor: Cesium.Color.WHITE,
          outlineColor: Cesium.Color.fromCssColorString("#020a18"),
          outlineWidth: 4,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          pixelOffset: new Cesium.Cartesian2(0, -16),
          showBackground: true,
          backgroundColor: Cesium.Color.fromCssColorString("rgba(8, 14, 26, 0.78)"),
          backgroundPadding: new Cesium.Cartesian2(8, 4),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          // Hide the label when the camera is far enough that text would clutter.
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 8_000_000),
        },
      });
      pinEntitiesRef.current.push(entity);
    }
  }, [pins]);

  // ===== EONET event sync =====
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    for (const e of eonetEntitiesRef.current) viewer.entities.remove(e);
    eonetEntitiesRef.current = [];
    if (!eonet) return;
    for (const ev of eonet) {
      const entity = viewer.entities.add({
        position: Cesium.Cartesian3.fromDegrees(ev.lon, ev.lat),
        point: {
          pixelSize: 12,
          color: Cesium.Color.fromCssColorString(ev.color),
          outlineColor: Cesium.Color.WHITE,
          outlineWidth: 1,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        label: {
          text: ev.title.length > 32 ? ev.title.slice(0, 29) + "…" : ev.title,
          font: "11px Inter, sans-serif",
          fillColor: Cesium.Color.fromCssColorString(ev.color),
          outlineColor: Cesium.Color.fromCssColorString("rgba(0, 0, 0, 0.85)"),
          outlineWidth: 3,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          pixelOffset: new Cesium.Cartesian2(0, -14),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          // Labels only show when within 4000km of the camera so the globe
          // doesn't get spammed with text at orbital view.
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 4_000_000),
        },
      });
      eonetEntitiesRef.current.push(entity);
    }
  }, [eonet]);

  // ===== Earthquake sync =====
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    for (const e of earthquakeEntitiesRef.current) viewer.entities.remove(e);
    earthquakeEntitiesRef.current = [];
    if (!earthquakes) return;
    for (const q of earthquakes) {
      const colorHex = q.mag >= 5 ? "#ff5a5a" : q.mag >= 3.5 ? "#ffb84d" : "#ffd66b";
      const baseSize = 6 + Math.max(0, q.mag) * 2.2;        // px
      // Pulse fresh quakes (under 60 min old) — pixelSize wobbles
      // between baseSize and baseSize*1.6 on a 1-Hz sine. Older
      // quakes use a fixed pixelSize.
      const ageMs = q.timeUnixMs ? Date.now() - q.timeUnixMs : Infinity;
      const isFresh = ageMs < 60 * 60 * 1000;
      const pulseStartMs = Date.now();
      const sizeProperty: any = isFresh
        ? new Cesium.CallbackProperty(() => {
            const t = (Date.now() - pulseStartMs) / 1000;
            return baseSize * (1 + 0.3 * (0.5 + 0.5 * Math.sin(t * 2)));
          }, false)
        : baseSize;
      const entity = viewer.entities.add({
        position: Cesium.Cartesian3.fromDegrees(q.lon, q.lat),
        point: {
          pixelSize: sizeProperty,
          color: Cesium.Color.fromCssColorString(colorHex).withAlpha(0.85),
          outlineColor: Cesium.Color.WHITE,
          outlineWidth: isFresh ? 2 : 1,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        label: {
          text: isFresh ? `🔴 M${q.mag.toFixed(1)}` : `M${q.mag.toFixed(1)}`,
          font: "10px ui-monospace, monospace",
          fillColor: Cesium.Color.fromCssColorString(colorHex),
          outlineColor: Cesium.Color.fromCssColorString("rgba(0,0,0,0.9)"),
          outlineWidth: 3,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          pixelOffset: new Cesium.Cartesian2(0, -baseSize / 2 - 2),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 2_000_000),
        },
      });
      earthquakeEntitiesRef.current.push(entity);
    }
  }, [earthquakes]);

  // ===== Volcano sync (alert-tinted) =====
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    for (const e of volcanoEntitiesRef.current) viewer.entities.remove(e);
    volcanoEntitiesRef.current = [];
    if (!volcanoes) return;
    for (const v of volcanoes) {
      const entity = viewer.entities.add({
        position: Cesium.Cartesian3.fromDegrees(v.lon, v.lat),
        point: {
          pixelSize: v.elevated ? 14 : 10,
          color: Cesium.Color.fromCssColorString(v.alertColor),
          outlineColor: Cesium.Color.WHITE,
          outlineWidth: 1,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        label: {
          text: "△ " + v.name,
          font: "11px Inter, sans-serif",
          fillColor: Cesium.Color.fromCssColorString(v.alertColor),
          outlineColor: Cesium.Color.fromCssColorString("rgba(0,0,0,0.85)"),
          outlineWidth: 3,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          pixelOffset: new Cesium.Cartesian2(0, -16),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 3_000_000),
        },
      });
      volcanoEntitiesRef.current.push(entity);
    }
  }, [volcanoes]);

  // ===== Rocket-launch sync =====
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    for (const e of launchEntitiesRef.current) viewer.entities.remove(e);
    launchEntitiesRef.current = [];
    if (!launches) return;
    for (const l of launches) {
      const tint = l.imminent ? "#ffd66b" : l.soon ? "#5cb5ff" : "#7a8db5";
      const entity = viewer.entities.add({
        position: Cesium.Cartesian3.fromDegrees(l.lon, l.lat),
        point: {
          pixelSize: l.imminent ? 14 : 10,
          color: Cesium.Color.fromCssColorString(tint),
          outlineColor: Cesium.Color.WHITE,
          outlineWidth: 1,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        label: {
          text: "🚀 " + l.name,
          font: "11px Inter, sans-serif",
          fillColor: Cesium.Color.fromCssColorString(tint),
          outlineColor: Cesium.Color.fromCssColorString("rgba(0,0,0,0.85)"),
          outlineWidth: 3,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          pixelOffset: new Cesium.Cartesian2(0, -16),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 5_000_000),
        },
      });
      launchEntitiesRef.current.push(entity);
    }
  }, [launches]);

  // ===== Famous landmarks (toggleable) =====
  // Renders the landmark catalog as labeled points. Off-toggle: clear
  // the entities. Re-runs only when the showLandmarks flag flips,
  // so toggling is cheap.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    for (const e of landmarkEntitiesRef.current) viewer.entities.remove(e);
    landmarkEntitiesRef.current = [];
    if (showLandmarks === false) return;
    for (const lm of LANDMARKS) {
      const e = viewer.entities.add({
        position: Cesium.Cartesian3.fromDegrees(lm.lon, lm.lat, 0),
        id: `landmark-${lm.id}`,
        properties: { isLandmark: true, landmarkId: lm.id, landmarkLat: lm.lat, landmarkLon: lm.lon, landmarkZoom: lm.zoomKm },
        label: {
          text: `${lm.emoji} ${lm.name}`,
          font: "600 11px Inter, sans-serif",
          fillColor: Cesium.Color.fromCssColorString(lm.kind === "natural" ? "rgba(160, 230, 175, 0.95)" : "rgba(245, 220, 180, 0.95)"),
          outlineColor: Cesium.Color.fromCssColorString("rgba(0,0,0,0.95)"),
          outlineWidth: 4,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
          pixelOffset: new Cesium.Cartesian2(0, -10),
          showBackground: true,
          backgroundColor: Cesium.Color.fromCssColorString("rgba(8, 14, 26, 0.85)"),
          backgroundPadding: new Cesium.Cartesian2(6, 3),
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 5_000_000),
        },
        point: {
          pixelSize: 6,
          color: Cesium.Color.fromCssColorString(lm.kind === "natural" ? "#7cffb1" : "#ffd66b"),
          outlineColor: Cesium.Color.WHITE,
          outlineWidth: 1,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 5_000_000),
        },
      });
      landmarkEntitiesRef.current.push(e);
    }
  }, [showLandmarks]);

  // ===== Major airports layer =====
  // ~80 IATA hub airports as small ✈ markers + labels. Visible inside
  // ~3000km. Click → fly low to ground level over the runways.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    for (const e of airportEntitiesRef.current) viewer.entities.remove(e);
    airportEntitiesRef.current = [];
    if (!showAirports) return;
    for (const ap of AIRPORTS) {
      const e = viewer.entities.add({
        position: Cesium.Cartesian3.fromDegrees(ap.lon, ap.lat, 0),
        id: `airport-${ap.iata}`,
        properties: { isAirport: true, airportLat: ap.lat, airportLon: ap.lon, airportIATA: ap.iata },
        label: {
          text: `✈ ${ap.iata}`,
          font: "600 11px ui-monospace, monospace",
          fillColor: Cesium.Color.fromCssColorString("rgba(180, 220, 255, 0.95)"),
          outlineColor: Cesium.Color.fromCssColorString("rgba(0,0,0,0.95)"),
          outlineWidth: 4,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
          pixelOffset: new Cesium.Cartesian2(0, -10),
          showBackground: true,
          backgroundColor: Cesium.Color.fromCssColorString("rgba(8, 14, 26, 0.85)"),
          backgroundPadding: new Cesium.Cartesian2(6, 3),
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 3_000_000),
        },
        point: {
          pixelSize: 5,
          color: Cesium.Color.fromCssColorString("#5cb5ff"),
          outlineColor: Cesium.Color.WHITE,
          outlineWidth: 1,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 3_000_000),
        },
      });
      airportEntitiesRef.current.push(e);
    }
  }, [showAirports]);

  // ===== Country borders (GeoJsonDataSource) =====
  // Loads the FeatureCollection passed in (built once by App from
  // world-atlas/countries-50m.json topojson). Cesium's GeoJsonDataSource
  // renders each polygon outline. We prefer thin amber lines on top of
  // the imagery — same look as the Atlas-mode borders.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    if (bordersDataSourceRef.current) {
      viewer.dataSources.remove(bordersDataSourceRef.current, true);
      bordersDataSourceRef.current = null;
    }
    if (!bordersGeoJson) return;
    Cesium.GeoJsonDataSource.load(bordersGeoJson, {
      stroke: Cesium.Color.fromCssColorString("#ffd66b").withAlpha(0.55),
      fill: Cesium.Color.TRANSPARENT,
      strokeWidth: 1,
      clampToGround: true,
    }).then((ds) => {
      if (!viewerRef.current) return;
      // Strip all polygon graphics — Cesium creates them by default for
      // each polygon feature even with fill = TRANSPARENT, and at close
      // zoom they tear into gray triangles. We only want the outline.
      // Re-create the outlines as polylines from each polygon's positions.
      const polylinesToAdd: Cesium.Entity[] = [];
      ds.entities.values.forEach((entity) => {
        if (entity.polygon) {
          // Pull the polygon's outer-ring positions, drop the polygon,
          // and add a polyline entity for the boundary.
          const hierarchy = entity.polygon.hierarchy?.getValue(Cesium.JulianDate.now());
          if (hierarchy?.positions) {
            polylinesToAdd.push(new Cesium.Entity({
              polyline: {
                positions: hierarchy.positions,
                width: 1,
                material: Cesium.Color.fromCssColorString("#ffd66b").withAlpha(0.55),
                clampToGround: true,
              },
            }));
            // Drop the holes too — they'd render as inner fill rings.
            if (hierarchy.holes) {
              for (const hole of hierarchy.holes) {
                if (hole.positions) {
                  polylinesToAdd.push(new Cesium.Entity({
                    polyline: {
                      positions: hole.positions,
                      width: 1,
                      material: Cesium.Color.fromCssColorString("#ffd66b").withAlpha(0.55),
                      clampToGround: true,
                    },
                  }));
                }
              }
            }
          }
          entity.polygon = undefined;
        }
      });
      for (const e of polylinesToAdd) ds.entities.add(e);
      viewer.dataSources.add(ds);
      bordersDataSourceRef.current = ds;
      viewer.scene.requestRender();
    }).catch(() => { /* malformed — silent */ });
  }, [bordersGeoJson]);

  // ===== Aurora oval overlay =====
  // Two great-circle "small circles" centered on the magnetic poles,
  // with radius keyed off the current Kp index. Kp 0 (quiet) puts the
  // oval at ~25° magnetic colatitude; Kp 9 (extreme) brings it down to
  // ~45°. Approximation — real auroral ovals are asymmetric, but this
  // gives a useful at-a-glance sense of where you'd see aurora tonight.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    for (const e of auroraOvalEntitiesRef.current) viewer.entities.remove(e);
    auroraOvalEntitiesRef.current = [];
    if (auroraKp === null || auroraKp === undefined) return;

    // Magnetic-pole approximate positions (2026, IGRF-13).
    const NMP_LAT = 85.5,  NMP_LON = 137;
    const SMP_LAT = -64.0, SMP_LON = -137;
    // Kp 0..9 → colatitude 25°..45°. Linear is fine for a viz.
    const colat = 25 + (auroraKp / 9) * 20;
    const tintHex =
      auroraKp >= 7 ? "#ff5fb8" :
      auroraKp >= 5 ? "#ff8a3a" :
      auroraKp >= 3 ? "#7cffb1" :
                       "#5cb5ff";
    const tint = Cesium.Color.fromCssColorString(tintHex).withAlpha(0.7);

    const buildCircle = (centerLat: number, centerLon: number) => {
      const positions: Cesium.Cartesian3[] = [];
      const STEPS = 90;
      // Walk around the small circle by varying the bearing from the
      // magnetic pole and stepping out by colat.
      const lat0 = centerLat * Math.PI / 180;
      const lon0 = centerLon * Math.PI / 180;
      const dRad = colat * Math.PI / 180;
      for (let i = 0; i <= STEPS; i++) {
        const brg = (i / STEPS) * 2 * Math.PI;
        const lat = Math.asin(
          Math.sin(lat0) * Math.cos(dRad) +
          Math.cos(lat0) * Math.sin(dRad) * Math.cos(brg)
        );
        const lon = lon0 + Math.atan2(
          Math.sin(brg) * Math.sin(dRad) * Math.cos(lat0),
          Math.cos(dRad) - Math.sin(lat0) * Math.sin(lat)
        );
        positions.push(Cesium.Cartesian3.fromDegrees(
          lon * 180 / Math.PI,
          lat * 180 / Math.PI,
          0
        ));
      }
      return positions;
    };

    for (const [lat, lon] of [[NMP_LAT, NMP_LON], [SMP_LAT, SMP_LON]] as Array<[number, number]>) {
      const positions = buildCircle(lat, lon);
      const e = viewer.entities.add({
        polyline: {
          positions,
          width: 3,
          material: new Cesium.PolylineGlowMaterialProperty({
            color: tint,
            glowPower: 0.35,
          }),
          clampToGround: true,
        },
      });
      auroraOvalEntitiesRef.current.push(e);
    }
  }, [auroraKp]);

  // ===== Active tropical cyclones (NOAA NHC) =====
  // Rendered as a 🌀 emoji label + colored point at the storm eye. Wind
  // speed determines color (Saffir-Simpson rough mapping):
  //   < 119 kph: Tropical Storm (blue)
  //   119–153 kph: Cat 1 (yellow)
  //   154–177 kph: Cat 2 (orange)
  //   178–208 kph: Cat 3 (red)
  //   ≥ 209 kph: Cat 4-5 (deep red)
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    for (const e of stormEntitiesRef.current) viewer.entities.remove(e);
    stormEntitiesRef.current = [];
    if (!storms) return;
    for (const s of storms) {
      const ws = s.intensityKph ?? 0;
      const color =
        ws >= 209 ? "#9b1c1c" :
        ws >= 178 ? "#ff3a3a" :
        ws >= 154 ? "#ff8a3a" :
        ws >= 119 ? "#ffd66b" :
                    "#5cb5ff";
      const sizePx = ws >= 178 ? 18 : ws >= 119 ? 14 : 10;
      const entity = viewer.entities.add({
        position: Cesium.Cartesian3.fromDegrees(s.lon, s.lat),
        point: {
          pixelSize: sizePx,
          color: Cesium.Color.fromCssColorString(color).withAlpha(0.9),
          outlineColor: Cesium.Color.WHITE,
          outlineWidth: 2,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        label: {
          text: `🌀 ${s.name} · ${s.classification}${ws ? ` · ${Math.round(ws)} kph` : ""}`,
          font: "600 12px Inter, sans-serif",
          fillColor: Cesium.Color.fromCssColorString(color),
          outlineColor: Cesium.Color.fromCssColorString("rgba(0,0,0,0.92)"),
          outlineWidth: 4,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
          pixelOffset: new Cesium.Cartesian2(0, -16),
          showBackground: true,
          backgroundColor: Cesium.Color.fromCssColorString("rgba(8, 14, 26, 0.92)"),
          backgroundPadding: new Cesium.Cartesian2(8, 4),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 12_000_000),
        },
      });
      stormEntitiesRef.current.push(entity);
    }
  }, [storms]);

  // ===== Weather radar overlay (Cesium ImageryLayer) =====
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    if (weatherImageryLayerRef.current) {
      viewer.imageryLayers.remove(weatherImageryLayerRef.current, true);
      weatherImageryLayerRef.current = null;
    }
    if (!weatherTilePath) return;
    // RainViewer's free tile pyramid maxes out around level 5 — beyond
    // that the server returns a placeholder PNG that literally says
    // "Zoom Level Not Supported" plastered across the tile, which the
    // user reported as a "tear" when zooming into city level. Cap at 5
    // so Cesium upscales lower-level tiles instead of requesting
    // unsupported ones. The camera-change listener also auto-fades the
    // layer to zero alpha under 80km altitude — the upscaled level-5
    // tile would otherwise haze the entire screen with a uniform color.
    const provider = new Cesium.UrlTemplateImageryProvider({
      url: `https://tilecache.rainviewer.com${weatherTilePath}/256/{z}/{x}/{y}/4/1_1.png`,
      maximumLevel: 5,
      credit: new Cesium.Credit("RainViewer", false),
    });
    const layer = viewer.imageryLayers.addImageryProvider(provider);
    layer.alpha = weatherOpacity ?? 0.7;
    weatherImageryLayerRef.current = layer;
    weatherOpacityRef.current = weatherOpacity ?? 0.7;
  }, [weatherTilePath, weatherOpacity]);

  // ===== Per-frame interpolation (smooth aircraft motion) =====
  // Polls only fire every 12-25s, but planes do ~250 m/s. Without
  // interpolation they teleport every poll. Each frame we compute
  //   dt = now - sampleTime
  //   distance = velocity * dt
  // and project the start position along the heading using great-circle
  // math, then mutate the billboard position in-place. Cheap because
  // it's just trig per aircraft and we already have the billboard refs.
  // Force a steady RAF render so preRender keeps firing under
  // requestRenderMode.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    const billboards = aircraftBillboardsRef.current;
    if (!billboards) return;
    const byIcao = aircraftBillboardByIcaoRef.current;
    const samples = aircraftSampleByIcaoRef.current;
    const altBars = aircraftAltBarByIcaoRef.current;
    const tick = () => {
      const now = performance.now();
      const tmpCart = new Cesium.Cartesian3();
      // Track selected-aircraft pose so we can also update the 3D model
      // entities at the same interpolated lat/lon/alt + heading.
      let selectedPos: Cesium.Cartesian3 | null = null;
      let selectedHeading = 0;
      // Iterate samples (one per live aircraft). Skip ones with zero
      // velocity — no point doing trig for parked planes.
      samples.forEach((s, icao) => {
        const bb = byIcao.get(icao);
        if (!bb) return;
        const dt = (now - s.sampleTimeMs) / 1000;
        if (s.velocityMs <= 0 && s.verticalMs === 0) return;
        // Distance along the surface (radians).
        const distRad = (s.velocityMs * dt) / 6_371_000;
        const cosD = Math.cos(distRad);
        const sinD = Math.sin(distRad);
        const sinLat0 = Math.sin(s.latRad);
        const cosLat0 = Math.cos(s.latRad);
        const lat2 = Math.asin(sinLat0 * cosD + cosLat0 * sinD * Math.cos(s.headingRad));
        const lon2 = s.lonRad + Math.atan2(
          Math.sin(s.headingRad) * sinD * cosLat0,
          cosD - sinLat0 * Math.sin(lat2)
        );
        const alt2 = Math.max(0, s.altM + s.verticalMs * dt);
        Cesium.Cartesian3.fromRadians(lon2, lat2, alt2, undefined, tmpCart);
        bb.position = tmpCart;
        // Keep the altitude-bar in sync if it's on for this plane.
        const bar = altBars.get(icao);
        if (bar?.polyline) {
          const ground = Cesium.Cartesian3.fromRadians(lon2, lat2, 0);
          (bar.polyline.positions as any) = [ground, tmpCart.clone()];
        }
        if (selectedAircraft && icao === selectedAircraft.icao24) {
          selectedPos = Cesium.Cartesian3.fromRadians(lon2, lat2, alt2);
          selectedHeading = s.headingRad;
        }
      });
      // Slide the 3D model with the selected aircraft, recomputing
      // orientation from heading so it banks toward the new heading.
      if (selectedPos && aircraftModelEntitiesRef.current.length > 0) {
        const hpr = new Cesium.HeadingPitchRoll(selectedHeading, 0, 0);
        const orient = Cesium.Transforms.headingPitchRollQuaternion(selectedPos, hpr);
        for (const e of aircraftModelEntitiesRef.current) {
          e.position = selectedPos as any;
          e.orientation = orient as any;
        }
      }
      viewer.scene.requestRender();
    };
    viewer.scene.preRender.addEventListener(tick);
    // Steady RAF nudge so scene.preRender fires every frame even when
    // the camera is idle. Without this, requestRenderMode would skip
    // frames and planes would only move when the user pans.
    let raf = window.requestAnimationFrame(function loop() {
      if (!viewerRef.current) return;
      viewer.scene.requestRender();
      raf = window.requestAnimationFrame(loop);
    });
    return () => {
      viewer.scene.preRender.removeEventListener(tick);
      window.cancelAnimationFrame(raf);
    };
  }, [selectedAircraft]);

  // ===== Aircraft sync (incremental — diff by icao24) =====
  // Allocating 12k Cartesians + recreating 12k billboards every poll cycle
  // (~5s) was the single largest cost on mobile. Now we keep billboards
  // alive across snapshots and only mutate position/rotation in-place,
  // adding/removing only the diff. Saves a ton of GC pressure.
  useEffect(() => {
    const viewer = viewerRef.current;
    const billboards = aircraftBillboardsRef.current;
    const icon = aircraftIconRef.current;
    if (!viewer || !billboards || !icon) return;
    const byIcao = aircraftBillboardByIcaoRef.current;
    const billboardIndex = aircraftBillboardIndexRef.current;

    const altBars = aircraftAltBarByIcaoRef.current;

    if (!aircraft || aircraft.length === 0) {
      billboards.removeAll();
      byIcao.clear();
      billboardIndex.clear();
      altBars.forEach((e) => viewer.entities.remove(e));
      altBars.clear();
      return;
    }

    // Build set of new icaos for fast removal pass.
    const newIcaos = new Set<string>();
    for (const a of aircraft) newIcaos.add(a.icao24);

    // Pass 1: remove billboards that have left the dataset.
    const toRemove: string[] = [];
    byIcao.forEach((_bb, icao) => {
      if (!newIcaos.has(icao)) toRemove.push(icao);
    });
    for (const icao of toRemove) {
      const bb = byIcao.get(icao);
      if (bb) {
        billboardIndex.delete(bb);
        billboards.remove(bb);
        byIcao.delete(icao);
      }
      const bar = altBars.get(icao);
      if (bar) {
        viewer.entities.remove(bar);
        altBars.delete(icao);
      }
    }
    // If the bars feature was just turned off, remove all existing ones.
    if (!aircraftAltitudeBars && altBars.size > 0) {
      altBars.forEach((e) => viewer.entities.remove(e));
      altBars.clear();
    }

    // Refresh interpolation samples — capture pos/heading/velocity at
    // poll time so the preRender loop can project each plane forward.
    const samples = aircraftSampleByIcaoRef.current;
    const nowMs = performance.now();
    // Drop samples for aircraft no longer in feed.
    samples.forEach((_, icao) => {
      if (!newIcaos.has(icao)) samples.delete(icao);
    });
    for (const a of aircraft) {
      samples.set(a.icao24, {
        latRad: a.lat * Math.PI / 180,
        lonRad: a.lon * Math.PI / 180,
        altM: Math.max(0, a.altitudeM),
        headingRad: (a.headingDeg || 0) * Math.PI / 180,
        velocityMs: typeof a.velocityMs === "number" ? a.velocityMs : 0,
        verticalMs: typeof a.verticalRateMs === "number" ? a.verticalRateMs : 0,
        sampleTimeMs: nowMs,
      });
    }

    // Pass 2: create or update.
    for (const a of aircraft) {
      const alt = Math.max(0, a.altitudeM);
      const altT = Math.min(1, alt / 12000);
      // Emergency squawks override the normal altitude tint with a
      // bright magenta/red so they're impossible to miss.
      const isEmergency = a.squawk === "7500" || a.squawk === "7600" || a.squawk === "7700";
      const color = isEmergency
        ? Cesium.Color.fromCssColorString("#ff3a8a")
        : Cesium.Color.fromHsl(0.05 + altT * 0.5, 0.85, 0.6, 1.0);
      const cartesian = Cesium.Cartesian3.fromDegrees(a.lon, a.lat, alt);
      const rotationRad = -((a.headingDeg || 0) * Math.PI / 180);
      const existing = byIcao.get(a.icao24);
      if (existing) {
        // Cheap mutation — just nudge position/rotation/color.
        existing.position = cartesian;
        existing.rotation = rotationRad;
        existing.color = color;
      } else {
        const bb = billboards.add({
          position: cartesian,
          image: icon,
          color,
          rotation: rotationRad,
          alignedAxis: Cesium.Cartesian3.UNIT_Z,
          scaleByDistance: new Cesium.NearFarScalar(1.0e3, 0.5, 5.0e6, 0.18),
          translucencyByDistance: new Cesium.NearFarScalar(5.0e5, 1.0, 1.0e7, 0.4),
          verticalOrigin: Cesium.VerticalOrigin.CENTER,
          horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
          sizeInMeters: false,
        });
        byIcao.set(a.icao24, bb);
        billboardIndex.set(bb, a.icao24);
      }
      // Altitude bars: vertical polyline from ground to plane. Only shown
      // if the prop is on AND the plane is above 200m (ground vehicles
      // and helicopters at sea level look like noise).
      if (aircraftAltitudeBars && alt > 200) {
        const ground = Cesium.Cartesian3.fromDegrees(a.lon, a.lat, 0);
        const existingBar = altBars.get(a.icao24);
        const positions = [ground, cartesian];
        if (existingBar?.polyline) {
          (existingBar.polyline.positions as any) = positions;
        } else {
          const bar = viewer.entities.add({
            polyline: {
              positions,
              width: 1.5,
              material: Cesium.Color.fromCssColorString("#ffd66b").withAlpha(0.5),
              clampToGround: false,
            },
          });
          altBars.set(a.icao24, bar);
        }
      } else {
        const existingBar = altBars.get(a.icao24);
        if (existingBar) {
          viewer.entities.remove(existingBar);
          altBars.delete(a.icao24);
        }
      }
    }
  }, [aircraft, aircraftAltitudeBars]);

  // ===== Terrain exaggeration =====
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    if (typeof terrainExaggeration === "number") {
      (viewer.scene.globe as any).terrainExaggeration = terrainExaggeration;
      viewer.scene.requestRender();
    }
  }, [terrainExaggeration]);

  // ===== Fog toggle =====
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    viewer.scene.fog.enabled = fogEnabled !== false;
    viewer.scene.requestRender();
  }, [fogEnabled]);

  // ===== Auto-orbit =====
  // Continuously rotates the camera around the globe at ~3°/sec while
  // active. Hooked into Cesium's scene.preRender so it stays in sync
  // with the render loop. Disables itself cleanly when toggled off.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    if (!autoOrbit) return;
    let lastT = performance.now();
    const tick = () => {
      const now = performance.now();
      const dt = (now - lastT) / 1000;
      lastT = now;
      // Rotate around the camera's local up vector.
      viewer.camera.rotateRight(0.05 * dt * Math.PI / 180 * 30);
      viewer.scene.requestRender();
    };
    viewer.scene.preRender.addEventListener(tick);
    // Force render-on-demand so preRender fires steadily.
    const rafTick = () => {
      if (!viewerRef.current) return;
      viewer.scene.requestRender();
      raf = window.requestAnimationFrame(rafTick);
    };
    let raf = window.requestAnimationFrame(rafTick);
    return () => {
      viewer.scene.preRender.removeEventListener(tick);
      window.cancelAnimationFrame(raf);
    };
  }, [autoOrbit]);

  // ===== Globe-lighting override =====
  // Mobile auto-disables enableLighting at viewer creation. This effect
  // lets the user explicitly turn it back on (or off) at runtime via
  // Cmd+K, regardless of the auto-detection.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || enableGlobeLighting === undefined) return;
    viewer.scene.globe.enableLighting = enableGlobeLighting;
    viewer.scene.requestRender();
  }, [enableGlobeLighting]);

  // ===== Reset heading to true north =====
  // Snaps camera heading to 0 (north up) preserving lat/lon/altitude
  // and current pitch. Useful after auto-orbit or manual rotation.
  const lastResetHeadingIdRef = useRef(0);
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !resetHeadingCommand) return;
    if (resetHeadingCommand.id === lastResetHeadingIdRef.current) return;
    lastResetHeadingIdRef.current = resetHeadingCommand.id;
    if (resetHeadingCommand.id === 0) return;
    const cart = viewer.camera.positionCartographic;
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(
        Cesium.Math.toDegrees(cart.longitude),
        Cesium.Math.toDegrees(cart.latitude),
        cart.height
      ),
      orientation: { heading: 0, pitch: viewer.camera.pitch, roll: 0 },
      duration: 0.7,
    });
  }, [resetHeadingCommand]);

  // ===== Tilt command: re-orient camera at current position =====
  const lastTiltIdRef = useRef(0);
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !tiltCommand) return;
    if (tiltCommand.id === lastTiltIdRef.current) return;
    lastTiltIdRef.current = tiltCommand.id;
    if (tiltCommand.id === 0) return;
    const cart = viewer.camera.positionCartographic;
    const pitchRad = -tiltCommand.pitchDeg * Math.PI / 180;
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(
        Cesium.Math.toDegrees(cart.longitude),
        Cesium.Math.toDegrees(cart.latitude),
        cart.height
      ),
      orientation: { heading: viewer.camera.heading, pitch: pitchRad, roll: 0 },
      duration: 1.0,
    });
  }, [tiltCommand]);

  // ===== Fly-to handler: external command to move the camera =====
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    if (flyTo.id === lastFlyIdRef.current) return;
    lastFlyIdRef.current = flyTo.id;
    if (flyTo.id === 0) return;
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(flyTo.lon, flyTo.lat, Math.max(500, flyTo.altKm * 1000)),
      duration: 2.2,
      orientation: { heading: 0, pitch: -Cesium.Math.PI_OVER_TWO, roll: 0 },
    });
  }, [flyTo]);

  // ===== Render =====
  const haveToken = !!tokenToUse;

  if (!haveToken) {
    return (
      <div className="surfaceLoading">
        Surface mode needs a Cesium ion token.<br />
        Switch back to Atlas, then click Surface again — you'll be prompted.
      </div>
    );
  }

  return <div ref={containerRef} style={{ width: "100%", height: "100%", position: "absolute", inset: 0 }} />;
}

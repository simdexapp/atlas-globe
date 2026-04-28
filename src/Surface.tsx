import { useEffect, useRef } from "react";
import * as Cesium from "cesium";
import "cesium/Build/Cesium/Widgets/widgets.css";
import { MAJOR_CITIES } from "./cities";

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
  weatherOpacity
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
  // RainViewer tile path like '/v2/radar/...'. When set, layered as a
  // Cesium URL template imagery provider.
  weatherTilePath?: string;
  weatherOpacity?: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Cesium.Viewer | null>(null);
  const lastFlyIdRef = useRef(0);
  // Pin entities and aircraft point-primitives so we can update them
  // efficiently without re-creating the world on every prop change.
  const pinEntitiesRef = useRef<Cesium.Entity[]>([]);
  const aircraftBillboardsRef = useRef<Cesium.BillboardCollection | null>(null);
  const aircraftIconRef = useRef<HTMLCanvasElement | null>(null);
  const eonetEntitiesRef = useRef<Cesium.Entity[]>([]);
  const earthquakeEntitiesRef = useRef<Cesium.Entity[]>([]);
  const volcanoEntitiesRef = useRef<Cesium.Entity[]>([]);
  const launchEntitiesRef = useRef<Cesium.Entity[]>([]);
  const weatherImageryLayerRef = useRef<Cesium.ImageryLayer | null>(null);

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

    // ===== Quality settings =====
    // High-DPI rendering at native pixel ratio (caps at 2 for perf on phones).
    viewer.resolutionScale = Math.min(window.devicePixelRatio || 1, 2);
    // FXAA on the main render — reduces "pixel-crawl" on terrain edges.
    (viewer.scene as any).postProcessStages.fxaa.enabled = true;
    // 4× MSAA where supported. Cesium >= 1.96 supports msaaSamples on Scene.
    if ("msaaSamples" in viewer.scene) {
      (viewer.scene as any).msaaSamples = 4;
    }
    // HDR tone-mapping — gives sun-glint and atmosphere a more cinematic ramp.
    if ("highDynamicRange" in viewer.scene) {
      (viewer.scene as any).highDynamicRange = true;
    }
    viewer.scene.globe.maximumScreenSpaceError = 1.5;       // sharper terrain (default is 2)
    // ===== Perf optimizations =====
    // Bigger terrain-tile cache so panning a recently-viewed area doesn't
    // re-fetch (default is 100; bump to 1000 for smoother zoom-out then
    // zoom-back-in cycles).
    viewer.scene.globe.tileCacheSize = 1000;
    // Skip tile rendering when the view hasn't changed — saves GPU cycles
    // when the camera is idle. Already on by viewer config, but reaffirm.
    viewer.scene.requestRenderMode = true;
    viewer.scene.maximumRenderTimeChange = Number.POSITIVE_INFINITY;
    // (Tried disabling orderIndependentTranslucency for perf, but in this
    // Cesium build it's a getter-only property — assigning it throws. Skip.)

    // ===== Atmosphere + lighting =====
    viewer.scene.globe.enableLighting = true;            // sun-driven day/night on globe
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
      Cesium.createWorldTerrainAsync({ requestVertexNormals: true, requestWaterMask: true })
        .then((terrain) => { viewer.terrainProvider = terrain; })
        .catch(() => { /* fallback to ellipsoid */ });

      // Cesium World Imagery (asset 2 = Bing Aerial). Best-quality global imagery.
      Cesium.IonImageryProvider.fromAssetId(2)
        .then((provider) => {
          viewer.imageryLayers.removeAll();
          viewer.imageryLayers.addImageryProvider(provider);
        })
        .catch(() => {
          // Fallback: OpenStreetMap (free, no token needed)
          viewer.imageryLayers.addImageryProvider(
            new Cesium.OpenStreetMapImageryProvider({
              url: "https://tile.openstreetmap.org/",
            })
          );
        });

      // Cesium OSM Buildings — global 3D building footprints + heights.
      Cesium.Cesium3DTileset.fromIonAssetId(96188)
        .then((tileset) => {
          viewer.scene.primitives.add(tileset);
        })
        .catch(() => { /* OSM Buildings unavailable on this token tier */ });
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
    for (const c of MAJOR_CITIES) {
      // Population-based visibility — bigger cities visible from farther.
      // Tokyo/Delhi (37M, 33M): visible from 8000km+. Madrid/Toronto (~5M): need ~1500km.
      const popRatio = c.population / 1_000_000;        // millions
      const farKm = Math.min(8000, 800 + popRatio * 150);  // 800-8000km range
      viewer.entities.add({
        position: Cesium.Cartesian3.fromDegrees(c.lon, c.lat, 0),
        label: {
          text: c.name,
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
    const removeListener = viewer.camera.changed.addEventListener(() => {
      const cartographic = viewer.camera.positionCartographic;
      const lat = Cesium.Math.toDegrees(cartographic.latitude);
      const lon = Cesium.Math.toDegrees(cartographic.longitude);
      const altKm = cartographic.height / 1000;
      onCameraChange(lat, lon, altKm);
    });
    viewer.camera.percentageChanged = 0.01;

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
      pinEntitiesRef.current = [];
      eonetEntitiesRef.current = [];
      earthquakeEntitiesRef.current = [];
      volcanoEntitiesRef.current = [];
      launchEntitiesRef.current = [];
      aircraftBillboardsRef.current?.removeAll();
      if (weatherImageryLayerRef.current) {
        viewer.imageryLayers.remove(weatherImageryLayerRef.current, true);
        weatherImageryLayerRef.current = null;
      }
      viewer.destroy();
      viewerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tokenToUse]);

  // ===== Real-time-sun toggle: when on, lock the Cesium clock to actual UTC =====
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    if (realTimeSun) {
      viewer.clock.shouldAnimate = true;
      viewer.clock.multiplier = 1;
      viewer.clock.currentTime = Cesium.JulianDate.now();
    } else {
      viewer.clock.shouldAnimate = false;
    }
  }, [realTimeSun]);

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
      const size = 6 + Math.max(0, q.mag) * 2.2;        // px
      const entity = viewer.entities.add({
        position: Cesium.Cartesian3.fromDegrees(q.lon, q.lat),
        point: {
          pixelSize: size,
          color: Cesium.Color.fromCssColorString(colorHex).withAlpha(0.85),
          outlineColor: Cesium.Color.WHITE,
          outlineWidth: 1,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        label: {
          text: `M${q.mag.toFixed(1)}`,
          font: "10px ui-monospace, monospace",
          fillColor: Cesium.Color.fromCssColorString(colorHex),
          outlineColor: Cesium.Color.fromCssColorString("rgba(0,0,0,0.9)"),
          outlineWidth: 3,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          pixelOffset: new Cesium.Cartesian2(0, -size / 2 - 2),
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

  // ===== Weather radar overlay (Cesium ImageryLayer) =====
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    if (weatherImageryLayerRef.current) {
      viewer.imageryLayers.remove(weatherImageryLayerRef.current, true);
      weatherImageryLayerRef.current = null;
    }
    if (!weatherTilePath) return;
    const provider = new Cesium.UrlTemplateImageryProvider({
      url: `https://tilecache.rainviewer.com${weatherTilePath}/256/{z}/{x}/{y}/4/1_1.png`,
      maximumLevel: 8,
      credit: new Cesium.Credit("RainViewer", false),
    });
    const layer = viewer.imageryLayers.addImageryProvider(provider);
    layer.alpha = weatherOpacity ?? 0.7;
    weatherImageryLayerRef.current = layer;
  }, [weatherTilePath, weatherOpacity]);

  // ===== Aircraft sync (heading-aware billboard glyphs) =====
  useEffect(() => {
    const viewer = viewerRef.current;
    const billboards = aircraftBillboardsRef.current;
    const icon = aircraftIconRef.current;
    if (!viewer || !billboards || !icon) return;
    if (!aircraft) {
      billboards.removeAll();
      return;
    }
    billboards.removeAll();
    for (const a of aircraft) {
      const alt = Math.max(0, a.altitudeM);
      const altT = Math.min(1, alt / 12000);
      const color = Cesium.Color.fromHsl(0.05 + altT * 0.5, 0.85, 0.6, 1.0);
      const cartesian = Cesium.Cartesian3.fromDegrees(a.lon, a.lat, alt);
      // rotation: Cesium's billboard rotation is around the screen-space Z
      // axis. Heading 0 = north = up. Convert from compass heading to
      // billboard rotation: invert sign because Cesium rotation is CCW from
      // screen-up.
      const rotationRad = -((a.headingDeg || 0) * Math.PI / 180);
      billboards.add({
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
    }
  }, [aircraft]);

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

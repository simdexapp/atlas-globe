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

export default function Surface({
  token,
  onCameraChange,
  onPickLocation,
  flyTo,
  pins,
  aircraft,
  realTimeSun,
  initialCamera
}: {
  token: string;
  onCameraChange: (lat: number, lon: number, altKm: number) => void;
  onPickLocation?: (lat: number, lon: number) => void;
  flyTo: FlyToTarget;
  pins?: SurfacePin[];
  aircraft?: SurfaceAircraft[];
  realTimeSun?: boolean;
  // Lat/lon/altKm to position the Cesium camera on first mount, so the
  // Atlas → Surface handoff doesn't jump to a different part of the globe.
  initialCamera?: { lat: number; lon: number; altKm: number };
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Cesium.Viewer | null>(null);
  const lastFlyIdRef = useRef(0);
  // Pin entities and aircraft point-primitives so we can update them
  // efficiently without re-creating the world on every prop change.
  const pinEntitiesRef = useRef<Cesium.Entity[]>([]);
  const aircraftPointsRef = useRef<Cesium.PointPrimitiveCollection | null>(null);
  const aircraftIndexRef = useRef<Map<string, number>>(new Map());

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

    // ===== aircraft point-primitive collection (efficient bulk render) =====
    aircraftPointsRef.current = new Cesium.PointPrimitiveCollection();
    viewer.scene.primitives.add(aircraftPointsRef.current);

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
      pinEntitiesRef.current = [];
      aircraftPointsRef.current?.removeAll();
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

  // ===== Aircraft sync (efficient point-primitive update) =====
  useEffect(() => {
    const viewer = viewerRef.current;
    const points = aircraftPointsRef.current;
    if (!viewer || !points) return;
    if (!aircraft) {
      points.removeAll();
      aircraftIndexRef.current.clear();
      return;
    }

    // Diff approach: keep a Map<icao24, primitiveIndex> and update positions
    // in place when aircraft are still in the snapshot, add new ones, and
    // remove ones that have left the feed. Rebuilding the whole collection
    // every poll is O(n) anyway, so we just do that for simplicity.
    points.removeAll();
    aircraftIndexRef.current.clear();
    for (const a of aircraft) {
      // Color by altitude — orange near ground, cyan in stratosphere.
      const alt = Math.max(0, a.altitudeM);
      const altT = Math.min(1, alt / 12000);  // 12km = typical commercial cruise
      const color = Cesium.Color.fromHsl(
        0.05 + altT * 0.5,    // hue: 0.05 = orange → 0.55 = cyan
        0.85,
        0.55,
        0.95
      );
      const cartesian = Cesium.Cartesian3.fromDegrees(a.lon, a.lat, alt);
      const primitive = points.add({
        position: cartesian,
        pixelSize: 6,
        color,
        outlineWidth: 0,
        scaleByDistance: new Cesium.NearFarScalar(1.0e3, 2.5, 5.0e6, 0.5),
        translucencyByDistance: new Cesium.NearFarScalar(5.0e5, 1.0, 8.0e6, 0.4),
      });
      void primitive;
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

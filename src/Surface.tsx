import { useEffect, useRef } from "react";
import * as Cesium from "cesium";
import "cesium/Build/Cesium/Widgets/widgets.css";

type FlyToTarget = { id: number; lat: number; lon: number; altKm: number };

export default function Surface({
  token,
  onCameraChange,
  flyTo
}: {
  token: string;
  onCameraChange: (lat: number, lon: number, altKm: number) => void;
  flyTo: FlyToTarget;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Cesium.Viewer | null>(null);
  const lastFlyIdRef = useRef(0);

  useEffect(() => {
    const env = (import.meta as any).env;
    const tokenToUse = token || env?.VITE_CESIUM_TOKEN || "";
    if (tokenToUse) Cesium.Ion.defaultAccessToken = tokenToUse;

    if (!containerRef.current) return;

    const viewer = new Cesium.Viewer(containerRef.current, {
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
      maximumRenderTimeChange: Infinity
    });

    viewer.scene.globe.enableLighting = true;
    if (viewer.scene.skyAtmosphere) viewer.scene.skyAtmosphere.show = true;
    viewer.scene.fog.enabled = true;

    // Add Cesium World Terrain (requires ion)
    if (tokenToUse) {
      Cesium.createWorldTerrainAsync({ requestVertexNormals: true, requestWaterMask: true })
        .then((terrain) => { viewer.terrainProvider = terrain; })
        .catch(() => {/* fallback: ellipsoid terrain */});
    }

    viewerRef.current = viewer;

    // Camera change emit
    const removeListener = viewer.camera.changed.addEventListener(() => {
      const cartographic = viewer.camera.positionCartographic;
      const lat = Cesium.Math.toDegrees(cartographic.latitude);
      const lon = Cesium.Math.toDegrees(cartographic.longitude);
      const altKm = cartographic.height / 1000;
      onCameraChange(lat, lon, altKm);
    });
    viewer.camera.percentageChanged = 0.01;

    return () => {
      removeListener?.();
      viewer.destroy();
      viewerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    if (flyTo.id === lastFlyIdRef.current) return;
    lastFlyIdRef.current = flyTo.id;
    if (flyTo.id === 0) return;
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(flyTo.lon, flyTo.lat, Math.max(500, flyTo.altKm * 1000)),
      duration: 2,
      orientation: { heading: 0, pitch: -Cesium.Math.PI_OVER_TWO, roll: 0 }
    });
  }, [flyTo]);

  // The prop may be empty if the user hasn't pasted one yet, but VITE_CESIUM_TOKEN
  // baked at build time still works. Only show the "needs token" message when
  // there's nothing to use at all.
  const env = (import.meta as any).env;
  const haveToken = !!(token || env?.VITE_CESIUM_TOKEN);

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

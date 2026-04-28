// Postbuild: vite-plugin-cesium copies its runtime assets to
// `dist/<base>/cesium/` (because of the configured `base: /atlas-globe/`),
// but the script tag it injects references `/atlas-globe/cesium/Cesium.js`,
// which after deploy resolves to `<dist>/cesium/...` — not the nested
// `<dist>/atlas-globe/cesium/...`. Net effect: 404 on Cesium.js, broken
// Surface mode.
//
// Fix: move the cesium directory back up one level so the live URL matches
// what the script tag asks for.

import { existsSync, renameSync, mkdirSync, readdirSync, copyFileSync, statSync } from "node:fs";
import { join } from "node:path";

const dist = "dist";
const nested = join(dist, "atlas-globe", "cesium");
const target = join(dist, "cesium");

if (!existsSync(nested)) {
  console.log(`[fix-cesium-paths] nothing to fix — ${nested} doesn't exist`);
  process.exit(0);
}

if (existsSync(target)) {
  console.log(`[fix-cesium-paths] ${target} already exists — assuming already fixed`);
  process.exit(0);
}

// Try a simple rename first (works when nothing else lives in dist/atlas-globe).
try {
  renameSync(nested, target);
  console.log(`[fix-cesium-paths] moved ${nested} → ${target}`);
} catch {
  // Fall back to a recursive copy.
  copyRecursive(nested, target);
  console.log(`[fix-cesium-paths] copied ${nested} → ${target}`);
}

function copyRecursive(src, dst) {
  mkdirSync(dst, { recursive: true });
  for (const entry of readdirSync(src)) {
    const sp = join(src, entry);
    const dp = join(dst, entry);
    const s = statSync(sp);
    if (s.isDirectory()) copyRecursive(sp, dp);
    else copyFileSync(sp, dp);
  }
}

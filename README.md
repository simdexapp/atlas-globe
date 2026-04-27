# Atlas Globe

Interactive 3D Earth — orbit the planet with three.js + NASA imagery, then switch to **Surface mode** for real-terrain street-level zoom powered by Cesium.

**Live demo:** https://simdexapp.github.io/atlas-globe/

## Two modes, one app

| Mode | Engine | What it gives you |
|---|---|---|
| **Atlas** | three.js + NASA Blue Marble | Smooth orbit + clouds + atmosphere + stars + lat/lon graticule. ~1MB bundle. No tokens. |
| **Surface** | Cesium ion | Real terrain elevation, zoom-to-rooftop, sky atmosphere, fog. Lazy-loaded; needs a free Cesium ion token. |

Switching is one click — your view's lat/lon hands off automatically.

## Features

- **Search & bookmarks** — built-in city presets + save/jump-to your own views
- **Sun position** — azimuth + elevation sliders that re-light the planet
- **Layer toggles** — clouds, atmosphere glow, background stars, lat/lon graticule, cardinal markers
- **Spin control** — adjustable rotation speed; auto-orbit with click-and-drag override
- **Camera readout** — live lat/lon/altitude in the footer with a scale bar
- **Frame capture** — PNG download
- **Light / dark UI theme**
- **Persistent state** — localStorage saves your bookmarks + settings
- **Keyboard shortcuts** — R reset, F search, B bookmark, L layers, T theme, H hide UI, S switch mode, ? help

## Develop

```bash
npm install
echo "VITE_CESIUM_TOKEN=your_token_here" > .env.local
npm run dev
```

Surface mode without a token falls back gracefully — you'll be prompted to paste one when you click Surface.

## Build

```bash
npm run build
npm run preview
```

## Deploy

Pushed to `main`, GitHub Actions builds with `mode=production` (sets the `/atlas-globe/` base) and publishes `dist/` to GitHub Pages.

The Cesium token is injected from the `CESIUM_ION_TOKEN` repo secret. Without it, the deployed Surface mode will prompt visitors for their own token.

⚠️ **Token security:** the Cesium token gets embedded in the deployed JS bundle (browsers need it client-side). Restrict your token at [cesium.com/ion/tokens](https://cesium.com/ion/tokens) to your GitHub Pages domain so it can't be abused elsewhere.

## Stack
- Vite 7 + React 19 + TypeScript 5
- @react-three/fiber + @react-three/drei + three.js (Atlas mode)
- Cesium 1.121 + vite-plugin-cesium (Surface mode)
- lucide-react for icons
- NASA Earth textures from threejs.org examples (public domain)

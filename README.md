# MartianMapBack

TypeScript backend for the Jezero Crater EVA route planner. It loads the HiRISE elevation and slope GeoTIFFs and the START/END waypoints, runs slope-aware A*, and serves routes plus EVA time and radiation estimates to the webapp.

## Setup

Requires Node ≥ 22.13 (uses the built-in `node:sqlite` to read the GeoPackage).

```bash
npm install
ln -s /path/to/Hackathlone-resorces data   # or set DATA_DIR=/path/to/data
npm run dev                                 # http://localhost:3001
npm test
```

The data folder must contain `jezero_elevation_crop.tif`, `jezero_slope_crop.tif` and `waypoints.gpkg`.

Environment variables: `DATA_DIR` (default `./data`), `PORT` (3001), `HOST` (0.0.0.0). They are set in `.env`; variables already set in your shell take precedence.

## API

All coordinates are **EQUIRECTANGULAR MARS metres**, not lat/lon. Endpoints accept either `{x, y}` or `{row, col}`. Response types are in `shared/types.ts`, for the webapp to import.

| Method | Path | Description |
|---|---|---|
| GET | `/api/meta` | Raster size, pixel size, origin, bounds, CRS, stats, default options |
| GET | `/api/waypoints` | START/END with pixel indices and sampled elevation/slope |
| GET | `/api/sample?x=&y=` or `?row=&col=` | Elevation/slope at a point |
| GET | `/api/layers/elevation.png`, `/api/layers/slope.png` | Coloured overlays (NoData is transparent) |
| GET | `/api/layers/elevation.bin`, `/api/layers/slope.bin` | Raw Float32 little-endian, row-major |
| POST | `/api/route` | `{ start, end, options? }` → `RouteResponse` |
| GET | `/api/route/default` | Route between the GeoPackage START and END |

### Route options (all optional)

| Option | Default | Notes |
|---|---|---|
| `cellSize` | 4 | Routing cell size in metres (1–50) |
| `aggregation` | `max` | `max` keeps narrow ridges; `p90` ignores isolated noisy pixels |
| `slopeClasses` | 0–5°: ×1, 5–10°: ×1.5, 10–15°: ×3, >15°: blocked | `multiplier: null` means impassable |
| `uphillPenalty` | 0 | Extra cost per metre climbed |
| `walkingSpeedKmh` | 1 | |
| `scienceStopMin` | 30 | |
| `returnTrip` | true | The return leg reuses the outbound path |
| `doseRateMSvPerDay` | 0.67 | Curiosity RAD historical average, not a live Jezero measurement |

## Webapp notes

Use Leaflet with `L.CRS.Simple` (or OpenLayers with a custom projection). Place `slope.png` over `meta.bounds`, then draw `route.path` and `route.straightLine.path` as polylines.

## Layout

```
shared/types.ts      API types shared with the webapp
src/data/            GeoTIFF + GeoPackage readers, pixel/world transform, Terrain
src/routing/         grid aggregation, cost grid, A*, RoutePlanner
src/analysis/        EVA time/dose metrics, PNG rendering
src/api/routes.ts    Fastify endpoints
```

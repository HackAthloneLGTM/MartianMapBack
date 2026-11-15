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

The data folder must contain `jezero_elevation_crop.tif`, `jezero_slope_crop.tif`, `marspure.tif` and `waypoints.gpkg`.

Environment variables: `DATA_DIR` (default `./data`), `PORT` (3001), `HOST` (0.0.0.0), `RADLAB` (`off` disables the RadLab download). They are set in `.env`; variables already set in your shell take precedence.

## API

All coordinates are **EQUIRECTANGULAR MARS metres**, not lat/lon. Endpoints accept either `{x, y}` or `{row, col}`. Response types are in `shared/types.ts`, for the webapp to import.

| Method | Path | Description |
|---|---|---|
| GET | `/api/meta` | Raster size, pixel size, origin, bounds, CRS, stats, default options |
| GET | `/api/waypoints` | START/END with pixel indices and sampled elevation/slope |
| GET | `/api/sample?x=&y=` or `?row=&col=` | Elevation/slope at a point |
| GET | `/api/layers/elevation.png`, `/api/layers/slope.png` | Coloured overlays (NoData is transparent) |
| GET | `/api/layers/optical.png` | RGB optical map (NoData is transparent) |
| GET | `/api/layers/elevation.bin`, `/api/layers/slope.bin` | Raw Float32 little-endian, row-major |
| GET | `/map_{map_name}/{z}/{x}/{y}/{s}` | 256×256 PNG XYZ tile for `elevation`, `slope` or `optical`; `z=0` is the complete raster |
| POST | `/api/route` | `{ start, end, options? }` → `RouteResponse` |
| GET | `/api/route/default` | Route between the GeoPackage START and END |
| GET | `/api/radiation` | Dose rate in use + max EVA reach. Optional query overrides: `doseLimitMSv`, `maxEvaMinutes`, `walkingSpeedKmh`, `scienceStopMin`, `returnTrip`, `doseRateMSvPerDay` |
| POST | `/api/radiation/refresh` | Re-download the RadLab record (slow, ~275k rows) |

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
| `doseRateMSvPerDay` | RadLab (≈0.57), else 0.67 | See *Radiation* below |
| `doseLimitMSv` | 0.25 | Per-EVA dose budget for the max-distance limit (demo assumption, not a NASA limit) |
| `maxEvaMinutes` | 480 | Hard cap on total EVA time, science stop included |

### Radiation and max EVA distance

On startup the server takes the default dose rate from [NASA RadLab](https://visualization.osdr.nasa.gov/radlab/gui/data-api): the mean of every Curiosity RAD surface `absorbed_dose_rate` reading (2015-01 to 2024-06, about 0.188 mGy/day). That mean is multiplied by a quality factor of 3.05 (Hassler et al. 2014) to get about 0.57 mSv/day. The result is cached in `.cache/radlab.json`, and later starts read the cache instead of the network. Until the first download finishes, or if RadLab is unreachable (it often resets connections), the server uses 0.67 mSv/day from the project guide. Set `RADLAB=off` to skip the network. `radiation.source` in responses tells you which value is in use (`radlab` / `cache` / `fallback`).

This is still a Gale Crater historical average. It is not a live Jezero reading, and it ignores suit shielding and solar particle events.

Every route response includes `eva`:

- `maxOneWayDistanceM`: the farthest one-way distance where walking + science stop (+ return leg) stays within both `doseLimitMSv` and `maxEvaMinutes`.
- `limitedBy`: `dose` or `time`, whichever limit is hit first.
- `doseLimitMinutes`: minutes until the dose budget runs out.
- `routeFraction`: route distance ÷ max distance (null when there's no route or the max distance is 0).

Routes longer than the max distance get an `EXCEEDS_EVA_LIMIT` warning.

## Webapp notes

Use Leaflet with `L.CRS.Simple` (or OpenLayers with a custom projection). Tile URLs are `/map_elevation/{z}/{x}/{y}/png`, `/map_slope/{z}/{x}/{y}/png` and `/map_optical/{z}/{x}/{y}/png`; at zoom 0 the tile represents the complete raster. Draw routes after scaling their raster pixel coordinates into the 256×256 map bounds.

## Layout

```
shared/types.ts      API types shared with the webapp
src/data/            GeoTIFF + GeoPackage readers, pixel/world transform, Terrain, RadLab client
src/routing/         grid aggregation, cost grid, A*, RoutePlanner
src/analysis/        EVA time/dose metrics, PNG rendering
src/api/routes.ts    Fastify endpoints
```

## Credits

Terrain data: HiRISE digital terrain model DTEEC_023524_1985_023379_1985_U01 of Jezero Crater, courtesy of NASA/JPL/University of Arizona.

Radiation data: Curiosity Radiation Assessment Detector (RAD) dose rates, courtesy of NASA/JPL-Caltech/SwRI.

## License

MIT, see [LICENSE](LICENSE).

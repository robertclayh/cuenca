# Cuenca

*Cuenca* is Spanish for river basin. It's a browser geography game in the GeoGuessr tradition, but about rivers. A game has three rounds and takes under a minute:

| Round | You see | You do | Scoring (max 5,000) |
| --- | --- | --- | --- |
| **Planform** | A river's course with nothing around it: no basemap, no labels, north up, a scale bar | Pick its name from four options | 3,000 for a right answer, plus up to 2,000 for speed |
| **Watershed** | The outline of a drainage basin and the river's name | Drop the outline on the globe | Great-circle distance from your drop point to the basin's true centroid: full marks within 25 km, then `5000·e^(−(d−25)/1000)` |
| **Cities** | The river drawn on the globe | Type the settlements on its banks | 1,000 per city, up to five |

The game is bilingual (English and Spanish, switchable mid-game) and needs no login. Each game comes from a seed, and the seed is kept in the URL, so sharing the link replays the same rounds. From the home screen you can also practise one mode for five rounds.

## How it works

```
HydroRIVERS ──┐                       ┌─ mainstem polyline ─┐
HydroBASINS ──┼─ pipeline/build_data ─┼─ basin outline ─────┼─ public/data/rivers.json ─ Vite build ─ GitHub Pages
GeoNames ─────┘   (Python, CI only)   └─ cities on banks ───┘        (static, ~1 file)
```

There is no backend. Rounds are generated in the browser from one JSON file, and MapLibre GL draws all the geometry client-side on a globe. The basemap is Natural Earth coastlines and borders from `world-atlas`, so the site needs no tile server and no API keys.

### The data pipeline (`pipeline/`)

HydroRIVERS has full network topology (`NEXT_DOWN`, `UPLAND_SKM`) but **no river names**. `pipeline/catalog.json` supplies the names. Each entry anchors a named river to the network with a mouth coordinate and an expected upstream area. The build then works through four steps for each river:

1. **Snap the mouth.** Within 60 km of the catalog mouth, it picks the reach whose upstream area best matches the expected area. Using area instead of plain distance stops a tributary's mouth from snapping onto the bigger main river at the confluence.
2. **Trace the mainstem.** By default it walks upstream, always taking the branch with the largest upstream area. Sometimes the named river isn't the hydrological mainstem: the Missouri is bigger than the upper Mississippi, the Aare is bigger than the Rhine at their confluence, and the Yamuna is bigger than the Ganges. For those rivers the catalog gives a `source` point, and the build walks *downstream* from it until it reaches the snapped mouth.
3. **Dissolve the watershed.** It takes the HydroBASINS polygon containing the mouth reach and collects every sub-basin upstream of it through the HydroBASINS `NEXT_DOWN` graph. It then dissolves them, simplifies the result, and computes an equal-area centroid. It tries levels 6, 7, 8 and 5, and keeps the level whose upstream area best matches the river's.
4. **Join the settlements.** It keeps GeoNames `cities15000` places within 12 km of the unsimplified mainstem, ranked by population. For each place it keeps every Latin-script alternate name, so "Colonia", "Viena" and "Nueva Orleans" all count as answers.

The build fails if fewer than 45 of the 63 catalog rivers come out. Each river logs one diagnostic line (snap distance, area ratio, basin level and so on), so you can see in the CI log which catalog entries need adjusting.

### The client (`src/`)

| File | Role |
| --- | --- |
| `rounds.js` | Seeded round generation. Same-continent distractors make the planform round harder. |
| `geo.js` | Haversine distance. Rodrigues rotation, so a dropped basin outline keeps its true size and shape at any latitude. Local orthographic projection for the SVG shapes. |
| `scoring.js` | The three scoring curves above. |
| `match.js` | Accent- and case-insensitive name matching that forgives a typo or two. It folds names the same way as the pipeline. |
| `map.js` | MapLibre globe with a self-hosted vector basemap. |
| `shapes.js` | SVG planforms and outlines with a scale bar and north arrow. |
| `i18n.js` | English and Spanish strings. |

## Development

```sh
npm install
pip install -r pipeline/requirements.txt

npm run data:fixture   # synthetic rivers in HydroSHEDS layout, no downloads
npm run dev
```

`data:fixture` writes made-up rivers so you can work offline. While that data is loaded, the home screen shows a "synthetic data" banner. To build the real dataset (several GB of downloads, cached in `data/raw/`):

```sh
npm run data:fetch
npm run data:build
```

Tests:

```sh
python -m pytest pipeline/tests   # pipeline against synthetic HydroSHEDS/GeoNames archives
npm test                          # client logic; also checks public/data/rivers.json when present
```

## Deployment

`.github/workflows/deploy.yml` runs on every push to `main`. It downloads HydroSHEDS and GeoNames, builds `rivers.json`, runs the tests against the real data, and publishes `dist/` to GitHub Pages. The raw downloads and the built dataset are cached separately, keyed on a hash of the pipeline code and catalog, so a change that only touches the front end skips the data step. You can force a rebuild by running the workflow manually with **rebuild_data**.

Pages has to be enabled once, in **Settings → Pages → Source: GitHub Actions**.

## Data and credits

- **HydroRIVERS v1.0 and HydroBASINS v1c.** Lehner, B., Grill G. (2013): Global river hydrography and network routing: baseline data and new approaches to study the world's large river systems. *Hydrological Processes*, 27(15): 2171–2186. [hydrosheds.org](https://www.hydrosheds.org), used under the HydroSHEDS licence.
- **GeoNames** `cities15000`, CC BY 4.0, [geonames.org](https://www.geonames.org).
- **Natural Earth** coastlines and borders via [`world-atlas`](https://github.com/topojson/world-atlas), public domain.
- Rendering: [MapLibre GL JS](https://maplibre.org).

"""Write small synthetic archives that mimic the HydroSHEDS / GeoNames layouts.

The geography is fake: meandering rivers drawn from a seeded random walk.
It exists so the pipeline can be tested offline and the client can be
developed without the multi-gigabyte real downloads. Never deploy it.

    python pipeline/tests/make_fixtures.py data/fixture-raw
"""

import json
import math
import random
import sys
import tempfile
import zipfile
from pathlib import Path

import geopandas as gpd
from shapely.geometry import LineString, box

REG = "xx"

# Hand-placed rivers the tests assert on, then procedural ones for the dev build.
SPECIAL = [
    # alpha: its named source branch is smaller than tributary "beta", so the
    # catalog gives a source and the trace must go downstream from it.
    dict(id="alpha", start=(10.0, 50.0), heading=0.0, reaches=40, tributary_at=20, tributary_upland=6000),
    dict(id="gamma", start=(20.0, 40.0), heading=-0.6, reaches=30),
]
PROCEDURAL = 8


def walk(rng, start, heading, n, step=0.12, wiggle=0.35):
    pts = [start]
    for _ in range(n):
        heading += rng.uniform(-wiggle, wiggle)
        x, y = pts[-1]
        pts.append((x + step * math.cos(heading), y + step * math.sin(heading)))
    return pts


def build(seed=7):
    rng = random.Random(seed)
    reaches, basins6, basins7, cities, catalog = [], [], [], [], []
    rid, bid = 10_000_000, 1_000_000_000

    specs = list(SPECIAL)
    for k in range(PROCEDURAL):
        lon = -60 + 25 * (k % 4) + rng.uniform(-3, 3)
        lat = -30 + 30 * (k // 4) + rng.uniform(-3, 3)
        specs.append(dict(id=f"synth{k + 1}", start=(lon, lat), heading=rng.uniform(-3, 3),
                          reaches=rng.randint(25, 60)))

    for spec in specs:
        pts = walk(rng, spec["start"], spec["heading"], spec["reaches"])
        n = spec["reaches"]
        ids = [rid + i for i in range(n)]
        rid += n + 100
        upland = [150.0 + 120 * i for i in range(n)]
        trib = spec.get("tributary_at")
        trib_ids = []
        if trib is not None:
            tn = 15
            # tributary joins at pts[trib], approaching from the north
            tpts = walk(rng, (pts[trib][0] - 0.3, pts[trib][1] + 1.6), -1.4, tn - 1, step=0.11, wiggle=0.2)
            tpts[-1] = pts[trib]
            tupl = [spec["tributary_upland"] * (i + 1) / tn for i in range(tn)]
            trib_ids = [rid + i for i in range(tn)]
            rid += tn + 100
            for i in range(tn - 1):
                nxt = trib_ids[i + 1] if i + 1 < tn - 1 else ids[trib]
                reaches.append(dict(HYRIV_ID=trib_ids[i], NEXT_DOWN=nxt, LENGTH_KM=12.0,
                                    UPLAND_SKM=tupl[i], DIS_AV_CMS=tupl[i] / 100,
                                    geometry=LineString([tpts[i], tpts[i + 1]])))
            for i in range(trib, n):
                upland[i] += spec["tributary_upland"]
        for i in range(n):
            seg = [pts[i], pts[i + 1]]
            if rng.random() < 0.3:  # exercise orientation repair
                seg.reverse()
            reaches.append(dict(HYRIV_ID=ids[i], NEXT_DOWN=ids[i + 1] if i + 1 < n else 0,
                                LENGTH_KM=13.0, UPLAND_SKM=upland[i], DIS_AV_CMS=upland[i] / 80,
                                geometry=LineString(seg)))
        # a tiny side stream on every 5th reach, below the build's upland filter
        for i in range(0, n, 5):
            x, y = pts[i]
            reaches.append(dict(HYRIV_ID=rid, NEXT_DOWN=ids[i], LENGTH_KM=3.0, UPLAND_SKM=40.0,
                                DIS_AV_CMS=0.4, geometry=LineString([(x + 0.05, y + 0.08), (x, y)])))
            rid += 1

        mouth = pts[-1]
        source = pts[0]
        catalog.append({
            "id": spec["id"],
            "name": {"en": spec["id"].capitalize(), "es": spec["id"].capitalize() + " (es)"},
            "continent": "eu",
            "mouth": [round(mouth[0] - 0.02, 4), round(mouth[1] + 0.02, 4)],
            "areaKm2": round(upland[-1]),
            **({"source": [round(source[0] + 0.03, 4), round(source[1] - 0.02, 4)]} if trib is not None else {}),
        })

        # level 6: groups of 8 reaches; level 7: one cell per reach
        for level, group, sink in ((6, 8, basins6), (7, 1, basins7)):
            cell_ids = []
            for g in range(0, n, group):
                seg_pts = pts[g:g + group + 1]
                xs, ys = [p[0] for p in seg_pts], [p[1] for p in seg_pts]
                cell_ids.append((bid, box(min(xs) - 0.25, min(ys) - 0.25, max(xs) + 0.25, max(ys) + 0.25),
                                 upland[min(g + group, n) - 1]))
                bid += 1
            for j, (cid, geom, up) in enumerate(cell_ids):
                sink.append(dict(HYBAS_ID=cid, NEXT_DOWN=cell_ids[j + 1][0] if j + 1 < len(cell_ids) else 0,
                                 UP_AREA=up, geometry=geom))
            if trib is not None:
                txs = [p[0] for p in tpts]
                tys = [p[1] for p in tpts]
                into = cell_ids[trib // group][0]
                sink.append(dict(HYBAS_ID=bid, NEXT_DOWN=into, UP_AREA=spec["tributary_upland"],
                                 geometry=box(min(txs) - 0.2, min(tys) + 0.1, max(txs) + 0.2, max(tys) + 0.2)))
                bid += 1

        # settlements: on the river, near it, and far from it
        for k, i in enumerate(range(3, n, max(3, n // 7))):
            x, y = pts[i]
            cities.append(city(len(cities) + 1, f"{spec['id'].capitalize()} Town {k + 1}", x + 0.02, y - 0.01,
                               20_000 + 9_000 * k))
        far = pts[n // 2]
        cities.append(city(len(cities) + 1, f"Far {spec['id']}", far[0] + 1.5, far[1] + 1.5, 900_000))

    a = catalog[0]
    mid = next(r for r in reaches if r["HYRIV_ID"] == 10_000_000 + 30)["geometry"].coords[0]
    cities.append(city(len(cities) + 1, "Kölnberg", mid[0] + 0.03, mid[1], 1_100_000,
                       alt="Colonia del Río,Кёльнберг,KLB,Koelnberg"))
    cities.append(city(len(cities) + 1, "Old Quarter", mid[0] + 0.01, mid[1], 50_000, code="PPLX"))
    catalog.append({**a, "id": "wrongarea", "name": {"en": "Wrong", "es": "Mal"}, "areaKm2": a["areaKm2"] * 50})
    return reaches, basins6, basins7, cities, catalog


def city(gid, name, lon, lat, pop, alt="", code="PPL"):
    ascii_name = name.encode("ascii", "ignore").decode()
    return [str(gid), name, ascii_name, alt, f"{lat:.5f}", f"{lon:.5f}", "P", code, "XX", "", "01", "",
            "", "", str(pop), "", "100", "Etc/UTC", "2024-01-01"]


def write_shp_zip(rows, zip_path, inner_dir, stem):
    gdf = gpd.GeoDataFrame(rows, geometry="geometry", crs="EPSG:4326")
    with tempfile.TemporaryDirectory() as tmp:
        shp = Path(tmp) / f"{stem}.shp"
        gdf.to_file(shp, driver="ESRI Shapefile")
        mode = "a" if zip_path.exists() else "w"
        with zipfile.ZipFile(zip_path, mode) as zf:
            for f in sorted(Path(tmp).iterdir()):
                zf.write(f, f"{inner_dir}{f.name}")


def write_all(raw):
    raw = Path(raw)
    reaches, b6, b7, cities, catalog = build()
    for sub in ("hydrorivers", "hydrobasins", "geonames"):
        (raw / sub).mkdir(parents=True, exist_ok=True)
    rz = raw / "hydrorivers" / f"HydroRIVERS_v10_{REG}_shp.zip"
    bz = raw / "hydrobasins" / f"hybas_{REG}_lev01-12_v1c.zip"
    for z in (rz, bz):
        z.unlink(missing_ok=True)
    write_shp_zip(reaches, rz, f"HydroRIVERS_v10_{REG}_shp/", f"HydroRIVERS_v10_{REG}")
    write_shp_zip(b6, bz, "", f"hybas_{REG}_lev06_v1c")
    write_shp_zip(b7, bz, "", f"hybas_{REG}_lev07_v1c")
    with zipfile.ZipFile(raw / "geonames" / "cities15000.zip", "w") as zf:
        zf.writestr("cities15000.txt", "\n".join("\t".join(c) for c in cities) + "\n")
    (raw / "catalog.json").write_text(json.dumps({"synthetic": True, "rivers": catalog}, ensure_ascii=False, indent=1), encoding="utf-8")
    return raw / "catalog.json"


if __name__ == "__main__":
    print(write_all(sys.argv[1] if len(sys.argv) > 1 else "data/fixture-raw"))

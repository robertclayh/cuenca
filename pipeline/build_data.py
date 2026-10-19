"""Build the game's river dataset from HydroSHEDS and GeoNames.

Inputs (see fetch.py):
  <raw>/hydrorivers/HydroRIVERS_v10_<reg>_shp.zip   river reaches + topology
  <raw>/hydrobasins/hybas_<reg>_lev01-12_v1c.zip    nested basin polygons
  <raw>/geonames/cities15000.zip                    settlements >= 15k people

For every catalog entry this traces the named mainstem through the
HydroRIVERS network, dissolves the HydroBASINS polygons upstream of its
mouth into a single watershed outline, and joins the GeoNames settlements
that sit on the river. Output is one compact JSON file the client loads.
"""

import argparse
import json
import math
import re
import sys
import unicodedata
import zipfile
from collections import deque
from datetime import datetime, timezone
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd
import pyogrio
import shapely
import shapely.ops
from pyproj import CRS
from shapely.geometry import MultiPolygon, Point, Polygon, box

HERE = Path(__file__).resolve().parent
RIVER_COLS = ["HYRIV_ID", "NEXT_DOWN", "LENGTH_KM", "UPLAND_SKM", "DIS_AV_CMS"]
BASIN_COLS = ["HYBAS_ID", "NEXT_DOWN", "UP_AREA"]
BASIN_LEVELS = [6, 7, 8, 5]
GEONAMES_COLS = [
    "geonameid", "name", "asciiname", "alternatenames", "latitude", "longitude",
    "feature_class", "feature_code", "country_code", "cc2", "admin1", "admin2",
    "admin3", "admin4", "population", "elevation", "dem", "timezone", "modified",
]
SKIP_FEATURE_CODES = {"PPLX", "PPLH", "PPLW", "PPLQ", "PPLCH"}
EARTH_RADIUS_KM = 6371.0088

ATTRIBUTION = {
    "hydrosheds": "HydroRIVERS v1.0 and HydroBASINS v1c, Lehner & Grill (2013), www.hydrosheds.org",
    "geonames": "GeoNames cities15000, CC BY 4.0, www.geonames.org",
}


def log(msg):
    print(msg, file=sys.stderr, flush=True)


# ---------------------------------------------------------------- geometry

def haversine_km(lon1, lat1, lon2, lat2):
    lon1, lat1, lon2, lat2 = map(np.radians, (lon1, lat1, lon2, lat2))
    a = np.sin((lat2 - lat1) / 2) ** 2 + np.cos(lat1) * np.cos(lat2) * np.sin((lon2 - lon1) / 2) ** 2
    return 2 * EARTH_RADIUS_KM * np.arcsin(np.sqrt(np.clip(a, 0, 1)))


def search_box(lon, lat, radius_km):
    dlat = radius_km / 111.2
    dlon = dlat / max(math.cos(math.radians(lat)), 0.05)
    return box(lon - dlon, lat - dlat, lon + dlon, lat + dlat)


def distance_to_geom_km(geom, lon, lat):
    """Great-circle distance from a point to the planar-nearest point of geom."""
    pt = Point(lon, lat)
    near = geom.interpolate(geom.project(pt)) if "LineString" in geom.geom_type \
        else shapely.ops.nearest_points(geom, pt)[0]
    return float(haversine_km(lon, lat, near.x, near.y))


def line_coords(geom):
    if geom.geom_type == "LineString":
        return list(geom.coords)
    return [c for part in geom.geoms for c in part.coords]


def chain_reaches(geoms):
    """Concatenate reach lines (ordered source -> mouth) into one coordinate list,
    flipping any reach whose digitizing direction disagrees with its neighbours."""
    def d2(a, b):
        return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2

    out = []
    for i, geom in enumerate(geoms):
        coords = line_coords(geom)
        if out:
            if d2(coords[-1], out[-1]) < d2(coords[0], out[-1]):
                coords.reverse()
            if coords[0] == out[-1]:
                coords = coords[1:]
        elif len(geoms) > 1:
            nxt = line_coords(geoms[1])
            ends = (nxt[0], nxt[-1])
            if min(d2(coords[0], e) for e in ends) < min(d2(coords[-1], e) for e in ends):
                coords.reverse()
        out.extend(coords)
    return out


def local_crs(lon, lat, proj="laea"):
    return CRS.from_proj4(f"+proj={proj} +lat_0={lat:.5f} +lon_0={lon:.5f} +datum=WGS84 +units=m +no_defs")


def round_coords(coords, nd=3):
    out = []
    for x, y in coords:
        p = [round(x, nd), round(y, nd)]
        if not out or out[-1] != p:
            out.append(p)
    return out


# ---------------------------------------------------------------- text

def fold(text):
    """Accent- and punctuation-insensitive key; mirrored by src/match.js."""
    text = unicodedata.normalize("NFD", text)
    text = "".join(ch for ch in text if unicodedata.category(ch) != "Mn")
    text = re.sub(r"[^0-9a-z]+", " ", text.lower().replace("ß", "ss"))
    return text.strip()


def is_latin(text):
    for ch in text:
        if ch.isascii() or ch in "’ʻ":
            continue
        if ch.isalpha() and "LATIN" in unicodedata.name(ch, ""):
            continue
        return False
    return True


def city_names(row, limit=24):
    """The official name first, then typeable alternates (exonyms such as
    "Colonia" for Köln). Codes, digits and non-Latin scripts are dropped
    from the alternates only."""
    primary = [row["name"].strip(), row["asciiname"].strip()]
    names, seen = [], set()
    for i, name in enumerate([*primary, *row["alternatenames"].split(",")]):
        name = name.strip()
        key = fold(name)
        if not key or key in seen:
            continue
        if i >= len(primary) and (
            not (2 <= len(name) <= 40) or not is_latin(name)
            or re.search(r"\d", name) or (name.isupper() and len(name) <= 4)  # "NYC", "LAX"
        ):
            continue
        seen.add(key)
        names.append(name)
        if len(names) >= limit:
            break
    return names


# ---------------------------------------------------------------- loading

def shp_members(zip_path, pattern):
    with zipfile.ZipFile(zip_path) as zf:
        members = [m for m in zf.namelist() if re.search(pattern, m, re.IGNORECASE)]
    return [f"/vsizip/{zip_path.resolve()}/{m}" for m in sorted(members)]


def read_layers(paths, columns, where=None):
    frames = []
    for path in paths:
        log(f"  read {path.split('/vsizip/')[-1]}")
        frames.append(pyogrio.read_dataframe(path, columns=columns, where=where))
    if not frames:
        return None
    gdf = pd.concat(frames, ignore_index=True)
    return gpd.GeoDataFrame(gdf, geometry="geometry", crs="EPSG:4326")


def load_rivers(raw, min_upland):
    paths = [p for z in sorted((raw / "hydrorivers").glob("*.zip")) for p in shp_members(z, r"\.shp$")]
    if not paths:
        sys.exit(f"no HydroRIVERS archives under {raw / 'hydrorivers'}")
    gdf = read_layers(paths, RIVER_COLS, where=f"UPLAND_SKM >= {min_upland}")
    gdf = gdf.drop_duplicates("HYRIV_ID").set_index("HYRIV_ID", drop=False)
    log(f"  {len(gdf):,} reaches with upstream area >= {min_upland} km²")
    return gdf


class Basins:
    """Lazily loads one HydroBASINS level at a time across all regions."""

    def __init__(self, raw):
        self.zips = sorted((raw / "hydrobasins").glob("*.zip"))
        self.levels = {}

    def level(self, lev):
        if lev not in self.levels:
            paths = [p for z in self.zips for p in shp_members(z, rf"lev{lev:02d}_v1c\.shp$")]
            gdf = read_layers(paths, BASIN_COLS)
            if gdf is not None:
                gdf = gdf.drop_duplicates("HYBAS_ID").set_index("HYBAS_ID", drop=False)
                upstream = {}
                for hid, nxt in zip(gdf["HYBAS_ID"].to_numpy(), gdf["NEXT_DOWN"].to_numpy()):
                    upstream.setdefault(int(nxt), []).append(int(hid))
                gdf.attrs["upstream"] = upstream
            self.levels[lev] = gdf
        return self.levels[lev]


def load_cities(raw):
    zpath = raw / "geonames" / "cities15000.zip"
    with zipfile.ZipFile(zpath) as zf:
        member = next(m for m in zf.namelist() if m.endswith(".txt"))
        with zf.open(member) as fh:
            df = pd.read_csv(fh, sep="\t", header=None, names=GEONAMES_COLS, dtype=str,
                             quoting=3, keep_default_na=False, na_filter=False)
    df = df[(df["feature_class"] == "P") & ~df["feature_code"].isin(SKIP_FEATURE_CODES)].copy()
    df["lon"] = df["longitude"].astype(float)
    df["lat"] = df["latitude"].astype(float)
    df["pop"] = pd.to_numeric(df["population"], errors="coerce").fillna(0).astype(int)
    log(f"  {len(df):,} GeoNames settlements")
    return df.reset_index(drop=True)


# ---------------------------------------------------------------- tracing

class Network:
    def __init__(self, rivers):
        self.rivers = rivers
        self.next_down = dict(zip(rivers["HYRIV_ID"].to_numpy().tolist(), rivers["NEXT_DOWN"].to_numpy().tolist()))
        self.upland = dict(zip(rivers["HYRIV_ID"].to_numpy().tolist(), rivers["UPLAND_SKM"].to_numpy().tolist()))
        self.upstream = {}
        for rid, nxt in self.next_down.items():
            self.upstream.setdefault(nxt, []).append(rid)
        self.sindex = rivers.sindex

    def near(self, lon, lat, radius_km):
        """Reaches within radius_km of a point, nearest first, as (id, km) pairs."""
        idx = self.sindex.query(search_box(lon, lat, radius_km))
        hits = []
        for i in idx:
            row = self.rivers.iloc[i]
            km = distance_to_geom_km(row.geometry, lon, lat)
            if km <= radius_km:
                hits.append((int(row["HYRIV_ID"]), km))
        return sorted(hits, key=lambda h: h[1])

    def snap_mouth(self, lon, lat, area, radius_km):
        best = None
        for rid, km in self.near(lon, lat, radius_km):
            score = abs(math.log(self.upland[rid] / area)) + 0.3 * km / radius_km
            if best is None or score < best[0]:
                best = (score, rid, km)
        return best

    def trace_up(self, mouth_id):
        path = [mouth_id]
        while self.upstream.get(path[-1]):
            path.append(max(self.upstream[path[-1]], key=self.upland.__getitem__))
        return path[::-1]

    def trace_down(self, source_id, mouth_id):
        path, cur = [], source_id
        while cur in self.next_down and len(path) < 200_000:
            path.append(cur)
            if cur == mouth_id:
                return path
            cur = self.next_down[cur]
        return None

    def trace_from_source(self, lon, lat, mouth_id, radius_km):
        for rid, _ in self.near(lon, lat, radius_km)[:40]:
            path = self.trace_down(rid, mouth_id)
            if path:
                return path
        return None


# ---------------------------------------------------------------- basins

def basin_for(basins, point, target_area):
    """Dissolve the HydroBASINS polygons upstream of `point`, picking the
    level whose upstream area best matches the river's own upstream area."""
    best = None
    for lev in BASIN_LEVELS:
        gdf = basins.level(lev)
        if gdf is None:
            continue
        hits = gdf.sindex.query(point, predicate="intersects")
        if len(hits) == 0:
            hits = gdf.sindex.query(point.buffer(0.1), predicate="intersects")
        for i in hits:
            row = gdf.iloc[i]
            err = abs(math.log(max(float(row["UP_AREA"]), 1) / target_area))
            if best is None or err < best[0]:
                best = (err, lev, int(row["HYBAS_ID"]))
        if best and best[0] < math.log(1.1):
            break
    if best is None:
        return None
    err, lev, root = best
    gdf = basins.level(lev)
    upstream = gdf.attrs["upstream"]
    ids, queue = [], deque([root])
    while queue:
        hid = queue.popleft()
        ids.append(hid)
        queue.extend(upstream.get(hid, []))
    geom = shapely.make_valid(shapely.union_all(gdf.loc[ids].geometry.to_numpy()))
    return {"geometry": geom, "level": lev, "count": len(ids), "ratio": math.exp(err)}


def polygon_parts(geom):
    if isinstance(geom, Polygon):
        return [geom]
    if isinstance(geom, MultiPolygon):
        return list(geom.geoms)
    return [g for g in getattr(geom, "geoms", []) if isinstance(g, Polygon)]


def outline(geom, tolerance):
    """Exterior rings only, slivers dropped, simplified, as GeoJSON MultiPolygon coords."""
    parts = sorted(polygon_parts(geom), key=lambda p: p.area, reverse=True)
    total = sum(p.area for p in parts)
    rings = []
    for part in parts:
        if part.area < 0.01 * total:
            break
        shell = Polygon(part.exterior).simplify(tolerance, preserve_topology=True)
        if shell.is_empty or not isinstance(shell, Polygon):
            continue
        coords = round_coords(shell.exterior.coords)
        if len(coords) >= 4:
            if coords[0] != coords[-1]:
                coords.append(coords[0])
            rings.append([coords])
    return rings


def area_and_centroid(geom):
    rp = geom.representative_point()
    crs = local_crs(rp.x, rp.y, "laea")
    projected = gpd.GeoSeries([geom], crs="EPSG:4326").to_crs(crs)
    centroid = projected.centroid.to_crs("EPSG:4326").iloc[0]
    return float(projected.area.iloc[0]) / 1e6, [round(centroid.x, 3), round(centroid.y, 3)]


# ---------------------------------------------------------------- cities

def cities_along(cities, line, buffer_km, limit):
    minx, miny, maxx, maxy = line.bounds
    pad = buffer_km / 111.2
    lon_pad = pad / max(math.cos(math.radians(max(abs(miny), abs(maxy)))), 0.1)
    cand = cities[(cities["lon"].between(minx - lon_pad, maxx + lon_pad))
                  & (cities["lat"].between(miny - pad, maxy + pad))]
    picked = []
    for _, row in cand.iterrows():
        km = distance_to_geom_km(line, row["lon"], row["lat"])
        if km <= buffer_km:
            picked.append((row, km))
    picked.sort(key=lambda rk: -rk[0]["pop"])
    out = []
    for row, km in picked[:limit]:
        out.append({
            "id": int(row["geonameid"]),
            "name": row["name"],
            "names": city_names(row),
            "cc": row["country_code"],
            "pop": int(row["pop"]),
            "lon": round(row["lon"], 3),
            "lat": round(row["lat"], 3),
            "km": round(km, 1),
        })
    return out


# ---------------------------------------------------------------- main

def build_river(entry, net, basins, cities, opts):
    rid = entry["id"]
    mlon, mlat = entry["mouth"]
    snap = net.snap_mouth(mlon, mlat, entry["areaKm2"], opts.mouth_radius_km)
    if snap is None:
        return None, f"{rid}: no reach within {opts.mouth_radius_km} km of mouth"
    _, mouth_id, mouth_km = snap
    mouth_upland = net.upland[mouth_id]
    ratio = mouth_upland / entry["areaKm2"]
    if not (1 / opts.max_area_ratio <= ratio <= opts.max_area_ratio):
        return None, f"{rid}: best reach upland {mouth_upland:,.0f} km² vs expected {entry['areaKm2']:,} km²"

    path, how = None, "upstream"
    if entry.get("source"):
        path = net.trace_from_source(*entry["source"], mouth_id, opts.source_radius_km)
        how = "source" if path else "upstream (source not connected)"
    if not path:
        path = net.trace_up(mouth_id)

    reaches = net.rivers.loc[path]
    line = shapely.LineString(chain_reaches(list(reaches.geometry)))
    minx, miny, maxx, maxy = line.bounds
    diag = math.hypot(maxx - minx, maxy - miny)
    simple = line.simplify(diag * opts.line_tolerance, preserve_topology=False)

    mouth_geom = net.rivers.loc[mouth_id].geometry
    basin = basin_for(basins, mouth_geom.interpolate(0.5, normalized=True), mouth_upland)
    record = {
        "id": rid,
        "name": entry["name"],
        "continent": entry["continent"],
        "lengthKm": round(float(reaches["LENGTH_KM"].sum())),
        "upstreamKm2": round(mouth_upland),
        "dischargeCms": round(float(net.rivers.loc[mouth_id, "DIS_AV_CMS"]), 1),
        "mouth": [round(c, 3) for c in simple.coords[-1]],
        "source": [round(c, 3) for c in simple.coords[0]],
        "line": round_coords(simple.coords),
        "basin": None,
        "basinKm2": None,
        "basinCentroid": None,
        "cities": cities_along(cities, line, opts.city_buffer_km, opts.max_cities) if cities is not None else [],
    }
    note = f"{rid}: {len(path)} reaches via {how}, mouth snapped {mouth_km:.1f} km, area x{ratio:.2f}"
    if basin:
        bminx, bminy, bmaxx, bmaxy = basin["geometry"].bounds
        tol = math.hypot(bmaxx - bminx, bmaxy - bminy) * opts.basin_tolerance
        record["basin"] = outline(basin["geometry"], tol)
        record["basinKm2"], record["basinCentroid"] = area_and_centroid(basin["geometry"])
        record["basinKm2"] = round(record["basinKm2"])
        note += f", basin lev{basin['level']:02d} x{basin['count']} (x{basin['ratio']:.2f})"
    note += f", {len(record['line'])} pts, {len(record['cities'])} cities"
    return record, note


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--raw-dir", default="data/raw", type=Path)
    ap.add_argument("--catalog", default=HERE / "catalog.json", type=Path)
    ap.add_argument("--out", default="public/data/rivers.json", type=Path)
    ap.add_argument("--min-upland", type=float, default=100, help="drop reaches draining less than this (km²)")
    ap.add_argument("--mouth-radius-km", type=float, default=60)
    ap.add_argument("--source-radius-km", type=float, default=60)
    ap.add_argument("--max-area-ratio", type=float, default=2.0)
    ap.add_argument("--city-buffer-km", type=float, default=12)
    ap.add_argument("--max-cities", type=int, default=14)
    ap.add_argument("--line-tolerance", type=float, default=0.0012, help="fraction of bbox diagonal")
    ap.add_argument("--basin-tolerance", type=float, default=0.003, help="fraction of bbox diagonal")
    ap.add_argument("--min-rivers", type=int, default=1, help="fail unless at least this many rivers build")
    opts = ap.parse_args(argv)

    catalog_doc = json.loads(opts.catalog.read_text(encoding="utf-8"))
    catalog = catalog_doc["rivers"]
    log("loading HydroRIVERS")
    net = Network(load_rivers(opts.raw_dir, opts.min_upland))
    basins = Basins(opts.raw_dir)
    log("loading GeoNames")
    cities = load_cities(opts.raw_dir)

    rivers, failures = [], []
    for entry in catalog:
        record, note = build_river(entry, net, basins, cities, opts)
        log(("  ok   " if record else "  FAIL ") + note)
        (rivers.append(record) if record else failures.append(note))

    if len(rivers) < opts.min_rivers:
        sys.exit(f"only {len(rivers)} rivers built (need {opts.min_rivers}); failures:\n" + "\n".join(failures))

    payload = {
        "version": 1,
        "generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "attribution": ATTRIBUTION,
        **({"synthetic": True} if catalog_doc.get("synthetic") else {}),
        "rivers": rivers,
    }
    opts.out.parent.mkdir(parents=True, exist_ok=True)
    opts.out.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    log(f"wrote {opts.out} ({opts.out.stat().st_size / 1024:.0f} KiB, {len(rivers)} rivers, {len(failures)} failed)")


if __name__ == "__main__":
    main()

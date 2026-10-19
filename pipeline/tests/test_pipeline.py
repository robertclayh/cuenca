import json
import sys
from pathlib import Path

import pytest
from shapely.geometry import LineString, Polygon

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import build_data  # noqa: E402
import make_fixtures  # noqa: E402


@pytest.fixture(scope="module")
def built(tmp_path_factory):
    raw = tmp_path_factory.mktemp("raw")
    catalog = make_fixtures.write_all(raw)
    out = raw / "rivers.json"
    build_data.main(["--raw-dir", str(raw), "--catalog", str(catalog), "--out", str(out)])
    data = json.loads(out.read_text(encoding="utf-8"))
    return {r["id"]: r for r in data["rivers"]}, data


def test_payload_shape(built):
    rivers, data = built
    assert data["version"] == 1
    assert data["synthetic"] is True
    assert "hydrosheds" in data["attribution"] and "geonames" in data["attribution"]
    assert set(rivers) >= {"alpha", "gamma", "synth1"}


def test_bad_area_is_rejected_not_fatal(built):
    rivers, _ = built
    assert "wrongarea" not in rivers


def test_source_trace_follows_named_branch(built):
    alpha = built[0]["alpha"]
    # source branch starts at (10, 50); the larger tributary starts ~1.6° north
    lon, lat = alpha["source"]
    assert abs(lon - 10.0) < 0.05 and abs(lat - 50.0) < 0.05
    assert alpha["lengthKm"] == 40 * 13


def test_upstream_trace_reaches_headwater(built):
    gamma = built[0]["gamma"]
    lon, lat = gamma["source"]
    assert abs(lon - 20.0) < 0.05 and abs(lat - 40.0) < 0.05
    assert gamma["lengthKm"] == 30 * 13


def test_line_is_continuous(built):
    # a reach chained in the wrong direction adds a back-and-forth jump, so the
    # simplified line would come out longer than the 40 x 0.12° random walk
    line = LineString(built[0]["alpha"]["line"])
    assert 0.85 * 40 * 0.12 < line.length <= 40 * 0.12 + 0.01


def test_basin_dissolved_and_includes_tributary(built):
    alpha = built[0]["alpha"]
    assert alpha["basin"] and len(alpha["basin"]) == 1, "upstream cells should dissolve to one polygon"
    ring = alpha["basin"][0][0]
    assert ring[0] == ring[-1]
    tributary_cell = next(b for b in make_fixtures.build()[1] if b["UP_AREA"] == 6000)["geometry"]
    assert Polygon(ring).contains(tributary_cell.centroid), "tributary sub-basin is missing"
    clon, clat = alpha["basinCentroid"]
    assert 10 < clon < 16 and 48 < clat < 53
    assert alpha["basinKm2"] > 10_000


def test_cities_join(built):
    alpha = built[0]["alpha"]
    names = [c["name"] for c in alpha["cities"]]
    assert "Kölnberg" in names
    assert "Old Quarter" not in names, "PPLX sections must be dropped"
    assert not any(n.startswith("Far ") for n in names)
    pops = [c["pop"] for c in alpha["cities"]]
    assert pops == sorted(pops, reverse=True)
    koln = next(c for c in alpha["cities"] if c["name"] == "Kölnberg")
    assert "Colonia del Río" in koln["names"]
    assert "Кёльнберг" not in koln["names"], "non-Latin names are not typeable answers"
    assert "KLB" not in koln["names"]
    assert koln["names"][0] == "Kölnberg"
    town = next(c for c in alpha["cities"] if c["name"].startswith("Alpha Town"))
    assert town["names"][0] == town["name"], "official names with digits must stay answerable"
    assert all(c["km"] <= 12 for c in alpha["cities"])


def test_fold_matches_client_rules():
    assert build_data.fold("São Paulo") == "sao paulo"
    assert build_data.fold("Köln-Ehrenfeld") == "koln ehrenfeld"
    assert build_data.fold("  St. John's ") == "st john s"
    assert build_data.fold("Straße") == "strasse"

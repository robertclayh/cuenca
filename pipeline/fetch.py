"""Download the raw HydroSHEDS and GeoNames archives the build needs.

Files land in <raw-dir>/{hydrorivers,hydrobasins,geonames}/ and are skipped
when already present, so a CI cache of the raw directory makes reruns free.
"""

import argparse
import shutil
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

REGIONS = ["af", "ar", "as", "au", "eu", "na", "sa", "si"]

HYDRORIVERS_URL = "https://data.hydrosheds.org/file/HydroRIVERS/HydroRIVERS_v10_{reg}_shp.zip"
HYDROBASINS_URL = "https://data.hydrosheds.org/file/hydrobasins/standard/hybas_{reg}_lev01-12_v1c.zip"
GEONAMES_URL = "https://download.geonames.org/export/dump/cities15000.zip"


def targets(regions):
    for reg in regions:
        yield "hydrorivers", HYDRORIVERS_URL.format(reg=reg)
        yield "hydrobasins", HYDROBASINS_URL.format(reg=reg)
    yield "geonames", GEONAMES_URL


def download(url, dest, attempts=4):
    tmp = dest.with_suffix(dest.suffix + ".part")
    for attempt in range(attempts):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "cuenca-data-pipeline"})
            with urllib.request.urlopen(req, timeout=120) as resp, open(tmp, "wb") as out:
                shutil.copyfileobj(resp, out, length=1 << 20)
            tmp.rename(dest)
            return
        except urllib.error.HTTPError as err:
            if err.code == 404:
                raise
            print(f"  {url}: HTTP {err.code}, retrying", file=sys.stderr)
        except (urllib.error.URLError, TimeoutError, ConnectionError) as err:
            print(f"  {url}: {err}, retrying", file=sys.stderr)
        time.sleep(2 ** (attempt + 1))
    raise RuntimeError(f"giving up on {url}")


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--raw-dir", default="data/raw", type=Path)
    ap.add_argument("--regions", default=",".join(REGIONS))
    args = ap.parse_args(argv)

    for kind, url in targets(args.regions.split(",")):
        dest = args.raw_dir / kind / url.rsplit("/", 1)[1]
        if dest.exists():
            print(f"have {dest}")
            continue
        dest.parent.mkdir(parents=True, exist_ok=True)
        print(f"get  {url}")
        try:
            download(url, dest)
        except urllib.error.HTTPError as err:
            # a missing region shouldn't sink the build; build_data's
            # --min-rivers check decides whether enough data arrived
            print(f"skip {url}: HTTP {err.code}", file=sys.stderr)


if __name__ == "__main__":
    main()

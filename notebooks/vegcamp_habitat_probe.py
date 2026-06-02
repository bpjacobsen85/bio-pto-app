"""Probe VegCAMP coverage and optional CAL FIRE WHR13 habitats for an AOI.

This standalone utility is intentionally separate from the BIO PTO model
notebook. It is for testing the vegetation-data workflow before deciding what
belongs in the production notebook or app.

Examples:
  python notebooks/vegcamp_habitat_probe.py ^
    --aoi-layer-url https://services.arcgis.com/.../FeatureServer/0

  python notebooks/vegcamp_habitat_probe.py ^
    --aoi-layer-url https://services.arcgis.com/.../FeatureServer/0 ^
    --sample-whr13 --grid-size 10

Optional:
  set ARCGIS_TOKEN=... if the AOI layer is private.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any


VEGCAMP_MAPPING_AREAS_URL = (
    "https://services2.arcgis.com/Uq9r85Potqm3MfRV/arcgis/rest/services/"
    "biosds515_fpu/FeatureServer/0"
)
VEGCAMP_SAMPLING_ONLY_AREAS_URL = (
    "https://services2.arcgis.com/Uq9r85Potqm3MfRV/arcgis/rest/services/"
    "biosds3103_fpu/FeatureServer/0"
)
CALFIRE_WHR13_MAPSERVER_URL = (
    "https://egis.fire.ca.gov/arcgis/rest/services/FRAP/fveg_WHR13/MapServer"
)

COVERAGE_FIELDS = [
    "OBJECTID",
    "Area_name",
    "Year_photo",
    "Year_srvy",
    "ProjStatus",
    "MapStatus",
    "Classified",
    "Accuracy",
    "SCVstatus",
    "BIOSds",
    "Acres",
    "link",
    "Report",
    "ClassRpt",
    "Notes",
]


def rest_request(url: str, params: dict[str, Any], method: str = "POST", timeout: int = 60) -> dict[str, Any]:
    encoded = urllib.parse.urlencode(params).encode("utf-8")
    request_url = url if method.upper() == "POST" else f"{url}?{encoded.decode('utf-8')}"
    data = encoded if method.upper() == "POST" else None
    request = urllib.request.Request(request_url, data=data)
    request.add_header("Content-Type", "application/x-www-form-urlencoded")

    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            payload = response.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        payload = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {exc.code} from {url}: {payload[:500]}") from exc

    try:
        parsed = json.loads(payload)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"Non-JSON response from {url}: {payload[:500]}") from exc

    if parsed.get("error"):
        error = parsed["error"]
        details = " ".join(str(item) for item in error.get("details", []))
        raise RuntimeError(f"ArcGIS REST error from {url}: {error.get('message')} {details}".strip())

    return parsed


def query_layer_metadata(layer_url: str, token: str | None) -> dict[str, Any]:
    params: dict[str, Any] = {"f": "json"}
    if token:
        params["token"] = token
    return rest_request(layer_url, params, method="GET")


def query_layer_extent(layer_url: str, token: str | None) -> dict[str, Any]:
    params: dict[str, Any] = {
        "f": "json",
        "where": "1=1",
        "returnExtentOnly": "true",
        "returnGeometry": "false",
    }
    if token:
        params["token"] = token
    data = rest_request(f"{layer_url.rstrip('/')}/query", params)
    extent = data.get("extent")
    if not extent:
        raise RuntimeError("AOI layer did not return an extent.")
    return extent


def load_geometry_json(path: str) -> dict[str, Any]:
    with open(path, "r", encoding="utf-8") as handle:
        geometry = json.load(handle)
    if not isinstance(geometry, dict):
        raise RuntimeError("Geometry JSON must contain an ArcGIS geometry object.")
    return geometry


def geometry_to_extent(geometry: dict[str, Any]) -> dict[str, Any]:
    if {"xmin", "ymin", "xmax", "ymax"}.issubset(geometry):
        return geometry

    xs: list[float] = []
    ys: list[float] = []
    for ring in geometry.get("rings", []):
        for x, y, *_ in ring:
            xs.append(float(x))
            ys.append(float(y))
    if not xs or not ys:
        raise RuntimeError("Could not derive extent from geometry JSON.")
    return {
        "xmin": min(xs),
        "ymin": min(ys),
        "xmax": max(xs),
        "ymax": max(ys),
        "spatialReference": geometry.get("spatialReference", {"wkid": 102100}),
    }


def point_in_ring(x: float, y: float, ring: list[list[float]]) -> bool:
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i][0], ring[i][1]
        xj, yj = ring[j][0], ring[j][1]
        intersects = ((yi > y) != (yj > y)) and (
            x < (xj - xi) * (y - yi) / ((yj - yi) or 1e-12) + xi
        )
        if intersects:
            inside = not inside
        j = i
    return inside


def point_in_polygon(x: float, y: float, polygon: dict[str, Any]) -> bool:
    rings = polygon.get("rings") or []
    if not rings:
        return True
    # This is enough for screening grid inclusion. ArcGIS ring orientation is not
    # used here, so holes may be counted as included in rare cases.
    return any(point_in_ring(x, y, ring) for ring in rings)


def query_intersecting_coverage(
    layer_url: str,
    geometry: dict[str, Any],
    geometry_type: str,
    label: str,
    token: str | None,
) -> list[dict[str, Any]]:
    metadata = query_layer_metadata(layer_url, token)
    available_fields = {field.get("name") for field in metadata.get("fields", [])}
    out_fields = [field for field in COVERAGE_FIELDS if field in available_fields]
    if not out_fields:
        out_fields = ["*"]

    params: dict[str, Any] = {
        "f": "json",
        "where": "1=1",
        "geometry": json.dumps(geometry, separators=(",", ":")),
        "geometryType": geometry_type,
        "inSR": json.dumps(geometry.get("spatialReference", {"wkid": 102100}), separators=(",", ":")),
        "spatialRel": "esriSpatialRelIntersects",
        "outFields": ",".join(out_fields),
        "returnGeometry": "false",
        "resultRecordCount": "2000",
    }
    if token:
        params["token"] = token
    data = rest_request(f"{layer_url}/query", params)
    rows = [feature.get("attributes", {}) for feature in data.get("features", [])]
    for row in rows:
        row["_coverage_source"] = label
    return rows


def build_grid_points(
    geometry: dict[str, Any],
    extent: dict[str, Any],
    grid_size: int,
    max_samples: int,
) -> list[tuple[float, float]]:
    xmin = float(extent["xmin"])
    ymin = float(extent["ymin"])
    xmax = float(extent["xmax"])
    ymax = float(extent["ymax"])
    if xmax <= xmin or ymax <= ymin:
        raise RuntimeError("AOI extent is empty.")

    side = max(2, grid_size)
    points: list[tuple[float, float]] = []
    for row in range(side):
        y = ymin + ((row + 0.5) / side) * (ymax - ymin)
        for col in range(side):
            x = xmin + ((col + 0.5) / side) * (xmax - xmin)
            if point_in_polygon(x, y, geometry):
                points.append((x, y))

    if len(points) > max_samples:
        step = len(points) / max_samples
        points = [points[min(math.floor(i * step), len(points) - 1)] for i in range(max_samples)]
    return points


def identify_whr13_point(x: float, y: float, extent: dict[str, Any], timeout: int) -> dict[str, Any] | None:
    params = {
        "f": "json",
        "geometry": f"{x},{y}",
        "geometryType": "esriGeometryPoint",
        "sr": json.dumps(extent.get("spatialReference", {"wkid": 102100}), separators=(",", ":")),
        "layers": "all:0",
        "tolerance": "1",
        "mapExtent": ",".join(str(extent[key]) for key in ["xmin", "ymin", "xmax", "ymax"]),
        "imageDisplay": "800,600,96",
    }
    data = rest_request(f"{CALFIRE_WHR13_MAPSERVER_URL}/identify", params, method="GET", timeout=timeout)
    results = data.get("results", [])
    if not results:
        return None
    attrs = results[0].get("attributes", {})
    return {
        "x": x,
        "y": y,
        "pixel_value": attrs.get("UniqueValue.Pixel Value"),
        "whr13": attrs.get("Raster.WHR13NAME"),
        "whr10": attrs.get("Raster.WHR10NAME"),
        "whr_name": attrs.get("Raster.WHRNAME"),
        "whr_type": attrs.get("Raster.WHRTYPE"),
        "lifeform": attrs.get("Raster.LIFEFORM"),
        "source_name": attrs.get("Raster.SOURCE_NAME"),
        "source_year": attrs.get("Raster.SOURCE_YEAR"),
    }


def sample_whr13(
    geometry: dict[str, Any],
    extent: dict[str, Any],
    grid_size: int,
    max_samples: int,
    timeout: int,
) -> list[dict[str, Any]]:
    points = build_grid_points(geometry, extent, grid_size, max_samples)
    samples: list[dict[str, Any]] = []
    for index, (x, y) in enumerate(points, start=1):
        try:
            sample = identify_whr13_point(x, y, extent, timeout)
            if sample:
                samples.append(sample)
        except Exception as exc:  # noqa: BLE001 - keep exploratory probe moving.
            print(f"[warn] WHR13 identify failed for sample {index}: {exc}", file=sys.stderr)
        if index % 25 == 0:
            time.sleep(0.2)
    return samples


def write_csv(path: Path, rows: list[dict[str, Any]]) -> None:
    if not rows:
        path.write_text("", encoding="utf-8")
        return
    fieldnames = sorted({key for row in rows for key in row.keys()})
    with open(path, "w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def summarize_samples(samples: list[dict[str, Any]]) -> list[dict[str, Any]]:
    total = len(samples)
    grouped: dict[tuple[str, str, str], Counter[str]] = defaultdict(Counter)
    for sample in samples:
        key = (
            str(sample.get("whr13") or "Unknown"),
            str(sample.get("whr_name") or "Unknown"),
            str(sample.get("lifeform") or "Unknown"),
        )
        grouped[key]["count"] += 1

    summary = []
    for (whr13, whr_name, lifeform), counter in grouped.items():
        count = int(counter["count"])
        summary.append({
            "whr13": whr13,
            "whr_name": whr_name,
            "lifeform": lifeform,
            "sample_count": count,
            "sample_percent": round((count / total) * 100, 1) if total else 0,
        })
    return sorted(summary, key=lambda row: (-row["sample_count"], row["whr13"], row["whr_name"]))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--aoi-layer-url", help="Feature layer URL for project/buffer AOI.")
    parser.add_argument("--geometry-json", help="ArcGIS polygon/envelope JSON file to use instead of AOI layer extent.")
    parser.add_argument("--out-dir", default="", help="Output directory. Defaults to notebooks/bio_pto_local_runs/vegcamp_probe_*.")
    parser.add_argument("--sample-whr13", action="store_true", help="Also sample CAL FIRE WHR13 with grid-point identify calls.")
    parser.add_argument("--grid-size", type=int, default=10, help="Grid side length. 10 means up to 100 samples before max-samples cap.")
    parser.add_argument("--max-samples", type=int, default=100, help="Maximum WHR13 identify samples.")
    parser.add_argument("--timeout", type=int, default=60, help="HTTP timeout seconds.")
    args = parser.parse_args()

    if not args.aoi_layer_url and not args.geometry_json:
        parser.error("Provide --aoi-layer-url or --geometry-json.")

    token = os.environ.get("ARCGIS_TOKEN") or None
    timestamp = time.strftime("%Y%m%d_%H%M%S")
    out_dir = Path(args.out_dir) if args.out_dir else Path(__file__).resolve().parent / "bio_pto_local_runs" / f"vegcamp_probe_{timestamp}"
    out_dir.mkdir(parents=True, exist_ok=True)

    if args.geometry_json:
        geometry = load_geometry_json(args.geometry_json)
        extent = geometry_to_extent(geometry)
        geometry_type = "esriGeometryEnvelope" if {"xmin", "ymin", "xmax", "ymax"}.issubset(geometry) else "esriGeometryPolygon"
    else:
        layer_url = args.aoi_layer_url.rstrip("/")
        metadata = query_layer_metadata(layer_url, token)
        extent = query_layer_extent(layer_url, token)
        geometry = extent
        geometry_type = "esriGeometryEnvelope"
        (out_dir / "aoi_layer_metadata.json").write_text(json.dumps(metadata, indent=2), encoding="utf-8")

    print(f"[out] {out_dir}")
    print(f"[aoi] geometry type: {geometry_type}")
    print(f"[aoi] extent: {json.dumps(extent)}")

    mapping_rows = query_intersecting_coverage(
        VEGCAMP_MAPPING_AREAS_URL,
        geometry,
        geometry_type,
        "VegCAMP mapping area ds515",
        token=None,
    )
    sampling_rows = query_intersecting_coverage(
        VEGCAMP_SAMPLING_ONLY_AREAS_URL,
        geometry,
        geometry_type,
        "VegCAMP sampling-only area ds3103",
        token=None,
    )
    coverage_rows = mapping_rows + sampling_rows

    write_csv(out_dir / "vegcamp_coverage.csv", coverage_rows)
    (out_dir / "vegcamp_coverage.json").write_text(json.dumps(coverage_rows, indent=2), encoding="utf-8")

    print(f"[VegCAMP] mapping areas intersecting AOI: {len(mapping_rows)}")
    print(f"[VegCAMP] sampling-only areas intersecting AOI: {len(sampling_rows)}")
    for row in coverage_rows[:10]:
        print(
            "  - {source}: {name} | status={status} | BIOS={bios} | link={link}".format(
                source=row.get("_coverage_source", ""),
                name=row.get("Area_name", ""),
                status=row.get("MapStatus") or row.get("ProjStatus") or "",
                bios=row.get("BIOSds") or "",
                link=row.get("link") or "",
            )
        )

    if args.sample_whr13:
        samples = sample_whr13(geometry, extent, args.grid_size, args.max_samples, args.timeout)
        sample_summary = summarize_samples(samples)
        write_csv(out_dir / "whr13_samples.csv", samples)
        write_csv(out_dir / "whr13_sample_summary.csv", sample_summary)
        (out_dir / "whr13_samples.json").write_text(json.dumps(samples, indent=2), encoding="utf-8")
        (out_dir / "whr13_sample_summary.json").write_text(json.dumps(sample_summary, indent=2), encoding="utf-8")
        print(f"[WHR13] samples with habitat result: {len(samples)}")
        for row in sample_summary[:10]:
            print(f"  - {row['whr13']} / {row['whr_name']}: {row['sample_count']} samples ({row['sample_percent']}%)")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())

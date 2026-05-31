from __future__ import annotations

import json
import os
from dataclasses import dataclass
from typing import Iterable
from urllib.parse import urlencode
from urllib.request import urlopen


@dataclass(frozen=True)
class ServiceCheck:
    name: str
    url: str
    min_count: int
    required_fields: tuple[str, ...]
    geometry_type: str | None = None
    count_mode: str = "count"


DEFAULTS = [
    ServiceCheck(
        name="test project input",
        url=os.environ.get(
            "BIO_PTO_TEST_PROJECT_INPUT",
            "https://services.arcgis.com/VxSYUpY4jQBSUpJ5/arcgis/rest/services/Test_Tool_Input/FeatureServer/0",
        ),
        min_count=1,
        required_fields=("OBJECTID",),
        geometry_type="esriGeometryPolyline",
    ),
    ServiceCheck(
        name="example CNDDB clip",
        url=os.environ.get(
            "BIO_PTO_TEST_CNDDB_LAYER",
            "https://services.arcgis.com/VxSYUpY4jQBSUpJ5/arcgis/rest/services/SDGE_Suncrest_CNDDB_CNDDB_clip_20260530_004117/FeatureServer/0",
        ),
        min_count=1,
        required_fields=("SNAME", "CNAME", "ELMCODE", "TAXONGROUP", "ACCURACY", "PRESENCE"),
        geometry_type="esriGeometryPolygon",
    ),
    ServiceCheck(
        name="example summary table",
        url=os.environ.get(
            "BIO_PTO_TEST_REVIEWED_SUMMARY_TABLE",
            "https://services.arcgis.com/VxSYUpY4jQBSUpJ5/arcgis/rest/services/SDGE_Suncrest_CNDDB_All_Stats_20260530_003947/FeatureServer/0",
        ),
        min_count=1,
        required_fields=(
            "SNAME",
            "CNAME",
            "ELMCODE",
            "PTO_Review",
            "PTO_Caption_1",
            "Min_NEAR_DIST_Miles",
            "FREQUENCY",
        ),
    ),
    ServiceCheck(
        name="full public CNDDB",
        url=os.environ.get(
            "BIO_PTO_TEST_FULL_CNDDB_LAYER",
            "https://services.arcgis.com/VxSYUpY4jQBSUpJ5/arcgis/rest/services/_CNDDB_Full_CA_view_temp/FeatureServer/0",
        ),
        min_count=1000,
        required_fields=("SNAME", "CNAME", "ELMCODE", "TAXONGROUP", "ACCURACY", "PRESENCE"),
        geometry_type="esriGeometryPolygon",
        count_mode="sample",
    ),
]


def get_json(url: str, params: dict[str, str] | None = None) -> dict:
    query = urlencode(params or {"f": "json"})
    sep = "&" if "?" in url else "?"
    with urlopen(f"{url}{sep}{query}", timeout=30) as response:
        return json.loads(response.read().decode("utf-8"))


def field_names(layer_json: dict) -> set[str]:
    return {field["name"] for field in layer_json.get("fields", [])}


def check_service(service: ServiceCheck) -> None:
    layer = get_json(service.url, {"f": "json"})
    if "error" in layer:
        raise AssertionError(f"{service.name} returned REST error: {layer['error']}")

    count = None
    if service.count_mode == "count":
        count_json = get_json(
            f"{service.url}/query",
            {"where": "1=1", "returnCountOnly": "true", "f": "json"},
        )
        count = int(count_json.get("count", 0))
    elif service.count_mode == "sample":
        sample_json = get_json(
            f"{service.url}/query",
            {
                "where": "1=1",
                "outFields": ",".join(service.required_fields),
                "returnGeometry": "false",
                "resultRecordCount": "1",
                "f": "json",
            },
        )
        if not sample_json.get("features"):
            raise AssertionError(f"{service.name} sample query returned no rows")
    fields = field_names(layer)
    missing = [field for field in service.required_fields if field not in fields]

    if service.geometry_type and layer.get("geometryType") != service.geometry_type:
        raise AssertionError(
            f"{service.name} geometry mismatch: expected {service.geometry_type}, got {layer.get('geometryType')}"
        )
    if count is not None and count < service.min_count:
        raise AssertionError(f"{service.name} count too low: expected >= {service.min_count}, got {count}")
    if missing:
        raise AssertionError(f"{service.name} missing fields: {', '.join(missing)}")

    count_label = f"{count:,} rows" if count is not None else "sample row ok"
    print(f"OK {service.name}: {count_label}, {len(fields)} fields")


def main(services: Iterable[ServiceCheck] = DEFAULTS) -> None:
    for service in services:
        check_service(service)
    print("Public BIO PTO test services passed.")


if __name__ == "__main__":
    main()

"""
Create the shared BIO PTO Projects hosted table in ArcGIS Online.

This is a ONE-TIME setup for the team-shared project store (backend B). It makes
a hosted table (a feature service with no geometry) named BIO_PTO_Projects,
shares it with your organization so the whole team can read/write it, and prints
the layer URL to paste into the app config.

How to run (ArcGIS Pro's Python):
    1. Open the Python window in ArcGIS Pro (so you're already signed in to AGO),
       OR run this from the "Python Command Prompt" that ships with Pro.
    2. Run:  python create_projects_table.py
    3. Copy the "Table layer URL" it prints at the end.

Re-running is safe: if a BIO_PTO_Projects service already exists it will stop and
tell you, rather than make a duplicate.
"""

from arcgis.gis import GIS

SERVICE_NAME = "BIO_PTO_Projects"

# One row per project. snapshot holds the full project JSON the app serializes.
FIELDS = [
    {"name": "project_id", "type": "esriFieldTypeString", "alias": "Project ID", "length": 64, "nullable": False},
    {"name": "client", "type": "esriFieldTypeString", "alias": "Client", "length": 255, "nullable": True},
    {"name": "name", "type": "esriFieldTypeString", "alias": "Project name", "length": 255, "nullable": True},
    {"name": "created_at", "type": "esriFieldTypeString", "alias": "Created at (ISO)", "length": 40, "nullable": True},
    {"name": "modified_at", "type": "esriFieldTypeString", "alias": "Modified at (ISO)", "length": 40, "nullable": True},
    {"name": "has_results", "type": "esriFieldTypeSmallInteger", "alias": "Has results", "nullable": True},
    {"name": "reviewed_count", "type": "esriFieldTypeInteger", "alias": "Reviewed count", "nullable": True},
    {"name": "created_by", "type": "esriFieldTypeString", "alias": "Created by", "length": 128, "nullable": True},
    # Large text for the serialized project snapshot (JSON).
    {"name": "snapshot", "type": "esriFieldTypeString", "alias": "Snapshot JSON", "length": 1000000, "nullable": True},
]

TABLE_DEFINITION = {
    "type": "Table",
    "name": SERVICE_NAME,
    "geometryType": None,
    "objectIdField": "OBJECTID",
    "fields": [
        {"name": "OBJECTID", "type": "esriFieldTypeOID", "alias": "OBJECTID", "nullable": False, "editable": False},
        *FIELDS,
    ],
    # Let any editor add/update/delete rows (team-shared, collaborative).
    "capabilities": "Query,Create,Update,Delete,Editing",
    "allowGeometryUpdates": False,
    "hasAttachments": False,
    "supportsApplyEditsWithGlobalIds": False,
}


def main() -> None:
    # Uses the ArcGIS Pro app's current sign-in. No credentials stored here.
    gis = GIS("pro")
    print(f"Signed in as: {gis.users.me.username}  ({gis.properties.urlKey}.{gis.properties.customBaseUrl})")

    existing = gis.content.search(f'title:"{SERVICE_NAME}" owner:{gis.users.me.username}',
                                  item_type="Feature Service")
    if any(item.title == SERVICE_NAME for item in existing):
        hit = next(item for item in existing if item.title == SERVICE_NAME)
        print(f"\nA service named {SERVICE_NAME} already exists: {hit.homepage}")
        print("Delete it first if you want a fresh one, or reuse its table URL.")
        return

    print(f"Creating hosted feature service '{SERVICE_NAME}' ...")
    item = gis.content.create_service(name=SERVICE_NAME, has_static_data=False, create_params={
        "name": SERVICE_NAME,
        "serviceDescription": "Shared project store for the BIO Potential to Occur app.",
        "hasStaticData": False,
        "units": "esriMeters",
        "xssPreventionInfo": {"xssPreventionEnabled": True, "xssPreventionRule": "InputOnly", "xssInputRule": "rejectInvalid"},
        "capabilities": "Query,Create,Update,Delete,Editing",
        "tables": [],
    })

    from arcgis.features import FeatureLayerCollection
    flc = FeatureLayerCollection.fromitem(item)
    print("Adding the BIO_PTO_Projects table definition ...")
    flc.manager.add_to_definition({"tables": [TABLE_DEFINITION]})

    print("Sharing with the organization (everyone signed in can read/write) ...")
    item.share(org=True)

    item = gis.content.get(item.id)
    table_url = item.tables[0].url
    print("\n================= DONE =================")
    print(f"Item page:        {item.homepage}")
    print(f"Table layer URL:  {table_url}")
    print("\nPaste the Table layer URL into the app as VITE_PROJECTS_TABLE_URL.")
    print("=======================================")


if __name__ == "__main__":
    main()

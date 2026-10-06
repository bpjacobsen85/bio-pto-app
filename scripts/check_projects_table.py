"""
Diagnose (and fix) why team members don't see each other's projects in the
shared BIO_PTO_Projects table.

Run it the same way as the create script, from ArcGIS Pro's Python:
    exec(open(r"C:\\MyApps\\bio-pto-app\\scripts\\check_projects_table.py").read())
or
    python C:\\MyApps\\bio-pto-app\\scripts\\check_projects_table.py

It prints:
  - how the table item is shared (private / org / public / groups)
  - whether ownership-based access control is ON (which hides other users' rows)
  - every row currently in the table (so you can see if a given project exists)
Then it FIXES the common causes: shares the item org-wide and turns OFF
ownership-based access control so everyone sees everyone's projects.
"""

from arcgis.gis import GIS

SERVICE_NAME = "BIO_PTO_Projects"


def main() -> None:
    gis = GIS("pro")
    me = gis.users.me.username
    print(f"Signed in as: {me}\n")

    items = gis.content.search(f'title:"{SERVICE_NAME}"', item_type="Feature Service")
    item = next((it for it in items if it.title == SERVICE_NAME), None)
    if item is None:
        print(f"Could not find a '{SERVICE_NAME}' feature service you can access.")
        return

    print(f"Item: {item.title}  (owner: {item.owner})")
    print(f"Item page: {item.homepage}")
    try:
        shared = item.sharing.sharing_level  # newer API
        print(f"Shared with: {shared}")
    except Exception:
        sw = item.shared_with
        print(f"Shared with: everyone={sw.get('everyone')}  org={sw.get('org')}  groups={[g.title for g in sw.get('groups', [])]}")

    from arcgis.features import FeatureLayerCollection
    flc = FeatureLayerCollection.fromitem(item)
    table = flc.tables[0] if flc.tables else flc.layers[0]
    props = table.properties

    obac = props.get("ownershipBasedAccessControlForFeatures")
    print(f"\nOwnership-based access control: {obac if obac else 'OFF (good)'}")
    print(f"Capabilities: {props.get('capabilities')}")

    rows = table.query(where="1=1", out_fields="project_id,client,name,created_at", return_geometry=False).features
    print(f"\nRows in table (as owner you see ALL {len(rows)}):")
    for feature in rows:
        a = feature.attributes
        print(f"  - [{a.get('client')}] {a.get('name')}   id={a.get('project_id')}   created={a.get('created_at')}")

    # ---------- FIX ----------
    print("\nApplying fixes ...")
    try:
        item.share(org=True)
        print("  shared org-wide ✓")
    except Exception as exc:
        print(f"  could not org-share: {exc}")

    if obac:
        try:
            flc.manager.update_definition({"ownershipBasedAccessControlForFeatures": None})
            print("  turned OFF ownership-based access control ✓ (everyone now sees all rows)")
        except Exception as exc:
            print(f"  could not disable ownership access control: {exc}")
    else:
        print("  ownership access control already off ✓")

    print("\nDone. Have another user sign in to the app and refresh the project list.")


if __name__ == "__main__":
    main()

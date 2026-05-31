# BIO PTO Notebook Testing

These checks are meant to catch obvious notebook breakage before publishing to ArcGIS Online.

Run from the app project:

```powershell
python .\notebook-tests\validate_notebooks.py
```

Check the public ArcGIS Online test services:

```powershell
python .\notebook-tests\check_public_test_services.py
```

The validator checks:

- both split notebooks exist in `C:\Users\bjacobsen\Downloads`
- all normal Python cells parse cleanly
- the model notebook has test-mode inputs and review fields
- the model notebook no longer assigns Word/Excel report outputs
- the report notebook reads `reviewed_summary_table_url`
- the report notebook uses `reviewed_potential` and `final_report_description`

For local ArcGIS smoke tests, set environment variables before running notebook cells:

```powershell
$env:BIO_PTO_TEST_MODE="1"
$env:ARCGIS_PROFILE="your_saved_arcgis_profile"
$env:BIO_PTO_TEST_PROJECT_INPUT="https://services.arcgis.com/VxSYUpY4jQBSUpJ5/arcgis/rest/services/Test_Tool_Input/FeatureServer/0"
$env:BIO_PTO_TEST_PROJECT_NAME="BIO_PTO_Test"
$env:BIO_PTO_TEST_CNDDB_LAYER="https://services.arcgis.com/VxSYUpY4jQBSUpJ5/arcgis/rest/services/SDGE_Suncrest_CNDDB_CNDDB_clip_20260530_004117/FeatureServer/0"
$env:BIO_PTO_TEST_REVIEWED_SUMMARY_TABLE="https://services.arcgis.com/VxSYUpY4jQBSUpJ5/arcgis/rest/services/SDGE_Suncrest_CNDDB_All_Stats_20260530_003947/FeatureServer/0"
$env:BIO_PTO_TEST_FULL_CNDDB_LAYER="https://services.arcgis.com/VxSYUpY4jQBSUpJ5/arcgis/rest/services/_CNDDB_Full_CA_view_temp/FeatureServer/0"
```

ArcGIS Online publishing is still the final test because notebook web tool parameters, hosted-output files, and credit behavior only fully exist in the AGO runtime.

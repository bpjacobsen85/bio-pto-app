# BIO PTO App

Modern React front end for the BIO Potential-to-Occur workflow. ArcGIS Online remains the system of record for login, maps, CNDDB data, notebook web tool execution, hosted output layers, and saved run history.

## Local Development

PowerShell may block `npm.ps1` on this machine, so use `npm.cmd` directly:

```powershell
& "C:\Program Files\nodejs\npm.cmd" install
& "C:\Program Files\nodejs\npm.cmd" run dev
```

Open:

```text
http://127.0.0.1:5173
```

## Environment Values

Copy `.env.example` to `.env.local` and fill these in when available:

```text
VITE_ARCGIS_PORTAL_URL=https://www.arcgis.com
VITE_ARCGIS_CLIENT_ID=<ArcGIS OAuth app client ID>
VITE_NOTEBOOK_TOOL_URL=<Notebook web tool REST URL>
VITE_RUN_HISTORY_TABLE_URL=<BIO_PTO_Run_History hosted table URL>
```

These are browser-side Vite variables. Do not put private admin passwords or permanent tokens here.

## Planned ArcGIS Flow

1. User signs in with ArcGIS Online OAuth.
2. User sketches/selects project area.
3. App submits the Notebook Web Tool job.
4. App polls job status and reads output parameters.
5. App dynamically loads returned hosted layers/tables.
6. App writes a saved-run row to `BIO_PTO_Run_History`.

## Production OAuth Client ID

The ArcGIS OAuth Client ID is committed in `.env.production` so Vercel can build the public app without extra configuration. This is not a secret. Keep private tokens and passwords out of repository files.

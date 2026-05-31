import { useEffect, useMemo, useState } from 'react'
import {
  ArrowDownToLine,
  CheckCircle2,
  ChevronRight,
  FileSpreadsheet,
  FileText,
  Layers3,
  Play,
  RotateCcw,
  Search,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Upload,
} from 'lucide-react'
import './App.css'
import { restoreArcGISSession, signInToArcGIS, signOutOfArcGIS, type ArcgisUser } from './arcgisAuth'
import { ArcGISMap, type ProjectSketchSummary } from './ArcGISMap'

type Rating = 'High' | 'Moderate' | 'Low' | 'No Potential' | 'Needs Review'
type MapTool = 'layers' | 'search' | null

type SpeciesResult = {
  objectId: number
  rating: Rating
  common: string
  scientific: string
  taxonGroup: string
  distanceMiles: number | null
  accuracyClass: number | null
  frequency: number | null
  extantCount: number | null
  currentCount: number | null
  recentCount: number | null
}

const defaultProjectLayerUrl = 'https://services.arcgis.com/VxSYUpY4jQBSUpJ5/arcgis/rest/services/PGE_SM_Project_Components/FeatureServer/2'
const defaultCnddbLayerUrl = 'https://services.arcgis.com/VxSYUpY4jQBSUpJ5/arcgis/rest/services/SDGE_Suncrest_CNDDB_CNDDB_clip_20260530_004117/FeatureServer/0'
const defaultStatsTableUrl = 'https://services.arcgis.com/VxSYUpY4jQBSUpJ5/arcgis/rest/services/SDGE_Suncrest_CNDDB_All_Stats_20260530_003947/FeatureServer/0'
const ratingOrder: Rating[] = ['High', 'Moderate', 'Low', 'No Potential', 'Needs Review']

const savedRuns = [
  { name: 'SDGE_Suncrest', date: 'Today', species: 0, status: 'Loaded' },
  { name: 'PGE_SM', date: 'May 29', species: 312, status: 'Complete' },
  { name: 'Transmission Alt 2', date: 'May 28', species: 148, status: 'Complete' },
]

function RatingPill({ rating }: { rating: Rating }) {
  return <span className={`rating-pill ${rating.toLowerCase().replaceAll(' ', '-')}`}>{rating}</span>
}

function normalizeRating(value: unknown): Rating {
  const text = String(value ?? '').trim().toLowerCase()
  if (text === 'high') return 'High'
  if (text === 'moderate') return 'Moderate'
  if (text === 'low') return 'Low'
  if (text === 'no potential') return 'No Potential'
  return 'Needs Review'
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function formatMiles(value: number | null) {
  if (value === null || Number.isNaN(value)) return '--'
  return `${value.toFixed(value < 1 ? 2 : 1)} mi`
}

function formatCount(value: number | null) {
  return value === null ? '--' : value.toLocaleString()
}

function App() {
  const [user, setUser] = useState<ArcgisUser | null>(null)
  const [authStatus, setAuthStatus] = useState<'idle' | 'checking' | 'signing-in' | 'error'>('checking')
  const [authMessage, setAuthMessage] = useState('')
  const [activeMapTool, setActiveMapTool] = useState<MapTool>('layers')
  const [projectLayerUrl, setProjectLayerUrl] = useState(defaultProjectLayerUrl)
  const [loadedProjectLayerUrl, setLoadedProjectLayerUrl] = useState('')
  const [statsTableUrl] = useState(defaultStatsTableUrl)
  const [cnddbLayerUrl] = useState(defaultCnddbLayerUrl)
  const [speciesResults, setSpeciesResults] = useState<SpeciesResult[]>([])
  const [statsStatus, setStatsStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [statsMessage, setStatsMessage] = useState('Loading SDGE Suncrest CNDDB stats...')
  const [projectSketch, setProjectSketch] = useState<ProjectSketchSummary>({
    source: 'Demo',
    featureCount: 0,
    geometryType: 'None',
    isReadyForAnalysis: false,
    warning: 'Draw a project feature or load a feature service layer to create project_input.',
  })

  useEffect(() => {
    let alive = true

    restoreArcGISSession()
      .then((restoredUser) => {
        if (!alive) return
        setUser(restoredUser)
        setAuthStatus('idle')
      })
      .catch(() => {
        if (!alive) return
        setAuthStatus('idle')
      })

    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    let alive = true

    async function loadStatsTable() {
      setStatsStatus('loading')
      setStatsMessage('Loading SDGE Suncrest CNDDB stats...')

      const query = new URL(`${statsTableUrl}/query`)
      query.searchParams.set('where', '1=1')
      query.searchParams.set('outFields', 'CNAME,SNAME,TAXONGROUP,PTO_Review,Min_NEAR_DIST_Miles,Min_Accuracy_Class,FREQUENCY,Sum_Extant,Sum_Current_30yr,Sum_Recent_EO,ObjectId')
      query.searchParams.set('returnGeometry', 'false')
      query.searchParams.set('orderByFields', 'PTO_Review ASC, Min_NEAR_DIST_Miles ASC')
      query.searchParams.set('resultRecordCount', '500')
      query.searchParams.set('f', 'json')

      try {
        const response = await fetch(query.toString())
        if (!response.ok) throw new Error(`Stats table request failed: ${response.status}`)
        const data = await response.json() as { error?: { message?: string }; features?: Array<{ attributes: Record<string, unknown> }> }
        if (data.error) throw new Error(data.error.message ?? 'Stats table returned an ArcGIS error.')

        const rows = (data.features ?? []).map((feature) => {
          const attributes = feature.attributes
          return {
            objectId: Number(attributes.ObjectId),
            rating: normalizeRating(attributes.PTO_Review),
            common: String(attributes.CNAME ?? 'Unknown common name'),
            scientific: String(attributes.SNAME ?? 'Unknown scientific name'),
            taxonGroup: String(attributes.TAXONGROUP ?? 'Unknown'),
            distanceMiles: asNumber(attributes.Min_NEAR_DIST_Miles),
            accuracyClass: asNumber(attributes.Min_Accuracy_Class),
            frequency: asNumber(attributes.FREQUENCY),
            extantCount: asNumber(attributes.Sum_Extant),
            currentCount: asNumber(attributes.Sum_Current_30yr),
            recentCount: asNumber(attributes.Sum_Recent_EO),
          }
        })

        if (!alive) return
        setSpeciesResults(rows)
        setStatsStatus('ready')
        setStatsMessage(`${rows.length} species loaded from the SDGE Suncrest stats table.`)
      } catch (error) {
        if (!alive) return
        setStatsStatus('error')
        setStatsMessage(error instanceof Error ? error.message : 'Could not load stats table.')
      }
    }

    void loadStatsTable()

    return () => {
      alive = false
    }
  }, [statsTableUrl])

  const ratingCounts = useMemo(() => ratingOrder.map((label) => ({
    label,
    count: speciesResults.filter((row) => row.rating === label).length,
  })), [speciesResults])

  const selectedSpecies = speciesResults[0]
  const totalSpecies = speciesResults.length
  const totalOccurrences = speciesResults.reduce((sum, row) => sum + (row.frequency ?? 0), 0)

  async function handleSignIn() {
    setAuthStatus('signing-in')
    setAuthMessage('')

    try {
      const signedInUser = await signInToArcGIS()
      setUser(signedInUser)
      setAuthStatus('idle')
    } catch (error) {
      setAuthStatus('error')
      setAuthMessage(error instanceof Error ? error.message : 'ArcGIS sign-in failed.')
    }
  }

  function handleSignOut() {
    signOutOfArcGIS()
    setUser(null)
    setAuthStatus('idle')
  }

  function toggleMapTool(tool: Exclude<MapTool, null>) {
    setActiveMapTool((current) => current === tool ? null : tool)
  }

  function handleLoadProjectLayer() {
    setLoadedProjectLayerUrl(projectLayerUrl.trim())
  }

  return (
    <main className="app-shell">
      <header className="app-header">
        <div className="brand-block">
          <div className="brand-mark">BP</div>
          <div>
            <p className="eyebrow">ArcGIS Online powered</p>
            <h1>BIO PTO Analysis</h1>
          </div>
        </div>
        <div className="header-actions">
          {authStatus === 'error' && <span className="auth-error">{authMessage}</span>}
          {user ? (
            <button className="user-button" type="button" onClick={handleSignOut} title="Sign out of ArcGIS">
              <span className="user-avatar">{(user.fullName || user.username).slice(0, 1).toUpperCase()}</span>
              <span>{user.fullName || user.username}</span>
            </button>
          ) : (
            <button className="secondary-button" type="button" onClick={handleSignIn} disabled={authStatus === 'checking' || authStatus === 'signing-in'}>
              <ShieldCheck size={17} />
              {authStatus === 'checking' ? 'Checking...' : authStatus === 'signing-in' ? 'Signing in...' : 'Sign in'}
            </button>
          )}
          <button className="icon-button" type="button" aria-label="Reset analysis">
            <RotateCcw size={18} />
          </button>
          <button className="secondary-button" type="button">
            <Settings2 size={17} />
            Settings
          </button>
          <button className="primary-button" type="button" disabled={!projectSketch.isReadyForAnalysis}>
            <Play size={17} fill="currentColor" />
            Run Analysis
          </button>
        </div>
      </header>

      <section className="workspace">
        <aside className="setup-panel" aria-label="Analysis setup">
          <div className="panel-section active-step">
            <div className="section-heading">
              <span className="step-index">1</span>
              <div>
                <h2>Project Area</h2>
                <p>Select a layer, upload features, or sketch on the map.</p>
              </div>
            </div>
            <button className="upload-target" type="button">
              <Upload size={18} />
              {projectSketch.source === 'FeatureLayer' ? 'ArcGIS feature service layer' : projectSketch.featureCount > 0 ? `${projectSketch.geometryType} sketch` : 'PGE_SM_Project_Components'}
              <ChevronRight size={17} />
            </button>
            <div className="field-grid layer-url-grid">
              <label>
                Feature service layer URL
                <input value={projectLayerUrl} onChange={(event) => setProjectLayerUrl(event.target.value)} />
              </label>
              <button className="secondary-button" type="button" onClick={handleLoadProjectLayer}>Load layer</button>
            </div>
            <div className="field-grid two-col">
              <label>
                Project name
                <input value="SDGE_Suncrest" readOnly />
              </label>
              <label>
                Features
                <input value={String(projectSketch.featureCount)} readOnly />
              </label>
            </div>
            <div className={`input-readiness ${projectSketch.isReadyForAnalysis ? 'ready' : 'waiting'}`}>
              <ShieldCheck size={15} />
              <span>
                {projectSketch.isReadyForAnalysis
                  ? `${projectSketch.source} ${projectSketch.geometryType} project_input ready`
                  : projectSketch.warning}
              </span>
            </div>
          </div>

          <div className="panel-section">
            <div className="section-heading">
              <span className="step-index">2</span>
              <div>
                <h2>PTO Rules</h2>
                <p>Standard distance, accuracy, and recency criteria.</p>
              </div>
            </div>
            <div className="segmented-control" aria-label="Rule preset">
              <button type="button">Conservative</button>
              <button className="selected" type="button">Standard</button>
              <button type="button">Screening</button>
            </div>
            <label className="slider-field">
              Buffer distance
              <div className="slider-row">
                <input type="range" min="1" max="10" value="5" readOnly />
                <strong>5 mi</strong>
              </div>
            </label>
            <div className="threshold-bar" aria-label="Distance thresholds">
              <span className="zone high-zone">High</span>
              <span className="zone moderate-zone">Moderate</span>
              <span className="zone low-zone">Low</span>
              <span className="marker marker-a">0.25</span>
              <span className="marker marker-b">1.0</span>
              <span className="marker marker-c">5.0</span>
            </div>
            <button className="plain-row" type="button">
              <SlidersHorizontal size={17} />
              Advanced criteria
              <ChevronRight size={17} />
            </button>
          </div>

          <div className="panel-section estimate-section">
            <div className="section-heading">
              <span className="step-index">3</span>
              <div>
                <h2>Loaded Results</h2>
                <p>Current SDGE Suncrest output services.</p>
              </div>
            </div>
            <div className="estimate-grid">
              <span>Species rows</span>
              <strong>{totalSpecies.toLocaleString()}</strong>
              <span>CNDDB records</span>
              <strong>{totalOccurrences.toLocaleString()}</strong>
              <span>Status</span>
              <strong>{statsStatus}</strong>
            </div>
          </div>
        </aside>

        <section className="map-stage" aria-label="Map preview">
          <div className="map-toolbar">
            <button className={`tool-button ${activeMapTool === 'layers' ? 'active' : ''}`} type="button" onClick={() => toggleMapTool('layers')}><Layers3 size={17} /> Layers</button>
            <button className={`tool-button ${activeMapTool === 'search' ? 'active' : ''}`} type="button" onClick={() => toggleMapTool('search')}><Search size={17} /> Search</button>
          </div>
          <div className="map-canvas">
            <ArcGISMap activeMapTool={activeMapTool} projectLayerUrl={loadedProjectLayerUrl} cnddbLayerUrl={cnddbLayerUrl} onProjectSketchChange={setProjectSketch} />
          </div>
          <div className="legend-panel">
            <h3>Potential</h3>
            {ratingCounts.map((item) => (
              <div className="legend-row" key={item.label}>
                <span className={`legend-swatch ${item.label.toLowerCase().replaceAll(' ', '-')}`} />
                <span>{item.label}</span>
              </div>
            ))}
          </div>
        </section>

        <aside className="results-panel" aria-label="Analysis results">
          <div className="run-status">
            <CheckCircle2 size={19} />
            <div>
              <h2>{statsStatus === 'ready' ? 'SDGE Suncrest loaded' : statsStatus === 'error' ? 'Results need attention' : 'Loading results'}</h2>
              <p>{statsMessage}</p>
            </div>
          </div>

          <div className="summary-grid">
            {ratingCounts.map((item) => (
              <div className={`summary-card ${item.label.toLowerCase().replaceAll(' ', '-')}`} key={item.label}>
                <span>{item.label}</span>
                <strong>{item.count}</strong>
              </div>
            ))}
          </div>

          <div className="downloads-row">
            <button type="button"><FileSpreadsheet size={16} /> Excel</button>
            <button type="button"><FileText size={16} /> Animals</button>
            <button type="button"><FileText size={16} /> Plants</button>
          </div>

          <div className="table-card">
            <div className="table-heading">
              <h2>Species Results</h2>
              <button type="button"><ArrowDownToLine size={16} /></button>
            </div>
            <div className="species-list">
              {speciesResults.slice(0, 80).map((row) => (
                <button className={`species-row ${row.rating.toLowerCase().replaceAll(' ', '-')}`} type="button" key={row.objectId}>
                  <RatingPill rating={row.rating} />
                  <span className="species-name">
                    <strong>{row.common}</strong>
                    <em>{row.scientific}</em>
                  </span>
                  <span>{formatMiles(row.distanceMiles)}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="detail-panel">
            <div className="detail-heading">
              {selectedSpecies ? <RatingPill rating={selectedSpecies.rating} /> : <RatingPill rating="Needs Review" />}
              <h2>{selectedSpecies?.common ?? 'No species loaded'}</h2>
              <p>{selectedSpecies?.scientific ?? statsMessage}</p>
            </div>
            <div className="evidence-list">
              <span>Nearest occurrence <strong>{formatMiles(selectedSpecies?.distanceMiles ?? null)}</strong></span>
              <span>Accuracy <strong>{selectedSpecies?.accuracyClass ? `Class ${selectedSpecies.accuracyClass}` : '--'}</strong></span>
              <span>Occurrences <strong>{formatCount(selectedSpecies?.frequency ?? null)}</strong></span>
              <span>Extant records <strong>{formatCount(selectedSpecies?.extantCount ?? null)}</strong></span>
            </div>
            <p className="reason-text">
              Loaded from the ArcGIS Online stats table. PTO review is driven by distance, accuracy, extant/current status, and the notebook rules.
            </p>
          </div>
        </aside>
      </section>

      <section className="saved-runs" aria-label="Saved analyses">
        <div>
          <p className="eyebrow">Saved analyses</p>
          <h2>Recent ArcGIS Online runs</h2>
        </div>
        <div className="saved-run-list">
          {savedRuns.map((run) => (
            <button type="button" className="saved-run" key={run.name}>
              <ShieldCheck size={17} />
              <span>
                <strong>{run.name}</strong>
                <small>{run.date} - {run.species || totalSpecies || '--'} species</small>
              </span>
              <em>{run.status}</em>
            </button>
          ))}
        </div>
      </section>
    </main>
  )
}

export default App

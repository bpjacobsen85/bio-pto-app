import { useEffect, useState } from 'react'
import {
  ArrowDownToLine,
  CheckCircle2,
  ChevronRight,
  FileSpreadsheet,
  FileText,
  Layers3,
  MapPin,
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
import { ArcGISMap } from './ArcGISMap'

type Rating = 'High' | 'Moderate' | 'Low' | 'No Potential' | 'Needs Review'

const ratingCounts: Array<{ label: Rating; count: number }> = [
  { label: 'High', count: 18 },
  { label: 'Moderate', count: 46 },
  { label: 'Low', count: 201 },
  { label: 'No Potential', count: 7 },
  { label: 'Needs Review', count: 40 },
]

const species: Array<{
  rating: Rating
  common: string
  scientific: string
  distance: string
  accuracy: string
  current: string
  extant: string
}> = [
  {
    rating: 'High',
    common: 'Vernal Pool Fairy Shrimp',
    scientific: 'Branchinecta lynchi',
    distance: '0.08 mi',
    accuracy: 'Class 2',
    current: 'Yes',
    extant: 'Yes',
  },
  {
    rating: 'Low',
    common: 'California Tiger Salamander',
    scientific: 'Ambystoma californiense',
    distance: '0.30 mi',
    accuracy: 'Class 5',
    current: 'No',
    extant: 'Yes',
  },
  {
    rating: 'Moderate',
    common: 'Burrowing Owl',
    scientific: 'Athene cunicularia',
    distance: '0.74 mi',
    accuracy: 'Class 3',
    current: 'Yes',
    extant: 'Yes',
  },
  {
    rating: 'No Potential',
    common: 'Valley Elderberry Longhorn Beetle',
    scientific: 'Desmocerus californicus dimorphus',
    distance: '3.80 mi',
    accuracy: 'Class 2',
    current: 'No',
    extant: 'No',
  },
  {
    rating: 'Needs Review',
    common: "Swainson's Hawk",
    scientific: 'Buteo swainsoni',
    distance: '1.20 mi',
    accuracy: 'Class 9',
    current: 'Unknown',
    extant: 'Yes',
  },
]

const savedRuns = [
  { name: 'PGE_SM', date: 'Today', species: 312, status: 'Complete' },
  { name: 'Transmission Alt 2', date: 'May 28', species: 148, status: 'Complete' },
  { name: 'Solar Site A', date: 'May 26', species: 0, status: 'Failed' },
]

function RatingPill({ rating }: { rating: Rating }) {
  return <span className={`rating-pill ${rating.toLowerCase().replaceAll(' ', '-')}`}>{rating}</span>
}

function App() {
  const [user, setUser] = useState<ArcgisUser | null>(null)
  const [authStatus, setAuthStatus] = useState<'idle' | 'checking' | 'signing-in' | 'error'>('checking')
  const [authMessage, setAuthMessage] = useState('')

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
          )}          <button className="icon-button" type="button" aria-label="Reset analysis">
            <RotateCcw size={18} />
          </button>
          <button className="secondary-button" type="button">
            <Settings2 size={17} />
            Settings
          </button>
          <button className="primary-button" type="button">
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
              PGE_SM_Project_Components
              <ChevronRight size={17} />
            </button>
            <div className="field-grid two-col">
              <label>
                Project name
                <input value="PGE_SM" readOnly />
              </label>
              <label>
                Features
                <input value="8" readOnly />
              </label>
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
                <h2>Estimate</h2>
                <p>Preflight based on selected geometry and rule settings.</p>
              </div>
            </div>
            <div className="estimate-grid">
              <span>CNDDB selected</span>
              <strong>5,812</strong>
              <span>Runtime</span>
              <strong>8-15 min</strong>
              <span>Credits</span>
              <strong>~3.2</strong>
            </div>
          </div>
        </aside>

        <section className="map-stage" aria-label="Map preview">
          <div className="map-toolbar">
            <button className="tool-button active" type="button"><MapPin size={17} /> Sketch</button>
            <button className="tool-button" type="button"><Layers3 size={17} /> Layers</button>
            <button className="tool-button" type="button"><Search size={17} /> Search</button>
          </div>
          <div className="map-canvas">
            <ArcGISMap />
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
              <h2>Ready to review</h2>
              <p>312 species in the current result set</p>
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
              {species.map((row) => (
                <button className={`species-row ${row.rating.toLowerCase().replaceAll(' ', '-')}`} type="button" key={row.common}>
                  <RatingPill rating={row.rating} />
                  <span className="species-name">
                    <strong>{row.common}</strong>
                    <em>{row.scientific}</em>
                  </span>
                  <span>{row.distance}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="detail-panel">
            <div className="detail-heading">
              <RatingPill rating="Low" />
              <h2>California Tiger Salamander</h2>
              <p>Ambystoma californiense</p>
            </div>
            <div className="evidence-list">
              <span>Nearest occurrence <strong>0.30 mi</strong></span>
              <span>Accuracy <strong>Class 5</strong></span>
              <span>Current record <strong>No</strong></span>
              <span>Extant record <strong>Yes</strong></span>
            </div>
            <p className="reason-text">
              Candidate Moderate was downgraded to Low because the no-current-record override is enabled.
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
                <small>{run.date} · {run.species || '--'} species</small>
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



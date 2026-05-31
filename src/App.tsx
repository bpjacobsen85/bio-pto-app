import { useEffect, useMemo, useState } from 'react'
import {
  ArrowDownToLine,
  CheckCircle2,
  ChevronRight,
  FileSpreadsheet,
  FileText,
  Layers3,
  PanelLeftClose,
  PanelLeftOpen,
  Play,
  RotateCcw,
  Search,
  Settings2,
  ShieldCheck,
  Upload,
} from 'lucide-react'
import './App.css'
import { restoreArcGISSession, signInToArcGIS, signOutOfArcGIS, type ArcgisUser } from './arcgisAuth'
import { ArcGISMap, type ProjectSketchSummary } from './ArcGISMap'

type Rating = 'High' | 'Moderate' | 'Low' | 'No Potential' | 'Needs Review'
type MapTool = 'layers' | 'search' | null
type SpeciesTypeFilter = 'All' | 'Plants' | 'Animals'
type ConservationFilter = string

type SpeciesResult = {
  objectId: number
  elmCode: string
  rating: Rating
  common: string
  scientific: string
  taxonGroup: string
  elementType: string
  listings: string
  speciesType: Exclude<SpeciesTypeFilter, 'All'>
  distanceMiles: number | null
  accuracyClass: number | null
  frequency: number | null
  extantCount: number | null
  currentCount: number | null
  recentCount: number | null
  historicalCount: number | null
  possiblyExtirpatedCount: number | null
  extirpatedCount: number | null
  unknownCount: number | null
  minYear: number | null
  habitatSummary: string
  libraryDescription: string
  libraryDescriptionSource: string
  generalHabitat: string
  microHabitat: string
  suitabilityReview: string
  family: string
  lifeform: string
  bloomingPeriod: string
  elevationLowFt: number | null
  elevationHighFt: number | null
  references: string
}

type SpeciesReviewEdit = {
  rating?: Rating
  habitatSummary?: string
}

type PtoCriteria = {
  bufferDistance: number
  highDistance: number
  moderateDistance: number
  lowDistance: number
}

const defaultProjectLayerUrl = 'https://services.arcgis.com/VxSYUpY4jQBSUpJ5/arcgis/rest/services/PGE_SM_Project_Components/FeatureServer/2'
const defaultCnddbLayerUrl = 'https://services.arcgis.com/VxSYUpY4jQBSUpJ5/arcgis/rest/services/SDGE_Suncrest_CNDDB_CNDDB_clip_20260530_004117/FeatureServer/0'
const defaultStatsTableUrl = 'https://services.arcgis.com/VxSYUpY4jQBSUpJ5/arcgis/rest/services/SDGE_Suncrest_CNDDB_All_Stats_20260530_003947/FeatureServer/0'
const plantLookupTableUrl = 'https://services.arcgis.com/VxSYUpY4jQBSUpJ5/arcgis/rest/services/BIO_PTO_Model_Lookup_Tables_gdb/FeatureServer/0'
const animalLookupTableUrl = 'https://services.arcgis.com/VxSYUpY4jQBSUpJ5/arcgis/rest/services/BIO_PTO_Model_Lookup_Tables_gdb/FeatureServer/4'
const ratingOrder: Rating[] = ['High', 'Moderate', 'Low', 'No Potential', 'Needs Review']
const federalStatusCodes = new Set(['FE', 'FT', 'FPE', 'FPT', 'FC'])
const stateStatusCodes = new Set(['SE', 'ST', 'SCE', 'SCT', 'SC'])
const cdfwStatusCodes = new Set(['SSC', 'WL', 'CDFW FP', 'CDFW_FP', 'FP'])
const agencySensitiveCodes = new Set(['BLM_S', 'USFS_S'])
const statusDefinitions: Record<string, string> = {
  FE: 'Federal Endangered',
  FT: 'Federal Threatened',
  FPE: 'Federal Proposed Endangered',
  FPT: 'Federal Proposed Threatened',
  FC: 'Federal Candidate',
  SE: 'State Endangered',
  ST: 'State Threatened',
  SCE: 'State Candidate Endangered',
  SCT: 'State Candidate Threatened',
  SC: 'State Candidate',
  SSC: 'Species of Special Concern',
  WL: 'Watch List',
  'CDFW FP': 'CDFW Fully Protected',
  CDFW_FP: 'CDFW Fully Protected',
  FP: 'Fully Protected',
  BLM_S: 'BLM Sensitive',
  USFS_S: 'USFS Sensitive',
}
const conservationGroupFilters = [
  { id: 'group:federal', label: 'Federal ESA' },
  { id: 'group:state', label: 'California CESA' },
  { id: 'group:cdfw', label: 'CDFW special status' },
  { id: 'group:rare-plant', label: 'Rare plant rank' },
  { id: 'group:agency', label: 'Agency sensitive' },
  { id: 'group:none', label: 'No listing shown' },
]

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

function formatCriteriaMiles(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
}

function formatCount(value: number | null) {
  return value === null ? '--' : value.toLocaleString()
}

function formatElevation(low: number | null, high: number | null) {
  if (low === null && high === null) return '--'
  if (low !== null && high !== null) return `${low.toLocaleString()} - ${high.toLocaleString()} ft`
  return `${(low ?? high)?.toLocaleString()} ft`
}

function formatYear(value: number | null) {
  return value === null ? '--' : String(value)
}

function getListingCodes(value: string) {
  return value
    .split(';')
    .map((code) => code.trim())
    .filter(Boolean)
}

function getListingLabel(code: string) {
  if (statusDefinitions[code]) return statusDefinitions[code]
  if (/^\d[A-B]?\.\d$/.test(code)) {
    const [rank, threat] = code.split('.')
    const rankText = rank === '1B'
      ? 'Rare/threatened/endangered in CA and elsewhere'
      : rank === '2B'
        ? 'Rare/threatened/endangered in CA, more common elsewhere'
        : rank === '4'
          ? 'Limited distribution'
          : 'California Rare Plant Rank'
    const threatText = threat === '1'
      ? 'seriously threatened'
      : threat === '2'
        ? 'moderately threatened'
        : threat === '3'
          ? 'not very threatened'
          : 'threat rank'
    return `CRPR ${code} - ${rankText}; ${threatText}`
  }
  return code
}

function getConservationGroups(codes: string[]) {
  const groups = new Set<string>()
  if (!codes.length) groups.add('group:none')
  if (codes.some((code) => federalStatusCodes.has(code))) groups.add('group:federal')
  if (codes.some((code) => stateStatusCodes.has(code))) groups.add('group:state')
  if (codes.some((code) => cdfwStatusCodes.has(code))) groups.add('group:cdfw')
  if (codes.some((code) => /^\d[A-B]?\.\d$/.test(code))) groups.add('group:rare-plant')
  if (codes.some((code) => agencySensitiveCodes.has(code))) groups.add('group:agency')
  return groups
}

function matchesConservationFilter(codes: string[], filter: ConservationFilter) {
  if (filter.startsWith('code:')) return codes.includes(filter.replace('code:', ''))
  return getConservationGroups(codes).has(filter)
}

function joinSentences(parts: Array<string | undefined>) {
  return parts
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(' ')
}

function normalizeLookupKey(value: unknown) {
  return String(value ?? '').trim().toLowerCase()
}

function shortenElmCode(value: unknown, length: number) {
  return normalizeLookupKey(value).slice(0, length)
}

function buildSpeciesLibraryDescription(species?: SpeciesResult) {
  if (!species) return ''
  if (species.libraryDescription) return species.libraryDescription

  const habitatText = joinSentences([
    species.generalHabitat && `General habitat: ${species.generalHabitat}`,
    species.microHabitat && `Microhabitat: ${species.microHabitat}`,
  ])

  return habitatText || species.suitabilityReview || 'No species library description was found in the joined result table.'
}

function buildFinalReportDescription(species?: SpeciesResult) {
  if (!species) return ''
  return joinSentences([
    buildSpeciesLibraryDescription(species),
    species.habitatSummary,
  ])
}

function getPtoReasonBullets(species?: SpeciesResult) {
  if (!species) return []

  const distanceText = species.distanceMiles === 0
    ? 'Occurrence intersects the project area.'
    : species.distanceMiles !== null
      ? `Nearest occurrence is ${formatMiles(species.distanceMiles)} from the project.`
      : 'Nearest occurrence distance is not available.'
  const accuracyText = species.accuracyClass !== null
    ? `Best mapped occurrence accuracy is Class ${species.accuracyClass}.`
    : 'Occurrence accuracy class is not available.'
  const recordText = `${formatCount(species.frequency)} occurrence records; ${formatCount(species.extantCount)} extant, ${formatCount(species.currentCount)} current, ${formatCount(species.recentCount)} recent.`
  const statusText = species.extirpatedCount || species.possiblyExtirpatedCount
    ? `${formatCount(species.extirpatedCount)} extirpated and ${formatCount(species.possiblyExtirpatedCount)} possibly extirpated records are included.`
    : 'No extirpated records are driving the summary.'

  return [
    distanceText,
    accuracyText,
    recordText,
    statusText,
  ]
}

function getRuleSummary(species?: SpeciesResult) {
  if (!species) return '--'
  if (species.rating === 'Needs Review') return 'Needs Review (Default)'
  if (species.rating === 'Low' && species.currentCount === 0) return 'Low (Override - No Current)'
  if (species.rating === 'No Potential') return 'No Potential Rule'
  return `${species.rating} Rule`
}

function getSpeciesType(taxonGroup: string, elementType: string): Exclude<SpeciesTypeFilter, 'All'> {
  const group = taxonGroup.toLowerCase()
  const plantGroups = ['dicot', 'monocot', 'fern', 'gymnosperm', 'conifer', 'moss', 'lichen', 'bryophyte']
  if (plantGroups.some((term) => group.includes(term))) return 'Plants'

  const fallbackType = elementType.toLowerCase()
  return fallbackType.includes('plant') && !group ? 'Plants' : 'Animals'
}

async function queryArcgisTable(url: string, outFields: string, resultRecordCount = '5000') {
  const query = new URL(`${url}/query`)
  query.searchParams.set('where', '1=1')
  query.searchParams.set('outFields', outFields)
  query.searchParams.set('returnGeometry', 'false')
  query.searchParams.set('resultRecordCount', resultRecordCount)
  query.searchParams.set('f', 'json')

  const response = await fetch(query.toString())
  if (!response.ok) throw new Error(`ArcGIS table request failed: ${response.status}`)
  const data = await response.json() as { error?: { message?: string }; features?: Array<{ attributes: Record<string, unknown> }> }
  if (data.error) throw new Error(data.error.message ?? 'ArcGIS table returned an error.')
  return data.features ?? []
}

async function loadLibraryDescriptions() {
  const [plantFeatures, animalFeatures] = await Promise.all([
    queryArcgisTable(plantLookupTableUrl, 'ScientificName,CommonName,ELMCODE10,ElementCode,Plant_PTO_Description,Habitat,Microhabitat,MicrohabitatDetails', '4000'),
    queryArcgisTable(animalLookupTableUrl, 'Common_Species_Name,Scientific_Species_Name,ELMCODE,ELMCODE9,Life_History_Summary', '1000'),
  ])

  const byCode = new Map<string, { description: string; source: string }>()
  const byScientificName = new Map<string, { description: string; source: string }>()

  plantFeatures.forEach((feature) => {
    const attributes = feature.attributes
    const description = joinSentences([
      String(attributes.Plant_PTO_Description ?? ''),
      !attributes.Plant_PTO_Description && attributes.Habitat ? `Habitat: ${attributes.Habitat}` : '',
      !attributes.Plant_PTO_Description && attributes.Microhabitat ? `Microhabitat: ${attributes.Microhabitat}` : '',
      !attributes.Plant_PTO_Description && attributes.MicrohabitatDetails ? `Microhabitat details: ${attributes.MicrohabitatDetails}` : '',
    ])
    if (!description) return

    const value = { description, source: 'Plant lookup table' }
    const elmCode10 = normalizeLookupKey(attributes.ELMCODE10)
    const elementCode = normalizeLookupKey(attributes.ElementCode)
    const scientificName = normalizeLookupKey(attributes.ScientificName)
    if (elmCode10) byCode.set(elmCode10, value)
    if (elementCode) byCode.set(elementCode, value)
    if (scientificName) byScientificName.set(scientificName, value)
  })

  animalFeatures.forEach((feature) => {
    const attributes = feature.attributes
    const description = String(attributes.Life_History_Summary ?? '').trim()
    if (!description) return

    const value = { description, source: 'CWHR life-history table' }
    const elmCode = normalizeLookupKey(attributes.ELMCODE)
    const elmCode9 = normalizeLookupKey(attributes.ELMCODE9)
    const scientificName = normalizeLookupKey(attributes.Scientific_Species_Name)
    if (elmCode) byCode.set(elmCode, value)
    if (elmCode9) byCode.set(elmCode9, value)
    if (scientificName) byScientificName.set(scientificName, value)
  })

  return { byCode, byScientificName }
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
  const [selectedSpeciesId, setSelectedSpeciesId] = useState<number | null>(null)
  const [speciesTypeFilter, setSpeciesTypeFilter] = useState<SpeciesTypeFilter>('All')
  const [ratingFilter, setRatingFilter] = useState<Rating | null>(null)
  const [conservationFilters, setConservationFilters] = useState<ConservationFilter[]>([])
  const [reviewEdits, setReviewEdits] = useState<Record<number, SpeciesReviewEdit>>({})
  const [setupCollapsed, setSetupCollapsed] = useState(false)
  const [ptoCriteria, setPtoCriteria] = useState<PtoCriteria>({
    bufferDistance: 5,
    highDistance: 0.25,
    moderateDistance: 1,
    lowDistance: 5,
  })
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
      setStatsMessage('Loading SDGE Suncrest CNDDB stats and species library descriptions...')

      const query = new URL(`${statsTableUrl}/query`)
      query.searchParams.set('where', '1=1')
      query.searchParams.set('outFields', 'CNAME,SNAME,ELMCODE,TAXONGROUP,Listings,ELMTYPE_DESC,PTO_Review,Suitability_Review,GeneralHabitat,MicroHabitat,Habitats,CWHR_Summary,PTO_Caption_1,Family,Lifeform,BloomingPeriod,ElevationLow_ft,ElevationHigh_ft,References,Min_NEAR_DIST_Miles,Min_Accuracy_Class,FREQUENCY,Sum_Extant,Sum_Current_30yr,Sum_Recent_EO,Sum_Historical_30yr,Sum_Possibly_Extirpated,Sum_Extirpated,Sum_Unknown_EO,Min_Year,ObjectId')
      query.searchParams.set('returnGeometry', 'false')
      query.searchParams.set('orderByFields', 'PTO_Review ASC, Min_NEAR_DIST_Miles ASC')
      query.searchParams.set('resultRecordCount', '500')
      query.searchParams.set('f', 'json')

      try {
        const [statsResponse, libraryDescriptions] = await Promise.all([
          fetch(query.toString()),
          loadLibraryDescriptions(),
        ])
        if (!statsResponse.ok) throw new Error(`Stats table request failed: ${statsResponse.status}`)
        const data = await statsResponse.json() as { error?: { message?: string }; features?: Array<{ attributes: Record<string, unknown> }> }
        if (data.error) throw new Error(data.error.message ?? 'Stats table returned an ArcGIS error.')

        const rows = (data.features ?? []).map((feature) => {
          const attributes = feature.attributes
          const taxonGroup = String(attributes.TAXONGROUP ?? 'Unknown')
          const elementType = String(attributes.ELMTYPE_DESC ?? '')
          const elmCode = String(attributes.ELMCODE ?? '')
          const codeKeys = [
            normalizeLookupKey(elmCode),
            shortenElmCode(elmCode, 10),
            shortenElmCode(elmCode, 9),
          ].filter(Boolean)
          const libraryMatch = codeKeys
            .map((key) => libraryDescriptions.byCode.get(key))
            .find(Boolean)
            ?? libraryDescriptions.byScientificName.get(normalizeLookupKey(attributes.SNAME))

          return {
            objectId: Number(attributes.ObjectId),
            elmCode,
            rating: normalizeRating(attributes.PTO_Review),
            common: String(attributes.CNAME ?? 'Unknown common name'),
            scientific: String(attributes.SNAME ?? 'Unknown scientific name'),
            taxonGroup,
            elementType,
            listings: String(attributes.Listings ?? ''),
            speciesType: getSpeciesType(taxonGroup, elementType),
            distanceMiles: asNumber(attributes.Min_NEAR_DIST_Miles),
            accuracyClass: asNumber(attributes.Min_Accuracy_Class),
            frequency: asNumber(attributes.FREQUENCY),
            extantCount: asNumber(attributes.Sum_Extant),
            currentCount: asNumber(attributes.Sum_Current_30yr),
            recentCount: asNumber(attributes.Sum_Recent_EO),
            historicalCount: asNumber(attributes.Sum_Historical_30yr),
            possiblyExtirpatedCount: asNumber(attributes.Sum_Possibly_Extirpated),
            extirpatedCount: asNumber(attributes.Sum_Extirpated),
            unknownCount: asNumber(attributes.Sum_Unknown_EO),
            minYear: asNumber(attributes.Min_Year),
            habitatSummary: String(attributes.PTO_Caption_1 ?? attributes.CWHR_Summary ?? attributes.Habitats ?? ''),
            libraryDescription: libraryMatch?.description ?? '',
            libraryDescriptionSource: libraryMatch?.source ?? 'Joined result table',
            generalHabitat: String(attributes.GeneralHabitat ?? ''),
            microHabitat: String(attributes.MicroHabitat ?? ''),
            suitabilityReview: String(attributes.Suitability_Review ?? ''),
            family: String(attributes.Family ?? ''),
            lifeform: String(attributes.Lifeform ?? ''),
            bloomingPeriod: String(attributes.BloomingPeriod ?? ''),
            elevationLowFt: asNumber(attributes.ElevationLow_ft),
            elevationHighFt: asNumber(attributes.ElevationHigh_ft),
            references: String(attributes.References ?? ''),
          }
        })

        if (!alive) return
        setSpeciesResults(rows)
        setSelectedSpeciesId((current) => current ?? rows[0]?.objectId ?? null)
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

  const listingCodeOptions = useMemo(() => Array.from(new Set(
    speciesResults
      .flatMap((row) => getListingCodes(row.listings))
  )).sort((a, b) => a.localeCompare(b)), [speciesResults])

  const filteredSpeciesResults = useMemo(() => speciesResults.filter((row) => (
    (speciesTypeFilter === 'All' || row.speciesType === speciesTypeFilter)
    && (!ratingFilter || row.rating === ratingFilter)
    && (
      conservationFilters.length === 0
      || conservationFilters.some((filter) => matchesConservationFilter(getListingCodes(row.listings), filter))
    )
  )), [conservationFilters, ratingFilter, speciesResults, speciesTypeFilter])

  const ratingCounts = useMemo(() => ratingOrder.map((label) => ({
    label,
    count: speciesResults.filter((row) => (
      row.rating === label
      && (speciesTypeFilter === 'All' || row.speciesType === speciesTypeFilter)
      && (
        conservationFilters.length === 0
        || conservationFilters.some((filter) => matchesConservationFilter(getListingCodes(row.listings), filter))
      )
    )).length,
  })), [conservationFilters, speciesResults, speciesTypeFilter])

  const selectedSpecies = filteredSpeciesResults.find((row) => row.objectId === selectedSpeciesId) ?? filteredSpeciesResults[0]
  const totalSpecies = filteredSpeciesResults.length
  const totalOccurrences = filteredSpeciesResults.reduce((sum, row) => sum + (row.frequency ?? 0), 0)
  const plantCount = speciesResults.filter((row) => row.speciesType === 'Plants').length
  const animalCount = speciesResults.filter((row) => row.speciesType === 'Animals').length
  const selectedReview = selectedSpecies ? reviewEdits[selectedSpecies.objectId] : undefined
  const selectedPotential = selectedReview?.rating ?? selectedSpecies?.rating ?? 'Needs Review'
  const speciesLibraryDescription = buildSpeciesLibraryDescription(selectedSpecies)
  const automatedPtoSummary = selectedSpecies?.habitatSummary || 'No automated PTO summary was found in the stats table.'
  const selectedHabitatSummary = selectedReview?.habitatSummary ?? buildFinalReportDescription(selectedSpecies)
  const criteriaValid = (
    ptoCriteria.highDistance > 0
    && ptoCriteria.highDistance <= ptoCriteria.moderateDistance
    && ptoCriteria.moderateDistance <= ptoCriteria.lowDistance
    && ptoCriteria.lowDistance <= ptoCriteria.bufferDistance
  )
  const highDistanceLabel = formatCriteriaMiles(ptoCriteria.highDistance)
  const moderateDistanceLabel = formatCriteriaMiles(ptoCriteria.moderateDistance)
  const lowDistanceLabel = formatCriteriaMiles(ptoCriteria.lowDistance)

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

  function updatePtoCriteria(key: keyof PtoCriteria, value: string) {
    const next = Number(value)
    if (!Number.isFinite(next)) return
    setPtoCriteria((current) => ({
      ...current,
      [key]: next,
    }))
  }

  function handleLoadProjectLayer() {
    setLoadedProjectLayerUrl(projectLayerUrl.trim())
  }

  function handleRunAnalysis() {
    setSetupCollapsed(true)
  }

  function handleResetAnalysis() {
    setSetupCollapsed(false)
  }

  function updateSelectedReview(update: SpeciesReviewEdit) {
    if (!selectedSpecies) return
    setReviewEdits((current) => ({
      ...current,
      [selectedSpecies.objectId]: {
        ...current[selectedSpecies.objectId],
        ...update,
      },
    }))
  }

  function toggleConservationFilter(filter: ConservationFilter) {
    setConservationFilters((current) => (
      current.includes(filter)
        ? current.filter((item) => item !== filter)
        : [...current, filter]
    ))
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
          <button className="icon-button" type="button" aria-label="Reset analysis" onClick={handleResetAnalysis}>
            <RotateCcw size={18} />
          </button>
          <button className="secondary-button" type="button">
            <Settings2 size={17} />
            Settings
          </button>
          <button className="primary-button" type="button" disabled={!projectSketch.isReadyForAnalysis} onClick={handleRunAnalysis}>
            <Play size={17} fill="currentColor" />
            Run Analysis
          </button>
        </div>
      </header>

      <section className={`workspace ${setupCollapsed ? 'setup-collapsed' : ''}`}>
        <aside className={`setup-panel ${setupCollapsed ? 'collapsed' : ''}`} aria-label="Analysis setup">
          {setupCollapsed ? (
            <button className="setup-rail-button" type="button" onClick={() => setSetupCollapsed(false)} aria-label="Show analysis setup">
              <PanelLeftOpen size={18} />
              <span>Setup</span>
            </button>
          ) : (
            <div className="setup-panel-toolbar">
              <span>Analysis Setup</span>
              <button type="button" onClick={() => setSetupCollapsed(true)} aria-label="Collapse analysis setup">
                <PanelLeftClose size={17} />
              </button>
            </div>
          )}
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
                <h2>PTO Criteria</h2>
                <p>Current distance, accuracy, recency, and habitat evidence.</p>
              </div>
            </div>
            <div className="criteria-input-grid">
              <label>
                Buffer
                <input type="number" min="0.25" step="0.25" value={ptoCriteria.bufferDistance} onChange={(event) => updatePtoCriteria('bufferDistance', event.target.value)} />
              </label>
              <label>
                High
                <input type="number" min="0.01" step="0.05" value={ptoCriteria.highDistance} onChange={(event) => updatePtoCriteria('highDistance', event.target.value)} />
              </label>
              <label>
                Moderate
                <input type="number" min="0.01" step="0.05" value={ptoCriteria.moderateDistance} onChange={(event) => updatePtoCriteria('moderateDistance', event.target.value)} />
              </label>
              <label>
                Low
                <input type="number" min="0.01" step="0.25" value={ptoCriteria.lowDistance} onChange={(event) => updatePtoCriteria('lowDistance', event.target.value)} />
              </label>
            </div>
            {!criteriaValid && (
              <div className="criteria-warning">Distances must increase from High to Moderate to Low, and Low cannot exceed Buffer.</div>
            )}
            <div className="criteria-label">Advanced criteria</div>
            <div className="criteria-grid" aria-label="Advanced PTO criteria">
              <div className="criteria-card">
                <strong>Distance</strong>
                <span>High: intersects or &lt;= {highDistanceLabel} mi</span>
                <span>Moderate: {highDistanceLabel} to {moderateDistanceLabel} mi</span>
                <span>Low: {moderateDistanceLabel} to {lowDistanceLabel} mi</span>
              </div>
              <div className="criteria-card">
                <strong>Record status</strong>
                <span>Separates current, recent, historical, unknown, and extirpated records.</span>
              </div>
              <div className="criteria-card">
                <strong>Accuracy</strong>
                <span>Uses CNDDB accuracy class when explaining confidence in the rating.</span>
              </div>
              <div className="criteria-card">
                <strong>Habitat evidence</strong>
                <span>Shows suitability review and lookup-table species habitat text when available.</span>
              </div>
            </div>
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
            <ArcGISMap activeMapTool={activeMapTool} projectLayerUrl={loadedProjectLayerUrl} cnddbLayerUrl={cnddbLayerUrl} selectedSpeciesName={selectedSpecies?.common} onProjectSketchChange={setProjectSketch} />
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
          <div className="review-header">
            <div>
              <p className="eyebrow">Results Review</p>
              <h2>Project: PGE_SM</h2>
              <small>{statsStatus === 'ready' ? 'Completed' : statsStatus} - SDGE Suncrest sample results</small>
            </div>
            <div className="review-actions">
              <button type="button" onClick={() => setSetupCollapsed(false)}><Layers3 size={16} /> Open map</button>
              <button type="button"><FileSpreadsheet size={16} /> Export Excel</button>
              <button type="button"><FileText size={16} /> Download docs</button>
            </div>
          </div>

          <div className="run-status">
            <CheckCircle2 size={19} />
            <div>
              <h2>{statsStatus === 'ready' ? 'SDGE Suncrest loaded' : statsStatus === 'error' ? 'Results need attention' : 'Loading results'}</h2>
              <p>{statsMessage}</p>
            </div>
          </div>

          <div className="summary-grid">
            {ratingCounts.map((item) => (
              <button className={`summary-card ${item.label.toLowerCase().replaceAll(' ', '-')} ${ratingFilter === item.label ? 'selected' : ''}`} type="button" key={item.label} onClick={() => setRatingFilter((current) => current === item.label ? null : item.label)}>
                <span>{item.label}</span>
                <strong>{item.count}</strong>
              </button>
            ))}
            <div className="summary-card neutral">
              <span>Total Species</span>
              <strong>{speciesResults.length || totalSpecies}</strong>
            </div>
            <div className="summary-card neutral">
              <span>Approx. Credits</span>
              <strong>3.1</strong>
            </div>
          </div>

          <div className="downloads-row">
            <button type="button"><FileSpreadsheet size={16} /> Excel</button>
            <button type="button"><FileText size={16} /> Animals</button>
            <button type="button"><FileText size={16} /> Plants</button>
            <button type="button"><FileText size={16} /> Report</button>
          </div>

          <div className="table-card">
            <div className="table-heading">
              <h2>Species Results</h2>
              <button type="button"><ArrowDownToLine size={16} /></button>
            </div>
            <div className="species-filter segmented-control compact" aria-label="Species type filter">
              {(['All', 'Plants', 'Animals'] as SpeciesTypeFilter[]).map((filter) => (
                <button className={speciesTypeFilter === filter ? 'selected' : ''} type="button" key={filter} onClick={() => setSpeciesTypeFilter(filter)}>
                  {filter === 'All' ? `All ${speciesResults.length}` : filter === 'Plants' ? `Plants ${plantCount}` : `Animals ${animalCount}`}
                </button>
              ))}
            </div>
            <div className="conservation-filter">
              <div className="filter-heading-row">
                <span>Conservation status</span>
                {conservationFilters.length > 0 && (
                  <button type="button" onClick={() => setConservationFilters([])}>Clear</button>
                )}
              </div>
              <div className="filter-chip-grid primary">
                {conservationGroupFilters.map((filter) => (
                  <button className={conservationFilters.includes(filter.id) ? 'selected' : ''} type="button" key={filter.id} onClick={() => toggleConservationFilter(filter.id)}>
                    {filter.label}
                  </button>
                ))}
              </div>
              <div className="filter-chip-grid codes">
                {listingCodeOptions.map((code) => (
                  <button className={conservationFilters.includes(`code:${code}`) ? 'selected' : ''} type="button" key={code} onClick={() => toggleConservationFilter(`code:${code}`)} title={getListingLabel(code)}>
                    {code}
                  </button>
                ))}
              </div>
            </div>
            <div className="selected-species-card">
              <div className="selected-species-heading">
                {selectedSpecies ? <RatingPill rating={selectedPotential} /> : <RatingPill rating="Needs Review" />}
                <div>
                  <h3>{selectedSpecies?.common ?? 'Select a species'}</h3>
                  <p>{selectedSpecies ? `${selectedSpecies.scientific} - ${selectedSpecies.taxonGroup || selectedSpecies.speciesType}` : 'Click a row below to review model evidence.'}</p>
                </div>
              </div>
              <div className="selected-species-metrics">
                <span>Distance <strong>{formatMiles(selectedSpecies?.distanceMiles ?? null)}</strong></span>
                <span>Accuracy <strong>{selectedSpecies?.accuracyClass ? `Class ${selectedSpecies.accuracyClass}` : '--'}</strong></span>
                <span>Records <strong>{formatCount(selectedSpecies?.frequency ?? null)}</strong></span>
              </div>
              <ul>
                {getPtoReasonBullets(selectedSpecies).slice(0, 3).map((reason) => <li key={reason}>{reason}</li>)}
              </ul>
            </div>
            <div className="species-table-header">
              <span>Potential</span>
              <span>Common Name</span>
              <span>Scientific Name</span>
              <span>Distance</span>
              <span>Accuracy</span>
              <span>Current</span>
              <span>Extant</span>
              <span>Rule</span>
            </div>
            <div className="species-list">
              {filteredSpeciesResults.slice(0, 120).map((row) => (
                <button className={`species-row ${row.rating.toLowerCase().replaceAll(' ', '-')} ${selectedSpecies?.objectId === row.objectId ? 'selected' : ''}`} type="button" key={row.objectId} onClick={() => setSelectedSpeciesId(row.objectId)}>
                  <RatingPill rating={row.rating} />
                  <span className="species-name">
                    <strong>{row.common}</strong>
                    <em>{row.scientific}</em>
                    <small>{row.taxonGroup || row.speciesType} · {getListingCodes(row.listings).map(getListingLabel).join(' · ') || 'No listing shown'}</small>
                  </span>
                  <span className="species-scientific-cell"><em>{row.scientific}</em></span>
                  <span>{formatMiles(row.distanceMiles)}</span>
                  <span className="species-extra-cell">{row.accuracyClass ? `Class ${row.accuracyClass}` : '--'}</span>
                  <span className="species-extra-cell">{row.currentCount ? 'Yes' : 'No'}</span>
                  <span className="species-extra-cell">{row.extantCount ? 'Yes' : 'No'}</span>
                  <span className="species-extra-cell rule-cell">{getRuleSummary(row)}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="detail-panel">
            <div className="detail-heading">
              {selectedSpecies ? <RatingPill rating={selectedPotential} /> : <RatingPill rating="Needs Review" />}
              <h2>{selectedSpecies?.common ?? 'No species loaded'}</h2>
              <p>{selectedSpecies ? `${selectedSpecies.scientific} - ${selectedSpecies.taxonGroup || selectedSpecies.speciesType}` : statsMessage}</p>
            </div>
            <div className="reason-card">
              <div>
                <p className="eyebrow">Why this rating?</p>
                <h3>{selectedPotential} potential</h3>
              </div>
              <ul>
                {getPtoReasonBullets(selectedSpecies).map((reason) => <li key={reason}>{reason}</li>)}
              </ul>
            </div>
            <div className="evidence-list">
              <span>Nearest record <strong>{formatMiles(selectedSpecies?.distanceMiles ?? null)}</strong></span>
              <span>Location accuracy <strong>{selectedSpecies?.accuracyClass ? `Class ${selectedSpecies.accuracyClass}` : '--'}</strong></span>
              <span>Total records <strong>{formatCount(selectedSpecies?.frequency ?? null)}</strong></span>
              <span>Extant records <strong>{formatCount(selectedSpecies?.extantCount ?? null)}</strong></span>
              <span>Current ≤30 yr <strong>{formatCount(selectedSpecies?.currentCount ?? null)}</strong></span>
              <span>Recent EO <strong>{formatCount(selectedSpecies?.recentCount ?? null)}</strong></span>
              <span>Historical ≤30 yr <strong>{formatCount(selectedSpecies?.historicalCount ?? null)}</strong></span>
              <span>Possibly extirpated <strong>{formatCount(selectedSpecies?.possiblyExtirpatedCount ?? null)}</strong></span>
              <span>Extirpated <strong>{formatCount(selectedSpecies?.extirpatedCount ?? null)}</strong></span>
              <span>Unknown EO <strong>{formatCount(selectedSpecies?.unknownCount ?? null)}</strong></span>
              <span>Earliest record year <strong>{formatYear(selectedSpecies?.minYear ?? null)}</strong></span>
              <span>Listing status <strong>{selectedSpecies ? getListingCodes(selectedSpecies.listings).map(getListingLabel).join('; ') || 'No listing shown' : '--'}</strong></span>
            </div>
            {selectedSpecies?.suitabilityReview && (
              <p className="reason-text">
                <strong>Habitat suitability:</strong> {selectedSpecies.suitabilityReview}
              </p>
            )}
            {selectedSpecies?.speciesType === 'Plants' && (
              <div className="plant-facts">
                <h3>Plant Details</h3>
                <div className="plant-fact-grid">
                  <span>Family <strong>{selectedSpecies.family || '--'}</strong></span>
                  <span>Lifeform <strong>{selectedSpecies.lifeform || '--'}</strong></span>
                  <span>Blooming period <strong>{selectedSpecies.bloomingPeriod || '--'}</strong></span>
                  <span>Elevation <strong>{formatElevation(selectedSpecies.elevationLowFt, selectedSpecies.elevationHighFt)}</strong></span>
                </div>
                {(selectedSpecies.generalHabitat || selectedSpecies.microHabitat || selectedSpecies.references) && (
                  <div className="plant-notes">
                    {selectedSpecies.generalHabitat && <p><strong>General habitat:</strong> {selectedSpecies.generalHabitat}</p>}
                    {selectedSpecies.microHabitat && <p><strong>Microhabitat:</strong> {selectedSpecies.microHabitat}</p>}
                    {selectedSpecies.references && <p><strong>References:</strong> {selectedSpecies.references}</p>}
                  </div>
                )}
              </div>
            )}
            <div className="review-grid">
              <label className="review-field">
                Reviewed potential
                <select value={selectedPotential} onChange={(event) => updateSelectedReview({ rating: event.target.value as Rating })} disabled={!selectedSpecies}>
                  {ratingOrder.map((rating) => <option value={rating} key={rating}>{rating}</option>)}
                </select>
              </label>
              <section className="report-summary-card">
                <div className="report-summary-heading">
                  <span>Final Report Description</span>
                  <strong>{selectedPotential}</strong>
                </div>
                <textarea aria-label="Final report description" value={selectedHabitatSummary} onChange={(event) => updateSelectedReview({ habitatSummary: event.target.value })} disabled={!selectedSpecies} />
              </section>
              <section className="source-summary-card">
                <h3>Species Library Description</h3>
                <small>{selectedSpecies?.libraryDescriptionSource ?? 'Lookup source'}</small>
                <p>{speciesLibraryDescription}</p>
              </section>
              <section className="source-summary-card model-summary-card">
                <h3>Automated PTO Summary</h3>
                <p>{automatedPtoSummary}</p>
              </section>
            </div>
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







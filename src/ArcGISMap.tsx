import { useEffect, useRef, useState } from 'react'
import Map from '@arcgis/core/Map'
import WebMap from '@arcgis/core/WebMap'
import esriConfig from '@arcgis/core/config'
import MapView from '@arcgis/core/views/MapView'
import Basemap from '@arcgis/core/Basemap'
import GraphicsLayer from '@arcgis/core/layers/GraphicsLayer'
import FeatureLayer from '@arcgis/core/layers/FeatureLayer'
import TileLayer from '@arcgis/core/layers/TileLayer'
import Sketch from '@arcgis/core/widgets/Sketch'
import LayerList from '@arcgis/core/widgets/LayerList'
import Measurement from '@arcgis/core/widgets/Measurement'
import '@arcgis/core/assets/esri/themes/light/main.css'
import './ArcGISMap.css'

export type ProjectInputFeatureSet = {
  geometryType: 'esriGeometryPoint' | 'esriGeometryPolyline' | 'esriGeometryPolygon'
  spatialReference: Record<string, unknown>
  fields: Array<{ name: string; type: string; alias: string }>
  features: Array<{
    geometry: Record<string, unknown>
    attributes: Record<string, unknown>
  }>
}

export type ProjectLayerInput = {
  url: string
}

export type MapAddedLayer = {
  id: string
  title: string
  url: string
}

export type ProjectSketchSummary = {
  source: 'Sketch' | 'FeatureLayer' | 'Demo'
  featureCount: number
  geometryType: string
  isReadyForAnalysis: boolean
  warning?: string
  projectInput?: ProjectInputFeatureSet | ProjectLayerInput
}

type ArcGISMapProps = {
  activeMapTool?: 'layers' | 'measure' | 'sketch' | null
  webMapId?: string
  projectLayerUrl?: string
  bufferLayerUrl?: string
  cnddbLayerUrl?: string
  mapAddedLayers?: MapAddedLayer[]
  selectedSpeciesName?: string
  visibleSpeciesNames?: string[] | null
  speciesRatings?: Array<{ name: string; rating: string }>
  reviewMode?: boolean
  onProjectSketchChange?: (summary: ProjectSketchSummary) => void
  onRemoveMapLayer?: (id: string) => void
  onRemoveProjectLayer?: () => void
  onRemoveBufferLayer?: () => void
  onRemoveCnddbLayer?: () => void
  onSelectSpeciesFromMap?: (commonName: string) => void
}

type FeaturePopup = {
  title: string
  layerTitle: string
  fields: Array<{ label: string; value: string }>
}

// Stable default so omitting the prop doesn't hand the map-init effect a fresh array
// identity every render (which would re-run the effect -> setState -> re-render loop).
const EMPTY_ADDED_LAYERS: MapAddedLayer[] = []
const EMPTY_SPECIES_RATINGS: Array<{ name: string; rating: string }> = []

// Esri World Imagery from the public tiled map services — no API key or sign-in required —
// with a reference overlay for place/road labels (the "hybrid" imagery look). Used as the
// basemap when no (signed-in) web map is supplied.
function publicEsriImageryBasemap() {
  return new Basemap({
    baseLayers: [new TileLayer({ url: 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer' })],
    referenceLayers: [new TileLayer({ url: 'https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer' })],
  })
}

type MapDiagnosticEntry = {
  at: number
  event: string
  data?: Record<string, unknown>
}

type MapDiagnosticWindow = typeof window & {
  __bioPtoDiagnostics?: MapDiagnosticEntry[]
}

function toFeatureSetGeometryType(type: string | undefined): ProjectInputFeatureSet['geometryType'] | null {
  if (type === 'point') return 'esriGeometryPoint'
  if (type === 'polyline') return 'esriGeometryPolyline'
  if (type === 'polygon') return 'esriGeometryPolygon'
  return null
}

function summarizeSketch(layer: GraphicsLayer): ProjectSketchSummary | null {
  const graphics = layer.graphics.toArray().filter((graphic) => graphic.geometry)
  const geometryTypes = [...new Set(graphics.map((graphic) => graphic.geometry?.type).filter(Boolean))]
  const displayGeometryType = geometryTypes.length === 0 ? 'None' : geometryTypes.join(', ')

  if (graphics.length === 0) return null

  if (geometryTypes.length !== 1) {
    return {
      source: 'Sketch',
      featureCount: graphics.length,
      geometryType: displayGeometryType,
      isReadyForAnalysis: false,
      warning: 'Use one geometry type per run. Delete mixed sketches and draw only points, lines, or polygons.',
    }
  }

  const geometryType = toFeatureSetGeometryType(geometryTypes[0])
  if (!geometryType) {
    return {
      source: 'Sketch',
      featureCount: graphics.length,
      geometryType: displayGeometryType,
      isReadyForAnalysis: false,
      warning: 'Unsupported sketch geometry type.',
    }
  }

  const firstGeometryJson = graphics[0]?.geometry?.toJSON() as Record<string, unknown> | undefined
  const spatialReference = (firstGeometryJson?.spatialReference as Record<string, unknown> | undefined) ?? { wkid: 102100 }

  return {
    source: 'Sketch',
    featureCount: graphics.length,
    geometryType: displayGeometryType,
    isReadyForAnalysis: true,
    projectInput: {
      geometryType,
      spatialReference,
      fields: [
        { name: 'OBJECTID', type: 'esriFieldTypeOID', alias: 'OBJECTID' },
      ],
      features: graphics.map((graphic, index) => ({
        geometry: graphic.geometry?.toJSON() as Record<string, unknown>,
        attributes: { OBJECTID: index + 1 },
      })),
    },
  }
}

function emptySummary(): ProjectSketchSummary {
  return {
    source: 'Demo',
    featureCount: 0,
    geometryType: 'None',
    isReadyForAnalysis: false,
    warning: 'Draw a project feature or load a feature service layer to create project_input.',
  }
}

// PTO rating palette — must match the rating pills / summary widgets in App.css so the
// map, the widgets, and the list all speak one color language (red=High ... green=Low).
// Colorblind-safe scale (Okabe–Ito based): High↔Low stay distinguishable under
// red-green color vision deficiency. Hues vary in lightness as well as color.
const RATING_COLORS: Record<string, [number, number, number]> = {
  High: [213, 94, 0],       // #D55E00 vermillion
  Moderate: [230, 184, 0],  // #E6B800 gold
  Low: [0, 158, 115],       // #009E73 bluish green
  'No Potential': [153, 153, 153], // #999999 gray (off the scale)
  'Needs Review': [204, 121, 167], // #CC79A7 reddish purple
}
const NEUTRAL_RATING_COLOR: [number, number, number] = [153, 153, 153]

function ratingFillSymbol([r, g, b]: [number, number, number]) {
  return {
    type: 'simple-fill' as const,
    color: [r, g, b, 0.55],
    outline: { color: [Math.round(r * 0.6), Math.round(g * 0.6), Math.round(b * 0.6), 1], width: 1.2 },
  }
}

// Fallback renderer used before the species ratings arrive (or if none load).
function cnddbDefaultRenderer() {
  return { type: 'simple' as const, symbol: ratingFillSymbol(NEUTRAL_RATING_COLOR) }
}

// Color each CNDDB feature by its species' PTO rating, joined by common name (CNAME),
// since PTO_Review is null on the CNDDB features themselves.
function cnddbRatingRenderer(speciesRatings: Array<{ name: string; rating: string }>) {
  const byName = new globalThis.Map(speciesRatings.map((entry) => [entry.name, entry.rating]))
  return {
    type: 'unique-value' as const,
    field: 'CNAME',
    defaultSymbol: ratingFillSymbol(NEUTRAL_RATING_COLOR),
    uniqueValueInfos: [...byName].map(([name, rating]) => ({
      value: name,
      symbol: ratingFillSymbol(RATING_COLORS[rating] ?? NEUTRAL_RATING_COLOR),
    })),
  }
}

// "Selected" is a neutral cyan halo (transparent fill, bold outline) laid over the
// rating-colored feature — a consistent selection cue that doesn't fight the rating hue.
function cnddbSelectedRenderer() {
  return {
    type: 'simple' as const,
    symbol: {
      type: 'simple-fill' as const,
      color: [0, 180, 255, 0],
      outline: { color: [0, 180, 255, 1], width: 3.5 },
    },
  }
}

export function ArcGISMap({ activeMapTool = null, webMapId, projectLayerUrl, bufferLayerUrl, cnddbLayerUrl, mapAddedLayers = EMPTY_ADDED_LAYERS, selectedSpeciesName, visibleSpeciesNames = null, speciesRatings = EMPTY_SPECIES_RATINGS, reviewMode = false, onProjectSketchChange, onRemoveMapLayer, onRemoveProjectLayer, onRemoveBufferLayer, onRemoveCnddbLayer, onSelectSpeciesFromMap }: ArcGISMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const layerListRef = useRef<HTMLDivElement | null>(null)
  const measureRef = useRef<HTMLDivElement | null>(null)
  const sketchRef = useRef<HTMLDivElement | null>(null)
  const [debugEvents, setDebugEvents] = useState<string[]>([])
  const [featurePopup, setFeaturePopup] = useState<FeaturePopup | null>(null)
  const projectUrlRef = useRef(projectLayerUrl?.trim() ?? '')
  const selectedSpeciesRef = useRef(selectedSpeciesName?.trim() ?? '')
  const visibleSpeciesNamesRef = useRef<string[] | null>(visibleSpeciesNames ?? null)
  const speciesRatingsRef = useRef(speciesRatings)
  const activeMapToolRef = useRef(activeMapTool)
  const applyMapFilterRef = useRef<(() => void) | null>(null)
  const applyRatingRendererRef = useRef<(() => void) | null>(null)
  const onSelectSpeciesFromMapRef = useRef(onSelectSpeciesFromMap)
  // Handle for the currently highlighted (selected) CNDDB feature, so a new click or a
  // popup close can clear the previous selection — same feel as ArcGIS Online.
  const featureHighlightRef = useRef<__esri.Handle | null>(null)
  const debugEnabled = import.meta.env.DEV

  useEffect(() => {
    projectUrlRef.current = projectLayerUrl?.trim() ?? ''
  }, [projectLayerUrl])

  useEffect(() => {
    selectedSpeciesRef.current = selectedSpeciesName?.trim() ?? ''
    applyMapFilterRef.current?.()
  }, [selectedSpeciesName])

  useEffect(() => {
    visibleSpeciesNamesRef.current = visibleSpeciesNames ?? null
    applyMapFilterRef.current?.()
  }, [visibleSpeciesNames])

  useEffect(() => {
    speciesRatingsRef.current = speciesRatings
    applyRatingRendererRef.current?.()
  }, [speciesRatings])

  useEffect(() => {
    activeMapToolRef.current = activeMapTool
  }, [activeMapTool])

  useEffect(() => {
    onSelectSpeciesFromMapRef.current = onSelectSpeciesFromMap
  }, [onSelectSpeciesFromMap])

  useEffect(() => {
    if (!containerRef.current || !layerListRef.current || !measureRef.current || !sketchRef.current) return
    setDebugEvents([])
    esriConfig.request.useIdentity = Boolean(webMapId?.trim())

    const logDebugEvent = (message: string) => {
      if (!debugEnabled) return
      const stamp = new Date().toLocaleTimeString()
      setDebugEvents((current) => [`${stamp} ${message}`, ...current].slice(0, 12))
      console.debug(`[BIO PTO map] ${message}`)
    }

    const projectLayer = new GraphicsLayer({ title: 'Project input', listMode: 'hide' })
    const resultLayer = new GraphicsLayer({ title: 'PTO results', listMode: 'hide' })
    const sketchLayer = new GraphicsLayer({ title: 'Project sketch input', listMode: 'hide' })
    const bufferOutputLayer = bufferLayerUrl?.trim()
      ? new FeatureLayer({
        id: 'pto-buffer-output',
        url: bufferLayerUrl.trim(),
        title: 'PTO buffer',
        outFields: ['*'],
        opacity: 0.68,
        popupEnabled: false,
        popupTemplate: {
          title: 'PTO buffer',
          content: 'PTO buffer output from the notebook run.',
        },
        renderer: {
          type: 'simple',
          symbol: {
            type: 'simple-fill',
            color: [0, 145, 190, 0.22],
            outline: { color: [0, 92, 155, 1], width: 3 },
          },
        },
      })
      : null
    const cnddbOutputLayer = cnddbLayerUrl?.trim()
      ? new FeatureLayer({
        id: 'pto-cnddb-output',
        url: cnddbLayerUrl.trim(),
        title: 'CNDDB output results',
        // Display only needs CNAME; the app-owned popup re-queries the server for all
        // fields on click. Pulling ['*'] here downloads every attribute for every
        // feature into the client, adding weight that hurts pan smoothness.
        outFields: ['CNAME'],
        opacity: 0.88,
        minScale: 0,
        maxScale: 0,
        popupEnabled: false,
        renderer: cnddbDefaultRenderer(),
      })
      : null
    const selectedCnddbOutputLayer = cnddbLayerUrl?.trim()
      ? new FeatureLayer({
        id: 'pto-cnddb-selected-output',
        url: cnddbLayerUrl.trim(),
        title: 'Selected CNDDB species',
        outFields: ['CNAME'],
        opacity: 0.95,
        minScale: 0,
        maxScale: 0,
        popupEnabled: false,
        visible: false,
        listMode: 'hide',
        definitionExpression: '1=0',
        renderer: cnddbSelectedRenderer(),
      })
      : null
    const userAddedFeatureLayers = mapAddedLayers.map((layer) => new FeatureLayer({
      id: `map-added-${layer.id}`,
      url: layer.url,
      title: layer.title,
      outFields: ['*'],
      popupEnabled: true,
      customParameters: { bioPtoLayerId: layer.id },
    }))

    const map = webMapId?.trim()
      ? new WebMap({ portalItem: { id: webMapId.trim() } })
      : new Map({ basemap: publicEsriImageryBasemap() })
    map.addMany([projectLayer, resultLayer, ...userAddedFeatureLayers, ...[bufferOutputLayer, cnddbOutputLayer, selectedCnddbOutputLayer].filter((layer): layer is FeatureLayer => Boolean(layer)), sketchLayer])

    // Keep the review overlays stacked on top, in this bottom-to-top order.
    // MUST be idempotent: this runs from `after-add`, and map.reorder() itself fires
    // `after-add`, so a non-converging version loops forever and starves the main thread
    // (the map "freezes" — never reaches view.stationary).
    const bringReviewLayersToFront = () => {
      const desiredTop = [bufferOutputLayer, cnddbOutputLayer, selectedCnddbOutputLayer, sketchLayer]
        .filter((layer): layer is GraphicsLayer | FeatureLayer => layer != null)
        .filter((layer) => map.layers.includes(layer))
      if (desiredTop.length === 0) return

      const baseIndex = map.layers.length - desiredTop.length
      // Already stacked correctly, in order, at the top? Then do nothing — this is what
      // lets the reorder -> after-add -> reorder chain reach a fixed point and stop.
      const alreadyOrdered = desiredTop.every((layer, offset) => map.layers.indexOf(layer) === baseIndex + offset)
      if (alreadyOrdered) return

      desiredTop.forEach((layer, offset) => map.reorder(layer, baseIndex + offset))
    }
    const layerOrderHandle = map.layers.on('after-add', () => {
      window.setTimeout(bringReviewLayersToFront, 0)
    })
    bringReviewLayersToFront()

    const view = new MapView({
      container: containerRef.current,
      map,
      ...(webMapId?.trim() ? {} : { center: [-121.58, 38.42], zoom: 10 }),
      constraints: {
        snapToZoom: false,
      },
      popupEnabled: false,
    })

    const diagnosticWindow = window as MapDiagnosticWindow
    diagnosticWindow.__bioPtoDiagnostics = []
    const diagnosticNode = document.createElement('script')
    diagnosticNode.id = 'bio-pto-map-diagnostics'
    diagnosticNode.type = 'application/json'
    document.body.appendChild(diagnosticNode)
    const recordDiagnostic = (event: string, data?: Record<string, unknown>) => {
      const entries = diagnosticWindow.__bioPtoDiagnostics ?? []
      entries.push({ at: Math.round(performance.now()), event, data })
      if (entries.length > 120) entries.splice(0, entries.length - 120)
      diagnosticWindow.__bioPtoDiagnostics = entries
      diagnosticNode.textContent = JSON.stringify(entries)
    }
    recordDiagnostic('recorder:armed')

    // Recovery net for the ArcGIS 4.x "stuck grab cursor / view.interacting === true"
    // symptom. The standalone map-click-debug.html clears the surface cursor on every
    // pointer-up / drag-end / blur; the React port dropped that safety net, so an
    // interaction that ArcGIS fails to fully close left the closed-fist cursor behind.
    const clearStuckPointerCursor = (reason: string) => {
      const surface = containerRef.current?.querySelector<HTMLElement>('.esri-view-surface')
      if (surface) surface.style.cursor = ''
      document.body.style.cursor = ''
      recordDiagnostic('pointer-cursor:cleared', { reason, interacting: view.interacting, stationary: view.stationary })
    }

    let featureLayerSummary: ProjectSketchSummary | null = null
    let projectFeatureLayer: FeatureLayer | null = null
    let loadedProjectUrl = ''
    let zoomedToCnddbOutput = false
    let popupQueryId = 0

    // Native ArcGIS click — the same pipeline map-click-debug.html uses. `view.on('click')`
    // is suppressed after a pan/drag (no manual 8px drag heuristic needed) and never fights
    // the drag/pointer-capture state the way a capture-phase DOM listener can.
    const onViewClick = (event: __esri.ViewClickEvent) => {
      recordDiagnostic('view:click', { x: Math.round(event.x), y: Math.round(event.y), tool: activeMapToolRef.current })
      if (activeMapToolRef.current === 'measure' || activeMapToolRef.current === 'sketch') {
        recordDiagnostic('query:skipped', { reason: 'active-tool' })
        return
      }

      const layer = selectedCnddbOutputLayer?.visible ? selectedCnddbOutputLayer : cnddbOutputLayer
      if (!layer?.loaded || !layer.visible) {
        recordDiagnostic('query:skipped', { reason: 'layer-unavailable', loaded: layer?.loaded, visible: layer?.visible })
        return
      }

      const mapPoint = event.mapPoint
      if (!mapPoint) {
        recordDiagnostic('query:skipped', { reason: 'no-map-point' })
        return
      }

      const requestId = ++popupQueryId
      const queryStartedAt = performance.now()
      recordDiagnostic('query:start', { requestId, layer: layer.id })
      void (async () => {
        try {
          const query = layer.createQuery()
          query.geometry = mapPoint
          query.spatialRelationship = 'intersects'
          query.outFields = ['*']
          query.returnGeometry = false
          query.num = 1
          const result = await layer.queryFeatures(query)
          recordDiagnostic('query:complete', { requestId, durationMs: Math.round(performance.now() - queryStartedAt), features: result.features.length })
          if (requestId !== popupQueryId) return

          // Clicking empty space clears the current selection + popup, like ArcGIS Online.
          if (result.features.length === 0) {
            featureHighlightRef.current?.remove()
            featureHighlightRef.current = null
            setFeaturePopup(null)
            onSelectSpeciesFromMapRef.current?.('')
            return
          }

          const feature = result.features[0]
          const attributes = feature.attributes ?? {}

          // Select (highlight) the clicked feature. highlight() draws the selection glow
          // over the rendered feature by objectId — no extra geometry download needed.
          const objectId = attributes[layer.objectIdField]
          try {
            const layerView = await view.whenLayerView(layer) as __esri.FeatureLayerView
            if (requestId !== popupQueryId) return
            featureHighlightRef.current?.remove()
            featureHighlightRef.current = layerView.highlight(objectId)
            recordDiagnostic('feature:highlight', { requestId, objectId })
          } catch (error) {
            recordDiagnostic('feature:highlight-error', { requestId, message: error instanceof Error ? error.message : String(error) })
          }

          // Reflect the map click back into the review panel: select this species so its
          // row + review details highlight (and the map focuses on it).
          const clickedCommonName = String(attributes.CNAME ?? '').trim()
          if (clickedCommonName) {
            onSelectSpeciesFromMapRef.current?.(clickedCommonName)
            recordDiagnostic('feature:select-species', { requestId, commonName: clickedCommonName })
          }

          const aliases = new globalThis.Map(layer.fields.map((field) => [field.name, field.alias || field.name]))
          const fields = Object.keys(attributes)
            .filter((name) => !/^shape/i.test(name))
            .filter((name) => attributes[name] !== null && attributes[name] !== undefined && attributes[name] !== '')
            .map((name) => ({ label: aliases.get(name) ?? name, value: String(attributes[name]) }))
          setFeaturePopup({
            title: String(attributes.CNAME ?? attributes.SNAME ?? layer.title),
            layerTitle: layer.title ?? 'CNDDB results',
            fields,
          })
          recordDiagnostic('popup:render', { requestId, fields: fields.length, title: String(attributes.CNAME ?? attributes.SNAME ?? layer.title) })
        } catch (error) {
          recordDiagnostic('query:error', { requestId, durationMs: Math.round(performance.now() - queryStartedAt), message: error instanceof Error ? error.message : String(error) })
          console.warn('[BIO PTO map] CNDDB feature query failed.', error)
        }
      })()
    }

    const onDiagnosticPointer = (event: PointerEvent) => {
      const target = event.target as Element | null
      recordDiagnostic(`dom:${event.type}`, {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        buttons: event.buttons,
        target: target?.tagName,
        pointerCapture: target instanceof Element ? target.hasPointerCapture(event.pointerId) : false,
      })
    }
    const onPointerReleaseSafety = (event: PointerEvent) => {
      const pointerId = event.pointerId
      const target = event.target as Element | null
      const type = event.type
      window.setTimeout(() => {
        clearStuckPointerCursor(`window-${type}`)
        // OBSERVE ONLY — do not force-release pointer capture. The smooth reference
        // (map-click-debug.html) never touches capture; calling releasePointerCapture()
        // fires `lostpointercapture`, which ArcGIS's InputManager reads as an aborted
        // gesture and can desync its pan/drag pipeline (pan dies, click still works).
        recordDiagnostic('pointer-capture:observed', {
          pointerId,
          stillCaptured: Boolean(target?.hasPointerCapture(pointerId)),
          interacting: view.interacting,
        })
      }, 0)
    }
    const onDiagnosticError = (event: ErrorEvent) => recordDiagnostic('window:error', { message: event.message })
    const onDiagnosticRejection = (event: PromiseRejectionEvent) => recordDiagnostic('window:unhandledrejection', { reason: String(event.reason) })
    const onWindowBlur = () => clearStuckPointerCursor('window-blur')
    // Mirror map-click-debug.html: let ArcGIS's own pointer-up / drag-end tell us when an
    // interaction should be over, then release the leftover grab cursor on the next tick.
    const viewPointerUpHandle = view.on('pointer-up', () => {
      window.setTimeout(() => clearStuckPointerCursor('view:pointer-up'), 0)
    })
    const viewDragHandle = view.on('drag', (event) => {
      if (event.action === 'end') window.setTimeout(() => clearStuckPointerCursor('view:drag-end'), 0)
    })
    const viewClickHandle = view.on('click', onViewClick)
    const interactionDiagnosticHandle = view.watch('interacting', (value) => recordDiagnostic('view:interacting', { value }))
    const stationaryDiagnosticHandle = view.watch('stationary', (value) => recordDiagnostic('view:stationary', { value }))
    const fatalDiagnosticHandle = view.watch('fatalError', (value) => {
      if (value) recordDiagnostic('view:fatal-error', { message: String(value) })
    })
    const heartbeat = window.setInterval(() => recordDiagnostic('heartbeat', {
      interacting: view.interacting,
      stationary: view.stationary,
      updating: view.updating,
      ready: view.ready,
    }), 2000)
    let longTaskObserver: PerformanceObserver | null = null
    if (typeof PerformanceObserver !== 'undefined' && PerformanceObserver.supportedEntryTypes.includes('longtask')) {
      longTaskObserver = new PerformanceObserver((list) => {
        list.getEntries().forEach((entry) => recordDiagnostic('browser:long-task', { durationMs: Math.round(entry.duration) }))
      })
      longTaskObserver.observe({ entryTypes: ['longtask'] })
    }

    containerRef.current.addEventListener('pointerdown', onDiagnosticPointer, { capture: true, passive: true })
    containerRef.current.addEventListener('pointerup', onDiagnosticPointer, { capture: true, passive: true })
    containerRef.current.addEventListener('pointercancel', onDiagnosticPointer, { capture: true, passive: true })
    window.addEventListener('error', onDiagnosticError)
    window.addEventListener('unhandledrejection', onDiagnosticRejection)
    window.addEventListener('pointerup', onPointerReleaseSafety, { passive: true })
    window.addEventListener('pointercancel', onPointerReleaseSafety, { passive: true })
    window.addEventListener('blur', onWindowBlur)

    const notifyInputChange = () => {
      onProjectSketchChange?.(summarizeSketch(sketchLayer) ?? featureLayerSummary ?? emptySummary())
    }

    let sketch: Sketch | null = null
    let measurement: Measurement | null = null
    let layerList: LayerList | null = null

    if (reviewMode) {
      sketchRef.current.replaceChildren()
    } else {
      const sketchContainer = document.createElement('div')
      sketchRef.current.replaceChildren(sketchContainer)

      sketch = new Sketch({
        view,
        layer: sketchLayer,
        container: sketchContainer,
        creationMode: 'update',
        visibleElements: {
          createTools: {
            point: true,
            polyline: true,
            polygon: true,
            rectangle: true,
            circle: false,
          },
          selectionTools: {
            'lasso-selection': false,
            'rectangle-selection': true,
          },
          settingsMenu: false,
          undoRedoMenu: true,
        },
        defaultCreateOptions: {
          hasZ: false,
        },
        defaultUpdateOptions: {
          toggleToolOnClick: false,
        },
      })

    }

    const measureContainer = document.createElement('div')
    measureRef.current.replaceChildren(measureContainer)
    measurement = new Measurement({
      view,
      container: measureContainer,
      activeTool: activeMapToolRef.current === 'measure' ? 'distance' : null,
    })

    const layerListContainer = document.createElement('div')
    layerListRef.current.replaceChildren(layerListContainer)
    layerList = new LayerList({
      view,
      container: layerListContainer,
      listItemCreatedFunction: (event) => {
        const layer = event.item.layer as FeatureLayer | undefined
        const addedLayer = mapAddedLayers.find((candidate) => `map-added-${candidate.id}` === layer?.id)
        const appLayerId = addedLayer?.id
          ?? (layer?.id === 'project-input-service' ? 'project-input-service' : null)
          ?? (layer?.id === 'pto-buffer-output' ? 'pto-buffer-output' : null)
          ?? (layer?.id === 'pto-cnddb-output' ? 'pto-cnddb-output' : null)
        if (!appLayerId) return
        event.item.actionsSections = [[{
          type: 'button',
          title: 'Zoom to',
          className: 'esri-icon-zoom-in-magnifying-glass',
          id: `zoom-${appLayerId}`,
        }, {
          type: 'button',
          title: 'Remove layer',
          className: 'esri-icon-trash',
          id: `remove-${appLayerId}`,
        }]]
      },
    })

    const zoomToFeatureLayer = async (layer: FeatureLayer, expand = 1.2) => {
      await layer.load()
      const extentResult = await layer.queryExtent()
      const targetExtent = extentResult.extent ?? layer.fullExtent
      if (targetExtent) {
        await view.goTo(targetExtent.expand(expand), { duration: 650 })
      }
    }

    layerList?.on('trigger-action', async (event) => {
      const actionId = String(event.action.id)
      if (actionId.startsWith('zoom-')) {
        const layer = event.item.layer as FeatureLayer | undefined
        if (!layer) return
        try {
          await zoomToFeatureLayer(layer)
        } catch {
          // Keep the layer available even if a service does not allow extent queries.
        }
        return
      }
      const match = String(event.action.id).match(/^remove-(.+)$/)
      if (match?.[1] === 'project-input-service') {
        onRemoveProjectLayer?.()
        return
      }
      if (match?.[1] === 'pto-buffer-output') {
        onRemoveBufferLayer?.()
        return
      }
      if (match?.[1] === 'pto-cnddb-output') {
        onRemoveCnddbLayer?.()
        return
      }
      if (match) onRemoveMapLayer?.(match[1])
    })

    const escapeSqlLiteral = (value: string) => value.replaceAll("'", "''")
    const buildSpeciesInExpression = (names: string[]) => {
      const unique = [...new Set(names.map((name) => name.trim()).filter(Boolean))]
      if (unique.length === 0) return '1=0'
      return `CNAME IN (${unique.map((name) => `'${escapeSqlLiteral(name)}'`).join(', ')})`
    }
    // Color the CNDDB layer by PTO rating (joined by CNAME). Kept separate from the
    // filter logic so rating edits restyle the map without touching definitionExpression.
    const applyRatingRenderer = () => {
      if (!cnddbOutputLayer) return
      const ratings = speciesRatingsRef.current
      cnddbOutputLayer.renderer = ratings.length > 0 ? cnddbRatingRenderer(ratings) : cnddbDefaultRenderer()
    }
    applyRatingRendererRef.current = applyRatingRenderer

    // Single source of truth for what the CNDDB map shows, driven by the All_Stats table:
    //  - a specific species selected  -> filter the map to just it (in its rating color)
    //  - table filters active         -> show only the filtered species (CNAME IN (...))
    //  - nothing active               -> show every feature
    // Feature colors always come from the rating renderer, so hue = rating everywhere.
    // A specific species just filters (no blanket highlight — everything shown is already
    // that species). Clicking one feature still highlights that single occurrence.
    const applyMapFilter = () => {
      if (!cnddbOutputLayer) return
      const selected = selectedSpeciesRef.current
      const visible = visibleSpeciesNamesRef.current

      if (selected) {
        cnddbOutputLayer.definitionExpression = `CNAME = '${escapeSqlLiteral(selected)}'`
        cnddbOutputLayer.visible = true
        if (selectedCnddbOutputLayer) {
          selectedCnddbOutputLayer.visible = false
          selectedCnddbOutputLayer.definitionExpression = '1=0'
        }
        recordDiagnostic('map:filter', { mode: 'selected', selected })
        return
      }

      cnddbOutputLayer.definitionExpression = visible ? buildSpeciesInExpression(visible) : '1=1'
      cnddbOutputLayer.visible = true
      if (selectedCnddbOutputLayer) {
        selectedCnddbOutputLayer.visible = false
        selectedCnddbOutputLayer.definitionExpression = '1=0'
      }
      recordDiagnostic('map:filter', { mode: visible ? 'filtered' : 'all', visibleCount: visible?.length ?? null })
    }
    applyMapFilterRef.current = applyMapFilter

    const loadProjectFeatureLayer = async (url: string) => {
      loadedProjectUrl = url

      if (projectFeatureLayer) {
        map.remove(projectFeatureLayer)
        projectFeatureLayer.destroy()
        projectFeatureLayer = null
        featureLayerSummary = null
      }

      if (!url) {
        projectLayer.removeAll()
        notifyInputChange()
        return
      }

      projectLayer.removeAll()

      const layer = new FeatureLayer({
        id: 'project-input-service',
        url,
        title: 'Project feature service input',
        outFields: ['*'],
        opacity: 0.82,
      })

      projectFeatureLayer = layer
      map.add(layer, 2)

      try {
        await layer.load()
        const featureCount = await layer.queryFeatureCount()
        const geometryType = layer.geometryType ?? 'unknown'

        featureLayerSummary = {
          source: 'FeatureLayer',
          featureCount,
          geometryType,
          isReadyForAnalysis: featureCount > 0 && ['point', 'polyline', 'polygon'].includes(geometryType),
          warning: featureCount > 0 ? undefined : 'The loaded feature layer has no features.',
          projectInput: { url },
        }

        notifyInputChange()

        if (!reviewMode || !cnddbOutputLayer) {
          const extentResult = await layer.queryExtent()
          if (extentResult.extent) {
            await view.goTo(extentResult.extent.expand(1.35), { duration: 700 })
          }
        }
      } catch (error) {
        featureLayerSummary = {
          source: 'FeatureLayer',
          featureCount: 0,
          geometryType: 'Unknown',
          isReadyForAnalysis: false,
          warning: error instanceof Error ? error.message : 'Could not load the feature service layer.',
        }
        notifyInputChange()
      }
    }

    if (sketch) {
      sketch.on('create', (event) => {
        if (event.state === 'complete') notifyInputChange()
      })
      sketch.on('update', (event) => {
        if (event.state === 'complete') notifyInputChange()
      })
      sketch.on('delete', notifyInputChange)
    }

    view.when(() => {
      logDebugEvent(`view ready; reviewMode=${reviewMode}; popupEnabled=${view.popupEnabled}`)
      view.ui.move('zoom', 'bottom-left')
      bringReviewLayersToFront()
      if (cnddbOutputLayer) {
        void (async () => {
          try {
            await cnddbOutputLayer.load()
            cnddbOutputLayer.popupTemplate = cnddbOutputLayer.createPopupTemplate()
            if (selectedCnddbOutputLayer) {
              await selectedCnddbOutputLayer.load()
              selectedCnddbOutputLayer.popupTemplate = selectedCnddbOutputLayer.createPopupTemplate()
            }
            bringReviewLayersToFront()
            if (!zoomedToCnddbOutput) {
              zoomedToCnddbOutput = true
              await zoomToFeatureLayer(cnddbOutputLayer)
            }
            applyRatingRenderer()
            applyMapFilter()
          } catch {
            // Keep the map usable if the CNDDB service is slow or temporarily unavailable.
          }
        })()
      }
      void loadProjectFeatureLayer(projectUrlRef.current)
      applyMapFilter()
    })

    const interval = window.setInterval(() => {
      const nextUrl = projectUrlRef.current
      if (loadedProjectUrl !== nextUrl) {
        void loadProjectFeatureLayer(nextUrl)
      }

      if (measurement) {
        const desiredMeasurementTool = activeMapToolRef.current === 'measure' ? 'distance' : null
        if (measurement.activeTool !== desiredMeasurementTool) {
          measurement.activeTool = desiredMeasurementTool
        }
      }
    }, 600)

    return () => {
      window.clearInterval(interval)
      window.clearInterval(heartbeat)
      popupQueryId += 1
      applyMapFilterRef.current = null
      applyRatingRendererRef.current = null
      containerRef.current?.removeEventListener('pointerdown', onDiagnosticPointer, true)
      containerRef.current?.removeEventListener('pointerup', onDiagnosticPointer, true)
      containerRef.current?.removeEventListener('pointercancel', onDiagnosticPointer, true)
      window.removeEventListener('error', onDiagnosticError)
      window.removeEventListener('unhandledrejection', onDiagnosticRejection)
      window.removeEventListener('pointerup', onPointerReleaseSafety)
      window.removeEventListener('pointercancel', onPointerReleaseSafety)
      window.removeEventListener('blur', onWindowBlur)
      viewPointerUpHandle.remove()
      viewDragHandle.remove()
      viewClickHandle.remove()
      interactionDiagnosticHandle.remove()
      stationaryDiagnosticHandle.remove()
      fatalDiagnosticHandle.remove()
      longTaskObserver?.disconnect()
      recordDiagnostic('recorder:stopped')
      diagnosticNode.remove()
      layerOrderHandle.remove()
      layerList?.destroy()
      sketch?.destroy()
      measurement?.destroy()
      projectFeatureLayer?.destroy()
      userAddedFeatureLayers.forEach((layer) => layer.destroy())
      featureHighlightRef.current?.remove()
      featureHighlightRef.current = null
      bufferOutputLayer?.destroy()
      cnddbOutputLayer?.destroy()
      selectedCnddbOutputLayer?.destroy()
      view.destroy()
    }
  }, [bufferLayerUrl, cnddbLayerUrl, mapAddedLayers, onProjectSketchChange, onRemoveBufferLayer, onRemoveCnddbLayer, onRemoveMapLayer, onRemoveProjectLayer, reviewMode, webMapId])

  return (
    <div className="arcgis-map-shell">
      <div className="arcgis-map" ref={containerRef} />
      <div className={`map-widget-panel layer-widget-panel ${activeMapTool === 'layers' ? 'open' : ''}`} ref={layerListRef} />
      <div className={`map-widget-panel measure-widget-panel ${activeMapTool === 'measure' ? 'open' : ''}`} ref={measureRef} />
      <div className={`map-widget-panel sketch-widget-panel ${!reviewMode && activeMapTool === 'sketch' ? 'open' : ''}`} ref={sketchRef} />
      {featurePopup && (
        <section className="map-feature-popup" aria-label="Map feature details">
          <header>
            <div><strong>{featurePopup.title}</strong><span>{featurePopup.layerTitle}</span></div>
            <button type="button" aria-label="Close feature details" onClick={() => { featureHighlightRef.current?.remove(); featureHighlightRef.current = null; setFeaturePopup(null) }}>×</button>
          </header>
          <dl>
            {featurePopup.fields.map((field, index) => (
              <div key={`${field.label}-${index}`}><dt>{field.label}</dt><dd>{field.value}</dd></div>
            ))}
          </dl>
        </section>
      )}
      {debugEnabled && (
        <div className="map-debug-panel" aria-label="Map debug log">
          <strong>Map debug</strong>
          {debugEvents.length === 0
            ? <span>Waiting for map events...</span>
            : debugEvents.map((event) => <span key={event}>{event}</span>)}
        </div>
      )}
    </div>
  )
}


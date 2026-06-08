import { useEffect, useRef } from 'react'
import Map from '@arcgis/core/Map'
import WebMap from '@arcgis/core/WebMap'
import MapView from '@arcgis/core/views/MapView'
import type FeatureLayerView from '@arcgis/core/views/layers/FeatureLayerView'
import GraphicsLayer from '@arcgis/core/layers/GraphicsLayer'
import FeatureLayer from '@arcgis/core/layers/FeatureLayer'
import Sketch from '@arcgis/core/widgets/Sketch'
import LayerList from '@arcgis/core/widgets/LayerList'
import Measurement from '@arcgis/core/widgets/Measurement'
import SimpleFillSymbol from '@arcgis/core/symbols/SimpleFillSymbol'
import SimpleLineSymbol from '@arcgis/core/symbols/SimpleLineSymbol'
import SimpleMarkerSymbol from '@arcgis/core/symbols/SimpleMarkerSymbol'
import '@arcgis/core/assets/esri/themes/light/main.css'
import { getArcGISToken } from './arcgisAuth'
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
  reviewMode?: boolean
  onProjectSketchChange?: (summary: ProjectSketchSummary) => void
  onRemoveMapLayer?: (id: string) => void
  onRemoveProjectLayer?: () => void
  onRemoveBufferLayer?: () => void
  onRemoveCnddbLayer?: () => void
  onSelectSpeciesFromMap?: (commonName: string) => void
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

function cnddbDefaultRenderer() {
  return {
    type: 'simple' as const,
    symbol: {
      type: 'simple-fill' as const,
      color: [255, 182, 203, 0.32],
      outline: { color: [190, 82, 118, 0], width: 0 },
    },
  }
}

function cnddbSelectedRenderer() {
  return {
    type: 'simple' as const,
    symbol: {
      type: 'simple-fill' as const,
      color: [222, 38, 38, 0.42],
      outline: { color: [118, 16, 16, 1], width: 3 },
    },
  }
}

export function ArcGISMap({ activeMapTool = null, webMapId, projectLayerUrl, bufferLayerUrl, cnddbLayerUrl, mapAddedLayers = [], selectedSpeciesName, reviewMode = false, onProjectSketchChange, onRemoveMapLayer, onRemoveProjectLayer, onRemoveBufferLayer, onRemoveCnddbLayer, onSelectSpeciesFromMap }: ArcGISMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const layerListRef = useRef<HTMLDivElement | null>(null)
  const measureRef = useRef<HTMLDivElement | null>(null)
  const sketchRef = useRef<HTMLDivElement | null>(null)
  const projectUrlRef = useRef(projectLayerUrl?.trim() ?? '')
  const selectedSpeciesRef = useRef(selectedSpeciesName?.trim() ?? '')
  const activeMapToolRef = useRef(activeMapTool)
  const onSelectSpeciesFromMapRef = useRef(onSelectSpeciesFromMap)
  const applySelectedSpeciesRef = useRef<((commonName: string) => void) | null>(null)

  useEffect(() => {
    projectUrlRef.current = projectLayerUrl?.trim() ?? ''
  }, [projectLayerUrl])

  useEffect(() => {
    const nextSpeciesName = selectedSpeciesName?.trim() ?? ''
    selectedSpeciesRef.current = nextSpeciesName
    applySelectedSpeciesRef.current?.(nextSpeciesName)
  }, [selectedSpeciesName])

  useEffect(() => {
    activeMapToolRef.current = activeMapTool
  }, [activeMapTool])

  useEffect(() => {
    onSelectSpeciesFromMapRef.current = onSelectSpeciesFromMap
  }, [onSelectSpeciesFromMap])

  useEffect(() => {
    if (!containerRef.current || !layerListRef.current || !measureRef.current || !sketchRef.current) return

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
        popupEnabled: true,
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
        outFields: ['CNAME'],
        opacity: 0.64,
        popupEnabled: false,
        renderer: cnddbDefaultRenderer(),
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

    const applyArcGISTokenToLayer = async (layer: FeatureLayer | null) => {
      if (!layer) return
      try {
        const token = await getArcGISToken()
        layer.customParameters = { ...(layer.customParameters ?? {}), token }
        layer.refresh()
      } catch {
        // Public services do not need a token, and signed-out setup should keep working.
      }
    }

    const map = webMapId?.trim()
      ? new WebMap({ portalItem: { id: webMapId.trim() } })
      : new Map({ basemap: 'topo-vector' })
    map.addMany([projectLayer, resultLayer, ...userAddedFeatureLayers, ...[bufferOutputLayer, cnddbOutputLayer].filter((layer): layer is FeatureLayer => Boolean(layer)), sketchLayer])
    void Promise.all([bufferOutputLayer, cnddbOutputLayer, ...userAddedFeatureLayers].map(applyArcGISTokenToLayer))

    const bringReviewLayersToFront = () => {
      if (bufferOutputLayer && map.layers.includes(bufferOutputLayer)) {
        map.reorder(bufferOutputLayer, map.layers.length - 1)
      }
      if (cnddbOutputLayer && map.layers.includes(cnddbOutputLayer)) {
        map.reorder(cnddbOutputLayer, map.layers.length - 1)
      }
      if (sketchLayer && map.layers.includes(sketchLayer)) {
        map.reorder(sketchLayer, map.layers.length - 1)
      }
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
      popup: {
        dockEnabled: true,
        dockOptions: {
          buttonEnabled: false,
          breakpoint: false,
          position: 'bottom-right',
        },
      },
    })

    let featureLayerSummary: ProjectSketchSummary | null = null
    let projectFeatureLayer: FeatureLayer | null = null
    let cnddbLayerView: FeatureLayerView | null = null
    let loadedProjectUrl = ''
    let selectedSpeciesRequestId = 0
    let mapClickSelectionInFlight = false

    const notifyInputChange = () => {
      onProjectSketchChange?.(summarizeSketch(sketchLayer) ?? featureLayerSummary ?? emptySummary())
    }

    const sketchContainer = document.createElement('div')
    sketchRef.current.replaceChildren(sketchContainer)
    const measureContainer = document.createElement('div')
    measureRef.current.replaceChildren(measureContainer)

    const sketch = new Sketch({
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
      polygonSymbol: new SimpleFillSymbol({
        color: [19, 59, 92, 0.18],
        outline: { color: '#133b5c', width: 2 },
      }),
      polylineSymbol: new SimpleLineSymbol({
        color: '#133b5c',
        width: 4,
      }),
      pointSymbol: new SimpleMarkerSymbol({
        style: 'circle',
        color: '#133b5c',
        size: 10,
        outline: { color: '#ffffff', width: 1.5 },
      }),
    })

    const measurement = new Measurement({
      view,
      container: measureContainer,
      activeTool: activeMapToolRef.current === 'measure' ? 'distance' : null,
    })

    const layerListContainer = document.createElement('div')
    layerListRef.current.replaceChildren(layerListContainer)

    const layerList = new LayerList({
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

    layerList.on('trigger-action', async (event) => {
      const actionId = String(event.action.id)
      if (actionId.startsWith('zoom-')) {
        const layer = event.item.layer as FeatureLayer | undefined
        if (!layer) return
        try {
          await layer.load()
          const extentResult = await layer.queryExtent()
          const targetExtent = extentResult.extent ?? layer.fullExtent
          if (targetExtent) {
            await view.goTo(targetExtent.expand(1.2), { duration: 650 })
          }
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
    const applySelectedSpecies = (commonName: string) => {
      const requestId = ++selectedSpeciesRequestId
      if (!cnddbOutputLayer) return

      const selectedWhere = commonName ? `CNAME = '${escapeSqlLiteral(commonName)}'` : '1=1'
      cnddbOutputLayer.definitionExpression = '1=1'
      cnddbOutputLayer.renderer = commonName ? cnddbSelectedRenderer() : cnddbDefaultRenderer()
      if (cnddbLayerView) {
        cnddbLayerView.filter = commonName ? { where: selectedWhere } : null
        return
      }

      void view.whenLayerView(cnddbOutputLayer).then((layerView) => {
        cnddbLayerView = layerView
        if (requestId === selectedSpeciesRequestId) {
          cnddbLayerView.filter = commonName ? { where: selectedWhere } : null
        }
      }).catch(() => {
        // Keep table selection working if the CNDDB layer view is not available yet.
      })
    }
    applySelectedSpeciesRef.current = applySelectedSpecies

    const mapClickHandle = view.on('click', async (event) => {
      if (!cnddbOutputLayer || !reviewMode) return
      if (!view.stationary || mapClickSelectionInFlight || cnddbLayerView?.updating) return
      mapClickSelectionInFlight = true
      try {
        const query = cnddbOutputLayer.createQuery()
        const activeSpeciesName = selectedSpeciesRef.current
        query.geometry = event.mapPoint
        query.spatialRelationship = 'intersects'
        query.where = activeSpeciesName ? `CNAME = '${escapeSqlLiteral(activeSpeciesName)}'` : '1=1'
        query.outFields = ['CNAME']
        query.returnGeometry = false
        query.num = 1
        const response = await cnddbOutputLayer.queryFeatures(query)
        const commonName = String(response.features[0]?.attributes?.CNAME ?? '').trim()
        if (commonName && commonName !== selectedSpeciesRef.current) {
          onSelectSpeciesFromMapRef.current?.(commonName)
        }
      } catch {
        // Map selection should never interrupt normal pan/zoom/popup interaction.
      } finally {
        mapClickSelectionInFlight = false
      }
    })

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
      await applyArcGISTokenToLayer(layer)

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

        const extentResult = await layer.queryExtent()
        if (extentResult.extent) {
          await view.goTo(extentResult.extent.expand(1.35), { duration: 700 })
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

    sketch.on('create', (event) => {
      if (event.state === 'complete') notifyInputChange()
    })
    sketch.on('update', (event) => {
      if (event.state === 'complete') notifyInputChange()
    })
    sketch.on('delete', notifyInputChange)

    view.when(() => {
      view.ui.move('zoom', 'bottom-left')
      bringReviewLayersToFront()
      if (cnddbOutputLayer) {
        void (async () => {
          try {
            await applyArcGISTokenToLayer(cnddbOutputLayer)
            cnddbLayerView = await view.whenLayerView(cnddbOutputLayer)
            bringReviewLayersToFront()
            applySelectedSpecies(selectedSpeciesRef.current)
          } catch {
            // Keep the map usable if the CNDDB service is slow or temporarily unavailable.
          }
        })()
      }
      void loadProjectFeatureLayer(projectUrlRef.current)
      applySelectedSpecies(selectedSpeciesRef.current)
    })

    const interval = window.setInterval(() => {
      const nextUrl = projectUrlRef.current
      if (loadedProjectUrl !== nextUrl) {
        void loadProjectFeatureLayer(nextUrl)
      }

      const desiredMeasurementTool = activeMapToolRef.current === 'measure' ? 'distance' : null
      if (measurement.activeTool !== desiredMeasurementTool) {
        measurement.activeTool = desiredMeasurementTool
      }
    }, 600)

    return () => {
      window.clearInterval(interval)
      applySelectedSpeciesRef.current = null
      layerOrderHandle.remove()
      mapClickHandle.remove()
      layerList.destroy()
      sketch.destroy()
      measurement.destroy()
      projectFeatureLayer?.destroy()
      userAddedFeatureLayers.forEach((layer) => layer.destroy())
      bufferOutputLayer?.destroy()
      cnddbOutputLayer?.destroy()
      view.destroy()
    }
  }, [bufferLayerUrl, cnddbLayerUrl, mapAddedLayers, onProjectSketchChange, onRemoveBufferLayer, onRemoveCnddbLayer, onRemoveMapLayer, onRemoveProjectLayer, reviewMode, webMapId])

  return (
    <div className="arcgis-map-shell">
      <div className="arcgis-map" ref={containerRef} />
      <div className={`map-widget-panel layer-widget-panel ${activeMapTool === 'layers' ? 'open' : ''}`} ref={layerListRef} />
      <div className={`map-widget-panel measure-widget-panel ${activeMapTool === 'measure' ? 'open' : ''}`} ref={measureRef} />
      <div className={`map-widget-panel sketch-widget-panel ${!reviewMode && activeMapTool === 'sketch' ? 'open' : ''}`} ref={sketchRef} />
    </div>
  )
}


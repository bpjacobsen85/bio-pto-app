import { useEffect, useRef } from 'react'
import Map from '@arcgis/core/Map'
import WebMap from '@arcgis/core/WebMap'
import MapView from '@arcgis/core/views/MapView'
import GraphicsLayer from '@arcgis/core/layers/GraphicsLayer'
import FeatureLayer from '@arcgis/core/layers/FeatureLayer'
import Sketch from '@arcgis/core/widgets/Sketch'
import LayerList from '@arcgis/core/widgets/LayerList'
import SimpleFillSymbol from '@arcgis/core/symbols/SimpleFillSymbol'
import SimpleLineSymbol from '@arcgis/core/symbols/SimpleLineSymbol'
import SimpleMarkerSymbol from '@arcgis/core/symbols/SimpleMarkerSymbol'
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

export type ProjectSketchSummary = {
  source: 'Sketch' | 'FeatureLayer' | 'Demo'
  featureCount: number
  geometryType: string
  isReadyForAnalysis: boolean
  warning?: string
  projectInput?: ProjectInputFeatureSet | ProjectLayerInput
}

type ArcGISMapProps = {
  activeMapTool?: 'layers' | 'sketch' | null
  webMapId?: string
  projectLayerUrl?: string
  bufferLayerUrl?: string
  cnddbLayerUrl?: string
  selectedSpeciesName?: string
  reviewMode?: boolean
  onProjectSketchChange?: (summary: ProjectSketchSummary) => void
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

export function ArcGISMap({ activeMapTool = null, webMapId, projectLayerUrl, bufferLayerUrl, cnddbLayerUrl, selectedSpeciesName, reviewMode = false, onProjectSketchChange }: ArcGISMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const layerListRef = useRef<HTMLDivElement | null>(null)
  const sketchRef = useRef<HTMLDivElement | null>(null)
  const projectUrlRef = useRef(projectLayerUrl?.trim() ?? '')
  const selectedSpeciesRef = useRef(selectedSpeciesName?.trim() ?? '')

  useEffect(() => {
    projectUrlRef.current = projectLayerUrl?.trim() ?? ''
  }, [projectLayerUrl])

  useEffect(() => {
    selectedSpeciesRef.current = selectedSpeciesName?.trim() ?? ''
  }, [selectedSpeciesName])

  useEffect(() => {
    if (!containerRef.current || !layerListRef.current || !sketchRef.current) return

    const projectLayer = new GraphicsLayer({ title: 'Project input', listMode: 'hide' })
    const resultLayer = new GraphicsLayer({ title: 'PTO results', listMode: 'hide' })
    const sketchLayer = new GraphicsLayer({ title: 'Project sketch input', listMode: 'hide' })
    const bufferOutputLayer = bufferLayerUrl?.trim()
      ? new FeatureLayer({
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
        url: cnddbLayerUrl.trim(),
        title: 'CNDDB output results',
        outFields: ['*'],
        opacity: 0.72,
        popupEnabled: true,
        popupTemplate: {
          title: '{CNAME}',
          content: [
            {
              type: 'fields',
              fieldInfos: [
                { fieldName: 'CNAME', label: 'Common name' },
                { fieldName: 'SNAME', label: 'Scientific name' },
                { fieldName: 'ELMCODE', label: 'Element code' },
                { fieldName: 'PTO_Review', label: 'PTO review' },
                { fieldName: 'Distance', label: 'Distance' },
                { fieldName: 'MIN_buff', label: 'Nearest distance (mi)' },
                { fieldName: 'ACCURACY', label: 'Accuracy' },
                { fieldName: 'OCCNUMBER', label: 'Occurrence number' },
                { fieldName: 'EOINDEX', label: 'EO index' },
                { fieldName: 'LASTOBS', label: 'Last observed' },
                { fieldName: 'PRESENCE', label: 'Presence' },
              ],
            },
          ],
        },
      })
      : null

    const map = webMapId?.trim()
      ? new WebMap({ portalItem: { id: webMapId.trim() } })
      : new Map({ basemap: 'topo-vector' })
    map.addMany([projectLayer, resultLayer, ...[bufferOutputLayer, cnddbOutputLayer].filter((layer): layer is FeatureLayer => Boolean(layer)), sketchLayer])

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
    let loadedProjectUrl = ''
    let loadedSpeciesName = ''

    const notifyInputChange = () => {
      onProjectSketchChange?.(summarizeSketch(sketchLayer) ?? featureLayerSummary ?? emptySummary())
    }

    const sketchContainer = document.createElement('div')
    sketchRef.current.replaceChildren(sketchContainer)

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

    const layerListContainer = document.createElement('div')
    layerListRef.current.replaceChildren(layerListContainer)

    const layerList = new LayerList({ view, container: layerListContainer })

    const escapeSqlLiteral = (value: string) => value.replaceAll("'", "''")

    const applySelectedSpecies = async (commonName: string) => {
      loadedSpeciesName = commonName
      if (!cnddbOutputLayer) return

      cnddbOutputLayer.definitionExpression = commonName ? `CNAME = '${escapeSqlLiteral(commonName)}'` : '1=1'

      if (!commonName) return

      try {
        const extentResult = await cnddbOutputLayer.queryExtent()
        if (extentResult.extent) {
          await view.goTo(extentResult.extent.expand(1.5), { duration: 650 })
        }
      } catch {
        // Some output layers may not expose matching CNAME values; keep the table selection working either way.
      }
    }

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
      if (cnddbOutputLayer) {
        void cnddbOutputLayer.when(() => {
          const targetExtent = bufferOutputLayer?.fullExtent ?? cnddbOutputLayer.fullExtent
          if (targetExtent) {
            void view.goTo(targetExtent.expand(1.2), { duration: 700 })
          }
        })
      }
      void loadProjectFeatureLayer(projectUrlRef.current)
      void applySelectedSpecies(selectedSpeciesRef.current)
    })

    const interval = window.setInterval(() => {
      const nextUrl = projectUrlRef.current
      if (loadedProjectUrl !== nextUrl) {
        void loadProjectFeatureLayer(nextUrl)
      }

      const nextSpeciesName = selectedSpeciesRef.current
      if (loadedSpeciesName !== nextSpeciesName) {
        void applySelectedSpecies(nextSpeciesName)
      }
    }, 600)

    return () => {
      window.clearInterval(interval)
      layerList.destroy()
      sketch.destroy()
      projectFeatureLayer?.destroy()
      bufferOutputLayer?.destroy()
      cnddbOutputLayer?.destroy()
      view.destroy()
    }
  }, [bufferLayerUrl, cnddbLayerUrl, onProjectSketchChange, reviewMode, webMapId])

  return (
    <div className="arcgis-map-shell">
      <div className="arcgis-map" ref={containerRef} />
      <div className={`map-widget-panel layer-widget-panel ${activeMapTool === 'layers' ? 'open' : ''}`} ref={layerListRef} />
      <div className={`map-widget-panel sketch-widget-panel ${!reviewMode && activeMapTool === 'sketch' ? 'open' : ''}`} ref={sketchRef} />
    </div>
  )
}


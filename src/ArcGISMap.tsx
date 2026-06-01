import { useEffect, useRef } from 'react'
import Map from '@arcgis/core/Map'
import MapView from '@arcgis/core/views/MapView'
import GraphicsLayer from '@arcgis/core/layers/GraphicsLayer'
import FeatureLayer from '@arcgis/core/layers/FeatureLayer'
import Graphic from '@arcgis/core/Graphic'
import Point from '@arcgis/core/geometry/Point'
import Polyline from '@arcgis/core/geometry/Polyline'
import Polygon from '@arcgis/core/geometry/Polygon'
import Sketch from '@arcgis/core/widgets/Sketch'
import LayerList from '@arcgis/core/widgets/LayerList'
import SearchWidget from '@arcgis/core/widgets/Search'
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
  activeMapTool?: 'layers' | 'search' | null
  projectLayerUrl?: string
  cnddbLayerUrl?: string
  selectedSpeciesName?: string
  onProjectSketchChange?: (summary: ProjectSketchSummary) => void
}

function makeOccurrence(x: number, y: number, color: string, label: string) {
  return new Graphic({
    geometry: new Point({ longitude: x, latitude: y }),
    attributes: { label },
    symbol: new SimpleMarkerSymbol({
      style: 'circle',
      size: 11,
      color,
      outline: { color: '#ffffff', width: 1.5 },
    }),
    popupTemplate: {
      title: label,
      content: 'Demo PTO occurrence symbol. Real results will load from ArcGIS Online output layers.',
    },
  })
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

export function ArcGISMap({ activeMapTool = null, projectLayerUrl, cnddbLayerUrl, selectedSpeciesName, onProjectSketchChange }: ArcGISMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const layerListRef = useRef<HTMLDivElement | null>(null)
  const searchRef = useRef<HTMLDivElement | null>(null)
  const projectUrlRef = useRef(projectLayerUrl?.trim() ?? '')
  const selectedSpeciesRef = useRef(selectedSpeciesName?.trim() ?? '')

  useEffect(() => {
    projectUrlRef.current = projectLayerUrl?.trim() ?? ''
  }, [projectLayerUrl])

  useEffect(() => {
    selectedSpeciesRef.current = selectedSpeciesName?.trim() ?? ''
  }, [selectedSpeciesName])

  useEffect(() => {
    if (!containerRef.current || !layerListRef.current || !searchRef.current) return

    const projectLayer = new GraphicsLayer({ title: 'Demo project corridor' })
    const resultLayer = new GraphicsLayer({ title: 'Demo PTO results' })
    const sketchLayer = new GraphicsLayer({ title: 'Project sketch input' })
    const cnddbOutputLayer = cnddbLayerUrl?.trim()
      ? new FeatureLayer({
        url: cnddbLayerUrl.trim(),
        title: 'CNDDB output results',
        outFields: ['*'],
        opacity: 0.72,
      })
      : null

    const map = new Map({
      basemap: 'topo-vector',
      layers: cnddbOutputLayer ? [projectLayer, resultLayer, cnddbOutputLayer, sketchLayer] : [projectLayer, resultLayer, sketchLayer],
    })

    const view = new MapView({
      container: containerRef.current,
      map,
      center: [-121.58, 38.42],
      zoom: 10,
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

    const buffer = new Graphic({
      geometry: new Polygon({
        rings: [[
          [-121.88, 38.58],
          [-121.74, 38.76],
          [-121.42, 38.70],
          [-121.24, 38.48],
          [-121.34, 38.24],
          [-121.68, 38.17],
          [-121.94, 38.34],
          [-121.88, 38.58],
        ]],
        spatialReference: { wkid: 4326 },
      }),
      symbol: new SimpleFillSymbol({
        color: [27, 108, 168, 0.14],
        outline: { color: [27, 108, 168, 0.65], width: 2 },
      }),
      popupTemplate: {
        title: '5 mi buffer',
        content: 'Demo buffer geometry. This will be replaced by the Notebook Web Tool PTO_Buffer output.',
      },
    })

    const corridor = new Graphic({
      geometry: new Polyline({
        paths: [[
          [-121.84, 38.34],
          [-121.68, 38.40],
          [-121.52, 38.43],
          [-121.35, 38.50],
        ]],
        spatialReference: { wkid: 4326 },
      }),
      symbol: new SimpleLineSymbol({
        color: '#133b5c',
        width: 5,
        cap: 'round',
        join: 'round',
      }),
      popupTemplate: {
        title: 'PGE_SM corridor',
        content: 'Demo project feature. Load a project feature layer or sketch a new project input.',
      },
    })

    if (!projectUrlRef.current) {
      projectLayer.addMany([buffer, corridor])
    }
    if (!cnddbOutputLayer) {
      resultLayer.addMany([
        makeOccurrence(-121.61, 38.48, '#d64545', 'High potential'),
        makeOccurrence(-121.53, 38.56, '#d64545', 'High potential'),
        makeOccurrence(-121.42, 38.41, '#e59f2a', 'Moderate potential'),
        makeOccurrence(-121.72, 38.32, '#3b82b6', 'Low potential'),
        makeOccurrence(-121.38, 38.62, '#7c5cc4', 'Needs Review'),
        makeOccurrence(-121.58, 38.23, '#8a94a6', 'No Potential'),
      ])
    }

    let featureLayerSummary: ProjectSketchSummary | null = null
    let projectFeatureLayer: FeatureLayer | null = null
    let loadedProjectUrl = ''
    let loadedSpeciesName = ''

    const notifyInputChange = () => {
      onProjectSketchChange?.(summarizeSketch(sketchLayer) ?? featureLayerSummary ?? emptySummary())
    }

    const sketch = new Sketch({
      view,
      layer: sketchLayer,
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
    const searchContainer = document.createElement('div')
    layerListRef.current.replaceChildren(layerListContainer)
    searchRef.current.replaceChildren(searchContainer)

    const layerList = new LayerList({ view, container: layerListContainer })
    const search = new SearchWidget({ view, container: searchContainer })

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
        projectLayer.addMany([buffer, corridor])
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
      view.ui.add(sketch, 'top-right')
      view.ui.move('zoom', 'bottom-left')
      if (cnddbOutputLayer) {
        void cnddbOutputLayer.when(() => {
          if (cnddbOutputLayer.fullExtent) {
            void view.goTo(cnddbOutputLayer.fullExtent.expand(1.2), { duration: 700 })
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
      search.destroy()
      sketch.destroy()
      projectFeatureLayer?.destroy()
      cnddbOutputLayer?.destroy()
      view.destroy()
    }
  }, [cnddbLayerUrl, onProjectSketchChange])

  return (
    <div className="arcgis-map-shell">
      <div className="arcgis-map" ref={containerRef} />
      <div className={`map-widget-panel layer-widget-panel ${activeMapTool === 'layers' ? 'open' : ''}`} ref={layerListRef} />
      <div className={`map-widget-panel search-widget-panel ${activeMapTool === 'search' ? 'open' : ''}`} ref={searchRef} />
    </div>
  )
}


import { useEffect, useRef } from 'react'
import Map from '@arcgis/core/Map'
import WebMap from '@arcgis/core/WebMap'
import Graphic from '@arcgis/core/Graphic'
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
  activeMapTool?: 'layers' | 'sketch' | null
  webMapId?: string
  projectLayerUrl?: string
  bufferLayerUrl?: string
  cnddbLayerUrl?: string
  mapAddedLayers?: MapAddedLayer[]
  selectedSpeciesName?: string
  reviewMode?: boolean
  onProjectSketchChange?: (summary: ProjectSketchSummary) => void
  onRemoveMapLayer?: (id: string) => void
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

export function ArcGISMap({ activeMapTool = null, webMapId, projectLayerUrl, bufferLayerUrl, cnddbLayerUrl, mapAddedLayers = [], selectedSpeciesName, reviewMode = false, onProjectSketchChange, onRemoveMapLayer, onSelectSpeciesFromMap }: ArcGISMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const layerListRef = useRef<HTMLDivElement | null>(null)
  const sketchRef = useRef<HTMLDivElement | null>(null)
  const projectUrlRef = useRef(projectLayerUrl?.trim() ?? '')
  const selectedSpeciesRef = useRef(selectedSpeciesName?.trim() ?? '')
  const onSelectSpeciesFromMapRef = useRef(onSelectSpeciesFromMap)

  useEffect(() => {
    projectUrlRef.current = projectLayerUrl?.trim() ?? ''
  }, [projectLayerUrl])

  useEffect(() => {
    selectedSpeciesRef.current = selectedSpeciesName?.trim() ?? ''
  }, [selectedSpeciesName])

  useEffect(() => {
    onSelectSpeciesFromMapRef.current = onSelectSpeciesFromMap
  }, [onSelectSpeciesFromMap])

  useEffect(() => {
    if (!containerRef.current || !layerListRef.current || !sketchRef.current) return

    const projectLayer = new GraphicsLayer({ title: 'Project input', listMode: 'hide' })
    const resultLayer = new GraphicsLayer({ title: 'PTO results', listMode: 'hide' })
    const selectedCnddbLayer = new GraphicsLayer({ title: 'Selected CNDDB species', listMode: 'hide' })
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
        renderer: {
          type: 'unique-value',
          field: 'PTO_Review',
          defaultSymbol: {
            type: 'simple-fill',
            color: [126, 144, 162, 0.28],
            outline: { color: [88, 103, 119, 0.9], width: 0.8 },
          },
          uniqueValueInfos: [
            {
              value: 'High',
              label: 'High',
              symbol: { type: 'simple-fill', color: [218, 67, 67, 0.42], outline: { color: [151, 34, 34, 1], width: 1.2 } },
            },
            {
              value: 'Moderate',
              label: 'Moderate',
              symbol: { type: 'simple-fill', color: [241, 156, 55, 0.4], outline: { color: [178, 101, 19, 1], width: 1.1 } },
            },
            {
              value: 'Low',
              label: 'Low',
              symbol: { type: 'simple-fill', color: [62, 157, 122, 0.36], outline: { color: [29, 113, 82, 1], width: 1 } },
            },
            {
              value: 'No Potential',
              label: 'No Potential',
              symbol: { type: 'simple-fill', color: [111, 125, 139, 0.18], outline: { color: [91, 103, 116, 0.75], width: 0.8 } },
            },
            {
              value: 'Needs Review',
              label: 'Needs Review',
              symbol: { type: 'simple-fill', color: [116, 86, 176, 0.34], outline: { color: [87, 56, 143, 1], width: 1.1 } },
            },
          ],
        },
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
      : new Map({ basemap: 'topo-vector' })
    map.addMany([projectLayer, resultLayer, ...userAddedFeatureLayers, ...[bufferOutputLayer, cnddbOutputLayer].filter((layer): layer is FeatureLayer => Boolean(layer)), selectedCnddbLayer, sketchLayer])

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

    const layerList = new LayerList({
      view,
      container: layerListContainer,
      listItemCreatedFunction: (event) => {
        const layer = event.item.layer as FeatureLayer | undefined
        const addedLayer = mapAddedLayers.find((candidate) => `map-added-${candidate.id}` === layer?.id)
        if (!addedLayer) return
        event.item.actionsSections = [[{
          type: 'button',
          title: 'Zoom to',
          className: 'esri-icon-zoom-in-magnifying-glass',
          id: `zoom-${addedLayer.id}`,
        }, {
          type: 'button',
          title: 'Remove layer',
          className: 'esri-icon-trash',
          id: `remove-${addedLayer.id}`,
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
      if (match) onRemoveMapLayer?.(match[1])
    })

    const escapeSqlLiteral = (value: string) => value.replaceAll("'", "''")

    const selectedSymbolForGeometry = (geometryType: string | undefined) => {
      if (geometryType === 'point' || geometryType === 'multipoint') {
        return new SimpleMarkerSymbol({
          style: 'circle',
          color: [255, 255, 255, 0.35],
          size: 18,
          outline: { color: [25, 91, 255, 1], width: 4 },
        })
      }
      if (geometryType === 'polyline') {
        return new SimpleLineSymbol({
          color: [25, 91, 255, 1],
          width: 5,
        })
      }
      return new SimpleFillSymbol({
        color: [255, 255, 255, 0.08],
        outline: { color: [25, 91, 255, 1], width: 4 },
      })
    }

    const updateSelectedSpeciesHighlight = async (commonName: string) => {
      selectedCnddbLayer.removeAll()
      if (!cnddbOutputLayer || !commonName) return null

      try {
        const query = cnddbOutputLayer.createQuery()
        query.where = `CNAME = '${escapeSqlLiteral(commonName)}'`
        query.outFields = ['CNAME']
        query.returnGeometry = true
        query.num = 500
        const features = await cnddbOutputLayer.queryFeatures(query)
        const symbol = selectedSymbolForGeometry(cnddbOutputLayer.geometryType)
        selectedCnddbLayer.addMany(features.features.map((feature) => new Graphic({
          geometry: feature.geometry,
          attributes: feature.attributes,
          symbol,
        })))
        return features
      } catch {
        return null
      }
    }

    const applySelectedSpecies = async (commonName: string) => {
      loadedSpeciesName = commonName
      if (!cnddbOutputLayer) return

      cnddbOutputLayer.definitionExpression = '1=1'
      cnddbOutputLayer.featureEffect = commonName
        ? {
          filter: { where: `CNAME = '${escapeSqlLiteral(commonName)}'` },
          includedEffect: 'brightness(125%) saturate(135%)',
          excludedEffect: 'grayscale(65%) opacity(32%)',
        }
        : null
      const selectedFeatures = await updateSelectedSpeciesHighlight(commonName)

      if (!commonName) return

      try {
        const query = cnddbOutputLayer.createQuery()
        query.where = `CNAME = '${escapeSqlLiteral(commonName)}'`
        const extentResult = selectedFeatures?.features.length ? await cnddbOutputLayer.queryExtent(query) : await cnddbOutputLayer.queryExtent()
        if (extentResult.extent) {
          await view.goTo(extentResult.extent.expand(1.5), { duration: 650 })
        }
      } catch {
        // Some output layers may not expose matching CNAME values; keep the table selection working either way.
      }
    }

    const mapClickHandle = view.on('click', async (event) => {
      if (!cnddbOutputLayer || !reviewMode) return
      try {
        const response = await view.hitTest(event, { include: cnddbOutputLayer })
        const result = response.results.find((candidate) => candidate.type === 'graphic' && 'graphic' in candidate)
        const graphic = result?.type === 'graphic' ? result.graphic : null
        const commonName = String(graphic?.attributes?.CNAME ?? '').trim()
        if (commonName) onSelectSpeciesFromMapRef.current?.(commonName)
      } catch {
        // Map selection should never interrupt normal pan/zoom/popup interaction.
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
      mapClickHandle.remove()
      layerList.destroy()
      sketch.destroy()
      projectFeatureLayer?.destroy()
      userAddedFeatureLayers.forEach((layer) => layer.destroy())
      bufferOutputLayer?.destroy()
      cnddbOutputLayer?.destroy()
      view.destroy()
    }
  }, [bufferLayerUrl, cnddbLayerUrl, mapAddedLayers, onProjectSketchChange, reviewMode, webMapId])

  return (
    <div className="arcgis-map-shell">
      <div className="arcgis-map" ref={containerRef} />
      <div className={`map-widget-panel layer-widget-panel ${activeMapTool === 'layers' ? 'open' : ''}`} ref={layerListRef} />
      <div className={`map-widget-panel sketch-widget-panel ${!reviewMode && activeMapTool === 'sketch' ? 'open' : ''}`} ref={sketchRef} />
    </div>
  )
}


import { useEffect, useRef } from 'react'
import Map from '@arcgis/core/Map'
import MapView from '@arcgis/core/views/MapView'
import GraphicsLayer from '@arcgis/core/layers/GraphicsLayer'
import Graphic from '@arcgis/core/Graphic'
import Point from '@arcgis/core/geometry/Point'
import Polyline from '@arcgis/core/geometry/Polyline'
import Polygon from '@arcgis/core/geometry/Polygon'
import SimpleFillSymbol from '@arcgis/core/symbols/SimpleFillSymbol'
import SimpleLineSymbol from '@arcgis/core/symbols/SimpleLineSymbol'
import SimpleMarkerSymbol from '@arcgis/core/symbols/SimpleMarkerSymbol'
import '@arcgis/core/assets/esri/themes/light/main.css'
import './ArcGISMap.css'

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

export function ArcGISMap() {
  const containerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!containerRef.current) return

    const projectLayer = new GraphicsLayer({ title: 'Project area demo' })
    const resultLayer = new GraphicsLayer({ title: 'PTO results demo' })

    const map = new Map({
      basemap: 'topo-vector',
      layers: [projectLayer, resultLayer],
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
        content: 'Demo project feature. Next step: add sketch/select input.',
      },
    })

    projectLayer.addMany([buffer, corridor])
    resultLayer.addMany([
      makeOccurrence(-121.61, 38.48, '#d64545', 'High potential'),
      makeOccurrence(-121.53, 38.56, '#d64545', 'High potential'),
      makeOccurrence(-121.42, 38.41, '#e59f2a', 'Moderate potential'),
      makeOccurrence(-121.72, 38.32, '#3b82b6', 'Low potential'),
      makeOccurrence(-121.38, 38.62, '#7c5cc4', 'Needs Review'),
      makeOccurrence(-121.58, 38.23, '#8a94a6', 'No Potential'),
    ])

    view.when(() => {
      view.ui.move('zoom', 'bottom-left')
    })

    return () => {
      view.destroy()
    }
  }, [])

  return <div className="arcgis-map" ref={containerRef} />
}

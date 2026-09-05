// Generated from config/data-catalog.json. Do not edit by hand.
export const DATA_RUNTIME = {
  "pipelineVersion": "4.4.0",
  "profilePipelineVersion": "GeoAdmin-Horizont v6",
  "scenePromptVersion": "benchly-scene-1.2",
  "sceneReconcilerVersion": "benchly-evidence-1.1",
  "osmPbfUrl": "https://download.geofabrik.de/europe/switzerland-latest.osm.pbf",
  "geoAdminBaseUrl": "https://api3.geo.admin.ch",
  "geoAdminDataBaseUrl": "https://data.geo.admin.ch",
  "transportApiBaseUrl": "https://transport.opendata.ch/v1",
  "graphHopperDefaultUrl": "http://127.0.0.1:8989",
  "mapStyleUrl": "https://vectortiles.geo.admin.ch/styles/ch.swisstopo.lightbasemap.vt/style.json",
  "mapRasterTileUrl": "https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.swisstlm3d-karte-farbe/default/current/3857/{z}/{x}/{y}.png",
  "landCoverVersion": "swisstopo Base-Landbedeckung v1.0.0",
  "landCoverTileUrl": "https://vectortiles0.geo.admin.ch/tiles/ch.swisstopo.base.vt/v1.0.0"
} as const;
export const DATA_PROVIDERS = {
  "gtfsCatalogueBaseUrl": "https://data.opentransportdata.swiss",
  "gtfsDownloadHosts": [
    "data.opentransportdata.swiss",
    "proxy-server-omd.datopian.com",
    "83025b28472d6aa2bf5ae59f3724aa78.eu.r2.cloudflarestorage.com"
  ],
  "geoAdminHeightUrl": "https://api3.geo.admin.ch/rest/services/height",
  "geoAdminProfileUrl": "https://api3.geo.admin.ch/rest/services/profile.json",
  "swissTlmItemsUrl": "https://data.geo.admin.ch/api/stac/v0.9/collections/ch.swisstopo.swisstlm3d/items?limit=100",
  "swissBuildingsItemsUrl": "https://data.geo.admin.ch/api/stac/v1/collections/ch.swisstopo.swissbuildings3d_3_0/items",
  "swisstopoRasterItemsTemplate": "https://data.geo.admin.ch/api/stac/v0.9/collections/{collection}/items",
  "swissAltiCollection": "ch.swisstopo.swissalti3d",
  "swissSurfaceCollection": "ch.swisstopo.swisssurface3d-raster",
  "meteoIconCollection": "ogd-forecasting-icon-ch1",
  "meteoIconStacCollection": "ch.meteoschweiz.ogd-forecasting-icon-ch1",
  "meteoIconHorizontalConstants": "horizontal_constants_icon-ch1-eps.grib2",
  "meteoRadarItemsUrl": "https://data.geo.admin.ch/api/stac/v1/collections/ch.meteoschweiz.ogd-radar-precip/items",
  "meteoStationMetadataUrl": "https://data.geo.admin.ch/ch.meteoschweiz.ogd-smn/ogd-smn_meta_stations.csv",
  "meteoStationCurrentTemplate": "https://data.geo.admin.ch/ch.meteoschweiz.ogd-smn/{station}/ogd-smn_{station}_t_now.csv",
  "panoramaxSearchUrl": "https://api.panoramax.xyz/api/search",
  "panoramaxViewerUrl": "https://panoramax.xyz/",
  "commonsApiUrl": "https://commons.wikimedia.org/w/api.php",
  "kartaViewNearbyUrl": "https://api.openstreetcam.org/1.0/list/nearby-photos/",
  "kartaViewViewerUrl": "https://kartaview.org/",
  "swissImageWmsUrl": "https://wms.geo.admin.ch/",
  "swissImageMapUrl": "https://map.geo.admin.ch/",
  "swissImageLayer": "ch.swisstopo.swissimage",
  "inferenceDefaultUrl": "http://inference-api.inference.svc.cluster.local:8080"
} as const;

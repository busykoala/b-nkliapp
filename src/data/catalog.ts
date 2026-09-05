import { z } from "zod";
import rawCatalog from "../../config/data-catalog.json";

const sourceSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  kind: z.string().min(1),
  url: z.string().min(1),
  provides: z.array(z.string().min(1)).min(1),
  license: z.string().min(1),
  usedBy: z.array(z.string().min(1)).min(1),
});

const artifactSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  path: z.string().min(1),
  version: z.string().min(1),
});

const jobSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  title: z.string().min(1),
  schedule: z.string().min(5),
  frequency: z.string().min(1),
  deadlineSeconds: z.number().int().positive(),
  command: z.string().min(1),
  args: z.array(z.string()),
  sourceIds: z.array(z.string()).min(1),
  artifactIds: z.array(z.string()).min(1),
  profile: z.enum(["standard", "landscape", "inference"]),
});

const catalogSchema = z.object({
  schemaVersion: z.literal(1),
  catalogVersion: z.string().min(1),
  timeZone: z.string().min(1),
  runtime: z.object({
    pipelineVersion: z.string().min(1),
    profilePipelineVersion: z.string().min(1),
    scenePromptVersion: z.string().min(1),
    sceneReconcilerVersion: z.string().min(1),
    osmPbfUrl: z.url(),
    geoAdminBaseUrl: z.url(),
    geoAdminDataBaseUrl: z.url(),
    transportApiBaseUrl: z.url(),
    graphHopperDefaultUrl: z.url(),
    mapStyleUrl: z.url(),
    mapRasterTileUrl: z.string().url().includes("{z}"),
    landCoverVersion: z.string().min(1),
    landCoverTileUrl: z.url(),
  }),
  providers: z.object({
    gtfsCatalogueBaseUrl: z.url(),
    gtfsDownloadHosts: z.array(z.string().min(1)).min(1),
    geoAdminHeightUrl: z.url(),
    geoAdminProfileUrl: z.url(),
    swissTlmItemsUrl: z.url(),
    swissBuildingsItemsUrl: z.url(),
    swisstopoRasterItemsTemplate: z.string().url().includes("{collection}"),
    swissAltiCollection: z.string().min(1),
    swissSurfaceCollection: z.string().min(1),
    meteoIconCollection: z.string().min(1),
    meteoIconStacCollection: z.string().min(1),
    meteoIconHorizontalConstants: z.string().min(1),
    meteoRadarItemsUrl: z.url(),
    meteoStationMetadataUrl: z.url(),
    meteoStationCurrentTemplate: z.string().url().includes("{station}"),
    panoramaxSearchUrl: z.url(),
    panoramaxViewerUrl: z.url(),
    commonsApiUrl: z.url(),
    kartaViewNearbyUrl: z.url(),
    kartaViewViewerUrl: z.url(),
    swissImageWmsUrl: z.url(),
    swissImageMapUrl: z.url(),
    swissImageLayer: z.string().min(1),
    inferenceDefaultUrl: z.url(),
  }),
  sources: z.array(sourceSchema).min(1),
  artifacts: z.array(artifactSchema).min(1),
  jobs: z.array(jobSchema).min(1),
}).superRefine((catalog, context) => {
  const checkUnique = (values: string[], label: string) => {
    if (new Set(values).size !== values.length) context.addIssue({ code: "custom", message: `${label} müssen eindeutig sein` });
  };
  checkUnique(catalog.sources.map(({ id }) => id), "Quellen-IDs");
  checkUnique(catalog.artifacts.map(({ id }) => id), "Artefakt-IDs");
  checkUnique(catalog.jobs.map(({ id }) => id), "Job-IDs");

  const sources = new Set(catalog.sources.map(({ id }) => id));
  const artifacts = new Set(catalog.artifacts.map(({ id }) => id));
  for (const job of catalog.jobs) {
    for (const id of job.sourceIds) if (!sources.has(id)) context.addIssue({ code: "custom", message: `Job ${job.id} referenziert unbekannte Quelle ${id}` });
    for (const id of job.artifactIds) if (!artifacts.has(id)) context.addIssue({ code: "custom", message: `Job ${job.id} referenziert unbekanntes Artefakt ${id}` });
  }
});

export type DataCatalog = z.infer<typeof catalogSchema>;
export type DataSource = DataCatalog["sources"][number];
export type DataJob = DataCatalog["jobs"][number];

export const dataCatalog: DataCatalog = catalogSchema.parse(rawCatalog);

export function sourcesFor(job: DataJob): DataSource[] {
  const ids = new Set(job.sourceIds);
  return dataCatalog.sources.filter(({ id }) => ids.has(id));
}

import type { MessageKey } from '@/i18n/types';

/** Public explanations describe implemented methods; the catalog retains operational metadata. */
export const sourceExplanations: Record<string, { summary: MessageKey; description: MessageKey } | undefined> = {
  "openstreetmap": { summary: 'about.sources.entries.openstreetmap.summary', description: 'about.sources.entries.openstreetmap.description' },
  "geofabrik": { summary: 'about.sources.entries.geofabrik.summary', description: 'about.sources.entries.geofabrik.description' },
  "swisstopo-map": { summary: 'about.sources.entries.swisstopo-map.summary', description: 'about.sources.entries.swisstopo-map.description' },
  "swisstlm3d": { summary: 'about.sources.entries.swisstlm3d.summary', description: 'about.sources.entries.swisstlm3d.description' },
  "swissbuildings3d": { summary: 'about.sources.entries.swissbuildings3d.summary', description: 'about.sources.entries.swissbuildings3d.description' },
  "swissalti3d": { summary: 'about.sources.entries.swissalti3d.summary', description: 'about.sources.entries.swissalti3d.description' },
  "swisssurface3d": { summary: 'about.sources.entries.swisssurface3d.summary', description: 'about.sources.entries.swisssurface3d.description' },
  "meteoswiss": { summary: 'about.sources.entries.meteoswiss.summary', description: 'about.sources.entries.meteoswiss.description' },
  "transport-api": { summary: 'about.sources.entries.transport-api.summary', description: 'about.sources.entries.transport-api.description' },
  "swiss-gtfs": { summary: 'about.sources.entries.swiss-gtfs.summary', description: 'about.sources.entries.swiss-gtfs.description' },
  "graphhopper": { summary: 'about.sources.entries.graphhopper.summary', description: 'about.sources.entries.graphhopper.description' },
  "wikimedia-commons": { summary: 'about.sources.entries.wikimedia-commons.summary', description: 'about.sources.entries.wikimedia-commons.description' },
  "panoramax": { summary: 'about.sources.entries.panoramax.summary', description: 'about.sources.entries.panoramax.description' },
  "kartaview": { summary: 'about.sources.entries.kartaview.summary', description: 'about.sources.entries.kartaview.description' },
  "swissimage": { summary: 'about.sources.entries.swissimage.summary', description: 'about.sources.entries.swissimage.description' },
  "zurich-benches": { summary: 'about.sources.entries.zurich-benches.summary', description: 'about.sources.entries.zurich-benches.description' },
  "zurich-trees": { summary: 'about.sources.entries.zurich-trees.summary', description: 'about.sources.entries.zurich-trees.description' },
  "basel-trees": { summary: 'about.sources.entries.basel-trees.summary', description: 'about.sources.entries.basel-trees.description' },
  "sonbase": { summary: 'about.sources.entries.sonbase.summary', description: 'about.sources.entries.sonbase.description' },
  "swissnames3d": { summary: 'about.sources.entries.swissnames3d.summary', description: 'about.sources.entries.swissnames3d.description' },
  "swissboundaries3d": { summary: 'about.sources.entries.swissboundaries3d.summary', description: 'about.sources.entries.swissboundaries3d.description' },
  "qwen3-vl-benchly": { summary: 'about.sources.entries.qwen3-vl-benchly.summary', description: 'about.sources.entries.qwen3-vl-benchly.description' },
  "qwen35-bank-photos": { summary: 'about.sources.entries.qwen35-bank-photos.summary', description: 'about.sources.entries.qwen35-bank-photos.description' },
  "benchly-community": { summary: 'about.sources.entries.benchly-community.summary', description: 'about.sources.entries.benchly-community.description' },
};

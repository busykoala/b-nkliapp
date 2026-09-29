import type { PanoramaDescriptor } from "./types";

/** A refresh without artwork must not tear down an already usable painting. */
export function retainPanoramaArtifact(current: PanoramaDescriptor, incoming: PanoramaDescriptor): PanoramaDescriptor {
  return incoming.artifactUrl || !current.artifactUrl ? incoming : current;
}

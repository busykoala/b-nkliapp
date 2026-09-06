"""Validated runtime settings derived from Benchly's data catalog."""

from benchly.catalog import load_catalog


CATALOG = load_catalog()
DEFAULT_OSM_PBF_URL = str(CATALOG.runtime.osmPbfUrl)
PIPELINE_VERSION = CATALOG.runtime.pipelineVersion
PROFILE_PIPELINE_VERSION = CATALOG.runtime.profilePipelineVersion
PROVIDERS = CATALOG.providers

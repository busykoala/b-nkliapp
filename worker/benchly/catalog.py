"""Validated access to Benchly's single data-source and refresh catalog."""

from __future__ import annotations

import json
import os
from functools import lru_cache
from pathlib import Path

from pydantic import BaseModel, ConfigDict, Field, HttpUrl, model_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class RuntimeConfig(StrictModel):
    pipelineVersion: str
    profilePipelineVersion: str
    scenePromptVersion: str
    sceneReconcilerVersion: str
    osmPbfUrl: HttpUrl
    geoAdminBaseUrl: HttpUrl
    geoAdminDataBaseUrl: HttpUrl
    transportApiBaseUrl: HttpUrl
    graphHopperDefaultUrl: HttpUrl
    mapStyleUrl: HttpUrl
    mapRasterTileUrl: str
    landCoverVersion: str
    landCoverTileUrl: HttpUrl


class ProviderConfig(StrictModel):
    gtfsCatalogueBaseUrl: HttpUrl
    gtfsDownloadHosts: list[str] = Field(min_length=1)
    geoAdminHeightUrl: HttpUrl
    geoAdminProfileUrl: HttpUrl
    swissTlmItemsUrl: HttpUrl
    swissBuildingsItemsUrl: HttpUrl
    swisstopoRasterItemsTemplate: str
    swissAltiCollection: str
    swissSurfaceCollection: str
    meteoIconCollection: str
    meteoIconStacCollection: str
    meteoIconHorizontalConstants: str
    meteoRadarItemsUrl: HttpUrl
    meteoStationMetadataUrl: HttpUrl
    meteoStationCurrentTemplate: str
    panoramaxSearchUrl: HttpUrl
    panoramaxViewerUrl: HttpUrl
    commonsApiUrl: HttpUrl
    kartaViewNearbyUrl: HttpUrl
    kartaViewViewerUrl: HttpUrl
    swissImageWmsUrl: HttpUrl
    swissImageMapUrl: HttpUrl
    swissImageLayer: str
    inferenceDefaultUrl: HttpUrl

    @model_validator(mode="after")
    def validate_templates(self) -> "ProviderConfig":
        if "{collection}" not in self.swisstopoRasterItemsTemplate:
            raise ValueError("swisstopoRasterItemsTemplate must contain {collection}")
        if "{station}" not in self.meteoStationCurrentTemplate:
            raise ValueError("meteoStationCurrentTemplate must contain {station}")
        return self


class DataSource(StrictModel):
    id: str = Field(pattern=r"^[a-z0-9-]+$")
    name: str
    kind: str
    url: str
    provides: list[str] = Field(min_length=1)
    license: str
    usedBy: list[str] = Field(min_length=1)


class Artifact(StrictModel):
    id: str = Field(pattern=r"^[a-z0-9-]+$")
    label: str
    path: str
    version: str


class DataJob(StrictModel):
    id: str = Field(pattern=r"^[a-z0-9-]+$")
    title: str
    schedule: str
    frequency: str
    deadlineSeconds: int = Field(gt=0)
    command: str
    args: list[str]
    sourceIds: list[str] = Field(min_length=1)
    artifactIds: list[str] = Field(min_length=1)
    profile: str = Field(pattern=r"^(standard|landscape|inference)$")


class DataCatalog(StrictModel):
    schemaVersion: int = Field(ge=1)
    catalogVersion: str
    timeZone: str
    runtime: RuntimeConfig
    providers: ProviderConfig
    sources: list[DataSource] = Field(min_length=1)
    artifacts: list[Artifact] = Field(min_length=1)
    jobs: list[DataJob] = Field(min_length=1)

    @model_validator(mode="after")
    def validate_graph(self) -> "DataCatalog":
        source_ids = [source.id for source in self.sources]
        artifact_ids = [artifact.id for artifact in self.artifacts]
        job_ids = [job.id for job in self.jobs]
        if len(source_ids) != len(set(source_ids)) or len(artifact_ids) != len(set(artifact_ids)) or len(job_ids) != len(set(job_ids)):
            raise ValueError("Catalog IDs must be unique")
        known_sources = set(source_ids)
        known_artifacts = set(artifact_ids)
        for job in self.jobs:
            unknown_sources = set(job.sourceIds) - known_sources
            unknown_artifacts = set(job.artifactIds) - known_artifacts
            if unknown_sources or unknown_artifacts:
                raise ValueError(f"Job {job.id} has unknown references: {unknown_sources | unknown_artifacts}")
            if len(job.schedule.split()) != 5:
                raise ValueError(f"Job {job.id} has an invalid five-field cron expression")
        return self


def catalog_path() -> Path:
    configured = os.environ.get("BENCHLY_DATA_CATALOG")
    return Path(configured) if configured else Path(__file__).resolve().parents[2] / "config" / "data-catalog.json"


@lru_cache(maxsize=1)
def load_catalog() -> DataCatalog:
    with catalog_path().open(encoding="utf-8") as handle:
        return DataCatalog.model_validate(json.load(handle))

"use client";

import { ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";
import type { BenchDetail } from "@/lib/types";
import { KnowledgeCoverage } from "@/features/bench-knowledge/knowledge-details";
import { AccessPanel } from "./access-panel";
import { BenchPanel } from "./bench-panel";
import { LightPanel } from "./light-panel";
import { ViewPanel } from "./view-panel";

export function BenchSources({ bench }: { bench: BenchDetail }) {
  const t = useTranslations();
  return <details className="bench-sources">
    <summary>{t("bench.overview.sources")}<ChevronDown size={18} className="disclosure-chevron" aria-hidden="true" /></summary>
    <div className="bench-source-content">
      <p className="source-intro">{t("knowledge.details.intro")}</p>
      <BenchPanel bench={bench} />
      <AccessPanel bench={bench} />
      <LightPanel bench={bench} />
      <ViewPanel bench={bench} />
      <KnowledgeCoverage bench={bench} />
    </div>
  </details>;
}

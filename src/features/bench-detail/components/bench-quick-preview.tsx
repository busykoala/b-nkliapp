"use client";

import { ArrowUpRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { requestBenchPanorama } from "@/app/actions/panorama";
import type { CurrentUser } from "@/lib/security";
import type { BenchDetail } from "@/lib/types";
import { useBenchContributions } from "@/features/bench-community/components/use-bench-contributions";
import { BenchHeader } from "./bench-header";
import { BenchOverview } from "./bench-overview";
import { NearbyAmenities } from "./nearby-amenities";
import type { NearbyAmenity } from "../overview";

export function BenchQuickPreview({ bench, user, onJourney, onDetails, onChanged, onLocateAmenity }: {
  bench: BenchDetail;
  user: CurrentUser | null;
  onJourney?: () => void;
  onDetails?: () => void;
  onChanged?: () => void | Promise<void>;
  onLocateAmenity?: (amenity: NearbyAmenity) => void;
}) {
  const t = useTranslations();
  const router = useRouter();
  const refresh = onChanged ?? (() => router.refresh());
  const { contribute, dialogs } = useBenchContributions(bench, user, refresh);
  useEffect(() => {
    if (bench.panorama?.status !== "ready") void requestBenchPanorama(bench.id).catch(() => {});
  }, [bench.id, bench.panorama?.status]);
  return <section className="bench-quick-preview bench-detail">
    <BenchHeader bench={bench} user={user} onJourney={onJourney} onChanged={refresh} onEdit={() => contribute("features")} />
    <BenchOverview bench={bench} />
    <NearbyAmenities bench={bench} onLocate={onLocateAmenity} />
    {onDetails && <button type="button" className="bench-details-link" onClick={onDetails}><ArrowUpRight size={18} aria-hidden="true" />{t("bench.sheet.showDetails")}</button>}
    {dialogs}
  </section>;
}

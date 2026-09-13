import { MapExplorer } from "@/components/map-explorer";
import { readBenchDetail } from "@/features/bench-detail/service";
import { withRequestDialect } from "@/lib/dialects/presentation";
import { getCurrentUser } from "@/lib/security";

export const dynamic = "force-dynamic";

export default async function Home({ searchParams }: PageProps<"/">) {
  const [query, user] = await Promise.all([searchParams, getCurrentUser()]);
  const requestedBench = typeof query.bank === "string" ? query.bank : null;
  const initialBench = requestedBench
    ? await withRequestDialect(readBenchDetail(requestedBench, user))
    : null;
  return <MapExplorer user={user} initialBench={initialBench} />;
}

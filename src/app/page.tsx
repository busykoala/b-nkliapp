import { MapExplorer } from "@/components/map-explorer";
import { getCurrentUser } from "@/lib/security";

export const dynamic = "force-dynamic";

export default async function Home() {
  return <MapExplorer user={await getCurrentUser()} />;
}

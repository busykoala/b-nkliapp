import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { notFound } from "next/navigation";
import { getBenchDetail } from "@/app/actions/map";
import { BenchDetailContent } from "@/components/bench-detail-content";
import { getCurrentUser } from "@/lib/security";
import { AppMenu } from "@/components/app-menu";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const bench = await getBenchDetail((await params).id);
  return bench ? { title: bench.title, description: bench.viewScore === null ? "Sitzbank mit Sonnen- und Umgebungsanalyse in der Bänkli App." : `Sitzbank mit Aussicht ${bench.viewScore}/5 in der Bänkli App.` } : { title: "Bank nicht gefunden" };
}

export default async function BenchPage({ params }: { params: Promise<{ id: string }> }) {
  const bench = await getBenchDetail((await params).id);
  if (!bench) notFound();
  const user = await getCurrentUser();
  return <main className="standalone-bench min-h-dvh"><header className="safe-top sticky top-0 z-20 flex min-h-16 items-center justify-between px-3"><Link href={`/?bank=${bench.id}`} aria-label="Zur Karte" className="calm-menu-button"><ArrowLeft size={19} /></Link><AppMenu user={user} /></header><article className="standalone-bench-card mx-auto max-w-2xl pb-12"><BenchDetailContent bench={bench} user={user} /></article></main>;
}

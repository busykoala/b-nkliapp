import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Map } from "lucide-react";
import { notFound } from "next/navigation";
import { getBenchDetail } from "@/app/actions/map";
import { BenchDetailContent } from "@/components/bench-detail-content";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const bench = await getBenchDetail((await params).id);
  return bench ? { title: bench.title, description: bench.viewScore === null ? "Sitzbank mit Sonnen- und Umgebungsanalyse auf Benchly." : `Sitzbank mit Aussicht ${bench.viewScore}/5 auf Benchly.` } : { title: "Bank nicht gefunden" };
}

export default async function BenchPage({ params }: { params: Promise<{ id: string }> }) {
  const bench = await getBenchDetail((await params).id);
  if (!bench) notFound();
  return <main className="min-h-dvh bg-base-200"><header className="navbar sticky top-0 z-10 border-b border-base-300 bg-base-100 px-3 safe-top"><Link href="/" className="btn btn-ghost min-h-11"><ArrowLeft size={19} /> Zur Karte</Link><div className="flex-1" /><Link href={`/?bank=${bench.id}`} className="btn btn-primary min-h-11"><Map size={18} /> Karte</Link></header><article className="mx-auto max-w-2xl bg-base-100 p-4 pb-12 sm:my-6 sm:rounded-box sm:p-6 sm:shadow"><BenchDetailContent bench={bench} /></article></main>;
}

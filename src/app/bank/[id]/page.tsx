import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Armchair, Map } from "lucide-react";
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
  return <main className="min-h-dvh bg-base-200"><header className="safe-top sticky top-0 z-20 flex min-h-16 items-center gap-2 border-b border-base-300/50 bg-base-100/88 px-3 backdrop-blur-xl"><Link href="/" className="btn btn-ghost min-h-11 px-2.5"><ArrowLeft size={19} /> Zur Karte</Link><div className="hidden flex-1 items-center justify-center gap-2 text-sm font-black text-primary sm:flex"><Armchair size={18} /> Benchly</div><div className="flex-1 sm:hidden" /><Link href={`/?bank=${bench.id}`} className="btn btn-primary min-h-11 rounded-2xl"><Map size={18} /> Karte</Link></header><article className="mx-auto max-w-2xl p-4 pb-12 sm:my-6 sm:rounded-[2rem] sm:p-6"><BenchDetailContent bench={bench} /></article></main>;
}

import Link from "next/link";
import { Armchair, Map } from "lucide-react";

export default function NotFound() {
  return <main className="grid min-h-dvh place-items-center bg-base-200 p-4 text-center"><div><Armchair className="mx-auto mb-4 text-primary" size={58} /><h1 className="text-3xl font-black">Bank nicht gefunden</h1><p className="mt-2 opacity-65">Sie wurde vielleicht aus den Quelldaten entfernt.</p><Link href="/" className="btn btn-primary mt-5"><Map size={18} /> Zur Karte</Link></div></main>;
}

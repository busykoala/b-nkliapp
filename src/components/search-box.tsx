"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { LocateFixed, Search, X } from "lucide-react";
import { searchPlaces } from "@/app/actions/map";
import type { PlaceResult } from "@/lib/types";

export function SearchBox({ onSelect, onLocate }: { onSelect: (place: PlaceResult) => void; onLocate: () => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PlaceResult[]>([]);
  const [pending, startTransition] = useTransition();
  const sequence = useRef(0);
  useEffect(() => {
    if (query.trim().length < 2) return;
    const current = ++sequence.current;
    const timeout = window.setTimeout(() => startTransition(async () => {
      try {
        const next = await searchPlaces(query);
        if (current === sequence.current) setResults(next);
      } catch { if (current === sequence.current) setResults([]); }
    }), 350);
    return () => window.clearTimeout(timeout);
  }, [query]);
  return (
    <div className="relative flex flex-1 gap-2">
      <div className="relative flex-1">
        <Search className="pointer-events-none absolute left-3 top-3 text-base-content/55" size={20} />
        <input aria-label="Ort suchen" className="input input-bordered min-h-12 w-full bg-base-100 pl-10 pr-10 shadow-lg" placeholder="Ort oder PLZ suchen" value={query} onChange={(e) => { setQuery(e.target.value); if (e.target.value.trim().length < 2) setResults([]); }} />
        {query && <button aria-label="Suche leeren" className="btn btn-circle btn-ghost btn-sm absolute right-1.5 top-1.5" onClick={() => { setQuery(""); setResults([]); }}><X size={18} /></button>}
        {(pending || results.length > 0) && query.length >= 2 && (
          <ul className="menu absolute left-0 right-0 top-14 rounded-box border border-base-300 bg-base-100 p-2 shadow-xl">
            {pending && results.length === 0 && <li className="px-3 py-2 text-sm opacity-60">Suche …</li>}
            {results.map((place) => <li key={place.id}><button className="min-h-11" onClick={() => { onSelect(place); setQuery(place.label); setResults([]); }}>{place.label}</button></li>)}
          </ul>
        )}
      </div>
      <button aria-label="Meinen Standort anzeigen" className="btn btn-circle btn-primary min-h-12 min-w-12 shadow-lg" onClick={onLocate}><LocateFixed size={21} /></button>
    </div>
  );
}

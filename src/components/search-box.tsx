"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Armchair, LocateFixed, MapPin, Search, X } from "lucide-react";
import { searchPlaces } from "@/app/actions/map";
import type { PlaceResult } from "@/lib/types";

export function SearchBox({ onSelect, onLocate }: { onSelect: (place: PlaceResult) => void; onLocate: () => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PlaceResult[]>([]);
  const [pending, startTransition] = useTransition();
  const sequence = useRef(0);
  const selectedQuery = useRef<string | null>(null);
  useEffect(() => {
    if (selectedQuery.current === query) { selectedQuery.current = null; return; }
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
    <div className="relative flex min-w-0 flex-1">
      <div className="relative flex-1">
        <Search className="pointer-events-none absolute left-3.5 top-3.5 z-10 text-primary/65" size={18} />
        <input aria-label="Ort suchen" className="input calm-search min-h-12 w-full border-0 pl-10 pr-[4.8rem] text-sm placeholder:text-base-content/45" placeholder="Einen stillen Platz finden" value={query} onChange={(e) => { selectedQuery.current = null; setQuery(e.target.value); if (e.target.value.trim().length < 2) setResults([]); }} />
        {query && <button aria-label="Suche leeren" className="btn btn-circle btn-ghost btn-sm absolute right-11 top-0.5 z-10" onClick={() => { setQuery(""); setResults([]); }}><X size={17} /></button>}
        <button aria-label="Meinen Standort anzeigen" className="btn btn-circle btn-ghost absolute right-0.5 top-0.5 z-10 min-h-11 min-w-11 text-primary" onClick={() => onLocate()}><LocateFixed size={19} /></button>
        {(pending || results.length > 0) && query.length >= 2 && (
          <ul className="menu storybook-panel absolute left-0 right-0 top-14 rounded-[1.25rem] p-2">
            {pending && results.length === 0 && <li className="px-3 py-2 text-sm opacity-60">Suche …</li>}
            {results.map((place) => <li key={place.id}><button className="min-h-11 gap-2" onClick={() => { onSelect(place); selectedQuery.current = place.label; setQuery(place.label); setResults([]); }}>{place.kind === "bench" ? <Armchair size={17} className="text-primary" /> : <MapPin size={17} className="text-primary/65" />}<span>{place.label}</span></button></li>)}
          </ul>
        )}
      </div>
    </div>
  );
}

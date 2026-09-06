"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { Armchair, House, LocateFixed, MapPin, Search, TrainFront, X } from "lucide-react";
import { searchPlaces } from "@/app/actions/map";
import type { PlaceResult } from "@/lib/types";

export function SearchBox({ onSelect, onLocate }: { onSelect: (place: PlaceResult) => void; onLocate: () => void }) {
  const listId = useId();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PlaceResult[]>([]);
  const [highlighted, setHighlighted] = useState(-1);
  const [feedback, setFeedback] = useState<"idle" | "empty" | "error">("idle");
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
        if (current === sequence.current) {
          setResults(next);
          setHighlighted(-1);
          setFeedback(next.length ? "idle" : "empty");
        }
      } catch {
        if (current === sequence.current) {
          setResults([]);
          setHighlighted(-1);
          setFeedback("error");
        }
      }
    }), 350);
    return () => window.clearTimeout(timeout);
  }, [query]);

  const choose = (place: PlaceResult) => {
    sequence.current += 1;
    onSelect(place);
    selectedQuery.current = place.label;
    setQuery(place.label);
    setResults([]);
    setHighlighted(-1);
    setFeedback("idle");
  };
  const clear = () => {
    sequence.current += 1;
    selectedQuery.current = null;
    setQuery("");
    setResults([]);
    setHighlighted(-1);
    setFeedback("idle");
  };
  const open = query.trim().length >= 2 && (pending || results.length > 0 || feedback !== "idle");
  return (
    <div className="relative flex min-w-0 flex-1">
      <div className="relative flex-1">
        <Search className="pointer-events-none absolute left-3.5 top-3.5 z-10 text-primary/65" size={18} />
        <input
          aria-label="Ort suchen"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={listId}
          aria-activedescendant={highlighted >= 0 ? `${listId}-${highlighted}` : undefined}
          className="input calm-search min-h-12 w-full border-0 pl-10 pr-[4.8rem] text-sm placeholder:text-base-content/55"
          placeholder="Ort oder Bänkli suchen"
          value={query}
          onChange={(event) => {
            const next = event.target.value;
            selectedQuery.current = null;
            setQuery(next);
            if (next.trim().length < 2) {
              sequence.current += 1;
              setResults([]);
              setHighlighted(-1);
              setFeedback("idle");
            }
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") { clear(); return; }
            if ((event.key === "ArrowDown" || event.key === "ArrowUp") && results.length) {
              event.preventDefault();
              setHighlighted((current) => (current + (event.key === "ArrowDown" ? 1 : -1) + results.length) % results.length);
            }
            if (event.key === "Enter" && results[highlighted]) {
              event.preventDefault();
              choose(results[highlighted]);
            }
          }}
        />
        {query && <button type="button" aria-label="Suche leeren" className="btn btn-circle btn-ghost btn-sm absolute right-11 top-0.5 z-10" onClick={clear}><X size={17} /></button>}
        <button aria-label="Meinen Standort anzeigen" className="btn btn-circle btn-ghost absolute right-0.5 top-0.5 z-10 min-h-11 min-w-11 text-primary" onClick={() => onLocate()}><LocateFixed size={19} /></button>
        {open && (
          <ul id={listId} role="listbox" aria-label="Suchergebnisse" className="map-search-results storybook-panel absolute left-0 right-0 top-14 rounded-[1.25rem] p-2">
            {pending && results.length === 0 && <li className="map-search-feedback" role="status">Suche …</li>}
            {!pending && feedback === "empty" && <li className="map-search-feedback" role="status">Hier versteckt sich noch kein passender Ort.</li>}
            {!pending && feedback === "error" && <li className="map-search-feedback is-error" role="status">Die Suche macht gerade Pause. Versuch es nochmals.</li>}
            {results.map((place, index) => <li id={`${listId}-${index}`} key={place.id} role="option" aria-selected={index === highlighted}>
              <button type="button" tabIndex={-1} onClick={() => choose(place)}>
                <SearchResultIcon place={place} />
                <span><strong>{place.label}</strong><small>{placeKind(place.kind)}</small></span>
              </button>
            </li>)}
          </ul>
        )}
      </div>
    </div>
  );
}

function SearchResultIcon({ place }: { place: PlaceResult }) {
  if (place.kind === "bench") return <Armchair size={18} aria-hidden="true" />;
  if (place.kind === "address") return <House size={18} aria-hidden="true" />;
  if (place.kind === "station") return <TrainFront size={18} aria-hidden="true" />;
  return <MapPin size={18} aria-hidden="true" />;
}

function placeKind(kind: PlaceResult["kind"]) {
  return ({ bench: "Bänkli", address: "Adresse", station: "Haltestelle", place: "Ort" } as const)[kind];
}

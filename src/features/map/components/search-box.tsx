"use client";
import { useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { Armchair, House, LocateFixed, MapPin, Search, TrainFront, X } from "lucide-react";
import { searchPlaces } from "@/app/actions/map";
import type { PlaceResult } from "@/lib/types";

export function SearchBox({ onSelect, onLocate }: { onSelect: (place: PlaceResult) => void; onLocate: () => void }) {
  const t = useTranslations();
  const listId = useId();
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const [results, setResults] = useState<PlaceResult[]>([]);
  const [highlighted, setHighlighted] = useState(-1);
  const [feedback, setFeedback] = useState<"idle" | "empty" | "error">("idle");
  const [pending, startTransition] = useTransition();
  const sequence = useRef(0);
  const selectedQuery = useRef<string | null>(null);
  useEffect(() => {
    if (selectedQuery.current === query) return;
    if (query.trim().length < 2) return;
    const current = ++sequence.current;
    let active = true;
    const timeout = window.setTimeout(() => startTransition(async () => {
      try {
        const next = await searchPlaces(query);
        if (active && current === sequence.current) {
          setResults(next); setHighlighted(-1); setFeedback(next.length ? "idle" : "empty");
        }
      } catch {
        if (active && current === sequence.current) { setResults([]); setHighlighted(-1); setFeedback("error"); }
      }
    }), 350);
    return () => { active = false; window.clearTimeout(timeout); };
  }, [query]);
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setFocused(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, []);
  const choose = (place: PlaceResult) => {
    sequence.current++;
    selectedQuery.current = place.label;
    setQuery(place.label); setResults([]); setHighlighted(-1); setFeedback("idle"); setFocused(false);
    input.current?.blur(); onSelect(place);
  };
  const locate = () => { setFocused(false); setHighlighted(-1); input.current?.blur(); onLocate(); };
  const clear = () => {
    sequence.current++; selectedQuery.current = null;
    setQuery(""); setResults([]); setHighlighted(-1); setFeedback("idle"); setFocused(true);
    input.current?.focus();
  };
  const suggestLocation = query.trim().length === 0;
  const open = focused && (suggestLocation || (query.trim().length >= 2 && (pending || results.length > 0 || feedback !== "idle")));
  const optionCount = suggestLocation ? 1 : results.length;
  return <div ref={root} className="relative flex min-w-0 flex-1" onBlur={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
  }}>
    <div className="relative flex-1">
      <Search className="pointer-events-none absolute left-3.5 top-3.5 z-10 text-primary/65" size={18} aria-hidden="true" />
      <input ref={input} aria-label={t("map.search.label")} role="combobox" aria-autocomplete="list" aria-expanded={open}
        aria-controls={open ? listId : undefined} aria-activedescendant={open && highlighted >= 0 ? `${listId}-${highlighted}` : undefined}
        className="input calm-search min-h-12 w-full border-0 pl-10 pr-12 text-sm placeholder:text-base-content/55"
        placeholder={t("map.search.placeholder")} value={query} onFocus={() => setFocused(true)}
        onChange={(event) => {
          sequence.current++; selectedQuery.current = null;
          setQuery(event.target.value); setResults([]); setHighlighted(-1); setFeedback("idle"); setFocused(true);
        }} onKeyDown={(event) => {
          if (event.key === "Escape" && open) {
            event.preventDefault(); event.stopPropagation(); setFocused(false); setHighlighted(-1); return;
          }
          if ((event.key === "ArrowDown" || event.key === "ArrowUp") && optionCount) {
            event.preventDefault(); setFocused(true);
            setHighlighted((current) => current < 0 ? (event.key === "ArrowDown" ? 0 : optionCount - 1)
              : (current + (event.key === "ArrowDown" ? 1 : -1) + optionCount) % optionCount);
          }
          if (event.key === "Enter" && open && highlighted >= 0) {
            event.preventDefault();
            if (suggestLocation) locate(); else if (results[highlighted]) choose(results[highlighted]);
          }
        }} />
      {query && <button type="button" aria-label={t("map.search.clear")}
        className="btn btn-circle btn-ghost absolute right-0.5 top-0.5 z-10 min-h-11 min-w-11" onClick={clear}><X size={17} aria-hidden="true" /></button>}
      {open && <ul id={listId} role="listbox" aria-label={t("map.search.results")}
        className="map-search-results storybook-panel absolute left-0 right-0 top-14 rounded-[1.25rem] p-2"
        onPointerDown={(event) => event.preventDefault()}>
        {suggestLocation ? <li id={`${listId}-0`} role="option" aria-selected={highlighted === 0}>
          <button type="button" tabIndex={-1} onClick={locate}><LocateFixed size={18} aria-hidden="true" />
            <span><strong>{t("map.location.show")}</strong><small>{t("map.location.searchHint")}</small></span>
          </button>
        </li> : <>
          {pending && results.length === 0 && <li className="map-search-feedback" role="status">{t("map.search.pending")}</li>}
          {!pending && feedback === "empty" && <li className="map-search-feedback" role="status">{t("map.search.empty")}</li>}
          {!pending && feedback === "error" && <li className="map-search-feedback is-error" role="status">{t("map.search.failed")}</li>}
          {results.map((place, index) => <li id={`${listId}-${index}`} key={place.id} role="option" aria-selected={index === highlighted}>
            <button type="button" tabIndex={-1} onClick={() => choose(place)}><SearchResultIcon place={place} />
              <span><strong>{place.label}</strong><small>{t(`map.search.kinds.${place.kind}`)}</small></span>
            </button>
          </li>)}
        </>}
      </ul>}
    </div>
  </div>;
}

function SearchResultIcon({ place }: { place: PlaceResult }) {
  if (place.kind === "bench") return <Armchair size={18} aria-hidden="true" />;
  if (place.kind === "address") return <House size={18} aria-hidden="true" />;
  if (place.kind === "station") return <TrainFront size={18} aria-hidden="true" />;
  return <MapPin size={18} aria-hidden="true" />;
}

import type { LandscapeKey, SeasonKey } from "@/lib/profile";

const environments: Record<LandscapeKey, string> = {
  mountain: "/ui-art/scenes/badge-alpine.webp",
  hill: "/ui-art/scenes/badge-country.webp",
  water: "/ui-art/scenes/badge-lake.webp",
  city: "/ui-art/scenes/badge-city.webp",
  forest: "/ui-art/scenes/badge-forest.webp",
  open: "/ui-art/scenes/badge-country.webp",
};

export function LandscapeStamp({ kind, found }: { kind: LandscapeKey; found: boolean }) {
  return <svg className="landscape-stamp painted-stamp" viewBox="0 0 112 76" aria-hidden="true" data-kind={kind} data-found={found}>
    <image href={environments[kind]} width="112" height="76" preserveAspectRatio="xMidYMid slice" />
    <image className="stamp-painted-bench" href="/ui-art/benches/wood-back.webp" x="40" y="44" width="45" height="30" />
  </svg>;
}

export function SeasonStamp({ season, name, found }: { season: SeasonKey; name: string; found: boolean }) {
  return <div className={`season-token ${found ? "is-found" : "is-locked"}`}>
    <svg className="painted-stamp" viewBox="0 0 64 58" aria-hidden="true" data-season={season}>
      <image href={`/ui-art/seasons/${season}.webp`} width="64" height="58" preserveAspectRatio="xMidYMid slice" />
    </svg><small>{name}</small>
  </div>;
}

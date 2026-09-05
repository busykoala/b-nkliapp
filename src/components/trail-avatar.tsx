import { useId } from "react";
import { WatercolorPigment } from "@/components/watercolor-pigment";
import { appearanceFromSeed, avatarOptionLabels, type AvatarAppearance } from "@/lib/avatar";

type TrailAvatarProps = {
  seed: string;
  username: string;
  progress?: number;
  compact?: boolean;
  appearance?: AvatarAppearance;
};

const skinColors: Record<AvatarAppearance["skin"], string> = {
  porcelain: "#efd0aa", sunlit: "#e8bf91", warm: "#d79a6d", brown: "#ad7153", deep: "#7c4c3c",
};
const hairColors: Record<AvatarAppearance["hair"], string> = {
  charcoal: "#34352f", chestnut: "#654535", copper: "#a6653e", blond: "#d2ad6e", silver: "#aaa99e",
};
const coatColors: Record<AvatarAppearance["coat"], string> = {
  pine: "#356554", lake: "#486c76", rust: "#925c43", moss: "#6d7650", plum: "#67556f",
};
const accentColors: Record<Exclude<AvatarAppearance["accent"], "none">, string> = {
  gold: "#d6a044", coral: "#c36f51", sage: "#7ca49a", cream: "#dfc77f",
};

function hashSeed(value: string) {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function AvatarBackground({ kind }: { kind: AvatarAppearance["background"] }) {
  const environments = {
    mountain: "/ui-art/v2/bench-scene-alpine-winter.webp",
    lake: "/ui-art/v2/bench-scene-lake.webp",
    forest: "/ui-art/v1/bench-scene-forest-v1.webp",
    city: "/ui-art/v3/bench-scene-city.webp",
    meadow: "/ui-art/v1/bench-scene-country-v1.webp",
  };
  return <image className="avatar-painted-background" href={environments[kind]} x="18" y="15" width="208" height="215" preserveAspectRatio="xMidYMid slice" />;
}

function AvatarHair({ style, color }: { style: AvatarAppearance["hairStyle"]; color: string }) {
  if (style === "waves") return <path className="avatar-hair" style={{ fill: color }} d="M82 116q-2-47 38-48 43-1 41 48-12-14-17-31-27 22-60 14Zm2 1q-10 34 9 49l12-18q-16-11-13-35Zm72-8q11 35-8 56l-10-19q15-13 11-35Z" />;
  if (style === "bob") return <path className="avatar-hair" style={{ fill: color }} d="M80 116q0-49 40-49 43 0 43 50l-5 37-17 10 3-67q-21 16-55 8l8 59-18-12Z" />;
  if (style === "bun") return <><ellipse className="avatar-hair" style={{ fill: color }} cx="121" cy="62" rx="22" ry="19" /><path className="avatar-hair" style={{ fill: color }} d="M82 111q1-44 38-44 41 0 41 45-8-12-13-26-18 15-35 8-14 13-31 17Z" /></>;
  if (style === "curls") return <g className="avatar-hair avatar-curls" style={{ fill: color }}><circle cx="91" cy="91" r="17" /><circle cx="109" cy="78" r="17" /><circle cx="132" cy="78" r="18" /><circle cx="151" cy="92" r="18" /><circle cx="87" cy="116" r="14" /><circle cx="154" cy="118" r="14" /></g>;
  return <path className="avatar-hair" style={{ fill: color }} d="M83 116q-6-48 37-48 44 0 39 51-14-10-17-28-20 17-54 13l2 31q-9-5-7-19Z" />;
}

function AvatarHat({ kind, color }: { kind: AvatarAppearance["hat"]; color: string }) {
  if (kind === "beanie") return <g className="avatar-hat" style={{ fill: color }}><path d="M82 88q8-39 38-39 32 0 39 39Z" /><path d="M74 86q47-7 94 0v12H74Z" /></g>;
  if (kind === "brim") return <g className="avatar-hat" style={{ fill: color }}><path d="M91 82q8-31 29-31 23 0 31 31Z" /><path d="M67 83q53-11 106 0v10H67Z" /></g>;
  if (kind === "cap") return <g className="avatar-hat" style={{ fill: color }}><path d="M84 84q10-31 38-30 27 1 35 33Z" /><path d="M120 85q34-5 53 7-31 3-54 1Z" /></g>;
  return null;
}

export function TrailAvatar({ seed, username, progress = 0, compact = false, appearance: selectedAppearance }: TrailAvatarProps) {
  const instance = useId().replaceAll(":", "");
  const hash = hashSeed(`${seed}:${username}`);
  const appearance = selectedAppearance ?? appearanceFromSeed(seed);
  const skin = skinColors[appearance.skin];
  const hair = hairColors[appearance.hair];
  const coat = coatColors[appearance.coat];
  const accent = appearance.accent === "none" ? "#d8c99f" : accentColors[appearance.accent];
  const level = progress >= 40 ? 4 : progress >= 5 ? 2 : 0;
  const gradientId = `avatar-sky-${hash}-${instance}`;
  const pigmentId = `avatar-pigment-${instance}`;
  const coatId = `avatar-coat-${hash}-${instance}`;
  const clipId = `avatar-clip-${hash}-${instance}`;
  const description = `${avatarOptionLabels.hairStyle[appearance.hairStyle]}, ${avatarOptionLabels.coat[appearance.coat]}, Hintergrund ${avatarOptionLabels.background[appearance.background]}`;

  return <svg className={`trail-avatar${compact ? " is-compact" : ""}`} viewBox="0 0 240 240" role="img" aria-label={`Aquarell-Profilbild von ${username}: ${description}`}>
    <defs>
      <WatercolorPigment id={pigmentId} />
      <linearGradient id={gradientId} x1=".08" y1="0" x2=".9" y2="1"><stop offset="0" stopColor="#f7f1e5" /><stop offset=".48" stopColor="#f4eddd" /><stop offset="1" stopColor="#ecdfbc" /></linearGradient>
      <linearGradient id={coatId} x1="0" y1="0" x2="1" y2="1"><stop stopColor={coat} stopOpacity=".76" /><stop offset=".48" stopColor={coat} /><stop offset="1" stopColor="#344e46" stopOpacity=".82" /></linearGradient>
      <clipPath id={clipId}><path d="M30 23Q65 14 96 21q34-9 66 0 31-7 51 6 8 31 4 58 8 31 0 60 6 32-5 62-31 7-62 2-35 8-67 0-29 5-53-5-5-31 2-59-8-32 1-63-6-26 1-49Z" /></clipPath>
    </defs>
    <path className="avatar-paper" d="M24 15Q58 5 91 13q37-11 72 0 34-8 57 7 10 31 5 63 9 34 0 67 7 34-6 69-36 8-69 2-38 9-73 0-31 6-57-5-7-34 1-65-9-36 1-70-7-27 2-52Z" />
    <g clipPath={`url(#${clipId})`}>
      <rect x="18" y="15" width="208" height="202" fill={`url(#${gradientId})`} />
      <AvatarBackground kind={appearance.background} />
      {level >= 4 && <g className="avatar-stars"><path d="m48 48 2 5 5 2-5 2-2 5-2-5-5-2 5-2Zm143 15 2 5 5 2-5 2-2 5-2-5-5-2 5-2Z" /></g>}
      <g className="avatar-person" filter={`url(#${pigmentId})`}>
        <path className="avatar-body-wash" style={{ fill: coat }} d="M67 229q5-74 53-74t53 74Z" />
        <path className="avatar-body" fill={`url(#${coatId})`} d="M72 225q4-67 48-67t48 67Z" />
        <path className="avatar-neck" style={{ fill: skin }} d="M108 145h24v26h-24Z" />
        <ellipse className="avatar-face-wash" style={{ fill: skin }} cx="117" cy="117" rx="40" ry="45" />
        <path className="avatar-face" style={{ fill: skin }} d="M83 111q-1-37 37-38 38 0 38 39l-4 24q-11 24-34 25-23-2-34-26Z" />
        <AvatarHair style={appearance.hairStyle} color={hair} />
        <AvatarHat kind={appearance.hat} color={accent} />
        <path className="avatar-features" d="m101 116 3-1m29 0 3 1m-17 1-2 10 5 1m-12 9q9 5 18-1" />
        <path className="avatar-cheek" d="M94 128q7-3 12 0m28 0q7-3 12 0" />
        {appearance.accent !== "none" && <path className="avatar-scarf" style={{ fill: accent }} d="M92 160q28 13 56 0l5 18q-33 15-66 0Z" />}
      </g>
      {appearance.companion === "bird" && <g className="avatar-companion avatar-bird"><path d="M177 163q8-13 17 0-8-6-17 0Z" /><path d="M185 162v16" /></g>}
      {appearance.companion === "cat" && <g className="avatar-companion avatar-cat"><path d="M181 181q0-26 18-26t17 26Z" /><path d="m184 160 3-14 8 10m16 4-3-14-8 10" /></g>}
      {appearance.companion === "fox" && <g className="avatar-companion avatar-fox"><path d="m179 180 8-27 13 8 13-8 8 27Z" /><path d="m187 154-6-10 14 13m18-3 6-10-14 13" /></g>}
    </g>
    <path className="avatar-frame-wash" d="M27 18Q59 8 92 16q37-10 70 0 34-8 55 7 9 30 5 61 8 34 0 66 7 33-6 65" />
    <path className="avatar-frame" d="M24 15Q58 5 91 13q37-11 72 0 34-8 57 7 10 31 5 63 9 34 0 67 7 34-6 69-36 8-69 2-38 9-73 0-31 6-57-5-7-34 1-65-9-36 1-70-7-27 2-52Z" />
  </svg>;
}

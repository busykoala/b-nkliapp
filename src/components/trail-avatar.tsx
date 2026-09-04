import { useId } from "react";

type TrailAvatarProps = {
  seed: string;
  username: string;
  progress?: number;
  compact?: boolean;
};

function hashSeed(value: string) {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function pick<T>(items: readonly T[], value: number, shift: number) {
  return items[(value >>> shift) % items.length];
}

export function TrailAvatar({ seed, username, progress = 0, compact = false }: TrailAvatarProps) {
  const instance = useId().replaceAll(":", "");
  const hash = hashSeed(`${seed}:${username}`);
  const skin = pick(["#e8bf91", "#d79a6d", "#ad7153", "#7c4c3c", "#efd0aa"] as const, hash, 1);
  const hair = pick(["#40382f", "#6c4935", "#a0663e", "#d5b276", "#263c39"] as const, hash, 4);
  const coat = pick(["#356554", "#486c76", "#925c43", "#6d7650", "#67556f"] as const, hash, 7);
  const scarf = pick(["#dfaa45", "#c36f51", "#7ca49a", "#dfc77f"] as const, hash, 10);
  const hasHat = ((hash >>> 13) & 1) === 1;
  const hairStyle = (hash >>> 15) % 3;
  const companion = (hash >>> 18) % 3;
  const level = progress >= 100 ? 5 : progress >= 40 ? 4 : progress >= 15 ? 3 : progress >= 5 ? 2 : progress >= 1 ? 1 : 0;
  const gradientId = `avatar-sky-${hash}-${instance}`;
  const clipId = `avatar-clip-${hash}-${instance}`;

  return <svg className={`trail-avatar${compact ? " is-compact" : ""}`} viewBox="0 0 240 240" role="img" aria-label={`Gezeichnetes Profilbild von ${username}`}>
    <defs><linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#afccc1" /><stop offset="1" stopColor="#f0d99f" /></linearGradient></defs>
    <path className="avatar-paper" d="M24 15Q58 5 91 13q37-11 72 0 34-8 57 7 10 31 5 63 9 34 0 67 7 34-6 69-36 8-69 2-38 9-73 0-31 6-57-5-7-34 1-65-9-36 1-70-7-27 2-52Z" />
    <clipPath id={clipId}><path d="M30 23Q65 14 96 21q34-9 66 0 31-7 51 6 8 31 4 58 8 31 0 60 6 32-5 62-31 7-62 2-35 8-67 0-29 5-53-5-5-31 2-59-8-32 1-63-6-26 1-49Z" /></clipPath>
    <g clipPath={`url(#${clipId})`}>
      <rect x="18" y="15" width="208" height="202" fill={`url(#${gradientId})`} />
      {level >= 3 && <path className="avatar-mountain" d="M-8 138 44 78l34 39 40-73 58 82 31-44 48 63v49H-8Z" />}
      <path className="avatar-hill-back" d="M-8 153q61-35 121 3 67-49 143 3v67H-8Z" />
      <path className="avatar-hill-front" d="M-8 185q64-32 127 4 58-36 137-8v52H-8Z" />
      {level >= 1 && <g className="avatar-trees"><path d="M35 156v35M35 119l-25 51h50Zm170 44v31m0-65-22 44h44Z" /></g>}
      {level >= 2 && <path className="avatar-trail" d="M-5 229q67-73 127-26 54 42 124-25" />}
      {level >= 4 && <g className="avatar-stars"><path d="m48 48 2 5 5 2-5 2-2 5-2-5-5-2 5-2Zm143 15 2 5 5 2-5 2-2 5-2-5-5-2 5-2Z" /></g>}
      <circle className="avatar-sun" cx={42 + (hash % 150)} cy="50" r="13" />

      <g className="avatar-person">
        <path className="avatar-body" style={{ fill: coat }} d="M72 225q4-67 48-67t48 67Z" />
        <path className="avatar-neck" style={{ fill: skin }} d="M108 145h24v26h-24Z" />
        <ellipse className="avatar-face" style={{ fill: skin }} cx="120" cy="117" rx="38" ry="43" />
        {hairStyle === 0 && <path className="avatar-hair" style={{ fill: hair }} d="M83 116q-6-48 37-48 44 0 39 51-14-10-17-28-20 17-54 13l2 31q-9-5-7-19Z" />}
        {hairStyle === 1 && <path className="avatar-hair" style={{ fill: hair }} d="M82 116q-2-47 38-48 43-1 41 48-12-14-17-31-27 22-60 14Zm2 1q-10 34 9 49l12-18q-16-11-13-35Zm72-8q11 35-8 56l-10-19q15-13 11-35Z" />}
        {hairStyle === 2 && <path className="avatar-hair" style={{ fill: hair }} d="M82 111q1-45 38-45 41 0 41 46-8-12-13-26-18 15-35 8-14 13-31 17Z" />}
        {hasHat && <g className="avatar-hat" style={{ fill: scarf }}><path d="M81 89q9-40 39-40 32 0 40 40Z" /><path d="M70 88q50-9 101 0v10H70Z" /></g>}
        <path className="avatar-features" d="M103 118h1m31 0h1m-24 18q8 6 16 0" />
        <path className="avatar-scarf" style={{ fill: scarf }} d="M92 160q28 13 56 0l5 18q-33 15-66 0Z" />
      </g>

      {level >= 5 && companion === 0 && <g className="avatar-companion avatar-bird"><path d="M177 163q8-13 17 0-8-6-17 0Z" /><path d="M185 162v16" /></g>}
      {level >= 5 && companion === 1 && <g className="avatar-companion avatar-cat"><path d="M181 181q0-26 18-26t17 26Z" /><path d="m184 160 3-14 8 10m16 4-3-14-8 10" /></g>}
      {level >= 5 && companion === 2 && <g className="avatar-companion avatar-fox"><path d="m179 180 8-27 13 8 13-8 8 27Z" /><path d="m187 154-6-10 14 13m18-3 6-10-14 13" /></g>}
    </g>
    <path className="avatar-frame" d="M24 15Q58 5 91 13q37-11 72 0 34-8 57 7 10 31 5 63 9 34 0 67 7 34-6 69-36 8-69 2-38 9-73 0-31 6-57-5-7-34 1-65-9-36 1-70-7-27 2-52Z" />
  </svg>;
}

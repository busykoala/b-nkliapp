export const avatarOptionValues = {
  skin: ["porcelain", "sunlit", "warm", "brown", "deep"],
  hair: ["charcoal", "chestnut", "copper", "blond", "silver"],
  hairStyle: ["short", "waves", "bob", "bun", "curls"],
  coat: ["pine", "lake", "rust", "moss", "plum"],
  accent: ["gold", "coral", "sage", "cream", "none"],
  hat: ["none", "beanie", "brim", "cap"],
  background: ["mountain", "lake", "forest", "city", "meadow"],
  companion: ["none", "bird", "cat", "fox"],
} as const;

export type AvatarAppearance = {
  [Key in keyof typeof avatarOptionValues]: (typeof avatarOptionValues)[Key][number];
};

export const avatarOptionLabels: {
  [Key in keyof typeof avatarOptionValues]: Record<AvatarAppearance[Key], string>;
} = {
  skin: { porcelain: "Hell", sunlit: "Sonnig", warm: "Warm", brown: "Braun", deep: "Dunkel" },
  hair: { charcoal: "Kohle", chestnut: "Kastanie", copper: "Kupfer", blond: "Gold", silver: "Silber" },
  hairStyle: { short: "Kurz", waves: "Wellen", bob: "Bob", bun: "Dutt", curls: "Locken" },
  coat: { pine: "Tanne", lake: "See", rust: "Rost", moss: "Moos", plum: "Pflaume" },
  accent: { gold: "Gold", coral: "Koralle", sage: "Salbei", cream: "Creme", none: "Ohne" },
  hat: { none: "Ohne", beanie: "Mütze", brim: "Hut", cap: "Cap" },
  background: { mountain: "Berge", lake: "See", forest: "Wald", city: "Stadt", meadow: "Wiese" },
  companion: { none: "Allein", bird: "Vogel", cat: "Katze", fox: "Fuchs" },
};

const avatarKeys = Object.keys(avatarOptionValues) as Array<keyof AvatarAppearance>;
const prefix = "avatar-v1";

function hashSeed(value: string) {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function randomAppearance(seed: string): AvatarAppearance {
  const hash = hashSeed(seed);
  return Object.fromEntries(avatarKeys.map((key, index) => {
    const values = avatarOptionValues[key];
    const mixed = Math.imul(hash ^ Math.imul(index + 1, 0x9e3779b1), 2654435761) >>> 0;
    return [key, values[mixed % values.length]];
  })) as AvatarAppearance;
}

export function serializeAvatarAppearance(appearance: AvatarAppearance) {
  return [prefix, ...avatarKeys.map((key) => appearance[key])].join("|");
}

export function parseAvatarAppearance(value: string): AvatarAppearance | null {
  const [candidatePrefix, ...parts] = value.split("|");
  if (candidatePrefix !== prefix || parts.length !== avatarKeys.length) return null;
  const appearance = Object.fromEntries(avatarKeys.map((key, index) => [key, parts[index]])) as AvatarAppearance;
  return avatarKeys.every((key) => (avatarOptionValues[key] as readonly string[]).includes(appearance[key])) ? appearance : null;
}

export function appearanceFromSeed(seed: string) {
  return parseAvatarAppearance(seed) ?? randomAppearance(seed);
}

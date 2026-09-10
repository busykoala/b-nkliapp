import type { AvatarAppearance } from "@/lib/avatar";
import type { Translator } from "./types";

type AvatarMessageKey = {[K in keyof AvatarAppearance]: `avatar.options.${K}.${AvatarAppearance[K]}`}[keyof AvatarAppearance];

export function avatarOptionLabel<K extends keyof AvatarAppearance>(group: K, value: AvatarAppearance[K], t: Translator) {
  return t(`avatar.options.${group}.${value}` as AvatarMessageKey);
}

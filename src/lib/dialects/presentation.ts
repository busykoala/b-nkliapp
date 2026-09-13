import "server-only";

import { cookies, headers } from "next/headers";
import { dialectCookie, languageCookie, localeTags, resolveDialectEnabled, resolveLanguage, type Language } from "@/i18n/config";
import { DIALECT_PACK_MESSAGES } from "@/i18n/dialects/packs.generated";
import { DIALECT_AREAS, DIALECT_PACK_MANIFEST } from "@/i18n/dialects/registry.generated";
import type { BenchDetail } from "@/lib/types";
import type { DialectPresentation } from "./model";
import { resolveDialect } from "./resolve";
import { spatialDialectResolution } from "./spatial";

const manifests = new Map<string, (typeof DIALECT_PACK_MANIFEST)[number]>(DIALECT_PACK_MANIFEST.map((pack) => [pack.id, pack]));
const areas = new Map<string, (typeof DIALECT_AREAS)[number]>(DIALECT_AREAS.map((area) => [area.id, area]));

function hash(value: string) {
  let result = 2166136261;
  for (const character of value) {
    result ^= character.charCodeAt(0);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
}

function lightState(bench: BenchDetail): "potentialSun" | "shade" | "night" | "unknown" {
  if (bench.dayPhase === "night" || bench.shadeCause === "nacht") return "night";
  if (bench.sunnyNow === true) return "potentialSun";
  if (bench.sunnyNow === false) return "shade";
  return "unknown";
}

export function createDialectPresentation(bench: BenchDetail, language: Language): DialectPresentation | null {
  const resolution = resolveDialect(bench, language, spatialDialectResolution(bench.latitude, bench.longitude));
  if (!resolution.voiceId) return null;
  const pack = manifests.get(resolution.voiceId);
  const messages = DIALECT_PACK_MESSAGES[resolution.voiceId as keyof typeof DIALECT_PACK_MESSAGES];
  if (!pack || !messages) return null;
  const localVariants = resolution.areaId ? areas.get(resolution.areaId)?.variants ?? [] : [];
  const variants = localVariants.length ? localVariants : pack.invitations;
  const variant = variants[hash(`${bench.id}:${pack.id}:${variants.map((item) => item.id).join(":")}`) % variants.length];
  return {
    appLanguageTag: localeTags[language],
    resolution,
    voice: {
      id: pack.id, label: pack.label, language: pack.language, languageTag: pack.languageTag,
      formatLocale: pack.formatLocale, version: pack.version, first: variant.text, second: pack.light[lightState(bench)],
    },
    messages: messages as Record<string, unknown>,
  };
}

export async function withRequestDialect(bench: BenchDetail | null): Promise<BenchDetail | null> {
  if (!bench) return null;
  const [cookieStore, headerStore] = await Promise.all([cookies(), headers()]);
  if (!resolveDialectEnabled(cookieStore.get(dialectCookie)?.value)) return { ...bench, dialectPresentation: null };
  const language = resolveLanguage(cookieStore.get(languageCookie)?.value, headerStore.get("accept-language") ?? "");
  return { ...bench, dialectPresentation: createDialectPresentation(bench, language) };
}

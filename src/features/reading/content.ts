import { essay as de } from "./content/de";
import { essay as fr } from "./content/fr";
import { essay as it } from "./content/it";
import { essay as rm } from "./content/rm";
import deLabels from "@/i18n/messages/de/reading.json";
import frLabels from "@/i18n/messages/fr/reading.json";
import itLabels from "@/i18n/messages/it/reading.json";
import rmLabels from "@/i18n/messages/rm/reading.json";
import type { Essay, EssayLanguage } from "./model";

export const essays: Record<EssayLanguage, Essay> = { de, fr, it, rm };
export const readingLabels = {
  de: deLabels.article, fr: frLabels.article, it: itLabels.article, rm: rmLabels.article,
};

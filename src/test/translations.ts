import "@/i18n/intl-number";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createTranslator } from "next-intl";
import type { Messages } from "@/i18n/messages";
import type { Language } from "@/i18n/config";

export function testMessages(language: Language = "de") {
  const directory = join(process.cwd(), "src/i18n/messages", language);
  const messages = Object.fromEntries(readdirSync(directory).filter((file) => file.endsWith(".json"))
    .map((file) => [file.slice(0, -5), JSON.parse(readFileSync(join(directory, file), "utf8"))])) as Messages;
  return messages;
}

export function testTranslator(language: Language = "de") {
  return createTranslator({ locale: `${language}-CH`, messages: testMessages(language) });
}

import type { LocalBenchProfile } from "@/lib/dialect";

import deAccount from "./messages/de/account.json";
import deAvatar from "./messages/de/avatar.json";
import deBench from "./messages/de/bench.json";
import deCommon from "./messages/de/common.json";
import deCommunity from "./messages/de/community.json";
import deKnowledge from "./messages/de/knowledge.json";
import dePhotos from "./messages/de/photos.json";
import deSubmission from "./messages/de/submission.json";
import frAccount from "./messages/fr/account.json";
import frAvatar from "./messages/fr/avatar.json";
import frBench from "./messages/fr/bench.json";
import frCommon from "./messages/fr/common.json";
import frCommunity from "./messages/fr/community.json";
import frKnowledge from "./messages/fr/knowledge.json";
import frPhotos from "./messages/fr/photos.json";
import frSubmission from "./messages/fr/submission.json";
import itAccount from "./messages/it/account.json";
import itAvatar from "./messages/it/avatar.json";
import itBench from "./messages/it/bench.json";
import itCommon from "./messages/it/common.json";
import itCommunity from "./messages/it/community.json";
import itKnowledge from "./messages/it/knowledge.json";
import itPhotos from "./messages/it/photos.json";
import itSubmission from "./messages/it/submission.json";
import rmAccount from "./messages/rm/account.json";
import rmAvatar from "./messages/rm/avatar.json";
import rmBench from "./messages/rm/bench.json";
import rmCommon from "./messages/rm/common.json";
import rmCommunity from "./messages/rm/community.json";
import rmKnowledge from "./messages/rm/knowledge.json";
import rmPhotos from "./messages/rm/photos.json";
import rmSubmission from "./messages/rm/submission.json";

// Only namespaces rendered inside a bench panel ship to the browser. The rest
// of the application keeps using the user's fallback standard-language catalog.
const localMessages = {
  de: { account: deAccount, avatar: deAvatar, bench: deBench, common: deCommon, community: deCommunity, knowledge: deKnowledge, photos: dePhotos, submission: deSubmission },
  fr: { account: frAccount, avatar: frAvatar, bench: frBench, common: frCommon, community: frCommunity, knowledge: frKnowledge, photos: frPhotos, submission: frSubmission },
  it: { account: itAccount, avatar: itAvatar, bench: itBench, common: itCommon, community: itCommunity, knowledge: itKnowledge, photos: itPhotos, submission: itSubmission },
  rm: { account: rmAccount, avatar: rmAvatar, bench: rmBench, common: rmCommon, community: rmCommunity, knowledge: rmKnowledge, photos: rmPhotos, submission: rmSubmission },
} as const;

function mapMessageStrings<T>(value: T, transform: (message: string) => string): T {
  if (typeof value === "string") return transform(value) as T;
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, mapMessageStrings(child, transform)])) as T;
}

/**
 * Swiss German has no single standard orthography. These deliberately modest,
 * region-aware substitutions make the complete translated bench surface read
 * as Mundart while leaving ICU placeholders, names and contributed text alone.
 */
function swissGerman(message: string, profile: LocalBenchProfile) {
  const negative = profile.region === "zurich" ? "nöd" : profile.region === "bern" || profile.region === "central" || profile.region === "graubuenden" ? "nid" : "nit";
  const bench = profile.region === "basel" ? "Bänggli" : profile.region === "wallis" ? "Bänki" : "Bänkli";
  const here = ["basel", "northwest", "northeast", "graubuenden"].includes(profile.region) ? "Do" : "Da";
  const today = profile.region === "basel" ? "Hitt" : profile.region === "wallis" ? "Hit" : "Hüt";

  const rules: [RegExp, string][] = [
    [/Auf einen Blick/g, "Uf en Blick"],
    [/So sitzt es sich hier/g, `${here} sitzt sichs so`],
    [/Was die Bank mitbringt/g, `Was s ${bench} mitbringt`],
    [/Bankdetails/g, `${bench}-Detail`],
    [/Sitzbank/g, bench],
    [/Bank/g, bench],
    [/Bänke/g, "Bänkli"],
    [/\bHeute\b/g, today],
    [/\bheute\b/g, today.toLocaleLowerCase("de-CH")],
    [/\bGestern\b/g, "Geschter"],
    [/\bgestern\b/g, "geschter"],
    [/\bNicht\b/g, negative[0].toUpperCase() + negative.slice(1)],
    [/\bnicht\b/g, negative],
    [/\bist\b/g, "isch"],
    [/\bIst\b/g, "Isch"],
    [/\bHier\b/g, here],
    [/\bhier\b/g, here.toLocaleLowerCase("de-CH")],
    [/\bNoch\b/g, "No"],
    [/\bnoch\b/g, "no"],
    [/\bZurück\b/g, "Zrugg"],
    [/\bKarte\b/g, "Charte"],
    [/\bSonne\b/g, "Sunne"],
    [/\bSonnen/g, "Sunne"],
    [/\bSchatten\b/g, "Schatte"],
    [/\bLicht\b/g, "Liecht"],
    [/\bAussicht\b/g, "Ussicht"],
    [/\bRückenlehne\b/g, "Ruggelehne"],
    [/\bMenschen\b/g, "Lüüt"],
    [/\bBeiträge\b/g, "Biträg"],
    [/\bBeitrag\b/g, "Bitrag"],
    [/\bBewertungen\b/g, "Bewärtige"],
    [/\bGebäude\b/g, "Gebäud"],
    [/\bBäume\b/g, "Böim"],
    [/\bGelände\b/g, "Gländ"],
    [/\bRuhe\b/g, "Rueh"],
    [/\bZugangsweg\b/g, "Zuegang"],
    [/\bMit Rollstuhl\b/g, "Mit em Rollstuhl"],
    [/\bgeschätzt\b/g, "gschätzt"],
    [/\bunbewertet\b/g, `no ${negative} bewärtet`],
    [/\bunbekannt\b/g, `${negative} bekannt`],
    [/\bauf der\b/g, "uf de"],
    [/\bauf dem\b/g, "uf em"],
    [/\bauf\b/g, "uf"],
    [/\bkönnen\b/g, "chönd"],
    [/\bkann\b/g, "cha"],
    [/aktualisiert sich automatisch/g, "passt sich automatisch aa"],
    [/\bzeigen\b/g, "zeige"],
    [/\bgespeichert\b/g, "gspeicheret"],
    [/\bgeprüft\b/g, "prüeft"],
    [/\bEntfernen\b/g, "Wägneh"],
    [/\bSchliessen\b/g, "Zuemache"],
    [/\bschliessen\b/g, "zuemache"],
  ];
  return rules.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), message);
}

export function localBenchMessages(profile: LocalBenchProfile) {
  const messages = localMessages[profile.uiLanguage];
  return profile.uiLanguage === "de" ? mapMessageStrings(messages, message => swissGerman(message, profile)) : messages;
}

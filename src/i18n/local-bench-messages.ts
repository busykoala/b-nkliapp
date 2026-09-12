import type { Language } from "./config";

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

export function localBenchMessages(language: Language) {
  return localMessages[language];
}

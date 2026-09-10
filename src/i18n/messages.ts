import 'server-only';
import type { Language } from './config';

export const namespaces = ["about","account","admin","avatar","bench","common","community","favourites","feed","journey","knowledge","legal","map","photos","poetry","privacy","profile","routing","statistics","submission","walks"] as const;
export type Messages = {
  about: typeof import('./messages/de/about.json');
  account: typeof import('./messages/de/account.json');
  admin: typeof import('./messages/de/admin.json');
  avatar: typeof import('./messages/de/avatar.json');
  bench: typeof import('./messages/de/bench.json');
  common: typeof import('./messages/de/common.json');
  community: typeof import('./messages/de/community.json');
  favourites: typeof import('./messages/de/favourites.json');
  feed: typeof import('./messages/de/feed.json');
  journey: typeof import('./messages/de/journey.json');
  knowledge: typeof import('./messages/de/knowledge.json');
  legal: typeof import('./messages/de/legal.json');
  map: typeof import('./messages/de/map.json');
  photos: typeof import('./messages/de/photos.json');
  poetry: typeof import('./messages/de/poetry.json');
  privacy: typeof import('./messages/de/privacy.json');
  profile: typeof import('./messages/de/profile.json');
  routing: typeof import('./messages/de/routing.json');
  statistics: typeof import('./messages/de/statistics.json');
  submission: typeof import('./messages/de/submission.json');
  walks: typeof import('./messages/de/walks.json');
};

export async function loadMessages(language: Language): Promise<Messages> {
  const entries = await Promise.all(namespaces.map(async (namespace) => [namespace, (await import(`./messages/${language}/${namespace}.json`)).default]));
  return Object.fromEntries(entries) as Messages;
}

export type FeedEntry = {
  id: string;
  kind: "added" | "rated" | "confirmed" | "missing" | "edited" | "moment" | "care";
  username: string;
  avatarSeed: string;
  benchId: string;
  benchName: string;
  createdAt: string;
  detail: string | null;
};

export type WeeklyBench = { id: string; name: string; place: string | null };
export type FeedCursor = { createdAt: string; id: string };
export type FeedPage = { entries: FeedEntry[]; personalized: boolean; nextCursor: FeedCursor | null };
export type ActivityFeed = FeedPage & { weeklyBench: WeeklyBench | null };

export function groupFeed(entries: FeedEntry[], now = Date.now()) {
  const day = 86_400_000;
  const groups = [
    { key: "today", label: "Heute", entries: [] as FeedEntry[] },
    { key: "week", label: "Diese Woche", entries: [] as FeedEntry[] },
    { key: "earlier", label: "Etwas früher", entries: [] as FeedEntry[] },
  ];
  for (const entry of entries) {
    const age = Math.max(0, now - Date.parse(entry.createdAt));
    groups[age < day ? 0 : age < day * 7 ? 1 : 2].entries.push(entry);
  }
  return groups.filter((group) => group.entries.length);
}

/** Coalesce all activity at a bench on the same Swiss calendar day, including page boundaries. */
export function groupBenchActivity(entries: FeedEntry[]) {
  const groups = new Map<string, { key: string; benchId: string; benchName: string; date: string; entries: FeedEntry[] }>();
  const seen = new Set<string>();
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich", year: "numeric", month: "2-digit", day: "2-digit" });
  for (const entry of entries) {
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    const date = day.format(new Date(entry.createdAt));
    const key = `${entry.benchId}:${date}`;
    const group = groups.get(key) ?? { key, benchId: entry.benchId, benchName: entry.benchName, date, entries: [] };
    group.entries.push(entry);
    groups.set(key, group);
  }
  return [...groups.values()];
}

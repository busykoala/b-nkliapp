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
export type ActivityFeed = { entries: FeedEntry[]; personalized: boolean; weeklyBench: WeeklyBench | null };

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

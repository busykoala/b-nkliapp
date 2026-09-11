import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { ArrowLeft, Sparkles } from "lucide-react";
import { getActivityFeed } from "@/app/actions/feed";
import { AppMenu } from "@/components/app-menu";
import { FeedStream } from "@/features/feed/feed-stream";
import { getCurrentUser } from "@/lib/security";
import { communityTheme } from "@/lib/community-theme";

export const dynamic = "force-dynamic";

export default async function FeedPage({ searchParams }: { searchParams: Promise<{ view?: string | string[] }> }) {
  const t = await getTranslations();
  const [params, user] = await Promise.all([searchParams, getCurrentUser()]);
  const scope = params.view === "following" && user ? "following" : "all";
  const feed = await getActivityFeed(48, scope);
  const theme = communityTheme(t);
  return <main className="feed-page min-h-dvh safe-bottom">
    <header className="feed-nav safe-top"><Link href="/" aria-label={t("feed.page.map")} className="calm-menu-button"><ArrowLeft size={19} /></Link><AppMenu user={user} /></header>
    <section className="feed-intro"><span><Sparkles size={14} /> {feed.personalized ? t("feed.page.following") : t("feed.page.all")}</span><h1>{t("feed.page.title")}</h1><p>{feed.personalized ? t("feed.page.followingIntro") : t("feed.page.intro")}</p>
      <div className="feed-rituals">
        {feed.weeklyBench && <Link href={`/bank/${feed.weeklyBench.id}?from=feed`}><small>{t("feed.page.weekly")}</small><strong>{feed.weeklyBench.name ?? t("common.values.bench")}</strong>{feed.weeklyBench.place && feed.weeklyBench.place !== feed.weeklyBench.name && <span>{feed.weeklyBench.place}</span>}</Link>}
        <aside><small>{t("feed.page.theme")}</small><strong>{theme.title}</strong><span>{theme.prompt}</span></aside>
      </div>
    </section>
    <section className="feed-scroll" aria-label={t("feed.page.news")}>
      {user && <nav className="feed-filters" aria-label={t("feed.page.filters")}>
        <Link className="ui-button" href="/feed" aria-current={scope === "all" ? "page" : undefined}>{t("feed.page.allPosts")}</Link>
        <Link className="ui-button" href="/feed?view=following" aria-current={scope === "following" ? "page" : undefined}>{t("feed.page.favourites")}</Link>
      </nav>}
      <FeedStream key={scope} initial={feed} scope={scope} />
    </section>
  </main>;
}

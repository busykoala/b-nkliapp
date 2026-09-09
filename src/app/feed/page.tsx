import Link from "next/link";
import { ArrowLeft, Sparkles } from "lucide-react";
import { getActivityFeed } from "@/app/actions/feed";
import { AppMenu } from "@/components/app-menu";
import { FeedStream } from "@/features/feed/feed-stream";
import { getCurrentUser } from "@/lib/security";
import { communityTheme } from "@/lib/community-theme";

export const dynamic = "force-dynamic";


export default async function FeedPage() {
  const [feed, user] = await Promise.all([getActivityFeed(), getCurrentUser()]);
  const theme = communityTheme();
  return <main className="feed-page min-h-dvh safe-bottom">
    <header className="feed-nav safe-top"><Link href="/" aria-label="Zur Karte" className="calm-menu-button"><ArrowLeft size={19} /></Link><AppMenu user={user} /></header>
    <section className="feed-intro"><span><Sparkles size={14} /> {feed.personalized ? "Aus deinen Lieblingsorten" : "Was sich an Bänkli bewegt"}</span><h1>Bänkli-Momente</h1><p>{feed.personalized ? "Geschichten und kleine Pflegezeichen von Plätzen, denen du folgst." : "Geschichten, Pausen und kleine Entdeckungen – pro Bänkli und Tag zusammengefasst."}</p>
      <div className="feed-rituals">
        {feed.weeklyBench && <Link href={`/bank/${feed.weeklyBench.id}`}><small>Bänkli dieser Woche</small><strong>{feed.weeklyBench.name}</strong>{feed.weeklyBench.place && feed.weeklyBench.place !== feed.weeklyBench.name && <span>{feed.weeklyBench.place}</span>}</Link>}
        <aside><small>Gemeinsames Thema</small><strong>{theme.title}</strong><span>{theme.prompt}</span></aside>
      </div>
    </section>
    <section className="feed-scroll" aria-label="Neuigkeiten">
      <FeedStream initial={feed} />
    </section>
  </main>;
}

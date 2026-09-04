import { redirect } from "next/navigation";
import { ProfileJournal } from "@/components/profile-journal";
import { getUserBadges } from "@/lib/badges";
import { getTrailProfile } from "@/lib/profile";
import { getCurrentUser } from "@/lib/security";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const user = await getCurrentUser(); if (!user) redirect("/");
  const profile = getTrailProfile(user.id); if (!profile) redirect("/");
  const badges = getUserBadges(user.id);
  return <ProfileJournal profile={profile} badges={[...badges]} viewer={user} own />;
}

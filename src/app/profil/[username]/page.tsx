import { getTranslations } from "next-intl/server";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ProfileJournal } from "@/components/profile-journal";
import { getUserBadges } from "@/lib/badges";
import { getTrailProfileByUsername } from "@/lib/profile";
import { getCurrentUser } from "@/lib/security";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ username: string }> }): Promise<Metadata> {
  const t = await getTranslations();
  const profile = getTrailProfileByUsername((await params).username);
  return profile ? { title: profile.username, description: t("profile.metadata.description", {username: profile.username}) } : { title: t("profile.metadata.notFound") };
}

export default async function PublicProfilePage({ params }: { params: Promise<{ username: string }> }) {
  const profile = getTrailProfileByUsername((await params).username);
  if (!profile) notFound();
  const viewer = await getCurrentUser();
  return <ProfileJournal profile={profile} badges={[...getUserBadges(profile.id)]} viewer={viewer} own={viewer?.id === profile.id} />;
}

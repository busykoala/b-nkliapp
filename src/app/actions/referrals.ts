"use server";

import { getTranslations } from "next-intl/server";
import { createReferralInvite as createInvite } from "@/features/referrals/service";
import { consumeRateLimit, requireUser } from "@/lib/security";

export type ReferralLinkResult = { ok: false; message: string } | { ok: true; message: string; path: string; expiresAt: string };

export async function createReferralLink(): Promise<ReferralLinkResult> {
  const [user, t] = await Promise.all([requireUser(), getTranslations()]);
  consumeRateLimit(`user:${user.id}`, "referral-link", 10, 86_400);
  try {
    const invite = createInvite(user.id);
    return { ok: true, message: t("profile.referrals.created"), path: `/einladung/${invite.token}`, expiresAt: invite.expiresAt };
  } catch {
    return { ok: false, message: t("profile.referrals.failed") };
  }
}

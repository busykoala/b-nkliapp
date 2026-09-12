import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { Armchair, ArrowLeft, UserPlus } from "lucide-react";
import { ReferralSignup } from "@/components/account-controls";
import { getReferralInvite } from "@/features/referrals/service";
import { getCurrentUser } from "@/lib/security";

export const dynamic = "force-dynamic";

export default async function ReferralInvitationPage({ params }: { params: Promise<{token: string}> }) {
  const [{token}, t, user] = await Promise.all([params, getTranslations(), getCurrentUser()]);
  const invitation = getReferralInvite(token);
  return <main className="referral-invitation-page min-h-dvh safe-bottom">
    <header className="safe-top"><Link href="/" aria-label={t("feed.page.map")} className="calm-menu-button"><ArrowLeft size={19} /></Link><span><Armchair size={18} /> Bänkli App</span></header>
    <section className="referral-invitation-card">
      <span className="referral-invitation-icon"><UserPlus size={28} /></span>
      {!invitation ? <><small>{t("account.invitation.eyebrow")}</small><h1>{t("account.invitation.invalidTitle")}</h1><p>{t("account.invitation.invalidCopy")}</p><Link className="ui-button" href="/">{t("feed.page.map")}</Link></>
        : user ? <><small>{t("account.invitation.eyebrow")}</small><h1>{t("account.invitation.signedInTitle")}</h1><p>{t("account.invitation.signedInCopy")}</p><Link className="ui-button" href="/profil">{t("common.navigation.profile")}</Link></>
        : <><small>{t("account.invitation.eyebrow")}</small><h1>{t("account.invitation.title", {username: invitation.inviterUsername})}</h1><p>{t("account.invitation.copy")}</p><div className="referral-account-form"><ReferralSignup token={token} /></div><p className="referral-qualifier">{t("account.invitation.qualifier")}</p></>}
    </section>
  </main>;
}

"use client";

import { useActionState, useState } from "react";
import { Check, Copy, Link2, UserPlus } from "lucide-react";
import { useTranslations } from "next-intl";
import { createReferralLink, type ReferralLinkResult } from "@/app/actions/referrals";

export function ReferralCard({ count }: { count: number }) {
  const t = useTranslations();
  const [copied, setCopied] = useState(false);
  const [state, action, pending] = useActionState<ReferralLinkResult | null, FormData>(async () => createReferralLink(), null);
  const link = state?.ok ? `${window.location.origin}${state.path}` : "";
  const copy = async () => {
    await navigator.clipboard.writeText(link);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };
  return <section id="profile-invite" className="profile-section referral-card">
    <header><div><small>{t("profile.referrals.eyebrow")}</small><h2>{t("profile.referrals.title")}</h2></div><UserPlus size={22} /></header>
    <p>{t("profile.referrals.copy")}</p>
    <div className="referral-progress"><span><strong>{count}</strong><small>{t("profile.referrals.count", {count})}</small></span><div><i style={{width: `${Math.min(100, count / 3 * 100)}%`}} /></div><small>{count >= 3 ? t("profile.referrals.earned") : t("profile.referrals.remaining", {count: 3 - count})}</small></div>
    <form action={action}><button type="submit" disabled={pending}><Link2 size={17} />{pending ? t("profile.referrals.creating") : link ? t("profile.referrals.newLink") : t("profile.referrals.create")}</button></form>
    {link && <div className="referral-secret"><label htmlFor="referral-secret-link">{t("profile.referrals.secretLabel")}</label><div><input id="referral-secret-link" readOnly value={link} onFocus={(event) => event.currentTarget.select()} /><button type="button" onClick={copy} aria-label={copied ? t("profile.referrals.copied") : t("profile.referrals.copyLink")}>{copied ? <Check size={18} /> : <Copy size={18} />}<span>{copied ? t("profile.referrals.copied") : t("profile.referrals.copyLink")}</span></button></div><small>{t("profile.referrals.expires")}</small></div>}
    {state && !state.ok && <p role="alert">{state.message}</p>}
  </section>;
}

"use server";

import { getTranslations } from "next-intl/server";

import { revalidatePath } from "next/cache";
import { sqlite } from "@/db/client";
import {
  createUserSession, destroyUserSession, generateUserPasswordHash, normalizeUsername, verifyUserPassword,
} from "@/lib/security";
import { getReferralInvite, recordReferral } from "@/features/referrals/service";
import { refreshUserBadges } from "@/lib/badges";
import type { Translator } from "@/i18n/types";
import type { ActionResult } from "@/lib/types";
import { z } from "zod";

const credentialsSchema = (t: Translator) => z.object({
  username: z.string().trim().min(3, t("account.validation.usernameShort")).max(24, t("account.validation.usernameLong"))
    .regex(/^[\p{L}\p{N}._-]+$/u, t("account.validation.usernameCharacters")),
  password: z.string().min(8, t("account.validation.passwordShort")).max(128, t("account.validation.passwordLong")),
});

function invalid(error: z.ZodError, t: Translator): ActionResult {
  return { ok: false, message: error.issues[0]?.code === "invalid_type" ? t("common.errors.invalid") : error.issues[0]?.message ?? t("common.errors.invalid") };
}

export async function register(_previous: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const t = await getTranslations();
  const parsed = credentialsSchema(t).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error, t);
  const usernameKey = normalizeUsername(parsed.data.username);
  const referralToken = String(formData.get("referralToken") ?? "");
  const invite = referralToken ? getReferralInvite(referralToken) : null;
  if (referralToken && !invite) return { ok: false, message: t("account.result.invitationInvalid") };
  try {
    const now = new Date();
    const userId = sqlite.transaction(() => {
      const currentInvite = referralToken ? getReferralInvite(referralToken, sqlite, now) : null;
      if (referralToken && !currentInvite) throw new Error("REFERRAL_INVALID");
      const result = sqlite.prepare("INSERT INTO users(username,username_key,password_hash,created_at) VALUES(?,?,?,?)")
        .run(parsed.data.username.trim(), usernameKey, generateUserPasswordHash(parsed.data.password), now.toISOString());
      const createdUserId = Number(result.lastInsertRowid);
      if (currentInvite) recordReferral(currentInvite, createdUserId, sqlite, now);
      return createdUserId;
    })();
    if (invite) refreshUserBadges(invite.inviterUserId);
    await createUserSession(userId);
    revalidatePath("/", "layout");
    return { ok: true, message: t("account.result.welcome") };
  } catch (error) {
    if (error instanceof Error && error.message.includes("REFERRAL_INVALID")) return { ok: false, message: t("account.result.invitationInvalid") };
    if (error instanceof Error && error.message.includes("UNIQUE")) return { ok: false, message: t("account.result.usernameTaken") };
    return { ok: false, message: t("account.result.registerFailed") };
  }
}

export async function login(_previous: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const t = await getTranslations();
  const parsed = credentialsSchema(t).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: t("account.result.credentialsInvalid") };
  const user = sqlite.prepare("SELECT id,password_hash FROM users WHERE username_key=?").get(normalizeUsername(parsed.data.username)) as { id: number; password_hash: string } | undefined;
  if (!user || !verifyUserPassword(parsed.data.password, user.password_hash)) return { ok: false, message: t("account.result.credentialsInvalid") };
  sqlite.prepare("UPDATE users SET last_login_at=? WHERE id=?").run(new Date().toISOString(), user.id);
  await createUserSession(user.id);
  revalidatePath("/", "layout");
  return { ok: true, message: t("account.result.welcomeBack") };
}

export async function logout() {
  await destroyUserSession();
  revalidatePath("/", "layout");
}

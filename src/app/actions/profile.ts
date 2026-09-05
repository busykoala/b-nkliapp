"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { sqlite } from "@/db/client";
import { avatarOptionValues, serializeAvatarAppearance, type AvatarAppearance } from "@/lib/avatar";
import { requireUser } from "@/lib/security";

const avatarSchema = z.object({
  skin: z.enum(avatarOptionValues.skin),
  hair: z.enum(avatarOptionValues.hair),
  hairStyle: z.enum(avatarOptionValues.hairStyle),
  coat: z.enum(avatarOptionValues.coat),
  accent: z.enum(avatarOptionValues.accent),
  hat: z.enum(avatarOptionValues.hat),
  background: z.enum(avatarOptionValues.background),
  companion: z.enum(avatarOptionValues.companion),
});

export type AvatarActionState = { ok: boolean; message: string };

export async function saveAvatarAppearance(_previous: AvatarActionState, formData: FormData): Promise<AvatarActionState> {
  const user = await requireUser();
  const parsed = avatarSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: "Diese Kombination konnte nicht gespeichert werden." };
  sqlite.prepare("UPDATE users SET avatar_seed=? WHERE id=?")
    .run(serializeAvatarAppearance(parsed.data as AvatarAppearance), user.id);
  revalidatePath("/profil", "layout");
  revalidatePath(`/profil/${encodeURIComponent(user.username)}`);
  revalidatePath("/feed");
  return { ok: true, message: "Dein Aquarell-Avatar ist gespeichert." };
}

"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { sqlite } from "@/db/client";
import { requireUser } from "@/lib/security";

export async function redrawAvatar() {
  const user = await requireUser();
  sqlite.prepare("UPDATE users SET avatar_seed=? WHERE id=?").run(randomBytes(8).toString("hex"), user.id);
  revalidatePath("/profil", "layout");
  revalidatePath("/feed");
}

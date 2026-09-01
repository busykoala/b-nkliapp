"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { sqlite } from "@/db/client";
import { createAdminSession, destroyAdminSession, isAdmin, verifyAdminPassword } from "@/lib/security";
import type { ActionResult } from "@/lib/types";

export async function adminLogin(_previous: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const password = String(formData.get("password") ?? "");
  if (!verifyAdminPassword(password)) return { ok: false, message: "Passwort ist nicht korrekt." };
  await createAdminSession();
  return { ok: true, message: "Angemeldet." };
}

export async function adminLogout() {
  await destroyAdminSession();
  redirect("/admin");
}

export async function setContributionVisibility(type: "rating" | "correction", id: number, visible: boolean) {
  if (!(await isAdmin())) throw new Error("Nicht autorisiert.");
  const table = type === "rating" ? "ratings" : "corrections";
  sqlite.transaction(() => {
    sqlite.prepare(`UPDATE ${table} SET visible=? WHERE id=?`).run(visible ? 1 : 0, id);
    sqlite.prepare("INSERT INTO moderation_audit (action, target_type, target_id, detail, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(visible ? "show" : "hide", type, String(id), null, new Date().toISOString());
  })();
  revalidatePath("/");
  revalidatePath("/admin");
}

export async function blockContributor(type: "rating" | "correction", id: number) {
  if (!(await isAdmin())) throw new Error("Nicht autorisiert.");
  const table = type === "rating" ? "ratings" : "corrections";
  const target = sqlite.prepare(`SELECT contributor_hash FROM ${table} WHERE id=?`).get(id) as { contributor_hash: string } | undefined;
  if (!target) return;
  sqlite.transaction(() => {
    sqlite.prepare("INSERT OR REPLACE INTO blocked_contributors (contributor_hash, reason, created_at) VALUES (?, 'Moderation', ?)").run(target.contributor_hash, new Date().toISOString());
    sqlite.prepare("UPDATE ratings SET visible=0 WHERE contributor_hash=?").run(target.contributor_hash);
    sqlite.prepare("UPDATE corrections SET visible=0 WHERE contributor_hash=?").run(target.contributor_hash);
    sqlite.prepare("INSERT INTO moderation_audit (action, target_type, target_id, detail, created_at) VALUES ('block', ?, ?, ?, ?)")
      .run(type, String(id), target.contributor_hash, new Date().toISOString());
  })();
  revalidatePath("/");
  revalidatePath("/admin");
}

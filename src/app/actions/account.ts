"use server";

import { revalidatePath } from "next/cache";
import { sqlite } from "@/db/client";
import {
  createUserSession, destroyUserSession, generateUserPasswordHash, normalizeUsername, verifyUserPassword,
} from "@/lib/security";
import type { ActionResult } from "@/lib/types";
import { z } from "zod";

const credentialsSchema = z.object({
  username: z.string().trim().min(3, "Mindestens 3 Zeichen").max(24, "Höchstens 24 Zeichen")
    .regex(/^[\p{L}\p{N}._-]+$/u, "Nur Buchstaben, Zahlen, Punkt, _ und -"),
  password: z.string().min(8, "Mindestens 8 Zeichen").max(128),
});

function invalid(error: z.ZodError): ActionResult {
  return { ok: false, message: error.issues[0]?.message ?? "Bitte prüfe deine Angaben." };
}

export async function register(_previous: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const parsed = credentialsSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error);
  const usernameKey = normalizeUsername(parsed.data.username);
  try {
    const result = sqlite.prepare("INSERT INTO users(username,username_key,password_hash,created_at) VALUES(?,?,?,?)")
      .run(parsed.data.username.trim(), usernameKey, generateUserPasswordHash(parsed.data.password), new Date().toISOString());
    await createUserSession(Number(result.lastInsertRowid));
    revalidatePath("/", "layout");
    return { ok: true, message: "Willkommen bei der Bänkli App!" };
  } catch (error) {
    if (error instanceof Error && error.message.includes("UNIQUE")) return { ok: false, message: "Dieser Benutzername ist schon vergeben." };
    return { ok: false, message: "Konto konnte nicht erstellt werden." };
  }
}

export async function login(_previous: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const parsed = credentialsSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: "Benutzername oder Passwort stimmt nicht." };
  const user = sqlite.prepare("SELECT id,password_hash FROM users WHERE username_key=?").get(normalizeUsername(parsed.data.username)) as { id: number; password_hash: string } | undefined;
  if (!user || !verifyUserPassword(parsed.data.password, user.password_hash)) return { ok: false, message: "Benutzername oder Passwort stimmt nicht." };
  sqlite.prepare("UPDATE users SET last_login_at=? WHERE id=?").run(new Date().toISOString(), user.id);
  await createUserSession(user.id);
  revalidatePath("/", "layout");
  return { ok: true, message: "Schön, bist du wieder da!" };
}

export async function logout() {
  await destroyUserSession();
  revalidatePath("/", "layout");
}

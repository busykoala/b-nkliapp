"use server";

import { cookies } from "next/headers";
import { dialectCookie, isLanguage, languageCookie } from "@/i18n/config";

const cookieOptions = {
  httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 365 * 86400,
} as const;

export async function setLanguage(language: string) {
  if (!isLanguage(language)) throw new Error("Unsupported language");
  const cookieStore = await cookies();
  cookieStore.set(languageCookie, language, cookieOptions);
}

export async function setDialectMode(enabled: boolean) {
  const cookieStore = await cookies();
  cookieStore.set(dialectCookie, enabled ? "on" : "off", cookieOptions);
}

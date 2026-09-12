"use server";

import { cookies } from "next/headers";
import { fallbackLanguageCookie, isLanguage, isLanguagePreference, languageCookie } from "@/i18n/config";

export async function setLanguage(language: string) {
  if (!isLanguagePreference(language)) throw new Error("Unsupported language");
  const cookieStore = await cookies();
  const options = {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 365 * 86400,
  } as const;
  cookieStore.set(languageCookie, language, options);
  if (isLanguage(language)) cookieStore.set(fallbackLanguageCookie, language, options);
}

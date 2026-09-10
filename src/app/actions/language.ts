"use server";

import { cookies } from "next/headers";
import { isLanguage, languageCookie } from "@/i18n/config";

export async function setLanguage(language: string) {
  if (!isLanguage(language)) throw new Error("Unsupported language");
  (await cookies()).set(languageCookie, language, {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 365 * 86400,
  });
}

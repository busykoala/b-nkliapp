"use client";
import { useTranslations } from "next-intl";

import { useActionState, useEffect } from "react";
import { LogIn } from "lucide-react";
import { useRouter } from "next/navigation";
import { adminLogin } from "@/app/actions/admin";

export function AdminLoginForm() {
  const t = useTranslations();
  const router = useRouter();
  const [state, action, pending] = useActionState(adminLogin, null);
  useEffect(() => { if (state?.ok) router.refresh(); }, [router, state]);
  return <form action={action} className="card w-full max-w-sm border border-base-300 bg-base-100 shadow-xl"><div className="card-body"><h1 className="card-title text-2xl">{t("admin.title")}</h1><p className="text-sm opacity-65">{t("admin.signIn.description")}</p><label className="form-control my-2"><span className="label font-semibold">{t("account.fields.password")}</span><input type="password" name="password" required autoComplete="current-password" className="input input-bordered min-h-12" /></label><button className="btn btn-primary min-h-12" disabled={pending}>{pending ? <span className="loading loading-spinner" /> : <LogIn size={19} />}  {t("common.navigation.signIn")}</button>{state && <p role="status" className={state.ok ? "text-success" : "text-error"}>{state.message}</p>}{process.env.NODE_ENV !== "production" && <p className="text-xs opacity-50">{t("admin.signIn.local", { password: "benchly-admin" })}</p>}</div></form>;
}

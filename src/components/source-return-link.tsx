"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, type MouseEvent, type ReactNode } from "react";

const RETURN_KEY = "benchly:return-context:v1";

type ReturnContext = {
  version: 1;
  token: string;
  source: string;
  focusId: string;
  scrollX: number;
  scrollY: number;
  createdAt: number;
};

function readContext(): ReturnContext | null {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(RETURN_KEY) ?? "null") as Partial<ReturnContext> | null;
    return parsed?.version === 1 && typeof parsed.token === "string" && typeof parsed.source === "string" && typeof parsed.focusId === "string" && Date.now() - Number(parsed.createdAt) < 60 * 60 * 1000
      ? parsed as ReturnContext
      : null;
  } catch { return null; }
}

export function SourceReturnLink({ href, focusId, className, ariaLabel, children }: { href: string; focusId: string; className?: string; ariaLabel?: string; children: ReactNode }) {
  const router = useRouter();
  const open = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    const token = crypto.randomUUID();
    const source = `${window.location.pathname}${window.location.search}`;
    sessionStorage.setItem(RETURN_KEY, JSON.stringify({ version: 1, token, source, focusId, scrollX: window.scrollX, scrollY: window.scrollY, createdAt: Date.now() } satisfies ReturnContext));
    const destination = new URL(href, window.location.origin);
    destination.searchParams.set("return", token);
    router.push(`${destination.pathname}${destination.search}${destination.hash}`);
  };
  return <Link href={href} id={focusId} className={className} aria-label={ariaLabel} onClick={open}>{children}</Link>;
}

export function RestoreSourceReturn() {
  useEffect(() => {
    const restore = () => {
      const context = readContext();
      if (!context || context.source !== `${window.location.pathname}${window.location.search}`) return;
      sessionStorage.removeItem(RETURN_KEY);
      window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
        window.scrollTo({ left: context.scrollX, top: context.scrollY, behavior: "instant" });
        document.getElementById(context.focusId)?.focus({ preventScroll: true });
      }));
    };
    restore();
    window.addEventListener("pageshow", restore);
    return () => window.removeEventListener("pageshow", restore);
  }, []);
  return null;
}

export function BenchReturnButton({ token, fallbackHref, label, children, className }: { token?: string; fallbackHref: string; label: string; children: ReactNode; className?: string }) {
  const router = useRouter();
  return <button type="button" aria-label={label} className={className} onClick={() => {
    const context = readContext();
    if (token && context?.token === token) router.back();
    else router.push(fallbackHref);
  }}>{children}</button>;
}

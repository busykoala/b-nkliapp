"use client";

import { useSyncExternalStore } from "react";

// A browser-only UI hint bridges successful authentication and the RSC refresh.
// It contains no identity or credentials. Every write still authenticates on the server.
let authenticatedHint = false;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const snapshot = () => authenticatedHint;
const serverSnapshot = () => false;

export function markAccountSession(authenticated: boolean) {
  if (typeof window === "undefined" || authenticatedHint === authenticated) return;
  authenticatedHint = authenticated;
  for (const listener of listeners) listener();
}

export function useAuthenticated(serverAuthenticated: boolean) {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot) || serverAuthenticated;
}

"use client";

type OverlayEntry = { token: symbol; dismiss: () => void };

const overlays: OverlayEntry[] = [];
let listening = false;

function dismissTopmost(event: KeyboardEvent) {
  if (event.key !== "Escape" || event.defaultPrevented) return;
  const topmost = overlays.at(-1);
  if (!topmost) return;
  // Native dialogs own their Escape behavior. Registered non-modal layers wait
  // until the dialog above them is gone.
  if (document.querySelector("dialog[open]")) return;
  event.preventDefault();
  event.stopPropagation();
  topmost.dismiss();
}

export function registerOverlayDismissal(dismiss: () => void) {
  const entry = { token: Symbol("overlay"), dismiss };
  overlays.push(entry);
  if (!listening) {
    document.addEventListener("keydown", dismissTopmost);
    listening = true;
  }
  return () => {
    const index = overlays.findIndex((candidate) => candidate.token === entry.token);
    if (index >= 0) overlays.splice(index, 1);
    if (!overlays.length && listening) {
      document.removeEventListener("keydown", dismissTopmost);
      listening = false;
    }
  };
}

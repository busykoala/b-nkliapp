"use client";

import { useFormStatus } from "react-dom";
import { Shuffle } from "lucide-react";
import { redrawAvatar } from "@/app/actions/profile";

function RedrawButton() {
  const { pending } = useFormStatus();
  return <button type="submit" className="avatar-redraw" disabled={pending}>
    {pending ? <span className="loading loading-spinner loading-xs" /> : <Shuffle size={15} />}
    {pending ? "Wird gezeichnet …" : "Neu zeichnen"}
  </button>;
}

export function AvatarRedrawButton() {
  return <form action={redrawAvatar}><RedrawButton /></form>;
}

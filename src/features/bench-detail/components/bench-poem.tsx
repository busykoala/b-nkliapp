"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { BenchDetail } from "@/lib/types";
import { scenePoem } from "@/lib/scene-poetry";

/** Keyed by place/language by the parent; live refreshes never replace a line being read. */
export function BenchPoem({ bench, localText }: { bench: BenchDetail; localText?: string }) {
  const t = useTranslations();
  const [text] = useState(() => localText ?? scenePoem(bench, t).text);
  return <p className="bench-poem">{text}</p>;
}

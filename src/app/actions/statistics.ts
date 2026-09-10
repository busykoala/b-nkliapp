"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { readRouletteBench } from "@/features/statistics/repository";

const rouletteMode = z.enum(["beautiful", "sunny", "wild"]);

export async function spinBenchRoulette(formData: FormData) {
  const parsed = rouletteMode.safeParse(formData.get("mode"));
  if (!parsed.success) redirect("/statistiken");
  const id = readRouletteBench(parsed.data);
  redirect(id ? `/bank/${encodeURIComponent(id)}` : "/statistiken");
}

"use server";
import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { sqlite } from "@/db/client";
import { assertContributorAllowed, consumeRateLimit, contributorHashForUser, getContributorIdentity, requireUser } from "@/lib/security";
import type { ActionResult } from "@/lib/types";

const answerSchema = z.object({ benchId: z.string().min(1).max(100), attribute: z.enum(["backrest", "armrest", "covered", "approach_steps"]), value: z.union([z.literal(0), z.literal(1), z.null()]) });
export async function answerBenchQuestion(input: unknown): Promise<ActionResult> {
  const parsed = answerSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Diese Antwort konnte nicht gespeichert werden." };
  try {
    const user = await requireUser();
    const contributor = contributorHashForUser(user.id);
    assertContributorAllowed(contributor);
    const identity = await getContributorIdentity();
    consumeRateLimit(contributor, "verification-day", 60, 86400);
    consumeRateLimit(identity.ipHash, "verification-ip-day", 180, 86400);
    const { benchId, attribute, value } = parsed.data;
    const bench = sqlite.prepare("SELECT row_id FROM benches WHERE id=? AND active=1").get(benchId) as { row_id: number } | undefined;
    if (!bench) return { ok: false, message: "Dieses Bänkli wurde nicht gefunden." };
    const now = new Date().toISOString();
    const sourceId = `user:${user.id}`;
    const key = createHash("sha256").update(JSON.stringify([bench.row_id, attribute, sourceId, value, now])).digest("hex");
    sqlite.transaction(() => {
      sqlite.prepare(`INSERT INTO bench_verification_answers(bench_row_id,user_id,attribute,value_json,observed_at) VALUES(?,?,?,?,?)
        ON CONFLICT(bench_row_id,user_id,attribute) DO UPDATE SET value_json=excluded.value_json,observed_at=excluded.observed_at`).run(bench.row_id, user.id, attribute, JSON.stringify(value), now);
      sqlite.prepare(`INSERT INTO bench_attribute_evidence(bench_row_id,attribute,value_json,source_type,source_id,observed_at,imported_at,confidence,method_version,metadata_json,evidence_key)
        VALUES(?,?,?,'community',?,?,?,.9,'verification-1','{}',?)`).run(bench.row_id, attribute, JSON.stringify(value), sourceId, now, now, key);
    })();
    revalidatePath(`/bank/${benchId}`);
    return { ok: true, message: "Danke! Dein Hinweis ergänzt die vorhandenen Beobachtungen." };
  } catch (error) { return { ok: false, message: error instanceof Error ? error.message : "Die Antwort macht gerade Pause." }; }
}

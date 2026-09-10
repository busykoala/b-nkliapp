import "server-only";

import { UserFacingError } from "@/i18n/action-error";
import { z } from "zod";
import { DATA_PROVIDERS } from "@/data/runtime.generated";

const verdictSchema = z.object({ people_detected: z.boolean(), confidence: z.number().min(0).max(1) });

export async function ensurePeopleFreePhoto(bytes: Uint8Array, contentType: string) {
  const base = process.env.INFERENCE_BASE_URL ?? DATA_PROVIDERS.inferenceDefaultUrl;
  const key = process.env.INFERENCE_API_KEY;
  if (!key) throw new UserFacingError("photos.server.checkUnavailable");
  const response = await fetch(`${base.replace(/\/$/, "")}/v1/chat/completions`, {
    method: "POST", signal: AbortSignal.timeout(12_000),
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: process.env.BENCHLY_VISION_MODEL ?? "benchly-vision", temperature: 0,
      messages: [{ role: "user", content: [
        { type: "text", text: "Check only whether any person or recognizable part of a person is visible. Return JSON with people_detected and confidence." },
        { type: "image_url", image_url: { url: `data:${contentType};base64,${Buffer.from(bytes).toString("base64")}` } },
      ] }], response_format: { type: "json_schema", json_schema: { name: "people_check", strict: true, schema: {
        type: "object", additionalProperties: false, required: ["people_detected", "confidence"], properties: {
          people_detected: { type: "boolean" }, confidence: { type: "number", minimum: 0, maximum: 1 },
        },
      } } },
    }),
  });
  if (!response.ok) throw new UserFacingError("photos.server.checkBusy");
  const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  const verdict = verdictSchema.parse(JSON.parse(payload.choices?.[0]?.message?.content ?? "{}"));
  if (verdict.people_detected || verdict.confidence < .72) {
    throw new UserFacingError(verdict.people_detected
      ? "photos.server.people"
      : "photos.server.uncertain");
  }
}

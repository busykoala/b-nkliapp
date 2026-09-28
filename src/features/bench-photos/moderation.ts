import "server-only";

import { UserFacingError } from "@/i18n/action-error";
import { z } from "zod";
import { DATA_PROVIDERS } from "@/data/runtime.generated";

const verdictSchema = z.object({ people_detected: z.boolean(), confidence: z.number().min(0).max(1) });
const moderationTimeoutMs = 90_000;

export async function ensurePeopleFreePhoto(bytes: Uint8Array, contentType: string) {
  const base = process.env.INFERENCE_BASE_URL ?? DATA_PROVIDERS.inferenceDefaultUrl;
  const key = process.env.INFERENCE_API_KEY;
  if (!key) throw new UserFacingError("photos.server.checkUnavailable");
  let response: Response;
  try { response = await fetch(`${base.replace(/\/$/, "")}/v1/chat/completions`, {
    method: "POST", signal: AbortSignal.timeout(moderationTimeoutMs),
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: process.env.BENCHLY_VISION_MODEL ?? "benchly-vision", temperature: 0, max_tokens: 256,
      chat_template_kwargs: { enable_thinking: false },
      messages: [{ role: "user", content: [
        { type: "text", text: "Check only whether any person or recognizable part of a person is visible. Return JSON with people_detected and confidence." },
        { type: "image_url", image_url: { url: `data:${contentType};base64,${Buffer.from(bytes).toString("base64")}` } },
      ] }], response_format: { type: "json_schema", json_schema: { name: "people_check", strict: true, schema: {
        type: "object", additionalProperties: false, required: ["people_detected", "confidence"], properties: {
          people_detected: { type: "boolean" }, confidence: { type: "number", minimum: 0, maximum: 1 },
        },
      } } },
    }),
  }); } catch {
    console.error("bench-photo-moderation", { stage: "transport" });
    throw new UserFacingError("photos.server.checkUnavailable");
  }
  if (!response.ok) {
    console.error("bench-photo-moderation", { stage: "response", status: response.status });
    throw new UserFacingError(response.status === 401 || response.status === 403
      ? "photos.server.checkUnavailable" : "photos.server.checkBusy");
  }
  let verdict: z.infer<typeof verdictSchema>;
  try {
    const payload = await response.json() as { choices?: Array<{ finish_reason?: string; message?: { content?: unknown } }> };
    const choice = payload.choices?.[0];
    if (choice?.finish_reason && choice.finish_reason !== "stop") throw new Error("Incomplete verdict");
    const content = choice?.message?.content;
    const text = typeof content === "string" ? content : Array.isArray(content)
      ? content.map((part: { text?: unknown }) => typeof part?.text === "string" ? part.text : "").join("") : "";
    // Match the private worker's JSON/fenced-JSON response contract. Never parse reasoning as a verdict.
    verdict = verdictSchema.parse(JSON.parse(text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")));
  } catch {
    console.error("bench-photo-moderation", { stage: "verdict" });
    throw new UserFacingError("photos.server.checkUnavailable");
  }
  if (verdict.people_detected || verdict.confidence < .72) {
    throw new UserFacingError(verdict.people_detected
      ? "photos.server.people"
      : "photos.server.uncertain");
  }
}

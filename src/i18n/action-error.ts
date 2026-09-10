import type { MessageKey, Translator } from "./types";
import type { UiMessage } from "./message";

/** Expected domain failures carry a stable key until the request renders them. */
export class UserFacingError extends Error {
  constructor(readonly key: MessageKey, readonly values?: UiMessage["values"]) {
    super(key);
    this.name = "UserFacingError";
  }
}

export function actionError(t: Translator, error: unknown, fallback: MessageKey) {
  return error instanceof UserFacingError ? t(error.key, error.values) : t(fallback);
}

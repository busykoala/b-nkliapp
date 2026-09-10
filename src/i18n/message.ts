import type { MessageKey, Translator } from "./types";

/** Serializable presentation text for results that survive a language switch. */
export type UiMessage = { key: MessageKey; values?: Record<string, string | number> };

export function message(key: MessageKey, values?: UiMessage["values"]): UiMessage {
  return values ? {key, values} : {key};
}

export function translateMessage(t: Translator, value: UiMessage) {
  return t(value.key, value.values);
}

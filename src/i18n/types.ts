import type { useTranslations } from "next-intl";

/** Explicit dependency for pure presentation helpers; never read a global language. */
export type Translator = ReturnType<typeof useTranslations<never>>;

export type MessageKey = Parameters<Translator>[0];

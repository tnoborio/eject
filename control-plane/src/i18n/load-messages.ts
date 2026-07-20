import en from "./messages/en.json";
import ja from "./messages/ja.json";

export type Locale = "en" | "ja";
export type MessageKey = keyof typeof en;
export type Messages = Readonly<Record<MessageKey, string>>;

const messages: Readonly<Record<Locale, Messages>> = { en, ja };

export function selectLocale(acceptLanguage: string | null): Locale {
  if (acceptLanguage === null) {
    return "en";
  }

  const preferred = acceptLanguage
    .split(",")
    .map((entry) => entry.trim().split(";")[0]?.toLowerCase())
    .find((entry) => entry === "ja" || entry?.startsWith("ja-"));

  return preferred === undefined ? "en" : "ja";
}

export function loadMessages(locale: Locale): Messages {
  return messages[locale];
}

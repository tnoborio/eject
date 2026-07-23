import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { loadMessages, selectLocale } from "@/i18n/load-messages";
import { WebConsole } from "./web-console";

async function localeAndMessages() {
  const requestHeaders = await headers();
  const cookieStore = await cookies();
  const locale = selectLocale(
    requestHeaders.get("accept-language"),
    cookieStore.get("eject_locale")?.value,
  );
  return { locale, messages: loadMessages(locale) };
}

export async function generateMetadata(): Promise<Metadata> {
  const { messages } = await localeAndMessages();
  return { description: messages["metadata.description"] };
}

export default async function Home() {
  const { locale, messages } = await localeAndMessages();

  return (
    <WebConsole
      locale={locale}
      messages={messages}
      capabilities={{
        personAuth: process.env.EJECT_PERSON_AUTH_ENABLED === "true",
        deviceEnrollment:
          process.env.EJECT_DEVICE_ENROLLMENT_ENABLED === "true",
        delivery: process.env.EJECT_AGENT_DELIVERY_ENABLED === "true",
      }}
    />
  );
}

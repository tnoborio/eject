import type { Metadata } from "next";
import { headers } from "next/headers";
import { loadMessages, selectLocale } from "@/i18n/load-messages";

async function localeAndMessages() {
  const requestHeaders = await headers();
  const locale = selectLocale(requestHeaders.get("accept-language"));
  return { locale, messages: loadMessages(locale) };
}

export async function generateMetadata(): Promise<Metadata> {
  const { messages } = await localeAndMessages();
  return { description: messages["metadata.description"] };
}

export default async function Home() {
  const { locale, messages } = await localeAndMessages();

  return (
    <main lang={locale}>
      <section className="panel" aria-labelledby="headline">
        <p className="eyebrow">{messages["home.eyebrow"]}</p>
        <h1 id="headline">{messages["home.headline"]}</h1>
        <p className="statement">{messages["home.statement"]}</p>
        <dl>
          <dt>{messages["home.statusLabel"]}</dt>
          <dd>{messages["home.statusValue"]}</dd>
        </dl>
        <p className="notice">{messages["home.notice"]}</p>
      </section>
    </main>
  );
}

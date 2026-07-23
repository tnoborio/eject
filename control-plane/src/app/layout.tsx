import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import type { ReactNode } from "react";
import { selectLocale } from "@/i18n/load-messages";
import "./styles.css";

export const metadata: Metadata = {
  title: "EJECT",
};

export default async function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  const cookieStore = await cookies();
  const requestHeaders = await headers();
  const locale = selectLocale(
    requestHeaders.get("accept-language"),
    cookieStore.get("eject_locale")?.value,
  );
  return (
    <html lang={locale}>
      <body>{children}</body>
    </html>
  );
}

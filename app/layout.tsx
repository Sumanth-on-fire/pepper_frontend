import type { Metadata } from "next";
import { HealthKeepAlive } from "./components/HealthKeepAlive";
import "./globals.css";

export const metadata: Metadata = {
  title: "Pepper",
  description: "Your app description here",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <HealthKeepAlive />
        {children}
      </body>
    </html>
  );
}

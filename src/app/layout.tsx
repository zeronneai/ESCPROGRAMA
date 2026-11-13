import type { Metadata } from "next";
import "./globals.css";
import { FeedbackGlobal } from "@/components/feedback-global";

export const metadata: Metadata = {
  title: "ESC One | ESC Representaciones",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es-MX">
      <body>
        {children}
        <FeedbackGlobal />
      </body>
    </html>
  );
}

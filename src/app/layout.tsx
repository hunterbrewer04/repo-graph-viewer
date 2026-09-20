import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Repo Graph Viewer",
  description: "Interactive force-directed viewer for graphify code graphs.",
};

/**
 * Applies the saved theme before first paint so a dark-mode visitor never sees
 * a light flash. Light is the default, so only "dark" needs the attribute.
 * Storage can throw (private mode, blocked cookies), in which case light wins.
 *
 * A raw <script> rather than next/script: an inline `beforeInteractive` script
 * is queued for Next's client runtime instead of being emitted into the HTML,
 * which is too late. Placed first in <body> so it runs before any content is
 * parsed, and nothing hydrates it because the root layout never re-renders.
 */
const THEME_INIT = `try{if(localStorage.getItem("theme")==="dark")document.documentElement.dataset.theme="dark"}catch(e){}`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // The inline script may set data-theme before React hydrates, so the
    // server-rendered <html> legitimately differs from the client's.
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      {/* dvh, not %: iOS Safari resizes the viewport as its toolbar shows and hides. */}
      <body className="h-dvh">
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
        {children}
      </body>
    </html>
  );
}

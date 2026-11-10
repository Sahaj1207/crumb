import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Atkinson_Hyperlegible, IBM_Plex_Mono } from "next/font/google";
import Link from "next/link";
import { Suspense } from "react";
import "./globals.css";

const bricolage = Bricolage_Grotesque({ variable: "--font-bricolage", subsets: ["latin"], weight: ["500", "700", "800"] });
const atkinson = Atkinson_Hyperlegible({ variable: "--font-atkinson", subsets: ["latin"], weight: ["400", "700"] });
const plexMono = IBM_Plex_Mono({ variable: "--font-plex-mono", subsets: ["latin"], weight: ["400", "600"] });

export const metadata: Metadata = {
  title: "Crumb — tonight's surplus food, paid only on handover",
  description:
    "Local shops photograph what's left at closing time; AI lists it in seconds. People and their AI assistants reserve with a PayPal hold that is only charged for what's actually in the bag.",
};

export const viewport: Viewport = { themeColor: "#f3f4f0", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${bricolage.variable} ${atkinson.variable} ${plexMono.variable}`}>
      <body className="min-h-dvh flex flex-col">
        <header className="border-b border-line bg-flour/90 backdrop-blur sticky top-0 z-20">
          <nav className="mx-auto max-w-5xl px-4 h-14 flex items-center gap-1 sm:gap-4">
            <Link href="/" className="flex items-center gap-2 mr-auto" aria-label="Crumb home">
              <Logo />
              <span className="font-display font-extrabold text-xl tracking-tight">crumb</span>
            </Link>
            <NavLink href="/">Tonight</NavLink>
            <NavLink href="/shop">For shops</NavLink>
            <NavLink href="/agent">AI agents</NavLink>
            <NavLink href="/impact">Ledger</NavLink>
          </nav>
        </header>
        <main className="flex-1">
          <Suspense fallback={<p className="p-10 text-center text-ink-soft">Loading…</p>}>{children}</Suspense>
        </main>
        <footer className="border-t border-line text-sm text-ink-soft">
          <div className="mx-auto max-w-5xl px-4 py-6 flex flex-wrap gap-x-6 gap-y-2">
            <span>Built for the PayPal AI Hackathon 2026. PayPal sandbox only — no real money moves.</span>
            <a className="underline" href="/.well-known/ucp">UCP profile</a>
            <Link className="underline" href="/agent#connect">MCP server</Link>
          </div>
        </footer>
      </body>
    </html>
  );
}

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="px-2 py-1.5 rounded-md text-sm sm:text-[0.95rem] font-bold text-ink-soft hover:text-ink hover:bg-paper">
      {children}
    </Link>
  );
}

function Logo() {
  // a paper bag with a bite out of the corner
  return (
    <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden="true">
      <path d="M6 9h20l-1.6 19.2a2 2 0 0 1-2 1.8H9.6a2 2 0 0 1-2-1.8z" fill="#b98b5a" />
      <path d="M11 9V7a5 5 0 0 1 10 0v2" fill="none" stroke="#16201c" strokeWidth="2" />
      <circle cx="26.5" cy="9.5" r="4" fill="#f3f4f0" />
      <circle cx="13" cy="19" r="4.6" fill="#ffe14d" />
    </svg>
  );
}

import type { Metadata, Viewport } from "next";
import { Space_Grotesk } from "next/font/google";
import "./globals.css";

const brandFont = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-brand",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Axtra — Personal AI Agent",
  description: "Agen AI personal yang memahami konteks, memori, dan tujuanmu.",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [{ url: "/axtratr.png", type: "image/png" }],
    shortcut: "/axtratr.png",
    apple: "/axtratr.png",
  },
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Axtra" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#000000" },
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
  ],
  width: "device-width",
  initialScale: 1,
};

// Applied before paint to avoid a theme flash. Default is dark (Design.md §2).
const THEME_INIT = `
try {
  var stored = localStorage.getItem('axtra-theme');
  var theme = stored === 'light' || stored === 'dark'
    ? stored
    : (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
  document.documentElement.dataset.theme = theme;
} catch (e) {
  document.documentElement.dataset.theme = 'dark';
}
`;

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="id" suppressHydrationWarning data-theme="dark">
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
      </head>
      <body className={`min-h-screen ${brandFont.variable}`}>{children}</body>
    </html>
  );
}
import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Simmer",
  appleWebApp: { capable: true, title: "Simmer", statusBarStyle: "default" },
  icons: { icon: [{ url: "/icon.svg", type: "image/svg+xml" }, { url: "/icon-192.png" }], apple: "/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F5F6F0" },
    { media: "(prefers-color-scheme: dark)", color: "#0C0E0B" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="antialiased" suppressHydrationWarning>
      <head>
        {/* The saved theme, before anything paints (React would only set it after loading). Keep the key in step with client.ts. */}
        <script dangerouslySetInnerHTML={{ __html: `try{var t=JSON.parse(localStorage.getItem("sm.theme"));if(t)document.documentElement.dataset.theme=t}catch(e){}` }} />
      </head>
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}

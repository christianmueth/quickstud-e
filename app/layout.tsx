import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import "./globals.css";
import { Toaster } from "sonner";
import NavBar from "@/components/NavBar"; // <-- make sure this path exists

export const metadata = {
  title: "QuickStud-E",
  description: "Paste slides → get flashcards",
  icons: {
    icon: "/logo.ico",
    shortcut: "/logo.ico",   // used by Chromium / pinned tabs
    apple: "/logo.ico",      // Apple touch icon (fallback)
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider>
      <html lang="en">
        <body className="min-h-screen bg-white text-gray-900">
          <NavBar />{/* toolbar/header lives inside <body> */}
          {children}
          <Toaster richColors closeButton position="top-right" />
        </body>
      </html>
    </ClerkProvider>
  );
}

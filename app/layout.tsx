// app/layout.tsx
import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import "./globals.css";
import NavBar from "@/components/NavBar"; // <-- import it

export const metadata: Metadata = {
  title: "QuickStud-E",
  description: "Paste slides → get flashcards",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider>
      <html lang="en">
        <body className="min-h-screen bg-white text-gray-900">
          <NavBar />         {/* <= inside body, above children */}
          {children}
        </body>
      </html>
    </ClerkProvider>
  );
}

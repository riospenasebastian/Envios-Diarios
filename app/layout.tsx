import type { Metadata } from "next";
import "./globals.css";
import { Toaster } from "react-hot-toast";
import Sidebar from "@/components/layout/Sidebar";
import ThemeProvider from "@/components/providers/ThemeProvider";

export const metadata: Metadata = {
  title: "EnvíosSaaS — Automatización Logística",
  description: "Sistema interno de automatización logística Shopify + EnviaTodo",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className="dark" suppressHydrationWarning>
      <body className="bg-dark-950 text-dark-100 min-h-screen" suppressHydrationWarning>
        <ThemeProvider>
          <div className="flex h-screen overflow-hidden">
            <Sidebar />
            <main className="flex-1 overflow-y-auto bg-dark-950">
              {children}
            </main>
          </div>
          <Toaster
            position="bottom-right"
            toastOptions={{
              style: {
                background: "var(--toast-bg)",
                color:      "var(--toast-color)",
                border:     "1px solid var(--toast-border)",
                borderRadius: "0.75rem",
                fontSize: "0.875rem",
              },
              success: { iconTheme: { primary: "#10b981", secondary: "var(--toast-bg)" } },
              error:   { iconTheme: { primary: "#ef4444", secondary: "var(--toast-bg)" } },
            }}
          />
        </ThemeProvider>
      </body>
    </html>
  );
}

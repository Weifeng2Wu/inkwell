import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ThemeProvider } from "next-themes";
import { ExternalLinkHandler } from "@/components/external-link-handler";
import { ToastProvider } from "@/components/ui/toast";
import { I18nProvider } from "@/features/i18n";
import { DEFAULT_THEME, THEME_IDS } from "@/features/settings/lib/theme";
import { StorageProvider, StorageThemeSync } from "@/lib/storage/storage-provider";
import "./globals.css";

const modernSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  display: "swap",
  weight: ["400", "500", "700"],
});

const modernMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
  weight: ["400", "500", "700"],
});

export const metadata: Metadata = {
  title: "Inkwell",
  description: "AI-native LaTeX editor",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${modernSans.variable} ${modernMono.variable} antialiased`}>
        <StorageProvider>
          <ThemeProvider
            attribute="class"
            defaultTheme={DEFAULT_THEME}
            themes={THEME_IDS}
            enableSystem={false}
            disableTransitionOnChange
          >
            <I18nProvider>
              <StorageThemeSync />
              <ToastProvider>
                <ExternalLinkHandler />
                {children}
              </ToastProvider>
            </I18nProvider>
          </ThemeProvider>
        </StorageProvider>
      </body>
    </html>
  );
}

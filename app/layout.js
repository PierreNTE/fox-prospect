import "./globals.css";
import "./shell.css";
import SwRegister from "./sw-register";
import FluentRoot from "./fluent-root";
import AppShell from "@/components/AppShell";

export const metadata = {
  title: "Fox Prospect",
  description: "Copilote de prospection B2B IT — qualification et points d'accroche",
  appleWebApp: { capable: true, title: "Fox Prospect", statusBarStyle: "default" },
  icons: { apple: "/apple-touch-icon.png" },
};

export const viewport = {
  themeColor: "#5B53E6",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }) {
  return (
    <html lang="fr">
      <body>
        <SwRegister />
        <FluentRoot>
          <AppShell>{children}</AppShell>
        </FluentRoot>
      </body>
    </html>
  );
}
